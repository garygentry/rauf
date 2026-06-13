# 05 — Cutover & feature-forge Lockstep (ux-overhaul-grammar)

The single-release flip: how the v0.5.0 version bump, the documented contract, the feature-forge
out-of-loop update, and the project-spec/help updates land together so the whole toolchain is coherent at
exactly one moment of breakage. Builds on [`00-core-definitions.md`](./00-core-definitions.md) (the
normative contracts) and [`01-architecture-layout.md`](./01-architecture-layout.md) (the per-package change
map + change ordering). Cross-cutting source of truth: [`../ux-overhaul/CANON.md`](../ux-overhaul/CANON.md)
§6. All file:line references were verified against source on 2026-06-13; re-confirm at cutover (they drift).

## Requirement Coverage

| REQ | Covered by (section) |
|-----|----------------------|
| REQ-CONTRACT-01 | §1 single v0.5.0 flip |
| REQ-CONTRACT-02 | §2 version bump (`VERSION` const + package.jsons) |
| REQ-CONTRACT-03 | §3 documented contract (exit codes / signals / events / removed commands) |
| REQ-CONTRACT-04 | §4 feature-forge lockstep edits (exact files + lines) |
| REQ-CONTRACT-05 | §5 out-of-loop execution (separate repo, gated as done) |
| REQ-DOC-01 | §6 project spec docs (6 × `docs/SPEC-*.md`) |
| REQ-DOC-02 | §6 CLI help/usage |
| NFR-SAFETY-01 / NFR-CUTOVER-01 | §5/§7 dogfood rauf-stable + cutover sequencing |

## 1. Single v0.5.0 flip (REQ-CONTRACT-01)

All breaking changes in this feature land in **one release — v0.5.0** — so there is exactly one moment of
breakage (CANON §6.3, "single breaking flip"; NFR-CUTOVER-01). The breaking surface, all bundled:

- **Removed verb:** `loop start` (REQ-EXEC-02) — replaced by `loop run --detached` / `-d`.
- **Removed flag:** `--watch` everywhere (REQ-FLAG-01) — replaced by `--follow` / `-f`.
- **Exit-code remap:** the `ExitCode` enum is redefined in place to the unified canon table — values
  3/4/5/6 change meaning (00 §1; REQ-EXIT-01/02).
- **Review signal:** `signal_parsed.signal` gains `"review"` and the `review→done` collapse is removed
  (00 §3; REQ-SIG-01) — a consumer that previously saw `done` for a review item now sees `review`.
- **Events versioning discipline:** `events.ndjson` is formalized as a versioned, additive-only machine
  surface (00 §4; REQ-EVT-01). `EVENTS_SCHEMA_VERSION` stays `"1"` — **no shape break**, so this is
  contract documentation, not a wire break.

Per CANON §6.4 the break is **clean — no aliases**; the only backward-compat affordance is the REQ-RMV-01
remediation *message*. There is no parallel/old scheme kept alive. The flip is not "done" until **both**
the rauf-side changes (01 §3 steps 1–6) **and** the feature-forge update (§4 below) have landed together
(REQ-CONTRACT-05).

## 2. Version bump (REQ-CONTRACT-02)

`rauf version --json` must report `{ "version": "0.5.0" }` (or higher) after the flip, because
feature-forge's `minRunnerVersion` gate semver-compares against it (§4). **The authoritative source for the
reported version is the `VERSION` constant, NOT the package.jsons:**

- **`packages/core/src/version.ts:4`** — `export const VERSION = "0.4.0";` → bump to **`"0.5.0"`**. This is
  what `rauf version --json` emits: `commands.ts:7` imports `VERSION` from `@rauf/core` and `commands.ts:421`
  does `outputJson({ version: VERSION })` (also the `--text` path at `:423`, and `commands.ts:442/453`).
  **This single edit is what the FF gate keys on.**
- **The 6 `package.json` versions** (currently all `0.4.0`): root `package.json:3`,
  `packages/core/package.json:3`, `packages/cli/package.json:3`, `packages/loop/package.json:3`,
  `packages/web/package.json:3`, `packages/docs/package.json:3` → bump all to **`0.5.0`** for release
  coherence. (These do not feed `version --json`, but must match `VERSION` so the published release is
  internally consistent.)

> Verify at cutover that `version.ts` and all package.jsons agree on `0.5.0`, and that
> `rauf version --json` (run from the built `dist/`) reports `0.5.0`.

## 3. Documented contract (REQ-CONTRACT-03)

The new contract must be documented precisely enough for the FF update — the canonical definitions already
live in this spec suite; this section is the index FF (or any consumer) reads to update against:

| Contract surface | Normative source | What FF depends on |
|------------------|------------------|--------------------|
| **Exit-code table** | 00 §1 + §2 (also tech-spec §3.2) | `status --json` exit-code reads + any `loop run` exit branching |
| **Signal vocabulary** | 00 §3 (`done\|blocked\|needs_human\|review\|none`) | `signal_parsed.signal` value set if it inspects events |
| **events.ndjson version + shapes** | 00 §4 (`EVENTS_SCHEMA_VERSION="1"`, additive-only, shared `LoopEvent`) | reading the persisted/streamed log |
| **Removed / renamed commands** | 00 §5 (`loop start`→`loop run --detached`; `--watch`→`--follow`) | the stale `watch` token + ensuring no removed verbs are invoked |

These are documented in the rauf project specs at §6 (`docs/SPEC-BACKLOG-TOOL-CONTRACT.md`, `docs/SCHEMAS.md`,
`docs/SPEC-CLI.md`) — that is the contract FF is updated against.

## 4. feature-forge lockstep edits (REQ-CONTRACT-04)

feature-forge lives at **`/home/gary/workspace/feature-forge`** (current `main`, epic support merged via
PR #2 — the baseline to edit against). The concrete edits, with exact files and current values verified
2026-06-13:

### 4a. minRunnerVersion `0.2.0` → `0.5.0`

- **`references/forge-config-schema.json:140`** — `loopRunner.minRunnerVersion` schema **default**
  `"0.2.0"` → **`"0.5.0"`**. Also update its `description` at `:141` (currently: "0.2.0 is the first rauf
  release shipping `backlog validate` + schemaVersion…") to state that `0.5.0` is the unified
  command-grammar + exit-code contract release.
- **`skills/forge-5-loop/SKILL.md:83`** — the semver-gate default reference `(default `0.2.0`)` →
  `(default `0.5.0`)`. (Lines `:79/:89/:91` describe the gate mechanism generically and reference
  `{minRunnerVersion}` as a placeholder — no hardcoded value to change there, but re-read to confirm.)

### 4b. Remove/replace the stale `watch` token (REQ-FLAG-01, REQ-RMV-01)

`references/ralph-loop-contract.md` lists `watch` in the rauf monitoring surface. The current line is:

> **`references/ralph-loop-contract.md:51`** — `  status (+ `--json`) / list / watch / follow / log / version.`

Replace `watch` with `follow` (or drop it, since `follow` is already in the list) so the line reads e.g.
`status (+ `--json`) / list / follow / log / version.` — matching the v0.5.0 grammar where `--watch` is
removed. **Also reconcile lines 45–46**, which describe the watch surface:

> `references/ralph-loop-contract.md:45-46` — `  per-iteration telemetry with a `stuckWarning` flag
> (`loopRunner.watchCommand`, / rauf: `loop watch … --json`).`

The `watchCommand` config slot itself is a feature-forge concept (a configurable command template), not the
rauf `--watch` flag — but its **rauf default** (`loop watch … --json`) is the stale reference. This pairs
with the schema default at **`references/forge-config-schema.json:105`** (`watchCommand` default
`"{bin} loop watch . --backlog {backlogDir} --json"`). Confirm against the landed v0.5.0 CLI whether
`loop watch` still exists as a monitor verb; if the monitor surface is now `status --follow --json`
(REQ-FLAG-01/02), update the `watchCommand` default accordingly. *(Verify the landed `loop watch` status at
cutover — it is the one FF default whose rauf verb may have changed; the rest of the FF `loopRunner`
defaults invoke `loop run … --ndjson`, `status … --json`, `backlog list … --json`, `loop follow`,
`log … --follow`, `version --json` — none of which are removed verbs.)*

### 4c. Align the compatibility / changelog docs

- **`COMPATIBILITY.md`** — the matrix row pins **`0.2.0`** as "Min rauf version" (line `:16`) with the
  rationale text at lines `:22-23`. Add/adjust to **`0.5.0`** for the FF version that adopts the new
  contract, and update the "Notes"/rationale to reference the unified exit-code + grammar contract instead
  of "first release shipping `backlog validate` + schemaVersion".
- **`CHANGELOG.md`** — references the default `0.2.0` at lines `:20-21` and "rauf ≥ 0.2.0" at line `:44`.
  Add a changelog entry for the FF version that bumps `minRunnerVersion` to `0.5.0`, noting the rauf v0.5.0
  contract flip (removed `loop start`/`--watch`, unified exit codes, `review` signal).

### 4d. Re-validate the machine reads (no verb-invocation change)

- FF invokes the configurable `loopRunner.runCommand` — default
  **`{bin} loop run . --backlog {backlogDir} --iterations {iterations}`** (schema `:65`) and the
  event-stream **`eventStreamCommand`** (schema field `:68`) default `… --ndjson` (`:70`). **FF runs `loop run --ndjson`,
  NOT `loop start`** — so there are **no `loop start` invocations to change** in FF; the breaking surface for
  FF is the version gate (4a) + the exit-code/status reads + the stale `watch` token (4b).
- Re-validate FF's **`status --json`** read (default `{bin} status . --backlog {backlogDir} --json`, schema
  `:85`) and any exit-code assumptions against the unified scheme (00 §1/§2; REQ-EXIT-01). Confirm forge-5's
  supervision logic does not assume an old code value (e.g. the old `status` `1=running`, now `6=RUNNING`;
  old `3=needs_human` is now `3=NEEDS_HUMAN` — coincidentally aligned but verify the read).

## 5. Out-of-loop execution (REQ-CONTRACT-05)

feature-forge is a **separate git repository** (`/home/gary/workspace/feature-forge`) that sits **outside
the rauf loop's write sandbox** (rule: never write outside `ROOT_DIRECTORY` or `~/.rauf/`). Therefore:

- **The rauf autonomous loop CANNOT edit feature-forge.** Steps 1–6 of the change ordering (01 §3) are all
  inside the rauf repo and may be done by the loop; **the §4 feature-forge edits are an explicit out-of-loop
  step**, performed manually or in a separate feature-forge-rooted session at cutover.
- **The FF edits are gated as part of this feature's definition of done** (REQ-CONTRACT-04/05): the v0.5.0
  flip is **not complete** until both the rauf-side changes have landed (green gate) **and** the FF update
  (§4) has landed. A backlog item covering the rauf side may signal done, but the *feature* is not done
  until the out-of-loop FF step is also executed and verified (§Verification below).

## 6. Project spec docs (REQ-DOC-01) + CLI help (REQ-DOC-02)

### 6a. The 6 `docs/SPEC-*.md` to update (REQ-DOC-01, per tech-spec §3.8)

| Doc | Content to update |
|-----|-------------------|
| `docs/SPEC-CLI.md` | Remove the `loop start` section; document `loop run [--detached\|-d]` as the single execution verb (+ `--detached --follow` lifecycle); update the exit-code table(s) to 00 §1; confirm the `--follow`/`--json`/`--backlog`/`--interval` canon; document the REQ-RMV-01 remediation messages |
| `docs/SPEC-WEB.md` | Note `POST /api/projects/:id/loop/start` is now the **detached-run backend** (URL/contract unchanged), not a separate `loop start` verb |
| `docs/SPEC-BACKLOG-TOOL-CONTRACT.md` | Exit-code-space unification §; remove/fix the `review→done` collapse note (~lines 206-209); fix the signal-placement wording to match the scan-from-end parser (REQ-SIG-02); document the events.ndjson additive-only discipline (00 §4) |
| `docs/SCHEMAS.md` | Add `"review"` to the documented `signal_parsed.signal` enum; document the `EVENTS_SCHEMA_VERSION` versioning discipline (00 §4) |
| `docs/ARCHITECTURE.md` | Update the data-flow diagram/verbs to the new grammar (`loop run --detached`, no `loop start`) |
| `docs/SPEC-ARTIFACTS.md` | Remove/replace any `loop start` mention in the artifact templates (RAUF.md / addon) |

### 6b. CLI help / usage (REQ-DOC-02)

Top-level and per-command `--help`/usage strings (registered in `packages/cli/src/commands.ts`
`SubcommandDef`s) must reflect the new grammar: the single `loop run [--detached|-d]` verb, the removed
`loop start` / `--watch`, and the canonical `--follow`/`-f`, `--json`, `--backlog`, `--interval` flag set.
**No references to removed verbs/flags may remain anywhere in help/usage** — the **only** permitted mention
of `loop start` / `--watch` is inside the REQ-RMV-01 remediation messages (00 §5). *(Verify the exact help
rendering locus at impl — tech-spec §10 open question 2.)*

## 7. Safety & cutover sequencing (NFR-SAFETY-01, NFR-CUTOVER-01)

This feature rewrites the very `loop run` / `loop start` commands the runner invokes, so dogfooding must not
run the binary being rewritten (CANON §6.1):

- **Dogfood with frozen `rauf-stable`, mutate `dev rauf`.** `forge.config.json` already pins
  `loopRunner.bin = "rauf-stable"` — every implementing loop runs the frozen stable binary, never the dev
  binary whose command surface is under rewrite. **Never run an implementing loop with the dev `rauf`.**
- **Dev runner executes built `dist/`** (not `src/`) — rebuild (`pnpm build`) before testing runner/CLI
  edits or `rauf version --json` will report stale.
- **Per-phase isolation** (CANON §6.5): this feature has its own `--backlog` root and branch
  (`forge/ux-overhaul`-family), so the half-finished flip never contaminates the project's own self-hosting
  loop.

**Cutover sequence** (so self-hosting + FF stay coherent):

1. Land rauf-side steps 1–6 (01 §3) on the feature branch; full gate green (typecheck/lint/format/tests).
2. Bump `version.ts` + the 6 package.jsons to `0.5.0` (§2); `pnpm build`; verify `rauf version --json` →
   `0.5.0`.
3. Update the 6 `docs/SPEC-*.md` + CLI help (§6); confirm no stale removed-verb references.
4. **Out-of-loop FF step** (§4/§5): edit feature-forge (`minRunnerVersion`→`0.5.0`, `watch`→`follow`, align
   COMPATIBILITY/CHANGELOG, re-validate reads) in a separate FF-rooted session.
5. Refreeze `rauf-stable` from the new `0.5.0` build only after the flip is merged and verified — so the
   next feature dogfoods against a coherent v0.5.0 stable.

## Dependencies

- [`00-core-definitions.md`](./00-core-definitions.md) — the normative exit-code / signal / events /
  remediation contracts this cutover documents and version-gates.
- [`01-architecture-layout.md`](./01-architecture-layout.md) — the per-package change map and the change
  ordering; this doc is **step 7** of that graph.
- **All of `02-execution-grammar` / `03-exit-codes` / `04-signals-and-events` must land first** (green) —
  the cutover (version bump + FF update + docs) is the *last* step; it presupposes the rauf-side breaking
  changes are implemented and the full quality gate is green (NFR-QUALITY-01).

## Verification

- `packages/core/src/version.ts` `VERSION === "0.5.0"`; all 6 package.jsons `"version": "0.5.0"`;
  `rauf version --json` (from built `dist/`) reports `{ "version": "0.5.0" }`.
- feature-forge `references/forge-config-schema.json` `minRunnerVersion` default `= "0.5.0"`;
  `skills/forge-5-loop/SKILL.md` references `0.5.0`; `COMPATIBILITY.md` + `CHANGELOG.md` aligned to `0.5.0`.
- No `watch` token in `references/ralph-loop-contract.md` monitoring/CLI-verbs surface (line ~51 + 45-46
  reconciled); FF `watchCommand` default re-validated against the landed CLI.
- FF `status --json` / exit-code reads re-validated against the unified scheme (00 §1/§2); confirmed FF
  invokes `loop run … --ndjson`, not `loop start` (no removed-verb invocations).
- All 6 `docs/SPEC-*.md` updated to the new surface; CLI top-level + per-command `--help` has **no**
  `loop start` / `--watch` references except the REQ-RMV-01 remediation messages.
- The flip is one v0.5.0 release; the rauf-side gate is green AND the out-of-loop FF update has landed
  (feature not "done" until both — REQ-CONTRACT-05).
