import { useState, useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { BacklogItem, DerivedStatus } from "@ralph/core";
import { ralphFetchJson } from "../../lib/fetch";

// ─── Config maps ──────────────────────────────────────────────────

const TYPE_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  feature: { label: "Feature", bg: "rgba(59, 130, 246, 0.12)", text: "#3b82f6" },
  bug: { label: "Bug", bg: "rgba(239, 68, 68, 0.12)", text: "#ef4444" },
  chore: { label: "Chore", bg: "rgba(107, 114, 128, 0.12)", text: "#6b7280" },
  refactor: { label: "Refactor", bg: "rgba(139, 92, 246, 0.12)", text: "#8b5cf6" },
};

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  pending: { label: "Pending", bg: "rgba(107, 114, 128, 0.12)", text: "#6b7280" },
  in_progress: { label: "In Progress", bg: "rgba(22, 163, 74, 0.15)", text: "#16a34a" },
  blocked: { label: "Blocked", bg: "rgba(239, 68, 68, 0.12)", text: "#ef4444" },
  done: { label: "Done", bg: "rgba(37, 99, 235, 0.15)", text: "#2563eb" },
};

const PRIORITY_CONFIG: Record<number, { label: string; bg: string; text: string }> = {
  1: { label: "P1", bg: "rgba(239, 68, 68, 0.12)", text: "#ef4444" },
  2: { label: "P2", bg: "rgba(234, 88, 12, 0.12)", text: "#ea580c" },
  3: { label: "P3", bg: "rgba(202, 138, 4, 0.12)", text: "#ca8a04" },
  4: { label: "P4", bg: "rgba(107, 114, 128, 0.12)", text: "#6b7280" },
};

// in_progress items surface first, done items sink to the bottom
const STATUS_SORT_ORDER: Record<string, number> = {
  in_progress: 0,
  blocked: 1,
  pending: 2,
  done: 3,
};

// ─── Small reusable badges ─────────────────────────────────────────

function TypeBadge({ type }: { type: string }) {
  const cfg = TYPE_CONFIG[type] ?? { label: type, bg: "rgba(107, 114, 128, 0.12)", text: "#6b7280" };
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: cfg.bg, color: cfg.text }}
    >
      {cfg.label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, bg: "rgba(107, 114, 128, 0.12)", text: "#6b7280" };
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: cfg.bg, color: cfg.text }}
    >
      {status === "in_progress" && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden="true" />
      )}
      {cfg.label}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: number }) {
  const cfg = PRIORITY_CONFIG[priority] ?? {
    label: `P${priority}`,
    bg: "rgba(107, 114, 128, 0.12)",
    text: "#6b7280",
  };
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 font-mono text-xs font-medium"
      style={{ backgroundColor: cfg.bg, color: cfg.text }}
    >
      {cfg.label}
    </span>
  );
}

// ─── FilterSelect ─────────────────────────────────────────────────

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border px-2 py-1.5 text-xs"
      style={{
        borderColor: "var(--color-border)",
        backgroundColor: "var(--color-surface)",
        color: "var(--color-text)",
        outline: "none",
      }}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

// ─── SummaryBar ───────────────────────────────────────────────────
//
// Clickable summary counts. Clicking a pill toggles status filter.

function SummaryBar({
  summary,
  activeStatusFilter,
  onFilter,
}: {
  summary: DerivedStatus["backlogSummary"];
  activeStatusFilter: string;
  onFilter: (status: string) => void;
}) {
  const pills = [
    { key: "pending", label: "Pending", value: summary.pending, color: "#6b7280" },
    { key: "in_progress", label: "In Progress", value: summary.inProgress, color: "#16a34a" },
    { key: "blocked", label: "Blocked", value: summary.blocked, color: "#ef4444" },
    { key: "done", label: "Done", value: summary.done, color: "#2563eb" },
  ];

  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-1 rounded-lg border p-2"
      style={{
        borderColor: "var(--color-border)",
        backgroundColor: "var(--color-surface-raised)",
      }}
    >
      {pills.map((p) => {
        const isActive = activeStatusFilter === p.key;
        return (
          <button
            key={p.key}
            onClick={() => onFilter(isActive ? "all" : p.key)}
            className="flex items-center gap-1.5 rounded px-2.5 py-1 text-sm transition-colors"
            style={{
              backgroundColor: isActive ? `${p.color}18` : "transparent",
              color: isActive ? p.color : "var(--color-text-muted)",
              fontWeight: isActive ? 600 : 400,
            }}
            title={`Filter by ${p.label.toLowerCase()}`}
          >
            <span style={{ color: p.color, fontWeight: 700 }}>{p.value}</span>
            <span>{p.label}</span>
          </button>
        );
      })}
      <div className="ml-auto pr-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
        {summary.total} total
      </div>
    </div>
  );
}

// ─── LoopWarningBanner ────────────────────────────────────────────

function LoopWarningBanner({ status }: { status: DerivedStatus }) {
  if (status.loopState !== "RUNNING") return null;
  return (
    <div
      className="mb-4 flex items-center gap-2 rounded-lg border p-3 text-sm"
      style={{
        borderColor: "rgba(22, 163, 74, 0.35)",
        backgroundColor: "rgba(22, 163, 74, 0.06)",
        color: "#16a34a",
      }}
    >
      <span
        className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-current"
        aria-hidden="true"
      />
      <span className="font-medium">Loop is running</span>
      {status.currentItem && (
        <span style={{ opacity: 0.8 }}>
          · working on{" "}
          <span className="rounded bg-current/10 px-1 font-mono">#{status.currentItem}</span>
          {status.iteration != null && status.maxIterations != null && (
            <span className="ml-1 opacity-70">
              (iteration {status.iteration}/{status.maxIterations})
            </span>
          )}
        </span>
      )}
    </div>
  );
}

// ─── DependencyIndicator ──────────────────────────────────────────
//
// Shows a dep's ID coloured by its status, with a small symbol.

function DependencyIndicator({
  depId,
  itemsById,
}: {
  depId: string;
  itemsById: Map<string, BacklogItem>;
}) {
  const dep = itemsById.get(depId);

  if (!dep) {
    return (
      <span
        className="inline-flex items-center rounded px-1 py-0.5 font-mono text-xs"
        style={{
          backgroundColor: "rgba(107, 114, 128, 0.08)",
          color: "var(--color-text-muted)",
        }}
        title={`Dependency #${depId} not found`}
      >
        #{depId}
      </span>
    );
  }

  const cfg = STATUS_CONFIG[dep.status] ?? STATUS_CONFIG["pending"]!;
  const symbol =
    dep.status === "done"
      ? "✓"
      : dep.status === "blocked"
        ? "!"
        : dep.status === "in_progress"
          ? "…"
          : null;

  return (
    <span
      className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 font-mono text-xs"
      style={{ backgroundColor: `${cfg.text}18`, color: cfg.text }}
      title={`#${dep.id} — ${dep.title} (${cfg.label})`}
    >
      #{dep.id}
      {symbol && <span className="opacity-80">{symbol}</span>}
    </span>
  );
}

// ─── BacklogItemCard ──────────────────────────────────────────────

function BacklogItemCard({
  item,
  itemsById,
  isCurrentItem,
}: {
  item: BacklogItem;
  itemsById: Map<string, BacklogItem>;
  isCurrentItem: boolean;
}) {
  const hasDeps = item.dependsOn && item.dependsOn.length > 0;
  const acCount = item.acceptanceCriteria.length;

  return (
    <div
      className="flex flex-col rounded-lg border p-4 transition-shadow hover:shadow-sm"
      style={{
        backgroundColor: "var(--color-surface-raised)",
        borderColor: isCurrentItem ? "rgba(22, 163, 74, 0.45)" : "var(--color-border)",
        outline: isCurrentItem ? "1px solid rgba(22, 163, 74, 0.2)" : "none",
      }}
    >
      {/* Header row: ID + type + priority + status */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span
          className="font-mono text-xs font-semibold"
          style={{ color: "var(--color-text-muted)" }}
        >
          #{item.id}
        </span>
        <TypeBadge type={item.type} />
        <PriorityBadge priority={item.priority} />
        <div className="ml-auto">
          <StatusBadge status={item.status} />
        </div>
      </div>

      {/* Title */}
      <p className="text-sm font-medium leading-snug" style={{ color: "var(--color-text)" }}>
        {item.title}
      </p>

      {/* Blocked reason */}
      {item.status === "blocked" && item.blockedReason && (
        <p
          className="mt-1.5 rounded px-2 py-1 text-xs"
          style={{
            backgroundColor: "rgba(239, 68, 68, 0.08)",
            color: "#ef4444",
          }}
        >
          {item.blockedReason}
        </p>
      )}

      {/* Footer: AC count + deps */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          {acCount} {acCount === 1 ? "criterion" : "criteria"}
        </span>

        {hasDeps && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              Depends on:
            </span>
            {item.dependsOn!.map((depId) => (
              <DependencyIndicator key={depId} depId={depId} itemsById={itemsById} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── BacklogView ──────────────────────────────────────────────────

export function BacklogView() {
  const { id } = useParams({ strict: false });
  const queryClient = useQueryClient();

  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [sortBy, setSortBy] = useState("priority");

  const projectId = id ?? "";

  const {
    data: allItems,
    isLoading,
    isError,
    error,
    isFetching,
  } = useQuery({
    queryKey: ["projects", projectId, "backlog"],
    queryFn: () =>
      ralphFetchJson<BacklogItem[]>(
        `/api/projects/${encodeURIComponent(projectId)}/backlog`,
      ),
    enabled: !!projectId,
    refetchInterval: 30_000,
  });

  const { data: status } = useQuery({
    queryKey: ["projects", projectId, "status"],
    queryFn: () =>
      ralphFetchJson<DerivedStatus>(
        `/api/projects/${encodeURIComponent(projectId)}/status`,
      ),
    enabled: !!projectId,
    refetchInterval: 30_000,
  });

  // Build a fast lookup map for dependency resolution
  const itemsById = useMemo(() => {
    const map = new Map<string, BacklogItem>();
    allItems?.forEach((item) => map.set(item.id, item));
    return map;
  }, [allItems]);

  // Apply client-side filters and sort
  const filteredItems = useMemo(() => {
    let items = allItems ?? [];

    if (typeFilter !== "all") {
      items = items.filter((i) => i.type === typeFilter);
    }
    if (statusFilter !== "all") {
      items = items.filter((i) => i.status === statusFilter);
    }
    if (priorityFilter !== "all") {
      items = items.filter((i) => String(i.priority) === priorityFilter);
    }

    return [...items].sort((a, b) => {
      if (sortBy === "id") return a.id.localeCompare(b.id);
      if (sortBy === "status") {
        const ao = STATUS_SORT_ORDER[a.status] ?? 99;
        const bo = STATUS_SORT_ORDER[b.status] ?? 99;
        if (ao !== bo) return ao - bo;
        return a.priority - b.priority;
      }
      // default: priority (ascending = P1 first), then id as tiebreaker
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.id.localeCompare(b.id);
    });
  }, [allItems, typeFilter, statusFilter, priorityFilter, sortBy]);

  const summary = status?.backlogSummary ?? {
    pending: 0,
    inProgress: 0,
    blocked: 0,
    done: 0,
    total: 0,
  };
  const currentItemId = status?.currentItem ?? null;

  function handleRefresh() {
    void queryClient.invalidateQueries({ queryKey: ["projects", projectId] });
  }

  function clearFilters() {
    setTypeFilter("all");
    setStatusFilter("all");
    setPriorityFilter("all");
  }

  const hasActiveFilters =
    typeFilter !== "all" || statusFilter !== "all" || priorityFilter !== "all";

  return (
    <div className="p-6">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: "var(--color-text)" }}>
            Backlog
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

      {/* ── Active loop warning banner ──────────────────────── */}
      {status && <LoopWarningBanner status={status} />}

      {/* ── Summary counts ─────────────────────────────────── */}
      {!isLoading && !isError && (
        <SummaryBar
          summary={summary}
          activeStatusFilter={statusFilter}
          onFilter={setStatusFilter}
        />
      )}

      {/* ── Filter & sort bar ──────────────────────────────── */}
      <div
        className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border p-2.5"
        style={{
          borderColor: "var(--color-border)",
          backgroundColor: "var(--color-surface-raised)",
        }}
      >
        <span className="mr-0.5 text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
          Filter:
        </span>
        <FilterSelect
          value={typeFilter}
          onChange={setTypeFilter}
          options={[
            { value: "all", label: "All types" },
            { value: "feature", label: "Feature" },
            { value: "bug", label: "Bug" },
            { value: "chore", label: "Chore" },
            { value: "refactor", label: "Refactor" },
          ]}
        />
        <FilterSelect
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "all", label: "All statuses" },
            { value: "pending", label: "Pending" },
            { value: "in_progress", label: "In Progress" },
            { value: "blocked", label: "Blocked" },
            { value: "done", label: "Done" },
          ]}
        />
        <FilterSelect
          value={priorityFilter}
          onChange={setPriorityFilter}
          options={[
            { value: "all", label: "All priorities" },
            { value: "1", label: "P1 — Critical" },
            { value: "2", label: "P2 — High" },
            { value: "3", label: "P3 — Normal" },
            { value: "4", label: "P4 — Low" },
          ]}
        />
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="text-xs underline"
            style={{ color: "var(--color-text-muted)" }}
          >
            Clear
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
            Sort:
          </span>
          <FilterSelect
            value={sortBy}
            onChange={setSortBy}
            options={[
              { value: "priority", label: "Priority" },
              { value: "id", label: "ID" },
              { value: "status", label: "Status" },
            ]}
          />
        </div>
      </div>

      {/* ── Loading skeleton ────────────────────────────────── */}
      {isLoading && (
        <div className="grid gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-lg"
              style={{ backgroundColor: "var(--color-surface-raised)" }}
            />
          ))}
        </div>
      )}

      {/* ── Error ──────────────────────────────────────────── */}
      {isError && (
        <div
          className="rounded-lg border p-4"
          style={{
            borderColor: "rgba(220, 38, 38, 0.3)",
            backgroundColor: "rgba(220, 38, 38, 0.05)",
            color: "#dc2626",
          }}
        >
          <p className="text-sm font-medium">Failed to load backlog</p>
          <p className="mt-1 text-xs" style={{ opacity: 0.8 }}>
            {error instanceof Error ? error.message : "Unknown error"}
          </p>
          <button onClick={handleRefresh} className="mt-2 text-xs font-medium underline">
            Try again
          </button>
        </div>
      )}

      {/* ── Items list ─────────────────────────────────────── */}
      {!isLoading && !isError && (
        <>
          {filteredItems.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center py-12 text-center"
              style={{ color: "var(--color-text-muted)" }}
            >
              <p className="text-base">
                {hasActiveFilters
                  ? "No items match the active filters"
                  : "No backlog items yet"}
              </p>
              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="mt-2 text-sm underline"
                  style={{ color: "var(--color-accent)" }}
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <>
              <p className="mb-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
                {filteredItems.length === (allItems?.length ?? 0)
                  ? `${filteredItems.length} items`
                  : `${filteredItems.length} of ${allItems?.length ?? 0} items`}
              </p>
              <div className="grid gap-3">
                {filteredItems.map((item) => (
                  <BacklogItemCard
                    key={item.id}
                    item={item}
                    itemsById={itemsById}
                    isCurrentItem={item.id === currentItemId}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
