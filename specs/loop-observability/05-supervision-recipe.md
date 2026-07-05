# 05 — Supervision Recipe & Phase-4 Docs

> **Prose/prescription document (Phase 2 prescription half + Phase 4 docs).**
> This doc specifies a **skill rewrite** and a set of **doc updates** — it adds no
> new code and defines no new type. It builds on the contract completed in
> [`02-health-status-contract.md`](./02-health-status-contract.md) (the `health`
> block + `statusSchemaVersion`), consumes the shared types from
> [`00-core-definitions.md`](./00-core-definitions.md), and cites the target
> resolution rules from [`03-target-resolution.md`](./03-target-resolution.md).
> Traces to [`tech-spec.md`](./tech-spec.md) §3.6 (the canonical poll recipe) and
> §3.7 (feature-forge deference), and [`PRD.md`](./PRD.md) §3.2, §3.5, §6, §9.

The deliverable is: (1) rewrite `drive-rauf-loop/SKILL.md` from a reference card
into **the one** canonical poll automation recipe; (2) keep its
`.codex-plugin` mirror byte-identical; (3) verify the `rauf-loop-driver.md` agent
still defers to it; (4) update `docs/SPEC-CLI.md` and
`docs/SPEC-BACKLOG-TOOL-CONTRACT.md`; (5) record feature-forge deference as an
out-of-scope, cross-repo follow-up for traceability only.

---

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-PRESCRIBE-01 | Exactly **one** prescribed pattern: poll, not stream | 3.1, 3.2 |
| REQ-PRESCRIBE-02 | Start backgrounded → poll → branch → recover | 3.2, 3.3, 3.4, 3.5 |
| REQ-PRESCRIBE-03 | Documented, overridable **5s default / 5–10s band** poll interval | 3.3 |
| REQ-PRESCRIBE-04 | Four-way decision tree → done / needs-human / stall / healthy | 3.4 |
| REQ-PRESCRIBE-05 | Stream stays optional; decisions never depend on it | 3.6 |
| REQ-PRESCRIBE-06 | feature-forge `forge-5-loop` defers to `drive-rauf-loop` | 6 |
| REQ-SKILL-01 | `drive-rauf-loop` rewritten reference-card → automation recipe; owns the contract | 3, 4 |
| REQ-SKILL-02 | `author-backlog` unaffected (noted, no change) | 6 |
| REQ-SUCCESS-01 *(keystone)* | One poll = full decision, zero raw-file reads | 3.3, 3.4, 8 |
| REQ-SUCCESS-02 | Exactly one supervision pattern; forge-5-loop references it | 3.1, 6 |
| REQ-SUCCESS-06 | An agent author no longer invents a poll interval or reads a second file (prescription half) | 3.3, 3.4 |
| REQ-CMD-04 | `log` unchanged in role; documented as-is | 5.1 |
| REQ-COMPAT-01 | Machine surface unchanged; docs describe additive fields only | 5.1, 5.2 |
| C-05 | `drive-rauf-loop` / `rauf-loop-driver` are the canonical home | 3.1, 4.3, 6 |
| Q3 | forge-5-loop / runner-contract.md edit is a cross-repo follow-up | 6 |
| Q4 | Persist-then-escalate ladder + N=3 threshold | 3.5 |

---

## 1. Files changed (resolved real paths)

Resolved with `git -C /home/gary/workspace/rauf ls-files | grep -i drive-rauf-loop`
and `… grep -i rauf-loop-driver`. **All four skill/agent copies exist**; the two
`SKILL.md` files are currently **byte-identical** (`diff` returns empty), so the
rewrite must be applied identically to both to preserve that invariant.

| # | Real path (repo-relative) | Change | Owner phase |
|---|---------------------------|--------|-------------|
| 1 | `skills/drive-rauf-loop/SKILL.md` | **Rewrite** into the canonical poll recipe (§3, §4) | Phase 2 |
| 2 | `.codex-plugin/skills/drive-rauf-loop/SKILL.md` | **Mirror** — apply an identical rewrite; keep byte-identical to #1 | Phase 2 |
| 3 | `agents/rauf-loop-driver.md` | **Verify** it still defers to the rewritten skill; **likely no edit** (§4.3) | Phase 2 |
| 4 | `.codex/agents/rauf-loop-driver.toml` | **Verify** the codex-agent mirror still defers (likely no edit — §4.3) | Phase 2 |
| 5 | `docs/SPEC-CLI.md` | Document `health`, `statusSchemaVersion`, item-feed `follow` default + `--verbose`, scope/resolution rules (§5.1) | Phase 4 |
| 6 | `docs/SPEC-BACKLOG-TOOL-CONTRACT.md` | Document the agent single-poll decision contract, `health` fields, the four-way tree reference (§5.2) | Phase 4 |

> **Mirror invariant.** #1 and #2 are byte-identical today and MUST stay so after
> the rewrite. There is a **fifth** driver mirror (`.codex/agents/rauf-loop-driver.toml`)
> discovered during path resolution — it, like `agents/rauf-loop-driver.md`, only
> *defers to* the skill and needs verification, not a semantic rewrite (§4.3).
>
> **No new code and no new type.** This doc changes prose only. Every field it
> references (`loopState`, `health.stuckWarning`, `lock.stale`/`lock.alive`,
> `backlogSummary.needsHuman`, `lastSignal`) is defined in
> `00-core-definitions.md` and populated per `02-health-status-contract.md`. Web
> parity is **deferred entirely** (Q2 — Phase 4 is docs-only); §5.3 says so.

---

## 2. Purpose & scope

**In scope (this doc):**

- The **shape and content** of the rewritten `drive-rauf-loop/SKILL.md`: from a
  triage/reference card into **the ONE canonical poll automation recipe**
  (REQ-SKILL-01, REQ-PRESCRIBE-01).
- The exact **prescriptions** the skill documents: start backgrounded, poll
  interval default/band, the four-way decision tree table, the
  persist-then-escalate recovery ladder, stream-stays-optional (REQ-PRESCRIBE-02…05,
  Q4).
- The **doc-update outlines** for `SPEC-CLI.md` and `SPEC-BACKLOG-TOOL-CONTRACT.md`
  (Phase 4, REQ-COMPAT-01, REQ-CMD-04).

**Out of scope (owned elsewhere):**

- The `health` block / `statusSchemaVersion` **implementation** →
  `02-health-status-contract.md`.
- `resolveTarget()` **behavior** and its machine-context strictness →
  `03-target-resolution.md`.
- The `follow` item-feed / `eventAltitude` **implementation** →
  `04-event-altitude-follow.md`.
- The feature-forge `forge-5-loop` / `runner-contract.md` edit → **a different
  repo**; noted only for traceability (§6, Q3).
- Web parity → deferred follow-up feature (Q2).

The skill is **prose**; its correctness is verified structurally — every input the
decision tree reads must be present on `DerivedStatus` from a single poll (§8).

---

## 3. The canonical poll supervision recipe (the rewrite content)

This section specifies **what the rewritten skill must prescribe**. It is the
normative content for files #1 and #2 in §1.

### 3.1 Retire the fork — one pattern, poll not stream (REQ-PRESCRIBE-01, REQ-SUCCESS-02, C-05)

Today the ecosystem carries **two** divergent supervision models: this skill's
poll-oriented §2/§4 and feature-forge's push/`Monitor` (`jq` milestone-filter)
model. The rewrite makes `drive-rauf-loop` the **single source of truth** for the
decision semantics: **poll `status --json`, branch on a decision tree, recover
per a ladder** (REQ-PRESCRIBE-01). It is **the authoritative, referenceable
contract** in the rauf repo (C-05) — feature-forge references it rather than
re-deciding (§6, REQ-SUCCESS-02).

**Diff against the current SKILL.md (as read):**

- The current triage block (§"Start here") and the observe/recover **reference
  tables** (current §2, §3, §5) are **kept as reference** but **subordinated** to
  the new canonical recipe. The card described *which* commands exist; the recipe
  now prescribes *the supervision loop to run them in*.
- The current §2 "Detecting a stall" paragraph — which today says *"rauf sets
  `stuckWarning` in `.rauf/iteration-status.json`… Do not infer a stall from
  `state.json`'s `updatedAt` alone"* — is **rewritten** to read the stall hint
  from `status --json`'s new `health.stuckWarning`, **never** from
  `iteration-status.json` directly (REQ-SUCCESS-01 keystone). This is the single
  most important semantic change: the old text forced the agent to read a raw file
  the skill otherwise told it not to touch; the new `health` block closes that hole
  (see `02-health-status-contract.md` §1).
- The current §4 "Live human-in-the-loop supervisor pattern" (the
  `--ndjson --pause-on-needs-human` snippet) is **retained but demoted** to the
  optional narration/diagnosis section (§3.6): a latency optimization, never the
  decision path.

### 3.2 Step 1 — Start backgrounded (REQ-PRESCRIBE-02.1)

The skill prescribes starting the loop **backgrounded** so it survives the session
and does not block the driving agent:

```
rauf loop run <root> --backlog <dir> --detached
```

- `--detached` / `-d` auto-starts the server daemon and returns immediately
  (confirmed in `docs/SPEC-CLI.md` §`rauf loop run`, line ~159/164). The loop then
  runs independently of the driving session.
- Where a harness offers its own background primitive (e.g. a background job that
  survives), that is an acceptable substitute — the requirement is *"the loop
  survives and doesn't block the session,"* not a specific mechanism.
- Precondition guards (dirty tree / protected branch) are unchanged and referenced,
  not restated: `--create-branch`, `--seed-backlog`, `--force` (current SKILL.md
  §0). A start refused for a precondition is **not** a stall — it is a setup error
  the agent resolves before entering the poll loop.

### 3.3 Step 2 — Poll the single decision surface (REQ-PRESCRIBE-02.2, REQ-PRESCRIBE-03, REQ-SUCCESS-01)

The **only** surface the agent reads to *decide* is:

```
rauf status <root> --backlog <dir> --json
```

- **Explicit target, always.** In a machine context (`--json` OR non-TTY),
  `<root>` + `--backlog <dir>` MUST be explicit — a missing/ambiguous target is a
  **hard error**, never a silent scan (REQ-SCOPE-01; behavior in
  `03-target-resolution.md` §3, §4). The skill instructs the agent to pass both
  explicitly and to treat a `TargetError` (`missing_target` / `ambiguous_target`)
  as *"fix your addressing,"* not as a loop state.
- **Prescribed poll interval — a documented, overridable default (REQ-PRESCRIBE-03,
  ratifies D3):**
  - **Default: 5 seconds** between polls.
  - **Band: 5–10 seconds** — the agent MAY widen toward 10s to reduce
    `deriveStatus` read cost, or narrow toward 5s for lower detection latency.
  - This is a **prescription in the skill, not a code constant** — it never becomes
    a `core` export (confirmed `00-core-definitions.md` §3). The skill states the
    number as documented guidance.
- **Keystone rule (REQ-SUCCESS-01):** the agent **NEVER** reads
  `.rauf/iteration-status.json` or `events.ndjson` **to make a decision**. One
  `status --json` poll is a complete superset — including the stall hint via
  `health` (`02-health-status-contract.md` §1). If the agent ever *needs* a raw
  file to decide, the contract has a hole and the feature is not done. The stream
  remains available **only** for narration/diagnosis (§3.6).

### 3.4 Step 3 — The four-way decision tree (REQ-PRESCRIBE-04, REQ-SUCCESS-01)

Each poll yields **one** decision by evaluating the branches **top-to-bottom**
(first match wins — `needs-human` outranks a stall hint, done outranks healthy).
All inputs come from the single `DerivedStatus` object (fields per
`00-core-definitions.md` §1.4 and `02-health-status-contract.md`).

| # | Condition (from ONE `status --json` poll) | Decision | Action |
|---|-------------------------------------------|----------|--------|
| 1 | `loopState ∈ {COMPLETE, IDLE}` **and** `backlogSummary` has nothing `pending`/`inProgress` | **Done** | Report the outcome and **stop**. |
| 2 | `loopState = PAUSED_HUMAN` **or** `lastSignal = "needs_human"` **or** `backlogSummary.needsHuman > 0` | **Needs human** | **Surface to the user** — the **ONLY** true stop. Do not auto-recover. |
| 3 | `health?.stuckWarning === true` | **Recoverable stall** | Apply the persist-then-escalate ladder (§3.5). |
| 4 | `loopState ∈ {RUNNING, REVIEWING}`, no stall hint | **Healthy in-progress** | **Keep polling** at the interval. |

Notes the skill must carry:

- **Ordering matters.** `needs-human` (row 2) is checked **before** the stall hint
  (row 3): a paused-for-human loop that also happens to show a stale iteration is a
  needs-human stop, not a recovery case.
- **`health` may be `null`** (no live iteration). `status.health?.stuckWarning`
  short-circuits to falsy — row 3 does not fire, which is correct: no live
  iteration means no stall to recover (`00-core-definitions.md` §1.2).
- **Rows 2's three signals are complementary, not redundant.** `PAUSED_HUMAN` is
  the halt state under `--pause-on-needs-human`; `lastSignal = needs_human` and
  `backlogSummary.needsHuman > 0` cover the default "set aside and continue" mode
  where the loop kept running but a human question is outstanding. Any one is
  sufficient. `backlogSummary` disjointness is preserved (REQ-CONTRACT-06): the
  skill reads `needsHuman` (a disjoint subset), **not** the total `blocked`.
- The existing exit-code table (current SKILL.md §3) stays as a **secondary**
  branch aid for agents that shell out and read `$?`; the four-way tree keyed on
  `--json` fields is the **primary** contract.

### 3.5 Step 4 — Persist-then-escalate recovery ladder (REQ-PRESCRIBE-02.4, Q4, REQ-CONTRACT-04)

The stall hint is a **decision aid, not a verdict** (REQ-CONTRACT-04): "an
iteration appears to have stopped making progress," a hang warning, not a failure.
The skill prescribes a **persist-then-escalate** ladder so a single transient hint
never triggers a disruptive recovery:

1. **Single-poll `health.stuckWarning` → surface & keep polling.** On the *first*
   poll showing `stuckWarning`, the agent **surfaces** the warning (narration) and
   **continues polling**. It does **not** act yet.
2. **Persists across N consecutive polls → act.** Only when `stuckWarning` is
   `true` on **N = 3 consecutive polls** (≈ **15–30 s** at the 5–10 s interval)
   does the agent take a recovery action:
   - **Paused loop → `resume`.** If `loopState` is a resumable pause
     (`PAUSED`, `LIMIT_REACHED`, `*_LIMIT`), run `rauf resume <root> --backlog <dir>`.
   - **Otherwise → re-run with `--force`.** If the loop is not paused, re-run the
     next iteration with `--force` (per current SKILL.md §2's framing:
     *"escalate `--force` on the next run only if it persists"*).
3. **`reset` ONLY for a confirmed-dead lock.** Use `rauf reset` **only** when the
   status shows a stale, dead lock: `lock.stale === true && lock.alive === false`
   (`LockSummary` fields, `00-core-definitions.md`; documented in
   `SPEC-BACKLOG-TOOL-CONTRACT.md` §A.7.2). `reset` is never the first response to a
   stall hint.
4. **`needs_human` is the only true stop.** No point on this ladder auto-resolves a
   needs-human state; that always surfaces to the user (§3.4 row 2).

Prescriptions restated for the skill (documented values, **not** code constants):

| Prescription | Value | Nature |
|--------------|-------|--------|
| Poll interval default | **5 s** | Documented, overridable (REQ-PRESCRIBE-03) |
| Poll interval band | **5–10 s** | Documented range |
| Escalation threshold | **N = 3** consecutive stall polls (≈15–30 s) | Documented, overridable (Q4) |
| `reset` trigger | `lock.stale && !lock.alive` only | Documented condition |

The **counter is agent-side state** (count consecutive `stuckWarning === true`
polls; reset the counter on any poll where it is false). Core does **not** track
persistence — it returns booleans + raw age so the agent owns the threshold
(`00-core-definitions.md` §1.1, tech-spec §3.1). `secondsSinceActivity` on the
`health` block is available as a supplementary signal if the agent wants a
time-based rather than poll-count threshold, but N=3 consecutive polls is the
prescribed default.

### 3.6 Step 5 — Stream stays optional (REQ-PRESCRIBE-05)

The event stream (`rauf loop run … --ndjson`, `events.ndjson`, and the harness
`Monitor` push model) remains **available** as a lower-latency narration and
diagnosis aid where a harness offers it — but the skill states, explicitly and
prominently:

> **Agent decisions MUST NEVER depend on the stream.** The stream is for narration
> and diagnosis only. Every done / needs-human / stall / healthy decision is made
> from the `status --json` poll (§3.4). The stream may make narration richer or
> lower-latency; it is never on the decision path.

The current SKILL.md §4 `--ndjson --pause-on-needs-human` supervisor snippet is
retained **here** as the optional narration example, clearly labelled as an
optimization, not the control loop.

---

## 4. Skill document structure (both copies)

The rewritten `SKILL.md` (files #1 and #2, kept byte-identical) MUST contain, in
order:

### 4.1 Frontmatter — unchanged

Keep the existing `name: drive-rauf-loop` and `description` frontmatter (verbatim
from the current file). The trigger phrases still apply; only the body is rewritten.

### 4.2 Body sections (normative outline)

1. **What this skill is / is NOT** — retain the current boundaries block
   (not backlog authoring, not the per-iteration contract, not setup-fixing, not a
   flag reference). Add one line: *"This skill is the **one** canonical supervision
   recipe (poll, not stream) — the authoritative decision contract other tools
   (including feature-forge's `forge-5-loop`) reference."* (REQ-PRESCRIBE-01,
   REQ-SUCCESS-02, C-05).
2. **The canonical recipe (new, primary section)** — the five prescribed steps of
   §3.2–§3.6 as an explicit automation loop: start backgrounded → poll → branch on
   the four-way tree → recover per the ladder → (optional) narrate via stream.
   Include the **decision-tree table** (§3.4) and the **recovery-ladder** (§3.5)
   verbatim in intent.
3. **Reference material (subordinated)** — the existing status vocabulary, exit-code
   table, and recover-command tables kept as a lookup appendix, cross-linked from
   the recipe. These support the recipe; they no longer *are* the skill.
4. **Targeting a non-default backlog root** — retain the current §6, tightened to
   note that in a **machine context** the explicit `<root>` + `--backlog <dir>` is
   **required** (cross-ref `03-target-resolution.md`; REQ-SCOPE-01).
5. **Quick reference / cross-links** — retain, and point the machine-surface link at
   the updated `SPEC-BACKLOG-TOOL-CONTRACT.md` §A.7.2 (now describing `health` +
   `statusSchemaVersion`).

### 4.3 Agent-mirror verification — `rauf-loop-driver` (C-05)

`agents/rauf-loop-driver.md` (and its codex mirror `.codex/agents/rauf-loop-driver.toml`)
**delegate** to the skill: the read `.md` already says *"Operate exactly as the
canonical `drive-rauf-loop` skill specifies (the single source of truth for the
lifecycle, machine surfaces, and recovery playbook)."* Because they reference the
skill by name rather than restating its decision rules, the rewrite flows through
with **no edit**.

**Required verification (not an edit):** after the rewrite, confirm the driver
agent(s) still contain no *divergent* inline decision rules (no hard-coded interval,
no competing stall heuristic) that would contradict the rewritten skill. If a
divergence is found, delete the inline rule and keep the deference. Record the
check result; the expected outcome is **"no edit needed."**

---

## 5. Phase-4 doc updates (REQ-COMPAT-01, REQ-CMD-04)

Docs describe the **already-shipped additive** behavior from Phases 1–3. They add
**no** new behavior and MUST NOT imply any machine-surface field was renamed or
removed (REQ-COMPAT-01, the prime directive). Web parity is out of scope (§5.3).

### 5.1 `docs/SPEC-CLI.md`

| Location (verified line) | Update |
|--------------------------|--------|
| `### rauf status [path]` (~L493) | Note `[path]` is now **optional on a TTY** (cwd default; ambiguous → interactive pick list); in a machine context (`--json`/non-TTY) a missing/ambiguous target is a **hard error** (cross-ref `SPEC-BACKLOG-TOOL-CONTRACT.md` §A.7.2 and `03-target-resolution.md`). Document that `status --json` now carries **`statusSchemaVersion: "1"`** and a nested **`health`** block (`{ stuckWarning, iterationFresh, lastActivityAt, secondsSinceActivity }`, `null` when no live iteration). Note bare `status` broadens to `--all` only when no local live loop exists. |
| `### rauf follow [path]` (~L526) | Document the **new item-level narration default** (item/loop milestones + sticky progress header `4/12 done · 1 blocked · on auth-007`) and the new **`--verbose`** flag that restores the full token/tool firehose. State that **`--json` is unchanged** — every event, no altitude filter (REQ-CMD-03). `[path]` now optional on TTY. (Behavior owned by `04-event-altitude-follow.md`.) |
| `### rauf log [path]` (~L519) | **No change** — `log` remains the raw `rauf.log` tail, `--follow` live tail as today (REQ-CMD-04). State explicitly it is unchanged so a reader doesn't expect a new altitude filter here. |
| `## Command Overview` / `## Exit Codes` | No exit-code change; confirm the `status --json` row still lists all four decision states. Add a one-line pointer from the `status`/`follow` overview rows to the agent single-poll contract in `SPEC-BACKLOG-TOOL-CONTRACT.md` §A.7.2. |

### 5.2 `docs/SPEC-BACKLOG-TOOL-CONTRACT.md`

| Location (verified line) | Update |
|--------------------------|--------|
| `### A.7.2 Canonical status surface` (L247) | Add the two new `DerivedStatus` fields to the field list: **`statusSchemaVersion: "1"`** (top-level version marker mirroring `EVENTS_SCHEMA_VERSION`) and **`health?`**: a nested block `{ stuckWarning, iterationFresh, lastActivityAt, secondsSinceActivity }`, **`null`** when no iteration is live. Describe each field (per `00-core-definitions.md` §1.1). |
| `### A.7.2` (new sub-block) | Add **"the agent single-poll decision contract"**: the four-way decision tree table (§3.4) stating that **one** `status --json` poll answers done / needs-human / recoverable-stall / healthy — a supervisor never reads `iteration-status.json` or `events.ndjson` to decide (REQ-SUCCESS-01). Cross-link `drive-rauf-loop` as the authoritative recipe (C-05). |
| `### A.7.3 Compatibility promise` (L285) | Extend the additive-only list: the new `health` block and `statusSchemaVersion` marker are **additive** `DerivedStatus` fields (no rename/removal). Note `statusSchemaVersion` starts at `"1"`, consistent with the `EVENTS_SCHEMA_VERSION` discipline (REQ-COMPAT-01, REQ-COMPAT-02). |
| `### A.7.4 Machine vs human surfaces` (L319) | Reaffirm: the item-level `follow` altitude filter is **human-render-only** and never touches any machine surface; `follow --json` and `--ndjson` emit every event. |

### 5.3 Web parity — deferred (Q2)

Phase 4 is **docs-only**. Web observation parity for any new human view is
**deferred entirely to a follow-up feature** (Q2 ratified, tech-spec §1, §10 (Q2)).
This doc updates only the two spec files above and adds **no** web-facing doc.
State this explicitly in the Phase-4 doc updates so a reader does not expect a web
change.

---

## 6. feature-forge deference — traceability only (REQ-PRESCRIBE-06, Q3, C-05)

The **rauf-side** deliverable is solely that `drive-rauf-loop` **is** the
authoritative, referenceable decision contract (delivered by the §3/§4 rewrite —
REQ-SUCCESS-02, C-05).

The corresponding edit to **feature-forge's** `forge-5-loop` / `runner-contract.md`
— making it **reference** rauf's decision semantics instead of forking its own
`jq` milestone filter — lives in the **feature-forge repository** and is **OUT OF
SCOPE** for this feature's backlog. It is a coordinated cross-repo follow-up (Q3),
sequenced to land after this rewrite ships (`REQ-SKILL-01`). **No file in the rauf
repo is edited for it.** Recorded here for traceability so the coverage matrix is
complete.

`author-backlog` is **unaffected** (REQ-SKILL-02) — it is used only as the vehicle
to build this feature's own backlog; no change to that skill.

---

## 7. Error & edge cases (what the recipe prescribes)

The skill must prescribe agent behavior for these non-happy paths:

| Situation | What the agent does |
|-----------|---------------------|
| **Ambiguous / missing target** in machine context | The poll command returns a `TargetError` (`missing_target` / `ambiguous_target`). Treat it as an **addressing error** — fix by passing explicit `<root>` + `--backlog <dir>`; **never** fall back to a scan (REQ-SCOPE-01; `03-target-resolution.md`). |
| **Usage-limit / sleeping pause** (`PAUSED_USAGE_LIMIT`, `SLEEPING_LIMIT`, `WEEKLY_LIMIT`, `LIMIT_REACHED`) | Not a stall and not a needs-human stop. **Keep polling**; the loop auto-resumes when limits reset (or `resume` once reset). Use `sleepUntil` from the status object to inform narration. This is a healthy-ish waiting state — do **not** run the recovery ladder. |
| **`health = null`** (no live iteration) while `loopState` is `RUNNING` transiently | Treat as no stall signal available this poll; the stall counter is **not** incremented. Continue polling. |
| **Transient single-poll `stuckWarning`** | Surface, **do not act**; reset toward escalation only if it persists to N=3 (§3.5). |
| **Confirmed-dead lock** (`lock.stale && !lock.alive`) with work remaining | The only case for `reset`; then re-run (§3.5 step 3). |
| **`ERROR` loopState** | Crash / circuit-breaker halt: `reset` then re-run, or `resume` (current SKILL.md §5). Not a stall-ladder case. |
| **Sleep between polls** | Sleep the prescribed interval (5 s default) between polls. In a harness that forbids a foreground `sleep`, use its wait/until primitive; the interval is a prescription, the mechanism is harness-specific. |

All of the above are **decidable from the single `status --json` poll** (loopState,
`health`, `lock`, `backlogSummary`, `sleepUntil`, `lastSignal`) — reinforcing
REQ-SUCCESS-01.

---

## 8. Verification

The skill is prose, so verification is structural (the recipe must be *executable*
from one poll) plus doc/mirror consistency:

- [ ] **Every decision-tree input is present on `DerivedStatus`** so the recipe is
      executable from one poll (REQ-SUCCESS-01): `loopState`, `lastSignal`,
      `backlogSummary.needsHuman`, `backlogSummary.pending`/`inProgress`,
      `health` (`stuckWarning`, `secondsSinceActivity`), and `lock`
      (`stale`, `alive`) — all defined in `00-core-definitions.md` §1.4 and
      populated per `02-health-status-contract.md`. Assert none require reading
      `iteration-status.json` or `events.ndjson`.
- [ ] The rewritten `skills/drive-rauf-loop/SKILL.md` contains: the four-way
      decision tree table, the persist-then-escalate ladder, the **5 s default /
      5–10 s band** interval, the **N=3** threshold, the `reset`-only-on-dead-lock
      rule, and the stream-never-decides statement.
- [ ] **Both skill copies are byte-identical** after the rewrite:
      `diff skills/drive-rauf-loop/SKILL.md .codex-plugin/skills/drive-rauf-loop/SKILL.md`
      returns empty (they are identical today — preserve it).
- [ ] `agents/rauf-loop-driver.md` and `.codex/agents/rauf-loop-driver.toml` still
      **defer** to the skill with no divergent inline decision rules (§4.3);
      expected outcome: no edit.
- [ ] The rewrite **removes** the old instruction to read
      `.rauf/iteration-status.json` for the stall signal, replacing it with
      `status --json`'s `health.stuckWarning` (§3.1 diff).
- [ ] `docs/SPEC-CLI.md` mentions the new `health` block, `statusSchemaVersion`,
      the item-feed `follow` default + `--verbose`, and the machine-context scope
      strictness; `rauf log` documented as unchanged (REQ-CMD-04).
- [ ] `docs/SPEC-BACKLOG-TOOL-CONTRACT.md` §A.7.2 lists `health` + `statusSchemaVersion`
      and carries the four-way single-poll decision contract; §A.7.3 records them as
      additive (REQ-COMPAT-01/02).
- [ ] No web-facing doc changed (web parity deferred — Q2, §5.3).
- [ ] `pnpm gate` is green (the skill/doc changes are non-code, but the phase must
      still pass the gate — REQ-GATE-01).

---

## Dependencies

- **`00-core-definitions.md`** — the `Health`, `DerivedStatus` (with `health` +
  `statusSchemaVersion`), `LockSummary`, `backlogSummary`, and `TargetError` shapes
  the decision tree reads.
- **`02-health-status-contract.md` — MUST land first (Phase 1 before Phase 2).**
  The four-way tree reads `health.stuckWarning`; the recipe is not executable from
  one poll until the `health` block is populated on `DerivedStatus`. The contract
  must be **complete** before it can be **prescribed** (PRD §6).
- **`03-target-resolution.md`** — the machine-context strictness (`<root>` +
  `--backlog <dir>` explicit; ambiguity is a hard error) the recipe relies on for
  unambiguous addressing.
- **`04-event-altitude-follow.md`** — the item-level `follow` default that §5.1's
  `SPEC-CLI.md` update documents (Phase 3 lands before Phase 4 docs describe it).
- Existing source (read-only): current `skills/drive-rauf-loop/SKILL.md`,
  `.codex-plugin/skills/drive-rauf-loop/SKILL.md`, `agents/rauf-loop-driver.md`,
  `.codex/agents/rauf-loop-driver.toml`, `docs/SPEC-CLI.md`,
  `docs/SPEC-BACKLOG-TOOL-CONTRACT.md`.
