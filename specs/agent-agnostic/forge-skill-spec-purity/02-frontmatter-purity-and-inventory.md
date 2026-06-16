# 02 — Frontmatter Purity & Vendor-Construct Inventory

> Feature: `forge-skill-spec-purity` (epic `agent-agnostic`, target repo **feature-forge**).
> Source of truth: `PRD.md` (v1) §3.1–§3.2 + `tech-spec.md` (v1) §3.1, §3.5. This document specifies
> the **data side** of frontmatter spec-purity: the audit of the current `SKILL.md` frontmatter, the
> exact `argument-hint → metadata.argument-hint` relocation transformation, the contingency handling
> of any further vendor invocation directive, the disposition of the out-of-canon Claude hook wiring,
> and the full specification of the deliverable `references/vendor-construct-inventory.md`. Shared
> constants, the allowed-key schema, the frontmatter-reader contract, and the disposition vocabulary
> all live in `00-core-definitions.md` and are **referenced, not redefined**, here.
>
> **Stack note:** the configured `stack` is `typescript`, but this feature ships **Bash + Python 3
> (stdlib only) + Markdown** — there is no TypeScript. All shapes below are exact YAML / Markdown,
> matching the existing `SKILL.md` frontmatter style (double-quoted `description` value).

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-FM-01 | Frontmatter top-level keys ⊆ spec-sanctioned set | §1 (audit), §2 (transformation) |
| REQ-FM-02 | `name` == containing directory name | §1 (audit confirms already-satisfied) |
| REQ-FM-03 | `description` preserved verbatim | §2 (transformation invariant) |
| REQ-FM-04 | Frontmatter remains valid/parseable YAML | §2 (post-shape), enforced by checker — cross-ref `05` |
| REQ-VND-01 | `argument-hint` relocated under `metadata` | §2 (transformation) |
| REQ-VND-02 | Other vendor directive removed/relocated (contingency) | §3 |
| REQ-VND-03 | Exhaustive inventory with dispositions | §5 (the deliverable) |
| REQ-VND-04 | `hooks/hooks.json` left in place + documented out-of-canon | §4, §5 (inventory row) |
| REQ-SOT-03 (frontmatter slice) | No frontmatter points to a single-agent-only path | §2, §3 |

## 1. The Audit — Current Frontmatter State (REQ-FM-01, REQ-FM-02)

The exhaustive audit (REQ-VND-03) of the 11 `skills/*/SKILL.md` frontmatter blocks, read directly
from the `feature-forge` working tree, yields the following. This is the **starting state** the
transformation in §2 acts on. (Confirmed by reading the first 8 lines of each file; line counts in
the body-size column are advisory only — the checker re-measures at gate time, see
`04-body-size-discipline.md`.)

| Skill (`skills/<name>/`) | `name` | `description` | `argument-hint` | Other top-level keys | `name == <dir>`? |
|---|:---:|:---:|:---:|---|:---:|
| `forge` | yes | yes | yes | none | yes |
| `forge-0-epic` | yes | yes | yes | none | yes |
| `forge-1-prd` | yes | yes | yes | none | yes |
| `forge-2-tech` | yes | yes | yes | none | yes |
| `forge-3-specs` | yes | yes | yes | none | yes |
| `forge-4-backlog` | yes | yes | yes | none | yes |
| `forge-5-loop` | yes | yes | yes | none | yes |
| `forge-6-docs` | yes | yes | yes | none | yes |
| `forge-fix` | yes | yes | yes | none | yes |
| **`forge-init`** | yes | yes | **NO** | none | yes |
| `forge-verify` | yes | yes | yes | none | yes |

**Audit conclusions** (each traces to a requirement):

1. **`argument-hint` is the only vendor-specific top-level key present**, and it appears in **10 of
   11** skills. `forge-init` is the lone skill **without** `argument-hint` — its frontmatter is
   already pure (only `name` + `description`). This is the audited basis for REQ-VND-01 ("for every
   skill that currently declares it") and is verified against `tech-spec.md §3.1`.
2. **No `license` / `compatibility` / `metadata` / `allowed-tools` exists yet** in any frontmatter.
   This feature adds **none** of these except the `metadata` map that hosts the relocated
   `argument-hint` (§2). After the transformation, every top-level key is a member of
   `ALLOWED_FRONTMATTER_KEYS` (`00-core-definitions.md §1`) — satisfying REQ-FM-01.
3. **`name == <dir>` already holds for all 11 skills** (REQ-FM-02 is already satisfied in the
   starting state). The transformation does **not** touch `name`; the checker (`05`) enforces the
   invariant so it cannot regress.
4. **No Codex / Copilot / Cursor / Gemini invocation directive** appears in any frontmatter block.
   The only vendor constructs in scope across the suite are: `argument-hint` (this doc, §2),
   `${CLAUDE_PLUGIN_ROOT}` (owned by `03-portable-root-resolver.md`), and the Claude `hooks/hooks.json`
   wiring (§4). This is the audited basis for treating REQ-VND-02 as a **contingency** (§3).

**Argument-hint values (verbatim, for the inventory and for §2's per-skill relocation):**

| Skill | Current `argument-hint` value (preserved unchanged on relocation) |
|---|---|
| `forge` | `"<feature-name> (optional — lists all active features if omitted)"` |
| `forge-0-epic` | `"<epic-name>"` |
| `forge-1-prd` | `"<feature-name>"` |
| `forge-2-tech` | `"<feature-name>"` |
| `forge-3-specs` | `"<feature-name>"` |
| `forge-4-backlog` | `"<feature-name>"` |
| `forge-5-loop` | `"<feature-name>"` |
| `forge-6-docs` | `"<feature-name>"` |
| `forge-fix` | `"<feature-name>"` |
| `forge-verify` | `"<feature-name> [stage: prd\|tech\|specs\|backlog\|impl]"` |

> The `forge-verify` value contains a literal `|` (pipe); it is YAML-safe as a double-quoted scalar
> and MUST be moved byte-for-byte. The `forge` value contains an em-dash and parenthetical; likewise
> preserved verbatim. No value is rewritten — only its *position* in the frontmatter map changes
> (REQ-VND-01).

## 2. The Frontmatter-Reduction Transformation (REQ-FM-01, REQ-FM-03, REQ-VND-01)

The single transformation this feature performs on frontmatter is: **move the top-level
`argument-hint` key into a `metadata` map as `metadata.argument-hint`, value unchanged**. The
`metadata` map is the spec-sanctioned home for vendor data (constraint **C-2**;
`00-core-definitions.md §1`). This is a **mechanical, one-concern-per-change** edit (REQ-MAINT-01).

### 2.1 Exact before/after (skill that declares `argument-hint`)

Worked example for `forge-1-prd` (the same shape applies to all 10 skills that declare
`argument-hint`; substitute that skill's verbatim value from §1):

```yaml
# ── before ──────────────────────────────────────────────
---
name: forge-1-prd
description: "Create a requirements PRD for a feature through structured interview. Use when user runs /feature-forge:forge-1-prd or explicitly asks to start the forge pipeline for a new feature. Do NOT trigger for general requirements discussions, project scoping outside forge, or PRD questions unrelated to the forge pipeline."
argument-hint: "<feature-name>"
---
```

```yaml
# ── after ───────────────────────────────────────────────
---
name: forge-1-prd
description: "Create a requirements PRD for a feature through structured interview. Use when user runs /feature-forge:forge-1-prd or explicitly asks to start the forge pipeline for a new feature. Do NOT trigger for general requirements discussions, project scoping outside forge, or PRD questions unrelated to the forge pipeline."
metadata:
  argument-hint: "<feature-name>"
---
```

### 2.2 Transformation invariants

Each invariant traces to a requirement and is asserted by the checker (`05-spec-purity-checker.md`):

- **`name` unchanged** — the `name` line is not edited; `name == <dir>` continues to hold
  (REQ-FM-02). Confirmed already-satisfied in §1.
- **`description` byte-identical** — the `description` value is **never** altered: not reflowed, not
  re-quoted, not re-indented (REQ-FM-03). It stays a double-quoted scalar on its own line, exactly
  as authored. A `description` whose value contains a colon or other punctuation is left untouched;
  the frontmatter reader (`00-core-definitions.md §4`) does not mistake an in-value colon for a key.
- **`argument-hint` value byte-identical, position changed** — the value moves verbatim from the
  top-level key to `metadata.argument-hint` (REQ-VND-01). The nesting is **2-space-indented** under
  `metadata:` so the reader treats `argument-hint` as a nested key, **not** a disallowed top-level
  key (`00-core-definitions.md §4` reader contract).
- **Only allowed top-level keys remain** — after the move, the top-level key set is exactly
  `{name, description, metadata}` ⊆ `ALLOWED_FRONTMATTER_KEYS` (`00-core-definitions.md §1`),
  satisfying REQ-FM-01. No new optional key (`license`, `compatibility`, `allowed-tools`) is added.
- **Frontmatter stays valid YAML** — the result parses without error (REQ-FM-04); structurally
  verified by the checker (delegated — see `05-spec-purity-checker.md §2` for the reader; the rule
  is enumerated there as rule 1 / `FRONTMATTER_KEYS`).
- **No frontmatter key references a single-agent-only path** — `metadata.argument-hint` is a
  spec-allowed location available to any agent; nothing in the post-refactor frontmatter points to a
  Claude-only path (the frontmatter slice of REQ-SOT-03).

### 2.3 The `forge-init` exception (no frontmatter change)

`forge-init` declares **no** `argument-hint` (§1). Its frontmatter is **already pure** — top-level
keys are exactly `{name, description}`. Therefore:

- **`forge-init`'s frontmatter receives NO edit under this document.** It gains no `metadata` map; it
  is not given an empty `metadata:` block. Adding one would be a non-mechanical, unjustified change
  (REQ-MAINT-01) and is explicitly out of scope.
- `forge-init` **does** receive a body edit under `03-portable-root-resolver.md` (its single `bash
  ${CLAUDE_PLUGIN_ROOT}/scripts/forge-init.sh` invocation is routed through the resolver), but that
  is a *body* change, not a *frontmatter* change, and is owned by `03`, not this document.

> Net frontmatter effect of this document: **10 SKILL.md frontmatter blocks edited** (the
> `argument-hint` → `metadata.argument-hint` relocation), **1 unchanged** (`forge-init`).

## 3. REQ-VND-02 Contingency — Other Vendor Invocation Directives

REQ-VND-02 requires that **any other vendor-only directive** discovered during the audit be removed
from the canonical `SKILL.md` body/frontmatter and either relocated to a non-canonical location or
documented as belonging to a later per-agent adapter.

**Audit result:** as of authoring, the exhaustive scan (§1) found **no** vendor *invocation
directive* in any skill body or frontmatter — no Codex/Copilot/Cursor/Gemini run-this directive, no
agent-specific command block. The only vendor constructs present are:

1. `argument-hint` — handled by REQ-VND-01 (§2 of this document);
2. `${CLAUDE_PLUGIN_ROOT}` — handled by REQ-RES-03, owned by `03-portable-root-resolver.md` (the
   prelude + `forge-root.sh` resolver), recorded in the inventory (§5) with disposition
   `routed-through-resolver`;
3. the Claude `hooks/hooks.json` wiring — handled by REQ-VND-04 (§4).

Therefore **REQ-VND-02 is a contingency**, not an action item, in the current tree.

**Contingency procedure (binds IF the exhaustive audit, REQ-VND-03, surfaces such a directive):**

- The directive MUST be **removed** from the canonical `SKILL.md` body or frontmatter (canonical
  surfaces per `00-core-definitions.md §6`).
- It MUST then be **either** relocated to a clearly non-canonical location (the precedent is
  `hooks/hooks.json` — §4) **or** documented as belonging to the downstream per-agent adapter build
  (`forge-agent-adapters-build`), never silently deleted (no functioning Claude behavior is removed;
  cf. REQ-VND-04).
- It MUST be **recorded as a new row** in `references/vendor-construct-inventory.md` (§5) with a
  disposition drawn from the `Disposition` vocabulary in `00-core-definitions.md §8` — typically
  `removed` (if deleted from canon and reconstructed downstream) or `out-of-canon` (if left in a
  non-canonical location like `hooks.json`).

> The `${CLAUDE_PLUGIN_ROOT}` handling — the canonical surface where it appears, the prelude
> replacement, and the resolver — is **not** specified here; see `03-portable-root-resolver.md`. This
> document only records its inventory disposition (§5). The disposition vocabulary itself is
> `00-core-definitions.md §8`.

## 4. REQ-VND-04 — `hooks/hooks.json` Left In Place, Documented Out-of-Canon

`hooks/hooks.json` wires a Claude `SessionStart` hook that runs `bash
${CLAUDE_PLUGIN_ROOT}/scripts/session-check.sh`. This is **Claude-specific** plugin behavior
(decision **D3** in `tech-spec.md §1`; OQ-3 resolved to "leave + document").

Per REQ-VND-04, this feature MUST NOT delete functioning Claude behavior. The disposition is:

- **`hooks/hooks.json` is left unchanged** — no edit to the file. (It is marked `· UNCHANGED` in
  `01-architecture-layout.md §2`.) Its single `${CLAUDE_PLUGIN_ROOT}` occurrence is **exempt** from
  the residual-var rule (`00-core-definitions.md §6`, `RESIDUAL_VAR_EXEMPT`) — it is not a canonical
  surface, so REQ-RES-03 does not apply to it.
- **It is documented as out-of-canon** in `references/vendor-construct-inventory.md` (§5), so the
  downstream adapter build (`forge-agent-adapters-build`) treats it as a Claude artifact rather than
  portable canon.

> This document does **not** edit `hooks/hooks.json`. The only action REQ-VND-04 imposes on *this*
> document is the inventory row (§5). The file's untouched-but-load-bearing status is recorded in
> `01-architecture-layout.md §3`.

## 5. The Deliverable — `references/vendor-construct-inventory.md` (REQ-VND-03)

This feature produces a new reference file, `references/vendor-construct-inventory.md` (relative to
the `feature-forge` repo root; located per `01-architecture-layout.md §2`). It is the documented,
exhaustive audit output required by REQ-VND-03 — the single record of every vendor-specific
construct found across all 11 skills and their `references/`, each with its disposition.

### 5.1 Required structure

The file MUST contain, in order:

1. **A title + provenance blockquote** — naming the feature, the source-of-truth (PRD v1 +
   tech-spec v1), and a one-line statement that this is the REQ-VND-03 audit output.
2. **A disposition legend** — the closed `Disposition` vocabulary from `00-core-definitions.md §8`,
   reproduced so the file is self-contained for a downstream reader:
   `relocated`, `removed`, `preserved-as-spec-allowed`, `out-of-canon`, `routed-through-resolver`.
   Each disposition value used in the table MUST be a member of this set (no free-form dispositions).
3. **The inventory table** — one row per distinct vendor construct (grouped by construct + surface
   class), with the columns specified in §5.2.
4. **A short notes section** — recording, at minimum: that no Codex/Copilot/Cursor/Gemini invocation
   directive was found (the REQ-VND-02 contingency did not fire), and a pointer to
   `03-portable-root-resolver.md` for the `${CLAUDE_PLUGIN_ROOT}` relocation mechanics and to
   `00-core-definitions.md §8` for the disposition vocabulary.

### 5.2 Required columns

| Column | Meaning |
|---|---|
| **Construct** | The vendor-specific construct (e.g. `argument-hint`, `${CLAUDE_PLUGIN_ROOT}`, `hooks/hooks.json` SessionStart wiring). |
| **Locations / count** | Where it appears and how many occurrences (file globs or specific files; the count). Counts are grep-derived at authorship time; the checker / a re-grep is authoritative. |
| **Disposition** | Exactly one value from the `Disposition` enum (`00-core-definitions.md §8`). |
| **Rationale / notes** | Why this disposition; the requirement it traces to; the spec-allowed destination (if relocated) or the documented non-canonical location (if out-of-canon). |

### 5.3 Required rows (the known inventory)

The inventory MUST contain at least the following rows, matching the audited counts (§1) and
`tech-spec.md §3.5`. Counts are grep-verified against the current `feature-forge` tree; the gate /
a re-grep is authoritative (do not trust the numbers blindly — re-grep at implementation time).

| Construct | Locations / count | Disposition | Rationale / notes |
|---|---|---|---|
| `argument-hint` (top-level frontmatter key) | 10 `SKILL.md` (all skills **except** `forge-init`) | `relocated` | Claude-specific (C-2). Moved verbatim to `metadata.argument-hint` per REQ-VND-01 (§2). Value unchanged; description untouched. |
| `${CLAUDE_PLUGIN_ROOT}` — canonical invocations + prose | 23 occurrences across 9 canonical surfaces: `forge-0-epic/SKILL.md` (12), `forge/SKILL.md` (3), `forge-5-loop/SKILL.md` (1), `forge-6-docs/SKILL.md` (1), `forge-init/SKILL.md` (1), `forge-verify/SKILL.md` (1), `forge-verify/references/verification-checklists.md` (1), `references/shared-conventions.md` (2), `agents/forge-verifier.md` (1) | `routed-through-resolver` | Claude-only env var. Routed through the bootstrap prelude + `scripts/forge-root.sh` per REQ-RES-03. Mechanics owned by `03-portable-root-resolver.md`; recorded here for audit completeness. |
| `${CLAUDE_PLUGIN_ROOT}` — sanctioned residual | 1 occurrence in `scripts/forge-root.sh` (env-fallback, REQ-RES-02 step 3) | `preserved-as-spec-allowed` | The single sanctioned residual: the resolver's documented Claude-compat fallback (REQ-RES-03 / REQ-RES-05). Exempt from the residual-var scan (`00-core-definitions.md §6`). |
| `${CLAUDE_PLUGIN_ROOT}` — in `hooks.json` | 1 occurrence in `hooks/hooks.json` | `out-of-canon` | Non-canonical Claude artifact (REQ-VND-04). Not a canonical surface; exempt from REQ-RES-03 scan. Left in place. |
| `hooks/hooks.json` SessionStart wiring | 1 file (`hooks/hooks.json`) — Claude `SessionStart` → `bash ${CLAUDE_PLUGIN_ROOT}/scripts/session-check.sh` | `out-of-canon` | Claude-specific plugin hook wiring (REQ-VND-04, decision D3). Preserved + documented so `forge-agent-adapters-build` treats it as a Claude artifact, not portable canon. |
| (contingency) any other vendor invocation directive | none found in the audit (§3) | — | REQ-VND-02 contingency did not fire. IF one is later surfaced, add a row with `removed` or `out-of-canon` per §3. |

> The `scripts/forge-root.sh` row is **forward-looking**: that file does not exist in the starting
> tree (it is created by `03-portable-root-resolver.md`). The inventory is authored/finalized after
> the resolver lands, so the sanctioned-residual row is real at gate time. At authoring time only the
> `hooks.json` occurrence and the 23 canonical occurrences exist (24 total in the starting tree); the
> 25th (`forge-root.sh` residual) appears once the resolver is added.

### 5.4 Example table fragment (concrete shape)

A conforming fragment of the inventory table, for illustration (the implementer fills the full set
from §5.3):

```markdown
| Construct | Locations / count | Disposition | Rationale / notes |
|---|---|---|---|
| `argument-hint` | 10 `skills/*/SKILL.md` (all but `forge-init`) | `relocated` | → `metadata.argument-hint`, value verbatim (REQ-VND-01). |
| `hooks/hooks.json` SessionStart | `hooks/hooks.json` (1) | `out-of-canon` | Claude hook wiring; preserved + documented (REQ-VND-04). |
```

## Dependencies

- **`00-core-definitions.md`** — provides `ALLOWED_FRONTMATTER_KEYS` and the field contracts (§1),
  the `metadata.argument-hint` target shape (§1), the frontmatter-reader contract that makes the
  nested `argument-hint` parse correctly (§4), the `RESIDUAL_VAR_EXEMPT` set covering `hooks.json`
  (§6), and the `Disposition` vocabulary the inventory uses (§8). All are **referenced, not
  redefined**, here.
- **`01-architecture-layout.md`** — places `references/vendor-construct-inventory.md` and records the
  `hooks/hooks.json` UNCHANGED disposition (§2, §3).

**Owned elsewhere (not in this document):**

- **`03-portable-root-resolver.md`** owns the `${CLAUDE_PLUGIN_ROOT}` → prelude/resolver routing
  (REQ-RES-01..05). This document only records its inventory disposition (§5).
- **`05-spec-purity-checker.md`** owns the checker that *enforces* the frontmatter rules specified
  here — REQ-FM-01 (allowed keys), REQ-FM-02 (`name == dir`), and REQ-FM-04 (well-formed
  frontmatter), enumerated there as rules 1–2. This document specifies the data; `05` specifies the
  enforcement.

## Verification

A reviewer or the checker confirms conformance to this document by checking:

- [ ] Every `skills/*/SKILL.md` top-level frontmatter key ∈ `ALLOWED_FRONTMATTER_KEYS`
      (`{name, description, license, compatibility, metadata, allowed-tools}`) — no `argument-hint`
      remains at top level in any of the 11 skills (REQ-FM-01, REQ-VND-01).
- [ ] For each of the 10 skills that declared `argument-hint`, `metadata.argument-hint` is present
      and its value is **byte-identical** to the pre-refactor top-level `argument-hint` value (§1
      table) (REQ-VND-01).
- [ ] `argument-hint` appears **only** under `metadata` (nested, 2-space indent) and nowhere as a
      top-level key (REQ-FM-01).
- [ ] Each skill's `description` value is **byte-identical** to its pre-refactor value (no reflow,
      re-quote, or re-indent) (REQ-FM-03).
- [ ] Each skill's `name` value still equals its containing directory name (REQ-FM-02).
- [ ] `forge-init/SKILL.md` frontmatter is **unchanged** (still exactly `{name, description}`; no
      `metadata` block added) (§2.3).
- [ ] Every frontmatter block parses as valid YAML / via the reader contract without a
      malformed-block violation (REQ-FM-04; enforced by `05`).
- [ ] `references/vendor-construct-inventory.md` exists, contains the disposition legend, and
      includes all known rows from §5.3 — `argument-hint` ×10 (`relocated`),
      `${CLAUDE_PLUGIN_ROOT}` ×23 canonical (`routed-through-resolver`) + ×1 residual
      (`preserved-as-spec-allowed`) + ×1 in `hooks.json` (`out-of-canon`), and `hooks/hooks.json`
      SessionStart wiring (`out-of-canon`) (REQ-VND-03, REQ-VND-04).
- [ ] Every disposition cell in the inventory is a member of the `Disposition` enum
      (`00-core-definitions.md §8`) — no free-form values (REQ-VND-03).
- [ ] The inventory records that the REQ-VND-02 contingency did **not** fire (no
      Codex/Copilot/Cursor/Gemini invocation directive found) (§3).
- [ ] No post-refactor frontmatter key references a single-agent-only path (frontmatter slice of
      REQ-SOT-03).
