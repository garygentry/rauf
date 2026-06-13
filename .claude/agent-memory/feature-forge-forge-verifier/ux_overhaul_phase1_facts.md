---
name: ux-overhaul-phase1-facts
description: Verified ground-truth for the ux-overhaul Phase 1 (observation substrate) PRD — LoopEvent count, commit-rule loci, lock/registry model, monitor surface
metadata:
  type: project
---

Ground truth verified 2026-06-12 against the rauf repo for the `specs/ux-overhaul/` PRD (Phase 1 only of the 4-phase CANON.md plan).

**Why:** the PRD makes several concrete codebase claims; these were checked so re-verification doesn't re-walk the source.
**How to apply:** trust these when verifying ux-overhaul tech/specs/backlog; re-check if the repo changed.

- **LoopEvent union = 24 members** (in `packages/core/src/schemas.ts` `LoopEventSchema` discriminatedUnion; runner emits 24 distinct `emitEvent("…")` literals). PRD §1 says "26 LoopEvent types" — that figure is WRONG (off by 2; no doc sources "26").
- **Commit-rule loci = THREE template loci, not two.** The instruction "Commit…" appears in: `artifacts/variants/backlog-json/CLAUDE_ADDON.md:21`, `…/CLAUDE_GREENFIELD.md.tmpl:47`, AND `…/.rauf/RAUF.md.tmpl:32` ("Commit with: `[rauf] <id>: <title>`"). The PRD problem-statement + SC-5 + REQ-COMMIT claim `RAUF.md` already FORBIDS committing and is the correct reference — that is FALSE for the shipped *template* RAUF.md.tmpl. (The repo-root self-hosting `.rauf/RAUF.md` / project CLAUDE.md DO forbid it — but those aren't the installed artifacts.) CANON.md §2.7/§4.6 only cite `CLAUDE_ADDON.md:21` and also miss GREENFIELD + RAUF.md.tmpl.
- **prompt-builder has NO commit reminder.** `packages/loop/src/prompt-builder.ts` mentions RAUF_DONE/signal ownership and "do NOT modify backlog/state" but says nothing about who commits. REQ-COMMIT-02 says to "correct" a prompt-builder commit reminder — there is none to correct; the fix is to ADD one.
- **Lock model = `.loop.lock`** per state dir, PID-based with stale detection (`packages/core/src/backlog-root.ts` `LOCK_FILENAME=".loop.lock"`, `status.ts` stale check). Matches REQ-DISC-03/05 + C-3 "lock is ground truth."
- **Current monitor surface confirmed present:** `status --watch [--interval N]`, `log --tail N --follow`, `loop follow`, `loop watch` all exist (`packages/cli/src/commands.ts`, `status-commands.ts`). The `--watch` vs `--follow` split is real.
- **No PRD template file** ships in the forge-verify skill (`prd-template.md` absent) — CHECK-P01 must be judged against standard PRD structure, not a concrete template.

## Tech-spec source facts (verified 2026-06-12, for tech-spec.md verification)

- **`ErrorCodes.IO_ERROR` does NOT exist** (`errors.ts:21-33`). Members: FILE_NOT_FOUND, INVALID_JSON, VALIDATION_ERROR, PATH_VIOLATION, ALREADY_INSTALLED, NOT_INSTALLED, CONFLICT, TRANSITION_INVALID, LOCK_CONFLICT. Tech-spec §3.2 `appendLine`/`readNdjson` reference `ErrorCodes.IO_ERROR` → fabricated; copy-pasting that code fails typecheck.
- **`LockSummary` is real but the spec conflates two unrelated symbols.** `LockSummary`/`LockSummarySchema` is a status-display Zod schema (`schemas.ts:258/650`) built by `computeLockSummary(paths)` (`status.ts:86`). It is NOT the return of `checkLock`. `checkLock(paths: BacklogPaths): Result<LockStatus>` (`LockStatus` interface `lock.ts:39`). Tech-spec §3.5/§5.1 claim `checkLockFile(lockPath): LockSummary` extracted from checkLock → wrong return type name. Liveness helpers (isProcessAlive `process.kill(pid,0)`; isProcessRecycled via `/proc/<pid>/stat` field 22) are PRIVATE at lock.ts:56-116.
- **Existing token throttle = `TOKEN_EVENT_THROTTLE_MS = 5_000` (5s)** at `runner.ts:70`, gating `writeIterationStatus`. Tech-spec D3 picks `TOKEN_COALESCE_MS = 1000` (1s) claiming it "mirrors the existing iteration-status.json throttle" — the existing throttle is 5s, so the justification is wrong (1s is still REQ-EVT-02-compliant). Consequence: events.ndjson will carry MORE token records than iteration-status.json.
- **`start()` is at runner.ts:139**, not "~200" as tech-spec §6.1 claims. `emitEvent` private at 1135 (accurate). start() `finally` (releaseLock ~line 338) is the correct `deregisterLoop` locus.
- **RAUF.md.tmpl commit line is :32**, tech-spec §3.11 item 3 says :31 (off by one). Other commit loci accurate: embedded-artifacts.ts 42/364/423; CLAUDE_ADDON.md:21; GREENFIELD:47; SPEC-ARTIFACTS.md 236+330. `scripts/generate-embedded-artifacts.ts` DOES run in `@rauf/core` build (package.json line 9) — spec's regenerate claim holds.
- **zod ^3.24.0; NO existing `z.intersection` usage** in schemas.ts. `PersistedEventSchema = z.intersection(LoopEventSchema /*discriminatedUnion*/, z.object(...))` is novel (works in zod3, but is a sharp edge; loses discriminatedUnion fast-path).
- All web (loop.ts 101/233, loop-manager eventBuffers:64, status.tsx LogPanel:321, index.tsx:119) and CLI (handleLoopWatch:1387, handleLoopFollow:675, followDirectMode:588, handleStatusWatch:295) line refs accurate within ±2. backlog-root resolveBacklogPaths:126/resolveStateDir:114; validatePath/atomicWrite/fileExists/ensureDir all real in fs-utils.
- **`reset.ts archiveTimestamp()` is PRIVATE** (not exported), YYYYMMDD-HHMMSS at lines 42-43. events-log.ts rotate must reimplement it (spec acknowledges computing inline — fine).
