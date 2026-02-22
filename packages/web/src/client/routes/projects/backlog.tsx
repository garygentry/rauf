import { useState, useEffect, useMemo } from "react";
import { useParams, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  BacklogItem,
  BacklogItemStatus,
  BacklogItemType,
  DerivedStatus,
  SweepResult,
} from "@ralph/core";
import { ralphFetch, ralphFetchJson } from "../../lib/fetch";

// Mirrors VALID_STATUS_TRANSITIONS from @ralph/core/schemas — inlined to avoid
// bundling Node.js modules into the browser bundle (core imports node:fs etc.)
const VALID_STATUS_TRANSITIONS: Record<BacklogItemStatus, BacklogItemStatus[]> = {
  pending: ["in_progress", "blocked"],
  in_progress: ["done", "blocked", "pending"],
  blocked: ["pending"],
  done: ["pending"],
};

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
  const cfg = TYPE_CONFIG[type] ?? {
    label: type,
    bg: "rgba(107, 114, 128, 0.12)",
    text: "#6b7280",
  };
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
  const cfg = STATUS_CONFIG[status] ?? {
    label: status,
    bg: "rgba(107, 114, 128, 0.12)",
    text: "#6b7280",
  };
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
  onClick,
}: {
  item: BacklogItem;
  itemsById: Map<string, BacklogItem>;
  isCurrentItem: boolean;
  onClick: () => void;
}) {
  const hasDeps = item.dependsOn && item.dependsOn.length > 0;
  const acCount = item.acceptanceCriteria.length;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="flex cursor-pointer flex-col rounded-lg border p-4 transition-shadow hover:shadow-sm"
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

// ─── BacklogPanel ─────────────────────────────────────────────────
//
// Slide-in side panel for creating and editing backlog items.
// - Create mode: opens blank form; server injects smart default criterion if AC is empty.
// - Edit mode: pre-populates all fields; enforces valid status transitions.

type PanelMode = "create" | "edit";

interface BacklogPanelProps {
  mode: PanelMode;
  item?: BacklogItem;
  projectId: string;
  allItems: BacklogItem[];
  onClose: () => void;
}

function BacklogPanel({ mode, item, projectId, allItems, onClose }: BacklogPanelProps) {
  const queryClient = useQueryClient();

  // ── Form state ─────────────────────────────────────────────────
  const [title, setTitle] = useState(item?.title ?? "");
  const [type, setType] = useState<BacklogItemType>(item?.type ?? "feature");
  const [priority, setPriority] = useState<1 | 2 | 3 | 4>(item?.priority ?? 2);
  const [description, setDescription] = useState(item?.description ?? "");
  const [criteria, setCriteria] = useState<string[]>(item?.acceptanceCriteria ?? []);
  const [newCriterion, setNewCriterion] = useState("");
  const [dependsOn, setDependsOn] = useState<string[]>(item?.dependsOn ?? []);
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [status, setStatus] = useState<BacklogItemStatus>(item?.status ?? "pending");
  const [blockedReason, setBlockedReason] = useState(item?.blockedReason ?? "");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Auto-reset the delete confirmation after 3 seconds
  useEffect(() => {
    if (!deleteConfirm) return;
    const t = setTimeout(() => setDeleteConfirm(false), 3000);
    return () => clearTimeout(t);
  }, [deleteConfirm]);

  // ── Mutations ──────────────────────────────────────────────────

  function invalidateBacklog() {
    void queryClient.invalidateQueries({ queryKey: ["projects", projectId, "backlog"] });
  }

  const createMutation = useMutation({
    mutationFn: async (data: unknown) => {
      const res = await ralphFetch(`/api/projects/${encodeURIComponent(projectId)}/backlog`, {
        method: "POST",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg =
          (body as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }
      return res.json() as Promise<unknown>;
    },
    onSuccess: () => {
      invalidateBacklog();
      onClose();
    },
    onError: (err) => {
      setSubmitError(err instanceof Error ? err.message : "Failed to create item");
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: unknown) => {
      const res = await ralphFetch(
        `/api/projects/${encodeURIComponent(projectId)}/backlog/${item!.id}`,
        { method: "PUT", body: JSON.stringify(data) },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg =
          (body as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }
      return res.json() as Promise<unknown>;
    },
    onSuccess: () => {
      invalidateBacklog();
      onClose();
    },
    onError: (err) => {
      setSubmitError(err instanceof Error ? err.message : "Failed to save changes");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await ralphFetch(
        `/api/projects/${encodeURIComponent(projectId)}/backlog/${item!.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg =
          (body as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }
      return res.json() as Promise<unknown>;
    },
    onSuccess: () => {
      invalidateBacklog();
      onClose();
    },
    onError: (err) => {
      setSubmitError(err instanceof Error ? err.message : "Failed to delete item");
    },
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isDeleting = deleteMutation.isPending;

  // ── Form actions ───────────────────────────────────────────────

  function handleSubmit() {
    setSubmitError(null);
    if (!title.trim()) {
      setSubmitError("Title is required");
      return;
    }
    const filteredCriteria = criteria.filter((c) => c.trim());
    const payload: Record<string, unknown> = {
      title: title.trim(),
      type,
      priority,
      description: description.trim() || "",
      acceptanceCriteria: filteredCriteria,
      dependsOn: dependsOn.length > 0 ? dependsOn : [],
      notes: notes.trim() || undefined,
    };
    if (mode === "edit") {
      payload.status = status;
      if (status === "blocked") payload.blockedReason = blockedReason.trim() || undefined;
    }
    if (mode === "create") {
      createMutation.mutate(payload);
    } else {
      updateMutation.mutate(payload);
    }
  }

  function handleDelete() {
    if (!deleteConfirm) {
      setDeleteConfirm(true);
      return;
    }
    deleteMutation.mutate();
  }

  function addCriterion() {
    if (newCriterion.trim()) {
      setCriteria((prev) => [...prev, newCriterion.trim()]);
      setNewCriterion("");
    }
  }

  function removeCriterion(index: number) {
    setCriteria((prev) => prev.filter((_, i) => i !== index));
  }

  function updateCriterion(index: number, value: string) {
    setCriteria((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  function toggleDep(id: string) {
    setDependsOn((prev) => (prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]));
  }

  // Valid status options for edit mode (original item status + valid transitions)
  const validNextStatuses: BacklogItemStatus[] =
    mode === "edit" && item ? [item.status, ...(VALID_STATUS_TRANSITIONS[item.status] ?? [])] : [];

  // Items available as dependencies (all except the item being edited)
  const depCandidates = allItems.filter((i) => i.id !== item?.id);

  const inputStyle: React.CSSProperties = {
    backgroundColor: "var(--color-surface)",
    borderColor: "var(--color-border)",
    color: "var(--color-text)",
    outline: "none",
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ backgroundColor: "rgba(0, 0, 0, 0.3)" }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className="fixed right-0 top-0 z-50 flex h-full w-full flex-col overflow-hidden shadow-xl"
        style={{
          maxWidth: "480px",
          backgroundColor: "var(--color-surface)",
          borderLeft: "1px solid var(--color-border)",
        }}
        role="dialog"
        aria-modal="true"
        aria-label={mode === "create" ? "New backlog item" : `Edit item #${item?.id}`}
      >
        {/* ── Panel header ──────────────────────────────────── */}
        <div
          className="flex flex-shrink-0 items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--color-border)" }}
        >
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold" style={{ color: "var(--color-text)" }}>
              {mode === "create" ? "New Item" : `Edit #${item?.id}`}
            </h2>
            {mode === "edit" && item && <StatusBadge status={item.status} />}
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded text-sm transition-colors"
            style={{ color: "var(--color-text-muted)" }}
            title="Close panel"
            aria-label="Close panel"
          >
            ✕
          </button>
        </div>

        {/* ── Scrollable form ───────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="space-y-4">
            {/* Title */}
            <div>
              <label
                className="mb-1 block text-xs font-medium"
                style={{ color: "var(--color-text-muted)" }}
              >
                Title <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={inputStyle}
                placeholder="What needs to be done?"
                autoFocus
              />
            </div>

            {/* Type + Priority */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  className="mb-1 block text-xs font-medium"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Type
                </label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as BacklogItemType)}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  style={inputStyle}
                >
                  <option value="feature">Feature</option>
                  <option value="bug">Bug</option>
                  <option value="chore">Chore</option>
                  <option value="refactor">Refactor</option>
                </select>
              </div>
              <div>
                <label
                  className="mb-1 block text-xs font-medium"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Priority
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(Number(e.target.value) as 1 | 2 | 3 | 4)}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  style={inputStyle}
                >
                  <option value={1}>P1 — Critical</option>
                  <option value={2}>P2 — High</option>
                  <option value={3}>P3 — Normal</option>
                  <option value={4}>P4 — Low</option>
                </select>
              </div>
            </div>

            {/* Status transition (edit mode only) */}
            {mode === "edit" && (
              <div>
                <label
                  className="mb-1 block text-xs font-medium"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Status
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as BacklogItemStatus)}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  style={inputStyle}
                >
                  {validNextStatuses.map((s) => {
                    const cfg = STATUS_CONFIG[s];
                    return (
                      <option key={s} value={s}>
                        {cfg?.label ?? s}
                      </option>
                    );
                  })}
                </select>
                {status === "blocked" && (
                  <div className="mt-2">
                    <label
                      className="mb-1 block text-xs font-medium"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      Blocked reason
                    </label>
                    <input
                      type="text"
                      value={blockedReason}
                      onChange={(e) => setBlockedReason(e.target.value)}
                      className="w-full rounded-md border px-3 py-2 text-sm"
                      style={inputStyle}
                      placeholder="What is blocking this item?"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Description */}
            <div>
              <label
                className="mb-1 block text-xs font-medium"
                style={{ color: "var(--color-text-muted)" }}
              >
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{ ...inputStyle, resize: "vertical" }}
                rows={3}
                placeholder="Describe the work to be done…"
              />
            </div>

            {/* Acceptance Criteria */}
            <div>
              <label
                className="mb-1.5 block text-xs font-medium"
                style={{ color: "var(--color-text-muted)" }}
              >
                Acceptance Criteria
              </label>

              {/* Auto-badge placeholder when no criteria added yet */}
              {criteria.length === 0 && (
                <div
                  className="mb-2 flex items-center gap-2 rounded-md px-2.5 py-2"
                  style={{
                    backgroundColor: "rgba(107, 114, 128, 0.06)",
                    border: "1px dashed var(--color-border)",
                  }}
                >
                  <span
                    className="flex-1 text-xs italic"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    A smart default criterion will be generated from your project's verify command
                  </span>
                  <span
                    className="flex-shrink-0 rounded px-1.5 py-0.5 text-xs font-medium"
                    style={{
                      backgroundColor: "rgba(107, 114, 128, 0.12)",
                      color: "var(--color-text-muted)",
                    }}
                  >
                    auto
                  </span>
                </div>
              )}

              {/* Dynamic criteria list */}
              <div className="space-y-1.5">
                {criteria.map((c, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span
                      className="flex-shrink-0 font-mono text-xs"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      {i + 1}.
                    </span>
                    <input
                      type="text"
                      value={c}
                      onChange={(e) => updateCriterion(i, e.target.value)}
                      className="flex-1 rounded-md border px-3 py-1.5 text-sm"
                      style={inputStyle}
                      placeholder={`Criterion ${i + 1}`}
                    />
                    <button
                      onClick={() => removeCriterion(i)}
                      className="flex-shrink-0 rounded p-1 text-sm transition-colors hover:opacity-70"
                      style={{ color: "#ef4444" }}
                      title="Remove criterion"
                      aria-label="Remove criterion"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              {/* Add criterion row */}
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  value={newCriterion}
                  onChange={(e) => setNewCriterion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCriterion();
                    }
                  }}
                  className="flex-1 rounded-md border px-3 py-1.5 text-sm"
                  style={inputStyle}
                  placeholder="Add a criterion…"
                />
                <button
                  onClick={addCriterion}
                  disabled={!newCriterion.trim()}
                  className="flex-shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                  style={{
                    borderColor: "var(--color-border)",
                    color: "var(--color-accent)",
                    backgroundColor: "transparent",
                  }}
                >
                  + Add
                </button>
              </div>
            </div>

            {/* Dependency selector */}
            {depCandidates.length > 0 && (
              <div>
                <label
                  className="mb-1.5 block text-xs font-medium"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Depends On
                </label>
                <div
                  className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto rounded-md border p-2"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  {depCandidates.map((dep) => {
                    const isSelected = dependsOn.includes(dep.id);
                    const statusCfg = STATUS_CONFIG[dep.status] ?? STATUS_CONFIG["pending"]!;
                    return (
                      <button
                        key={dep.id}
                        onClick={() => toggleDep(dep.id)}
                        className="inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs transition-colors"
                        style={{
                          borderColor: isSelected ? "var(--color-accent)" : "var(--color-border)",
                          backgroundColor: isSelected ? "rgba(99, 102, 241, 0.1)" : "transparent",
                          color: isSelected ? "var(--color-accent)" : "var(--color-text-muted)",
                        }}
                        title={dep.title}
                      >
                        <span className="font-mono">#{dep.id}</span>
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: statusCfg.text }}
                        />
                      </button>
                    );
                  })}
                </div>
                {dependsOn.length > 0 && (
                  <p className="mt-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
                    {dependsOn.length} dep{dependsOn.length !== 1 ? "s" : ""} selected
                  </p>
                )}
              </div>
            )}

            {/* Notes */}
            <div>
              <label
                className="mb-1 block text-xs font-medium"
                style={{ color: "var(--color-text-muted)" }}
              >
                Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{ ...inputStyle, resize: "vertical" }}
                rows={2}
                placeholder="Additional context, links, or implementation notes…"
              />
            </div>

            {/* Error display */}
            {submitError && (
              <div
                className="rounded-md px-3 py-2.5 text-sm"
                style={{
                  backgroundColor: "rgba(239, 68, 68, 0.08)",
                  color: "#ef4444",
                  border: "1px solid rgba(239, 68, 68, 0.2)",
                }}
              >
                {submitError}
              </div>
            )}
          </div>
        </div>

        {/* ── Footer ────────────────────────────────────────── */}
        <div
          className="flex flex-shrink-0 items-center gap-2 px-5 py-4"
          style={{ borderTop: "1px solid var(--color-border)" }}
        >
          {mode === "edit" && (
            <button
              onClick={handleDelete}
              disabled={isDeleting || isSaving}
              className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                borderColor: deleteConfirm ? "#ef4444" : "rgba(239, 68, 68, 0.35)",
                color: "#ef4444",
                backgroundColor: deleteConfirm ? "rgba(239, 68, 68, 0.08)" : "transparent",
              }}
            >
              {isDeleting ? "Deleting…" : deleteConfirm ? "Confirm delete" : "Delete"}
            </button>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={isSaving || isDeleting}
              className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
              style={{
                borderColor: "var(--color-border)",
                color: "var(--color-text-muted)",
                backgroundColor: "transparent",
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSaving || isDeleting}
              className="rounded-md px-4 py-1.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                backgroundColor: "var(--color-accent)",
                color: "#ffffff",
              }}
            >
              {isSaving ? "Saving…" : mode === "create" ? "Create Item" : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </>
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

  // Panel state: null = closed, "create" = new item form, BacklogItem = edit item
  const [panelState, setPanelState] = useState<null | "create" | BacklogItem>(null);

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
      ralphFetchJson<BacklogItem[]>(`/api/projects/${encodeURIComponent(projectId)}/backlog`),
    enabled: !!projectId,
    refetchInterval: 30_000,
  });

  const { data: status } = useQuery({
    queryKey: ["projects", projectId, "status"],
    queryFn: () =>
      ralphFetchJson<DerivedStatus>(`/api/projects/${encodeURIComponent(projectId)}/status`),
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

  const [sweepToast, setSweepToast] = useState<string | null>(null);

  const sweepMutation = useMutation({
    mutationFn: async () => {
      const res = await ralphFetch(`/api/projects/${encodeURIComponent(projectId)}/backlog/sweep`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg =
          (body as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const body = (await res.json()) as { data: SweepResult };
      return body.data;
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["projects", projectId, "backlog"] });
      void queryClient.invalidateQueries({ queryKey: ["projects", projectId, "archive"] });
      const msg =
        data.archivedCount === 0
          ? "No done items to archive"
          : `Archived ${data.archivedCount} item${data.archivedCount === 1 ? "" : "s"} → ${data.archivedMonths.join(", ")}`;
      setSweepToast(msg);
      setTimeout(() => setSweepToast(null), 4000);
    },
    onError: (err) => {
      setSweepToast(`Sweep failed: ${err instanceof Error ? err.message : "Unknown error"}`);
      setTimeout(() => setSweepToast(null), 5000);
    },
  });

  function clearFilters() {
    setTypeFilter("all");
    setStatusFilter("all");
    setPriorityFilter("all");
  }

  const hasActiveFilters =
    typeFilter !== "all" || statusFilter !== "all" || priorityFilter !== "all";

  const panelMode: PanelMode = panelState === "create" ? "create" : "edit";
  const panelItem = panelState !== null && panelState !== "create" ? panelState : undefined;

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
        <div className="flex items-center gap-2">
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
          <button
            onClick={() => sweepMutation.mutate()}
            disabled={sweepMutation.isPending}
            className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              borderColor: "var(--color-border)",
              color: "var(--color-text-muted)",
              backgroundColor: "transparent",
            }}
            title="Archive all done items into .ralph/archive/"
          >
            {sweepMutation.isPending ? "Sweeping…" : "↓ Sweep"}
          </button>
          <Link
            to="/projects/$id/archive"
            params={{ id: projectId }}
            className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors"
            style={{
              borderColor: "var(--color-border)",
              color: "var(--color-text-muted)",
              backgroundColor: "transparent",
              textDecoration: "none",
            }}
          >
            Archive →
          </Link>
          <button
            onClick={() => setPanelState("create")}
            className="rounded-md px-3 py-1.5 text-sm font-semibold transition-colors"
            style={{
              backgroundColor: "var(--color-accent)",
              color: "#ffffff",
            }}
          >
            + Add Item
          </button>
        </div>
      </div>

      {/* ── Sweep toast ─────────────────────────────────────── */}
      {sweepToast && (
        <div
          className="mb-4 flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm"
          style={{
            borderColor: "rgba(37, 99, 235, 0.3)",
            backgroundColor: "rgba(37, 99, 235, 0.06)",
            color: "#2563eb",
          }}
        >
          <span>{sweepToast}</span>
          <button
            onClick={() => setSweepToast(null)}
            className="ml-auto text-xs opacity-70 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

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
                {hasActiveFilters ? "No items match the active filters" : "No backlog items yet"}
              </p>
              {hasActiveFilters ? (
                <button
                  onClick={clearFilters}
                  className="mt-2 text-sm underline"
                  style={{ color: "var(--color-accent)" }}
                >
                  Clear filters
                </button>
              ) : (
                <button
                  onClick={() => setPanelState("create")}
                  className="mt-3 rounded-md px-4 py-2 text-sm font-semibold transition-colors"
                  style={{
                    backgroundColor: "var(--color-accent)",
                    color: "#ffffff",
                  }}
                >
                  + Add First Item
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
                    onClick={() => setPanelState(item)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* ── Side panel ─────────────────────────────────────── */}
      {panelState !== null && (
        <BacklogPanel
          mode={panelMode}
          item={panelItem}
          projectId={projectId}
          allItems={allItems ?? []}
          onClose={() => setPanelState(null)}
        />
      )}
    </div>
  );
}
