# 01 — Architecture & Layout (ux-overhaul-grammar)

The per-package change map, the touch-point inventory, and the change-ordering/dependency graph for the
v0.5.0 grammar + contract flip. No new packages or modules — this feature edits existing files across the
4-package monorepo plus `docs/` and the separate feature-forge repo. Shared definitions live in
[`00-core-definitions.md`](./00-core-definitions.md).

## Requirement Coverage

| REQ | Covered by (section) |
|-----|----------------------|
| REQ-EXEC-01..06 | §1 (@rauf/cli, @rauf/web), §3 ordering |
| REQ-FLAG-01..04 | §1 (@rauf/cli parser) |
| REQ-EXIT-01..04 | §1 (@rauf/cli, @rauf/loop) |
| REQ-SIG-01/02 | §1 (@rauf/core, @rauf/loop, docs) |
| REQ-EVT-01/02 | §1 (@rauf/core, docs) |
| REQ-RMV-01 | §1 (@rauf/cli) |
| REQ-CONTRACT-01..05 | §1 (versions, feature-forge), §3 cutover |
| REQ-DOC-01/02 | §1 (docs, @rauf/cli help) |

## 1. Per-package change map

### @rauf/cli (the bulk of the surface change)

| File | Change | REQ |
|------|--------|-----|
| `src/commands.ts` | Redefine `ExitCode` const to the unified table (00 §1); drop `loop start` from the subcommand registry + usage; add the removed-token remediation interceptor (00 §5); update `--help`/usage strings | REQ-EXIT-01, REQ-EXEC-02, REQ-RMV-01, REQ-DOC-02 |
| `src/loop-commands.ts` | Add `--detached`/`-d` branch to `handleLoopRun` (~620) delegating to the server-POST flow; remove `handleLoopStart` (~290) as a dispatchable verb, fold its body into a shared helper; replace the terminal-exit ternary (~979-983) with the full `LoopResult` mapping (00 §2a); ensure `--follow` stays CLI-side (not in the POST body) | REQ-EXEC-01/02/03/04/06, REQ-EXIT-01 |
| `src/status-commands.ts` | Rewrite `statusExitCode` (~492-504) to the unified state→code mapping (00 §2b) | REQ-EXIT-01 |
| `src/parser.ts` | Add `-d`/`--detached` parsing; intercept `--watch` for remediation | REQ-FLAG-01, REQ-RMV-01 |
| `ensureServerRunning` (in `loop-commands.ts` ~258-286) | reused as-is, no change | REQ-EXEC-03 |
| `src/server-commands.ts` | Re-point `ExitCode.CONFLICT` (~:406/:630) → `USAGE` (see 03 §2) | REQ-EXIT-02 |
| **ExitCode call-site sweep** — `src/backlog-commands.ts`, `src/install-commands.ts`, `src/profile-config-commands.ts`, `src/migrate-commands.ts`, `src/reset-commands.ts`, `src/resume-commands.ts`, `src/main.ts`, `src/follow-command.ts` | Re-point old `ExitCode` members (`INVALID_ARGS`/`NOT_FOUND`/`VALIDATION`/`CONFLICT`/`PAUSED_HUMAN`) → new per 00 §1 remap. **The redefinition (commands.ts) is a hard compile break across all these files — full per-file/per-line checklist in [`03-exit-codes.md`](./03-exit-codes.md) §2.** | REQ-EXIT-01, REQ-EXIT-02 |

### @rauf/loop

| File | Change | REQ |
|------|--------|-----|
| `src/runner.ts` | Remove the `review→done` downcast at the `signal_parsed` emit site (~655-656) | REQ-SIG-01 |
| `src/signal-parser.ts` | No change (`SignalType` already has `"review"`) | REQ-SIG-01 |

### @rauf/core

| File | Change | REQ |
|------|--------|-----|
| `src/schemas.ts` | Add `"review"` to `SignalParsedSchema.signal` enum (~466). `EVENTS_SCHEMA_VERSION` unchanged | REQ-SIG-01, REQ-EVT-01 |

### @rauf/web

| File | Change | REQ |
|------|--------|-----|
| `src/server/routes/loop.ts` | `POST /:id/loop/start` retained (URL + contract unchanged) — it is the detached-run backend; no code change required | REQ-EXEC-03 |
| `src/client/routes/projects/status.tsx` | No change — `EventTimeline` renders `signal_parsed` via string interpolation of `e.signal`, so `"review"` renders verbatim | REQ-SIG-01 (additive) |

### docs/ (REQ-DOC-01, REQ-SIG-02, REQ-EVT-01)

`SPEC-CLI.md` (loop start §, exit-code tables, follow note), `SPEC-WEB.md` (route is the detached-run
backend), `SPEC-BACKLOG-TOOL-CONTRACT.md` (exit-code unification, signal-collapse note, signal-placement
wording), `SCHEMAS.md` (signal enum + events versioning discipline), `ARCHITECTURE.md` (data-flow verbs),
`SPEC-ARTIFACTS.md` (`loop start` mention).

### Versions + feature-forge (separate repo — out-of-loop, REQ-CONTRACT-02/04/05)

- rauf version → `0.5.0`: bump `packages/core/src/version.ts:~4` (the source `rauf version --json` reads, currently `0.4.0`) + keep `package.json`s in sync.
- `/home/gary/workspace/feature-forge`: `references/forge-config-schema.json` + `skills/forge-5-loop/SKILL.md`
  `minRunnerVersion` `0.2.0`→`0.5.0`; align `COMPATIBILITY.md`, `CHANGELOG.md`; **remove `watch` from
  `references/ralph-loop-contract.md:~51`**; re-validate exit-code/status reads. See
  `05-cutover-and-feature-forge.md`.

## 2. Public-surface deltas

- **CLI grammar:** `loop start` removed; `loop run` gains `--detached`/`-d` (+ `--detached --follow`).
- **Exit codes:** `ExitCode` members renamed/remapped (00 §1) — internal to `@rauf/cli`, but the *values*
  are the external machine contract.
- **`signal_parsed.signal`:** gains `"review"` (additive).
- **Web HTTP API / `events.ndjson` shapes:** unchanged.

## 3. Change ordering / dependency graph

A safe implementation order (each step independently testable; respects the single-writer/contract deps):

1. **Core enum (`@rauf/core` schemas):** add `"review"` to `SignalParsedSchema`. (No dependents broken —
   additive.)
2. **Loop collapse removal (`@rauf/loop` runner):** remove the `review→done` downcast. Depends on (1) so the
   emitted value validates.
3. **ExitCode redefinition (`@rauf/cli` commands.ts):** redefine the const + re-point all call sites across
   the CLI package (~8+ files / ~90 sites — full list in [`03-exit-codes.md`](./03-exit-codes.md) §2 and
   the §1 "ExitCode call-site sweep" row above). This is the highest-fan-out change; land it (incl. test
   re-points) as one coherent commit so the build is never red mid-sweep.
4. **Exit-code mappings:** `loop run` terminal mapping (loop-commands) + `statusExitCode` rewrite
   (status-commands). Depends on (3).
5. **Grammar:** `--detached` branch + remove `loop start` + remediation interceptor + `--help`/usage +
   parser `-d`/`--watch`. Depends on (3) (uses the new `USAGE` for remediation/409).
6. **Docs:** update the 6 `docs/SPEC-*.md` to the landed surface. Depends on 1–5.
7. **Cutover (out-of-loop, at flip):** bump rauf versions → 0.5.0; update feature-forge. Depends on 1–6
   landing + green. See `05-cutover-and-feature-forge.md`.

> The autonomous loop can do steps 1–6 (all within the rauf repo sandbox). Step 7's feature-forge edits are
> a separate out-of-loop step (REQ-CONTRACT-05) — the rauf loop cannot write outside its repo.

## Dependencies

- [`00-core-definitions.md`](./00-core-definitions.md) — all shared contracts.

## Verification

- Every file in §1 changed as described; no `loop start` verb dispatchable; `loop run --detached` works.
- Build/typecheck green after each ordered step (especially after step 3's ExitCode audit).
- `docs/SPEC-*.md` reflect the landed surface; feature-forge `minRunnerVersion` ≥ 0.5.0 at the flip.
