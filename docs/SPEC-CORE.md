---
title: Core Package
description: Specification for the shared business logic package — filesystem operations, backlog management, and project discovery.
---

Reference: `packages/core/src/`

This package contains all filesystem operations and business logic. It has ZERO dependencies on packages/cli or packages/web.

## Module: fs-utils.ts

### atomicWrite(filePath, content)

1. Copy existing file to `filePath.bak` (if it exists — only for backlog.json)
2. Write content to `filePath.tmp`
3. Rename `filePath.tmp` → `filePath`
4. Return Result

### readJsonFile<T>(filePath, schema: ZodSchema<T>)

1. Read file with `fs.readFileSync(filePath, 'utf-8')`
2. `JSON.parse()` in try/catch
3. Validate against Zod schema
4. Return `Result<T>` — parse errors include line/position info where possible

### computeHash(filePath) → string

SHA-256 hex digest of file contents.

### validatePath(targetPath, allowedRoots: string[])

Resolve to absolute path, verify `resolvedPath.startsWith(allowedRoot)` for at least one root. Reject `..` traversal that escapes roots.

### fileExists(filePath) → boolean

Non-throwing existence check.

### ensureDir(dirPath)

`mkdir -p` equivalent.

## Module: schemas.ts

All Zod schemas corresponding to types in docs/SCHEMAS.md. Export both schemas and inferred TypeScript types.

Key schemas: `BacklogItemSchema`, `BacklogSchema`, `MarkerFileSchema`, `LoopStateSchema`, `ToolConfigSchema`, `ProfileCommandsSchema`, `ProjectProfileSchema`, `LoopEventSchema`, `LoopStartOptionsSchema`, `LoopStateEnumSchema`, `RuntimeSchema`, `BacklogItemSourceSchema`, `AgentDelegationSchema`, `ReviewPayloadSchema`, `ReviewItemSchema`, `LockSummarySchema`, `BacklogSummarySchema`, `DerivedStatusSchema`.

`LoopStartOptionsSchema` includes `review`, `reviewOnly`, `provider`, `backlogRoot`, `suppressIterationReview`, `childEnv`, `sleepOnLimit`, and `circuitBreakerThreshold` optional fields. `BacklogItemSchema` includes `agentDelegation`, `specReferences`, `provider`, `source`, `reviewBatch`, `needsHuman`, and `deferred` optional fields. `LoopStateSchema` includes `deferredItems` (default `[]`), `baseCommitHash` (nullable, default `null`), and `paused_usage_limit` in `LoopStateStatusSchema`. `BacklogSummarySchema` includes optional `needsHuman` and `deferred` counts. `LockSummarySchema` captures lock-file liveness (present/pid/alive/stale).

Also exports `LOG_PATTERNS` (regex patterns for Tier 2 log-parsing fallback) and `VALID_STATUS_TRANSITIONS`.

## Module: errors.ts

```typescript
export type Result<T, E = RaufError> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never>;
export function err<E>(error: E): Result<never, E>;

export interface RaufError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// Error codes
export const ErrorCodes = {
  FILE_NOT_FOUND: "FILE_NOT_FOUND",
  INVALID_JSON: "INVALID_JSON",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  PATH_VIOLATION: "PATH_VIOLATION",
  ALREADY_INSTALLED: "ALREADY_INSTALLED",
  NOT_INSTALLED: "NOT_INSTALLED",
  CONFLICT: "CONFLICT",
  TRANSITION_INVALID: "TRANSITION_INVALID",
} as const;
```

## Module: discovery.ts

### discoverProjects(rootDir: string) → Result<DiscoveredProject[]>

1. List immediate child directories of rootDir (depth=1)
2. For each child, check if `.rauf.json` exists
3. If rootDir itself has `.rauf.json`, include it
4. Parse each `.rauf.json`, validate with MarkerFileSchema
5. Filter: exclude any path containing `/artifacts/` segment (prevents false positives)
6. Filter: exclude projects with `options.ignoreInTool === true` from active list (but return them separately)
7. Return sorted by project name

Performance: reads ONLY .rauf.json during scan. Backlog, state, log reads are lazy.

## Module: config.ts

### readMarkerFile(projectPath) → Result<MarkerFile>

Read and validate `<projectPath>/.rauf.json`.

### writeMarkerFile(projectPath, marker: MarkerFile) → Result<void>

Atomic write of `.rauf.json`.

### readToolConfig() → Result<ToolConfig>

Read `~/.rauf/config.json`. Return defaults if file doesn't exist:

```typescript
{ rootDirectory: process.cwd(), port: 5173, theme: "system" }
```

### writeToolConfig(config: ToolConfig) → Result<void>

Write to `~/.rauf/config.json`. Create `~/.rauf/` if needed.

### resolveRootDirectory(cliRoot?, envRoot?) → string

Resolution order: cliRoot → RAUF_ROOT env → config file → cwd.

### readClaudeOAuthToken(credentialsPathOverride?) → Result\<string\>

Read the Claude OAuth bearer token from `~/.config/claude-code/credentials.json`. Extracts `.claudeAiOauth.accessToken` from the parsed JSON. Returns `FILE_NOT_FOUND` if the credentials file doesn't exist, `INVALID_JSON` if malformed, or `VALIDATION_ERROR` if the expected fields are missing. Optional path override for testing.

## Module: profile.ts

### detectProfile(projectPath) → ProjectProfile

Scan project directory for indicator files. Detection order per category:

**Language/Runtime:** Check for package.json, pyproject.toml, go.mod, Cargo.toml, etc. First match wins.

**Package Manager (Node.js):** pnpm-lock.yaml → bun.lockb → yarn.lock → package-lock.json → npm default.

**TypeScript:** If package.json exists AND tsconfig.json exists → TypeScript project.

**Monorepo:** pnpm-workspace.yaml OR lerna.json OR workspaces field in package.json.

**Commands:** Derive from detected stack. For Node.js, read package.json scripts to confirm commands exist before suggesting them.

**Composite verify:** Join all non-null commands with " && ".

### getPreset(presetName) → ProjectProfile

Return a preset profile for greenfield projects. Presets: `node-typescript`, `node-javascript`, `python`, `go`, `rust`, `custom`.

### mergeProfileOverrides(detected, overrides) → ProjectProfile

Apply user-provided command overrides on top of detected profile. Empty string means explicitly disabled (null).

## Module: template.ts

### renderTemplate(templateContent, variables: Record<string, string>) → string

Replace all `{{variableName}}` occurrences with values. Unknown variables are left as-is with a warning. Null/undefined values are replaced with empty string.

### renderTemplateFile(templatePath, outputPath, variables) → Result<void>

Read template file, render, atomic write to output.

### updateSentinelBlock(fileContent, sentinelStart, sentinelEnd, newBlockContent) → string

Find content between `sentinelStart` and `sentinelEnd` markers. Replace it. Preserve everything outside the sentinels. If sentinels not found, append the block.

Sentinels for RAUF.md: `<!-- rauf:managed:start -->` / `<!-- rauf:managed:end -->`
Sentinels for CLAUDE.md: `<!-- rauf:start -->` / `<!-- rauf:end -->`

## Module: backlog.ts

### readBacklog(projectPath) → Result<Backlog>

Read and validate `.rauf/backlog.json`.

### writeBacklog(projectPath, backlog: Backlog) → Result<void>

Atomic write with .bak backup.

### addItem(projectPath, input: CreateItemInput) → Result<BacklogItem>

1. Read current backlog
2. Compute next ID: `max(existing IDs as numbers) + 1`, zero-pad to 3 digits
3. Validate input fields (type, priority range, non-empty title)
4. If `dependsOn` provided, verify all referenced IDs exist
5. If no `acceptanceCriteria` provided, inject smart default from profile
6. Construct full BacklogItem with defaults (status="pending", completedAt=null)
7. `CreateItemInput` also accepts optional `source` ("human" | "review") and `reviewBatch` (ISO timestamp) fields
8. Append to items array
9. Write backlog
10. Return the new item

### updateItem(projectPath, itemId, updates: UpdateItemInput) → Result<BacklogItem>

1. Read backlog, find item by ID
2. Validate status transition if status is being changed
3. If status → "blocked" and no blockedReason, warn
4. If status → "done", set completedAt to ISO now
5. If dependsOn changed, validate referenced IDs exist
6. Merge updates onto item
7. Write backlog
8. Return updated item

### deleteItem(projectPath, itemId) → Result<void>

1. Read backlog, find item by ID
2. Block deletion of `in_progress` items if loop possibly active (check state.json)
3. Warn if other items have dependsOn referencing this ID
4. Remove from items array
5. Write backlog

### validateStatusTransition(current, target) → boolean

Check against the allowed transitions map.

### restoreFromBackup(projectPath) → Result<void>

Copy `.rauf/backlog.json.bak` → `.rauf/backlog.json` if backup exists.

### selectNextItem(backlog: Backlog) → BacklogItem | null

Returns the highest-priority pending item whose dependencies are all done. Returns null if no eligible items exist. Ties in priority broken by lower item ID (lexicographic). Takes a `Backlog` object (not a path) — caller must read the backlog first.

### resetStalledItems(projectPath) → Result\<{ resetCount: number }\>

Read backlog, reset all `in_progress` items to `pending` via `updateItem`. Returns count of reset items. Used by the loop runner at startup and by the server's LoopManager for stale loop recovery.

## Module: status.ts

### deriveStatus(projectPath) → Result<DerivedStatus>

**Tier 1 — state.json:**

1. Read `.rauf/state.json`
2. If valid, map status field to LoopStateEnum
3. Staleness check: if `updatedAt` > 5 min old AND status is "running", downgrade to PAUSED
4. Set stateSource = "state.json"

**Tier 2 — Log parsing fallback:**

1. If state.json missing/invalid, check rauf.log
2. Read last 1000 lines for recent status patterns
3. Read first 100 lines for start marker
4. Check file mtime for activity detection
5. Check DONE file existence and content
6. Apply state machine: IDLE / RUNNING / PAUSED / COMPLETE / PAUSED_HUMAN / LIMIT_REACHED
7. Set stateSource = "log-parsing"

**Always:** Read backlog.json for summary counts regardless of state source.

### readLogTail(projectPath, lines: number) → Result<string[]>

Read last N lines of rauf.log. Cap at 10000 for display.

### watchLog(projectPath, callback) → cleanup function

Watch rauf.log for changes using fs.watch. Call callback with new lines. Return cleanup function to stop watching.

### writeLoopState(projectPath, state) → Result\<void\>

Atomic write of `.rauf/state.json`. Auto-sets `updatedAt` to current ISO timestamp before writing. Validates against `LoopStateSchema` — returns `VALIDATION_ERROR` if invalid. The `deferredItems` field defaults to `[]` when omitted, keeping existing callers compatible.

### appendLog(projectPath, message) → Result\<void\>

Append a timestamped line to `.rauf/rauf.log`. Format: `[YYYY-MM-DD HH:MM:SS] message\n`. Creates the file if it doesn't exist (when `.rauf/` directory exists).

### writeDoneFile(projectPath, content) → Result\<void\>

Write content string to `.rauf/DONE` marker file. Overwrites if file already exists.

### clearDoneFile(projectPath) → Result\<void\>

Remove `.rauf/DONE` file. Returns `ok` even if the file doesn't exist (ENOENT is not an error).

### checkCancelRequested(projectPath) → boolean

Check if `.rauf/CANCEL` file exists. Returns boolean directly (not wrapped in Result). Used by the loop runner to detect graceful cancellation requests.

### clearCancelFile(projectPath) → Result\<boolean\>

Remove `.rauf/CANCEL` file. Returns `ok(true)` if the file existed and was removed, `ok(false)` if it didn't exist.

## Module: installer.ts

### install(projectPath, options: InstallOptions) → Result<InstallationReport>

Full installation flow for existing projects:

1. **Preflight checks** (§9.2 of PRD)
   - Directory exists?
   - Git repo? (warn if not)
   - .rauf.json already present? (offer repair, not reinstall)
   - jq in PATH? (warn)
   - claude in PATH? (warn)

2. **Profile detection** (§9.4)
   - Run detectProfile()
   - Apply user overrides from options
   - Store in marker file

3. **Create .rauf/ directory**

4. **Deploy artifacts** (§6.2)
   - RAUF.md: render from template with profile vars, respect sentinels
   - REVIEW.md: render from REVIEW.md.tmpl with profile vars
   - backlog.json: copy empty template if not exists, validate if exists
   - progress.md: copy template if not exists

5. **CLAUDE.md smart merge** (§9.3)
   - Search for `<!-- rauf:start -->` / `<!-- rauf:end -->`
   - If not found: append block
   - If found and current: skip
   - If found but different: replace bounded block only

6. **Write .rauf.json** with profile, hashes, options

7. **Return InstallationReport**

### update(projectPath) → Result<InstallationReport>

Re-sync artifacts:

- Re-render RAUF.md managed sections
- Re-render REVIEW.md (preserves user-customized versions)
- Update CLAUDE.md rauf section
- Never touch backlog.json or progress.md
- Update artifactHashes for updated files

### uninstall(projectPath, options) → Result<void>

Remove rauf artifacts (including RAUF.md and REVIEW.md). Preserve backlog/progress/log per user choice.

## Module: greenfield.ts

### initProject(targetPath, options: InitOptions) → Result<InstallationReport>

1. Create directory if needed (mkdir -p)
2. Validate path is under ROOT_DIRECTORY or get explicit confirmation
3. `git init` + `.gitignore` + empty initial commit
4. Configure profile from preset or user input
5. Scaffold CLAUDE.md from CLAUDE_GREENFIELD.md.tmpl
6. Install standard rauf artifacts (calls installer.install internally)
7. Seed backlog if seed source provided (JSON file, markdown checklist, or inline items)
8. Return report

### parseBacklogSeed(seedPath) → Result<BacklogItem[]>

- If .json: parse as Backlog schema or array of partial items
- If .md: parse `- [ ] [type] title` format, assign sequential priorities
- Fill defaults: priority from position, status="pending", auto-generated IDs

## Module: archive.ts

Moves done backlog items into monthly archive files under `.rauf/archive/YYYY-MM.json`.

**Archive file format:** `{ month: "YYYY-MM", items: BacklogItem[] }`. Appends to existing file if present.

**Write order:** Archive files written first, then `backlog.json` updated — safer failure mode (items temporarily in both) vs. data loss.

### sweepBacklog(projectPath, options?: { minAgeDays?: number }) → Result\<SweepResult\>

1. Read backlog via `readBacklog()`. Return error on failure.
2. Compute cutoff: if `minAgeDays > 0`, cutoff = `Date.now() - minAgeDays * 86_400_000`. Items completed after cutoff are kept. If `minAgeDays` is 0 or omitted, all done items are swept.
3. Separate `toArchive` (status === "done" and passes age check) from `toKeep`.
4. If `toArchive` is empty, return `{ archivedCount: 0, archivedMonths: [] }` early.
5. Group `toArchive` by month: `completedAt.slice(0, 7)` or `new Date().toISOString().slice(0, 7)` fallback for null.
6. `ensureDir(archiveDir)` — create `.rauf/archive/` if absent.
7. For each month group: read existing archive file (if present, validate), merge items, `atomicWrite` the file.
8. `writeBacklog(projectPath, { ...backlog, items: toKeep })`.
9. Return `ok({ archivedCount, archivedMonths: sorted keys })`.

### listArchiveMonths(projectPath) → Result\<string[]\>

- If archive dir absent: return `ok([])`.
- Read dir, filter for `/^\d{4}-\d{2}\.json$/`, strip `.json`, sort ascending.

### readArchiveMonth(projectPath, month) → Result\<ArchiveMonth\>

- Validates month format (`/^\d{4}-\d{2}$/`) — returns `VALIDATION_ERROR` if invalid.
- Reads and validates file against `ArchiveMonthSchema`.

### purgeArchive(projectPath, month?) → Result\<{ purgedCount: number, purgedMonths: string[] }\>

- If `month` provided: validate, delete that file. Non-existent month returns `ok({ purgedCount: 0 })`.
- If no `month`: list all months, delete each, attempt `rmdir` on archive dir.

## Module: budget.ts

Derives a right-sized iteration cap from the backlog's pending work instead of a flat default.

### computeMaxIterations(backlog, opts?)

```typescript
interface ComputeMaxIterationsOptions {
  safety?: number; // Multiplier on the raw estimate (default: 1.5)
  retryHeadroom?: number; // Flat iterations added for retry headroom (default: 5)
}

interface MaxIterationsEstimate {
  cap: number; // Derived iteration cap (floored at MIN_MAX_ITERATIONS=20 when pending > 0)
  pending: number; // Items with status "pending"
  avgIters: number; // Mean estimatedIterations across pending items (missing defaults to 1)
  needed: number; // Raw estimate before floor: ceil(pending * avgIters * safety) + retryHeadroom
}

function computeMaxIterations(
  backlog: Backlog,
  opts?: ComputeMaxIterationsOptions,
): MaxIterationsEstimate;
```

- When `pending === 0`, returns `cap: 0` (floor does not apply — nothing to budget for)
- Used by CLI commands (`loop run`, including `--detached`) and the web loop route when `--iterations` is omitted
- An explicit `--iterations` flag always overrides the computed cap
- `formatBudgetMath(estimate)` returns a human-readable budget line for the CLI

## Module: reset.ts

Orchestrates a full project reset for a fresh backlog cycle.

### resetProject(projectPath, options?: ResetProjectOptions) → Result\<ResetProjectResult\>

Options:

- `clearBacklog?: boolean` — empty the backlog items array (preserve project/description metadata)
- `keepProgress?: boolean` — when used with `clearBacklog`, preserve `progress.md` instead of archiving it
- `keepLog?: boolean` — when used with `clearBacklog`, preserve `rauf.log` instead of archiving it

Steps:

1. Sweep all done items to archive (no min-age filter)
2. Reset `in_progress` items → `pending`
3. Delete `state.json` (swallow ENOENT)
4. Clear DONE and CANCEL marker files
5. If `clearBacklog` and not `keepProgress`: archive `progress.md` → `.rauf/archive/YYYYMMDD-HHmmss-progress.md`, deploy fresh template
6. If `clearBacklog` and not `keepLog`: archive `rauf.log` → `.rauf/archive/YYYYMMDD-HHmmss-rauf.log`
7. If `clearBacklog`: empty backlog items array (preserve project/description)

Archive naming uses compact timestamps (`YYYYMMDD-HHmmss`) — never overwrites previous archives.

## File locations summary

| Module writes to | Files                                                                       |
| ---------------- | --------------------------------------------------------------------------- |
| config.ts        | `.rauf.json`, `~/.rauf/config.json`                                         |
| backlog.ts       | `.rauf/backlog.json`, `.rauf/backlog.json.bak`                              |
| archive.ts       | `.rauf/archive/YYYY-MM.json`                                                |
| reset.ts         | `.rauf/archive/YYYYMMDD-HHmmss-*`, `.rauf/state.json`, `.rauf/backlog.json` |
| installer.ts     | All `.rauf/` files, CLAUDE.md, `.rauf.json`                                 |
| greenfield.ts    | All of installer + directory creation + git init                            |
| status.ts        | `.rauf/state.json`, `.rauf/rauf.log`, `.rauf/DONE`, `.rauf/CANCEL`          |
| discovery.ts     | (read-only)                                                                 |
| profile.ts       | (read-only, result stored by installer)                                     |
| template.ts      | (pure functions, no direct file I/O unless renderTemplateFile)              |
| budget.ts        | (pure function — no file I/O)                                               |

---

## Loop Runner Hardening (packages/loop)

The following behaviors live in `packages/loop` but are documented here because they directly interact with core schemas and the backlog/state files managed by `packages/core`.

### Exit Taxonomy

Every finished claude spawn is classified into one of seven `ExitClass` values by `exit-classifier.ts`. Classification is pure/side-effect-free.

| ExitClass       | Trigger                                                                             |
| --------------- | ----------------------------------------------------------------------------------- |
| `done`          | Explicit `RAUF_DONE` signal                                                         |
| `blocked`       | Explicit `RAUF_BLOCKED` signal                                                      |
| `needs_human`   | Explicit `RAUF_NEEDS_HUMAN` signal                                                  |
| `usage_limited` | Usage-limit banner found in `reconstructedText`/`stdout` **or** `stderr`            |
| `timeout`       | Process killed by the session timeout                                               |
| `infra_error`   | Fast non-zero exit (< `INFRA_FAST_MS` = 10 s) with no usage banner                  |
| `genuine_retry` | All other no-signal exits (long-running, exit 0, or slow non-zero without a banner) |

**Classification precedence (evaluated top-down):**

1. Explicit signal (done/blocked/needs_human) → that class
2. Usage banner in `reconstructedText ?? stdout` OR in `stderr` → `usage_limited`
3. `timedOut` → `timeout`
4. `exitCode !== 0 && durationMs < INFRA_FAST_MS` → `infra_error`
5. Otherwise → `genuine_retry`

### Never Block on a Missing Signal

A missing signal (`none`) **never**, by itself, marks an item `blocked`. The `ExitClass` determines what happens:

- `usage_limited` → reset item to `pending`, route to usage-limit handler (sleep or halt)
- `timeout` → genuine block with reason `"Timed out after Ns"`
- `infra_error` → item stays `pending`, increment `consecutiveInfraFailures` counter
- `genuine_retry` → retry up to `maxRetries`; on exhaustion, set `blocked + deferred: true` with reason `"No signal after N attempts (deferred by runner)"` and push to `deferredItems`

The `deferred` flag on `BacklogItem` distinguishes a runner "false block" from a genuine agent block — `rauf reset`/`resume` requeue deferred items to `pending` while leaving genuine blocks untouched.

No-op iterations (`usage_limited`, `infra_error`) do **not** consume the iteration budget — `iterationCount` is decremented and a note is appended to the log.

### Circuit Breaker

When `consecutiveInfraFailures >= circuitBreakerThreshold` (default 3), the loop halts immediately:

- Writes state `error` with message `"Circuit breaker: N consecutive infra failures — halting"`
- Emits `loop_error` event and writes DONE summary
- The counter resets to 0 on any real outcome (done/blocked/needs_human/timeout/genuine_retry exhaustion)
- Usage-limit deaths do NOT increment the counter

This prevents the loop from spinning indefinitely when every spawn dies the same way (e.g. a broken CLI install).

### Commit Reconciliation (`recovered_via_commit`)

Before recording any non-done outcome for an item, the runner checks:

1. `findItemCommit(projectPath, itemId, sinceRef?)` — does a `[rauf] <id>:` commit exist in git history **after `sinceRef`**?
2. `isTreeClean(projectPath)` — is the working tree clean?

If both are true → the item is promoted to `done` (not blocked/deferred), `item_completed` is emitted, and `"recovered_via_commit: <hash>"` is appended to the log. This handles the case where the agent committed and verified but died before printing `RAUF_DONE`.

If the tree is dirty after a non-done exit → abandoned work is stashed (excluding `.rauf/` and `backlog.json`) before the next item starts.

**Why bounded reconciliation (`sinceRef`)?** Rauf restarts backlog IDs at `001` for every new backlog cycle (e.g. after `rauf backlog reset --clear`). An unbounded `git log` search for `[rauf] 001:` would find a commit from the _previous_ cycle and falsely promote a fresh item 001 to `done`. The runner captures the HEAD commit at loop start as `baseCommitHash`, persists it in `state.json`, and passes it as `sinceRef` to every `findItemCommit` call — so only commits made during this run can trigger recovery. `rauf reset`/`resume` read `baseCommitHash` from `state.json` and apply the same bound when reconciling on behalf of the user.

### Usage-Limit Pause/Resume

When a usage limit is hit and `sleepOnLimit` is `false` (default: `true`):

- Loop writes state `paused_usage_limit` and a DONE summary with the hint `"paused_usage_limit:<resetsAt> — run \`rauf resume\`"`
- Exits cleanly instead of sleeping
- `rauf resume` detects this state, applies reconciliation + false-block requeue, and relaunches the loop

When `sleepOnLimit` is `true` (default), the runner parses the reset time from the banner (`/resets\s+(\d{1,2}(?::\d{2})?\s*[ap]m)/i`) and sleeps until that local time + 60 s buffer, falling back to 60 s if no match.

### Usage Preflight OAuth Token

`runUsagePreflight()` reads the Claude OAuth token via `readClaudeOAuthToken()` (from `packages/core/src/config.ts`):

- **Token source:** `~/.config/claude-code/credentials.json` → `.claudeAiOauth.accessToken`
- **Errors:** `FILE_NOT_FOUND` (file absent or unreadable), `INVALID_JSON` (malformed), `VALIDATION_ERROR` (missing fields or empty token)

When the token read fails, the preflight is skipped **with no behavior change** — reactive banner detection (items 005/006) still covers the usage-limit case. The runner logs the specific error code and message plus a remediation hint:

```
OAuth token unavailable (FILE_NOT_FOUND: Claude credentials file not found: /home/user/.config/claude-code/credentials.json). Ensure Claude Code is authenticated (token: ~/.config/claude-code/credentials.json → .claudeAiOauth.accessToken). Relying on reactive banner detection.
```

This makes degraded-mode visible in the log without causing a false alarm or changing loop behavior.
