# forge-skill-spec-purity — Technical Specification

> **Epic:** `agent-agnostic` · **Feature:** `forge-skill-spec-purity` · **Version:** 1
> **Target repo:** `feature-forge` (`/home/gary/workspace/feature-forge`) — per constraint **C-1**, all implementation lands there; this spec, the backlog, and the loop run from `rauf` (`specs/agent-agnostic/`).
> **Depends on:** none (epic root) · **Exposes:** `spec-pure-skills`, `portable-skill-root-resolver`

## 1. Overview

This feature is a **mechanical, behavior-preserving refactor** of the `feature-forge` skill suite (11 `SKILL.md` + their `references/`, the `agents/` definitions, and `scripts/`) into a vendor-neutral canonical source of truth that conforms to the Agent Skills frontmatter spec. It produces **no per-agent output** (REQ-SOT-02 / C-3); it establishes the canon every downstream epic feature consumes read-only.

Four concrete workstreams, each independently verifiable and each owning a slice of the §3 requirements:

1. **Frontmatter purity** (§3.1–3.2) — reduce every `SKILL.md` frontmatter to the spec-sanctioned key set; relocate `argument-hint` into `metadata`.
2. **Portable root resolution** (§3.3) — a single Bash resolver `scripts/forge-root.sh` plus a verbatim bootstrap prelude that replaces all canonical `${CLAUDE_PLUGIN_ROOT}` references.
3. **Body size discipline** (§3.4) — bring the three over-budget skills within a **≤300-line / ≤5,000-word** body budget by relocating overflow into each skill's `references/`.
4. **Verification + inventory** (§3.5–3.6) — a stdlib-only `scripts/check-spec-purity.py` that hard-gates the canon, wired into `validate.sh` + pytest, plus a documented vendor-construct inventory.

**Key architectural decisions (resolved in the interview):**

- **D1 — Body budget = ≤300 lines AND ≤5,000 words** (tightens OQ-1's provisional 500). Captures all three PRD-named skills (`forge-0-epic` 517, `forge-5-loop` 418, `forge-verify` 337); next-largest skill is `forge-2-tech` at 192, a safe margin.
- **D2 — Resolver = single Bash script + verbatim bootstrap prelude** (OQ-2). No Python twin — no `.py`/`.sh` script references the env var today (it is purely an invocation-layer concern), so a Python helper would add unused surface.
- **D3 — `hooks/hooks.json` left in place + documented** as an out-of-canon Claude artifact (OQ-3 / REQ-VND-04).
- **D4 — Checker = standalone stdlib-only `scripts/check-spec-purity.py`** wired into `validate.sh` and `tests/`, matching `epic-manifest.py`'s deliberate no-pyyaml convention.

> **Decision map (downstream specs cite against this):** D1 = body size · D2 = resolver · D3 = hooks.json · D4 = checker.

## 2. Module Structure

All paths relative to the `feature-forge` repo root.

```
feature-forge/
├── skills/<name>/SKILL.md       — 11 files: frontmatter reduced, argument-hint→metadata,
│                                   ${CLAUDE_PLUGIN_ROOT} routed through resolver, 3 bodies shrunk
│   └── <name>/references/        — overflow relocated here for the 3 oversized skills
├── agents/forge-verifier.md      — canonical surface: prose ${CLAUDE_PLUGIN_ROOT} reference rewritten
├── references/
│   ├── shared-conventions.md     — 2 resolver-routed invocations
│   ├── portable-root.md          — NEW: the canonical bootstrap-prelude snippet + usage doc (REQ-RES-05)
│   └── vendor-construct-inventory.md — NEW: audit output, every vendor construct + disposition (REQ-VND-03)
├── scripts/
│   ├── forge-root.sh             — NEW: portable resolver = exposed `portable-skill-root-resolver`
│   ├── check-spec-purity.py      — NEW: runnable spec-purity checker (REQ-VER-01)
│   ├── validate.sh               — extended: invoke check-spec-purity.py as a gate step
│   ├── epic-manifest.py          — UNCHANGED (does not reference the env var)
│   ├── session-check.sh, forge-init.sh, validate-traceability.py — UNCHANGED internals
├── hooks/hooks.json              — UNCHANGED (out-of-canon Claude artifact, documented)
└── tests/
    ├── test_check_spec_purity.py — NEW: pytest for the checker (follows conftest.py conventions)
    └── fixtures/                 — NEW: clean + impure skill-tree fixtures (clean-skills, bad-*, reader-*) for the checker test
```

**Executable bit (both new scripts):** `scripts/forge-root.sh` and `scripts/check-spec-purity.py` MUST be created mode `0755` (executable). The backlog item creating each must `chmod +x` it and confirm it is recognized by `validate.sh`'s permission-check step (add both to that step's script list if it is an explicit allow-list). Concrete failure mode if missed: the §3.2 bootstrap prelude gates discovery on `[ -x "$d/scripts/forge-root.sh" ]`, so a non-executable resolver is silently invisible — `$R` resolves empty and every skill invocation dies with "cannot locate plugin root" even though the file exists.

**Public API surface (the two exposed contracts):**

- **`spec-pure-skills`** (module) — the canonical `skills/*/SKILL.md` set + their `references/`, now spec-pure. Contract shape downstream relies on: each `SKILL.md` has frontmatter drawn only from `{name, description, license, compatibility, metadata, allowed-tools}`, with `name == <dir>`, and any Claude `argument-hint` preserved under `metadata.argument-hint`.
- **`portable-skill-root-resolver`** (function) — `scripts/forge-root.sh`, a self-contained script that prints the absolute plugin root to stdout (exit 0) or an actionable error to stderr (exit ≠0). Copy-verbatim into per-agent script mirrors by the downstream generator (REQ-RES-05).

## 3. Technical Decisions

### 3.1 Frontmatter Reduction & Vendor-Key Relocation (REQ-FM-01..04, REQ-VND-01)

**Audit result (verified across all 11 skills):** frontmatter today contains only `name`, `description`, and — in 10 of 11 — `argument-hint`. `forge-init` has no `argument-hint`. No `license`/`compatibility`/`metadata`/`allowed-tools` exist yet. `name == <dir>` already holds everywhere (REQ-FM-02 is already satisfied; the checker enforces it).

**Transformation (per skill that declares `argument-hint`):**

```yaml
# before
name: forge-1-prd
description: "…"               # preserved VERBATIM (REQ-FM-03)
argument-hint: "<feature-name>"
# after
name: forge-1-prd
description: "…"
metadata:
  argument-hint: "<feature-name>"
```

- The `metadata` map is the spec-sanctioned home for vendor data (C-2). `argument-hint`'s value is moved unchanged (REQ-VND-01).
- Description text is **never** altered (REQ-FM-03). Frontmatter must remain parseable (REQ-FM-04) — verified structurally by the checker.
- **No other vendor key exists in any frontmatter** (audit-confirmed), so REQ-VND-02 is a contingency: if the exhaustive audit (REQ-VND-03) surfaces any vendor *invocation directive* in a body, it is relocated/removed and recorded in the inventory. None expected.

### 3.2 Portable Script-Root Resolver (REQ-RES-01..05, REQ-SEC-01)

**Problem shape (verified):** `${CLAUDE_PLUGIN_ROOT}` appears **only** in markdown bodies, `references/`, `agents/`, and `hooks.json` — **never inside a `.py` or `.sh` script**. Every canonical use is of the form `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/<x>"` (or `bash …`): the variable's sole job is to **name a bundled script's path for invocation**. The scripts themselves operate on the user's CWD and need no root. So the fix is entirely at the **invocation layer**.

**`scripts/forge-root.sh` — resolution order (REQ-RES-02, exact order):**

1. **Self-location** — `dir = realpath(dirname(BASH_SOURCE[0])/..)`; if `is_root(dir)` → print, exit 0. Works under any agent's install layout once the script is reachable.
2. **Candidate-root probe** — iterate a maintained list of known install roots (Claude dev symlink `~/.claude/skills/feature-forge`, Claude plugin installs `~/.claude/plugins/*/feature-forge`, and forward per-agent dirs); first `is_root(c)` → print, exit 0.
3. **Env fallback** — if `${CLAUDE_PLUGIN_ROOT}` is set and `is_root`, print, exit 0. **This is the single sanctioned residual occurrence of the variable in the whole canon** (REQ-RES-03).
4. **Failure** — actionable message to stderr, exit 1 (REQ-RES-04): `feature-forge: cannot locate plugin root. Set CLAUDE_PLUGIN_ROOT or run from an installed skill dir.`

`is_root(d)` = sentinel test (`[ -f "$d/scripts/epic-manifest.py" ] && [ -f "$d/.claude-plugin/plugin.json" ]`). Resolution is **bounded** to candidate roots + the script's own location and never sources/executes a discovered path (REQ-SEC-01) — it only prints a directory.

**Bootstrap prelude (the verbatim reusable unit, REQ-RES-05, documented in `references/portable-root.md`):** Because the agent runs each fenced code block as a *separate* shell with no persisted state, the root must be resolved **within the same block** as each script call. The prelude is a fixed, byte-identical 2-line form prepended to each invocation block:

```bash
R="$(for d in "$HOME"/.claude/skills/feature-forge "$HOME"/.claude/plugins/*/feature-forge; do [ -x "$d/scripts/forge-root.sh" ] && exec "$d/scripts/forge-root.sh"; done)"
[ -n "$R" ] || { echo "feature-forge: cannot locate plugin root" >&2; exit 1; }
# …then:  python3 "$R/scripts/epic-manifest.py" <subcommand> …
```

- The prelude probes **paths** (not the forbidden env var) to locate `forge-root.sh`, then delegates final resolution to it. It contains **no** `${CLAUDE_PLUGIN_ROOT}`, satisfying REQ-RES-03.
- The prelude's candidate set covers the only current consumer (Claude, dev-symlink + plugin install). It is extended as per-agent install dirs land downstream; the **resolver** is the portable authority.
- **Maintainability (REQ-MAINT-01):** the prelude is a single canonical string defined once in `references/portable-root.md`; the checker asserts each occurrence is byte-identical, so it can never drift.
- **First-discoverable-resolver-wins (invariant — do not "fix" the loop):** the `exec` inside the `$(…)` command substitution means the prelude stops at the **first** directory containing an executable `forge-root.sh` and delegates ALL final root resolution to that script (which performs the real multi-candidate probe per §3.2 step 1–4). The prelude's `for` list is a *discovery order for `forge-root.sh` itself*, not a fallback chain for the plugin root — once `exec`'d, the loop never advances to a second candidate. Removing the `exec` to "keep looping" would be a regression.
- **Single-source candidate-list maintenance (TQ-1):** `forge-root.sh` step 2 is the **authoritative** candidate-root list; the prelude's `for d in …` set is intentionally a minimal `$HOME`-Claude bootstrap subset whose only job is to locate `forge-root.sh`. When adding an install root, update `forge-root.sh` first; extend the prelude **only** if the new root is needed to bootstrap-discover `forge-root.sh` itself. The checker guards prelude byte-identity across occurrences (REQ-MAINT-01) but does **not** assert prelude-set ⊆ resolver-set — that subset relationship remains a manual-review item (revisit in `cross-agent-installer`).

**Replacement scope — 23 canonical occurrences across 9 files (grep-verified; do not trust counts, re-grep at impl time):**

| File | Count | Kind |
|---|---|---|
| `skills/forge-0-epic/SKILL.md` | 12 | 11 invocations + 1 prose (line ~44) |
| `skills/forge/SKILL.md` | 3 | invocations |
| `skills/forge-5-loop/SKILL.md` | 1 | invocation |
| `skills/forge-6-docs/SKILL.md` | 1 | invocation |
| `skills/forge-init/SKILL.md` | 1 | `bash` invocation |
| `skills/forge-verify/SKILL.md` | 1 | invocation |
| `skills/forge-verify/references/verification-checklists.md` | 1 | invocation |
| `references/shared-conventions.md` | 2 | invocations |
| `agents/forge-verifier.md` | 1 | prose (line ~104) |

Invocations → prelude + `"$R/scripts/…"`. Prose mentions → rewritten to describe the portable resolver instead of the env var. **Exempt:** `hooks/hooks.json` (1, non-canonical, REQ-VND-04) and the sanctioned residual inside `forge-root.sh`. Out-of-scope entirely: `specs/`, `plans/`, `docs/` (feature-forge's own forge artifacts, not shipped skill canon).

### 3.3 Body Size Discipline (REQ-SIZE-01..03, D1)

**Binding budget: a `SKILL.md` body (content below the closing frontmatter `---`) MUST NOT exceed 300 lines OR 5,000 words, whichever is hit first.** This *tightens* OQ-1's provisional 500/5,000 (permitted; never loosened).

| Skill | Body lines | Body words | Action |
|---|---|---|---|
| forge-0-epic | 517 | 3,594 | **reduce** (lines bind) |
| forge-5-loop | 418 | 3,415 | **reduce** (lines bind) |
| forge-verify | 337 | 2,451 | **reduce** (lines bind) |
| forge-2-tech | 192 | 1,769 | ok |
| forge-6-docs | 171 | 1,184 | ok |
| forge | 153 | 1,260 | ok |
| forge-3-specs | 148 | 1,505 | ok |
| forge-4-backlog | 140 | 1,428 | ok |
| forge-1-prd | 115 | 1,307 | ok |
| forge-fix | 59 | 518 | ok |
| forge-init | 22 | 82 | ok |

Body counts above are authorship-time measurements; the checker re-measures at gate time, so the gate — not this table — is authoritative (cf. §3.2 "do not trust counts, re-grep at impl time").

**Reduction method (REQ-SIZE-02):** relocate overflow detail into each skill's `references/`, leaving an explicit in-body pointer so the agent can still find it. Content is **moved, never deleted**. Candidate relocations (final selection at spec/impl stage):
- `forge-0-epic`: the per-subcommand `epic-manifest.py` reference tables and edit-mode mechanics → `references/`.
- `forge-5-loop`: detailed runner/loop-contract prose and model-precedence detail → `references/`.
- `forge-verify`: per-stage check detail → its existing `references/verification-checklists.md` (already present).
The prelude additions (§3.2) slightly grow bodies; reduction targets must account for them so the final state passes the gate.

### 3.4 Spec-Purity Checker (REQ-VER-01..03, REQ-OBS-01, D4)

`scripts/check-spec-purity.py` — **pure Python stdlib, no pyyaml** (matches `epic-manifest.py`; pyyaml is not guaranteed in CI/other-agent environments). Frontmatter parsed by a minimal hand-rolled reader: a line at column 0 matching `^[A-Za-z][\w-]*:` is a top-level key; indented lines are values/nested (so `metadata:`'s nested `argument-hint` is **not** mistaken for a disallowed top-level key). **Documented reader assumptions** (code to this contract, not to an example): only column-0 `key:` lines are treated as top-level keys; continuation lines, indented lines, and quoted/folded scalar *values* (including a `description` whose value contains a colon, or a `>` / `|` block scalar) are **not** re-scanned for keys. A frontmatter block the reader cannot parse into a well-formed key set is itself a reported violation (REQ-FM-04), never a crash.

**Rules enforced (each violation → `file: reason`):**

1. Frontmatter top-level keys ⊆ `{name, description, license, compatibility, metadata, allowed-tools}`; `name` + `description` present (REQ-FM-01); frontmatter block well-formed (REQ-FM-04).
2. `name` value == containing directory name (REQ-FM-02).
3. Zero `${CLAUDE_PLUGIN_ROOT}` in canonical doc surfaces: `skills/**/SKILL.md`, `skills/**/references/**`, top-level `references/**`, `agents/*.md`. Excluded from scan: `scripts/forge-root.sh` (sanctioned residual), `hooks/hooks.json`, `specs/`, `plans/`, `docs/` (REQ-RES-03).
4. Body size ≤ 300 lines AND ≤ 5,000 words (REQ-SIZE-03) — **hard fail** when exceeded.
5. (REQ-RES-05 guard) bootstrap-prelude occurrences are byte-identical to the canonical snippet.

**Behavior:** human-readable summary (counts + per-violation `file: reason`), exit **0** when clean, **non-zero** when any violation (REQ-VER-02, REQ-OBS-01). Runnable standalone (`python3 scripts/check-spec-purity.py [--root DIR]`) so `packaging-docs-ci` wires it verbatim. Wired into `validate.sh` as a new **top-level** step inserted after the script-permission step and **before** the `if [ -f "$HELPER" ]` epic-manifest guard — *outside* that guard, since `py_compile` and `pytest` are both nested inside it; placing the checker "between py_compile and pytest" would skip the gate whenever `epic-manifest.py` is absent. As a top-level step it runs **unconditionally** (python3 stdlib only, always available) and any non-zero exit fails `validate.sh` immediately under `set -e` — it is **never** soft-skipped, unlike the `pytest` step. Covered by `tests/test_check_spec_purity.py`. The feature's completion gate is this checker running **green against the final state of all 11 skills** (REQ-VER-03).

### 3.5 Vendor-Construct Inventory (REQ-VND-03)

`references/vendor-construct-inventory.md` — a table listing every vendor-specific construct found in the audit with its disposition (`relocated` / `removed` / `preserved-as-spec-allowed` / `out-of-canon`). Known entries: `argument-hint` ×10 (relocated→`metadata`), `${CLAUDE_PLUGIN_ROOT}` ×23 canonical (routed-through-resolver) + ×1 sanctioned residual + ×1 `hooks.json` (out-of-canon), `hooks/hooks.json` SessionStart wiring (out-of-canon, preserved + documented).

### 3.6 Internal Consistency (REQ-SOT-01..03)

After the refactor, `skills/*/SKILL.md` + `references/` + `forge-root.sh` are the single canonical source (REQ-SOT-01). No per-agent output is produced (REQ-SOT-02). Cross-references must still resolve and no skill may point to a single-agent-only path (REQ-SOT-03) — relocated content keeps working in-body pointers; verified by manual review + the checker's no-residual-var rule.

## 4. Data Model

No persistent data model. The only structured artifact is **`SKILL.md` frontmatter**, a YAML map constrained to:

```
name:           string (required, == dir name)
description:    string (required, verbatim)
license:        string (optional)
compatibility:  string|map (optional)
metadata:       map (optional)  →  metadata.argument-hint: string (relocated)
allowed-tools:  string|list (optional)
```

The checker treats this as its schema. No JSON schema file is added (the constraint is small and codified in the checker).

## 5. API Design

Two script CLIs (the only programmatic interfaces):

- **`scripts/forge-root.sh`** — `forge-root.sh` (no args). stdout: absolute root (exit 0). stderr + exit 1: actionable error. Idempotent, side-effect-free.
- **`scripts/check-spec-purity.py`** — `check-spec-purity.py [--root DIR]` (default: repo root derived from `__file__`). stdout: human-readable report. Exit 0 clean / non-zero on violations.

Skill bodies consume `forge-root.sh` only through the documented bootstrap prelude (§3.2).

## 6. Integration Points

**Depends on (existing, in feature-forge):**
- `scripts/epic-manifest.py` — invoked by bodies via the resolver. Its subcommands (`resolve`, `validate`, `render-status`, `check-name`, `add-feature`, `remove-feature`, `reorder`, `set-dep`, `set-status`) and exit-code contract (0/1/2) are **unchanged**; only the path-naming in callers changes. Verified: it does not reference `${CLAUDE_PLUGIN_ROOT}`.
- `scripts/validate.sh` — extended with a `check-spec-purity.py` step inserted as a **top-level** step after the script-permission step and **before** the `if [ -f "$HELPER" ]` epic-manifest guard (outside that guard — `py_compile` and `pytest` are both nested inside it). The step runs unconditionally and a non-zero exit fails the script immediately (`set -e`); it is a hard gate and is **never** soft-skipped (unlike `pytest`, which may no-op when absent).
- `scripts/{session-check.sh, forge-init.sh, validate-traceability.py}` — located via the resolver from bodies/hooks; internals unchanged.
- `tests/` (pytest + `conftest.py` fixtures: `fixture_copy`, `run_cli`, importlib module loader for hyphenated filenames) — the new test follows these conventions: a subprocess runner over `check-spec-purity.py` against clean + impure fixture trees, asserting exit code + reported violations; optional in-process import of the hyphenated script via `importlib`.
- `.claude-plugin/plugin.json` + `marketplace.json` — **not modified**; plugin must remain loadable (REQ-COMPAT-02). (Note: a pre-existing version mismatch — manifest `0.10.0` vs marketplace entry `0.9.0` — is **out of scope** here; flag for `packaging-docs-ci`.)
- `hooks/hooks.json` — **not modified**; documented as out-of-canon (REQ-VND-04).

**Consumed by (downstream, read-only — this feature only *exposes*):**
- `forge-agent-adapters-build` consumes `spec-pure-skills` (canonical frontmatter incl. `metadata.argument-hint` to reconstruct Claude-native output losslessly) and `portable-skill-root-resolver` (copied verbatim into per-agent script mirrors).
- `packaging-docs-ci` consumes `spec-pure-skills` and wires `check-spec-purity.py` into CI.

**Conflict check:** no in-progress feature touches `feature-forge/skills` (the only other active epic feature in this repo, `rauf-agent-cli-adapters`, is complete and targets `rauf`). No conflict. **No missing exports** — every referenced script/export was located in source; no `WARNING` items.

## 7. Error Handling

- **Resolver failure** → actionable stderr message + non-zero exit (REQ-RES-04); the bootstrap prelude's `[ -n "$R" ]` guard surfaces it rather than running with an empty path.
- **Checker** → per-violation `file: reason` to stdout + non-zero exit (REQ-VER-02). Malformed frontmatter is itself a reported violation (REQ-FM-04), not a crash.
- **Path safety** → resolver bounded to candidate roots + own location; never sources/executes discovered paths (REQ-SEC-01).
- Bash scripts use `set -euo pipefail` (existing convention). No `Result`-type concern (this is shell/Python tooling, not the TS core).

## 8. Testing Approach

- **`tests/test_check_spec_purity.py`** (pytest, new) — fixtures for a clean skill tree (exit 0) and impure trees exercising each rule: disallowed key, missing `name`/`description`, `name != dir`, residual `${CLAUDE_PLUGIN_ROOT}`, over-budget body, drifted prelude. Asserts exit code + that the offending file/reason appears. For the prelude byte-identity rule (§3.4 rule 5), test **both directions**: a clean fixture with identical preludes passes, AND a drifted-prelude fixture fails with the offending file/reason reported. **Reader-robustness fixtures** (frontmatter parser hardening): a `description` whose value contains a colon and/or is a quoted/folded scalar (`description: "foo: bar"`, `description: >`), a frontmatter block with blank lines, and a CRLF file — each asserting the reader extracts the correct top-level key set (no false positive flagging a legal value as a disallowed key; no false negative missing a malformed block). Follows `conftest.py` patterns (subprocess runner; importlib for the hyphenated filename).
- **`scripts/forge-root.sh`** — **required** automated coverage (not optional): a shell/bats or pytest-driving-subprocess test asserting (a) exit 0 + correct stdout when invoked from inside an install dir, (b) exit 1 + the exact stderr message when no root is discoverable and `CLAUDE_PLUGIN_ROOT` is unset (REQ-RES-04), and (c) the env-fallback success path (REQ-RES-03). If a fully-automated resolver test proves infeasible in CI, state that explicitly and define the manual smoke steps as the gate instead — do not leave coverage merely "optional." Primary additional signal remains the live checker + behavioral smoke test under Claude (REQ-COMPAT-03).
- **Completion gate (REQ-VER-03):** `check-spec-purity.py` green against all 11 final skills, and `bash scripts/validate.sh` passes end-to-end.
- **Behavioral preservation (REQ-COMPAT-01):** manual smoke — load the plugin in Claude Code, confirm all 11 skills still trigger (descriptions untouched) and that `forge-init` / `epic-manifest.py`-backed flows run via the resolver.

## 9. Dependencies

- **No new runtime dependencies.** Checker is Python-3 stdlib only (no pyyaml); resolver is Bash. Matches existing toolchain (C-5).
- **Dev/CI:** `pytest` (already used; non-fatal if absent per `validate.sh`).
- **Internal:** the canon's own `epic-manifest.py` (unchanged) and `validate.sh` (extended).

## 10. Open Technical Questions

All PRD open questions are resolved:

- **OQ-1 → D1:** body budget set to **≤300 lines / ≤5,000 words** (tightened, captures all three named skills).
- **OQ-2 → D2:** **single Bash resolver + verbatim bootstrap prelude**; no Python twin (no current consumer needs it).
- **OQ-3 → D3:** **`hooks.json` left in place + documented** as out-of-canon.

Remaining (deferred, low-risk, non-blocking):
- **TQ-1:** the bootstrap prelude's candidate-root list duplicates the resolver's probe paths (inherent to the bootstrap; checker-guarded for identity). Accepted; revisited when per-agent install dirs land in `cross-agent-installer`.
- **TQ-2:** exact line-by-line relocation split for the three oversized skills is finalized at forge-3-specs / during implementation, constrained only by the ≤300/≤5,000 gate.
```