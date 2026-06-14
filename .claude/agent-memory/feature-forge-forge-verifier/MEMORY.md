# Forge Verifier Memory — Rauf project

- [Rauf version locations](rauf_version_locations.md) — canonical version source + lockstep gotcha (docs package drifts; bump-version.sh skips it)
- [Rauf release infra facts](rauf_release_infra.md) — install-binary asset naming, CI gate steps, GitHub Releases distribution model
- [release-automation facts](release_automation_facts.md) — verified ground truth for the release-automation specs (versions, gate is 6 cmds not 7, extractSection escape bug, tags)
- [ux-overhaul Phase 1 facts](ux_overhaul_phase1_facts.md) — LoopEvent=24 not 26, commit-rule has 3 template loci (incl RAUF.md.tmpl:32), no prompt-builder commit reminder, .loop.lock model
- [ux-overhaul-grammar facts](ux_overhaul_grammar_facts.md) — Phase 2+3 v0.5.0: exit-code table, FF minRunnerVersion 0.2.0→0.5.0, stale `watch` in ralph-loop-contract:51, PRD lacks Priority lines
- [ux-overhaul Phase 4 web facts](ux_overhaul_phase4_web_facts.md) — final phase: code map (resume=cli, review=loop), badge triplication, LoopStateEnum missing 2, 4 ratified decisions, PRD clean on gaps
- [ux-overhaul Phase 4 web TECH facts](ux_overhaul_phase4_web_tech_facts.md) — tech-spec source ground truth: recoverInterruptedLoop async/RecoverySummary, checkLock(paths) not lockPath, badge sites NOT exhaustive, LoopStartOptions needs sessionTimeoutMinutes
