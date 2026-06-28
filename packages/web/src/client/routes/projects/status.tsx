import { useState, useEffect, useRef, useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  BacklogItem,
  BacklogRootEntry,
  DerivedStatus,
  PersistedEvent,
  ResetProjectResult,
  ValidateBacklogResult,
} from "@rauf/core";
import { raufFetch, raufFetchJson } from "../../lib/fetch";
import { StateBadge } from "../../components/StateBadge";

// ─── Loop control state sets ──────────────────────────────────────

const STARTABLE_STATES = new Set(["IDLE", "PAUSED", "COMPLETE", "ITERATIONS_COMPLETE", "ERROR"]);
const STOPPABLE_STATES = new Set(["RUNNING", "SLEEPING_LIMIT"]);

// States from which a Resume action is meaningful (spec 04 §8.7). Iteration
// budget reached is a clean stop with work likely remaining — re-running
// continues the backlog, so it is resumable alongside the paused states.
const RESUMABLE_STATES = new Set([
  "PAUSED",
  "PAUSED_HUMAN",
  "PAUSED_USAGE_LIMIT",
  "ITERATIONS_COMPLETE",
  "ERROR",
  "IDLE",
]);
// States in which a standalone Review pass would 409 (a loop is active).
const REVIEW_BLOCKING_STATES = new Set(["RUNNING", "REVIEWING", "STARTING"]);

// Web shape of the resume route's ResumeResult DTO (spec 04 §4 / 00 §6).
interface ResumeResultData {
  relaunched: boolean;
  reason?: string;
}

/** Friendly copy for known codes; raw message otherwise (spec 04 §8.1). */
async function recoveryErrorMessage(res: Response): Promise<string> {
  if (res.status === 409) return "a loop is running — stop it first";
  const body = (await res.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string };
  };
  return body.error?.message ?? `HTTP ${res.status}`;
}

// ─── Elapsed time formatter ───────────────────────────────────────

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
}

// ─── Components ───────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="mb-3 text-sm font-semibold uppercase tracking-wider"
      style={{ color: "var(--color-text-muted)" }}
    >
      {children}
    </h2>
  );
}

function RecoveryButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        borderColor: "var(--color-border)",
        color: "var(--color-text)",
        backgroundColor: "var(--color-surface)",
      }}
    >
      {label}
    </button>
  );
}

function Card({ children, highlight }: { children: React.ReactNode; highlight?: boolean }) {
  return (
    <div
      className="rounded-lg border p-4"
      style={{
        backgroundColor: "var(--color-surface-raised)",
        borderColor: highlight ? "rgba(22, 163, 74, 0.4)" : "var(--color-border)",
      }}
    >
      {children}
    </div>
  );
}

function ItemTitle({ item }: { item: BacklogItem }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className="font-mono text-xs font-semibold"
        style={{ color: "var(--color-text-muted)" }}
      >
        #{item.id}
      </span>
      <span
        className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium capitalize"
        style={{
          backgroundColor: "rgba(107, 114, 128, 0.1)",
          color: "var(--color-text-muted)",
        }}
      >
        {item.type}
      </span>
      <span
        className="inline-flex items-center rounded px-1.5 py-0.5 font-mono text-xs font-medium"
        style={{
          backgroundColor: "rgba(239, 68, 68, 0.10)",
          color: item.priority === 1 ? "#ef4444" : item.priority === 2 ? "#ea580c" : "#ca8a04",
        }}
      >
        P{item.priority}
      </span>
    </div>
  );
}

function CurrentItemCard({ item }: { item: BacklogItem }) {
  return (
    <Card highlight>
      <ItemTitle item={item} />
      <p className="mt-2 text-sm font-medium leading-snug" style={{ color: "var(--color-text)" }}>
        {item.title}
      </p>
      {item.description && (
        <p className="mt-1.5 text-xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
          {item.description}
        </p>
      )}
      {item.acceptanceCriteria.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
            Acceptance Criteria
          </p>
          <ul className="space-y-1">
            {item.acceptanceCriteria.map((criterion, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-xs"
                style={{ color: "var(--color-text)" }}
              >
                <span
                  className="mt-0.5 flex-shrink-0 text-xs"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  ·
                </span>
                {criterion}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function BlockedItemCard({ item }: { item: BacklogItem }) {
  return (
    <Card>
      <ItemTitle item={item} />
      <p className="mt-2 text-sm font-medium leading-snug" style={{ color: "var(--color-text)" }}>
        {item.title}
      </p>
      {item.blockedReason && (
        <p
          className="mt-2 rounded px-2.5 py-1.5 text-xs"
          style={{
            backgroundColor: "rgba(239, 68, 68, 0.08)",
            color: "#ef4444",
            border: "1px solid rgba(239, 68, 68, 0.2)",
          }}
        >
          {item.blockedReason}
        </p>
      )}
    </Card>
  );
}

function CompletedItemRow({ item }: { item: BacklogItem }) {
  const completedAt = item.completedAt ? new Date(item.completedAt) : null;
  return (
    <div
      className="flex items-center gap-3 py-2.5"
      style={{ borderBottom: "1px solid var(--color-border)" }}
    >
      <span
        className="font-mono text-xs"
        style={{ color: "var(--color-text-muted)", minWidth: "2.5rem" }}
      >
        #{item.id}
      </span>
      <span
        className="flex-1 truncate text-sm"
        style={{ color: "var(--color-text)" }}
        title={item.title}
      >
        {item.title}
      </span>
      {completedAt && (
        <span className="flex-shrink-0 text-xs" style={{ color: "var(--color-text-muted)" }}>
          {completedAt.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
        </span>
      )}
    </div>
  );
}

// ─── Backlog summary counts ───────────────────────────────────────

function BacklogSummaryGrid({ summary }: { summary: DerivedStatus["backlogSummary"] }) {
  const pills = [
    {
      key: "pending",
      label: "Pending",
      value: summary.pending,
      color: "#6b7280",
      bg: "rgba(107, 114, 128, 0.10)",
    },
    {
      key: "inProgress",
      label: "In Progress",
      value: summary.inProgress,
      color: "#16a34a",
      bg: "rgba(22, 163, 74, 0.10)",
    },
    {
      key: "blocked",
      label: "Blocked",
      value: summary.blocked,
      color: "#ef4444",
      bg: "rgba(239, 68, 68, 0.10)",
    },
    {
      key: "done",
      label: "Done",
      value: summary.done,
      color: "#2563eb",
      bg: "rgba(37, 99, 235, 0.10)",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {pills.map((p) => (
        <div
          key={p.key}
          className="rounded-lg border p-3 text-center"
          style={{
            backgroundColor: p.bg,
            borderColor: `${p.color}35`,
          }}
        >
          <div className="text-2xl font-bold" style={{ color: p.color }}>
            {p.value}
          </div>
          <div className="mt-0.5 text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
            {p.label}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── LogPanel ─────────────────────────────────────────────────────
//
// Connects to the SSE log/stream endpoint. Shows last 50 lines in a
// monospaced scrollable panel. Auto-scrolls to bottom; pauses when
// the user scrolls up and shows a "Resume" button.

function LogPanel({ projectId, backlogRoot }: { projectId: string; backlogRoot?: string }) {
  const [lines, setLines] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  // autoScroll drives the "Paused" UI; autoScrollRef is the sync value
  // used inside effects and event handlers to avoid stale closures.
  const [autoScroll, setAutoScroll] = useState(true);
  const autoScrollRef = useRef(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Connect to SSE endpoint. Re-connects when projectId changes.
  useEffect(() => {
    if (!projectId) return;

    const base = `/api/projects/${encodeURIComponent(projectId)}/log/stream`;
    const url = backlogRoot ? `${base}?backlog=${encodeURIComponent(backlogRoot)}` : base;
    const es = new EventSource(url);

    es.onopen = () => setConnected(true);

    es.onerror = () => setConnected(false);

    es.addEventListener("log", (e) => {
      try {
        const newLines = JSON.parse((e as MessageEvent<string>).data) as string[];
        if (!Array.isArray(newLines)) return;
        setLines((prev) => [...prev, ...newLines].slice(-50));
      } catch {
        // Ignore parse errors — malformed SSE data
      }
    });

    return () => {
      es.close();
      setConnected(false);
    };
  }, [projectId, backlogRoot]);

  // After lines state updates: scroll to bottom if autoScroll is active.
  useEffect(() => {
    if (autoScrollRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
    autoScrollRef.current = isAtBottom;
    setAutoScroll(isAtBottom);
  }

  function resumeAutoScroll() {
    autoScrollRef.current = true;
    setAutoScroll(true);
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }

  return (
    <div
      className="flex flex-col overflow-hidden rounded-lg border"
      style={{
        backgroundColor: "var(--color-surface-raised)",
        borderColor: "var(--color-border)",
      }}
    >
      {/* ── Panel header ────────────────────────────────────── */}
      <div
        className="flex flex-shrink-0 items-center justify-between border-b px-3 py-2"
        style={{
          borderColor: "var(--color-border)",
          backgroundColor: "var(--color-surface)",
        }}
      >
        <span
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-text-muted)" }}
        >
          Live Log
        </span>
        <div className="flex items-center gap-3">
          {/* Pause indicator + resume button */}
          {!autoScroll && (
            <button
              onClick={resumeAutoScroll}
              className="rounded px-2 py-0.5 text-xs font-medium"
              style={{
                backgroundColor: "rgba(202, 138, 4, 0.12)",
                color: "#ca8a04",
                border: "1px solid rgba(202, 138, 4, 0.25)",
              }}
            >
              ↓ Resume
            </button>
          )}
          {/* Connection indicator */}
          <span
            className="flex items-center gap-1.5 text-xs"
            style={{ color: connected ? "#16a34a" : "#9ca3af" }}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full bg-current ${connected ? "animate-pulse" : ""}`}
              aria-hidden="true"
            />
            {connected ? "live" : "connecting…"}
          </span>
        </div>
      </div>

      {/* ── Log lines ───────────────────────────────────────── */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="overflow-y-auto"
        style={{
          height: "360px",
          padding: "8px 12px",
          scrollbarWidth: "thin",
        }}
      >
        {lines.length === 0 ? (
          <p className="mt-1 text-xs italic" style={{ color: "var(--color-text-muted)" }}>
            {connected ? "Waiting for log output…" : "Connecting to log stream…"}
          </p>
        ) : (
          lines.map((line, i) => (
            <div
              key={i}
              className="whitespace-pre font-mono text-xs leading-relaxed"
              style={{ color: "var(--color-text)" }}
            >
              {line || "\u00a0"}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── EventTimeline ────────────────────────────────────────────────
//
// Connects to the file-backed SSE /loop/events endpoint (replay then
// tail) and renders the 24 structured LoopEvent types with minimal,
// readable labels. Mirrors LogPanel's EventSource lifecycle
// (connect / append / reconnect / cleanup). Phase-1 boundary: this maps
// EVENT TYPES to display strings only — it introduces no status
// vocabulary label-map, no status badges, and no recovery actions
// (those are Phase 4). See spec 05 §7 / §9.

// Maps each PersistedEvent to a short label + salient detail. The switch
// is exhaustive over the discriminated union — the `never`-typed default
// makes typecheck fail if a LoopEvent member is ever added without a
// branch here. An unknown future `type` (forward-stable envelope) still
// renders generically at runtime rather than crashing.
function describeEvent(e: PersistedEvent): { label: string; detail: string } {
  switch (e.type) {
    case "loop_started":
      return {
        label: "Loop started",
        detail: `max ${e.maxIterations} iterations${e.model ? ` · ${e.model}` : ""}`,
      };
    case "iteration_start":
      return { label: "Iteration", detail: `${e.iteration} / ${e.maxIterations}` };
    case "item_selected":
      return { label: "Item selected", detail: `#${e.itemId} · P${e.priority} — ${e.title}` };
    case "llm_spawned":
      return {
        label: "Agent spawned",
        detail: `#${e.itemId} · ${e.provider}${e.model ? ` ${e.model}` : ""}`,
      };
    case "llm_exited":
      return {
        label: "Agent exited",
        detail: `#${e.itemId} · exit ${e.exitCode}${e.timedOut ? " (timed out)" : ""} · ${Math.round(e.durationMs / 1000)}s`,
      };
    case "signal_parsed":
      return {
        label: "Signal",
        detail: `#${e.itemId} · ${e.signal}${e.reason ? ` — ${e.reason}` : ""}`,
      };
    case "item_completed":
      return { label: "Item completed", detail: `#${e.itemId} — ${e.title}` };
    case "item_blocked":
      return { label: "Item blocked", detail: `#${e.itemId} — ${e.reason}` };
    case "item_retried":
      return {
        label: "Item retried",
        detail: `#${e.itemId} · attempt ${e.attempt}/${e.maxRetries}`,
      };
    case "needs_human":
      return { label: "Needs human", detail: `#${e.itemId} — ${e.reason}` };
    case "loop_paused":
      return { label: "Loop paused", detail: `#${e.itemId} · ${e.reason}` };
    case "usage_limit_hit":
      return {
        label: "Usage limit hit",
        detail: `${e.limitType} · ${Math.round(e.utilization * 100)}%`,
      };
    case "usage_limit_cleared":
      return { label: "Usage limit cleared", detail: e.limitType };
    case "sleep_start":
      return { label: "Sleep", detail: `until ${e.sleepUntil} — ${e.reason}` };
    case "sleep_end":
      return { label: "Sleep ended", detail: "" };
    case "loop_completed":
      return {
        label: "Loop completed",
        detail: `${e.completedCount} done · ${e.blockedCount} blocked${
          e.needsHumanCount != null ? ` · ${e.needsHumanCount} needs human` : ""
        }`,
      };
    case "loop_error":
      return { label: "Loop error", detail: e.error };
    case "loop_cancelled":
      return { label: "Loop cancelled", detail: "" };
    case "review_started":
      return { label: "Review started", detail: `${e.completedItemIds.length} items` };
    case "review_completed":
      return { label: "Review completed", detail: `${e.itemsCreated} created — ${e.summary}` };
    case "review_failed":
      return { label: "Review failed", detail: e.reason };
    case "llm_tool_activity":
      return { label: "Tool", detail: `#${e.itemId} · ${e.toolName} (${e.phase})` };
    case "llm_token_update":
      return {
        label: "Tokens",
        detail: `#${e.itemId} · ${e.inputTokens} in / ${e.outputTokens} out`,
      };
    case "llm_stuck_warning":
      return {
        label: "Stuck warning",
        detail: `#${e.itemId} · silent ${Math.round(e.silentMs / 1000)}s`,
      };
    default:
      return describeUnknownEvent(e);
  }
}

// Exhaustiveness guard: `e` is `never` when every LoopEvent member above
// is handled. A forward/unknown event still renders by its raw `type`.
function describeUnknownEvent(e: never): { label: string; detail: string } {
  const fallback = e as { type?: unknown };
  return {
    label: typeof fallback.type === "string" ? fallback.type : "event",
    detail: "",
  };
}

function EventTimeline({ projectId, backlogRoot }: { projectId: string; backlogRoot?: string }) {
  const [events, setEvents] = useState<PersistedEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Connect to the file-backed SSE endpoint. Re-connects when projectId
  // or backlogRoot changes. The server replays the current run's history
  // then tails new events, all under the "loop_event" SSE event name.
  useEffect(() => {
    if (!projectId) return;

    const base = `/api/projects/${encodeURIComponent(projectId)}/loop/events`;
    const url = backlogRoot ? `${base}?backlog=${encodeURIComponent(backlogRoot)}` : base;
    const es = new EventSource(url);

    es.onopen = () => setConnected(true);

    es.onerror = () => setConnected(false);

    es.addEventListener("loop_event", (e) => {
      try {
        const record = JSON.parse((e as MessageEvent<string>).data) as PersistedEvent;
        if (typeof record?.type !== "string") return;
        // Bounded buffer, mirroring LogPanel's .slice(-50); arrival order = seq order.
        setEvents((prev) => [...prev, record].slice(-200));
      } catch {
        // Ignore parse errors — malformed SSE data
      }
    });

    return () => {
      es.close();
      setConnected(false);
    };
  }, [projectId, backlogRoot]);

  // Auto-scroll to the newest event after the list updates.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  return (
    <div
      className="flex flex-col overflow-hidden rounded-lg border"
      style={{
        backgroundColor: "var(--color-surface-raised)",
        borderColor: "var(--color-border)",
      }}
    >
      {/* ── Panel header ────────────────────────────────────── */}
      <div
        className="flex flex-shrink-0 items-center justify-between border-b px-3 py-2"
        style={{
          borderColor: "var(--color-border)",
          backgroundColor: "var(--color-surface)",
        }}
      >
        <span
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-text-muted)" }}
        >
          Event Timeline
        </span>
        <span
          className="flex items-center gap-1.5 text-xs"
          style={{ color: connected ? "#16a34a" : "#9ca3af" }}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full bg-current ${connected ? "animate-pulse" : ""}`}
            aria-hidden="true"
          />
          {connected ? "live" : "connecting…"}
        </span>
      </div>

      {/* ── Event rows ──────────────────────────────────────── */}
      <div
        ref={scrollRef}
        className="overflow-y-auto"
        style={{ height: "360px", padding: "8px 12px", scrollbarWidth: "thin" }}
      >
        {events.length === 0 ? (
          <p className="mt-1 text-xs italic" style={{ color: "var(--color-text-muted)" }}>
            {connected ? "Waiting for loop events…" : "Connecting to event stream…"}
          </p>
        ) : (
          events.map((event) => {
            const { label, detail } = describeEvent(event);
            const time = new Date(event.timestamp).toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            });
            return (
              <div
                key={event.seq}
                className="flex items-baseline gap-2 py-1 text-xs leading-relaxed"
                style={{ borderBottom: "1px solid var(--color-border)" }}
              >
                <span
                  className="flex-shrink-0 font-mono"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {time}
                </span>
                <span
                  className="flex-shrink-0 font-semibold"
                  style={{ color: "var(--color-text)" }}
                >
                  {label}
                </span>
                {detail && (
                  <span className="min-w-0 truncate" style={{ color: "var(--color-text-muted)" }}>
                    {detail}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── ProgressViewer ───────────────────────────────────────────────
//
// Fetches .rauf/progress.md and renders it as formatted markdown.
// Shows nothing when the file is missing (empty string response).

function ProgressViewer({ projectId, backlogRoot }: { projectId: string; backlogRoot?: string }) {
  const { data: markdown, isLoading } = useQuery({
    queryKey: ["projects", projectId, "progress", backlogRoot ?? null],
    queryFn: () =>
      raufFetchJson<string>(
        `/api/projects/${encodeURIComponent(projectId)}/progress` +
          (backlogRoot ? `?backlog=${encodeURIComponent(backlogRoot)}` : ""),
      ),
    enabled: !!projectId,
    // Refresh every 60s — progress.md changes less frequently than status
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div
        className="h-16 animate-pulse rounded-lg"
        style={{ backgroundColor: "var(--color-surface-raised)" }}
      />
    );
  }

  // API returns empty string when progress.md is missing — show nothing
  if (!markdown) return null;

  return (
    <div
      className="rounded-lg border p-5"
      style={{
        backgroundColor: "var(--color-surface-raised)",
        borderColor: "var(--color-border)",
      }}
    >
      <SectionHeading>Progress Notes</SectionHeading>
      <div className="rauf-prose">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      </div>
    </div>
  );
}

// ─── StatusView ───────────────────────────────────────────────────

export function StatusView() {
  const { id } = useParams({ strict: false });
  const queryClient = useQueryClient();
  const projectId = id ?? "";

  // Selected backlog root (REM-8). `undefined` = the project's default `.rauf`
  // root (fully backward-compatible: no query/body params are added). When a
  // non-default root is chosen, every read query, both live streams, and the
  // loop-control mutations are scoped to it — the whole page reflects one root.
  const [backlogRoot, setBacklogRoot] = useState<string | undefined>(undefined);
  const rootToken = backlogRoot ?? null;
  const backlogQs = backlogRoot ? `?backlog=${encodeURIComponent(backlogRoot)}` : "";
  // Body for mutations: include backlogRoot only when non-default.
  const mutationBody = backlogRoot ? { backlogRoot } : {};

  const { data: backlogRoots } = useQuery({
    queryKey: ["projects", projectId, "backlog-roots"],
    queryFn: () =>
      raufFetchJson<BacklogRootEntry[]>(
        `/api/projects/${encodeURIComponent(projectId)}/backlog-roots`,
      ),
    enabled: !!projectId,
  });

  const {
    data: status,
    isLoading: statusLoading,
    isError: statusError,
    isFetching,
  } = useQuery({
    queryKey: ["projects", projectId, "status", rootToken],
    queryFn: () =>
      raufFetchJson<DerivedStatus>(
        `/api/projects/${encodeURIComponent(projectId)}/status${backlogQs}`,
      ),
    enabled: !!projectId,
    // Refresh faster when the loop is actively running
    refetchInterval: (query) => (query.state.data?.loopState === "RUNNING" ? 10_000 : 30_000),
  });

  const { data: allItems } = useQuery({
    queryKey: ["projects", projectId, "backlog", rootToken],
    queryFn: () =>
      raufFetchJson<BacklogItem[]>(
        `/api/projects/${encodeURIComponent(projectId)}/backlog${backlogQs}`,
      ),
    enabled: !!projectId,
    refetchInterval: () => {
      // Align with status refresh rate
      const statusData = queryClient.getQueryData<DerivedStatus>([
        "projects",
        projectId,
        "status",
        rootToken,
      ]);
      return statusData?.loopState === "RUNNING" ? 10_000 : 30_000;
    },
  });

  // ── Loop control mutations ─────────────────────────────────────
  const [loopError, setLoopError] = useState<string | null>(null);

  const startMutation = useMutation({
    mutationFn: async () => {
      const res = await raufFetch(`/api/projects/${encodeURIComponent(projectId)}/loop/start`, {
        method: "POST",
        body: JSON.stringify(mutationBody),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg =
          (body as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }
    },
    onSuccess: () => {
      setLoopError(null);
      void queryClient.invalidateQueries({ queryKey: ["projects", projectId] });
    },
    onError: (err: Error) => {
      setLoopError(err.message);
    },
  });

  const stopMutation = useMutation({
    mutationFn: async () => {
      const res = await raufFetch(`/api/projects/${encodeURIComponent(projectId)}/loop/stop`, {
        method: "POST",
        body: JSON.stringify(mutationBody),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg =
          (body as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }
    },
    onSuccess: () => {
      setLoopError(null);
      void queryClient.invalidateQueries({ queryKey: ["projects", projectId] });
    },
    onError: (err: Error) => {
      setLoopError(err.message);
    },
  });

  // ── Recovery control state ─────────────────────────────────────
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<ValidateBacklogResult | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await raufFetch(`/api/projects/${encodeURIComponent(projectId)}/reset`, {
        method: "POST",
        body: JSON.stringify(mutationBody),
      });
      if (!res.ok) throw new Error(await recoveryErrorMessage(res));
      return ((await res.json()) as { data: ResetProjectResult }).data;
    },
    onSuccess: (data) => {
      setLoopError(null);
      setRecoveryMessage(
        `Reset complete — ${data.stalledResetCount} stalled reset` +
          (data.stateCleared ? ", state cleared" : ""),
      );
      void queryClient.invalidateQueries({ queryKey: ["projects", projectId] });
    },
    onError: (err: Error) => setLoopError(err.message),
  });

  const resumeMutation = useMutation({
    mutationFn: async () => {
      const res = await raufFetch(`/api/projects/${encodeURIComponent(projectId)}/resume`, {
        method: "POST",
        body: JSON.stringify(mutationBody),
      });
      if (!res.ok) throw new Error(await recoveryErrorMessage(res));
      return ((await res.json()) as { data: ResumeResultData }).data;
    },
    onSuccess: (data) => {
      setLoopError(null);
      setRecoveryMessage(
        data.relaunched
          ? "Resumed — loop relaunched"
          : `Reconciled — ${data.reason ?? "nothing to relaunch"}`,
      );
      void queryClient.invalidateQueries({ queryKey: ["projects", projectId] });
    },
    onError: (err: Error) => setLoopError(err.message),
  });

  const reviewMutation = useMutation({
    mutationFn: async () => {
      const res = await raufFetch(`/api/projects/${encodeURIComponent(projectId)}/loop/review`, {
        method: "POST",
        body: JSON.stringify(mutationBody),
      });
      if (!res.ok) throw new Error(await recoveryErrorMessage(res));
    },
    onSuccess: () => {
      setLoopError(null);
      setRecoveryMessage("Review pass started — watch the Event Timeline.");
      void queryClient.invalidateQueries({ queryKey: ["projects", projectId] });
    },
    onError: (err: Error) => setLoopError(err.message),
  });

  const unblockMutation = useMutation({
    mutationFn: async () => {
      const res = await raufFetch(
        `/api/projects/${encodeURIComponent(projectId)}/backlog/unblock`,
        { method: "POST", body: JSON.stringify(mutationBody) },
      );
      if (!res.ok) throw new Error(await recoveryErrorMessage(res));
      return ((await res.json()) as { data: { unblockedCount: number; unblockedIds: string[] } })
        .data;
    },
    onSuccess: (data) => {
      setLoopError(null);
      setRecoveryMessage(`Unblocked ${data.unblockedCount} item(s)`);
      void queryClient.invalidateQueries({ queryKey: ["projects", projectId] });
    },
    onError: (err: Error) => setLoopError(err.message),
  });

  const validateQuery = useQuery({
    queryKey: ["projects", projectId, "validate", rootToken],
    queryFn: () =>
      raufFetchJson<ValidateBacklogResult>(
        `/api/projects/${encodeURIComponent(projectId)}/backlog/validate${backlogQs}`,
      ),
    enabled: false, // fired by the "Validate" button via refetch()
  });

  useEffect(() => {
    if (validateQuery.data) setValidationResult(validateQuery.data);
  }, [validateQuery.data]);

  // Derive display data from backlog
  const currentItem = useMemo(() => {
    if (!allItems || !status?.currentItem) return null;
    return allItems.find((i) => i.id === status.currentItem) ?? null;
  }, [allItems, status?.currentItem]);

  const blockedItems = useMemo(
    () => (allItems ?? []).filter((i) => i.status === "blocked"),
    [allItems],
  );

  const recentlyCompleted = useMemo(() => {
    const done = (allItems ?? [])
      .filter((i) => i.status === "done" && i.completedAt)
      .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
    return done.slice(0, 5);
  }, [allItems]);

  function handleRefresh() {
    void queryClient.invalidateQueries({ queryKey: ["projects", projectId] });
  }

  // ── Loading ───────────────────────────────────────────────────

  if (statusLoading) {
    return (
      <div className="p-6">
        <div
          className="mb-6 h-10 w-40 animate-pulse rounded-lg"
          style={{ backgroundColor: "var(--color-surface-raised)" }}
        />
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-lg"
              style={{ backgroundColor: "var(--color-surface-raised)" }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (statusError || !status) {
    return (
      <div className="p-6">
        <div
          className="rounded-lg border p-4"
          style={{
            borderColor: "rgba(220, 38, 38, 0.3)",
            backgroundColor: "rgba(220, 38, 38, 0.05)",
            color: "#dc2626",
          }}
        >
          <p className="text-sm font-medium">Failed to load project status</p>
          <button onClick={handleRefresh} className="mt-2 text-xs font-medium underline">
            Try again
          </button>
        </div>
      </div>
    );
  }

  // ── Computed display values ───────────────────────────────────

  const sourceLabel =
    status.stateSource === "state.json"
      ? "via state.json"
      : status.stateSource === "log-parsing"
        ? "via log parsing"
        : "no data source";

  const elapsedDisplay =
    status.loopState === "RUNNING" && status.elapsed != null ? formatElapsed(status.elapsed) : null;

  return (
    <div className="p-6">
      {/* ── Page header ──────────────────────────────────────── */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: "var(--color-text)" }}>
            Status
          </h1>
          <p className="mt-0.5 font-mono text-sm" style={{ color: "var(--color-text-muted)" }}>
            {projectId}
          </p>
          {backlogRoots && backlogRoots.length > 1 && (
            <label className="mt-2 flex items-center gap-2 text-xs">
              <span style={{ color: "var(--color-text-muted)" }}>Backlog root</span>
              <select
                value={backlogRoot ?? backlogRoots.find((r) => r.isDefault)?.root ?? ".rauf"}
                onChange={(e) => {
                  const picked = backlogRoots.find((r) => r.root === e.target.value);
                  // Default root → undefined (no params; fully backward-compatible).
                  setBacklogRoot(picked?.isDefault ? undefined : e.target.value);
                }}
                className="rounded-md border px-2 py-1 font-mono text-xs"
                style={{
                  borderColor: "var(--color-border)",
                  backgroundColor: "var(--color-surface-raised)",
                  color: "var(--color-text)",
                }}
              >
                {backlogRoots.map((r) => (
                  <option key={r.root} value={r.root}>
                    {r.root}
                    {r.isDefault ? " (default)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={isFetching}
          className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-text-muted)",
            backgroundColor: "transparent",
          }}
        >
          {isFetching ? "↻ Refreshing…" : "↻ Refresh"}
        </button>
      </div>

      {/* ── Two-column layout: left = status info, right = log ── */}
      <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
        {/* ── Left column ─────────────────────────────────────── */}
        <div className="min-w-0 flex-1 space-y-6">
          {/* Loop state header */}
          <Card>
            <div className="flex flex-wrap items-center gap-4">
              {/* Prominent state badge */}
              <StateBadge state={status.loopState} size="block" />

              {/* Meta info column */}
              <div
                className="flex flex-col gap-1 text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                {/* Source indicator */}
                <span>
                  <span className="font-medium">Source:</span>{" "}
                  <span
                    className="rounded px-1 py-0.5 font-mono text-xs"
                    style={{
                      backgroundColor: "var(--color-surface)",
                      border: "1px solid var(--color-border)",
                      color: "var(--color-text)",
                    }}
                  >
                    {sourceLabel}
                  </span>
                </span>

                {/* Elapsed time when running */}
                {elapsedDisplay && (
                  <span>
                    <span className="font-medium">Elapsed:</span>{" "}
                    <span style={{ color: "#16a34a", fontWeight: 600 }}>{elapsedDisplay}</span>
                  </span>
                )}

                {/* Iteration progress when running */}
                {status.iteration != null && status.maxIterations != null && (
                  <span>
                    <span className="font-medium">Iteration:</span> {status.iteration} /{" "}
                    {status.maxIterations}
                  </span>
                )}

                {/* Started at */}
                {status.startedAt && (
                  <span>
                    <span className="font-medium">Started:</span>{" "}
                    {new Date(status.startedAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                )}

                {/* Last signal */}
                {status.lastSignal && (
                  <span>
                    <span className="font-medium">Last signal:</span>{" "}
                    <span
                      className="rounded px-1 py-0.5 font-mono text-xs"
                      style={{
                        backgroundColor: "var(--color-surface)",
                        border: "1px solid var(--color-border)",
                        color: "var(--color-text)",
                      }}
                    >
                      {status.lastSignal}
                    </span>
                  </span>
                )}
              </div>

              {/* Loop control buttons — pushed to the right */}
              <div className="ml-auto flex items-center gap-2">
                {STARTABLE_STATES.has(status.loopState) && (
                  <button
                    onClick={() => startMutation.mutate()}
                    disabled={startMutation.isPending}
                    className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                    style={{
                      backgroundColor: "rgba(22, 163, 74, 0.12)",
                      borderColor: "rgba(22, 163, 74, 0.35)",
                      color: "#16a34a",
                    }}
                  >
                    {startMutation.isPending ? "Starting…" : "Start Loop"}
                  </button>
                )}
                {STOPPABLE_STATES.has(status.loopState) && (
                  <button
                    onClick={() => stopMutation.mutate()}
                    disabled={stopMutation.isPending}
                    className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                    style={{
                      backgroundColor: "rgba(220, 38, 38, 0.12)",
                      borderColor: "rgba(220, 38, 38, 0.35)",
                      color: "#dc2626",
                    }}
                  >
                    {stopMutation.isPending ? "Stopping…" : "Stop Loop"}
                  </button>
                )}
              </div>
            </div>

            {/* Error message for loop control failures */}
            {loopError && (
              <div
                className="mt-3 flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                style={{
                  backgroundColor: "rgba(220, 38, 38, 0.05)",
                  borderColor: "rgba(220, 38, 38, 0.3)",
                  color: "#dc2626",
                }}
              >
                <span>{loopError}</span>
                <button
                  onClick={() => setLoopError(null)}
                  className="ml-3 flex-shrink-0 text-xs font-medium underline"
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* Recovery message banner (mirrors loopError, info tone) */}
            {recoveryMessage && (
              <div
                className="mt-3 flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                style={{
                  backgroundColor: "rgba(37, 99, 235, 0.06)",
                  borderColor: "rgba(37, 99, 235, 0.3)",
                  color: "#2563eb",
                }}
              >
                <span>{recoveryMessage}</span>
                <button
                  onClick={() => setRecoveryMessage(null)}
                  className="ml-3 flex-shrink-0 text-xs font-medium underline"
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* ── Recovery control group (spec 04 §8) ───────────── */}
            <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
              <p
                className="mb-2 text-xs font-semibold uppercase tracking-wider"
                style={{ color: "var(--color-text-muted)" }}
              >
                Recovery
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {confirmReset ? (
                  <span className="flex items-center gap-2 text-xs" style={{ color: "#dc2626" }}>
                    This clears loop state. Continue?
                    <button
                      onClick={() => {
                        setConfirmReset(false);
                        resetMutation.mutate();
                      }}
                      disabled={resetMutation.isPending}
                      className="rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                      style={{
                        backgroundColor: "rgba(220, 38, 38, 0.12)",
                        borderColor: "rgba(220, 38, 38, 0.35)",
                        color: "#dc2626",
                      }}
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmReset(false)}
                      className="rounded-md border px-2.5 py-1 text-xs font-medium"
                      style={{
                        borderColor: "var(--color-border)",
                        color: "var(--color-text-muted)",
                      }}
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <RecoveryButton
                    label={resetMutation.isPending ? "Resetting…" : "Reset"}
                    onClick={() => setConfirmReset(true)}
                    disabled={resetMutation.isPending}
                  />
                )}

                <RecoveryButton
                  label={resumeMutation.isPending ? "Resuming…" : "Resume"}
                  onClick={() => resumeMutation.mutate()}
                  disabled={
                    resumeMutation.isPending ||
                    !RESUMABLE_STATES.has(status.loopState) ||
                    status.backlogSummary.total - status.backlogSummary.done <= 0
                  }
                />

                <RecoveryButton
                  label={reviewMutation.isPending ? "Starting…" : "Review"}
                  onClick={() => reviewMutation.mutate()}
                  disabled={
                    reviewMutation.isPending || REVIEW_BLOCKING_STATES.has(status.loopState)
                  }
                />

                <RecoveryButton
                  label={unblockMutation.isPending ? "Unblocking…" : "Unblock"}
                  onClick={() => unblockMutation.mutate()}
                  disabled={unblockMutation.isPending || status.backlogSummary.blocked <= 0}
                />

                <RecoveryButton
                  label={validateQuery.isFetching ? "Validating…" : "Validate"}
                  onClick={() => void validateQuery.refetch()}
                  disabled={validateQuery.isFetching}
                />
              </div>

              {/* Validation result */}
              {validationResult && (
                <div className="mt-3">
                  {validationResult.valid ? (
                    <p
                      className="rounded-md border px-3 py-2 text-sm"
                      style={{
                        backgroundColor: "rgba(22, 163, 74, 0.06)",
                        borderColor: "rgba(22, 163, 74, 0.3)",
                        color: "#16a34a",
                      }}
                    >
                      Backlog is valid
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {validationResult.findings.map((f, i) => (
                        <li
                          key={i}
                          className="rounded-md border px-3 py-1.5 text-xs"
                          style={{
                            backgroundColor:
                              f.severity === "error"
                                ? "rgba(239, 68, 68, 0.06)"
                                : "rgba(202, 138, 4, 0.06)",
                            borderColor:
                              f.severity === "error"
                                ? "rgba(239, 68, 68, 0.3)"
                                : "rgba(202, 138, 4, 0.3)",
                            color: f.severity === "error" ? "#ef4444" : "#ca8a04",
                          }}
                        >
                          <span className="font-mono font-semibold">{f.code}</span>
                          {f.itemId && <span className="ml-1.5">#{f.itemId}</span>}
                          <span className="ml-1.5">— {f.message}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </Card>

          {/* Backlog summary */}
          <div>
            <SectionHeading>Backlog Summary</SectionHeading>
            <BacklogSummaryGrid summary={status.backlogSummary} />
            <p className="mt-2 text-right text-xs" style={{ color: "var(--color-text-muted)" }}>
              {status.backlogSummary.total} items total
            </p>
          </div>

          {/* In-progress item */}
          {(currentItem || (status.currentItem && !currentItem)) && (
            <div>
              <SectionHeading>Current Item</SectionHeading>
              {currentItem ? (
                <CurrentItemCard item={currentItem} />
              ) : (
                <Card>
                  <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                    Item <span className="font-mono">#{status.currentItem}</span> loading…
                  </p>
                </Card>
              )}
            </div>
          )}

          {/* Blocked items */}
          {blockedItems.length > 0 && (
            <div>
              <SectionHeading>
                Blocked Items{" "}
                <span
                  className="ml-1 rounded-full px-2 py-0.5 font-mono text-xs font-bold"
                  style={{ backgroundColor: "rgba(239, 68, 68, 0.12)", color: "#ef4444" }}
                >
                  {blockedItems.length}
                </span>
              </SectionHeading>
              <div className="space-y-3">
                {blockedItems.map((item) => (
                  <BlockedItemCard key={item.id} item={item} />
                ))}
              </div>
            </div>
          )}

          {/* Recently completed */}
          {recentlyCompleted.length > 0 && (
            <div>
              <SectionHeading>Recently Completed</SectionHeading>
              <div
                className="rounded-lg border"
                style={{
                  backgroundColor: "var(--color-surface-raised)",
                  borderColor: "var(--color-border)",
                }}
              >
                <div className="px-4">
                  {recentlyCompleted.map((item, i) => (
                    <div
                      key={item.id}
                      style={{
                        borderBottom:
                          i < recentlyCompleted.length - 1
                            ? "1px solid var(--color-border)"
                            : "none",
                      }}
                    >
                      <CompletedItemRow item={item} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Empty state when not installed / no data */}
          {status.loopState === "NOT_INSTALLED" && (
            <div
              className="flex flex-col items-center justify-center rounded-lg border py-12 text-center"
              style={{
                borderColor: "var(--color-border)",
                backgroundColor: "var(--color-surface-raised)",
                color: "var(--color-text-muted)",
              }}
            >
              <p className="text-base font-medium">Rauf is not installed in this project</p>
              <p className="mt-1 text-sm">
                Use the <span className="font-mono text-xs">rauf install</span> command or the
                Install wizard to get started.
              </p>
            </div>
          )}
        </div>
        {/* end left column */}

        {/* ── Right column: live log panel ─────────────────────── */}
        <div className="w-full space-y-6 xl:w-96 xl:flex-shrink-0 2xl:w-[480px]">
          <div>
            <SectionHeading>Live Log</SectionHeading>
            <LogPanel projectId={projectId} backlogRoot={backlogRoot} />
          </div>
          <div>
            <SectionHeading>Event Timeline</SectionHeading>
            <EventTimeline projectId={projectId} backlogRoot={backlogRoot} />
          </div>
        </div>
      </div>
      {/* end two-column layout */}

      {/* ── Progress notes (full-width below) ────────────────── */}
      {!!projectId && (
        <div className="mt-6">
          <ProgressViewer projectId={projectId} backlogRoot={backlogRoot} />
        </div>
      )}
    </div>
  );
}
