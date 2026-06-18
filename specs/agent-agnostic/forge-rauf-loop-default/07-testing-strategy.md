# 07 — Testing Strategy

> Feature: `forge-rauf-loop-default` (epic `agent-agnostic`). **Target repo: feature-forge**
> (`/home/gary/workspace/feature-forge`). rauf is consumed, not modified (CON-01). Source of
> truth: `tech-spec.md` (v1, §3.7, §8) + `PRD.md` (v1, SC-07). Shared types/result shapes are in
> `00-core-definitions.md`; file layout + build flow in `01-architecture-layout.md`.
> Cross-references use exact filenames. This is the **last numbered document** (testing strategy).

feature-forge skills are **markdown prose, not callable code**, so the documented selection
algorithm is captured once as an **executable spec** (`references/loop-agent-selection.py`,
Python 3.10+) and tested against a **mock runner** with pytest. The gate is
**`bash scripts/validate.sh`** (spec-purity + adapters drift guard + pytest + installer build) —
**not** rauf's `pnpm gate` (CON-05). This document specifies what to test, the fixtures, and the
coverage targets that satisfy SC-07.

## Requirement Coverage

| REQ / SC | Requirement | Section |
|----------|-------------|---------|
| SC-07 | `validate.sh` passes + mock-runner test proves plumbing/precedence/pre-check/gating without a live agent | §1, §3, §4 |
| SC-08 | Unknown-id abort listing valid ids is exercised | §3.2 |
| CON-05 | Gate is `bash scripts/validate.sh`, not `pnpm gate` | §1, §5 |
| REQ-PREC-01/02 | Precedence: run beats project; item never forge's concern | §3.1 |
| REQ-AGENT-01 / REQ-SEC-01 | `render_launch` appends `--agent` only for a validated non-default id | §3.3 |
| REQ-AVAIL-02/04 | member+unavailable ⇒ warn/choose; non-member ⇒ hard-reject | §3.2 |
| REQ-PLUG-01/02 | `agentArgument` absent ⇒ no probe, no `--agent`, identical launch | §3.4 |
| REQ-BIN-02 | Schema floor default == `0.6.0`; three new fields exist with documented defaults | §3.5 |
| REQ-PERF-02 | Probe invoked once, no retries | §3.2 (argv assertion) |
| (build integrity) | Adapters regenerated, never hand-edited | §5 |

## 1. Testing framework & tooling

- **Framework:** `pytest` (the existing `tests/` suite convention — `01-architecture-layout.md §1`).
  Match the existing test files' import/fixture style.
- **Language:** Python 3.10+ (`X | Y` unions, `match`) — `references/stacks/python.md`.
- **Gate harness:** `bash scripts/validate.sh`, which runs, in order (`01-architecture-layout.md §4`):
  `check-spec-purity.py` → `build-adapters.py --check` (drift guard) → `pytest tests/` →
  installer build. The new test must pass inside `pytest tests/`.
- **No new third-party deps** (tech-spec §9): standard library + pytest only. The mock runner is a
  shell/Python script; argv capture uses a temp file, not a mocking library.

## 2. The executable spec under test — `references/loop-agent-selection.py`

The unit-of-test is the pure algorithm the skill prose prescribes, extracted to one importable
module so the test cannot drift from the prose (it is *also* a documentation artifact the skill
references). It exposes exactly three pure, total functions plus the shared types from
`00-core-definitions.md §4` (`Resolution`, `AgentSource`, `Classification`, `Verdict`,
`AdvertisedSet`, `AgentAvailability`) and constants from `00 §2` (`RUNNER_DEFAULT_ID`,
`MIN_RUNNER_VERSION`):

```python
def resolve(
    run_selection: str | None,
    default_agent: str,
    runner_default_id: str,
) -> Resolution:
    """Collapse forge's run+project layers into one resolved agent (03 §3.1)."""

def classify(
    resolved_agent: str,
    agents: list[AgentAvailability],
    runner_default_id: str,
) -> Classification:
    """Disambiguate UNKNOWN / UNAVAILABLE / AVAILABLE by set membership (04 §4)."""

def render_launch(
    base_cmd: str,
    agent_argument: str | None,    # loopRunner.agentArgument, or None when the gate is off
    resolved: Resolution,
    runner_default_id: str,
) -> str:
    """Append the rendered agent_argument iff resolved.agent is a non-default id; else return base_cmd unchanged (03 §3.4)."""
```

Full signatures/docstrings are specified in `03-selection-resolution-observability.md` (`resolve`
in §3.1, `render_launch` in §3.4) and `04-availability-precheck.md` (`classify` in §4). This
document specifies how they
are **exercised**, not their internals. **OQ-T1 — RESOLVED:** the module is **test-only + a doc
artifact** (the skills stay prose; the Python is the executable spec, not a runtime the skill
calls), so it is **not** wired into any generated adapter. The `build-adapters.py --check` drift
guard therefore does not touch it; it lives under `references/` as a canonical, non-generated file.

## 3. Unit tests — `tests/test_loop_agent_selection.py`

Each group below is an explicit test; all import from `references/loop-agent-selection.py`.

### 3.1 Precedence (REQ-PREC-01/02, REQ-AGENT-03)

- `resolve("codex", "gemini", "claude-cli")` ⇒ `Resolution(agent="codex", source=AgentSource.RUN)`
  — **run beats project default**.
- `resolve(None, "gemini", "claude-cli")` ⇒ `Resolution(agent="gemini", source=AgentSource.PROJECT)`.
- `resolve(None, "", "claude-cli")` and `resolve(None, "   ", "claude-cli")` ⇒ `Resolution(agent=None,
  source=AgentSource.DEFAULT)` — **the default path** (empty / whitespace-only `default_agent` is
  treated as unset; rauf applies `RUNNER_DEFAULT_ID`).
- `resolve("claude-cli", "gemini", "claude-cli")` ⇒ resolved id equals `RUNNER_DEFAULT_ID`; assert
  `render_launch` (§3.3) treats it as the default path (appends nothing).
- **Item-level is NOT forge's concern (REQ-AGENT-05):** assert there is **no parameter and no code
  path** by which a `BacklogItem.provider` value flows into `resolve`/`render_launch` — i.e. the
  module never reads a backlog item. Operationalize as: `render_launch` output depends only on its
  arguments, and no function accepts an `item_provider`/backlog argument. (Guards the precedence
  invariant that forge never emits an `--agent` derived from a backlog item.)

### 3.2 Probe split — unknown vs unavailable (REQ-AVAIL-02/04, SC-08, REQ-PERF-02)

Using the mock `agents[]` (§4): `claude-cli` available; one available non-default (`codex`,
`available:true`); one known-unavailable (`gemini`, `available:false`); and `bogus` absent.

- `classify("codex", agents, "claude-cli")` ⇒ `Verdict.AVAILABLE`.
- `classify("gemini", agents, "claude-cli")` ⇒ `Verdict.UNAVAILABLE`, `detail` populated from the
  row — drives the warn + proceed-anyway/choose-another `AskUserQuestion` (REQ-AVAIL-02).
- `classify("bogus", agents, "claude-cli")` ⇒ `Verdict.UNKNOWN`, `valid_ids == tuple(sorted({"claude-cli",
  "codex","gemini"}))` — drives the **hard-reject listing valid ids** (REQ-AVAIL-04, SC-08); assert
  no proceed-anyway field is offered.
- **Once, no retries (REQ-PERF-02):** in the end-to-end probe test (§4) assert the mock's recorded
  argv shows the `agents --json` invocation **exactly once** per launch attempt.

### 3.3 Command render (REQ-AGENT-01, REQ-SEC-01)

- `render_launch(base, "--agent {agent}", Resolution("codex", RUN), "claude-cli")` ⇒ base + ` --agent codex`
  (the validated non-default id substitutes into `{agent}`).
- `render_launch(base, "--agent {agent}", Resolution(None, DEFAULT), "claude-cli")` ⇒ `base` **unchanged**.
- `render_launch(base, "--agent {agent}", Resolution("claude-cli", RUN), "claude-cli")` ⇒ `base` **unchanged**
  (resolved == `RUNNER_DEFAULT_ID` ⇒ default path).
- **Allow-list (REQ-SEC-01):** assert the only value ever substituted into `{agent}` is one that
  `classify` returned `AVAILABLE`/`UNAVAILABLE` for (a member of the advertised set) — i.e. an
  `UNKNOWN`-classified id never reaches `render_launch` (the pre-check aborts first). Exercise by
  asserting the integrated flow rejects `bogus` before any `render_launch` call.

### 3.4 Capability gating (REQ-PLUG-01/02)

- `render_launch(base, None, Resolution("codex", RUN), "claude-cli")` ⇒ `base` **unchanged** —
  `agentArgument` absent (gate off) means no `--agent` is ever appended even with a resolved id.
- Assert the integrated flow (§4) runs **no probe** when `agentArgument` is `None` (the mock's argv
  shows no `agents --json` call), and the rendered launch is **byte-identical** to the no-agent
  baseline.

### 3.5 Schema assertions (REQ-BIN-02)

Load `references/forge-config-schema.json` and assert (this is the only test that touches the
schema directly):

- `loopRunner.properties.minRunnerVersion.default == "0.6.0"`.
- `loopRunner.properties.agentArgument.default == "--agent {agent}"`.
- `loopRunner.properties.agentsProbeCommand.default == "{bin} agents --json"`.
- `loopRunner.properties.defaultAgent.default == ""`.
- All three new fields are present with `type == "string"`.

### 3.6 Probe-failure edge cases (REQ-AVAIL-01, `04 §5`)

A probe that exits 0 but yields no usable advertised set is a **probe failure**, not an `UNKNOWN`
verdict (`04 §5`) — `classify` is never reached, and forge must surface the failure +
choose-another/abort, never launching the non-default selection unvalidated:

- **Empty `agents: []`** — drive the precheck with a probe returning `{"agents": []}` for a
  non-default selection; assert it is handled as a probe failure (choose-another/abort prompt, no
  `render_launch` call), **not** an `UNKNOWN` rejection with an empty `valid_ids`.
- **Row missing `id`** — a probe row lacking the required `id` field is treated as a probe failure
  before `advertised_set` runs; assert no `KeyError` escapes and the choose-another/abort path fires.
- (Already covered for completeness: non-zero exit and unparseable/wrong-shape JSON → same
  probe-failure path.)

## 4. Fixture — `tests/fixtures/mock-rauf/rauf`

A fake runner standing in for rauf so the test proves the plumbing without a live agent
(SC-07 — the live multi-agent end-to-end run is maintainer-run, not CI-automatable). It MUST:

- On `version --json` → print `{"version": "0.6.0"}` and exit 0 (feeds the §3.5 / `05` gate path).
- On `agents --json` → print a canned `{ "agents": [...] }` and exit 0 (**always exit 0** — §3.2),
  with exactly the mix in §3.2: `claude-cli` available, `codex` available, `gemini`
  `available:false` (with a `detail`), and **no** row for `bogus`.
- **Record its argv** (every invocation, full argument vector) to a temp file whose path comes from
  an env var (e.g. `MOCK_RAUF_ARGV_LOG`) so the test can assert probe-count (§3.2) and the absence
  of a probe on the gated-off path (§3.4).
- Be a self-contained script (Python or POSIX sh) with no third-party deps, marked executable.

The fixture is a test asset, not part of the shipped plugin; it is exempt from the spec-purity
guard (it lives under `tests/fixtures/`, not `skills/` or `references/`).

## 5. Adapters drift guard (build integrity)

After the canonical edits (`references/*`, `skills/forge-5-loop/**`), the implementer runs
`python3 scripts/build-adapters.py`; `validate.sh` then runs `build-adapters.py --check`, which
**fails on stale or hand-edited `adapters/**`** (`01-architecture-layout.md §4`). This is not a
pytest but is part of the gate that SC-07/CON-05 require to pass. The executable spec
(`references/loop-agent-selection.py`) is canonical-but-not-generated (§2, OQ-T1), so it neither
triggers nor is checked by the drift guard.

## 6. Coverage targets

- **Algorithm (the executable spec):** 100% branch coverage of `resolve` / `classify` /
  `render_launch` — every precedence fall-through, every verdict branch, and both gate states are
  enumerated in §3.1–3.4, so full coverage is reachable with the listed cases.
- **Schema:** the four default assertions in §3.5 (the feature's only schema-shape contract).
- **Not CI-automatable (per SC-07):** a true multi-agent install driving a live non-claude agent
  end-to-end is maintainer-run; the mock-runner test (§4) stands in for it in CI. State this
  explicitly in the test module docstring so a future reader does not mistake the mock for full
  end-to-end coverage.

## Dependencies

- `00-core-definitions.md` — `Resolution`/`AgentSource`/`Classification`/`Verdict`/`AdvertisedSet`,
  `RUNNER_DEFAULT_ID`, `MIN_RUNNER_VERSION`, the `{agent}` token.
- `02-config-schema-and-gating.md` — the schema fields/defaults asserted in §3.5; the capability gate.
- `03-selection-resolution-observability.md` — `resolve` / `render_launch` signatures.
- `04-availability-precheck.md` — `classify` signature + the disambiguation rule.
- `05-runner-discovery-version-gate.md` — the `version --json` floor the mock emits.

## Verification

- [ ] `bash scripts/validate.sh` passes end-to-end (spec-purity + drift guard + pytest + installer build).
- [ ] `pytest tests/test_loop_agent_selection.py` passes with every case in §3.1–3.5 present.
- [ ] The mock runner emits `version --json` = 0.6.0 and the §3.2 `agents --json` mix, always exit 0.
- [ ] The argv log proves: exactly one probe per non-default launch; zero probes on the default and gated-off paths.
- [ ] `render_launch` appends `--agent <id>` only for a validated non-default id; nothing for none/`claude-cli`/gate-off.
- [ ] No backlog-item value can flow into any function (REQ-AGENT-05 invariant).
- [ ] `python3 scripts/build-adapters.py --check` passes after regeneration.
