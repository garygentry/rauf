import { useState, useEffect } from "react";
import { useParams, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ArchiveMonth, BacklogItem } from "@ralph/core";
import { ralphFetch, ralphFetchJson } from "../../lib/fetch";

// ─── Types ────────────────────────────────────────────────────────

interface ArchiveListEntry {
  month: string;
  count: number;
}

// ─── MonthRow ─────────────────────────────────────────────────────
//
// A single archive month row with expand/purge capabilities.

function MonthRow({ entry, projectId }: { entry: ArchiveListEntry; projectId: string }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // Auto-reset delete confirmation after 3 seconds
  useEffect(() => {
    if (!deleteConfirm) return;
    const t = setTimeout(() => setDeleteConfirm(false), 3000);
    return () => clearTimeout(t);
  }, [deleteConfirm]);

  const { data: archiveData, isLoading: isLoadingItems } = useQuery({
    queryKey: ["projects", projectId, "archive", entry.month],
    queryFn: () =>
      ralphFetchJson<ArchiveMonth>(
        `/api/projects/${encodeURIComponent(projectId)}/archive/${entry.month}`,
      ),
    enabled: expanded,
  });

  const purgeMutation = useMutation({
    mutationFn: async () => {
      const res = await ralphFetch(
        `/api/projects/${encodeURIComponent(projectId)}/archive/${entry.month}`,
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
      void queryClient.invalidateQueries({ queryKey: ["projects", projectId, "archive"] });
    },
  });

  function handlePurge() {
    if (!deleteConfirm) {
      setDeleteConfirm(true);
      return;
    }
    purgeMutation.mutate();
  }

  return (
    <div
      className="rounded-lg border"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface-raised)" }}
    >
      {/* Row header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex flex-1 items-center gap-3 text-left"
          aria-expanded={expanded}
        >
          <span className="font-mono text-sm font-medium" style={{ color: "var(--color-text)" }}>
            {entry.month}
          </span>
          <span
            className="rounded px-1.5 py-0.5 text-xs"
            style={{
              backgroundColor: "rgba(37, 99, 235, 0.12)",
              color: "#2563eb",
            }}
          >
            {entry.count} item{entry.count !== 1 ? "s" : ""}
          </span>
          <span
            className="ml-auto text-xs transition-transform"
            style={{
              color: "var(--color-text-muted)",
              transform: expanded ? "rotate(90deg)" : "none",
            }}
          >
            ▶
          </span>
        </button>

        <button
          onClick={handlePurge}
          disabled={purgeMutation.isPending}
          className="rounded border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            borderColor: deleteConfirm ? "#ef4444" : "rgba(239, 68, 68, 0.35)",
            color: "#ef4444",
            backgroundColor: deleteConfirm ? "rgba(239, 68, 68, 0.08)" : "transparent",
          }}
        >
          {purgeMutation.isPending ? "Purging…" : deleteConfirm ? "Confirm purge" : "Purge"}
        </button>
      </div>

      {/* Expanded items list */}
      {expanded && (
        <div className="border-t px-4 pb-4 pt-3" style={{ borderColor: "var(--color-border)" }}>
          {isLoadingItems ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-8 animate-pulse rounded"
                  style={{ backgroundColor: "var(--color-surface)" }}
                />
              ))}
            </div>
          ) : archiveData && archiveData.items.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ color: "var(--color-text-muted)" }}>
                    <th className="pb-2 pr-4 text-left font-medium text-xs">ID</th>
                    <th className="pb-2 pr-4 text-left font-medium text-xs">Type</th>
                    <th className="pb-2 pr-4 text-right font-medium text-xs">Pri</th>
                    <th className="pb-2 pr-4 text-left font-medium text-xs">Title</th>
                    <th className="pb-2 text-left font-medium text-xs">Completed</th>
                  </tr>
                </thead>
                <tbody>
                  {archiveData.items.map((item: BacklogItem) => (
                    <tr
                      key={item.id}
                      className="border-t"
                      style={{ borderColor: "var(--color-border)" }}
                    >
                      <td
                        className="py-1.5 pr-4 font-mono text-xs"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        #{item.id}
                      </td>
                      <td
                        className="py-1.5 pr-4 text-xs"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        {item.type}
                      </td>
                      <td
                        className="py-1.5 pr-4 text-right text-xs font-mono"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        P{item.priority}
                      </td>
                      <td className="py-1.5 pr-4 text-xs" style={{ color: "var(--color-text)" }}>
                        {item.title}
                      </td>
                      <td
                        className="py-1.5 font-mono text-xs"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        {item.completedAt ? item.completedAt.slice(0, 10) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              No items in this archive.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ArchiveView ──────────────────────────────────────────────────

export function ArchiveView() {
  const { id } = useParams({ strict: false });
  const projectId = id ?? "";

  const {
    data: archiveList,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["projects", projectId, "archive"],
    queryFn: () =>
      ralphFetchJson<{ months: ArchiveListEntry[] }>(
        `/api/projects/${encodeURIComponent(projectId)}/archive`,
      ),
    enabled: !!projectId,
  });

  const months = archiveList?.months ?? [];

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <Link
              to="/projects/$id/backlog"
              params={{ id: projectId }}
              className="text-xs"
              style={{ color: "var(--color-text-muted)" }}
            >
              ← Backlog
            </Link>
          </div>
          <h1 className="text-2xl font-semibold" style={{ color: "var(--color-text)" }}>
            Archive
          </h1>
          <p className="mt-0.5 font-mono text-sm" style={{ color: "var(--color-text-muted)" }}>
            {projectId}
          </p>
        </div>
        <button
          onClick={() => void refetch()}
          className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-text-muted)",
            backgroundColor: "transparent",
          }}
        >
          ↻ Refresh
        </button>
      </div>

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-lg"
              style={{ backgroundColor: "var(--color-surface-raised)" }}
            />
          ))}
        </div>
      )}

      {/* Error */}
      {isError && (
        <div
          className="rounded-lg border p-4"
          style={{
            borderColor: "rgba(220, 38, 38, 0.3)",
            backgroundColor: "rgba(220, 38, 38, 0.05)",
            color: "#dc2626",
          }}
        >
          <p className="text-sm font-medium">Failed to load archive</p>
          <p className="mt-1 text-xs" style={{ opacity: 0.8 }}>
            {error instanceof Error ? error.message : "Unknown error"}
          </p>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !isError && months.length === 0 && (
        <div
          className="flex flex-col items-center justify-center py-12 text-center"
          style={{ color: "var(--color-text-muted)" }}
        >
          <p className="text-base">No archive files yet</p>
          <p className="mt-1 text-sm" style={{ opacity: 0.7 }}>
            Use <span className="font-mono rounded bg-current/10 px-1">↓ Sweep</span> on the backlog
            to archive done items.
          </p>
          <Link
            to="/projects/$id/backlog"
            params={{ id: projectId }}
            className="mt-3 text-sm font-medium underline"
            style={{ color: "var(--color-accent)" }}
          >
            Go to Backlog
          </Link>
        </div>
      )}

      {/* Archive month list */}
      {!isLoading && !isError && months.length > 0 && (
        <div className="space-y-3">
          <p className="mb-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
            {months.length} archive month{months.length !== 1 ? "s" : ""}
          </p>
          {months.map((entry) => (
            <MonthRow key={entry.month} entry={entry} projectId={projectId} />
          ))}
        </div>
      )}
    </div>
  );
}
