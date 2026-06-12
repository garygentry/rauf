# 07 — Testing Strategy

How Phase 1 (observation substrate) is verified. Every test below traces to a PRD requirement and to a
Success Criterion (`SC-1`…`SC-7`, [`PRD.md`](./PRD.md) §8). The verification command (from
`forge.config.json`) is **`pnpm typecheck && pnpm test && pnpm lint`** (plus `pnpm format:check`); SC-7
is "all three pass."

> Source of truth: [`tech-spec.md`](./tech-spec.md) §8. Shared types referenced here are defined in
> [`00-core-definitions.md`](./00-core-definitions.md); the units under test are specified in
> [`02-event-log.md`](./02-event-log.md), [`03-active-loop-registry.md`](./03-active-loop-registry.md),
> [`04-cli-monitoring-surface.md`](./04-cli-monitoring-surface.md),
> [`05-web-observation-parity.md`](./05-web-observation-parity.md), and
> [`06-agent-commit-rule.md`](./06-agent-commit-rule.md).

## Requirement Coverage

| REQ ID         | Verified by                                                       | SC    |
| -------------- | ---------------------------------------------------------------- | ----- |
| REQ-EVT-01/03/05 | `events-log.test.ts` (append→read, seq, rotate)                | SC-6  |
| REQ-EVT-02     | `events-log.test.ts` (token coalescing)                          | SC-6  |
| REQ-EVT-06     | `events-log.test.ts` / `fs-utils.test.ts` (whole-line append)    | SC-6  |
| REQ-REL-01     | `events-log.test.ts` / `fs-utils.test.ts` (torn-line tolerance)  | SC-3  |
| REQ-REL-02/03  | `events-log.test.ts` + sandbox (status from `state.json` alone)  | SC-3, SC-7 |
| REQ-DISC-03/04 | `loop-registry.test.ts` (register/list, concurrency)             | SC-2  |
| REQ-DISC-05    | `loop-registry.test.ts` (stale self-heal)                        | SC-3  |
| REQ-DISC-01/02/06 | CLI tests (empty-not-silent, `status --all`)                  | SC-2  |
| REQ-SEC-01     | `loop-registry.test.ts` / `events-log.test.ts` (sandbox reject)  | SC-3  |
| REQ-OBS-02     | sandbox integration (events⇄state never-contradict)              | SC-6  |
| REQ-OBS-03     | web `routes/loop.test.ts` + manual SC-1 check                    | SC-1  |
| REQ-MON-01/02/03 | CLI `loop-commands.test.ts` / `commands.test.ts` / `follow-command.test.ts` | SC-4 |
| REQ-WEB-01/03  | web `routes/loop.test.ts`                                         | SC-1  |
| REQ-COMMIT-01/02 | doc/template grep guard + dogfood loop                         | SC-5  |
| REQ-COMPAT-01/03 | compatibility test + cross-package typecheck                   | SC-7  |

---

## 1. Framework, location, conventions

- **Runner:** Vitest. Tests are **co-located** as `*.test.ts` next to source (CLAUDE.md convention,
  confirmed across `packages/core/src/*.test.ts`).
- **Fixtures:** temp-dir factories (the existing core tests build a throwaway state dir under
  `os.tmpdir()` and `resolveBacklogPaths` against it — follow that pattern; e.g.
  `backlog-root.test.ts`, `lock.test.ts`, `status.test.ts`).
- **No new external test deps.** `zod`, `node:fs`, `node:os`, `node:path`, `node:crypto` only.
- **Type-level:** where a discriminated-union narrowing matters (e.g. `PersistedEvent`), use
  `expectTypeOf` from vitest.
- **Process liveness in tests:** the registry's reconciliation reads `process.kill(pid, 0)` +
  `/proc/<pid>/stat`. Tests use `process.pid` (alive) and a deliberately-dead pid (e.g. spawn a short
  `node`/`bun` child, capture its pid, `await` its exit, then assert the entry is pruned) — mirror how
  `lock.test.ts` exercises `isProcessAlive`/`isProcessRecycled`.

---

## 2. New core unit tests

### 2.1 `packages/core/src/events-log.test.ts` (NEW) — REQ-EVT-*, REQ-REL-01/03, SC-6/SC-3

Unit-tests `appendEvent`, `readEvents`, `rotateEventsLog`, `watchEvents` (spec: `02-event-log.md`).

- **Append→read round-trip.** `appendEvent` N records, `readEvents` returns them in order with all
  fields intact. (REQ-EVT-01)
- **`seq` is monotonic and dense.** Records carry `seq` `0,1,2,…` with no gaps when no coalescing
  occurred; the value is assigned only on write. (REQ-EVT-03)
- **Token coalescing.** Drive `persistEvent` (or its extracted coalescing helper) with a burst of
  `llm_token_update`s inside one `TOKEN_COALESCE_MS` window → **exactly one** token record is written;
  structural events interleaved in the same window are **all** written; advancing the clock past the
  window lets the next token update through. (REQ-EVT-02) — use a fake/injected clock, not real
  `sleep`, so the test is deterministic.
- **Torn trailing line tolerance.** Append valid records, then append a partial JSON fragment **without
  a trailing newline** (simulating a crash mid-write); `readEvents` returns all earlier valid records
  and skips the fragment — never throws. (REQ-REL-01)
- **Rotation.** With an existing `events.ndjson`, `rotateEventsLog` moves it to
  `archive/{ts}-events.ndjson` (timestamp matches `reset.ts`'s `{ts}-<filename>` pattern) and leaves
  the live path absent/empty; a subsequent run starts a fresh file. No-op when the file is absent.
  (REQ-EVT-05)
- **Missing file → `ok([])`.** `readEvents` on a path with no file returns `ok([])`, not an error.
  (REQ-REL-03)
- **Sandbox guard.** `appendEvent` with a `paths.eventsLog` resolving outside `paths.stateDir` returns
  `PATH_VIOLATION` and writes nothing. (REQ-SEC-01)
- **Best-effort never throws.** A write failure surfaces as a `Result` `err` from `appendEvent`, and
  the runner-level `persistEvent` swallows it (covered in §4 sandbox; assert here that `appendEvent`
  returns `err(IO_ERROR)` rather than throwing).

### 2.2 `packages/core/src/loop-registry.test.ts` (NEW) — REQ-DISC-03/04/05/06, REQ-SEC-01, SC-2/SC-3

Unit-tests the registry (spec: `03-active-loop-registry.md`). Point `ACTIVE_DIR` at a temp dir (inject
`TOOL_CONFIG_DIR` / `HOME` override, as `config.test.ts` does) so tests never touch the real `~/.rauf`.

- **register → list → deregister.** `registerLoop(entry)` then `listActiveLoops()` returns it (with
  `pid = process.pid`, so it reconciles as live); `deregisterLoop(stateDir)` removes it; `listActiveLoops`
  is then empty. `deregisterLoop` is **idempotent** (second call is a no-op `ok`). (REQ-DISC-03)
- **Stale self-heal.** Write an entry whose `pid` belongs to a now-dead process; `listActiveLoops`
  reconciles against `.loop.lock` + process liveness, **unlinks** the stale entry, and **excludes** it
  from the result. A later `listActiveLoops` confirms the file is gone. (REQ-DISC-05, SC-3)
- **Concurrency / no corruption.** Register and deregister many distinct entries (distinct state dirs →
  distinct `<hash>.json` files) in rapid succession (e.g. `Promise.all` over 50 ops); the final
  `listActiveLoops` is internally consistent and no file is partially written. Because each loop owns
  its own file, this proves the structural concurrency-safety claim. (REQ-DISC-04)
- **Machine-wide listing.** Entries for several different resolved state dirs all appear in one
  `listActiveLoops()` regardless of cwd. (REQ-DISC-02/06)
- **Corrupt entry skipped.** A malformed `<hash>.json` is skipped (not fatal); valid entries still
  return. (REQ-REL-01 analogue / REQ-OBSV-01)
- **Sandbox guard.** A registry write that would resolve outside `~/.rauf` returns `PATH_VIOLATION`.
  (REQ-SEC-01)

### 2.3 `packages/core/src/lock.test.ts` (EXTEND) — REQ-DISC-05

- **`checkLockFile` extraction preserves behavior.** Add cases asserting `checkLockFile(lockPath)`
  returns the same `LockStatus` (note: `LockStatus`, lock.ts:39 — **not** `LockSummary`) that the old
  `checkLock(paths)` produced for the equivalent input (alive holder → `locked:true, stale:false`; dead
  pid → `stale:true`; absent file → `locked:false`). The **existing** `checkLock` tests must still pass
  unchanged (it now delegates). (Spec: `03-active-loop-registry.md` §4.)

### 2.4 `packages/core/src/fs-utils.test.ts` (EXTEND) — REQ-EVT-06, REQ-REL-01

- **`appendLine`.** Appends exactly `line + "\n"`; multiple appends accumulate whole lines; returns
  `err(IO_ERROR)` on an unwritable path.
- **`readNdjson`.** Round-trips valid lines against a supplied schema; **skips** a torn/partial trailing
  line and any schema-invalid line, returning earlier valid records; tolerates unknown future fields
  (additive-only); missing file → `ok([])`.

---

## 3. CLI tests (update + add) — REQ-MON-*, REQ-DISC-01/02/06, SC-2/SC-4

Spec: `04-cli-monitoring-surface.md`.

### 3.1 Clean-break assertions (UPDATE)

- `packages/cli/src/loop-commands.test.ts:100` — the loop subcommand-list assertion changes from
  `["start","stop","follow","run","review","watch"]` → **`["start","stop","run","review"]`**. Remove the
  `handleLoopFollow`/`handleLoopWatch` behavior tests (the handlers are deleted). (REQ-MON-02, SC-4)
- `packages/cli/src/commands.test.ts` — top-level command-registry assertions gain `follow` and drop any
  reference to `loop watch`/`loop follow` as monitor surfaces. (REQ-MON-01/02)
- Any `status` usage-string assertion that reads `[--watch] [--interval N]` updates to
  `[--follow] [--json] [--interval N] [--all]`. (REQ-MON-03, SC-4)

### 3.2 New CLI tests (ADD)

- `packages/cli/src/follow-command.test.ts` (NEW) — the top-level `follow` (a) replays the current run's
  `events.ndjson` (via `readEvents`) then tails (`watchEvents`), (b) does **not** stitch the archived
  log, (c) under `--json` emits one `PersistedEvent` per line, (d) terminates on terminal status from
  `deriveStatus`. (REQ-OBS-04, REQ-MON-03)
- **Empty-is-never-silent** (in `status-commands.test.ts` or a new file) — running a read on an idle/empty
  root (1) names the inspected directory, and (2) when a registry entry reports a loop live in **another**
  root, surfaces that root + its state. Drive it by seeding a temp `~/.rauf/active/` entry. (REQ-DISC-01/02,
  SC-2)
- **`status --all`** — lists every live loop from the (reconciled) registry, machine-wide, and honors
  `--json` (NDJSON/array). (REQ-DISC-06)
- **`--json` everywhere** — `log --json`, `--json` under `--follow` for `status`/`log`/`follow`.
  (REQ-MON-03, SC-4)

---

## 4. Loop integration (test-sandbox) — REQ-OBS-02, REQ-REL-02, SC-3/SC-5/SC-6

Use the existing `test-sandbox/` harness (mock Claude, no API). Run `bash test-sandbox/verify.sh` (all
scenarios with assertions). New assertions:

- **Non-empty, consistent event log.** A mock-Claude run produces a non-empty `events.ndjson` whose
  final state is consistent with `state.json` — the **never-contradict invariant** (REQ-OBS-02, SC-6):
  every `state.json` status transition has a corresponding event line, and the log's terminal status
  does not contradict `state.json`.
- **Crash → registry not-live + status intact.** A killed-mid-run scenario (kill the runner process)
  leaves, on the next read: (a) the registry reporting the loop **not live** (self-heal, REQ-DISC-05),
  and (b) `state.json` still reporting correct status without replaying the log (REQ-REL-02). A torn
  final line in `events.ndjson` does not crash any reader. (SC-3)
- **Best-effort persistence is invisible to loop correctness.** A scenario where `events.ndjson` is made
  unwritable (e.g. read-only dir) still completes the loop and reports correct status from
  `state.json` + `rauf.log` — persistence failure is fully silent (REQ-PERF-01, REQ-REL-02/03).

> **Self-hosting safety (C-5).** Any dogfood/sandbox loop runs with the frozen **`rauf-stable`** binary,
> never the dev `rauf` being changed. The dev loop executes built `dist/@rauf/loop`, so
> `pnpm --filter @rauf/loop build` must precede sandbox runs that exercise runner changes
> (memory: `rauf_dev_runs_dist_not_src`).

### 4.1 Dogfood commit check — REQ-COMMIT-01/02, SC-5

A dogfood loop run (with `rauf-stable`) over a one-item backlog produces **exactly one commit per item**
with **no agent-side commit** — verifying the runner-owns-commit rule end-to-end and that
`events.ndjson` is excluded from the per-item commit (`RUNTIME_EXCLUDE_PATHSPECS`).

---

## 5. Web tests — REQ-WEB-01/03, REQ-OBS-03, SC-1

Spec: `05-web-observation-parity.md`. Backend has a test harness; **the web client does not**.

- `packages/web/src/server/routes/loop.test.ts` (UPDATE/ADD):
  - `/api/projects/:id/loop/events` serves a project's `events.ndjson` (replay-then-tail) **without a
    server-owned runner** — proving in-process parity at the API boundary. (REQ-WEB-01, SC-1)
  - `/api/loops` returns **registry-reconciled** loops (`listActiveLoops`), not just
    `manager.listActive()` server-owned ones. (REQ-WEB-03)
  - Concurrent-tail safety: tailing while a writer appends only ever exposes a torn **trailing** line,
    which `readNdjson` tolerates (no 500). (REQ-REL-01)
- **`<EventTimeline>` (frontend) — not unit-tested.** There is no frontend test harness today, so the
  component's parity is verified two ways: **(a)** at the API boundary by `routes/loop.test.ts` above
  (the data it consumes is proven correct), and **(b)** a **manual SC-1 check** (see §6). Standing up a
  frontend test harness is **out of scope for Phase 1** (tech-spec §8).

---

## 6. Manual verification checklist (Phase-1 acceptance pass)

Automated tests don't cover the headline cross-surface claim end-to-end, so the acceptance pass includes:

- [ ] **SC-1 (headline).** With **no server running**, start a foreground `rauf loop run`. Confirm
      `rauf status`, `rauf follow`, **and** the web status page's `<EventTimeline>` all show live data
      **identical in kind** to a detached/server-owned run. The in-process/server asymmetry is gone.
- [ ] **SC-2.** `rauf status` on an idle/non-existent root names the inspected dir; with a loop live in
      another `--backlog` root, it names that root + state. `status --all` lists it.
- [ ] **SC-4.** `loop watch`, `loop follow`, and `status --watch` are gone (no alias); `follow` and
      `--follow`/`-f` work; `--json` works on every read incl. `status --follow`.
- [ ] **SC-5.** The canonical commit sentence reads identically across the installed `RAUF.md` template,
      both artifact templates, and the prompt-builder reminder; dogfood loop → one commit per item.

---

## 7. Doc / template grep guards (CI-able) — REQ-COMMIT-01/02, SC-5

Spec: `06-agent-commit-rule.md` §7. These are mechanical and should run in `pnpm test` or a lint step:

- [ ] No `"Commit your changes"` / `"Commit with:"` remains in the **three** templates
      (`CLAUDE_ADDON.md`, `CLAUDE_GREENFIELD.md.tmpl`, `.rauf/RAUF.md.tmpl`) **or** in
      `packages/core/src/embedded-artifacts.ts` (proves the regenerate step ran — see
      `01-architecture-layout.md` §6).
- [ ] The no-commit reminder line **is present** in `packages/loop/src/prompt-builder.ts`.
- [ ] `events.ndjson` is present in `RUNTIME_EXCLUDE_PATHSPECS` (`git-commit.ts`).
- [ ] The canonical wording matches `.rauf/RAUF.md` across all loci (string-identity check).

---

## 8. Compatibility — REQ-COMPAT-01/03, SC-7

- **No-`events.ndjson` install runs unchanged.** A project predating this version (no `events.ndjson`,
  no `~/.rauf/active/`) runs a loop and reports correct status from `state.json` alone; the new files are
  created on first run/registration. (REQ-COMPAT-01)
- **Cross-package typecheck.** `pnpm typecheck` passes for `core` **and** every package that depends on
  it (`loop`, `cli`, `web`) with the new exports. (REQ-COMPAT-03)
- **Rule #1 guard.** `grep -rn "@rauf/loop\|@rauf/cli\|@rauf/web" packages/core/src` returns nothing.

---

## Coverage targets

No numeric line-coverage gate is mandated by the PRD. The bar is **behavioral**: every Success Criterion
(`SC-1`…`SC-7`) has at least one automated test **or** an explicit manual-check entry (§6), and every new
public core function (`02`/`03`) has a unit test for its happy path, its error/`Result`-`err` path, and
its degradation path (missing file, torn line, stale entry).

## Dependencies

- All implementation docs `02`–`06` (the units under test) and `00-core-definitions.md` (the types the
  tests assert against). `07` is implemented **last** — but the per-module unit tests in §2/§3/§5 are
  written **alongside** their modules (TDD-friendly), not deferred to the end.

## Verification

- [ ] `pnpm typecheck && pnpm test && pnpm lint && pnpm format:check` all pass (SC-7).
- [ ] `bash test-sandbox/verify.sh` passes including the new event-log/registry/crash assertions (§4).
- [ ] Every row in the §0 Requirement-Coverage table has a corresponding passing test or checked manual
      item.
