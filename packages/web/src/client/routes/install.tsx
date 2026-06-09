import { useState, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ProjectProfile, InstallationReport, ProfileOverrides } from "@rauf/core";
import { raufFetchJson } from "../lib/fetch";

// ─── Types ───────────────────────────────────────────────────────

interface PreflightCheck {
  name: string;
  passed: boolean;
  message: string;
  severity: "error" | "warning";
}

interface PreflightData {
  passed: boolean;
  checks: PreflightCheck[];
  resolvedPath: string;
  detectedProfile: ProjectProfile;
}

interface WizardState {
  step: number;
  // Step 1
  targetPath: string;
  // Step 2 (computed)
  preflightData: PreflightData | null;
  // Step 3
  profile: ProjectProfile | null;
  profileOverrides: ProfileOverrides;
  // Step 4
  projectName: string;
  updateGitignore: boolean;
  maxIterations: number;
  // Step 6 (computed)
  installReport: InstallationReport | null;
}

const INITIAL_STATE: WizardState = {
  step: 1,
  targetPath: "",
  preflightData: null,
  profile: null,
  profileOverrides: {},
  projectName: "",
  updateGitignore: true,
  maxIterations: 20,
  installReport: null,
};

const STEP_LABELS = ["Select Target", "Preflight", "Tech Stack", "Configure", "Review", "Result"];

// ─── Step indicator ──────────────────────────────────────────────

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="mb-8 flex items-center gap-1">
      {Array.from({ length: total }, (_, i) => {
        const step = i + 1;
        const isActive = step === current;
        const isComplete = step < current;
        return (
          <div key={step} className="flex flex-1 items-center gap-1">
            <div className="flex flex-col items-center gap-1">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold"
                style={{
                  backgroundColor: isActive
                    ? "var(--color-accent)"
                    : isComplete
                      ? "rgba(99, 102, 241, 0.15)"
                      : "var(--color-surface-raised)",
                  color: isActive
                    ? "#fff"
                    : isComplete
                      ? "var(--color-accent)"
                      : "var(--color-text-muted)",
                  border: isActive ? "none" : "1px solid var(--color-border)",
                }}
              >
                {isComplete ? "\u2713" : step}
              </div>
              <span
                className="text-[10px] font-medium whitespace-nowrap"
                style={{
                  color: isActive ? "var(--color-accent)" : "var(--color-text-muted)",
                }}
              >
                {STEP_LABELS[i]}
              </span>
            </div>
            {step < total && (
              <div
                className="mx-1 mb-5 h-px flex-1"
                style={{
                  backgroundColor: isComplete ? "var(--color-accent)" : "var(--color-border)",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Navigation buttons ─────────────────────────────────────────

function WizardNav({
  onBack,
  onNext,
  nextLabel = "Next",
  nextDisabled = false,
  loading = false,
  showBack = true,
}: {
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  loading?: boolean;
  showBack?: boolean;
}) {
  return (
    <div className="mt-8 flex items-center justify-between">
      {showBack && onBack ? (
        <button
          onClick={onBack}
          className="rounded-md border px-4 py-2 text-sm font-medium transition-colors"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-text-muted)",
            backgroundColor: "transparent",
          }}
        >
          Back
        </button>
      ) : (
        <div />
      )}
      {onNext && (
        <button
          onClick={onNext}
          disabled={nextDisabled || loading}
          className="rounded-md px-5 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          style={{ backgroundColor: "var(--color-accent)" }}
        >
          {loading ? "Working..." : nextLabel}
        </button>
      )}
    </div>
  );
}

// ─── Step 1: Select Target ──────────────────────────────────────

function StepSelectTarget({
  state,
  onChange,
  onNext,
}: {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
  onNext: () => void;
}) {
  const [error, setError] = useState("");

  function handleNext() {
    const trimmed = state.targetPath.trim();
    if (!trimmed) {
      setError("Please enter a directory path.");
      return;
    }
    setError("");
    onChange({ targetPath: trimmed });
    onNext();
  }

  return (
    <div>
      <h2 className="mb-1 text-lg font-semibold" style={{ color: "var(--color-text)" }}>
        Select Target Directory
      </h2>
      <p className="mb-6 text-sm" style={{ color: "var(--color-text-muted)" }}>
        Enter the path to an existing project where you want to install Rauf. Use an absolute path
        or a directory name within your root directory.
      </p>

      <label className="mb-2 block text-sm font-medium" style={{ color: "var(--color-text)" }}>
        Directory Path
      </label>
      <input
        type="text"
        value={state.targetPath}
        onChange={(e) => {
          onChange({ targetPath: e.target.value });
          if (error) setError("");
        }}
        onKeyDown={(e) => e.key === "Enter" && handleNext()}
        placeholder="/home/user/projects/my-app"
        className="w-full rounded-md border px-3 py-2 text-sm outline-none transition-colors focus:ring-2"
        style={{
          backgroundColor: "var(--color-surface)",
          borderColor: error ? "#ef4444" : "var(--color-border)",
          color: "var(--color-text)",
          // @ts-expect-error -- CSS custom property for focus ring
          "--tw-ring-color": "var(--color-accent)",
        }}
        autoFocus
      />
      {error && (
        <p className="mt-1.5 text-xs" style={{ color: "#ef4444" }}>
          {error}
        </p>
      )}

      <div
        className="mt-4 rounded-md border p-3 text-xs"
        style={{
          backgroundColor: "var(--color-surface-raised)",
          borderColor: "var(--color-border)",
          color: "var(--color-text-muted)",
        }}
      >
        <strong style={{ color: "var(--color-text)" }}>Tip:</strong> The directory should already
        contain a project (e.g., with a package.json, Cargo.toml, etc.). For creating a new project
        from scratch, use{" "}
        <Link to="/init" className="font-medium underline" style={{ color: "var(--color-accent)" }}>
          Initialize New Project
        </Link>{" "}
        instead.
      </div>

      <WizardNav onNext={handleNext} nextDisabled={!state.targetPath.trim()} showBack={false} />
    </div>
  );
}

// ─── Step 2: Preflight Checks ───────────────────────────────────

function StepPreflight({
  state,
  onChange,
  onBack,
  onNext,
}: {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const mutation = useMutation({
    mutationFn: () =>
      raufFetchJson<PreflightData>("/api/projects/preflight", {
        method: "POST",
        body: JSON.stringify({ targetPath: state.targetPath }),
      }),
    onSuccess: (data) => {
      const name = data.resolvedPath.split("/").pop() ?? "";
      onChange({
        preflightData: data,
        profile: data.detectedProfile,
        projectName: name,
      });
    },
  });

  // Auto-run preflight when entering this step
  useState(() => {
    mutation.mutate();
  });

  const checks = state.preflightData?.checks ?? mutation.data?.checks;
  const hasErrors = checks?.some((c) => !c.passed && c.severity === "error") ?? false;

  return (
    <div>
      <h2 className="mb-1 text-lg font-semibold" style={{ color: "var(--color-text)" }}>
        Preflight Checks
      </h2>
      <p className="mb-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
        Verifying that{" "}
        <code
          className="rounded px-1 py-0.5 text-xs"
          style={{
            backgroundColor: "var(--color-surface-raised)",
            border: "1px solid var(--color-border)",
          }}
        >
          {state.targetPath}
        </code>{" "}
        is ready for installation.
      </p>
      {state.preflightData?.resolvedPath &&
        state.preflightData.resolvedPath !== state.targetPath && (
          <p className="mb-4 text-xs" style={{ color: "var(--color-text-muted)" }}>
            Resolved to: {state.preflightData.resolvedPath}
          </p>
        )}

      {mutation.isPending && !checks && (
        <div className="mt-6 space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-10 animate-pulse rounded-md"
              style={{ backgroundColor: "var(--color-surface-raised)" }}
            />
          ))}
        </div>
      )}

      {mutation.isError && (
        <div
          className="mt-4 rounded-lg border p-4"
          style={{
            borderColor: "rgba(220, 38, 38, 0.3)",
            backgroundColor: "rgba(220, 38, 38, 0.05)",
            color: "#dc2626",
          }}
        >
          <p className="text-sm font-medium">Preflight check failed</p>
          <p className="mt-1 text-xs" style={{ opacity: 0.8 }}>
            {mutation.error instanceof Error ? mutation.error.message : "Unknown error"}
          </p>
        </div>
      )}

      {checks && (
        <div className="mt-4 space-y-2">
          {checks.map((check) => (
            <div
              key={check.name}
              className="flex items-start gap-3 rounded-md border px-4 py-3"
              style={{
                borderColor: check.passed
                  ? "rgba(22, 163, 74, 0.2)"
                  : check.severity === "error"
                    ? "rgba(220, 38, 38, 0.3)"
                    : "rgba(202, 138, 4, 0.3)",
                backgroundColor: check.passed
                  ? "rgba(22, 163, 74, 0.04)"
                  : check.severity === "error"
                    ? "rgba(220, 38, 38, 0.04)"
                    : "rgba(202, 138, 4, 0.04)",
              }}
            >
              <span className="mt-0.5 flex-shrink-0 text-base">
                {check.passed ? (
                  <span style={{ color: "#16a34a" }}>{"\u2713"}</span>
                ) : check.severity === "error" ? (
                  <span style={{ color: "#dc2626" }}>{"\u2717"}</span>
                ) : (
                  <span style={{ color: "#ca8a04" }}>{"\u26A0"}</span>
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                  {check.name.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                </p>
                <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                  {check.message}
                </p>
              </div>
              <span
                className="flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase"
                style={{
                  backgroundColor: check.passed
                    ? "rgba(22, 163, 74, 0.12)"
                    : check.severity === "error"
                      ? "rgba(220, 38, 38, 0.12)"
                      : "rgba(202, 138, 4, 0.12)",
                  color: check.passed
                    ? "#16a34a"
                    : check.severity === "error"
                      ? "#dc2626"
                      : "#ca8a04",
                }}
              >
                {check.passed ? "pass" : check.severity}
              </span>
            </div>
          ))}
        </div>
      )}

      <WizardNav
        onBack={onBack}
        onNext={onNext}
        nextDisabled={mutation.isPending || mutation.isError || hasErrors}
      />
    </div>
  );
}

// ─── Step 3: Tech Stack ─────────────────────────────────────────

const COMMAND_FIELDS: { key: keyof ProfileOverrides; label: string; placeholder: string }[] = [
  { key: "test", label: "Test", placeholder: "pnpm test" },
  { key: "typecheck", label: "Typecheck", placeholder: "pnpm typecheck" },
  { key: "lint", label: "Lint", placeholder: "pnpm lint" },
  { key: "build", label: "Build", placeholder: "pnpm build" },
  { key: "format", label: "Format", placeholder: "pnpm format:check" },
];

function StepTechStack({
  state,
  onChange,
  onBack,
  onNext,
}: {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const profile = state.profile;

  if (!profile) {
    return (
      <div>
        <p style={{ color: "var(--color-text-muted)" }}>No profile detected.</p>
        <WizardNav onBack={onBack} />
      </div>
    );
  }

  function handleCommandChange(key: keyof ProfileOverrides, value: string) {
    onChange({
      profileOverrides: {
        ...state.profileOverrides,
        [key]: value,
      },
    });
  }

  // Compute effective value: override if set, otherwise detected
  function effectiveCommand(key: keyof ProfileOverrides): string {
    const override = state.profileOverrides[key];
    if (override !== undefined) return override;
    return profile!.commands[key] ?? "";
  }

  return (
    <div>
      <h2 className="mb-1 text-lg font-semibold" style={{ color: "var(--color-text)" }}>
        Tech Stack
      </h2>
      <p className="mb-6 text-sm" style={{ color: "var(--color-text-muted)" }}>
        Auto-detected profile for your project. Edit any field to override.
      </p>

      {/* Detected info */}
      <div
        className="mb-6 grid grid-cols-3 gap-4 rounded-md border p-4"
        style={{
          borderColor: "var(--color-border)",
          backgroundColor: "var(--color-surface-raised)",
        }}
      >
        <div>
          <p
            className="mb-1 text-[10px] font-medium uppercase tracking-wider"
            style={{ color: "var(--color-text-muted)" }}
          >
            Stack
          </p>
          <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
            {profile.stack}
          </p>
        </div>
        <div>
          <p
            className="mb-1 text-[10px] font-medium uppercase tracking-wider"
            style={{ color: "var(--color-text-muted)" }}
          >
            Package Manager
          </p>
          <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
            {profile.packageManager ?? "N/A"}
          </p>
        </div>
        <div>
          <p
            className="mb-1 text-[10px] font-medium uppercase tracking-wider"
            style={{ color: "var(--color-text-muted)" }}
          >
            Monorepo
          </p>
          <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
            {profile.monorepo ? "Yes" : "No"}
          </p>
        </div>
      </div>

      {/* Command overrides */}
      <h3 className="mb-3 text-sm font-semibold" style={{ color: "var(--color-text)" }}>
        Verification Commands
      </h3>
      <div className="space-y-3">
        {COMMAND_FIELDS.map(({ key, label, placeholder }) => {
          const detected = profile.commands[key];
          const isOverridden = state.profileOverrides[key] !== undefined;
          return (
            <div key={key}>
              <div className="mb-1 flex items-center gap-2">
                <label className="text-xs font-medium" style={{ color: "var(--color-text)" }}>
                  {label}
                </label>
                {detected && !isOverridden && (
                  <span
                    className="rounded px-1 py-0.5 text-[10px]"
                    style={{
                      backgroundColor: "rgba(22, 163, 74, 0.1)",
                      color: "#16a34a",
                    }}
                  >
                    auto-detected
                  </span>
                )}
                {isOverridden && (
                  <button
                    onClick={() => {
                      const next = { ...state.profileOverrides };
                      delete next[key];
                      onChange({ profileOverrides: next });
                    }}
                    className="rounded px-1 py-0.5 text-[10px]"
                    style={{
                      backgroundColor: "rgba(99, 102, 241, 0.1)",
                      color: "var(--color-accent)",
                    }}
                  >
                    reset
                  </button>
                )}
              </div>
              <input
                type="text"
                value={effectiveCommand(key)}
                onChange={(e) => handleCommandChange(key, e.target.value)}
                placeholder={placeholder}
                className="w-full rounded-md border px-3 py-1.5 font-mono text-sm outline-none transition-colors focus:ring-2"
                style={{
                  backgroundColor: "var(--color-surface)",
                  borderColor: "var(--color-border)",
                  color: "var(--color-text)",
                }}
              />
            </div>
          );
        })}
      </div>

      <WizardNav onBack={onBack} onNext={onNext} />
    </div>
  );
}

// ─── Step 4: Configure ──────────────────────────────────────────

function StepConfigure({
  state,
  onChange,
  onBack,
  onNext,
}: {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div>
      <h2 className="mb-1 text-lg font-semibold" style={{ color: "var(--color-text)" }}>
        Configure Installation
      </h2>
      <p className="mb-6 text-sm" style={{ color: "var(--color-text-muted)" }}>
        Customize project settings for the Rauf loop.
      </p>

      <div className="space-y-5">
        {/* Project name */}
        <div>
          <label className="mb-1 block text-sm font-medium" style={{ color: "var(--color-text)" }}>
            Project Name
          </label>
          <input
            type="text"
            value={state.projectName}
            onChange={(e) => onChange({ projectName: e.target.value })}
            placeholder="my-project"
            className="w-full rounded-md border px-3 py-2 text-sm outline-none transition-colors focus:ring-2"
            style={{
              backgroundColor: "var(--color-surface)",
              borderColor: "var(--color-border)",
              color: "var(--color-text)",
            }}
          />
          <p className="mt-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
            Used in the backlog.json project field and RAUF.md template.
          </p>
        </div>

        {/* Max iterations */}
        <div>
          <label className="mb-1 block text-sm font-medium" style={{ color: "var(--color-text)" }}>
            Max Iterations Per Run
          </label>
          <input
            type="number"
            value={state.maxIterations}
            onChange={(e) =>
              onChange({ maxIterations: Math.max(1, parseInt(e.target.value) || 20) })
            }
            min={1}
            max={999}
            className="w-32 rounded-md border px-3 py-2 text-sm outline-none transition-colors focus:ring-2"
            style={{
              backgroundColor: "var(--color-surface)",
              borderColor: "var(--color-border)",
              color: "var(--color-text)",
            }}
          />
          <p className="mt-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
            How many backlog items the loop processes before stopping. Default: 20.
          </p>
        </div>

        {/* Gitignore toggle */}
        <div
          className="flex items-center justify-between rounded-md border px-4 py-3"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "var(--color-surface-raised)",
          }}
        >
          <div>
            <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
              Update .gitignore
            </p>
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              Add ralph runtime files (state.json, rauf.log, DONE) to .gitignore.
            </p>
          </div>
          <button
            onClick={() => onChange({ updateGitignore: !state.updateGitignore })}
            className="relative h-6 w-11 rounded-full transition-colors"
            style={{
              backgroundColor: state.updateGitignore
                ? "var(--color-accent)"
                : "var(--color-border)",
            }}
          >
            <span
              className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
              style={{
                transform: state.updateGitignore ? "translateX(22px)" : "translateX(2px)",
              }}
            />
          </button>
        </div>
      </div>

      <WizardNav onBack={onBack} onNext={onNext} />
    </div>
  );
}

// ─── Step 5: Review ─────────────────────────────────────────────

function StepReview({
  state,
  onBack,
  onNext,
  loading,
}: {
  state: WizardState;
  onBack: () => void;
  onNext: () => void;
  loading: boolean;
}) {
  const profile = state.profile;

  // Compute effective commands (with overrides applied)
  function getEffectiveVerify(): string {
    if (!profile) return "";
    const commands: string[] = [];
    for (const key of ["test", "typecheck", "lint", "build", "format"] as const) {
      const override = state.profileOverrides[key];
      const value = override !== undefined ? override : profile.commands[key];
      if (value) commands.push(value);
    }
    return commands.join(" && ");
  }

  const FILES_TO_CREATE = [
    { file: ".rauf/RAUF.md", location: ".rauf/", description: "Per-iteration instructions" },
    {
      file: ".rauf/backlog.json",
      location: ".rauf/",
      description: "Task queue (created if missing)",
    },
    {
      file: ".rauf/progress.md",
      location: ".rauf/",
      description: "Accumulated learnings log",
    },
    { file: "CLAUDE.md", location: "project root", description: "Smart-merged ralph section" },
    {
      file: ".rauf.json",
      location: "project root",
      description: "Marker file with profile & hashes",
    },
  ];

  return (
    <div>
      <h2 className="mb-1 text-lg font-semibold" style={{ color: "var(--color-text)" }}>
        Review Installation
      </h2>
      <p className="mb-6 text-sm" style={{ color: "var(--color-text-muted)" }}>
        Review the configuration before installing Rauf into your project.
      </p>

      {/* Summary */}
      <div
        className="mb-5 rounded-md border p-4"
        style={{
          borderColor: "var(--color-border)",
          backgroundColor: "var(--color-surface-raised)",
        }}
      >
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p
              className="text-[10px] font-medium uppercase tracking-wider"
              style={{ color: "var(--color-text-muted)" }}
            >
              Target
            </p>
            <p className="mt-0.5 font-mono text-xs" style={{ color: "var(--color-text)" }}>
              {state.preflightData?.resolvedPath ?? state.targetPath}
            </p>
          </div>
          <div>
            <p
              className="text-[10px] font-medium uppercase tracking-wider"
              style={{ color: "var(--color-text-muted)" }}
            >
              Project Name
            </p>
            <p className="mt-0.5" style={{ color: "var(--color-text)" }}>
              {state.projectName || "(auto)"}
            </p>
          </div>
          <div>
            <p
              className="text-[10px] font-medium uppercase tracking-wider"
              style={{ color: "var(--color-text-muted)" }}
            >
              Stack
            </p>
            <p className="mt-0.5" style={{ color: "var(--color-text)" }}>
              {profile?.stack ?? "unknown"}
              {profile?.packageManager ? ` (${profile.packageManager})` : ""}
            </p>
          </div>
          <div>
            <p
              className="text-[10px] font-medium uppercase tracking-wider"
              style={{ color: "var(--color-text-muted)" }}
            >
              Max Iterations
            </p>
            <p className="mt-0.5" style={{ color: "var(--color-text)" }}>
              {state.maxIterations}
            </p>
          </div>
        </div>
      </div>

      {/* RAUF.md Verification Section */}
      <h3 className="mb-2 text-sm font-semibold" style={{ color: "var(--color-text)" }}>
        RAUF.md Verification Commands
      </h3>
      <div
        className="mb-5 overflow-x-auto rounded-md border p-3 font-mono text-xs"
        style={{
          backgroundColor: "var(--color-surface)",
          borderColor: "var(--color-border)",
          color: "var(--color-text)",
        }}
      >
        <pre className="whitespace-pre-wrap">
          {getEffectiveVerify() || "(no verification commands)"}
        </pre>
      </div>

      {/* File preview */}
      <h3 className="mb-2 text-sm font-semibold" style={{ color: "var(--color-text)" }}>
        Files to Create / Modify
      </h3>
      <div
        className="divide-y rounded-md border"
        style={{
          borderColor: "var(--color-border)",
          // @ts-expect-error -- CSS custom property for divide color
          "--tw-divide-color": "var(--color-border)",
        }}
      >
        {FILES_TO_CREATE.map(({ file, location, description }) => (
          <div
            key={file}
            className="flex items-center gap-3 px-4 py-2.5"
            style={{ backgroundColor: "var(--color-surface-raised)" }}
          >
            <span className="text-xs" style={{ color: "var(--color-accent)" }}>
              +
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-xs font-medium" style={{ color: "var(--color-text)" }}>
                {file}
              </p>
              <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                {description}
              </p>
            </div>
            <span
              className="flex-shrink-0 rounded px-1.5 py-0.5 text-[10px]"
              style={{
                backgroundColor: "var(--color-surface)",
                color: "var(--color-text-muted)",
                border: "1px solid var(--color-border)",
              }}
            >
              {location}
            </span>
          </div>
        ))}
      </div>

      <WizardNav onBack={onBack} onNext={onNext} nextLabel="Install Rauf" loading={loading} />
    </div>
  );
}

// ─── Step 6: Result ─────────────────────────────────────────────

function StepResult({ state }: { state: WizardState }) {
  const report = state.installReport;

  if (!report) {
    return (
      <div>
        <p style={{ color: "var(--color-text-muted)" }}>No installation report available.</p>
      </div>
    );
  }

  // Derive project id from resolved path (last segment)
  const projectId = report.projectPath.split("/").pop() ?? "";

  return (
    <div>
      <div className="mb-6 flex items-start gap-3">
        <div
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-lg"
          style={{ backgroundColor: "rgba(22, 163, 74, 0.12)", color: "#16a34a" }}
        >
          {"\u2713"}
        </div>
        <div>
          <h2 className="text-lg font-semibold" style={{ color: "var(--color-text)" }}>
            Installation Complete
          </h2>
          <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
            Rauf has been installed in{" "}
            <span className="font-mono text-xs" style={{ color: "var(--color-text)" }}>
              {report.projectPath}
            </span>
          </p>
        </div>
      </div>

      {/* Actions list */}
      <h3 className="mb-2 text-sm font-semibold" style={{ color: "var(--color-text)" }}>
        Actions Performed
      </h3>
      <div
        className="mb-5 divide-y rounded-md border"
        style={{
          borderColor: "var(--color-border)",
          // @ts-expect-error -- CSS custom property for divide color
          "--tw-divide-color": "var(--color-border)",
        }}
      >
        {report.actions.map((action, i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-4 py-2"
            style={{ backgroundColor: "var(--color-surface-raised)" }}
          >
            <span
              className="flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase"
              style={{
                backgroundColor:
                  action.action === "created"
                    ? "rgba(22, 163, 74, 0.12)"
                    : action.action === "skipped"
                      ? "rgba(107, 114, 128, 0.12)"
                      : "rgba(37, 99, 235, 0.12)",
                color:
                  action.action === "created"
                    ? "#16a34a"
                    : action.action === "skipped"
                      ? "#6b7280"
                      : "#2563eb",
              }}
            >
              {action.action}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-xs" style={{ color: "var(--color-text)" }}>
                {action.file}
              </p>
              <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                {action.detail}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Warnings */}
      {report.warnings.length > 0 && (
        <div className="mb-5">
          <h3 className="mb-2 text-sm font-semibold" style={{ color: "var(--color-text)" }}>
            Warnings
          </h3>
          <div
            className="space-y-1 rounded-md border p-3"
            style={{
              borderColor: "rgba(202, 138, 4, 0.3)",
              backgroundColor: "rgba(202, 138, 4, 0.04)",
            }}
          >
            {report.warnings.map((w, i) => (
              <p key={i} className="text-xs" style={{ color: "#ca8a04" }}>
                {"\u26A0"} {w}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Quick links */}
      <h3 className="mb-2 text-sm font-semibold" style={{ color: "var(--color-text)" }}>
        Quick Links
      </h3>
      <div className="flex flex-wrap gap-2">
        <Link
          to="/projects/$id/backlog"
          params={{ id: projectId }}
          className="rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:shadow-sm"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-text)",
            backgroundColor: "var(--color-surface-raised)",
          }}
        >
          View Backlog
        </Link>
        <Link
          to="/projects/$id/status"
          params={{ id: projectId }}
          className="rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:shadow-sm"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-text)",
            backgroundColor: "var(--color-surface-raised)",
          }}
        >
          View Status
        </Link>
        <Link
          to="/projects/$id/settings"
          params={{ id: projectId }}
          className="rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:shadow-sm"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-text)",
            backgroundColor: "var(--color-surface-raised)",
          }}
        >
          Project Settings
        </Link>
        <Link
          to="/projects"
          className="rounded-md px-4 py-2 text-sm font-medium text-white transition-colors"
          style={{ backgroundColor: "var(--color-accent)" }}
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}

// ─── InstallWizard (main) ───────────────────────────────────────

export function InstallWizard() {
  const [state, setState] = useState<WizardState>(INITIAL_STATE);
  const queryClient = useQueryClient();

  const onChange = useCallback((patch: Partial<WizardState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  const goBack = useCallback(() => {
    setState((prev) => ({ ...prev, step: Math.max(1, prev.step - 1) }));
  }, []);

  const goNext = useCallback(() => {
    setState((prev) => ({ ...prev, step: Math.min(STEP_LABELS.length, prev.step + 1) }));
  }, []);

  // Build the profileOverrides, filtering out empty strings and unmodified values
  function buildOverrides(): ProfileOverrides | undefined {
    const overrides: ProfileOverrides = {};
    let hasOverrides = false;
    for (const key of ["test", "typecheck", "lint", "build", "format"] as const) {
      if (state.profileOverrides[key] !== undefined) {
        overrides[key] = state.profileOverrides[key];
        hasOverrides = true;
      }
    }
    return hasOverrides ? overrides : undefined;
  }

  // Install mutation
  const installMutation = useMutation({
    mutationFn: () => {
      const resolvedPath = state.preflightData?.resolvedPath ?? state.targetPath;
      const projectId = resolvedPath.split("/").pop() ?? "";
      return raufFetchJson<InstallationReport>(
        `/api/projects/${encodeURIComponent(projectId)}/install`,
        {
          method: "POST",
          body: JSON.stringify({
            profileOverrides: buildOverrides(),
          }),
        },
      );
    },
    onSuccess: (data) => {
      onChange({ installReport: data, step: 6 });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  function handleInstall() {
    installMutation.mutate();
  }

  return (
    <div className="p-6">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-1 text-2xl font-semibold" style={{ color: "var(--color-text)" }}>
          Install Rauf
        </h1>
        <p className="mb-6 text-sm" style={{ color: "var(--color-text-muted)" }}>
          Install Rauf into an existing project directory.
        </p>

        <StepIndicator current={state.step} total={STEP_LABELS.length} />

        {/* Install error banner */}
        {installMutation.isError && state.step === 5 && (
          <div
            className="mb-4 rounded-lg border p-4"
            style={{
              borderColor: "rgba(220, 38, 38, 0.3)",
              backgroundColor: "rgba(220, 38, 38, 0.05)",
              color: "#dc2626",
            }}
          >
            <p className="text-sm font-medium">Installation failed</p>
            <p className="mt-1 text-xs" style={{ opacity: 0.8 }}>
              {installMutation.error instanceof Error
                ? installMutation.error.message
                : "Unknown error"}
            </p>
          </div>
        )}

        {state.step === 1 && <StepSelectTarget state={state} onChange={onChange} onNext={goNext} />}
        {state.step === 2 && (
          <StepPreflight state={state} onChange={onChange} onBack={goBack} onNext={goNext} />
        )}
        {state.step === 3 && (
          <StepTechStack state={state} onChange={onChange} onBack={goBack} onNext={goNext} />
        )}
        {state.step === 4 && (
          <StepConfigure state={state} onChange={onChange} onBack={goBack} onNext={goNext} />
        )}
        {state.step === 5 && (
          <StepReview
            state={state}
            onBack={goBack}
            onNext={handleInstall}
            loading={installMutation.isPending}
          />
        )}
        {state.step === 6 && <StepResult state={state} />}
      </div>
    </div>
  );
}
