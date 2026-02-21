import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { DiscoveredProject, DerivedStatus } from "@ralph/core";
import { ralphFetchJson } from "../../lib/fetch";

// ─── API shape ────────────────────────────────────────────────────

interface ProjectListData {
  projects: DiscoveredProject[];
  ignored: DiscoveredProject[];
}

// ─── Badge helpers ────────────────────────────────────────────────

const STACK_LABELS: Record<string, string> = {
  "node-typescript": "TS",
  "node-javascript": "JS",
  python: "PY",
  go: "GO",
  rust: "RS",
};

function getStackLabel(stack: string): string {
  return STACK_LABELS[stack] ?? stack.slice(0, 3).toUpperCase();
}

interface StateBadgeConfig {
  label: string;
  bgColor: string;
  textColor: string;
}

const STATE_BADGE: Record<string, StateBadgeConfig> = {
  IDLE: { label: "Idle", bgColor: "rgba(107, 114, 128, 0.12)", textColor: "#6b7280" },
  RUNNING: { label: "Running", bgColor: "rgba(22, 163, 74, 0.15)", textColor: "#16a34a" },
  PAUSED: { label: "Paused", bgColor: "rgba(202, 138, 4, 0.15)", textColor: "#ca8a04" },
  COMPLETE: { label: "Complete", bgColor: "rgba(37, 99, 235, 0.15)", textColor: "#2563eb" },
  PAUSED_HUMAN: {
    label: "Needs Human",
    bgColor: "rgba(234, 88, 12, 0.15)",
    textColor: "#ea580c",
  },
  LIMIT_REACHED: {
    label: "Limit Reached",
    bgColor: "rgba(220, 38, 38, 0.15)",
    textColor: "#dc2626",
  },
  ERROR: { label: "Error", bgColor: "rgba(220, 38, 38, 0.15)", textColor: "#dc2626" },
  NOT_INSTALLED: {
    label: "Not Installed",
    bgColor: "rgba(107, 114, 128, 0.08)",
    textColor: "#6b7280",
  },
};

function StateBadge({ state }: { state: string }) {
  const config = STATE_BADGE[state] ?? STATE_BADGE["IDLE"]!;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: config.bgColor, color: config.textColor }}
    >
      {state === "RUNNING" && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden="true" />
      )}
      {config.label}
    </span>
  );
}

function StackBadge({ stack, packageManager }: { stack: string; packageManager: string | null }) {
  const label = getStackLabel(stack);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: "rgba(99, 102, 241, 0.12)", color: "var(--color-accent)" }}
    >
      {label}
      {packageManager && <span style={{ opacity: 0.65 }}>· {packageManager}</span>}
    </span>
  );
}

function BacklogCounts({ summary }: { summary: DerivedStatus["backlogSummary"] }) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 text-xs"
      style={{ color: "var(--color-text-muted)" }}
    >
      <span>{summary.pending} pending</span>
      {summary.inProgress > 0 && (
        <span style={{ color: "#16a34a" }}>{summary.inProgress} active</span>
      )}
      {summary.blocked > 0 && <span style={{ color: "#ea580c" }}>{summary.blocked} blocked</span>}
      <span>
        {summary.done}/{summary.total} done
      </span>
    </div>
  );
}

// ─── ProjectCard ──────────────────────────────────────────────────

function ProjectCard({ project, muted = false }: { project: DiscoveredProject; muted?: boolean }) {
  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ["projects", project.id, "status"],
    queryFn: () =>
      ralphFetchJson<DerivedStatus>(`/api/projects/${encodeURIComponent(project.id)}/status`),
    refetchInterval: 30_000,
  });

  const loopState = status?.loopState ?? "IDLE";
  const backlogSummary = status?.backlogSummary;

  return (
    <div
      className="flex flex-col rounded-lg border p-4 transition-shadow hover:shadow-md"
      style={{
        backgroundColor: "var(--color-surface-raised)",
        borderColor: "var(--color-border)",
        opacity: muted ? 0.5 : 1,
      }}
    >
      {/* Header row: name + state badge */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <Link
            to="/projects/$id/backlog"
            params={{ id: project.id }}
            className="block truncate text-sm font-semibold hover:underline"
            style={{ color: "var(--color-text)" }}
          >
            {project.name}
          </Link>
          <p
            className="mt-0.5 truncate text-xs"
            style={{ color: "var(--color-text-muted)" }}
            title={project.path}
          >
            {project.path}
          </p>
        </div>
        {statusLoading ? (
          <div
            className="mt-0.5 h-5 w-14 flex-shrink-0 animate-pulse rounded-full"
            style={{ backgroundColor: "var(--color-border)" }}
          />
        ) : (
          <StateBadge state={loopState} />
        )}
      </div>

      {/* Stack badge */}
      <div className="mb-3">
        <StackBadge
          stack={project.marker.profile.stack}
          packageManager={project.marker.profile.packageManager}
        />
      </div>

      {/* Backlog summary */}
      <div className="flex-1">
        {backlogSummary ? (
          <BacklogCounts summary={backlogSummary} />
        ) : statusLoading ? (
          <div
            className="h-3 w-36 animate-pulse rounded"
            style={{ backgroundColor: "var(--color-border)" }}
          />
        ) : (
          <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            No backlog data
          </p>
        )}
      </div>

      {/* Footer links */}
      <div
        className="mt-3 flex items-center gap-2 border-t pt-3"
        style={{ borderColor: "var(--color-border)" }}
      >
        <Link
          to="/projects/$id/backlog"
          params={{ id: project.id }}
          className="text-xs font-medium hover:underline"
          style={{ color: "var(--color-accent)" }}
        >
          Backlog
        </Link>
        <span style={{ color: "var(--color-border)" }}>·</span>
        <Link
          to="/projects/$id/status"
          params={{ id: project.id }}
          className="text-xs font-medium hover:underline"
          style={{ color: "var(--color-accent)" }}
        >
          Status
        </Link>
        <span style={{ color: "var(--color-border)" }}>·</span>
        <Link
          to="/projects/$id/settings"
          params={{ id: project.id }}
          className="text-xs font-medium hover:underline"
          style={{ color: "var(--color-accent)" }}
        >
          Settings
        </Link>
      </div>
    </div>
  );
}

// ─── LoadingSkeleton ──────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-44 animate-pulse rounded-lg"
          style={{ backgroundColor: "var(--color-surface-raised)" }}
        />
      ))}
    </div>
  );
}

// ─── EmptyState ───────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div
        className="mb-4 flex h-16 w-16 items-center justify-center rounded-full text-3xl"
        style={{ backgroundColor: "var(--color-surface-raised)" }}
      >
        ⬡
      </div>
      <p className="text-lg font-medium" style={{ color: "var(--color-text)" }}>
        No projects found
      </p>
      <p className="mt-2 max-w-sm text-sm" style={{ color: "var(--color-text-muted)" }}>
        Configure your root directory in Settings, then install Ralph on an existing project or
        initialize a new one.
      </p>
      <div className="mt-6 flex items-center gap-3">
        <Link
          to="/install"
          className="rounded-md border px-4 py-2 text-sm font-medium transition-colors"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-text)",
            backgroundColor: "var(--color-surface-raised)",
          }}
        >
          Install Ralph
        </Link>
        <Link
          to="/init"
          className="rounded-md px-4 py-2 text-sm font-medium text-white"
          style={{ backgroundColor: "var(--color-accent)" }}
        >
          Initialize New Project
        </Link>
      </div>
    </div>
  );
}

// ─── ProjectsDashboard ────────────────────────────────────────────

export function ProjectsDashboard() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ["projects"],
    queryFn: () => ralphFetchJson<ProjectListData>("/api/projects"),
    refetchInterval: 30_000,
  });

  function handleRefresh() {
    void queryClient.invalidateQueries({ queryKey: ["projects"] });
  }

  const projects = data?.projects ?? [];
  const ignored = data?.ignored ?? [];

  return (
    <div className="p-6">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: "var(--color-text)" }}>
            Projects
          </h1>
          {!isLoading && !isError && (
            <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
              {projects.length} project{projects.length !== 1 ? "s" : ""} discovered
              {ignored.length > 0 && `, ${ignored.length} ignored`}
            </p>
          )}
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
            title="Refresh project list"
          >
            {isFetching ? "↻ Refreshing…" : "↻ Refresh"}
          </button>
          <Link
            to="/install"
            className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors"
            style={{
              borderColor: "var(--color-border)",
              color: "var(--color-text)",
              backgroundColor: "var(--color-surface-raised)",
            }}
          >
            Install Ralph
          </Link>
          <Link
            to="/init"
            className="rounded-md px-4 py-2 text-sm font-medium text-white"
            style={{ backgroundColor: "var(--color-accent)" }}
          >
            Initialize New Project
          </Link>
        </div>
      </div>

      {/* ── Loading ────────────────────────────────────────── */}
      {isLoading && <LoadingSkeleton />}

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
          <p className="text-sm font-medium">Failed to load projects</p>
          <p className="mt-1 text-xs" style={{ opacity: 0.8 }}>
            {error instanceof Error ? error.message : "Unknown error"}
          </p>
          <button onClick={handleRefresh} className="mt-2 text-xs font-medium underline">
            Try again
          </button>
        </div>
      )}

      {/* ── Empty state ────────────────────────────────────── */}
      {!isLoading && !isError && projects.length === 0 && ignored.length === 0 && <EmptyState />}

      {/* ── Active project cards ───────────────────────────── */}
      {!isLoading && !isError && projects.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}

      {/* ── Ignored projects (muted, bottom) ───────────────── */}
      {!isLoading && !isError && ignored.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-medium" style={{ color: "var(--color-text-muted)" }}>
            Ignored Projects ({ignored.length})
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ignored.map((project) => (
              <ProjectCard key={project.id} project={project} muted />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
