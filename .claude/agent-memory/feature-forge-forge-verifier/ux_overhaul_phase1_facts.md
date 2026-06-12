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
