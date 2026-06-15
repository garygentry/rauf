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
