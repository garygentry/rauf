# 03 — Exit Codes (ux-overhaul-grammar)

Implements the unified exit-code machine contract from [`00-core-definitions.md`](./00-core-definitions.md) §1/§2a/§2b: the in-place `ExitCode` redefinition, the call-site re-point, the `loop run` terminal mapping, the `statusExitCode` rewrite, the `backlog validate` carve-out, and the documented contract feature-forge reads.

## Requirement Coverage

| REQ | Covered by (section) |
|-----|----------------------|
| REQ-EXIT-01 | §1 (`ExitCode` const), §3 (`loop run` mapping), §4 (`status` mapping) |
| REQ-EXIT-02 | §1 (collision removed), §2 (call-site audit + re-point) |
| REQ-EXIT-03 | §5 (`backlog validate` carve-out) |
| REQ-EXIT-04 | §6 (documented machine contract) |

> **Authority.** `00-core-definitions.md` §1/§2a/§2b is normative for the *values* and *meanings*. This
> doc IMPLEMENTS them — where any wording here appears to diverge, 00 wins. Line numbers were verified
> against source on 2026-06-13 and drift; re-confirm at implementation time.

## 1. Redefine `ExitCode` in place (REQ-EXIT-01, REQ-EXIT-02)

Replace the current const at `packages/cli/src/commands.ts:90-101` (today: `SUCCESS:0, ERROR:1,
INVALID_ARGS:2, NOT_FOUND:3, VALIDATION:4, CONFLICT:5, PAUSED_HUMAN:6`) with the canon table from
00 §1. The values at 3/4/5/6 change **meaning**, so this is a breaking redefinition, not a rename only.

```ts
// ─── Exit Codes ──────────────────────────────────────────────────

/**
 * Unified process exit codes (v0.5.0). Used by `status` (current loop state) and
 * `loop run` (terminal outcome). A MACHINE CONTRACT — downstream tools (feature-forge)
 * depend on these values. `backlog validate` keeps its own 0/1/2 triad (see §5).
 */
export const ExitCode = {
  SUCCESS: 0,      // clean terminal: idle / complete
  ERROR: 1,        // generic failure
  USAGE: 2,        // bad args / IO / failed precondition (incl. loop-already-running 409)
  NEEDS_HUMAN: 3,  // PAUSED_HUMAN
  LIMIT: 4,        // limit reached / usage-paused / sleeping
  BLOCKED: 5,      // terminal with blocked items
  RUNNING: 6,      // running — QUERY-TIME ONLY (`status`); never a `loop run` terminal code
} as const;
export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];
```

This removes the two inconsistencies REQ-EXIT-02 calls out:

- The `status`(1=running, 2=paused_human, 3=limit_reached) vs `loop run`(6=paused_human) disagreement —
  both now read the single table.
- The `1=running` / `1=error` collision — `1` is now exclusively `ERROR`; running moves to `RUNNING`(6).

The added `export type ExitCode` (a value derived from the const) is new; nothing else in the file
exports a conflicting `ExitCode` type. The const remains `as const` so member values stay literal.

## 2. Call-site audit and re-point (REQ-EXIT-02)

The old members `INVALID_ARGS`, `NOT_FOUND`, `VALIDATION`, `CONFLICT`, `PAUSED_HUMAN` cease to exist.
Every reference must be re-pointed per the 00 §1 remap:

| Old member (value) | New member | Why |
|--------------------|-----------|-----|
| `INVALID_ARGS` (2) | `USAGE` (2) | rename only — same value, same semantics |
| `NOT_FOUND` (3) | `USAGE` (2) | "no loop to stop" / missing project = failed precondition |
| `VALIDATION` (4) | `USAGE` (2) | bad input |
| `CONFLICT` (5) | `USAGE` (2) | loop-already-running 409 (**resolved decision 2026-06-13**) |
| `PAUSED_HUMAN` (6) | `NEEDS_HUMAN` (3) | canon needs-human code |

### Audit method

```bash
grep -rn "ExitCode\.\(INVALID_ARGS\|NOT_FOUND\|VALIDATION\|CONFLICT\|PAUSED_HUMAN\)" packages/*/src
```

After the change this grep must return **zero hits** — the old member names no longer exist, so any
survivor is a compile error (the const no longer has the key) and the verification grep catches stragglers
in comments/strings.

### Concrete per-file checklist (production code)

A dev follows this top-to-bottom; each line re-points one or more call sites. (Verify the exact lines at
impl — they drift; the grep above is the source of truth.)

- [ ] **`packages/cli/src/commands.ts`** — the const itself (§1); the dispatch fallback at `:506`
      (`INVALID_ARGS` → `USAGE`).
- [ ] **`packages/cli/src/loop-commands.ts`** — `:305`, `:672`, `:691`, `:711` (`CONFLICT` →
      `USAGE`, these are the loop-already-running / lock-conflict 409 sites); `:982` (`PAUSED_HUMAN`)
      is replaced wholesale by §3's mapping. (No `INVALID_ARGS`/`NOT_FOUND`/`VALIDATION` here.)
- [ ] **`packages/cli/src/status-commands.ts`** — arg-parse failures `:45`, `:68`, `:256`, `:267`,
      `:316`, `:325` (`INVALID_ARGS` → `USAGE`); `statusExitCode` body `:492-504` is replaced
      wholesale by §4.
- [ ] **`packages/cli/src/backlog-commands.ts`** — all `INVALID_ARGS` arg/IO sites → `USAGE`; `:423`,
      `:1029`, `:1031` (`NOT_FOUND` → `USAGE`); `:1033`, `:1035`, `:1039` (`VALIDATION` → `USAGE`);
      `:1037` (`CONFLICT` → `USAGE`). **Carve-out:** the `backlog validate` 0/1/2 path is unchanged —
      see §5; do not touch its findings/usage codes.
- [ ] **`packages/cli/src/install-commands.ts`** — `INVALID_ARGS` sites → `USAGE`; `:59`, `:286`,
      `:288` (`NOT_FOUND` → `USAGE`); `:290`, `:292`, `:297` (`VALIDATION` → `USAGE`); `:126`, `:295`
      (`CONFLICT` → `USAGE`).
- [ ] **`packages/cli/src/profile-config-commands.ts`** — `INVALID_ARGS` sites → `USAGE`; `:452`,
      `:454` (`NOT_FOUND` → `USAGE`); `:456`, `:458` (`VALIDATION` → `USAGE`); `:460` (`CONFLICT` →
      `USAGE`).
- [ ] **`packages/cli/src/migrate-commands.ts`** — `:55` (`INVALID_ARGS` → `USAGE`); `:222`
      (`LOCK_CONFLICT` → `CONFLICT` → `USAGE`); `:223` (`INVALID_JSON`/`VALIDATION_ERROR` →
      `VALIDATION` → `USAGE`).
- [ ] **`packages/cli/src/follow-command.ts`** — `:54`, `:66` (`INVALID_ARGS` → `USAGE`).
- [ ] **`packages/cli/src/main.ts`** — `:82`, `:116`, `:127` (`INVALID_ARGS` → `USAGE`).
- [ ] **`packages/cli/src/reset-commands.ts`** — `:44` (`INVALID_ARGS` → `USAGE`); `:66`
      (`CONFLICT` → `USAGE`).
- [ ] **`packages/cli/src/resume-commands.ts`** — `:255` (`INVALID_ARGS` → `USAGE`); `:278`
      (`CONFLICT` → `USAGE`).
- [ ] **`packages/cli/src/server-commands.ts`** — `:406`, `:630` (`CONFLICT` → `USAGE` — port/server
      already-running is a correctable precondition).

### Test re-point (same audit, in `*.test.ts`)

The grep also flags test assertions; these MUST be updated in lockstep or they fail to compile (the
member is gone). They are not gold-plating — they are the contract assertions:

- [ ] `commands.test.ts:369-372` — the literal-value asserts (`INVALID_ARGS===2`, `NOT_FOUND===3`,
      `VALIDATION===4`, `CONFLICT===5`) are **deleted/rewritten** to assert the new table
      (`USAGE===2`, `NEEDS_HUMAN===3`, `LIMIT===4`, `BLOCKED===5`, `RUNNING===6`).
- [ ] `backlog-commands.test.ts`, `install-commands.test.ts`, `profile-config-commands.test.ts`,
      `status-commands.test.ts`, `follow-command.test.ts`, `loop-commands.test.ts`,
      `reset-commands.test.ts`, `resume-commands.test.ts`, `server-commands.test.ts` — replace every
      `ExitCode.INVALID_ARGS|.NOT_FOUND|.VALIDATION|.CONFLICT|.PAUSED_HUMAN` per the §2 remap (each maps
      to `USAGE`, except `PAUSED_HUMAN`→`NEEDS_HUMAN`). The asserted **values** are unchanged for the
      former `INVALID_ARGS`/`NOT_FOUND`/`VALIDATION`/`CONFLICT` cases only where the new value is also `2`
      — i.e. all four collapse to `2`, so a test asserting `ExitCode.NOT_FOUND` (was `3`) now asserts
      `ExitCode.USAGE` (`2`): **the numeric expectation changes for `NOT_FOUND`/`VALIDATION`/`CONFLICT`**.
      Update the member reference AND confirm the numeric still matches the new behavior.

> **Why all four collapse to `USAGE`(2):** the canon reserves 3/4/5/6 for *loop-state* outcomes and 1 for
> generic failure. "Not found", "bad input", and "already running" are all correctable preconditions, so
> they share the usage code — `loop run --detached` hitting a 409 returns `USAGE`(2) (see tech-spec §7).

## 3. `loop run` terminal mapping (REQ-EXIT-01)

Replace the single ternary at `packages/cli/src/loop-commands.ts:982`:

```ts
// REMOVE:
return result.pausedReason === "needs_human" ? ExitCode.PAUSED_HUMAN : ExitCode.SUCCESS;
```

with the full ordered mapping over `LoopResult` (`packages/loop/src/runner.ts:62-72`, shape unchanged).
Order matters — the conditions are checked top-to-bottom and the first match wins (00 §2a). The
non-Result error path (the `catch` at `:983-985`, returning `ERROR`) already covers the "run failed /
errored" row, so the success-path mapping below sits in the place the ternary occupied:

```ts
// Map the terminal LoopResult to the unified exit code (00 §2a). Order is significant:
// needs-human → limit → blocked → clean. RUNNING(6) is never returned here — a finished
// run is not running.
const needsHuman = (result.needsHumanCount ?? 0) > 0 || result.pausedReason === "needs_human";
if (needsHuman) {
  return ExitCode.NEEDS_HUMAN; // 3
}
if (isLimitTerminal(result)) {
  return ExitCode.LIMIT; // 4 — limit-reached / usage-paused / sleeping terminal
}
if (result.blockedCount > 0) {
  return ExitCode.BLOCKED; // 5 — terminal with blocked items
}
return ExitCode.SUCCESS; // 0 — clean: completed / idle / cancelled-graceful
```

`LoopResult` exposes no first-class limit field today (it is `completedCount`, `blockedCount`,
`needsHumanCount?`, `cancelled`, `gracefulStop?`, `reviewItemsCreated?`, `reviewSummary?`,
`pausedReason?`). The `isLimitTerminal(result)` predicate must derive the limit/usage-paused/sleeping
terminal from the available fields — **at implementation, confirm how a limit-reached terminal surfaces
in `LoopResult`** (it may require reading the terminal `state.json` loopState, or extending `LoopResult`
with a `limitReason?` analogous to `pausedReason?`). The 00 §2a row exists; the carrier field is the one
implementation detail to pin. If no limit signal is reachable from the terminal result, the LIMIT branch
is unreachable from `loop run` and the same outcome is observed via `status` (§4) — but the ordered
mapping must still be written so the contract holds the moment the field exists. Do **not** invent a
`LoopResult` shape change beyond a clearly-named optional field; the 00 interface comment says "do NOT
change" the existing members.

**Error handling.** The `catch` block (`:983-985`) stays as-is and returns `ExitCode.ERROR`(1) — that is
the "run failed / errored (non-Result error path)" row of 00 §2a. No throw is introduced; the mapping is
pure over the resolved `LoopResult`.

## 4. `status` mapping (REQ-EXIT-01)

Rewrite `statusExitCode(state)` at `packages/cli/src/status-commands.ts:492-504` (today returns the old
1/2/3 codes) to the unified table over `LoopStateEnum` (`packages/core/src/schemas.ts:228-239`:
`IDLE, RUNNING, PAUSED, COMPLETE, PAUSED_HUMAN, LIMIT_REACHED, ERROR, NOT_INSTALLED, SLEEPING_LIMIT,
WEEKLY_LIMIT`), per 00 §2b:

```ts
/**
 * Map the current LoopStateEnum to the unified exit code (00 §2b, v0.5.0).
 * `status` is the only command that may return RUNNING(6) (query-time state).
 * The BLOCKED(5) row is derived from the backlog summary, not the loop state —
 * see the signature note below.
 */
function statusExitCode(state: LoopStateEnum): number {
  switch (state) {
    case "RUNNING":
      return ExitCode.RUNNING; // 6
    case "PAUSED_HUMAN":
      return ExitCode.NEEDS_HUMAN; // 3
    case "LIMIT_REACHED":
    case "SLEEPING_LIMIT":
    case "WEEKLY_LIMIT":
      return ExitCode.LIMIT; // 4
    case "ERROR":
      return ExitCode.ERROR; // 1
    case "IDLE":
    case "COMPLETE":
    case "PAUSED":
    case "NOT_INSTALLED":
      return ExitCode.SUCCESS; // 0
  }
}
```

The `switch` is exhaustive over the 10-member `LoopStateEnum` (every variant has a `case`), so under
`strict` + `noUncheckedIndexedAccess` no `default`/fallthrough return is needed and TypeScript proves the
function returns a code on every path. Returning `ExitCode.RUNNING` (a value, not the bare `6`) keeps the
code self-documenting and re-bindable.

**BLOCKED(5) — signature note (verify at impl).** The 00 §2b table has a
"terminal-with-blocked-items (derived) → BLOCKED(5)" row, but `statusExitCode` currently takes **only**
`state: LoopStateEnum` and has no access to the backlog summary (`genuineBlocked` is computed elsewhere
in the status formatter, `status-commands.ts:602`). A terminal state with blocked items currently maps to
`SUCCESS`(0) via `IDLE`/`COMPLETE`. To honor the BLOCKED row, `statusExitCode` must be widened to also
receive the derived blocked count (e.g. `statusExitCode(state, derived)` where
`derived.backlogSummary` exposes genuine blocked > 0), and the four call sites
(`status-commands.ts:88, 98, 139, 168` — all pass `result.value.loopState` / `status.loopState`) updated
to pass it. The BLOCKED branch is then: when `state` is a clean terminal (`IDLE`/`COMPLETE`/`PAUSED`)
**and** genuine blocked > 0, return `ExitCode.BLOCKED`(5) instead of `SUCCESS`(0). Pin the exact derived
field at implementation; the canon row is normative, the carrier is the impl detail. If the widening is
deferred, document it as a known gap against 00 §2b — but the preferred implementation widens the
signature so `status` and `loop run` agree on BLOCKED.

## 5. `backlog validate` carve-out (REQ-EXIT-03)

`backlog validate` **keeps its existing, coherent triad unchanged**: `0` valid / `1` findings / `2`
usage. It does NOT adopt the unified scheme. Concretely, the validate path in
`packages/cli/src/backlog-commands.ts` must continue to return `0` on a clean validation, `1` when
findings exist, and `2`(now spelled `ExitCode.USAGE`) on arg/IO error. The only edit in that path is the
mechanical `INVALID_ARGS → USAGE` rename for the usage error (same value `2`); the validity/findings
distinction (`0`/`1`) is untouched and must be guarded by the existing validate tests. Do not route
validate through `statusExitCode` or the §3 mapping.

## 6. Documented machine contract (REQ-EXIT-04)

This exit-code table **is** the machine contract feature-forge reads (it gates on `rauf version --json`
and branches on `status --json` + exit codes). The §1 table is normative and stable within v0.5.x;
feature-forge bumps `minRunnerVersion` `0.2.0 → 0.5.0` to require it in one check. The contract surface,
the version gate, and feature-forge's exit-code/status re-validation are owned by
[`05-cutover-and-feature-forge.md`](./05-cutover-and-feature-forge.md) (the out-of-loop cutover step,
REQ-CONTRACT-04/05) — this doc only establishes the values it depends on. The same table is mirrored into
`docs/SPEC-CLI.md` and `docs/SPEC-BACKLOG-TOOL-CONTRACT.md` as part of REQ-DOC-01 (owned by the docs
step, 01 §3 ordering step 6).

## Dependencies

- [`00-core-definitions.md`](./00-core-definitions.md) — §1 `ExitCode` contract, §2a `loop run` mapping,
  §2b `status` mapping, and the old→new remap are normative for this doc's values.
- [`01-architecture-layout.md`](./01-architecture-layout.md) — §1 per-package change map (this doc is the
  detail behind the `@rauf/cli` `commands.ts` / `loop-commands.ts` / `status-commands.ts` rows) and §3
  ordering (ExitCode redefinition = step 3, mappings = step 4, before the grammar step).
- Forward ref (not a dependency): [`05-cutover-and-feature-forge.md`](./05-cutover-and-feature-forge.md)
  consumes this table as the contract feature-forge gates on (REQ-EXIT-04).

## Verification

- `ExitCode` const in `commands.ts` matches 00 §1 exactly (`SUCCESS 0 / ERROR 1 / USAGE 2 / NEEDS_HUMAN 3
  / LIMIT 4 / BLOCKED 5 / RUNNING 6`); `export type ExitCode` present.
- `grep -rn "ExitCode\.\(INVALID_ARGS\|NOT_FOUND\|VALIDATION\|CONFLICT\|PAUSED_HUMAN\)" packages/*/src`
  returns **zero hits** (production code AND tests).
- `pnpm typecheck` is green: the redefined const drops the old keys, so any missed call site is a compile
  error, not a silent wrong code.
- Unit tests assert the full mapping tables: every `LoopResult` terminal outcome → expected code (00 §2a:
  needs-human→3, limit→4, blocked→5, clean→0; error path→1) and every `LoopStateEnum` → expected code
  (00 §2b: RUNNING→6, PAUSED_HUMAN→3, LIMIT_REACHED/SLEEPING_LIMIT/WEEKLY_LIMIT→4, ERROR→1, clean→0,
  terminal-with-blocked→5).
- The 409/loop-already-running path returns `ExitCode.USAGE`(2) (resolved decision); a test asserts it.
- `backlog validate` tests still assert `0`/`1`/`2` (unchanged); `RUNNING`(6) never appears as a
  `loop run` terminal code.
- `commands.test.ts` value-asserts updated to the new table (no `INVALID_ARGS`/`NOT_FOUND`/`VALIDATION`/
  `CONFLICT` literals remain).
