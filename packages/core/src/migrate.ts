// ─── Ralph → Rauf Migration ──────────────────────────────────────
//
// Pure, git-agnostic, path-sandboxed migration of a legacy "ralph"
// install (`.ralph/`, `.ralph.json`, `RALPH.md`, `RALPH_*` signals,
// `X-Ralph-Request`, sentinels) to the new "rauf" identity.
//
// Build this FIRST (it is additive). The detection lever — a legacy
// `.ralph.json` marker failing the new Zod `MarkerFileSchema` (which
// requires `rauf: true`) — is what makes read-only commands surface a
// "run rauf migrate" warning instead of "not installed".
//
// Design rules (mirrors @rauf/core conventions):
//   - Zero imports from cli/web.
//   - Returns Result<T, E>; never throws for expected errors.
//   - Atomic writes (write .tmp → rename) via fs-utils.atomicWrite.
//   - Path-sandboxed: never writes outside the project root (or ~ for
//     the global variant).
//   - The loop-liveness safety gate reuses lock.ts pid-liveness — it
//     keys off `.loop.lock`, NOT `state.json.status` (which can be
//     permanently stuck at "running" after an abandoned loop).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { type Result, ok, err, ErrorCodes } from "./errors.js";
import { atomicWrite, computeHash, fileExists, validatePath } from "./fs-utils.js";
import { checkLock } from "./lock.js";
import { SCAN_SKIP_DIRS } from "./backlog-root.js";
import type { BacklogPaths } from "./backlog-root.js";

// ─── Constants (legacy tokens to detect/rewrite) ─────────────────

const LEGACY_MARKER_FILENAME = ".ralph.json";
const NEW_MARKER_FILENAME = ".rauf.json";
const LEGACY_DOT_DIR = ".ralph";
const NEW_DOT_DIR = ".rauf";
const STATE_FILENAME = "state.json";
const LOCK_FILENAME = ".loop.lock";

const CLAUDE_MD_FILENAME = "CLAUDE.md";
const LEGACY_SENTINEL_START = "<!-- ralph:start -->";
const LEGACY_SENTINEL_END = "<!-- ralph:end -->";

/** Backup suffixes/names left on disk after a successful migrate. */
const BACKUP_DIR_SUFFIX = ".bak"; // .ralph/ → .ralph.bak/
const BACKUP_MARKER_SUFFIX = ".bak"; // .ralph.json → .ralph.json.bak
const BACKUP_CLAUDE_SUFFIX = ".ralphbak"; // CLAUDE.md → CLAUDE.md.ralphbak

/**
 * Config/state file names + extensions that may reference `.ralph/` but
 * are NOT tool-owned by rauf-manager. The migrator detects and reports
 * these (decision #9 / Gap 6); it never rewrites them.
 */
const FOREIGN_CONFIG_EXTENSIONS = [".json", ".jsonc", ".toml", ".yml", ".yaml"];
const FOREIGN_CONFIG_DOTFILES = [
  ".graphifyignore",
  ".dockerignore",
  ".prettierignore",
  ".eslintignore",
  ".npmignore",
];

// ─── Types ────────────────────────────────────────────────────────

export type MigrateState =
  | "not_installed"
  | "legacy_ralph"
  | "already_rauf"
  | "partial"
  | "marker_corrupt";

export interface StaleLock {
  /** Absolute path to the `.loop.lock` file that was found dead/cleaned */
  path: string;
  /** PID recorded in the dead lock (0 if unreadable) */
  pid: number;
}

export interface OutOfBlockRef {
  /** 1-based line number within CLAUDE.md */
  line: number;
  /** The full line text containing a stray `ralph` reference */
  text: string;
}

export interface ForeignConfigRef {
  /** Absolute path to the non-tool-owned config/state file */
  path: string;
  /** 1-based line number */
  line: number;
  /** The matched line text referencing `.ralph` */
  text: string;
}

export interface MigrateReport {
  /** Absolute project path the report describes */
  projectPath: string;
  /** Detected install state */
  state: MigrateState;
  /** True for planMigration() output (no writes performed) */
  dryRun: boolean;
  /** True when mutations were actually applied to disk */
  applied: boolean;
  /** Human-readable list of planned (dry-run) or performed steps */
  steps: string[];
  /**
   * Every `.ralph/` dir renamed to `.rauf/` — root install + nested
   * per-spec multi-backlog dirs (decision #5 revised). Absolute paths
   * of the SOURCE (`.ralph`) directory.
   */
  loopDirsRenamed: string[];
  /** `.ralph/` dirs with no `state.json` (and not the install root) — reported, left in place */
  foreignDirsReported: string[];
  /** Dead `.loop.lock` files found across all loop dirs (cleaned during a real run) */
  staleLocks: StaleLock[];
  /** `ralph` references in CLAUDE.md OUTSIDE the managed block — reported, not rewritten */
  claudeMdOutOfBlockRefs: OutOfBlockRef[];
  /** `.ralph` references in foreign config/state files — reported, not rewritten (Gap 6) */
  foreignConfigRefs: ForeignConfigRef[];
  /** Backup paths created during a real run (never auto-deleted on success) */
  backupsCreated: string[];
  /** Non-fatal warnings (missing CLAUDE.md, missing sentinels, live-lock refusal, etc.) */
  warnings: string[];
}

export interface MigrateOptions {
  /**
   * When false, skip creating `.ralph.bak/`, `.ralph.json.bak`, and
   * `CLAUDE.md.ralphbak`. The CLI may pass false when the git tree is
   * clean (git itself is the safety net). Defaults to true.
   */
  backup?: boolean;
}

export interface MigrateGlobalOptions {
  backup?: boolean;
}

// ─── rewriteRalphStrings (case-aware, single-pass, idempotent) ────

/**
 * Rewrite every `ralph` token to `rauf`, preserving case.
 *
 * A single regex pass over the three stem-casings handles ALL tool-owned
 * tokens correctly, because in every compound the surrounding characters
 * are preserved and only the stem changes case-consistently:
 *   RALPH_DONE/BLOCKED/NEEDS_HUMAN/REVIEW → RAUF_*      (RALPH stem)
 *   RALPH_ROOT → RAUF_ROOT                              (RALPH stem)
 *   RALPH.md → RAUF.md                                  (RALPH stem)
 *   X-Ralph-Request → X-Rauf-Request                   (Ralph stem)
 *   RalphError → RaufError                              (Ralph stem)
 *   .ralph.json → .rauf.json, .ralph/ → .rauf/         (ralph stem)
 *   <!-- ralph:start --> → <!-- rauf:start -->         (ralph stem)
 *   garygentry/ralph → garygentry/rauf                 (ralph stem)
 *
 * Case-SENSITIVE matching (not /i) is essential so casing is never
 * corrupted. Idempotent: the output contains no source stem, so a second
 * pass is a no-op.
 */
export function rewriteRalphStrings(text: string): string {
  return text.replace(/RALPH|Ralph|ralph/g, (match) => {
    if (match === "RALPH") return "RAUF";
    if (match === "Ralph") return "Rauf";
    return "rauf";
  });
}

// ─── Internal: empty report ──────────────────────────────────────

function emptyReport(projectPath: string, state: MigrateState, dryRun: boolean): MigrateReport {
  return {
    projectPath,
    state,
    dryRun,
    applied: false,
    steps: [],
    loopDirsRenamed: [],
    foreignDirsReported: [],
    staleLocks: [],
    claudeMdOutOfBlockRefs: [],
    foreignConfigRefs: [],
    backupsCreated: [],
    warnings: [],
  };
}

// ─── Detection ───────────────────────────────────────────────────

/**
 * Detect the migration state of a project by reading markers as RAW JSON
 * (NOT readMarkerFile — the new schema rejects a legacy `ralph:true`).
 */
export function detectMigrationState(projectPath: string): Result<MigrateState> {
  const resolved = path.resolve(projectPath);

  try {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return err({
        code: ErrorCodes.FILE_NOT_FOUND,
        message: `Project directory not found: ${projectPath}`,
      });
    }
  } catch {
    return err({
      code: ErrorCodes.FILE_NOT_FOUND,
      message: `Project directory not found: ${projectPath}`,
    });
  }

  const legacyMarkerPath = path.join(resolved, LEGACY_MARKER_FILENAME);
  const newMarkerPath = path.join(resolved, NEW_MARKER_FILENAME);

  const legacyExists = fileExists(legacyMarkerPath);
  const newExists = fileExists(newMarkerPath);

  const rauf = newExists ? readRawMarkerFlag(newMarkerPath, "rauf") : { present: false };
  const ralph = legacyExists ? readRawMarkerFlag(legacyMarkerPath, "ralph") : { present: false };

  // A marker file present but unparseable → corrupt (don't mislabel not_installed).
  if (legacyExists && ralph.corrupt) return ok("marker_corrupt");
  if (newExists && rauf.corrupt) return ok("marker_corrupt");

  const isRauf = newExists && rauf.value === true;
  const isLegacy = legacyExists && ralph.value === true;

  // Mixed state (both markers, or a legacy marker alongside a partial rauf) → resumable partial.
  if (isRauf && isLegacy) return ok("partial");
  if (isRauf && fileExists(path.join(resolved, LEGACY_DOT_DIR))) return ok("partial");
  if (isRauf) return ok("already_rauf");
  if (isLegacy) return ok("legacy_ralph");

  return ok("not_installed");
}

interface RawMarkerFlag {
  present: boolean;
  value?: unknown;
  corrupt?: boolean;
}

function readRawMarkerFlag(markerPath: string, key: "ralph" | "rauf"): RawMarkerFlag {
  let raw: string;
  try {
    raw = fs.readFileSync(markerPath, "utf-8");
  } catch {
    return { present: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { present: true, corrupt: true };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { present: true, corrupt: true };
  }
  return { present: true, value: (parsed as Record<string, unknown>)[key] };
}

// ─── Loop-dir discovery (mirrors status.ts walkForStateFiles) ─────

interface LoopDirScan {
  /** Install-root `.ralph` dir that gets the FULL inner-file treatment, if present & legacy */
  rootDir: string | null;
  /** Dirs to rename `.ralph`→`.rauf` (dir-only): nested dirs containing state.json */
  renameDirs: string[];
  /** `.ralph` dirs with no state.json (and not the install root) — report only */
  foreignDirs: string[];
  /** All `.loop.lock` paths discovered across loop dirs (root + nested) */
  lockPaths: string[];
}

function scanLoopDirs(projectPath: string, isLegacyInstall: boolean): LoopDirScan {
  const resolved = path.resolve(projectPath);
  const rootRalph = path.join(resolved, LEGACY_DOT_DIR);
  const scan: LoopDirScan = { rootDir: null, renameDirs: [], foreignDirs: [], lockPaths: [] };

  const allRalphDirs: string[] = [];
  walkForRalphDirs(resolved, allRalphDirs);

  for (const dir of allRalphDirs) {
    const hasState = fileExists(path.join(dir, STATE_FILENAME));
    const lockPath = path.join(dir, LOCK_FILENAME);
    if (fileExists(lockPath)) scan.lockPaths.push(lockPath);

    const isRoot = dir === rootRalph;

    if (isRoot && (isLegacyInstall || hasState)) {
      // Install root → rename + full inner-file/marker/CLAUDE.md/gitignore treatment.
      scan.rootDir = dir;
    } else if (hasState) {
      // Nested per-spec multi-backlog loop-state dir → dir-only rename (decision #5 revised).
      scan.renameDirs.push(dir);
    } else {
      // No state.json, not the install root → report-and-leave.
      scan.foreignDirs.push(dir);
    }
  }

  return scan;
}

/** Recursively collect every directory literally named `.ralph` (skip noise dirs; don't recurse into .ralph/.rauf). */
function walkForRalphDirs(dir: string, results: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if ((SCAN_SKIP_DIRS as readonly string[]).includes(name)) continue;
    const fullPath = path.join(dir, name);
    if (name === LEGACY_DOT_DIR) {
      results.push(fullPath);
      continue; // don't recurse into .ralph dirs
    }
    if (name === NEW_DOT_DIR) {
      continue; // already-migrated dir — skip, don't recurse
    }
    walkForRalphDirs(fullPath, results);
  }
}

// ─── Foreign-config detection (Gap 6) ────────────────────────────

function scanForeignConfigRefs(projectPath: string): ForeignConfigRef[] {
  const resolved = path.resolve(projectPath);
  const refs: ForeignConfigRef[] = [];
  walkForForeignConfigs(resolved, resolved, refs);
  refs.sort((a, b) => (a.path === b.path ? a.line - b.line : a.path.localeCompare(b.path)));
  return refs;
}

function walkForForeignConfigs(dir: string, projectRoot: string, refs: ForeignConfigRef[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const name = entry.name;
    const fullPath = path.join(dir, name);

    if (entry.isDirectory()) {
      if ((SCAN_SKIP_DIRS as readonly string[]).includes(name)) continue;
      // Skip tool-owned loop dirs (handled separately) and already-migrated dirs.
      if (name === LEGACY_DOT_DIR || name === NEW_DOT_DIR) continue;
      walkForForeignConfigs(fullPath, projectRoot, refs);
      continue;
    }

    if (!entry.isFile()) continue;
    if (!isForeignConfigCandidate(name)) continue;

    let content: string;
    try {
      content = fs.readFileSync(fullPath, "utf-8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (line.includes(".ralph")) {
        refs.push({ path: fullPath, line: i + 1, text: line.trim() });
      }
    }
  }
}

function isForeignConfigCandidate(filename: string): boolean {
  // Markers and gitignore are handled directly by the migrator — exclude here.
  if (filename === LEGACY_MARKER_FILENAME || filename === NEW_MARKER_FILENAME) return false;
  if (filename === ".gitignore" || filename === CLAUDE_MD_FILENAME) return false;
  if (filename.endsWith(".bak") || filename.endsWith(BACKUP_CLAUDE_SUFFIX)) return false;
  if (FOREIGN_CONFIG_DOTFILES.includes(filename)) return true;
  const ext = path.extname(filename).toLowerCase();
  return FOREIGN_CONFIG_EXTENSIONS.includes(ext);
}

// ─── Lock liveness gate ──────────────────────────────────────────

interface LockGateResult {
  /** Lock paths whose owning process is alive — migration must refuse */
  live: { path: string; pid?: number }[];
  /** Lock paths whose process is dead/recycled — safe to clean */
  stale: StaleLock[];
}

function checkLockGate(lockPaths: string[], projectPath: string): LockGateResult {
  const result: LockGateResult = { live: [], stale: [] };
  for (const lockPath of lockPaths) {
    const fakePaths = {
      lock: lockPath,
      root: path.dirname(lockPath),
      projectPath: path.resolve(projectPath),
    } as unknown as BacklogPaths;
    const status = checkLock(fakePaths);
    if (!status.ok) {
      // Treat an unreadable lock conservatively as stale (safe to remove).
      result.stale.push({ path: lockPath, pid: 0 });
      continue;
    }
    if (!status.value.locked) continue;
    if (status.value.stale) {
      result.stale.push({ path: lockPath, pid: status.value.pid ?? 0 });
    } else {
      result.live.push({ path: lockPath, pid: status.value.pid });
    }
  }
  return result;
}

// ─── CLAUDE.md scoped rewrite + out-of-block scan ────────────────

interface ClaudeMdPlan {
  /** New full CLAUDE.md content after rewriting ONLY the managed block (null = no change/skip) */
  rewritten: string | null;
  outOfBlockRefs: OutOfBlockRef[];
  warning: string | null;
}

function planClaudeMd(projectPath: string): ClaudeMdPlan {
  const claudeMdPath = path.join(path.resolve(projectPath), CLAUDE_MD_FILENAME);
  if (!fileExists(claudeMdPath)) {
    return { rewritten: null, outOfBlockRefs: [], warning: null };
  }

  let content: string;
  try {
    content = fs.readFileSync(claudeMdPath, "utf-8");
  } catch {
    return { rewritten: null, outOfBlockRefs: [], warning: `Could not read ${CLAUDE_MD_FILENAME}` };
  }

  const startIdx = content.indexOf(LEGACY_SENTINEL_START);
  const endIdx = content.indexOf(LEGACY_SENTINEL_END);
  const hasSentinels = startIdx !== -1 && endIdx !== -1 && endIdx > startIdx;

  if (!hasSentinels) {
    // No managed block → rewrite nothing; report ALL ralph refs as out-of-block.
    return {
      rewritten: null,
      outOfBlockRefs: scanLinesForRalph(content),
      warning: `${CLAUDE_MD_FILENAME} has no ralph managed block — skipped (all ralph refs reported)`,
    };
  }

  const blockEnd = endIdx + LEGACY_SENTINEL_END.length;
  const before = content.slice(0, startIdx);
  const block = content.slice(startIdx, blockEnd);
  const after = content.slice(blockEnd);

  const rewritten = before + rewriteRalphStrings(block) + after;

  // Scan OUTSIDE the block for stray ralph refs (the migrator won't touch user prose).
  const outOfBlockRefs = scanLinesForRalphExcludingRange(content, startIdx, blockEnd);

  if (rewritten === content) {
    return { rewritten: null, outOfBlockRefs, warning: null };
  }
  return { rewritten, outOfBlockRefs, warning: null };
}

function scanLinesForRalph(content: string): OutOfBlockRef[] {
  const refs: OutOfBlockRef[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/ralph/i.test(line)) refs.push({ line: i + 1, text: line.trim() });
  }
  return refs;
}

function scanLinesForRalphExcludingRange(
  content: string,
  rangeStart: number,
  rangeEnd: number,
): OutOfBlockRef[] {
  const refs: OutOfBlockRef[] = [];
  const lines = content.split("\n");
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const lineStart = offset;
    const lineEnd = offset + line.length;
    offset = lineEnd + 1; // +1 for the split "\n"
    // Skip lines that overlap the managed block range.
    if (lineEnd >= rangeStart && lineStart < rangeEnd) continue;
    if (/ralph/i.test(line)) refs.push({ line: i + 1, text: line.trim() });
  }
  return refs;
}

// ─── .gitignore line-scoped rewrite ──────────────────────────────

interface GitignorePlan {
  rewritten: string | null;
  changedLines: string[];
}

function planGitignore(projectPath: string): GitignorePlan {
  const gitignorePath = path.join(path.resolve(projectPath), ".gitignore");
  if (!fileExists(gitignorePath)) return { rewritten: null, changedLines: [] };

  let content: string;
  try {
    content = fs.readFileSync(gitignorePath, "utf-8");
  } catch {
    return { rewritten: null, changedLines: [] };
  }

  const lines = content.split("\n");
  const changedLines: string[] = [];
  let changed = false;
  const newLines = lines.map((line) => {
    if (/\.ralph|ralph-bin/i.test(line)) {
      const rewritten = rewriteRalphStrings(line);
      if (rewritten !== line) {
        changed = true;
        changedLines.push(`${line.trim()} → ${rewritten.trim()}`);
      }
      return rewritten;
    }
    return line;
  });

  if (!changed) return { rewritten: null, changedLines: [] };
  return { rewritten: newLines.join("\n"), changedLines };
}

// ─── planMigration (pure, no writes) ─────────────────────────────

export function planMigration(projectPath: string): Result<MigrateReport> {
  const resolved = path.resolve(projectPath);

  const stateResult = detectMigrationState(resolved);
  if (!stateResult.ok) return stateResult;
  const state = stateResult.value;

  const report = emptyReport(resolved, state, true);

  // Foreign-config refs and CLAUDE.md out-of-block refs are always informative.
  report.foreignConfigRefs = scanForeignConfigRefs(resolved);

  if (state === "marker_corrupt") {
    report.warnings.push(
      `Marker file is present but unparseable — refusing. Fix or remove the corrupt .ralph.json/.rauf.json and re-run.`,
    );
    return ok(report);
  }

  if (state === "already_rauf") {
    report.warnings.push("Project already migrated to rauf — nothing to do.");
    return ok(report);
  }

  const isLegacyInstall = state === "legacy_ralph" || state === "partial";
  const scan = scanLoopDirs(resolved, isLegacyInstall);

  // Lock gate (informational in plan; enforced in migrate()).
  const gate = checkLockGate(scan.lockPaths, resolved);
  report.staleLocks = gate.stale;
  for (const live of gate.live) {
    report.warnings.push(
      `A loop is currently running in ${path.dirname(live.path)} (PID ${live.pid ?? "?"}) — stop it before migrating.`,
    );
  }

  if (scan.rootDir) {
    report.loopDirsRenamed.push(scan.rootDir);
    report.steps.push(
      `Rename ${rel(resolved, scan.rootDir)} → ${rel(resolved, toRauf(scan.rootDir))} (install root, full rewrite)`,
    );
  }
  for (const dir of scan.renameDirs) {
    report.loopDirsRenamed.push(dir);
    report.steps.push(
      `Rename ${rel(resolved, dir)} → ${rel(resolved, toRauf(dir))} (nested loop-state, dir-only)`,
    );
  }
  report.foreignDirsReported = scan.foreignDirs;
  for (const dir of scan.foreignDirs) {
    report.warnings.push(
      `${rel(resolved, dir)} has no ${STATE_FILENAME} — left in place (not a rauf loop dir).`,
    );
  }

  if (scan.rootDir) {
    report.steps.push(
      `Rename inner ${NEW_DOT_DIR}/RALPH.md → RAUF.md and ${NEW_DOT_DIR}/ralph.log → rauf.log`,
    );
    report.steps.push(
      `Rename ${LEGACY_MARKER_FILENAME} → ${NEW_MARKER_FILENAME} and rewrite marker fields`,
    );
    report.steps.push(`Rewrite content of ${NEW_DOT_DIR}/RAUF.md, REVIEW.md, backlog.schema.json`);
  }

  // CLAUDE.md
  const claudePlan = planClaudeMd(resolved);
  report.claudeMdOutOfBlockRefs = claudePlan.outOfBlockRefs;
  if (claudePlan.warning) report.warnings.push(claudePlan.warning);
  if (claudePlan.rewritten !== null) {
    report.steps.push(`Rewrite the ralph managed block in ${CLAUDE_MD_FILENAME}`);
  }

  // .gitignore
  const gitignorePlan = planGitignore(resolved);
  if (gitignorePlan.rewritten !== null) {
    report.steps.push(`Rewrite ${gitignorePlan.changedLines.length} ralph line(s) in .gitignore`);
  }

  if (report.loopDirsRenamed.length === 0 && state === "not_installed") {
    report.warnings.push("No ralph install or loop-state dirs found — nothing to migrate.");
  }

  return ok(report);
}

// ─── migrate (mutating) ──────────────────────────────────────────

export function migrate(projectPath: string, opts: MigrateOptions = {}): Result<MigrateReport> {
  const resolved = path.resolve(projectPath);
  const backup = opts.backup !== false;

  const planResult = planMigration(resolved);
  if (!planResult.ok) return planResult;
  const plan = planResult.value;

  // Refuse on corrupt marker.
  if (plan.state === "marker_corrupt") {
    return err({
      code: ErrorCodes.INVALID_JSON,
      message: `Marker file in ${projectPath} is present but unparseable — refusing to migrate. Fix or remove it and re-run.`,
    });
  }

  // No-op when already migrated and there is nothing left to do.
  if (plan.state === "already_rauf" && plan.loopDirsRenamed.length === 0) {
    return ok({ ...plan, dryRun: false, applied: false });
  }

  // Loop-liveness safety gate (reuse lock.ts) — refuse if ANY loop dir has a live lock.
  const isLegacyInstall = plan.state === "legacy_ralph" || plan.state === "partial";
  const scan = scanLoopDirs(resolved, isLegacyInstall);
  const gate = checkLockGate(scan.lockPaths, resolved);
  if (gate.live.length > 0) {
    const where = gate.live.map((l) => path.dirname(l.path)).join(", ");
    return err({
      code: ErrorCodes.LOCK_CONFLICT,
      message: `A loop is currently running in: ${where}. Stop it before migrating.`,
      details: { liveLocks: gate.live },
    });
  }

  if (plan.loopDirsRenamed.length === 0 && plan.state === "not_installed") {
    // Nothing to migrate — return the plan as-is (no writes).
    return ok({ ...plan, dryRun: false, applied: false });
  }

  // ── Begin mutation. Build a fresh report we mutate as we go. ────
  const report = emptyReport(resolved, plan.state, false);
  report.foreignConfigRefs = plan.foreignConfigRefs;
  report.claudeMdOutOfBlockRefs = plan.claudeMdOutOfBlockRefs;
  report.foreignDirsReported = plan.foreignDirsReported;
  report.warnings = plan.warnings.filter((w) => !w.startsWith("A loop is currently running"));

  const rootDir = scan.rootDir;
  const rootRauf = rootDir ? toRauf(rootDir) : null;

  // Sandbox guard: every mutation path must live inside the project root.
  const sandbox = (p: string): Result<string> => validatePath(p, [resolved]);

  // ── Step 1: Backups (root only; nested dirs are reversible renames). ──
  if (backup && rootDir) {
    const backupDir = rootDir + BACKUP_DIR_SUFFIX; // .ralph.bak
    if (!fileExists(backupDir)) {
      try {
        fs.cpSync(rootDir, backupDir, { recursive: true });
        report.backupsCreated.push(backupDir);
      } catch (e) {
        return failMutation(`Failed to back up ${rel(resolved, rootDir)}`, e);
      }
    }
    const legacyMarker = path.join(resolved, LEGACY_MARKER_FILENAME);
    if (fileExists(legacyMarker)) {
      const markerBackup = legacyMarker + BACKUP_MARKER_SUFFIX;
      if (!fileExists(markerBackup)) {
        try {
          fs.copyFileSync(legacyMarker, markerBackup);
          report.backupsCreated.push(markerBackup);
        } catch (e) {
          return failMutation(`Failed to back up ${LEGACY_MARKER_FILENAME}`, e);
        }
      }
    }
    const claudeMd = path.join(resolved, CLAUDE_MD_FILENAME);
    if (fileExists(claudeMd)) {
      const claudeBackup = claudeMd + BACKUP_CLAUDE_SUFFIX;
      if (!fileExists(claudeBackup)) {
        try {
          fs.copyFileSync(claudeMd, claudeBackup);
          report.backupsCreated.push(claudeBackup);
        } catch (e) {
          return failMutation(`Failed to back up ${CLAUDE_MD_FILENAME}`, e);
        }
      }
    }
    report.steps.push(
      `Created backups: ${report.backupsCreated.map((b) => path.basename(b)).join(", ")}`,
    );
  }

  // ── Step 2: Stale-lock cleanup across all loop dirs. ──
  for (const stale of gate.stale) {
    try {
      fs.unlinkSync(stale.path);
      report.staleLocks.push(stale);
    } catch {
      // Already gone — ignore.
    }
  }
  if (report.staleLocks.length > 0) {
    report.steps.push(`Cleaned ${report.staleLocks.length} stale .loop.lock file(s)`);
  }

  // ── Step 3: Rename loop dirs (root + nested). Collision-safe. ──
  // Nested first, then root (root continues through inner steps).
  for (const dir of scan.renameDirs) {
    const target = toRauf(dir);
    const guard = sandbox(target);
    if (!guard.ok) return err(guard.error);
    if (fileExists(target)) {
      report.warnings.push(
        `Skipped rename: ${rel(resolved, target)} already exists (partial state).`,
      );
      continue;
    }
    try {
      fs.renameSync(dir, target);
      report.loopDirsRenamed.push(dir);
      report.steps.push(`Renamed ${rel(resolved, dir)} → ${rel(resolved, target)}`);
    } catch (e) {
      return failMutation(`Failed to rename ${rel(resolved, dir)}`, e);
    }
  }

  if (rootDir && rootRauf) {
    const guard = sandbox(rootRauf);
    if (!guard.ok) return err(guard.error);
    if (fileExists(rootRauf)) {
      report.warnings.push(
        `Skipped root rename: ${rel(resolved, rootRauf)} already exists (partial state).`,
      );
    } else {
      try {
        fs.renameSync(rootDir, rootRauf);
        report.loopDirsRenamed.push(rootDir);
        report.steps.push(`Renamed ${rel(resolved, rootDir)} → ${rel(resolved, rootRauf)}`);
      } catch (e) {
        return failMutation(`Failed to rename install root ${rel(resolved, rootDir)}`, e);
      }
    }

    // ── Step 4: Rename inner tool files. ──
    const innerRalphMd = path.join(rootRauf, "RALPH.md");
    const innerRaufMd = path.join(rootRauf, "RAUF.md");
    if (fileExists(innerRalphMd) && !fileExists(innerRaufMd)) {
      try {
        fs.renameSync(innerRalphMd, innerRaufMd);
        report.steps.push(`Renamed ${NEW_DOT_DIR}/RALPH.md → RAUF.md`);
      } catch (e) {
        return failMutation("Failed to rename RALPH.md", e);
      }
    }
    const innerRalphLog = path.join(rootRauf, "ralph.log");
    const innerRaufLog = path.join(rootRauf, "rauf.log");
    if (fileExists(innerRalphLog) && !fileExists(innerRaufLog)) {
      try {
        fs.renameSync(innerRalphLog, innerRaufLog);
        report.steps.push(`Renamed ${NEW_DOT_DIR}/ralph.log → rauf.log`);
      } catch (e) {
        return failMutation("Failed to rename ralph.log", e);
      }
    }

    // ── Step 5: Rename marker file. ──
    const legacyMarker = path.join(resolved, LEGACY_MARKER_FILENAME);
    const newMarker = path.join(resolved, NEW_MARKER_FILENAME);
    if (fileExists(legacyMarker) && !fileExists(newMarker)) {
      try {
        fs.renameSync(legacyMarker, newMarker);
        report.steps.push(`Renamed ${LEGACY_MARKER_FILENAME} → ${NEW_MARKER_FILENAME}`);
      } catch (e) {
        return failMutation("Failed to rename marker file", e);
      }
    }

    // ── Step 6: Content rewrites on tool-owned files (whole-file, idempotent). ──
    for (const fname of ["RAUF.md", "REVIEW.md", "backlog.schema.json"]) {
      const fpath = path.join(rootRauf, fname);
      if (!fileExists(fpath)) continue;
      let original: string;
      try {
        original = fs.readFileSync(fpath, "utf-8");
      } catch {
        continue;
      }
      const rewritten = rewriteRalphStrings(original);
      if (rewritten !== original) {
        const w = atomicWrite(fpath, rewritten);
        if (!w.ok) return err(w.error);
        report.steps.push(`Rewrote content of ${NEW_DOT_DIR}/${fname}`);
      }
    }

    // ── Step 9 (marker rewrite — needs RAUF.md present for hash recompute). ──
    if (fileExists(newMarker)) {
      const markerResult = rewriteMarker(newMarker, rootRauf);
      if (!markerResult.ok) return err(markerResult.error);
      report.steps.push(`Rewrote ${NEW_MARKER_FILENAME} (rauf:true, artifactHashes, installedBy)`);
    }
  }

  // ── Step 7: CLAUDE.md scoped rewrite. ──
  const claudePlan = planClaudeMd(resolved);
  report.claudeMdOutOfBlockRefs = claudePlan.outOfBlockRefs;
  if (claudePlan.warning) report.warnings.push(claudePlan.warning);
  if (claudePlan.rewritten !== null) {
    const w = atomicWrite(path.join(resolved, CLAUDE_MD_FILENAME), claudePlan.rewritten);
    if (!w.ok) return err(w.error);
    report.steps.push(`Rewrote the ralph managed block in ${CLAUDE_MD_FILENAME}`);
  }

  // ── Step 8: .gitignore line-scoped rewrite. ──
  const gitignorePlan = planGitignore(resolved);
  if (gitignorePlan.rewritten !== null) {
    const w = atomicWrite(path.join(resolved, ".gitignore"), gitignorePlan.rewritten);
    if (!w.ok) return err(w.error);
    report.steps.push(`Rewrote .gitignore lines: ${gitignorePlan.changedLines.join("; ")}`);
  }

  report.applied = true;
  // Re-detect final state for the report.
  const finalState = detectMigrationState(resolved);
  if (finalState.ok) report.state = finalState.value;

  return ok(report);

  function failMutation(message: string, e: unknown): Result<MigrateReport> {
    return err({
      code: ErrorCodes.FILE_NOT_FOUND,
      message: `${message}: ${e instanceof Error ? e.message : String(e)}. Backups (if created) are at ${report.backupsCreated.join(", ") || "(none)"}.`,
      details: { backupsCreated: report.backupsCreated },
    });
  }
}

// ─── Marker rewrite ──────────────────────────────────────────────

function rewriteMarker(markerPath: string, rootRaufDir: string): Result<void> {
  let raw: string;
  try {
    raw = fs.readFileSync(markerPath, "utf-8");
  } catch (e) {
    return err({
      code: ErrorCodes.FILE_NOT_FOUND,
      message: `Cannot read marker for rewrite: ${markerPath}`,
      details: { cause: e instanceof Error ? e.message : String(e) },
    });
  }

  let obj: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return err({
        code: ErrorCodes.INVALID_JSON,
        message: `Marker is not a JSON object: ${markerPath}`,
      });
    }
    obj = parsed as Record<string, unknown>;
  } catch (e) {
    return err({
      code: ErrorCodes.INVALID_JSON,
      message: `Marker JSON is invalid: ${markerPath}`,
      details: { cause: e instanceof Error ? e.message : String(e) },
    });
  }

  // Flip discriminator.
  delete obj["ralph"];
  obj["rauf"] = true;

  // installedBy: ralph-manager@ → rauf-manager@.
  if (typeof obj["installedBy"] === "string") {
    obj["installedBy"] = rewriteRalphStrings(obj["installedBy"]);
  }

  // artifactHashes: rename "RALPH.md" → "RAUF.md" and recompute from the new file.
  const hashes = obj["artifactHashes"];
  if (typeof hashes === "object" && hashes !== null) {
    const h = hashes as Record<string, unknown>;
    if ("RALPH.md" in h) {
      delete h["RALPH.md"];
    }
    const raufMdPath = path.join(rootRaufDir, "RAUF.md");
    if (fileExists(raufMdPath)) {
      const hashResult = computeHash(raufMdPath);
      if (hashResult.ok) {
        h["RAUF.md"] = hashResult.value;
      }
    }
    // Stale extra keys (e.g. a removed ralph.sh) are tolerated/preserved as-is.
  }

  const content = JSON.stringify(obj, null, 2) + "\n";
  return atomicWrite(markerPath, content);
}

// ─── migrateGlobal (~/.ralph → ~/.rauf) ──────────────────────────

export function migrateGlobal(opts: MigrateGlobalOptions = {}): Result<MigrateReport> {
  void opts;
  const home = os.homedir();
  const src = path.join(home, LEGACY_DOT_DIR);
  const dst = path.join(home, NEW_DOT_DIR);

  const report = emptyReport(src, "legacy_ralph", false);

  const srcExists = fileExists(src);
  const dstExists = fileExists(dst);

  // Idempotent: already migrated.
  if (!srcExists && dstExists) {
    report.state = "already_rauf";
    report.warnings.push("Global ~/.rauf already exists and ~/.ralph is gone — nothing to do.");
    return ok(report);
  }

  if (!srcExists && !dstExists) {
    report.state = "not_installed";
    report.warnings.push("No global ~/.ralph directory found — nothing to migrate.");
    return ok(report);
  }

  // Refuse to clobber a non-empty existing ~/.rauf.
  if (srcExists && dstExists) {
    let dstEntries: string[] = [];
    try {
      dstEntries = fs.readdirSync(dst);
    } catch {
      // ignore
    }
    if (dstEntries.length > 0) {
      report.state = "partial";
      return err({
        code: ErrorCodes.CONFLICT,
        message: `Both ~/.ralph and a non-empty ~/.rauf exist. Merge manually, then re-run.`,
      });
    }
    // Empty ~/.rauf — remove it so the rename can proceed.
    try {
      fs.rmdirSync(dst);
    } catch {
      // ignore — rename below will surface any real problem
    }
  }

  // Move the directory.
  try {
    fs.renameSync(src, dst);
    report.steps.push(`Moved ~/${LEGACY_DOT_DIR} → ~/${NEW_DOT_DIR}`);
  } catch (e) {
    return err({
      code: ErrorCodes.FILE_NOT_FOUND,
      message: `Failed to move ~/${LEGACY_DOT_DIR} → ~/${NEW_DOT_DIR}: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  // Rewrite config.json contents if present (rootDirectory / RALPH_ROOT refs).
  const configPath = path.join(dst, "config.json");
  if (fileExists(configPath)) {
    try {
      const original = fs.readFileSync(configPath, "utf-8");
      const rewritten = rewriteRalphStrings(original);
      if (rewritten !== original) {
        const w = atomicWrite(configPath, rewritten);
        if (!w.ok) return err(w.error);
        report.steps.push("Rewrote ~/.rauf/config.json contents");
      }
    } catch {
      report.warnings.push("Could not rewrite ~/.rauf/config.json — review it manually.");
    }
  }

  // server.json / server.log are ephemeral and carried as-is.
  report.warnings.push(
    "If a rauf server is running, its PID/port registry (~/.rauf/server.json) is now stale — restart the server.",
  );
  report.applied = true;
  report.state = "already_rauf";
  return ok(report);
}

// ─── Small helpers ───────────────────────────────────────────────

function toRauf(ralphDir: string): string {
  // Replace the final path segment `.ralph` with `.rauf`.
  const dir = path.dirname(ralphDir);
  return path.join(dir, NEW_DOT_DIR);
}

function rel(root: string, p: string): string {
  const r = path.relative(root, p);
  return r === "" ? "." : r;
}
