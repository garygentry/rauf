# 01 — Architecture & Layout

How Phase 1 (observation substrate) is structured across the rauf monorepo: which files are new,
which are touched, the dependency graph (architecture rule #1 preserved), the on-disk layout, and the
build/regeneration steps that are easy to forget. Shared types referenced throughout are defined in
[`00-core-definitions.md`](./00-core-definitions.md).

> Decisions trace to [`tech-spec.md`](./tech-spec.md) §2 (Module Structure) and `D1`–`D9`.

## Requirement Coverage

| REQ ID        | Requirement                                                  | Section                  |
| ------------- | ------------------------------------------------------------ | ------------------------ |
| REQ-COMPAT-03 | `core` retains zero imports from `cli`/`web`                 | 4 Dependency graph       |
| REQ-EVT-01    | `events.ndjson` lives in the backlog root's state dir        | 5 On-disk layout         |
| REQ-EVT-05    | Per-run rotation into `archive/`                             | 5 On-disk layout         |
| REQ-DISC-03   | Registry under `~/.rauf/active/`                             | 5 On-disk layout         |
| REQ-COMMIT-02 | `embedded-artifacts.ts` is generated — regenerate, not edit  | 6 Build & regeneration   |
| REQ-COMPAT-01 | Additive; existing installs unaffected                       | 5, 7 Verification        |
| REQ-COMPAT-02 | No migration of historical state; old archived runs accepted | 5 On-disk layout         |

> The behavioral REQs for each module are covered in the domain docs (`02`–`06`). This document maps
> **where** the work lands and **how it builds**, not what each function does.

---

## 1. Packages Touched

No new packages. Work lands in the four existing packages, the artifact templates, and the docs. Per
architecture rule #1, **all new filesystem + registry logic lives in `packages/core`**; `loop`, `cli`,
and `web` only wire it up.

```
rauf/
├── packages/
│   ├── core/      NEW modules: events-log.ts, loop-registry.ts
│   │              EDIT: fs-utils.ts, errors.ts, backlog-root.ts, schemas.ts, lock.ts, status.ts, index.ts
│   ├── loop/      EDIT: runner.ts, git-commit.ts, prompt-builder.ts        (wire-up only)
│   ├── cli/       EDIT: commands.ts, status-commands.ts, loop-commands.ts   (clean break + unify)
│   │              NEW: follow-command.ts
│   └── web/       EDIT: server/routes/loop.ts, server/loop-manager.ts,
│                       client/routes/projects/status.tsx, client/routes/projects/index.tsx
├── artifacts/variants/backlog-json/
│              EDIT: CLAUDE_ADDON.md, CLAUDE_GREENFIELD.md.tmpl, .rauf/RAUF.md.tmpl  (commit-rule)
└── docs/      EDIT: SCHEMAS.md, SPEC-CORE.md, SPEC-CLI.md, SPEC-WEB.md, SPEC-ARTIFACTS.md,
                    ARCHITECTURE.md, SPEC-BACKLOG-TOOL-CONTRACT.md
```

---

## 2. `packages/core` — new modules + edits

### New files

| File | Public exports (re-exported via `index.ts`) | Spec doc |
| --- | --- | --- |
| `src/events-log.ts` | `appendEvent`, `readEvents`, `rotateEventsLog`, `watchEvents` | `02-event-log.md` |
| `src/loop-registry.ts` | `registerLoop`, `deregisterLoop`, `updateLoopStatus`, `listActiveLoops`, `registryEntryPath` | `03-active-loop-registry.md` |

### Edited files

| File | Change | Spec doc |
| --- | --- | --- |
| `src/fs-utils.ts` | add `appendLine(filePath, line): Result<void>`, `readNdjson<T>(filePath, schema): Result<T[]>` (torn-line tolerant) | `02` |
| `src/errors.ts` | add `IO_ERROR` to `ErrorCodes` | `00`, `02` |
| `src/backlog-root.ts` | add `eventsLog` field to `BacklogPaths`; populate in `resolveBacklogPaths()` | `00` |
| `src/schemas.ts` | add `PersistedEventSchema`/`PersistedEvent`, `ActiveLoopEntrySchema`/`ActiveLoopEntry`, `EVENTS_SCHEMA_VERSION`, `TOKEN_COALESCE_MS`, `EVENTS_LOG_FILENAME` | `00` |
| `src/lock.ts` | extract `checkLockFile(lockPath): Result<LockStatus>`; `checkLock(paths)` delegates to it | `03` |
| `src/status.ts` | `deriveStatus`/empty-path callers surface inspected dir + registry liveness | `04` |
| `src/index.ts` | add `export * from "./events-log.js";` and `export * from "./loop-registry.js";` | this doc §3 |

---

## 3. Barrel exports (`packages/core/src/index.ts`)

The barrel already uses `export * from "./<module>.js"` for every core module (`index.ts:6–26`).
`fs-utils`, `errors`, `schemas`, `backlog-root`, `lock`, and `status` are **already** re-exported, so
their new additions surface automatically. Only the two new modules need new lines:

```typescript
// packages/core/src/index.ts — add (alphabetical-ish, near the other state modules)
export * from "./events-log.js";
export * from "./loop-registry.js";
```

After this, the full Phase-1 public surface from `@rauf/core` is:

```typescript
// from events-log.ts
appendEvent, readEvents, rotateEventsLog, watchEvents
// from loop-registry.ts
registerLoop, deregisterLoop, updateLoopStatus, listActiveLoops, registryEntryPath
// from fs-utils.ts
appendLine, readNdjson           // (+ existing atomicWrite, validatePath, ensureDir, fileExists, …)
// from lock.ts
checkLockFile                    // (+ existing checkLock, acquireLock, releaseLock, …)
// from schemas.ts
PersistedEvent(Schema), ActiveLoopEntry(Schema), EVENTS_SCHEMA_VERSION,
TOKEN_COALESCE_MS, EVENTS_LOG_FILENAME
// from errors.ts
ErrorCodes.IO_ERROR
// from backlog-root.ts
BacklogPaths.eventsLog           // (field on existing exported interface)
```

`web` consumes a subset through its own subpath build; no `web`/`cli`-specific exports are added to
core (rule #1).

---

## 4. Dependency graph (rule #1 preserved)

```
                ┌──────────────┐
                │ @rauf/core   │  ← owns ALL new fs + registry logic
                │  events-log  │     (events.ndjson, ~/.rauf/active/)
                │  loop-registry│
                └──────┬───────┘
            ┌──────────┼───────────┐
            │          │           │
       ┌────▼───┐  ┌───▼────┐  ┌───▼────┐
       │ loop   │  │  cli   │  │  web   │
       │ wires  │  │ wires  │  │ wires  │
       └────────┘  └────────┘  └────────┘
```

- `core` imports **nothing** from `loop`/`cli`/`web` (REQ-COMPAT-03; verified — the new modules import
  only `node:fs`, `node:path`, `node:crypto`, `zod`, and sibling core modules).
- `loop`/`cli`/`web` depend on `@rauf/core` via `workspace:*`.
- No new external runtime dependency (`node:crypto` is a built-in, available under Bun). See
  `tech-spec.md` §9.

**Single-writer invariant boundary.** `events.ndjson` has exactly one writer **per root** (the loop
runner); CLI/web/external agents are read-only against it (REQ-EVT-06). The registry under
`~/.rauf/active/` is intentionally **multi-writer** but contention-free because each loop writes only
its own `<hash>.json` file (REQ-DISC-04; `03-active-loop-registry.md`).

---

## 5. On-disk layout (after Phase 1)

Default root shown; `--backlog <dir>` isolates identically (each root has its own state dir, lock, and
now its own `events.ndjson`).

```
<projectRoot>/.rauf/
  state.json               authoritative status (atomic write)          [unchanged]
  events.ndjson            current run's persisted event stream         [NEW]
  iteration-status.json    live per-iteration tool/token status         [unchanged]
  rauf.log                 human log (fs.watch tailed)                  [unchanged]
  progress.md              accumulated learnings                        [unchanged]
  .loop.lock               PID + start-time; registry ground truth      [unchanged]
  archive/
    20260612-143052-events.ndjson   prior run's event log              [NEW; reset.ts {ts}- pattern]
    20260612-143052-rauf.log        existing archive naming            [unchanged]

~/.rauf/
  config.json              tool config                                  [unchanged]
  active/                  active-loop registry                         [NEW]
    a3f9c1e0d4b5f6a7.json  one entry per live loop, keyed by hash(stateDir)
```

- `events.ndjson` is **rotated at `runner.start()`** into `archive/{ts}-events.ndjson` (REQ-EVT-05 /
  D4), mirroring `reset.ts`'s `{ts}-<filename>` convention; then a fresh empty file is begun. No in-run
  rotation (accepted Phase-1 deferral; `tech-spec.md` §3.3).
- The registry directory `~/.rauf/active/` is created on demand (`ensureDir`) the first time a loop
  registers.
- **Additive guarantee (REQ-COMPAT-01):** an existing install with none of the NEW files works
  unchanged — `events.ndjson` is created on the next run, `~/.rauf/active/` on the next loop start, and
  every reader treats their absence as `ok([])` (REQ-REL-03).
- **No historical migration (REQ-COMPAT-02):** previously archived runs that have no `events.ndjson`
  are accepted as-is — nothing back-fills them. Only runs from this version forward produce an event
  log; `follow`/web replay of an archived run with no log simply shows no timeline (degrades to
  `state.json` + `rauf.log`). There is no migration step and none is required.

---

## 6. Build & regeneration (do not skip)

These are the build steps Phase 1 depends on; missing them silently ships stale behavior.

1. **`embedded-artifacts.ts` is GENERATED, not hand-authored.** The commit-rule fix
   (`06-agent-commit-rule.md`) edits the template sources, but `packages/core/src/embedded-artifacts.ts`
   — the *installed* source of truth — is produced by `scripts/generate-embedded-artifacts.ts`, which
   runs inside:
   ```bash
   pnpm --filter @rauf/core build
   #   → bun run scripts/generate-json-schemas.ts          (no new schema file in Phase 1)
   #   → bun run scripts/generate-embedded-artifacts.ts     (regenerates embedded-artifacts.ts)
   #   → prettier --write src/embedded-artifacts.ts && tsc
   ```
   After editing templates you MUST run this build, then confirm `embedded-artifacts.ts` no longer
   contains `"Commit your changes"` / `"Commit with:"` (grep guard in `07-testing-strategy.md`).
   (Verified: `packages/core/package.json:9`.)

2. **No new committed JSON schema.** `generate-json-schemas.ts` keeps emitting only
   `backlog.schema.json`. The `events.ndjson` envelope ships in code (`PersistedEventSchema`) without a
   published `*.schema.json` — formal versioning is Phase 3 (`tech-spec.md` §3.4).

3. **The dev loop runs built `dist/@rauf/loop`, not `src`.** Any `runner.ts` / `prompt-builder.ts` /
   `git-commit.ts` change requires `pnpm --filter @rauf/loop build` before a dev-loop run reflects it
   (memory: `rauf_dev_runs_dist_not_src`; `tech-spec.md` §6.5).

4. **Self-hosting safety (C-5).** Implementing loops run with the frozen `rauf-stable` binary
   (`forge.config.json` `loopRunner.bin: "rauf-stable"`) while the dev `rauf` is the thing being
   changed. Never run a loop with the binary that loop is rewriting.

5. **Verification command** (SC-7, `forge.config.json`): `pnpm typecheck`, `pnpm test`, `pnpm lint`
   (plus `pnpm format:check`).

---

## 7. Module-to-spec map

| Spec doc | Primary files | Concern |
| --- | --- | --- |
| `00-core-definitions.md` | `schemas.ts`, `errors.ts`, `backlog-root.ts` | shared types/constants/error code |
| `02-event-log.md` | `events-log.ts`, `fs-utils.ts`, `loop/runner.ts` | persist/read/rotate/watch + runner hook |
| `03-active-loop-registry.md` | `loop-registry.ts`, `lock.ts`, `loop/runner.ts` | registry + reconciliation + register wiring |
| `04-cli-monitoring-surface.md` | `cli/commands.ts`, `status-commands.ts`, `follow-command.ts`, `loop-commands.ts`, `status.ts` | clean break, `follow`, `--all`, empty-not-silent |
| `05-web-observation-parity.md` | `web/server/routes/loop.ts`, `loop-manager.ts`, `client/.../projects/*` | read-path parity + `<EventTimeline>` |
| `06-agent-commit-rule.md` | templates, `embedded-artifacts.ts`, `loop/prompt-builder.ts`, `git-commit.ts` | single-source commit rule |
| `07-testing-strategy.md` | `*.test.ts`, `test-sandbox/` | test plan → SC-1…SC-7 |

---

## Dependencies

- [`00-core-definitions.md`](./00-core-definitions.md) — all types/constants/error codes referenced
  here.

## Verification

- [ ] `events-log.ts` and `loop-registry.ts` exist in `packages/core/src/` and are re-exported from
      `index.ts`.
- [ ] `grep -rn "from \"@rauf/loop\"\|from \"@rauf/cli\"\|from \"@rauf/web\"" packages/core/src` returns
      nothing (rule #1).
- [ ] `pnpm --filter @rauf/core build` regenerates `embedded-artifacts.ts` and `embedded-artifacts.ts`
      contains no `"Commit your changes"`/`"Commit with:"`.
- [ ] `pnpm build && pnpm typecheck` pass across all packages with the new exports.
- [ ] A project with no `events.ndjson` / no `~/.rauf/active/` still runs and reports status (REQ-COMPAT-01).
