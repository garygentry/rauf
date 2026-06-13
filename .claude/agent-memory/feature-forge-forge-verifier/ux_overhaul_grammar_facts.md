---
name: ux-overhaul-grammar-facts
description: Verified ground-truth for ux-overhaul-grammar (Phase 2+3, v0.5.0) — exit-code table, FF contract facts, AND tech-spec source-claim audit (all confirmed)
metadata:
  type: project
---

Ground truth verified 2026-06-13 for `specs/ux-overhaul-grammar/` (Phase 2+3 of CANON.md, bundled as one breaking v0.5.0 release). CANON.md is source of truth.

**Why:** the grammar PRD makes concrete cross-repo (feature-forge) claims + an exit-code contract; checked so re-verification doesn't re-walk both repos.
**How to apply:** trust these when verifying ux-overhaul-grammar tech/specs/backlog; re-check if either repo changed. See also [[ux-overhaul-phase1-facts]].

- **Unified exit-code table (CANON §4.4 = PRD REQ-EXIT-01, verbatim match):** 0 success(clean terminal idle/complete) · 1 error(generic) · 2 usage(bad args/IO) · 3 needs-human(PAUSED_HUMAN) · 4 limit/usage-paused/sleeping · 5 blocked(terminal w/ blocked items) · 6 running(query-time only, `status`). `backlog validate` keeps its OWN 0 valid/1 findings/2 usage (REQ-EXIT-03) — leave untouched.
- **feature-forge IS in scope** (revised 2026-06-13 from declare-contract-only). REQ-CONTRACT-04/05. FF is a SEPARATE repo (`/home/gary/workspace/feature-forge`, main, epic support merged PR #2), OUTSIDE the rauf loop sandbox → FF edits are an explicit out-of-loop step at cutover.
- **FF facts verified (2026-06-13):** `minRunnerVersion` default = `0.2.0` in BOTH `references/forge-config-schema.json` (line ~138) and `skills/forge-5-loop/SKILL.md:83` (bump → 0.5.0). FF has ZERO `loop start`/`--watch` refs. FF default `runCommand` = `{bin} loop run . --backlog … --iterations …`; `ndjsonRunCommand` adds `--ndjson` (schema lines 65/70). `COMPATIBILITY.md`, `CHANGELOG.md`, `references/ralph-loop-contract.md` all exist. FF's only exit-code dependency is `backlog validate` 0/1/2 (ralph-loop-contract.md:31) — preserved by REQ-EXIT-03.
- **STALE in FF (REQ-CONTRACT-04 must fix but PRD under-specifies):** `references/ralph-loop-contract.md:51` enumerates rauf surface as "status (+ --json) / list / **watch** / follow / log / version" — `watch` is removed in this feature. (V-006 finding.)
- **PRIORITY CONVENTION — NOW FIXED:** the earlier PRD pass flagged missing `Priority:` (old V-001); the current PRD tags every REQ inline `*(P0)*`/`*(P1)*`/`*(P2)*`. No longer a gap.
- **`--detached --follow` lifecycle (REQ-EXEC-04):** detach + follow compose; interrupting follow must NOT stop the detached loop (only `loop stop` does). Now resolved explicitly in PRD REQ-EXEC-04 + tech-spec §3.1.

## Tech-spec source-claim audit (forge-2-tech, verified 2026-06-12, branch forge/ux-overhaul) — ALL CONFIRMED ACCURATE

**Why:** the tech spec makes ~20 precise file:line/value claims; downstream specs/backlog/impl passes can trust these unless code changed.
**How to apply:** re-confirm only that the symbol still exists if line numbers drifted.

- `ExitCode` `cli/src/commands.ts:90-101` = SUCCESS:0 ERROR:1 INVALID_ARGS:2 NOT_FOUND:3 VALIDATION:4 CONFLICT:5 PAUSED_HUMAN:6 — exact. Remap premise sound.
- `loop run` exit = ternary `result.pausedReason === "needs_human" ? PAUSED_HUMAN : SUCCESS` at `loop-commands.ts:982` (spec 979-983) — confirmed.
- `statusExitCode` `status-commands.ts:492-504` RUNNING→1 PAUSED_HUMAN→2 LIMIT_REACHED→3 default→0 — confirmed.
- `SignalParsedSchema.signal` `core/src/schemas.ts:466` = `["done","blocked","needs_human","none"]` — confirmed.
- review→done collapse `loop/src/runner.ts:656` — confirmed. `SignalType` `signal-parser.ts:4` already has "review" — confirmed.
- `ensureServerRunning` 258-286 / `handleLoopStart` 290 / `handleLoopRun` 620 (loop-commands.ts) — confirmed.
- `LoopResult` `runner.ts:62-72` incl `pausedReason?:"needs_human"`,`needsHumanCount?`,`blockedCount`,`completedCount`,`cancelled` — confirmed.
- `EVENTS_SCHEMA_VERSION="1"` `schemas.ts:663`, stamped `runner.ts:1213`; `PersistedEventSchema=z.intersection(LoopEventSchema,{seq,schemaVersion})` 614-629; LoopEventSchema=24-member union 574-599 — confirmed.
- `POST /:id/loop/start` `web/src/server/routes/loop.ts:145-199`; `LoopManager.startLoop` `loop-manager.ts:86` (409 CONFLICT on already-running) — confirmed.
- `LoopStateEnumSchema` `schemas.ts:228-239` (10 states) — confirmed. app.ts CSRF 54-69, loop mount 97-109 — confirmed.
- **`<EventTimeline>` is NOT a standalone component** — it's a local fn in `web/src/client/routes/projects/status.tsx` (:462,:571). Renders signal_parsed at :498-501 via string-interp `${e.signal}` with no exhaustive switch → adding "review" is genuinely additive/safe. Tech-spec §10 open-Q #4 ("verify the switch tolerates it") is effectively already answered: it does. Spec's "verify the `<EventTimeline>` switch" wording slightly mischaracterizes (no switch on the value).
- SPEC-BACKLOG-TOOL-CONTRACT.md collapse gotcha at lines 206-210 (spec ~206-209) — confirmed.

Pattern note: clean, well-researched rauf tech spec — author pre-verified file:line during forge-2-tech and every load-bearing claim held. Findings limited to scope/traceability nuance, not source errors. This is the rauf norm for forge specs.
