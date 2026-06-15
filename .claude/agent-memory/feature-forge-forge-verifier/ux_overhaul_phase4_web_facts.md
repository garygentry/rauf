---
name: ux-overhaul-phase4-web-facts
description: Verified ground truth for ux-overhaul-web (Phase 4, final) PRD verification — code map, CANON obligations, ratified decisions
metadata:
  type: project
---

Phase 4 (final) of UX/DX overhaul = feature `ux-overhaul-web`. Mostly additive: NO minRunnerVersion bump, NO feature-forge edit, NO breaking flip. Depends only on Phase 1 substrate (shipped).

**Why:** completes the 4-phase overhaul (CANON §5 row 4). Phases 1-3 shipped (v0.5.0).

**How to apply:** when verifying ux-overhaul-web specs/tech/backlog, these are the load-bearing facts:

- Code map (from forge-1-prd Explore): resetProject (core reset.ts:48), unblockItems (core backlog.ts:431), validateBacklog (core backlog-validate.ts:47), deriveStatus (core status.ts:359) are CORE. BUT `resume` is CLI-layer only (cli/resume-commands.ts) and the review pass is in packages/loop (review-hooks.ts), NOT core. So "thin core adapter" is inaccurate for resume + review — OQ-1 parks where they land.
- Status badge mapping TRIPLICATED today: cli colorLoopState (status-commands.ts), web status.tsx STATE_BADGE, web index.tsx STATE_BADGE — slightly different colors. No shared module.
- LoopStateEnum (core schemas.ts:228) = 10 members; REVIEWING + PAUSED_USAGE_LIMIT ABSENT. Raw enum (schemas.ts:167) = 12. mapLoopStateStatus (status.ts:106) maps reviewing→RUNNING, paused_usage_limit→PAUSED today. statusExitCode at cli/status-commands.ts:512.
- CSRF middleware app-level (web app.ts:54-69), X-Rauf-Request on all POST/PUT/DELETE — new routes inherit it.
- 4 ratified decisions: (1) AGENT_ADDON rename + provider-neutral wording DEFERRED to Part-B, only cheap doc items land; (2) all five recovery actions in scope; (3) REVIEWING→RUNNING(6), PAUSED_USAGE_LIMIT→LIMIT(4); (4) backend route + core label-map unit tests only, NO React frontend harness.
- CANON §4.4 exit table: 6=Running(query-time), 4=Limit/usage-paused/sleeping — confirms the §3.3 mapping.

**PRD verification result (2026-06-14):** clean on gap coverage — every ratified decision and CANON §4.3/§4.4/§4.6 phase-4 obligation has a REQ. Findings were all quality/format-level (priority skew, NFR-quantification n/a, a couple of implementation-leak nits in REQs). No CANON-vs-PRD contradiction. See [[ux_overhaul_grammar_facts]] [[ux_overhaul_phase1_facts]].
