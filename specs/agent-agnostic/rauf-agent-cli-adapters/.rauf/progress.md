# Progress — rauf-agent-cli-adapters

## Item 010 — Runner usage-gating + fail-fast detection + neutralization

- **Key gotcha (SC-2 vs fail-fast):** claude's `detectClaudeCli` (item 003) is
  **credential-based**, and the unit-test env + test-sandbox both run claude WITHOUT
  Claude OAuth credentials, relying on `runUsagePreflight`'s graceful degradation
  ("reactive banner detection"). A naive fail-fast that aborts on any `detectAgent`
  unavailable broke ~63 existing claude tests. Resolution: in
  `detectAllCandidateAgents`, discriminate **by capability not id** — an agent that
  owns its runtime usage/credential handling (`checkUsage` present, i.e. claude)
  degrades gracefully so its detect-unavailable is NON-fatal; binary-gated CLI
  adapters (no `checkUsage`) that are unavailable are a genuine fail-fast. This keeps
  SC-2 and matches item 010's usage-gating philosophy ("gate on capability").
- Item-009 fake agents in runner.test.ts had no `detect`; once fail-fast probes them
  (and they lack `checkUsage`) they abort. Added `detect: async () => ({ available: true })`
  to `registerFakeAgent`.
- `neutralizeForDetection` is effectively a no-op against `parseSignal`'s RESULT (parseSignal
  only matches whole-line tokens; neutralize only defuses non-whole-line tokens). So the
  "both sites" assertion is best done as a source-grep test plus a "real signal survives"
  behavioral test.

## Item 012 — Generalize test-sandbox + plain-text mock agents

- **One signal source per scenario, two formats:** `scenarios/_emit.sh` exposes
  `is_plain` + `emit_done`/`emit_blocked`/`emit_needs_human`. Each scenario sources it
  and adds a `if is_plain; then emit_*; exit 0; fi` early branch BEFORE its existing
  stream-json body — so the claude stream path is byte-for-byte unchanged (SC-2) and
  plain mode emits human text + a final-line `RAUF_*` with NO telemetry.
- **Dispatcher fallback chain:** `claude`/`codex`/`gemini`/`copilot`/`cursor-agent` all
  resolve `MOCK_AGENT_SCENARIO` → `MOCK_CLAUDE_SCENARIO` → `stream-done`. The non-claude
  mocks additionally `export MOCK_AGENT_FORMAT=plain`. cursor's binary is `cursor-agent`
  (≠ its id `cursor`), matching the preset.
- **`run_agent_scenario <agent> <scenario>`** lives in `run.sh`; all mocks sit in
  `$SANDBOX_DIR` (first on PATH), so the chosen `--agent <id>` selects which one runs.
  claude / empty / claude-cli pass NO `--agent` flag → exactly today's path. Dropped
  `set -e` (kept `-uo pipefail`) + wrapped the rauf call in `if` so blocked/non-zero
  runs still capture EXIT_CODE.
- **`run.sh` "Available" listing** filters `^_` so `_emit.sh` isn't offered as a scenario.
- **Pre-existing failure:** `verify.sh` pause-resume row fails `expected exit 6, got 3`
  even with the ORIGINAL scenario file (confirmed via git stash) — an environment/dev-dist
  quirk, NOT a regression from this item. All its signal/state assertions pass.
- Running `verify.sh` leaves debris in the PARENT tree (commit-no-signal writes
  `recovered-feature.txt` into the sandbox workdir, which isn't gitignored) + mutates
  `test-sandbox/.rauf/backlog.json`; clean both before finishing.
