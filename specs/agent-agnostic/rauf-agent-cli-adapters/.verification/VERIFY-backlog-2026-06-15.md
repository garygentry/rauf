# Verification Report: rauf-agent-cli-adapters (backlog)
Date: 2026-06-15
Pipeline Stage: forge-4-backlog complete → forge-verify-backlog
Artifacts Reviewed:
- specs/agent-agnostic/rauf-agent-cli-adapters/backlog.json (13 items, IDs 001–013)
- PRD.md, tech-spec.md, 00–07 implementation specs, TRACEABILITY.md
- Deterministic runner validation: `rauf-stable backlog validate` → `valid: true, findings: []`

Method: parallel dimensioned fan-out — 4 `forge-verifier` instances over disjoint
CHECK-ID slices (scoping/AC: B11–B14,B25 · dependency/ordering: B15–B19 · spec
coverage/completeness: B07–B10,B20–B24 · schema/enum: B01–B06). 25/25 checks executed.

## Summary
- Total findings: 5
- Gaps: 1
- Inconsistencies: 2
- Improvements: 2
- Errors: 0

Clean dimensions: **schema/enum (B01–B06)** — valid JSON, all required fields, unique IDs,
all `type`/`status`/`priority` values within the canonical Zod enums
(`packages/core/src/schemas.ts`); **dependency cycles/validity (B15–B17, B19)** — DAG, no
dangling refs, foundation items have empty `dependsOn`, priority order consistent;
**spec coverage (B07–B10, B20–B24)** — all 8 spec docs referenced, all P0 REQs covered by
≥1 item's AC, all `specReferences` paths resolve. Deterministic runner validation passed.

## Findings

### V-001: Item 011 modifies `commands.ts` but specifies no test target for it
- **Severity:** gap
- **Location:** backlog.json item `011`, `description` step 2 + `acceptanceCriteria`
- **Issue:** Item 011 step 2 edits `packages/cli/src/commands.ts` to register the
  `--agent <id>` `FlagDef` on `loop run` and a new top-level `agents` `CommandDef`. The
  item's test references only name `loop-commands.test.ts`. But `06-cli-surface.md`
  §Verification (line 482) explicitly assigns the registration tests to a **separate**
  file: "`commands.test.ts` (the `--agent` `FlagDef` and `agents` `CommandDef`
  registration)." That file exists (`packages/cli/src/commands.test.ts`) and is distinct
  from `loop-commands.test.ts`. As written, the new `commands.ts` registration code has no
  stated test target, so a fresh agent may leave the FlagDef/CommandDef wiring untested
  while `pnpm gate` still passes — masking the omission.
- **Suggested fix:** Add `commands.test.ts` to item 011. In description step 3 add: "EDIT
  packages/cli/src/commands.test.ts: assert the `loop run` command's flags array contains a
  `--agent` FlagDef whose description enumerates SUPPORTED_AGENT_IDS, and that a top-level
  `agents` CommandDef (name 'agents', handler handleAgents, a --json FlagDef) is
  registered." Add an AC bullet: "commands.test.ts covers the `--agent` FlagDef
  registration on `loop run` and the `agents` CommandDef registration." Add
  `commands.test.ts` to the item's effective file list.
- **References:** 06-cli-surface.md §Verification (line 482); 07-testing-strategy.md §3.2e
  (scopes loop-commands.test.ts to behavior, defers FlagDef registration to 06);
  packages/cli/src/commands.test.ts (existing file)
- **Checklist:** CHECK-B14

### V-002: Item 011 conflates the in-process vs detached `--agent` flag-read forms
- **Severity:** inconsistency
- **Location:** backlog.json item `011`, `description` steps 1 and 2
- **Issue:** The spec uses two deliberately different reads of `--agent`. In-process
  (handleLoopRun) coalesces null→undefined: `const agent = extractStringFlag(ctx.flags,
  "agent") ?? undefined;` then `provider: agent` (06 §3.1 line 114). The detached path
  (runDetached) does NOT coalesce: `const agent = extractStringFlag(ctx.flags, "agent");`
  then `if (agent !== null) body.provider = agent;` (06 §3.1.2 lines 151/154). Item 011
  step 1 shows the coalesced form, but step 2 says "read the flag and `if (agent !== null)
  body.provider = agent;`". Applying `agent !== null` to an already-`?? undefined` value is
  meaningless (always true → sends `provider: undefined`). A fresh agent copying step 1's
  read into step 2 would produce a subtly wrong detached request body.
- **Suggested fix:** In item 011 description step 2, make the detached read explicit and
  distinct: "In runDetached, read `const agent = extractStringFlag(ctx.flags, "agent");`
  (NOT coalesced — string|null) and `if (agent !== null) body.provider = agent;` mirroring
  the existing `body.model` send at :385." Leave step 1's `?? undefined` form for the
  in-process path only.
- **References:** 06-cli-surface.md §3.1 (line 114), §3.1.2 (lines 151, 154)
- **Checklist:** CHECK-B12, CHECK-B14

### V-003: Items 006 and 009 directly import item-001 symbols but omit `001` from `dependsOn`
- **Severity:** inconsistency
- **Location:** backlog.json item `006` (`dependsOn: ["003","004"]`) and item `009`
  (`dependsOn: ["003","004","007"]`)
- **Issue:** Item 001 is the sole producer of `GENERIC_AGENT_ID` (`constants.ts`) and the
  `ExecuteOptions.env` field (`providers/types.ts`). Item 006 imports `GENERIC_AGENT_ID`
  directly ("importable directly from ./constants.js here"); item 009 consumes
  `ExecuteOptions.env` (`...(this.childEnv ? { env: this.childEnv } : {})`). Neither lists
  `001`. This contradicts the backlog's own convention — items 003 and 007, which use the
  same item-001 symbols, both list `001` directly. **Not a build-ordering bug**: 001 is a
  transitive ancestor of both (via 003/004/007), so topological order is unaffected and the
  graph stays acyclic. It is a CHECK-B18 traceability inconsistency only.
- **Suggested fix:** Add `"001"` to the `dependsOn` of items 006 and 009 → `006:
  ["001","003","004"]`, `009: ["001","003","004","007"]`. (Alternatively, standardize on
  transitive-only edges and *remove* the explicit 001 from 003/007 — but apply one
  convention uniformly; the current mix is the defect.)
- **References:** backlog.json items 001 (producer), 003 + 007 (precedent); 00-core-definitions.md §3.4 (`ExecuteOptions.env`), §6 (constants)
- **Checklist:** CHECK-B18

### V-004: Items 009 and 010 carry `estimatedIterations: 2` against the one-item-per-iteration model
- **Severity:** improvement
- **Location:** backlog.json items `009` and `010`, `estimatedIterations`
- **Issue:** 009 and 010 are the only items with `estimatedIterations: 2` and
  `model: "opus"`; both touch the largest file (`runner.ts`) with 6-step descriptions and
  7-bullet AC. A rauf iteration runs ONE item to its `RAUF_DONE`; `estimatedIterations: 2`
  signals the author expects two passes, which sits at the upper edge of single-iteration
  scope (CHECK-B11). The 009/010 split (routing/lifecycle vs usage-gating/fail-fast) is a
  clean seam — this is an awareness flag, **not** a "too big" failure.
- **Suggested fix:** No split required. Confirm the loop runner treats `estimatedIterations`
  as advisory metadata only (it does not gate execution). If strict single-iteration items
  are desired and a real overflow is later observed, split 009 into 009a
  (resolveProviderForItem + cache + provider.execute call-site swap) and 009b (dispose
  lifecycle + claude-cli.ts env forwarding + event provider.id). Otherwise leave as-is.
- **References:** 05-runner-wiring.md §3.1–3.3, §3.6–3.7
- **Checklist:** CHECK-B11, CHECK-B25

### V-005: TRACEABILITY.md lists 29 REQ rows; PRD body appears to define 32 REQ-IDs
- **Severity:** improvement
- **Location:** TRACEABILITY.md (29 rows) vs PRD.md §3–§4 (REQ-XXX-NN definitions)
- **Issue:** The spec-coverage verifier independently confirmed every **P0** requirement is
  covered by at least one backlog item's acceptance criteria (CHECK-B08 passes), but noted
  the traceability matrix enumerates 29 requirements while the PRD body defines ~32 REQ-IDs
  across §3–§4. This is a **specs-traceability** discrepancy surfaced during backlog
  coverage checking — it does not change the backlog-coverage verdict, but an unlisted
  REQ-ID could silently escape future coverage audits.
- **Suggested fix:** Reconcile the count: re-run
  `/home/gary/.claude/skills/feature-forge/scripts/validate-traceability.py
  specs/agent-agnostic/rauf-agent-cli-adapters/PRD.md
  specs/agent-agnostic/rauf-agent-cli-adapters/ --json` and either (a) add the missing
  REQ rows to TRACEABILITY.md if they are genuine requirements, or (b) confirm the extra
  PRD §3–§4 IDs are sub-bullets/duplicates that legitimately collapse to 29. This is a
  specs-stage cleanup (forge-verify-specs is already `findings-applied`); recorded here as
  a heads-up, not a backlog blocker.
- **References:** TRACEABILITY.md; PRD.md §3–§4; forge-3-specs notes ("29 REQs, 0 uncovered")
- **Checklist:** CHECK-B08

## Fix Execution Plan

### User Decisions Required
None for V-001/V-002/V-003 — all are direct, deterministic edits to backlog.json. V-004 is
advisory (no edit required unless the team wants a strict single-iteration split). V-005 is
a specs-stage reconciliation that needs a quick confirm-or-add judgment but does not block
the backlog.

### Execution Steps

#### Step 1: Fix item 011 — add the missing test target and disambiguate the `--agent` read
- **Files:** specs/agent-agnostic/rauf-agent-cli-adapters/backlog.json
- **Addresses:** V-001, V-002
- **Checklist:** CHECK-B14, CHECK-B12
- **Action:** In item `011`: (a) Add a description sub-step and an AC bullet covering
  `packages/cli/src/commands.test.ts` — asserting the `--agent` FlagDef (description
  enumerates SUPPORTED_AGENT_IDS) is registered on `loop run`, and the top-level `agents`
  CommandDef is registered. (b) Rewrite description step 2 so the detached (runDetached)
  read is `const agent = extractStringFlag(ctx.flags, "agent");` (string|null, NOT
  coalesced) guarded by `if (agent !== null) body.provider = agent;`, keeping step 1's
  `?? undefined` form for the in-process path only.
- **Depends on:** none
- **Rationale:** Both touch the same item's description/AC; apply together to avoid two
  passes over item 011.

#### Step 2: Make the item-001 producer edge explicit on items 006 and 009
- **Files:** specs/agent-agnostic/rauf-agent-cli-adapters/backlog.json
- **Addresses:** V-003
- **Checklist:** CHECK-B18
- **Action:** Change item `006` `dependsOn` `["003","004"]` → `["001","003","004"]`, and
  item `009` `dependsOn` `["003","004","007"]` → `["001","003","004","007"]`. Touch no
  other item. Re-run `rauf-stable backlog validate` afterward to confirm the graph stays
  valid (it will — 001 was already a transitive ancestor).
- **Depends on:** none
- **Rationale:** Localized two-field edit; aligns 006/009 with the direct-edge convention
  used by 003/007 without altering topological order.

#### Step 3 (optional / advisory): record `estimatedIterations` intent and reconcile traceability
- **Files:** backlog.json (009/010 — only if splitting); TRACEABILITY.md (only if rows missing)
- **Addresses:** V-004, V-005
- **Checklist:** CHECK-B11, CHECK-B08
- **Action:** V-004 — no data change unless the team opts to split 009; confirm the runner
  treats `estimatedIterations` as advisory. V-005 — re-run validate-traceability.py and add
  any genuinely-missing REQ rows to TRACEABILITY.md, or confirm the 29 count is correct.
- **Depends on:** none
- **Rationale:** Neither blocks the backlog; grouped as a follow-up cleanup so the report is
  self-contained.

## Fix Progress

- Step 1: [APPLIED] 2026-06-15 — Item 011: rewrote the runDetached `--agent` read to the
  explicit non-coalesced form (`extractStringFlag(...)` → string|null, distinct from the
  in-process `?? undefined`) (V-002); added description step 4 + an AC bullet covering
  `packages/cli/src/commands.test.ts` for the `--agent` FlagDef + `agents` CommandDef
  registration (V-001). Item 011 now has 7 AC.
- Step 2: [APPLIED] 2026-06-15 — Added explicit `001` edge: item 006 `dependsOn` →
  `["001","003","004"]`, item 009 → `["001","003","004","007"]` (V-003). `rauf-stable
  backlog validate` re-run → `valid: true, findings: []` (graph unchanged topologically).
- Step 3: [APPLIED] 2026-06-15 — V-004: advisory only, no data change (estimatedIterations
  is loop-advisory metadata). V-005: ran `validate-traceability.py` →
  `total_requirements: 29, uncovered: [], orphaned: []`; the 29 count is authoritative and
  fully covered, so TRACEABILITY.md is left unchanged (the "~32" estimate counted informal
  mentions, not formal REQ-IDs). No edit required.
