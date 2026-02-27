import { useState, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { InstallationReport, ProfileOverrides, BacklogItemType } from "@ralph/core";
import { ralphFetchJson } from "../lib/fetch";

// ─── Types ───────────────────────────────────────────────────────

interface SeedItem {
  type: BacklogItemType;
  priority: 1 | 2 | 3 | 4;
  title: string;
  description: string;
}

type BacklogMode = "empty" | "inline";

interface WizardState {
  step: number;
  // Step 1 — Project Info
  projectName: string;
  targetPath: string;
  description: string;
  // Step 2 — Tech Stack
  preset: string;
  profileOverrides: ProfileOverrides;
  // Step 3 — Backlog
  backlogMode: BacklogMode;
  seedItems: SeedItem[];
  // Step 5 — Result (computed)
  initReport: InstallationReport | null;
}

const INITIAL_STATE: WizardState = {
  step: 1,
  projectName: "",
  targetPath: "",
  description: "",
  preset: "node-typescript",
  profileOverrides: {},
  backlogMode: "empty",
  seedItems: [],
  initReport: null,
};

const STEP_LABELS = ["Project Info", "Tech Stack", "Backlog", "Review", "Result"];

const PRESETS: { value: string; label: string; description: string }[] = [
  { value: "node-typescript", label: "Node.js + TypeScript", description: "pnpm/npm/yarn/bun" },
  { value: "node-javascript", label: "Node.js (JavaScript)", description: "pnpm/npm/yarn/bun" },
  { value: "python", label: "Python", description: "pytest, mypy, ruff" },
  { value: "go", label: "Go", description: "go test, go vet, go build" },
  { value: "rust", label: "Rust", description: "cargo test, cargo clippy" },
  { value: "custom", label: "Custom", description: "No preset commands" },
];

const COMMAND_FIELDS: { key: keyof ProfileOverrides; label: string; placeholder: string }[] = [
  { key: "test", label: "Test", placeholder: "pnpm test" },
  { key: "typecheck", label: "Typecheck", placeholder: "pnpm typecheck" },
  { key: "lint", label: "Lint", placeholder: "pnpm lint" },
  { key: "build", label: "Build", placeholder: "pnpm build" },
  { key: "format", label: "Format", placeholder: "pnpm format:check" },
];

const ITEM_TYPES: BacklogItemType[] = ["feature", "bug", "chore", "refactor"];

// ─── Preset defaults (mirror of core's PRESETS) ──────────────────

const PRESET_COMMANDS: Record<string, Record<string, string | null>> = {
  "node-typescript": {
    test: "npm test",
    typecheck: "npx tsc --noEmit",
    lint: "npm run lint",
    build: "npm run build",
    format: null,
  },
  "node-javascript": {
    test: "npm test",
    typecheck: null,
    lint: "npm run lint",
    build: "npm run build",
    format: null,
  },
  python: {
    test: "pytest",
    typecheck: "mypy .",
    lint: "ruff check .",
    build: null,
    format: "ruff format --check .",
  },
  go: {
    test: "go test ./...",
    typecheck: "go vet ./...",
    lint: null,
    build: "go build ./...",
    format: null,
  },
  rust: {
    test: "cargo test",
    typecheck: "cargo check",
    lint: "cargo clippy",
    build: "cargo build",
    format: null,
  },
  custom: { test: null, typecheck: null, lint: null, build: null, format: null },
};

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

// ─── Step 1: Project Info ────────────────────────────────────────

function StepProjectInfo({
  state,
  onChange,
  onNext,
}: {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
  onNext: () => void;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});

  function handleNext() {
    const errs: Record<string, string> = {};
    if (!state.projectName.trim()) errs.projectName = "Project name is required.";
    if (!state.targetPath.trim()) errs.targetPath = "Directory path is required.";
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});
    onChange({
      projectName: state.projectName.trim(),
      targetPath: state.targetPath.trim(),
      description: state.description.trim(),
    });
    onNext();
  }

  return (
    <div>
      <h2 className="mb-1 text-lg font-semibold" style={{ color: "var(--color-text)" }}>
        Project Info
      </h2>
      <p className="mb-6 text-sm" style={{ color: "var(--color-text-muted)" }}>
        Create a new project from scratch. Ralph will initialize git, generate CLAUDE.md, and set up
        the loop infrastructure.
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
            onChange={(e) => {
              onChange({ projectName: e.target.value });
              if (errors.projectName) setErrors((prev) => ({ ...prev, projectName: "" }));
            }}
            onKeyDown={(e) => e.key === "Enter" && handleNext()}
            placeholder="my-awesome-project"
            className="w-full rounded-md border px-3 py-2 text-sm outline-none transition-colors focus:ring-2"
            style={{
              backgroundColor: "var(--color-surface)",
              borderColor: errors.projectName ? "#ef4444" : "var(--color-border)",
              color: "var(--color-text)",
            }}
            autoFocus
          />
          {errors.projectName && (
            <p className="mt-1 text-xs" style={{ color: "#ef4444" }}>
              {errors.projectName}
            </p>
          )}
          <p className="mt-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
            Used in backlog.json and CLAUDE.md. Also used as directory name if path is relative.
          </p>
        </div>

        {/* Directory path */}
        <div>
          <label className="mb-1 block text-sm font-medium" style={{ color: "var(--color-text)" }}>
            Directory Path
          </label>
          <input
            type="text"
            value={state.targetPath}
            onChange={(e) => {
              onChange({ targetPath: e.target.value });
              if (errors.targetPath) setErrors((prev) => ({ ...prev, targetPath: "" }));
            }}
            onKeyDown={(e) => e.key === "Enter" && handleNext()}
            placeholder="/home/user/projects/my-awesome-project"
            className="w-full rounded-md border px-3 py-2 font-mono text-sm outline-none transition-colors focus:ring-2"
            style={{
              backgroundColor: "var(--color-surface)",
              borderColor: errors.targetPath ? "#ef4444" : "var(--color-border)",
              color: "var(--color-text)",
            }}
          />
          {errors.targetPath && (
            <p className="mt-1 text-xs" style={{ color: "#ef4444" }}>
              {errors.targetPath}
            </p>
          )}
          <p className="mt-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
            Where to create the project. The directory will be created if it doesn't exist.
          </p>
        </div>

        {/* Description */}
        <div>
          <label className="mb-1 block text-sm font-medium" style={{ color: "var(--color-text)" }}>
            Description{" "}
            <span className="font-normal" style={{ color: "var(--color-text-muted)" }}>
              (optional)
            </span>
          </label>
          <textarea
            value={state.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder="A brief description of the project for CLAUDE.md..."
            rows={3}
            className="w-full rounded-md border px-3 py-2 text-sm outline-none transition-colors focus:ring-2"
            style={{
              backgroundColor: "var(--color-surface)",
              borderColor: "var(--color-border)",
              color: "var(--color-text)",
              resize: "vertical",
            }}
          />
        </div>
      </div>

      <div
        className="mt-4 rounded-md border p-3 text-xs"
        style={{
          backgroundColor: "var(--color-surface-raised)",
          borderColor: "var(--color-border)",
          color: "var(--color-text-muted)",
        }}
      >
        <strong style={{ color: "var(--color-text)" }}>Tip:</strong> For installing Ralph into an
        existing project, use{" "}
        <Link
          to="/install"
          className="font-medium underline"
          style={{ color: "var(--color-accent)" }}
        >
          Install Ralph
        </Link>{" "}
        instead.
      </div>

      <WizardNav onNext={handleNext} nextDisabled={false} showBack={false} />
    </div>
  );
}

// ─── Step 2: Tech Stack ──────────────────────────────────────────

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
  function handlePresetChange(preset: string) {
    // Reset overrides when switching preset
    onChange({ preset, profileOverrides: {} });
  }

  function handleCommandChange(key: keyof ProfileOverrides, value: string) {
    onChange({
      profileOverrides: {
        ...state.profileOverrides,
        [key]: value,
      },
    });
  }

  // Effective command: override > preset default
  function effectiveCommand(key: keyof ProfileOverrides): string {
    const override = state.profileOverrides[key];
    if (override !== undefined) return override;
    return PRESET_COMMANDS[state.preset]?.[key] ?? "";
  }

  return (
    <div>
      <h2 className="mb-1 text-lg font-semibold" style={{ color: "var(--color-text)" }}>
        Tech Stack
      </h2>
      <p className="mb-6 text-sm" style={{ color: "var(--color-text-muted)" }}>
        Choose a preset for your project's tech stack. Commands can be customized below.
      </p>

      {/* Preset selector */}
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {PRESETS.map((p) => {
          const isSelected = state.preset === p.value;
          return (
            <button
              key={p.value}
              onClick={() => handlePresetChange(p.value)}
              className="rounded-md border px-3 py-3 text-left transition-colors"
              style={{
                borderColor: isSelected ? "var(--color-accent)" : "var(--color-border)",
                backgroundColor: isSelected
                  ? "rgba(99, 102, 241, 0.08)"
                  : "var(--color-surface-raised)",
              }}
            >
              <p
                className="text-sm font-semibold"
                style={{ color: isSelected ? "var(--color-accent)" : "var(--color-text)" }}
              >
                {p.label}
              </p>
              <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                {p.description}
              </p>
            </button>
          );
        })}
      </div>

      {/* Command overrides */}
      <h3 className="mb-3 text-sm font-semibold" style={{ color: "var(--color-text)" }}>
        Verification Commands
      </h3>
      <div className="space-y-3">
        {COMMAND_FIELDS.map(({ key, label, placeholder }) => {
          const presetDefault = PRESET_COMMANDS[state.preset]?.[key] ?? null;
          const isOverridden = state.profileOverrides[key] !== undefined;
          return (
            <div key={key}>
              <div className="mb-1 flex items-center gap-2">
                <label className="text-xs font-medium" style={{ color: "var(--color-text)" }}>
                  {label}
                </label>
                {presetDefault && !isOverridden && (
                  <span
                    className="rounded px-1 py-0.5 text-[10px]"
                    style={{
                      backgroundColor: "rgba(22, 163, 74, 0.1)",
                      color: "#16a34a",
                    }}
                  >
                    preset
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

// ─── Step 3: Initial Backlog ─────────────────────────────────────

function StepBacklog({
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
  function addItem() {
    onChange({
      seedItems: [...state.seedItems, { type: "feature", priority: 2, title: "", description: "" }],
    });
  }

  function updateSeedItem(index: number, patch: Partial<SeedItem>) {
    const updated = state.seedItems.map((item, i) => (i === index ? { ...item, ...patch } : item));
    onChange({ seedItems: updated });
  }

  function removeSeedItem(index: number) {
    onChange({ seedItems: state.seedItems.filter((_, i) => i !== index) });
  }

  function handleModeChange(mode: BacklogMode) {
    onChange({
      backlogMode: mode,
      seedItems: mode === "empty" ? [] : state.seedItems,
    });
  }

  return (
    <div>
      <h2 className="mb-1 text-lg font-semibold" style={{ color: "var(--color-text)" }}>
        Initial Backlog
      </h2>
      <p className="mb-6 text-sm" style={{ color: "var(--color-text-muted)" }}>
        Optionally seed the backlog with initial work items. You can always add items later.
      </p>

      {/* Mode toggle */}
      <div className="mb-6 flex gap-2">
        {(
          [
            { mode: "empty" as const, label: "Start Empty", desc: "No initial items" },
            { mode: "inline" as const, label: "Add Items", desc: "Enter items now" },
          ] as const
        ).map(({ mode, label, desc }) => {
          const isSelected = state.backlogMode === mode;
          return (
            <button
              key={mode}
              onClick={() => handleModeChange(mode)}
              className="flex-1 rounded-md border px-3 py-3 text-left transition-colors"
              style={{
                borderColor: isSelected ? "var(--color-accent)" : "var(--color-border)",
                backgroundColor: isSelected
                  ? "rgba(99, 102, 241, 0.08)"
                  : "var(--color-surface-raised)",
              }}
            >
              <p
                className="text-sm font-semibold"
                style={{ color: isSelected ? "var(--color-accent)" : "var(--color-text)" }}
              >
                {label}
              </p>
              <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                {desc}
              </p>
            </button>
          );
        })}
      </div>

      {/* Inline items */}
      {state.backlogMode === "inline" && (
        <div>
          {state.seedItems.length === 0 && (
            <div
              className="mb-4 rounded-md border p-6 text-center"
              style={{
                borderColor: "var(--color-border)",
                borderStyle: "dashed",
                backgroundColor: "var(--color-surface-raised)",
              }}
            >
              <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                No items yet. Click below to add your first backlog item.
              </p>
            </div>
          )}

          <div className="space-y-3">
            {state.seedItems.map((item, i) => (
              <div
                key={i}
                className="rounded-md border p-4"
                style={{
                  borderColor: "var(--color-border)",
                  backgroundColor: "var(--color-surface-raised)",
                }}
              >
                <div className="mb-3 flex items-center justify-between">
                  <span
                    className="text-xs font-semibold"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    Item {i + 1}
                  </span>
                  <button
                    onClick={() => removeSeedItem(i)}
                    className="rounded px-2 py-0.5 text-xs transition-colors"
                    style={{ color: "#dc2626" }}
                  >
                    Remove
                  </button>
                </div>

                <div className="mb-3">
                  <input
                    type="text"
                    value={item.title}
                    onChange={(e) => updateSeedItem(i, { title: e.target.value })}
                    placeholder="Item title"
                    className="w-full rounded-md border px-3 py-1.5 text-sm outline-none transition-colors focus:ring-2"
                    style={{
                      backgroundColor: "var(--color-surface)",
                      borderColor: "var(--color-border)",
                      color: "var(--color-text)",
                    }}
                  />
                </div>

                <div className="flex gap-3">
                  <div className="flex-1">
                    <label
                      className="mb-1 block text-[10px] font-medium"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      Type
                    </label>
                    <select
                      value={item.type}
                      onChange={(e) =>
                        updateSeedItem(i, { type: e.target.value as BacklogItemType })
                      }
                      className="w-full rounded-md border px-2 py-1.5 text-sm outline-none"
                      style={{
                        backgroundColor: "var(--color-surface)",
                        borderColor: "var(--color-border)",
                        color: "var(--color-text)",
                      }}
                    >
                      {ITEM_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="w-24">
                    <label
                      className="mb-1 block text-[10px] font-medium"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      Priority
                    </label>
                    <select
                      value={item.priority}
                      onChange={(e) =>
                        updateSeedItem(i, {
                          priority: parseInt(e.target.value) as 1 | 2 | 3 | 4,
                        })
                      }
                      className="w-full rounded-md border px-2 py-1.5 text-sm outline-none"
                      style={{
                        backgroundColor: "var(--color-surface)",
                        borderColor: "var(--color-border)",
                        color: "var(--color-text)",
                      }}
                    >
                      <option value="1">P1</option>
                      <option value="2">P2</option>
                      <option value="3">P3</option>
                      <option value="4">P4</option>
                    </select>
                  </div>
                </div>

                <div className="mt-3">
                  <input
                    type="text"
                    value={item.description}
                    onChange={(e) => updateSeedItem(i, { description: e.target.value })}
                    placeholder="Description (optional)"
                    className="w-full rounded-md border px-3 py-1.5 text-sm outline-none transition-colors focus:ring-2"
                    style={{
                      backgroundColor: "var(--color-surface)",
                      borderColor: "var(--color-border)",
                      color: "var(--color-text)",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={addItem}
            className="mt-3 w-full rounded-md border px-4 py-2 text-sm font-medium transition-colors"
            style={{
              borderColor: "var(--color-border)",
              color: "var(--color-accent)",
              backgroundColor: "transparent",
              borderStyle: "dashed",
            }}
          >
            + Add Item
          </button>
        </div>
      )}

      <WizardNav onBack={onBack} onNext={onNext} />
    </div>
  );
}

// ─── Step 4: Review ──────────────────────────────────────────────

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
  // Compute effective verify command
  function getEffectiveVerify(): string {
    const commands: string[] = [];
    for (const key of ["test", "typecheck", "lint", "build", "format"] as const) {
      const override = state.profileOverrides[key];
      const value =
        override !== undefined ? override : (PRESET_COMMANDS[state.preset]?.[key] ?? null);
      if (value) commands.push(value);
    }
    return commands.join(" && ");
  }

  const presetLabel = PRESETS.find((p) => p.value === state.preset)?.label ?? state.preset;

  const FILES_TO_CREATE = [
    { file: "CLAUDE.md", description: "Project instructions with ralph loop section" },
    { file: ".gitignore", description: "Stack-appropriate gitignore" },
    { file: ".ralph/RALPH.md", description: "Per-iteration instructions" },
    { file: ".ralph/backlog.json", description: "Task queue" },
    { file: ".ralph/progress.md", description: "Accumulated learnings log" },
    { file: ".ralph.json", description: "Marker file with profile & hashes" },
  ];

  return (
    <div>
      <h2 className="mb-1 text-lg font-semibold" style={{ color: "var(--color-text)" }}>
        Review
      </h2>
      <p className="mb-6 text-sm" style={{ color: "var(--color-text-muted)" }}>
        Review the configuration before creating your project.
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
              Project Name
            </p>
            <p className="mt-0.5 font-semibold" style={{ color: "var(--color-text)" }}>
              {state.projectName}
            </p>
          </div>
          <div>
            <p
              className="text-[10px] font-medium uppercase tracking-wider"
              style={{ color: "var(--color-text-muted)" }}
            >
              Target Path
            </p>
            <p className="mt-0.5 font-mono text-xs" style={{ color: "var(--color-text)" }}>
              {state.targetPath}
            </p>
          </div>
          <div>
            <p
              className="text-[10px] font-medium uppercase tracking-wider"
              style={{ color: "var(--color-text-muted)" }}
            >
              Tech Stack
            </p>
            <p className="mt-0.5" style={{ color: "var(--color-text)" }}>
              {presetLabel}
            </p>
          </div>
          <div>
            <p
              className="text-[10px] font-medium uppercase tracking-wider"
              style={{ color: "var(--color-text-muted)" }}
            >
              Backlog Items
            </p>
            <p className="mt-0.5" style={{ color: "var(--color-text)" }}>
              {state.backlogMode === "empty" ? "Empty (none)" : `${state.seedItems.length} item(s)`}
            </p>
          </div>
        </div>
        {state.description && (
          <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
            <p
              className="text-[10px] font-medium uppercase tracking-wider"
              style={{ color: "var(--color-text-muted)" }}
            >
              Description
            </p>
            <p className="mt-0.5 text-sm" style={{ color: "var(--color-text)" }}>
              {state.description}
            </p>
          </div>
        )}
      </div>

      {/* CLAUDE.md preview */}
      <h3 className="mb-2 text-sm font-semibold" style={{ color: "var(--color-text)" }}>
        CLAUDE.md Verification Commands
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
        Files to Create
      </h3>
      <div
        className="mb-5 divide-y rounded-md border"
        style={{
          borderColor: "var(--color-border)",
          // @ts-expect-error -- CSS custom property for divide color
          "--tw-divide-color": "var(--color-border)",
        }}
      >
        {FILES_TO_CREATE.map(({ file, description }) => (
          <div
            key={file}
            className="flex items-center gap-3 px-4 py-2.5"
            style={{ backgroundColor: "var(--color-surface-raised)" }}
          >
            <span className="text-xs" style={{ color: "#16a34a" }}>
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
          </div>
        ))}
      </div>

      {/* Backlog preview */}
      {state.backlogMode === "inline" && state.seedItems.length > 0 && (
        <>
          <h3 className="mb-2 text-sm font-semibold" style={{ color: "var(--color-text)" }}>
            Backlog Items
          </h3>
          <div
            className="mb-5 divide-y rounded-md border"
            style={{
              borderColor: "var(--color-border)",
              // @ts-expect-error -- CSS custom property for divide color
              "--tw-divide-color": "var(--color-border)",
            }}
          >
            {state.seedItems.map((item, i) => (
              <div
                key={i}
                className="flex items-center gap-3 px-4 py-2.5"
                style={{ backgroundColor: "var(--color-surface-raised)" }}
              >
                <span
                  className="flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase"
                  style={{
                    backgroundColor: "rgba(99, 102, 241, 0.1)",
                    color: "var(--color-accent)",
                  }}
                >
                  {item.type}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium" style={{ color: "var(--color-text)" }}>
                    {item.title || "(untitled)"}
                  </p>
                  {item.description && (
                    <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                      {item.description}
                    </p>
                  )}
                </div>
                <span
                  className="flex-shrink-0 text-[10px] font-medium"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  P{item.priority}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <WizardNav onBack={onBack} onNext={onNext} nextLabel="Create Project" loading={loading} />
    </div>
  );
}

// ─── Step 5: Result ──────────────────────────────────────────────

function StepResult({ state }: { state: WizardState }) {
  const report = state.initReport;

  if (!report) {
    return (
      <div>
        <p style={{ color: "var(--color-text-muted)" }}>No initialization report available.</p>
      </div>
    );
  }

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
            Project Created
          </h2>
          <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
            <span className="font-semibold" style={{ color: "var(--color-text)" }}>
              {report.projectName}
            </span>{" "}
            has been initialized at{" "}
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

      {/* Next steps */}
      <h3 className="mb-2 text-sm font-semibold" style={{ color: "var(--color-text)" }}>
        Next Steps
      </h3>
      <div
        className="mb-5 space-y-2 rounded-md border p-4"
        style={{
          borderColor: "var(--color-border)",
          backgroundColor: "var(--color-surface-raised)",
        }}
      >
        <div className="flex gap-3 text-sm">
          <span style={{ color: "var(--color-accent)" }}>1.</span>
          <p style={{ color: "var(--color-text)" }}>
            Add backlog items via the dashboard or{" "}
            <code
              className="rounded px-1 py-0.5 text-xs"
              style={{
                backgroundColor: "var(--color-surface)",
                border: "1px solid var(--color-border)",
              }}
            >
              ralph backlog add
            </code>
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          <span style={{ color: "var(--color-accent)" }}>2.</span>
          <p style={{ color: "var(--color-text)" }}>
            Review{" "}
            <code
              className="rounded px-1 py-0.5 text-xs"
              style={{
                backgroundColor: "var(--color-surface)",
                border: "1px solid var(--color-border)",
              }}
            >
              CLAUDE.md
            </code>{" "}
            and customize project instructions
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          <span style={{ color: "var(--color-accent)" }}>3.</span>
          <p style={{ color: "var(--color-text)" }}>
            Start the loop:{" "}
            <code
              className="rounded px-1 py-0.5 text-xs"
              style={{
                backgroundColor: "var(--color-surface)",
                border: "1px solid var(--color-border)",
              }}
            >
              ralph loop run {report.projectPath}
            </code>
          </p>
        </div>
      </div>

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

// ─── InitWizard (main) ──────────────────────────────────────────

export function InitWizard() {
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

  // Build profileOverrides, filtering unmodified values
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

  // Build seed items for API call
  function buildSeedItems(): SeedItem[] | undefined {
    if (state.backlogMode === "empty" || state.seedItems.length === 0) return undefined;
    // Filter out items with empty titles
    const validItems = state.seedItems.filter((item) => item.title.trim());
    return validItems.length > 0 ? validItems : undefined;
  }

  // Init mutation
  const initMutation = useMutation({
    mutationFn: () =>
      ralphFetchJson<InstallationReport>("/api/projects/init", {
        method: "POST",
        body: JSON.stringify({
          targetPath: state.targetPath,
          name: state.projectName,
          description: state.description || undefined,
          preset: state.preset,
          profileOverrides: buildOverrides(),
          seedItems: buildSeedItems(),
        }),
      }),
    onSuccess: (data) => {
      onChange({ initReport: data, step: 5 });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  function handleInit() {
    initMutation.mutate();
  }

  return (
    <div className="p-6">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-1 text-2xl font-semibold" style={{ color: "var(--color-text)" }}>
          Initialize New Project
        </h1>
        <p className="mb-6 text-sm" style={{ color: "var(--color-text-muted)" }}>
          Create a new project from scratch with git, CLAUDE.md, and ralph loop infrastructure.
        </p>

        <StepIndicator current={state.step} total={STEP_LABELS.length} />

        {/* Init error banner */}
        {initMutation.isError && state.step === 4 && (
          <div
            className="mb-4 rounded-lg border p-4"
            style={{
              borderColor: "rgba(220, 38, 38, 0.3)",
              backgroundColor: "rgba(220, 38, 38, 0.05)",
              color: "#dc2626",
            }}
          >
            <p className="text-sm font-medium">Initialization failed</p>
            <p className="mt-1 text-xs" style={{ opacity: 0.8 }}>
              {initMutation.error instanceof Error ? initMutation.error.message : "Unknown error"}
            </p>
          </div>
        )}

        {state.step === 1 && <StepProjectInfo state={state} onChange={onChange} onNext={goNext} />}
        {state.step === 2 && (
          <StepTechStack state={state} onChange={onChange} onBack={goBack} onNext={goNext} />
        )}
        {state.step === 3 && (
          <StepBacklog state={state} onChange={onChange} onBack={goBack} onNext={goNext} />
        )}
        {state.step === 4 && (
          <StepReview
            state={state}
            onBack={goBack}
            onNext={handleInit}
            loading={initMutation.isPending}
          />
        )}
        {state.step === 5 && <StepResult state={state} />}
      </div>
    </div>
  );
}
