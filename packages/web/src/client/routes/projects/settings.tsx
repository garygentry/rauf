import { useState, useEffect } from "react";
import { useParams } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  ProjectProfile,
  MarkerOptions,
  DiscoveredProject,
  MarkerFile,
  InstallationReport,
  ArtifactStalenessReport,
  ArtifactFileStatus,
} from "@rauf/core";
import { raufFetchJson } from "../../lib/fetch";

// ─── Types ───────────────────────────────────────────────────────

type CommandKey = "test" | "typecheck" | "lint" | "build" | "format";

const COMMAND_KEYS: CommandKey[] = ["test", "typecheck", "lint", "build", "format"];

const COMMAND_LABELS: Record<CommandKey, string> = {
  test: "Test",
  typecheck: "Typecheck",
  lint: "Lint",
  build: "Build",
  format: "Format",
};

// ─── ProjectSettings ─────────────────────────────────────────────

export function ProjectSettings() {
  const { id } = useParams({ strict: false });
  const projectId = id ?? "";
  const queryClient = useQueryClient();

  // ── Fetch project detail (includes marker file with profile + options + artifactHashes) ──

  const {
    data: project,
    isLoading: projectLoading,
    isError: projectError,
  } = useQuery({
    queryKey: ["projects", projectId],
    queryFn: () =>
      raufFetchJson<DiscoveredProject & { marker: MarkerFile }>(
        `/api/projects/${encodeURIComponent(projectId)}`,
      ),
    enabled: !!projectId,
  });

  // ── Local state for profile commands editing ──

  const [commands, setCommands] = useState<Record<CommandKey, string>>({
    test: "",
    typecheck: "",
    lint: "",
    build: "",
    format: "",
  });
  const [commandsDirty, setCommandsDirty] = useState(false);

  // ── Local state for options editing ──

  const [options, setOptions] = useState<MarkerOptions>({
    ignoreInTool: false,
    gitignoreScripts: false,
    maxIterations: 20,
  });
  const [optionsDirty, setOptionsDirty] = useState(false);

  // Sync local state when project data loads
  useEffect(() => {
    if (project?.marker) {
      const profile = project.marker.profile;
      setCommands({
        test: profile.commands.test ?? "",
        typecheck: profile.commands.typecheck ?? "",
        lint: profile.commands.lint ?? "",
        build: profile.commands.build ?? "",
        format: profile.commands.format ?? "",
      });
      setCommandsDirty(false);
      setOptions(project.marker.options);
      setOptionsDirty(false);
    }
  }, [project]);

  // ── Profile mutation ──

  const profileMutation = useMutation({
    mutationFn: (updated: ProjectProfile) =>
      raufFetchJson<ProjectProfile>(`/api/projects/${encodeURIComponent(projectId)}/profile`, {
        method: "PUT",
        body: JSON.stringify(updated),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projects", projectId] });
      setCommandsDirty(false);
    },
  });

  // ── Options mutation ──

  const optionsMutation = useMutation({
    mutationFn: (updated: MarkerOptions) =>
      raufFetchJson<MarkerOptions>(`/api/projects/${encodeURIComponent(projectId)}/options`, {
        method: "PUT",
        body: JSON.stringify(updated),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projects", projectId] });
      setOptionsDirty(false);
    },
  });

  // ── Re-detect stack mutation ──

  const detectMutation = useMutation({
    mutationFn: () =>
      raufFetchJson<ProjectProfile>(
        `/api/projects/${encodeURIComponent(projectId)}/profile/detect`,
        { method: "POST" },
      ),
    onSuccess: (detected) => {
      // Apply detected profile
      profileMutation.mutate(detected);
    },
  });

  // ── Update artifacts mutation ──

  const updateMutation = useMutation({
    mutationFn: () =>
      raufFetchJson<InstallationReport>(`/api/projects/${encodeURIComponent(projectId)}/update`, {
        method: "POST",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projects", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["projects", projectId, "artifact-status"] });
    },
  });

  // ── Artifact staleness query ──

  const stalenessQuery = useQuery({
    queryKey: ["projects", projectId, "artifact-status"],
    queryFn: () =>
      raufFetchJson<ArtifactStalenessReport>(
        `/api/projects/${encodeURIComponent(projectId)}/artifact-status`,
      ),
    enabled: !!projectId,
  });

  // ── Handlers ──

  function handleCommandChange(key: CommandKey, value: string) {
    setCommands((prev) => ({ ...prev, [key]: value }));
    setCommandsDirty(true);
  }

  function handleSaveCommands() {
    if (!project?.marker?.profile) return;

    const profile = project.marker.profile;
    const updatedProfile: ProjectProfile = {
      ...profile,
      commands: {
        test: commands.test || null,
        typecheck: commands.typecheck || null,
        lint: commands.lint || null,
        build: commands.build || null,
        format: commands.format || null,
      },
      verify: buildVerifyString(commands),
    };
    profileMutation.mutate(updatedProfile);
  }

  function handleOptionToggle(key: keyof MarkerOptions, value: boolean) {
    const updated = { ...options, [key]: value };
    setOptions(updated);
    setOptionsDirty(true);
    // Auto-save toggles immediately
    optionsMutation.mutate(updated);
  }

  function handleMaxIterationsChange(value: number) {
    if (value < 1) return;
    setOptions((prev) => ({ ...prev, maxIterations: value }));
    setOptionsDirty(true);
  }

  function handleModelChange(value: string) {
    const updated = { ...options, model: value || undefined };
    setOptions(updated);
    setOptionsDirty(true);
  }

  function handleSaveOptions() {
    optionsMutation.mutate(options);
  }

  // ── Loading / Error ──

  if (projectLoading) {
    return (
      <div className="p-6">
        <div
          className="mb-6 h-10 w-48 animate-pulse rounded-lg"
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

  if (projectError || !project) {
    return (
      <div className="p-6">
        <h1 className="mb-4 text-2xl font-semibold" style={{ color: "var(--color-text)" }}>
          Project Settings
        </h1>
        <div
          className="rounded-lg border p-4"
          style={{
            borderColor: "rgba(220, 38, 38, 0.3)",
            backgroundColor: "rgba(220, 38, 38, 0.05)",
            color: "#dc2626",
          }}
        >
          <p className="text-sm font-medium">
            Failed to load project settings. Is ralph installed in this project?
          </p>
        </div>
      </div>
    );
  }

  const marker = project.marker;
  const artifactHashes = marker.artifactHashes;

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 text-2xl font-semibold" style={{ color: "var(--color-text)" }}>
        Project Settings
      </h1>
      <p className="mb-6 text-sm" style={{ color: "var(--color-text-muted)" }}>
        Configuration for{" "}
        <span className="font-mono font-medium" style={{ color: "var(--color-text)" }}>
          {projectId}
        </span>{" "}
        — stored in .rauf.json
      </p>

      {/* Global mutation feedback */}
      {(profileMutation.isError || optionsMutation.isError) && (
        <div
          className="mb-4 rounded-lg border px-4 py-3 text-sm"
          style={{
            borderColor: "rgba(220, 38, 38, 0.3)",
            backgroundColor: "rgba(220, 38, 38, 0.05)",
            color: "#dc2626",
          }}
        >
          {profileMutation.error instanceof Error
            ? profileMutation.error.message
            : optionsMutation.error instanceof Error
              ? optionsMutation.error.message
              : "Failed to save settings"}
        </div>
      )}

      <div className="space-y-6">
        {/* ── Tech Stack ──────────────────────────────────────── */}
        <SettingsSection
          title="Tech Stack"
          description={`Detected: ${marker.profile.stack}${marker.profile.packageManager ? ` / ${marker.profile.packageManager}` : ""}${marker.profile.monorepo ? " (monorepo)" : ""}`}
        >
          <button
            onClick={() => detectMutation.mutate()}
            disabled={detectMutation.isPending || profileMutation.isPending}
            className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              borderColor: "var(--color-border)",
              color: "var(--color-text)",
              backgroundColor: "var(--color-surface)",
            }}
          >
            {detectMutation.isPending || profileMutation.isPending
              ? "Detecting…"
              : "Re-detect Stack"}
          </button>
          {detectMutation.isError && (
            <p className="mt-2 text-xs" style={{ color: "#dc2626" }}>
              Detection failed:{" "}
              {detectMutation.error instanceof Error
                ? detectMutation.error.message
                : "Unknown error"}
            </p>
          )}
        </SettingsSection>

        {/* ── Artifact Status ─────────────────────────────────── */}
        <ArtifactStatusSection
          artifactHashes={artifactHashes}
          staleness={stalenessQuery.data}
          stalenessLoading={stalenessQuery.isLoading}
          updatePending={updateMutation.isPending}
          updateError={
            updateMutation.isError
              ? updateMutation.error instanceof Error
                ? updateMutation.error
                : new Error(String(updateMutation.error))
              : null
          }
          updateData={updateMutation.data}
          onUpdate={() => updateMutation.mutate()}
        />

        {/* ── Profile Commands ────────────────────────────────── */}
        <SettingsSection
          title="Verification Commands"
          description="Commands run before marking a task complete. Leave empty to skip."
        >
          <div className="space-y-3">
            {COMMAND_KEYS.map((key) => (
              <div key={key} className="flex items-center gap-3">
                <label
                  className="w-20 flex-shrink-0 text-right text-xs font-medium"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {COMMAND_LABELS[key]}
                </label>
                <input
                  type="text"
                  value={commands[key]}
                  onChange={(e) => handleCommandChange(key, e.target.value)}
                  className="flex-1 rounded-md border px-3 py-1.5 font-mono text-sm"
                  style={{
                    borderColor: "var(--color-border)",
                    backgroundColor: "var(--color-surface)",
                    color: "var(--color-text)",
                    outline: "none",
                  }}
                  placeholder={`e.g. pnpm ${key}`}
                />
              </div>
            ))}

            {/* Computed verify string preview */}
            <div
              className="mt-2 rounded-md border p-3"
              style={{
                borderColor: "var(--color-border)",
                backgroundColor: "var(--color-surface)",
              }}
            >
              <p className="mb-1 text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                Composite verify command:
              </p>
              <p className="font-mono text-xs" style={{ color: "var(--color-text)" }}>
                {buildVerifyString(commands) || "(none)"}
              </p>
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleSaveCommands}
                disabled={!commandsDirty || profileMutation.isPending}
                className="rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                style={{
                  backgroundColor: commandsDirty ? "var(--color-accent)" : "transparent",
                  color: commandsDirty ? "#fff" : "var(--color-text-muted)",
                  border: commandsDirty ? "none" : "1px solid var(--color-border)",
                }}
              >
                {profileMutation.isPending ? "Saving…" : "Save Commands"}
              </button>
            </div>
          </div>
        </SettingsSection>

        {/* ── Options ─────────────────────────────────────────── */}
        <SettingsSection title="Options" description="Per-project behavior settings.">
          <div className="space-y-4">
            <ToggleRow
              label="Ignore in tool"
              description="Hide this project from the dashboard"
              checked={options.ignoreInTool}
              onChange={(v) => handleOptionToggle("ignoreInTool", v)}
            />
            <ToggleRow
              label="Gitignore scripts"
              description="Add ralph scripts to .gitignore"
              checked={options.gitignoreScripts}
              onChange={(v) => handleOptionToggle("gitignoreScripts", v)}
            />
            {options.autoSweep !== undefined && (
              <ToggleRow
                label="Auto-sweep"
                description="Automatically archive completed items"
                checked={options.autoSweep ?? false}
                onChange={(v) => handleOptionToggle("autoSweep" as keyof MarkerOptions, v)}
              />
            )}

            {/* Max iterations */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                  Max iterations
                </p>
                <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                  Maximum loop iterations per run
                </p>
              </div>
              <input
                type="number"
                value={options.maxIterations}
                onChange={(e) => handleMaxIterationsChange(parseInt(e.target.value, 10) || 1)}
                min={1}
                className="w-20 rounded-md border px-2 py-1.5 text-right font-mono text-sm"
                style={{
                  borderColor: "var(--color-border)",
                  backgroundColor: "var(--color-surface)",
                  color: "var(--color-text)",
                  outline: "none",
                }}
              />
            </div>

            {/* Model */}
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                  Model
                </p>
                <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                  Default Claude model for this project
                </p>
              </div>
              <input
                type="text"
                value={options.model ?? ""}
                onChange={(e) => handleModelChange(e.target.value)}
                className="w-52 rounded-md border px-2 py-1.5 font-mono text-sm"
                style={{
                  borderColor: "var(--color-border)",
                  backgroundColor: "var(--color-surface)",
                  color: "var(--color-text)",
                  outline: "none",
                }}
                placeholder="(default)"
              />
            </div>

            {optionsDirty && (
              <div className="flex justify-end">
                <button
                  onClick={handleSaveOptions}
                  disabled={optionsMutation.isPending}
                  className="rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                  style={{
                    backgroundColor: "var(--color-accent)",
                    color: "#fff",
                  }}
                >
                  {optionsMutation.isPending ? "Saving…" : "Save Options"}
                </button>
              </div>
            )}
          </div>
        </SettingsSection>

        {/* ── Metadata ────────────────────────────────────────── */}
        <SettingsSection title="Installation Info" description="Read-only metadata from .rauf.json">
          <div className="space-y-1.5 text-xs" style={{ color: "var(--color-text-muted)" }}>
            <MetaRow label="Version" value={marker.version} />
            <MetaRow label="Variant" value={marker.variant} />
            <MetaRow label="Installed at" value={marker.installedAt} />
            <MetaRow label="Installed by" value={marker.installedBy} />
          </div>
        </SettingsSection>
      </div>
    </div>
  );
}

// ─── Helper components ───────────────────────────────────────────

function SettingsSection({
  title,
  description,
  badge,
  children,
}: {
  title: string;
  description: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-lg border p-5"
      style={{
        backgroundColor: "var(--color-surface-raised)",
        borderColor: "var(--color-border)",
      }}
    >
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
          {title}
        </h2>
        {badge}
      </div>
      <p className="mb-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
        {description}
      </p>
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
          {label}
        </p>
        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          {description}
        </p>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className="relative h-6 w-11 flex-shrink-0 rounded-full transition-colors"
        style={{
          backgroundColor: checked ? "var(--color-accent)" : "var(--color-border)",
        }}
        role="switch"
        aria-checked={checked}
      >
        <span
          className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
          style={{
            transform: checked ? "translateX(1.25rem)" : "translateX(0.125rem)",
          }}
        />
      </button>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-24 flex-shrink-0 font-medium" style={{ color: "var(--color-text-muted)" }}>
        {label}
      </span>
      <span className="font-mono" style={{ color: "var(--color-text)" }}>
        {value}
      </span>
    </div>
  );
}

// ─── Utility ─────────────────────────────────────────────────────

function actionBadgeStyle(action: string): React.CSSProperties {
  switch (action) {
    case "updated":
      return { backgroundColor: "rgba(22, 163, 74, 0.12)", color: "#16a34a" };
    case "created":
    case "merged":
    case "rendered":
      return { backgroundColor: "rgba(37, 99, 235, 0.1)", color: "#2563eb" };
    case "skipped":
    default:
      return { backgroundColor: "var(--color-surface-raised)", color: "var(--color-text-muted)" };
  }
}

function buildVerifyString(cmds: Record<CommandKey, string>): string {
  return COMMAND_KEYS.map((k) => cmds[k])
    .filter(Boolean)
    .join(" && ");
}

// ─── ArtifactStatusSection ───────────────────────────────────────

function ArtifactStatusSection({
  artifactHashes,
  staleness,
  stalenessLoading,
  updatePending,
  updateError,
  updateData,
  onUpdate,
}: {
  artifactHashes: Record<string, string>;
  staleness: ArtifactStalenessReport | undefined;
  stalenessLoading: boolean;
  updatePending: boolean;
  updateError: Error | null;
  updateData: InstallationReport | undefined;
  onUpdate: () => void;
}) {
  // Determine summary badge
  let summaryBadge: React.ReactNode;
  if (stalenessLoading || (!staleness && !updateError)) {
    summaryBadge = (
      <span
        className="rounded px-2 py-0.5 text-xs font-medium"
        style={{ backgroundColor: "var(--color-surface)", color: "var(--color-text-muted)" }}
      >
        Checking…
      </span>
    );
  } else if (staleness && staleness.conflicts > 0) {
    summaryBadge = (
      <span
        className="rounded px-2 py-0.5 text-xs font-medium"
        style={{ backgroundColor: "rgba(217, 119, 6, 0.12)", color: "#d97706" }}
      >
        {staleness.conflicts} conflict{staleness.conflicts !== 1 ? "s" : ""}
      </span>
    );
  } else if (staleness && staleness.updatesAvailable > 0) {
    summaryBadge = (
      <span
        className="rounded px-2 py-0.5 text-xs font-medium"
        style={{ backgroundColor: "rgba(234, 88, 12, 0.1)", color: "#ea580c" }}
      >
        {staleness.updatesAvailable} update{staleness.updatesAvailable !== 1 ? "s" : ""} available
      </span>
    );
  } else if (staleness) {
    summaryBadge = (
      <span
        className="rounded px-2 py-0.5 text-xs font-medium"
        style={{ backgroundColor: "rgba(22, 163, 74, 0.1)", color: "#16a34a" }}
      >
        All artifacts up to date
      </span>
    );
  }

  // Determine button label + style
  let buttonLabel: string;
  let buttonStyle: React.CSSProperties;
  let buttonDisabled: boolean;

  if (updatePending) {
    buttonLabel = "Updating…";
    buttonStyle = {
      borderColor: "var(--color-border)",
      color: "var(--color-text-muted)",
      backgroundColor: "var(--color-surface)",
    };
    buttonDisabled = true;
  } else if (!staleness) {
    buttonLabel = "Update Artifacts";
    buttonStyle = {
      borderColor: "var(--color-border)",
      color: "var(--color-text)",
      backgroundColor: "var(--color-surface)",
    };
    buttonDisabled = false;
  } else if (staleness.updatesAvailable === 0 && staleness.conflicts === 0) {
    buttonLabel = "Update Artifacts";
    buttonStyle = {
      borderColor: "var(--color-border)",
      color: "var(--color-text)",
      backgroundColor: "var(--color-surface)",
    };
    buttonDisabled = false;
  } else if (staleness.updatesAvailable > 0) {
    buttonLabel = `Update ${staleness.updatesAvailable} File${staleness.updatesAvailable !== 1 ? "s" : ""}`;
    buttonStyle = {
      borderColor: "transparent",
      color: "#fff",
      backgroundColor: "var(--color-accent)",
    };
    buttonDisabled = false;
  } else {
    // Only conflicts
    buttonLabel = "Update (review conflicts)";
    buttonStyle = {
      borderColor: "rgba(217, 119, 6, 0.4)",
      color: "#d97706",
      backgroundColor: "rgba(217, 119, 6, 0.08)",
    };
    buttonDisabled = false;
  }

  return (
    <SettingsSection
      title="Artifact Status"
      description="Script artifacts installed in this project. Use the button below to pull in the latest versions."
      badge={summaryBadge}
    >
      {Object.keys(artifactHashes).length === 0 ? (
        <p className="text-xs italic" style={{ color: "var(--color-text-muted)" }}>
          No artifact hashes recorded
        </p>
      ) : (
        <div className="space-y-2">
          {Object.entries(artifactHashes).map(([file, hash]) => {
            const fileStatus = staleness?.files[file];
            return (
              <div
                key={file}
                className="flex items-center justify-between rounded-md border px-3 py-2"
                style={{
                  borderColor: "var(--color-border)",
                  backgroundColor: "var(--color-surface)",
                }}
              >
                <span
                  className="font-mono text-xs font-medium"
                  style={{ color: "var(--color-text)" }}
                >
                  {file}
                </span>
                <div className="ml-4 flex items-center gap-2 flex-shrink-0">
                  {fileStatus ? (
                    <ArtifactStatusBadge status={fileStatus} />
                  ) : staleness ? (
                    <span
                      className="rounded px-1.5 py-0.5 text-xs font-medium"
                      style={{
                        backgroundColor: "var(--color-surface-raised)",
                        color: "var(--color-text-muted)",
                      }}
                    >
                      rendered
                    </span>
                  ) : null}
                  <span
                    className="truncate font-mono text-xs"
                    style={{ color: "var(--color-text-muted)", maxWidth: "120px" }}
                    title={hash}
                  >
                    {hash.substring(0, 12)}…
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Update button */}
      <div className="mt-4">
        <button
          onClick={onUpdate}
          disabled={buttonDisabled}
          className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-70"
          style={buttonStyle}
        >
          {buttonLabel}
        </button>
        {updateError && (
          <p className="mt-2 text-xs" style={{ color: "#dc2626" }}>
            Update failed: {updateError.message}
          </p>
        )}
      </div>

      {/* Update result table */}
      {updateData && (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
            Last update result:
          </p>
          <div className="space-y-1.5">
            {updateData.actions.map((action, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-md border px-3 py-2"
                style={{
                  borderColor: "var(--color-border)",
                  backgroundColor: "var(--color-surface)",
                }}
              >
                <span
                  className="font-mono text-xs font-medium"
                  style={{ color: "var(--color-text)" }}
                >
                  {action.file}
                </span>
                <div className="ml-4 flex items-center gap-2 flex-shrink-0">
                  <span
                    className="rounded px-1.5 py-0.5 text-xs font-medium"
                    style={actionBadgeStyle(action.action)}
                  >
                    {action.action}
                  </span>
                  <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                    {action.detail}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Warnings */}
          {updateData.warnings.length > 0 && (
            <div
              className="mt-3 rounded-md border px-3 py-2.5"
              style={{
                borderColor: "rgba(217, 119, 6, 0.3)",
                backgroundColor: "rgba(217, 119, 6, 0.07)",
              }}
            >
              <p className="mb-1 text-xs font-semibold" style={{ color: "#d97706" }}>
                Conflicts detected
              </p>
              <ul className="space-y-0.5">
                {updateData.warnings.map((w, i) => (
                  <li key={i} className="text-xs" style={{ color: "#d97706" }}>
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </SettingsSection>
  );
}

function ArtifactStatusBadge({ status }: { status: ArtifactFileStatus }) {
  switch (status) {
    case "up_to_date":
      return (
        <span
          className="rounded px-1.5 py-0.5 text-xs font-medium"
          style={{ backgroundColor: "rgba(22, 163, 74, 0.1)", color: "#16a34a" }}
        >
          current
        </span>
      );
    case "safe_update":
      return (
        <span
          className="rounded px-1.5 py-0.5 text-xs font-medium"
          style={{ backgroundColor: "rgba(234, 88, 12, 0.1)", color: "#ea580c" }}
        >
          update available
        </span>
      );
    case "local_only":
      return (
        <span
          className="rounded px-1.5 py-0.5 text-xs font-medium"
          style={{
            backgroundColor: "var(--color-surface-raised)",
            color: "var(--color-text-muted)",
          }}
        >
          locally modified
        </span>
      );
    case "conflict":
      return (
        <span
          className="rounded px-1.5 py-0.5 text-xs font-medium"
          style={{ backgroundColor: "rgba(217, 119, 6, 0.12)", color: "#d97706" }}
        >
          conflict
        </span>
      );
    case "missing":
      return (
        <span
          className="rounded px-1.5 py-0.5 text-xs font-medium"
          style={{ backgroundColor: "rgba(220, 38, 38, 0.1)", color: "#dc2626" }}
        >
          missing
        </span>
      );
  }
}
