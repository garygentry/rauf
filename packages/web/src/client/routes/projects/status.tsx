import { useState, useEffect, useRef, useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { BacklogItem, DerivedStatus } from "@rauf/core";
import { raufFetch, raufFetchJson } from "../../lib/fetch";

// ─── Loop state badge config ──────────────────────────────────────

interface StateBadgeConfig {
  label: string;
  bgColor: string;
  textColor: string;
  borderColor: string;
}

const STATE_BADGE: Record<string, StateBadgeConfig> = {
  IDLE: {
    label: "IDLE",
    bgColor: "rgba(107, 114, 128, 0.10)",
    textColor: "#6b7280",
    borderColor: "rgba(107, 114, 128, 0.25)",
  },
  RUNNING: {
    label: "RUNNING",
    bgColor: "rgba(22, 163, 74, 0.12)",
    textColor: "#16a34a",
    borderColor: "rgba(22, 163, 74, 0.35)",
  },
  PAUSED: {
    label: "PAUSED",
    bgColor: "rgba(202, 138, 4, 0.12)",
    textColor: "#ca8a04",
    borderColor: "rgba(202, 138, 4, 0.35)",
  },
  COMPLETE: {
    label: "COMPLETE",
    bgColor: "rgba(37, 99, 235, 0.12)",
    textColor: "#2563eb",
    borderColor: "rgba(37, 99, 235, 0.35)",
  },
  PAUSED_HUMAN: {
    label: "NEEDS HUMAN",
    bgColor: "rgba(234, 88, 12, 0.12)",
    textColor: "#ea580c",
    borderColor: "rgba(234, 88, 12, 0.35)",
  },
  LIMIT_REACHED: {
    label: "LIMIT REACHED",
    bgColor: "rgba(220, 38, 38, 0.12)",
    textColor: "#dc2626",
    borderColor: "rgba(220, 38, 38, 0.35)",
  },
  ERROR: {
    label: "ERROR",
    bgColor: "rgba(220, 38, 38, 0.12)",
    textColor: "#dc2626",
    borderColor: "rgba(220, 38, 38, 0.35)",
  },
  NOT_INSTALLED: {
    label: "NOT INSTALLED",
    bgColor: "rgba(107, 114, 128, 0.08)",
    textColor: "#9ca3af",
    borderColor: "rgba(107, 114, 128, 0.2)",
  },
};

// ─── Loop control state sets ──────────────────────────────────────

const STARTABLE_STATES = new Set(["IDLE", "PAUSED", "COMPLETE", "ERROR"]);
const STOPPABLE_STATES = new Set(["RUNNING", "SLEEPING_LIMIT"]);

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

function LoopStateBadge({ loopState }: { loopState: string }) {
  const cfg = STATE_BADGE[loopState] ?? STATE_BADGE["IDLE"]!;
  return (
    <span
      className="inline-flex items-center gap-2 rounded-lg border px-4 py-1.5 font-mono text-base font-bold tracking-wide"
      style={{
        backgroundColor: cfg.bgColor,
        color: cfg.textColor,
        borderColor: cfg.borderColor,
      }}
    >
      {loopState === "RUNNING" && (
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-current" aria-hidden="true" />
      )}
      {cfg.label}
    </span>
  );
}

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

function LogPanel({ projectId }: { projectId: string }) {
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

    const url = `/api/projects/${encodeURIComponent(projectId)}/log/stream`;
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
  }, [projectId]);

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

// ─── ProgressViewer ───────────────────────────────────────────────
//
// Fetches .rauf/progress.md and renders it as formatted markdown.
// Shows nothing when the file is missing (empty string response).

function ProgressViewer({ projectId }: { projectId: string }) {
  const { data: markdown, isLoading } = useQuery({
    queryKey: ["projects", projectId, "progress"],
    queryFn: () => raufFetchJson<string>(`/api/projects/${encodeURIComponent(projectId)}/progress`),
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

  const {
    data: status,
    isLoading: statusLoading,
    isError: statusError,
    isFetching,
  } = useQuery({
    queryKey: ["projects", projectId, "status"],
    queryFn: () =>
      raufFetchJson<DerivedStatus>(`/api/projects/${encodeURIComponent(projectId)}/status`),
    enabled: !!projectId,
    // Refresh faster when the loop is actively running
    refetchInterval: (query) => (query.state.data?.loopState === "RUNNING" ? 10_000 : 30_000),
  });

  const { data: allItems } = useQuery({
    queryKey: ["projects", projectId, "backlog"],
    queryFn: () =>
      raufFetchJson<BacklogItem[]>(`/api/projects/${encodeURIComponent(projectId)}/backlog`),
    enabled: !!projectId,
    refetchInterval: () => {
      // Align with status refresh rate
      const statusData = queryClient.getQueryData<DerivedStatus>(["projects", projectId, "status"]);
      return statusData?.loopState === "RUNNING" ? 10_000 : 30_000;
    },
  });

  // ── Loop control mutations ─────────────────────────────────────
  const [loopError, setLoopError] = useState<string | null>(null);

  const startMutation = useMutation({
    mutationFn: async () => {
      const res = await raufFetch(`/api/projects/${encodeURIComponent(projectId)}/loop/start`, {
        method: "POST",
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
              <LoopStateBadge loopState={status.loopState} />

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
        <div className="w-full xl:w-96 xl:flex-shrink-0 2xl:w-[480px]">
          <SectionHeading>Live Log</SectionHeading>
          <LogPanel projectId={projectId} />
        </div>
      </div>
      {/* end two-column layout */}

      {/* ── Progress notes (full-width below) ────────────────── */}
      {!!projectId && (
        <div className="mt-6">
          <ProgressViewer projectId={projectId} />
        </div>
      )}
    </div>
  );
}
