# 04 — Body Size Discipline

> Feature: `forge-skill-spec-purity` (epic `agent-agnostic`, target repo **feature-forge**).
> Source of truth: `PRD.md` (v1, §3.4) + `tech-spec.md` (v1, §3.3, decision **D1**).
> This document specifies the `SKILL.md` **body** size budget, the exact measurement
> algorithm the checker and an engineer use, the per-skill status table, and the concrete
> per-skill relocation plan for the three over-budget skills (`forge-0-epic`, `forge-5-loop`,
> `forge-verify`). It reuses the budget constants and the authoritative body definition from
> `00-core-definitions.md §2` — it does **not** redefine them. The checker that enforces this
> at gate time is specified in `05-spec-purity-checker.md`; the layout that hosts the relocated
> content is in `01-architecture-layout.md §2`.
>
> **Stack note:** this feature ships **Bash + Python 3 (stdlib) + Markdown** — no TypeScript.
> The "code" in this document is the measurement procedure (exact shell/Python commands) and the
> relocation mapping (source section → target reference file + in-body pointer). All paths are
> relative to the `feature-forge` repo root (constraint **C-1**).

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-SIZE-01 | The 3 over-budget skills MUST be brought within budget; overflow MOVED to `references/`, not deleted | §1, §3, §5 |
| REQ-SIZE-02 | Relocation preserves all instructions; every relied-on reference becomes an explicit in-body pointer | §4, §5 |
| REQ-SIZE-03 | A concrete, checkable body budget exists (≤300 lines AND ≤5000 words, whichever binds first) | §1, §2 |

## 1. The Binding Budget (REQ-SIZE-03, decision D1)

A `SKILL.md` **body** MUST satisfy **both** of these limits — whichever is reached first binds:

| Limit | Constant (`00-core-definitions.md §2`) | Value |
|-------|----------------------------------------|-------|
| Body line count | `MAX_BODY_LINES` | **≤ 300** |
| Body word count | `MAX_BODY_WORDS` | **≤ 5000** |

This is **decision D1** (`tech-spec.md §3.3`/§10): it **tightens** OQ-1's provisional
`500 / 5000` (`PRD.md §3.4 REQ-SIZE-03`, `PRD.md §7 OQ-1`). Tightening was explicitly
permitted; the budget **MUST NEVER be loosened** without revisiting OQ-1. The `300` line cap
was chosen because it captures all three PRD-named skills (whose line counts bind, not their
word counts) while leaving the next-largest skill, `forge-2-tech` at ~192 lines, a comfortable
margin (§3).

**The budget is a HARD gate, not a guideline.** The spec-purity checker
(`05-spec-purity-checker.md`, rule 4 — `Rule.BODY_SIZE`) enforces it as a hard failure: a body
exceeding either limit makes the checker exit non-zero (`VR_BODY_LINES` / `VR_BODY_WORDS`,
`00-core-definitions.md §5`), and the feature's completion gate (REQ-VER-03) requires the
checker green against all 11 skills. So the three over-budget skills **block feature
completion** until reduced (`PRD.md §3.4 REQ-SIZE-01` notes; `PRD.md §8` success criterion 4).

**The gate, not any table, is authoritative.** The checker **re-measures** each body at gate
time. The authorship-time counts in §3 (and in `tech-spec.md §3.3`) are advisory only —
exactly as `tech-spec.md §3.2` warns "do not trust counts, re-grep at impl time." An engineer
MUST run the checker (or the §2 command) against the *final* file state — including the prelude
additions of §6 — never against a pre-refactor table.

## 2. Body-Measurement Algorithm (REQ-SIZE-03)

This restates the authoritative body definition from `00-core-definitions.md §2`; that
definition is canonical — this section makes it operational with the exact command an engineer
or the checker uses. It is the **same** measurement the checker's rule 4 performs
(`05-spec-purity-checker.md §3`); both MUST agree.

**Body boundary.** The *body* is the file content **after the second `---` line** that closes
the YAML frontmatter block. Concretely:

- The frontmatter block is delimited by the **first** `---` at column 0 (the open) and the
  **next** `---` at column 0 (the close). All 11 skills open frontmatter on line 1 and close on
  line 5 (audit-verified at authorship).
- The **body** is every line **strictly after** the closing `---` line. The closing `---`
  itself is **not** part of the body; neither is any frontmatter content.
- A file with no well-formed open/close `---` pair has no measurable body — that is a malformed
  frontmatter violation (`VR_MALFORMED_FM`, REQ-FM-04, owned by `05-spec-purity-checker.md`),
  reported separately, never a crash.

**Counting rules** (per `00-core-definitions.md §2`):

- **Line count** = the number of newline-terminated lines in the body (i.e. lines below the
  closing `---`). A trailing newline produces the conventional line count; an empty body counts
  `0`.
- **Word count** = the number of whitespace-split tokens in the body (Python `str.split()`
  semantics: runs of any whitespace are one separator; leading/trailing whitespace ignored).
- **CRLF tolerance:** `\r\n` line endings MUST be tolerated and measured identically to `\n`
  (strip/normalize `\r` before counting so a CRLF file is not mis-measured). This matches the
  reader's CRLF tolerance in `00-core-definitions.md §4`.

**Exact reference command** (stdlib Python — the same logic the checker implements; use this
to verify any single file by hand):

```bash
python3 - "skills/forge-0-epic/SKILL.md" <<'PY'
import sys
path = sys.argv[1]
# Read bytes, decode, normalize CRLF -> LF (CRLF tolerance, 00 §4 / §2).
text = open(path, "rb").read().decode("utf-8").replace("\r\n", "\n").replace("\r", "\n")
lines = text.split("\n")
# Frontmatter close = the SECOND column-0 '---' line.
fence = [i for i, ln in enumerate(lines) if ln == "---"]
if len(fence) < 2:
    print(f"{path}: MALFORMED frontmatter (no close fence)", file=sys.stderr)
    sys.exit(2)
body_lines = lines[fence[1] + 1:]          # everything strictly after the close
body = "\n".join(body_lines)
n_lines = len(body_lines)                   # newline-terminated body lines
n_words = len(body.split())                 # whitespace-split tokens
ok = n_lines <= 300 and n_words <= 5000
print(f"{path}: body lines={n_lines} (<=300: {n_lines <= 300}), "
      f"words={n_words} (<=5000: {n_words <= 5000}) -> {'OK' if ok else 'OVER BUDGET'}")
sys.exit(0 if ok else 1)
PY
```

Notes on edge cases this command handles deliberately:

- It finds the **second** `---`, not merely "a line containing dashes" — a body line that is
  itself `---` (a Markdown thematic break, which several skills use, e.g. `forge-0-epic`
  separators) does **not** confuse the boundary because only the *frontmatter-closing* fence
  (`fence[1]`) matters; everything after it is body regardless of further `---` lines.
- It normalizes CRLF before splitting, so a Windows-checkout file measures identically.
- A missing close fence exits `2` (malformed) rather than silently measuring a giant "body."

## 3. Per-Skill Status Table (REQ-SIZE-01, REQ-SIZE-03)

All 11 skills, with authorship-time body measurements and the action each requires. **Only the
three named skills do size work**; the other eight are within budget and need **no** change for
this workstream (they are still edited by the frontmatter/resolver workstreams — see
`01-architecture-layout.md §2` — but not for size).

| Skill | Body lines | Body words | Action |
|-------|-----------:|-----------:|--------|
| `forge-0-epic` | 517 | 3,594 | **REDUCE** — lines bind (3.4) |
| `forge-5-loop` | 418 | 3,415 | **REDUCE** — lines bind (3.4) |
| `forge-verify` | 337 | 2,451 | **REDUCE** — lines bind (3.4) |
| `forge-2-tech` | 192 | 1,769 | ok — within budget, no size work |
| `forge-6-docs` | 171 | 1,184 | ok — within budget, no size work |
| `forge` | 153 | 1,260 | ok — within budget, no size work |
| `forge-3-specs` | 148 | 1,505 | ok — within budget, no size work |
| `forge-4-backlog` | 140 | 1,428 | ok — within budget, no size work |
| `forge-1-prd` | 115 | 1,307 | ok — within budget, no size work |
| `forge-fix` | 59 | 518 | ok — within budget, no size work |
| `forge-init` | 22 | 82 | ok — within budget, no size work |

> **These counts are authorship-time / advisory; the gate is authoritative (§1).** They
> reproduce `tech-spec.md §3.3` and were re-measured from the live `feature-forge` working tree
> at spec-authoring time with the §2 command. The fresh measurement matched the tech-spec table
> within ±1 line / ±6 words (the ±1 line is the trailing-newline boundary line; immaterial — all
> three over-budget skills exceed `300` by >37 lines, and `forge-2-tech` is >100 lines under).
> Word counts are all comfortably under `5000`, so **for all three over-budget skills the line
> cap binds** — reduction is a line-count exercise. The checker re-measures the *final* files
> (post-prelude, §6); these numbers MUST NOT be used as the pass/fail authority.

For every "ok" skill: its body is below both limits, so this workstream makes **no** size-driven
edit to it. (REQ-SIZE-01's "SHOULD" applies to all skills, but only the three over-budget ones
carry the hard "MUST"; the eight in-budget skills already satisfy the budget.)

## 4. Reduction Method (REQ-SIZE-02)

The reduction is a **content relocation**, never a deletion. The binding rules:

1. **Content is MOVED, never deleted.** Overflow detail from an over-budget body is moved into a
   file under that skill's own `references/` directory (`01-architecture-layout.md §2`). No
   instruction, table, code block, or caveat is dropped — relocation preserves *all* instructions
   (REQ-SIZE-02). The relocated text is moved **verbatim** (only the heading level may be
   adjusted for the new file's context).

2. **Every relied-on inline reference becomes an explicit in-body POINTER.** Wherever the body
   previously presented detail inline that the agent depended on, the body MUST retain a short,
   explicit pointer to the moved content so the agent can still find and read it on demand. A
   pointer is a one- or two-line directive of the form:

   > For the full `<topic>` (`<what it covers>`), read `references/<file>.md`.

   The pointer MUST name the **exact target file** (and section, when the target file has
   multiple sections) so resolution is unambiguous — this satisfies REQ-SIZE-02's "any reference
   the body relied on inline MUST become an explicit pointer to the moved content so the agent
   can still find it," and keeps the canon internally consistent (REQ-SOT-03, `PRD.md §3.5`).

3. **Prefer relocating self-contained, reference-style blocks** (per-subcommand tables, exact
   command catalogs, long output templates, per-stage check detail) over relocating
   control-flow prose. The body should retain the *decision logic and step ordering*; the
   *lookup detail* moves to `references/`. This keeps the body a runnable procedure and the
   reference a lookup table — and keeps the diff mechanical and one-concern-per-change
   (REQ-MAINT-01, `PRD.md §4.2`).

4. **Behavior preservation (REQ-COMPAT-01).** Because no instruction is lost and every moved
   block is reachable through an in-body pointer, the skill behaves identically under Claude
   Code after reduction (`PRD.md §3.4 REQ-SIZE-01`/§4.1 REQ-COMPAT-01) — the agent reads the
   pointer and opens the reference exactly as it would have read the inline section.

5. **New reference files live under the skill's own `references/`** (not the top-level
   `references/`). `forge-0-epic` and `forge-5-loop` have **no `references/` directory today** —
   it must be created for them. `forge-verify` already has
   `references/verification-checklists.md` and reuses it (§5).

## 5. Per-Skill Relocation Plan (REQ-SIZE-01, REQ-SIZE-02)

The concrete candidate relocations below are derived from `tech-spec.md §3.3` and grounded in
the live body structure of each skill. For each, the **target reference file(s)** and the
**in-body pointer that remains** are named.

> **Produced artifacts (contract surface vs internal).** This workstream produces these NEW
> `references/` files (the contract surface — read by the reduced skill bodies via in-body
> pointers): `skills/forge-0-epic/references/{epic-manifest-subcommands,edit-mode}.md`,
> `skills/forge-5-loop/references/{runner-contract,result-reporting}.md`, plus appended sections in
> the **existing** `skills/forge-verify/references/verification-checklists.md`. The reduced
> `SKILL.md` bodies remain the agent-facing entrypoint; the relocated files are lookup detail reached
> only through the in-body pointers (§4 rule 2).

> **TQ-2 — the exact line-by-line split is finalized during implementation**
> (`tech-spec.md §3.3`/§10 TQ-2), constrained **only** by the ≤300-line / ≤5000-word gate (§1).
> The sections named below are the planned relocation candidates; the implementer MAY move more
> or slightly different blocks as long as (a) the final post-prelude body passes the checker
> (§6) and (b) every moved block keeps an in-body pointer (§4 rule 2). The implementer MUST NOT
> reduce by deletion or by editing descriptions (REQ-FM-03).

### 5.1 `forge-0-epic` (517 → ≤300 lines; ~217+ lines to relocate)

The body is dominated by **Edit Mode** (§§E1–E6) and the **Observability/Pipeline-State/Commit**
machinery — large, reference-style blocks the body can point to rather than inline.

- **Create `skills/forge-0-epic/references/` (NEW directory).**
- **Relocate → `skills/forge-0-epic/references/epic-manifest-subcommands.md` (NEW):** the
  per-subcommand `epic-manifest.py` reference tables and exact flag-surface command catalog —
  the full `add-feature` / `remove-feature` / `reorder` / `set-dep` / `set-status` invocation
  blocks and the per-subcommand exit-code (`0`/`1`/`2`) disposition tables currently inline in
  **Step E3** and the **Error Handling** table. (The exact `epic-manifest.py` mutator flag surface
  is defined by the existing `forge-0-epic` SKILL.md body and `scripts/epic-manifest.py --help`; the
  subcommand list is enumerated in `01-architecture-layout.md §3`. The relocated reference file only
  needs a catalog + an in-body pointer, not a re-specification of the flags.)
  - **In-body pointer (remains in SKILL.md, Step E3):** *"For the exact `epic-manifest.py`
    mutator flag surface and per-subcommand exit-code handling, read
    `references/epic-manifest-subcommands.md`."*
- **Relocate → `skills/forge-0-epic/references/edit-mode.md` (NEW):** the **Edit-Mode mechanics**
  — the verbatim E1 refuse-if-invalid protocol, the E2 operation→mutator table, the
  "contracts have no mutator" and "remove-feature leaves the directory in place" caveats (incl.
  the verbatim WARN block), and the E4 impact-warning detail.
  - **In-body pointer (remains in SKILL.md, under `## Edit Mode`):** *"Edit mode mutates the
    manifest only through helper mutators (atomic, re-validated). For the full E1–E6 mechanics —
    refuse-if-invalid, the operation table, the contracts/remove-feature caveats, and the
    impact-warning rules — read `references/edit-mode.md`."* The body keeps the entry condition
    (the EXISTS branch from Step 0) and the high-level "every mutation is committed individually"
    rule.
- **`${CLAUDE_PLUGIN_ROOT}` interaction:** the relocated command blocks contain several of
  `forge-0-epic`'s 12 `${CLAUDE_PLUGIN_ROOT}` occurrences (`03-portable-root-resolver.md §5`).
  Wherever a command block moves to `references/`, its env-var → prelude rewrite moves **with**
  it (the target file is still a *canonical surface* scanned by checker rule 3, so it must use
  the prelude, not the raw var). Commands that stay in the body get the prelude in place. Net:
  **all 12 are still routed through the resolver**, whether the command ends up in SKILL.md or
  in a relocated reference (`03-portable-root-resolver.md §5`, `00-core-definitions.md §6`).

### 5.2 `forge-5-loop` (418 → ≤300 lines; ~118+ lines to relocate)

The body's heaviest blocks are **Step 4b's result-report templates** (five fenced output
templates) and the **runner/loop-contract + model-precedence prose**.

- **Create `skills/forge-5-loop/references/` (NEW directory).**
- **Relocate → `skills/forge-5-loop/references/runner-contract.md` (NEW):** the detailed
  **runner/loop-contract prose** (event-stream vs. log-fallback launch detail in 3b/3d/3e, the
  structured-surface monitoring caveats) and the **model-precedence detail** (the
  `item.model` > `--model`/options > project default > provider default precedence and the
  optional-flags catalog from 2d). These are lookup/reference detail the body can point to.
  - **In-body pointer (remains in SKILL.md):** *"For the full loop-runner contract — event-stream
    vs. log-fallback launch, the live-supervision/monitor rules, and the model-selection
    precedence — read `references/runner-contract.md`."* The body keeps Step ordering (1→6) and
    the decision points; the reference holds the contract detail.
- **Relocate → `skills/forge-5-loop/references/result-reporting.md` (NEW)** *(candidate — apply
  only if line headroom requires; TQ-2):* the five Step-4b verbatim result-report **output
  templates** (all-done / needs-human / blocked / deferred / pending). These are long, static
  templates.
  - **In-body pointer (remains in SKILL.md, Step 4b):** *"Pick every branch that applies and
    render its report; the five verbatim report templates (all-done, needs-human, blocked,
    deferred, pending) are in `references/result-reporting.md`."*
- **`${CLAUDE_PLUGIN_ROOT}` interaction:** `forge-5-loop` has **1** occurrence
  (`03-portable-root-resolver.md §5`); its env-var → prelude rewrite happens in whichever surface
  the relevant invocation lands in (body or relocated reference), still routed through the
  resolver.

### 5.3 `forge-verify` (337 → ≤300 lines; ~37+ lines to relocate)

This is the smallest overrun (≈37 lines over). It already has a `references/` directory, so the
relocation target **already exists**.

- **Relocate → `skills/forge-verify/references/verification-checklists.md` (EXISTING — append):**
  the **per-stage check detail** — primarily the large **Step-6 epic-mode `.epic-state.json`
  state-write detail** (schema + atomic-write rules) and the long **findings-document /
  fix-plan output template** and **example-findings** block (the V-001…/V-012 examples) from
  Steps 4–5, which are reference-style content, not control flow. Append them under a clearly
  titled section in the existing checklists file.
  - **In-body pointer (remains in SKILL.md):** the body **already** points to this file
    ("Read `references/verification-checklists.md` for the detailed checklists per mode") in
    Step 3 — extend that pointer to cover the newly-moved content: *"…and for the findings-report
    template, the example findings, and the epic-mode `.epic-state.json` write detail, see the
    corresponding sections of `references/verification-checklists.md`."*
- **`${CLAUDE_PLUGIN_ROOT}` interaction:** `forge-verify/SKILL.md` has **1** occurrence and
  `forge-verify/references/verification-checklists.md` has **1** more
  (`03-portable-root-resolver.md §5`); both are canonical surfaces and get the prelude rewrite
  regardless of this relocation.

> Because `forge-verify` is only ~37 lines over, the implementer has the most freedom here
> (TQ-2): relocating the epic-mode state block alone (≈70 lines, §262–333 of the current body)
> already clears the budget with margin for the prelude growth (§6).

## 6. Prelude-Growth Interaction (sequencing constraint)

The portable-resolver workstream (`03-portable-root-resolver.md`) replaces each
`${CLAUDE_PLUGIN_ROOT}` invocation with the **2-line bootstrap prelude**
(`00-core-definitions.md §3`) prepended to its fenced block. This **slightly GROWS** the body of
any skill that has `${CLAUDE_PLUGIN_ROOT}` invocations — including all three over-budget skills
(`forge-0-epic` has 12 occurrences, `forge-5-loop` 1, `forge-verify` 1;
`03-portable-root-resolver.md §5`). Each replaced invocation that *stays in the body* adds ~2
lines (the prelude) minus the 1 line it replaces — a net body **increase**.

This is a **sequencing / headroom constraint** (`01-architecture-layout.md §6`, `tech-spec.md
§3.3` final note):

- The ≤300-line gate is evaluated against the **FINAL** body state — **after** the prelude
  additions of `03-portable-root-resolver.md`. Reduction targets MUST therefore leave
  **headroom** below 300 so the post-prelude body still passes (e.g. aim for a comfortable
  margin, not exactly 300, in the relocated state).
- For `forge-0-epic`, relocating command blocks to `references/` carries their preludes **with
  them** (§5.1), which *removes* that prelude growth from the body — relocation and
  prelude-routing are complementary there.
- An engineer MUST run the §2 measurement / the checker (`05-spec-purity-checker.md`) against
  the file **after both** the relocation **and** the prelude rewrite are applied, never against
  an intermediate state. The gate is the post-prelude body (§1, §3).

## Dependencies

**Hard upstream dependencies (must land first):**

- **`00-core-definitions.md`** — REQUIRED. This document reuses `MAX_BODY_LINES` (300),
  `MAX_BODY_WORDS` (5000), and the authoritative **body definition** (§2: body = content after
  the second `---`; line count = newline-terminated body lines; word count = whitespace-split
  tokens; CRLF tolerated). It does not redefine them.
- **`01-architecture-layout.md §2`** — defines where the relocated content lands (each skill's
  `references/`) and notes (`§6`) the prelude-growth headroom constraint.
- **`03-portable-root-resolver.md`** — the prelude additions it specifies affect the **final**
  body size (§6). The exact `${CLAUDE_PLUGIN_ROOT}`-per-file counts live in its §5. Reduction
  targets must account for prelude growth, so 04's headroom planning presupposes 03's prelude.

**Forward reference (verifies this workstream's output):**

- **`05-spec-purity-checker.md`** — its **rule 4** (`Rule.BODY_SIZE`) is the HARD gate that
  enforces this budget; it re-measures bodies with the algorithm of §2 and emits `VR_BODY_LINES`
  / `VR_BODY_WORDS` (`00-core-definitions.md §5`). The gate, not §3's table, is authoritative.

## Verification

After implementation, confirm:

- [ ] **`forge-0-epic`** body ≤ 300 lines **AND** ≤ 5000 words measured on the **final** file
      (after relocation **and** the §6 prelude rewrite), via the §2 command and the checker.
- [ ] **`forge-5-loop`** body ≤ 300 lines **AND** ≤ 5000 words on the final file (post-prelude).
- [ ] **`forge-verify`** body ≤ 300 lines **AND** ≤ 5000 words on the final file (post-prelude).
- [ ] **Relocated content present + intact** in the target `references/` files: the
      `forge-0-epic` `references/` directory (NEW) and its subcommand/edit-mode files exist; the
      `forge-5-loop` `references/` directory (NEW) and its runner-contract file exist;
      `forge-verify/references/verification-checklists.md` (EXISTING) contains the appended
      detail. No instruction, table, command, or caveat was dropped (REQ-SIZE-02) — a moved block
      appears verbatim in exactly one place.
- [ ] **An in-body POINTER exists for every moved section** (§4 rule 2): for each block relocated
      out of a body, the body retains a one/two-line pointer naming the exact target file (and
      section), so the agent can still reach it (REQ-SIZE-02). No moved content is silently
      orphaned (REQ-SOT-03 — cross-references resolve).
- [ ] **The other 8 skills are unchanged in body size** by this workstream — no size-driven edit
      to `forge-2-tech`, `forge-6-docs`, `forge`, `forge-3-specs`, `forge-4-backlog`,
      `forge-1-prd`, `forge-fix`, `forge-init` (they remain within budget; any diff they carry is
      from the frontmatter/resolver workstreams, not size).
- [ ] **No description text was altered** during reduction (REQ-FM-03,
      `00-core-definitions.md §1`).
- [ ] **Checker rule 4 (`Rule.BODY_SIZE`) is GREEN** across all 11 skills
      (`05-spec-purity-checker.md`), and `bash scripts/validate.sh` passes end-to-end
      (REQ-VER-03, `01-architecture-layout.md §5`).
