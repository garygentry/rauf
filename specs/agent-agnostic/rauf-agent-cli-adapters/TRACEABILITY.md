# Traceability Matrix — rauf-agent-cli-adapters

> Epic `agent-agnostic`, repo **rauf**. Maps every PRD (v2) requirement to the implementation spec
> document(s) that cover it. Generated/validated with
> `feature-forge/scripts/validate-traceability.py` against `PRD.md` + the spec suite:
> **29 requirements, 8 spec files, 0 uncovered, 0 orphaned references.**

Doc legend: `00` core-definitions · `01` architecture-layout · `02` agent-registry-and-detection ·
`03` cli-agent-engine-and-presets · `04` agent-selection · `05` runner-wiring · `06` cli-surface ·
`07` testing-strategy. **Primary** = the document that owns the requirement's implementation;
remaining docs reference or test it.

| REQ ID | Priority | Primary doc | Supporting docs |
|--------|----------|-------------|-----------------|
| REQ-SEL-01 | P0 | 04 (resolver) + 06 (`--agent` flag) | 00, 01, 07 |
| REQ-SEL-02 | P0 | 04 (precedence) | 05, 06, 07 |
| REQ-SEL-03 | P0 | 04 (default `claude-cli`) | 00, 06, 07 |
| REQ-SEL-04 | P0 | 04 (per-item) | 05, 07 |
| REQ-ADP-01 | P0 | 05 (runner drives via abstraction) | 00 (`AgentAdapter` alias), 07 |
| REQ-ADP-02 | P0 | 03 (`CliAgentConfig` engine) | 00, 05 |
| REQ-ADP-03 | P0 | 03 (codex/gemini/copilot/cursor presets) | — |
| REQ-ADP-04 | P0 | 03 (`generic-cli`) | 00, 02, 07 |
| REQ-ADP-05 | P0 | 02 (registry by stable id) | 00, 01 |
| REQ-ADP-06 | P0 | 05 (both exec paths wired) | 01, 04, 07 |
| REQ-EXEC-01 | P0 | 03 (non-interactive flags) | 00, 07 |
| REQ-EXEC-02 | P0 | 03 (timeout + process-group kill) | 05, 07 |
| REQ-EXEC-03 | P0 | 05 (exit → `ExitClass`) | 00, 03 |
| REQ-SIG-01 | P0 | 05 (uniform `parseSignal`) | 00, 07 |
| REQ-SIG-02 | P0 | 03 + 05 (plain-text path) | 07 |
| REQ-DET-01 | P0 | 02 (`detectAgent` / PATH probe) | 00, 03, 04, 05, 07 |
| REQ-DET-02 | P0 | 05 (pre-loop fail-fast) | 00, 02, 04, 06, 07 |
| REQ-DISC-01 | P0 | 06 (`--help` enumeration) | 00, 02, 03, 04, 05, 07 |
| REQ-DISC-02 | P1 | 06 (`rauf agents` command) | 01, 02, 07 |
| REQ-MODEL-01 | P0 | 05 (model precedence intact) | 00, 03, 04, 07 |
| REQ-MODEL-02 | P0 | 03 (agent default when unset) | 00, 05, 07 |
| REQ-USAGE-01 | P0 | 05 (claude usage preserved) | 00, 02, 07 |
| REQ-USAGE-02 | P0 | 05 (non-claude usage skipped) | 00, 03, 07 |
| REQ-PERF-01 | P1 | 05 (single indirection + cache) | 01, 03, 04, 07 |
| REQ-SEC-01 | P0 | 03 (sandbox-confined spawn) | 07 |
| REQ-SEC-02 | P1 | 05 (`neutralizeForDetection`, both sites) | 00, 07 |
| REQ-OBS-01 | P0 | 05 (real `provider.id` in events) | 00, 06, 07 |
| REQ-OBS-02 | P0 | 03 (telemetry gracefully absent) | 00, 05, 07 |
| REQ-SCALE-01 | P1 | 03 + 02 (config/registration, no runner change) | 00, 01, 07 |

## Success-criteria → coverage

| SC | Verifies | Where proven (07 + impl docs) |
|----|----------|-------------------------------|
| SC-1 | mock codex/gemini/copilot/cursor + generic-cli reach `RAUF_DONE`, telemetry absent, no error | 07 §3.2–3.3 (sandbox), 03, 05 |
| SC-2 | claude path behaviorally unchanged (incl. usage preflight, **childEnv/review-hooks**) | 07 §5 + §3.6, 00 §3.4, 05 §3.1 |
| SC-3 | fail-fast on absent agent, no state written | 07 §3.2d/§6, 05 §4.5 |
| SC-4 | events carry real agent id; non-claude skips Anthropic preflight | 07 §3.2d/§4.3, 05 §4.3 + §3.3 |
| SC-5 | `--agent` precedence + discovery surface | 07 §3.1/§3.2e, 04, 06 |
| SC-6 | quoted `RAUF_*` token neutralized | 07 §3.5, 05 §4.4 |
| SC-7 | `pnpm gate` green | 07 §2/§8 (gate is the acceptance command) |

## Open / deferred (tracked, not gaps)

- **OQ-2** — exact non-interactive/model flags per named CLI are best-known config literals,
  correctable without code; SC-1 proves the mechanism with mocks (PRD §7, tech-spec §10, `03 §6`).
- Out-of-scope per PRD §6 (SDK agents, rich non-claude stream parsing, cross-repo wiring, credential
  redaction, backlog-schema changes) carry **no** REQ and are intentionally uncovered.
