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

## Item 013 — verify.sh per-agent + fail-fast + SC-2 regression

- **Two production gaps surfaced (items 009/010 left them):** wiring needed to make
  the generic-cli + fail-fast rows pass, so this test item had to close them:
  1. **providerConfig was never threaded into createProvider.** `runner.ts` read
     `MarkerOptions.provider` but not `.providerConfig`, so `generic-cli` resolution
     threw "missing binary". Fix: store `projectProviderConfig` from the marker and
     pass it as `createProvider(agentId, this.projectProviderConfig)` (preset/claude
     factories ignore the arg, so it's safe for all ids).
  2. **Fail-fast exited 0.** `failRunSetup` returned a benign zero-iteration
     LoopResult indistinguishable from idle, so the CLI mapped it to SUCCESS.
     REQ-DET-02/SC-3 require non-zero. Fix: added `LoopResult.setupFailed?: boolean`
     (set in failRunSetup), and `loopRunExitCode` returns ERROR(1) first when set.
     Unit-tested in loop-commands.test.ts.
- **generic-cli row dirty-tree trap:** the providerConfig must be injected into
  `.rauf.json` BEFORE `setup.sh` commits the sandbox baseline — otherwise the
  modified tracked marker trips the dirty-tree guard and the loop refuses to run.
  Restore the committed marker (mv .verifybak back) AFTER the run so the parent
  repo stays clean.
- **Fail-fast PATH must exclude ~/.local/bin too:** a REAL `codex` (and `claude`)
  can be installed there, so the absent-agent PATH is `scripts/bin:<bun dir>:/usr/bin:/bin`
  only — excluding both the sandbox mocks and ~/.local/bin. A real codex otherwise
  actually runs (46s) and defeats the test.
- **Stale exit-code expectation fixed:** the pause-resume row expected exit 6
  (old PAUSED_HUMAN). The contract changed — PAUSED_HUMAN folded into
  NEEDS_HUMAN=3 (commands.ts:95) and 6 is now RUNNING (query-time only). Updated
  the assertion to 3. This was the lone pre-existing red row noted in item 012.
- Plain-text agents emit only spawn/exit + item lifecycle events (no
  llm_token_update / llm_tool_activity), so "telemetry gracefully absent" is a
  jq "none of those types" check. Every completed item commits because the
  backlog.json status flip is a tracked change (mocks change no source files).
