# 06 — The Authoritative forge↔rauf Loop-Runner Contract Doc (the EXPOSE)

> Feature: `forge-rauf-loop-default` (epic `agent-agnostic`). **Target repo: feature-forge**
> (`/home/gary/workspace/feature-forge`). rauf is **consumed, not modified** (CON-01).
> Source of truth: `PRD.md` (v1, §3.1, §3.7) + `tech-spec.md` (v1, §3.6, §2). Shared types,
> constants, the `{agent}` token, and result shapes live in `00-core-definitions.md`; the
> schema half of the EXPOSE in `02-config-schema-and-gating.md`. This document does **not**
> redefine those — it **restates the operational behavior specified in 02–05 as the single
> authoritative contract** and adds the per-stage applicability classification. It introduces
> **no new mechanism**. Cross-references use exact filenames.

This document specifies the **exact additions** to the consumer-side contract reference
`references/ralph-loop-contract.md` that constitute the feature's `forge-loop-runner-contract`
**EXPOSE** — the documentation half (the schema half is the augmented `loopRunner` block,
`02-config-schema-and-gating.md`). The downstream `packaging-docs-ci` capstone consumes this doc
+ that schema block as documentation input (REQ-DEF-03; `01-architecture-layout.md §3`). Because
the artifact is **markdown prose**, this spec is precise about *what text to add and where*, and
defers every algorithm/mechanism detail to 02–05 via cross-reference (it is a synthesis spec, not
a re-spec).

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-DEF-01 | Default-to-rauf, announced plainly — restated in the contract | §3 |
| REQ-DEF-02 | Pluggable seam; no hardcoded commands — restated | §3 |
| REQ-DEF-03 | Single authoritative contract doc the capstone consumes (THIS doc) | §1, §3–§7, §7 (expose statement) |
| REQ-SEAM-01 | Classify every runner-touching stage (5-loop full; 4-backlog + verify validate-only) | §5 (per-stage table) |
| REQ-SEAM-02 | `validate` stays agent-agnostic — explicit guard note | §6 |

> Requirements **adjacent** to this doc but *owned elsewhere* are restated here only as contract
> text and traced to their owning doc: precedence (REQ-PREC-01/02 → `03`), probe + disambiguation
> (REQ-AVAIL-01/02/04 → `04`), capability gate (REQ-PLUG-01/02 → `02`), version floor
> (REQ-BIN-02/03/04 → `05`). This doc does **not** claim coverage of those — it cross-references
> their owning specs so the contract reads as one coherent surface.

## 1. Where this lands and what it is

**File edited (the only file this document specifies):** `references/ralph-loop-contract.md`
(`01-architecture-layout.md §2`, tech-spec §3.6). It is an **edit** to an existing,
implementer-maintained doc — *not* a rewrite. The current doc already states the seam
(`loopRunner` indirection), the default-to-rauf announcement, the contract a runner must satisfy,
the default/reference-implementation note, and version gating. This feature **adds** four things
and **amends** two:

| Action | Target text in `ralph-loop-contract.md` | This spec's section | Trace |
|--------|------------------------------------------|---------------------|-------|
| **Amend** | The `## rauf is the default and reference implementation` paragraph — extend with a sentence noting the agent dimension is additive + presence-gated | §3 | REQ-DEF-01/02 |
| **Add** | A new `## Agent selection` section (contract-level: precedence, run-layer mapping, probe + disambiguation, capability gate) | §4 | REQ-PREC-*, REQ-AVAIL-*, REQ-PLUG-* (owned by 03/04/02) |
| **Add** | A new `## Per-stage agent applicability` section with the classification table | §5 | REQ-SEAM-01 |
| **Add** | A new `## \`validate\` is agent-agnostic` subsection (the guard note) | §6 | REQ-SEAM-02 |
| **Amend** | The `## Version gating` section — bump the stated floor `0.5.0`→`0.6.0` and name it the agent-surface floor | §4.4 (cross-ref `05`) | REQ-BIN-02 (owned by 05) |
| **Add** | A one-line statement that this doc + the `loopRunner` schema block constitute the `forge-loop-runner-contract` expose | §7 | REQ-DEF-03 |

This document is **the** authoritative description of the contract (REQ-DEF-03): every other
forge surface (`skills/forge-5-loop/SKILL.md`, `skills/forge-5-loop/references/runner-contract.md`)
documents *operational mechanics* for the executor; `ralph-loop-contract.md` is the
*consumer-side authority* the capstone documents and CI-gates.

## 2. Source verification (the claims this doc makes, checked against feature-forge source)

The per-stage classification (§5) and the agnostic guard (§6) are **claims about feature-forge's
own skills**. They were verified against the live skills so the contract doc states fact, not
aspiration. Verified on 2026-06-17:

- **`forge-5-loop` invokes the full runner surface.** `skills/forge-5-loop/SKILL.md`:
  - version verb — Step 1c "Runner Version Gate" runs `loopRunner.versionCommand`
    (default `rauf version --json`).
  - run + eventStream — Step 2c renders `loopRunner.runCommand`; Step 3b launches
    `loopRunner.eventStreamCommand` (default `… --ndjson`).
  - status — Step 4a runs `loopRunner.statusJsonCommand`.
  - list — Step 2a runs `loopRunner.listCommand`.
  - Step 2d's optional-flags catalog currently lists **`--review`, `--model <model>`,
    `--timeout <min>`, `--retry-blocked`** (line 165) — **no `--agent` yet**; this feature adds
    it there (`03-selection-resolution-observability.md`).
- **`forge-4-backlog` invokes only `validate` (no agent dimension).** `skills/forge-4-backlog/SKILL.md`
  Step 5 renders `loopRunner.validateCommand` only — the rauf default
  `rauf backlog validate . --backlog {resolvedBacklogDir} --specs-dir {specsDir} --json` (line 103).
  A grep for `--agent` / an agent token in this skill returns **nothing**; the only "agent"
  matches are `agentDelegation` (a backlog-item field) and "fresh agent" prose — both unrelated to
  coding-agent selection. (It also reads `versionCommand` for its graceful-degrade check, but
  *passes no agent* and never runs `loop run`.)
- **`forge-verify` invokes only `validate` (no agent dimension).** `skills/forge-verify/SKILL.md`
  Gotchas (line 212): backlog-mode verification "also run[s] the loop runner's validate command
  … `rauf backlog validate . --backlog {backlogDir} --specs-dir {specsDir}/{feature} --json`."
  A grep for `--agent` / an agent token returns **nothing** relevant; matches are "fresh agent",
  `forge-verifier` subagent, and the parallel-dispatch prose.

These three findings are exactly the tech-spec §3.6 table content; §5 restates them as the
contract table. They also align with the consumed-surface note in tech-spec §6.A and the DRAFT
alignment warning there: rauf's `docs/SPEC-BACKLOG-TOOL-CONTRACT.md` Part B is a *draft 4-layer
`--provider`* doc, but **source is authoritative** — this contract documents the live `--agent`
run-slot surface, not the draft text. (rauf owns reconciling its own spec; out of scope, CON-01.)

## 3. `## rauf is the default and reference implementation` — additions (REQ-DEF-01, REQ-DEF-02)

The existing `ralph-loop-contract.md` already establishes default-to-rauf and pluggability:

- **Default-to-rauf, announced plainly (REQ-DEF-01).** The current `## The seam` section already
  states that with no `loopRunner` block feature-forge "announces *defaulting to the rauf loop
  runner*." This is preserved verbatim; **no change** is needed for the announcement itself — it
  already satisfies REQ-DEF-01. The contract continues to say plainly: *rauf is the default loop
  runner; with no `loopRunner` block, forge fills the full default block and announces the
  default.*
- **Pluggable, no hardcoded commands (REQ-DEF-02).** The current `## The seam` section already
  states every runner command is a tokenized `loopRunner` template "there are no hardcoded
  `rauf …` commands in the skills." Preserved verbatim.

**The one addition (REQ-DEF-01/02, additive-dimension note).** Append to the
`## rauf is the default and reference implementation` paragraph a sentence stating that the agent
dimension is **additive and presence-gated**, so neither default-to-rauf nor pluggability is
disturbed by it:

> *The coding-agent dimension this contract adds (below) is **additive and presence-gated**: it
> exists only when the `loopRunner` block advertises it via `agentArgument`. A runner that omits
> that field has no agent dimension at all — the seam degrades to exactly today's behavior with
> no error, so default-to-rauf and pluggability are unchanged. See `## Agent selection`.*

This traces to REQ-DEF-01 (default unchanged), REQ-DEF-02 (pluggability preserved — the gate is a
pure config-presence check, no hardcoded command), and the capability gate owned by
`02-config-schema-and-gating.md §2` (cross-referenced, not re-specified). It is **contract-level
prose** — it states *what is true of the seam*, deferring the gate condition (`agentArgument`
present and non-empty after trim) to `02 §2`.

## 4. `## Agent selection` — the new contract section

Add a new top-level section `## Agent selection` immediately after
`## rauf is the default and reference implementation` (so it reads as a property of the
default/reference runner, then generalizes). It is **contract-level**: it states *what a
conforming runner exposes* and *what forge does with it*, and it **defers every algorithm** to the
owning specs. The section has four subsections.

### 4.1 What a conforming runner exposes (the consumed surface)

State the surface forge consumes (fixed by CON-02; verified shapes in `00-core-definitions.md §1`):

> A runner that carries a coding-agent dimension exposes, in its `loopRunner` block:
> - an **`agentArgument`** template (rauf default `--agent {agent}`) — the tokenized launch-time
>   flag; its **presence** advertises the agent surface;
> - an **`agentsProbeCommand`** (rauf default `{bin} agents --json`) emitting
>   `{ agents: [{ id, displayName, available, detail? }] }` and **always exiting 0**;
> - an optional **`defaultAgent`** project-default id.
>
> These three fields are specified in full in `references/forge-config-schema.json` and are the
> schema half of this contract. forge consumes rauf's existing `--agent <id>` flag, `rauf agents`
> probe, `BacklogItem.provider`, and 5-layer precedence — it conforms to them, it does not
> redesign them (CON-02).

Cross-references: `00-core-definitions.md §1` (the `AgentAvailability` shape, `RUNNER_DEFAULT_ID`,
`BacklogItem.provider`, `resolveAgentId`), `02-config-schema-and-gating.md` (the schema block).
The contract names the fields and the probe-JSON shape; it does **not** reproduce the JSON Schema
(that is `02`'s job).

### 4.2 Precedence and the run-layer mapping (REQ-PREC-01, REQ-PREC-02 — owned by `03`)

State the precedence as a property of the contract, parallel to the existing model-selection
precedence the seam already documents:

> The agent-selection precedence is **`item > run > project > default`**, deliberately parallel to
> the model-selection precedence (`item.model > --model/options > project default > provider
> default`). It is realized as:
>
> - **item** — `BacklogItem.provider`, applied by **rauf** from the backlog. forge **never reads,
>   writes, or overrides** it (pass-through), so a deliberate per-item agent always wins.
> - **run** — forge's per-run selector (`forge-5-loop` Step 2d).
> - **project** — forge's `loopRunner.defaultAgent`.
> - **default** — the runner's own default (`claude-cli` for rauf) when forge sends nothing.
>
> forge owns **only** the run and project layers. It collapses run-over-project *inside itself*
> into the **single** `--agent {agent}` value it emits at the **run layer**, and lets rauf apply
> the item override *above* that. forge **never re-implements rauf's resolver**.

This is the contract restatement of REQ-PREC-01 (documented precedence parallel to model) and
REQ-PREC-02 (run-level selection occupies the run layer only, cannot clobber a per-item agent),
both **owned by `03-selection-resolution-observability.md §3`** and grounded in
`00-core-definitions.md §5`. The contract states the *boundary*; `03` specifies the resolution
algorithm (`resolve(...) -> Resolution`).

### 4.3 Availability probe + unknown/unavailable disambiguation (REQ-AVAIL-* — owned by `04`)

State the probe behavior and the two-way split as contract guarantees:

> When the resolved agent is a **non-default** id, forge runs `agentsProbeCommand` **once (no
> retries)** before any loop side-effect, parses the advertised `agents[]`, and builds the
> advertised id set. Because the probe **always exits 0**, an unknown id is distinguished from a
> known-but-unavailable one **only by set membership**, not by exit code:
>
> - **Unknown id** (not in the advertised set — a typo or unsupported agent): **hard-reject before
>   launch**, listing the valid ids. No proceed-anyway path. No value is interpolated into
>   `{agent}`.
> - **Known but unavailable** (`available: false`): **warn** (showing the probe's `detail`) and let
>   the user **proceed-anyway or choose another** — never silently abort, never silently proceed.
> - **Available**: proceed.
>
> The advertised id set is also the **allow-list**: the only value ever interpolated into
> `{agent}` is a validated, advertised id. The **default / claude path never reaches the probe** —
> it incurs no extra cost.

This is the contract restatement of REQ-AVAIL-01 (verify before launch), REQ-AVAIL-02
(known-but-unavailable warn/proceed), REQ-AVAIL-03 (no pre-check on the default path), REQ-AVAIL-04
(unknown-id hard-reject before side-effects), and REQ-SEC-01 (allow-list), all **owned by
`04-availability-precheck.md`** with result types in `00-core-definitions.md §4`
(`Verdict`/`Classification`). The contract states the *guarantees*; `04` specifies the
`classify(...)` algorithm and the rejection-error text.

### 4.4 Capability gate + version floor (REQ-PLUG-* owned by `02`; REQ-BIN-* owned by `05`)

State the two independent gates the contract relies on:

> Agent selection is **capability-gated** on the runner advertising `agentArgument`: a runner whose
> `loopRunner` omits (or empties) that field exposes no agent surface, so the per-run selector, the
> probe, and any `{agent}` substitution **vanish entirely** and no agent argument is sent —
> byte-identical to today. Degradation is **silent, not an error**, keeping alternate (non-rauf)
> runners first-class.
>
> Independently, the **version gate** floors at the runner version that ships the agent surface.
> For rauf that is **0.6.0** (`loopRunner.minRunnerVersion`): the `--agent` flag, the `agents`
> probe, and the preset agent registry are present in rauf source at 0.6.0. A successful gate
> therefore guarantees those surfaces exist before any run. A missing-or-too-old runner fails the
> gate **before any loop side-effects**, with a hint that names the cross-agent installer (the
> multi-agent provisioning path) distinctly from the rauf-CLI install/upgrade one-liner.

Amend the existing `## Version gating` section accordingly: change the stated floor from `0.5.0`
to `0.6.0` and name it the **agent-surface floor** (the current text says "For rauf that is
**0.5.0**"). The capability gate is **owned by `02-config-schema-and-gating.md §2`**; the version
floor, discovery, gate behavior, and the dual install hint are **owned by
`05-runner-discovery-version-gate.md`** (REQ-BIN-01/02/03/04). The contract states *that both
gates exist and what they guarantee*; it does **not** re-specify the semver-compare logic or the
exact hint wording — those live in `05`. (The two install hints stay distinct: `installHint` =
runner CLI; `setupHint` = per-project artifacts — already documented in the existing version-gating
note, preserved.)

## 5. `## Per-stage agent applicability` — the classification (REQ-SEAM-01)

Add a new top-level section `## Per-stage agent applicability` with the **exact** table below. It
classifies **every** forge stage that invokes the runner, distinguishing the one stage with the
full agent surface from the two that use only the agent-agnostic `validate` verb. The table
content is the canonical tech-spec §3.6 table, **verified against the live skills** (§2 above):

```markdown
## Per-stage agent applicability

Every forge stage that invokes the loop runner is classified here. Only `forge-5-loop`
(execution) carries the coding-agent dimension; the two validation-only stages are
agent-agnostic.

| Stage | Runner verbs | Agent dimension |
|-------|-------------|-----------------|
| `forge-5-loop` | run / eventStream / status / version | **Full** — selector, probe, `--agent` |
| `forge-4-backlog` | `validate` | **None** — agent-agnostic |
| `forge-verify` | `validate` | **None** — agent-agnostic |
```

Notes to include with the table:

- **`forge-5-loop`** is the executor: it drives the run, so it renders the run / event-stream /
  status / version verbs (and `list`) and carries the full agent surface — the Step 2d selector,
  the availability probe, and the rendered `agentArgument`. (Verified: §2.)
- **`forge-4-backlog`** authors and then *validates* the backlog; its only runner call is
  `validateCommand`. It also reads `versionCommand` for a graceful-degrade check, but **passes no
  agent** and never runs `loop run`. (Verified: §2.)
- **`forge-verify`** (backlog mode) re-runs the same `validateCommand` to surface validation
  findings. It carries no agent dimension. This is the agreed reading of "agent flows through
  forge-verify too": **contract coverage** of forge-verify (it is classified here), with an
  explicit agnostic note (§6) — **not** a new agent-driven run in forge-verify (explicitly out of
  scope, PRD §6). (Verified: §2.)

This satisfies REQ-SEAM-01 (the contract classifies every runner-touching stage). The table is
the load-bearing artifact `packaging-docs-ci` documents and CI-gates.

## 6. `## \`validate\` is agent-agnostic` — the guard note (REQ-SEAM-02)

Add a subsection (immediately after the §5 table) stating the agnostic guarantee explicitly, as a
guard against a future contributor wrongly bolting an agent flag onto validation:

> ### `validate` is agent-agnostic
>
> The `validate` verb (`loopRunner.validateCommand`) checks a `backlog.json` against the backlog
> schema and spec references. **It does not run a coding agent and has no agent dimension.** No
> agent argument — `--agent`, the `{agent}` token, or any agent id — may **ever** be passed to
> backlog validation, in **any** stage (`forge-4-backlog`, `forge-verify`, or any future caller).
> Backlog validation is a pure, deterministic check; the coding agent is irrelevant to it. A
> contributor who later adds agent selection to a *new* stage MUST confirm that stage runs the
> *execution* surface (like `forge-5-loop`), not `validate` — agent selection belongs to execution
> only. If you find yourself adding `--agent` near a `validateCommand` render, that is a bug.

This satisfies REQ-SEAM-02 (the contract states agent-agnosticism of `validate` explicitly, with a
guard). It is the documentation counterpart to the testing assertion in `07-testing-strategy.md`
that no `--agent` is emitted for the `validate` path, and to the Verification grep below.

## 7. The expose statement (REQ-DEF-03)

Add (e.g. as a closing line of the `## Agent selection` section, or a short `## The exposed
contract` note) a plain statement that ties the two halves together:

> **This document — the `## Agent selection` section, the `## Per-stage agent applicability`
> table, and the `## \`validate\` is agent-agnostic` note — together with the augmented
> `loopRunner` schema block in `references/forge-config-schema.json` constitute the
> `forge-loop-runner-contract` expose, consumed by the `packaging-docs-ci` capstone as
> documentation input.**

This makes the EXPOSE self-identifying (REQ-DEF-03; `01-architecture-layout.md §3`,
tech-spec §3.6/§2). There is no programmatic/HTTP API — the capstone consumes prose + schema with
no code coupling (tech-spec §6.C confirms no file conflict: the capstone is still at forge-1-prd
and touches none of these paths).

## Example — the assembled additions in context

A reader of the amended `ralph-loop-contract.md` should encounter, in order:
`## The seam` (existing, with its default-to-rauf announcement and "no hardcoded `rauf …`"
statement) → `## The contract a runner MUST satisfy` (existing) → `## rauf is the default and
reference implementation` (existing **+ the §3 additive-dimension sentence**) →
**`## Agent selection`** (new, §4: consumed surface, precedence, probe/disambiguation, gates,
expose statement) → **`## Per-stage agent applicability`** (new, §5 table + `validate`-agnostic
guard §6) → `## Version gating` (existing **+ §4.4 floor bump to 0.6.0**). No other section
changes. The result reads as one coherent consumer-side contract whose agent dimension is
visibly additive.

## Dependencies

This is the **synthesis/expose** document — it restates 02–05 and introduces no new mechanism, so
it depends on all of them being defined (it cross-references their owning specs, it does not
re-derive their algorithms):

- **`00-core-definitions.md`** — the consumed rauf types (`AgentAvailability`, `RUNNER_DEFAULT_ID`,
  `resolveAgentId`, `BacklogItem.provider`), the `{agent}` token, and the precedence boundary (§5)
  that §4.1–§4.2 reference.
- **`01-architecture-layout.md`** — the file-change map and the `forge-loop-runner-contract` expose
  surface (§3) this document is half of; confirms `ralph-loop-contract.md` is the edited file.
- **`02-config-schema-and-gating.md`** — the schema half of the expose (the three new `loopRunner`
  fields, the `{agent}` token, the capability gate) restated in §4.1/§4.4.
- **`03-selection-resolution-observability.md`** — the precedence/resolution algorithm and the
  Step 2d selector restated in §4.2.
- **`04-availability-precheck.md`** — the probe + unknown/unavailable disambiguation restated in §4.3.
- **`05-runner-discovery-version-gate.md`** — the version floor (0.6.0), gate behavior, and dual
  install hint restated in §4.4.

Implementation order: this doc's edit may be applied any time after 02–05 are settled (it
documents their behavior). It shares **no file** with any other spec — `ralph-loop-contract.md` is
edited only here.

## Verification

These checks confirm an implementation of `references/ralph-loop-contract.md` matches this spec.
The contract doc is markdown, so verification is by inspection + grep; the behavioral assertions
it documents are mechanically checked in `07-testing-strategy.md`.

- [ ] **Default-to-rauf stated (REQ-DEF-01):** the doc plainly states rauf is the default runner
      and that with no `loopRunner` block forge announces the default. (Already present in
      `## The seam`; preserved.)
- [ ] **Pluggability stated (REQ-DEF-02):** the doc states the seam is tokenized with no hardcoded
      `rauf …` commands and that an alternate runner is configured via `loopRunner` without editing
      a skill. (Already present; preserved.) `grep -n 'no hardcoded' references/ralph-loop-contract.md`
      still matches.
- [ ] **Additive-dimension note added (REQ-DEF-01/02):** the
      `## rauf is the default and reference implementation` section states the agent dimension is
      additive + presence-gated and degrades silently (§3).
- [ ] **`## Agent selection` section present (REQ-PREC-*/AVAIL-*/PLUG-*):** the doc has an
      `## Agent selection` section covering the consumed surface, the `item > run > project >
      default` precedence with the run-layer mapping, the probe + unknown(hard-reject)/unavailable
      (warn-proceed) split, and the capability gate — cross-referencing 02/03/04 (§4).
- [ ] **Per-stage table present and complete (REQ-SEAM-01):** the doc contains the
      `## Per-stage agent applicability` table classifying **all three** runner-touching stages
      exactly as §5: `forge-5-loop` = run/eventStream/status/version + Full agent dimension;
      `forge-4-backlog` = `validate` + None; `forge-verify` = `validate` + None.
- [ ] **`validate`-agnostic guard present (REQ-SEAM-02):** the doc has a `## \`validate\` is
      agent-agnostic` note stating no agent argument may ever be passed to backlog validation in
      any stage (§6).
- [ ] **No `--agent` near any `validate` (REQ-SEAM-02, fact-check):**
      `grep -nE -- '--agent|\{agent\}|agentArgument' skills/forge-4-backlog/SKILL.md skills/forge-verify/SKILL.md`
      returns **no** match adjacent to any `validate` / `validateCommand` usage (the only "agent"
      tokens in those skills are `agentDelegation` / "fresh agent" / `forge-verifier` — unrelated).
- [ ] **Version floor stated as 0.6.0 (REQ-BIN-02, restated):** the `## Version gating` section
      names the floor as **0.6.0** and calls it the agent-surface floor (§4.4); the two install
      "installs" (`installHint` vs `setupHint`) stay distinct.
- [ ] **Expose self-identified (REQ-DEF-03):** the doc states that it + the `loopRunner` schema
      block constitute the `forge-loop-runner-contract` expose consumed by `packaging-docs-ci` (§7).
- [ ] **Adapters regenerated, gate green:** after editing the canonical reference, the gate
      `bash scripts/validate.sh` passes (spec-purity + adapters drift guard + pytest), per
      `01-architecture-layout.md §4`. (`references/ralph-loop-contract.md` is a canonical reference;
      no adapter is generated *from* it, but the gate must still pass.)
