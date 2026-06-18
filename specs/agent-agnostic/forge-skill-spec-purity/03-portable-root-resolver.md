# 03 — Portable Script-Root Resolver

> Feature: `forge-skill-spec-purity` (epic `agent-agnostic`, target repo **feature-forge**).
> Source of truth: `PRD.md` (v1) + `tech-spec.md` (v1). This document specifies the portable
> script-root resolver (`scripts/forge-root.sh` — the exposed `portable-skill-root-resolver`
> contract), the byte-identical bootstrap prelude, the NEW canonical reference doc
> `references/portable-root.md`, and the mechanical procedure that replaces all 23 canonical
> `${CLAUDE_PLUGIN_ROOT}` occurrences across 9 files. Shared constants and contracts come from
> `00-core-definitions.md`; the layout that hosts these files is in `01-architecture-layout.md`.
>
> **Stack note:** the configured `stack` is `typescript`, but this slice ships **Bash + Markdown
> only** — there is no TypeScript and (decision **D2**) no Python twin. All shell below is exact,
> runnable Bash (`set -euo pipefail`), not pseudocode.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-RES-01 | Portable resolver locates scripts without `${CLAUDE_PLUGIN_ROOT}` | §1, §2 |
| REQ-RES-02 | Resolution order: self-location → candidate probe → env fallback | §2 (steps 1–4) |
| REQ-RES-03 | All canonical `${CLAUDE_PLUGIN_ROOT}` routed through resolver; single sanctioned residual | §1, §3, §5 |
| REQ-RES-04 | Actionable failure when no root resolves | §2 (step 4), §6 |
| REQ-RES-05 | Resolver is a single reusable unit + canonical prelude | §2, §3, §4 |
| REQ-SEC-01 | Resolution bounded; never sources/executes a discovered path | §2, §6 |
| REQ-MAINT-01 (prelude-identity slice) | Prelude is one canonical string; never drifts | §3, §4 |

## 1. Problem shape (REQ-RES-01, REQ-RES-03)

`${CLAUDE_PLUGIN_ROOT}` appears **only** in markdown bodies (`skills/**/SKILL.md`), `references/`,
the dispatched subagent definition (`agents/forge-verifier.md`), and the non-canonical
`hooks/hooks.json` — **never inside a `.py` or `.sh` script** (`tech-spec.md §3.2`, grep-verified
below in §5). Every canonical use is of one of two forms:

- An **invocation** — `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/<x>"` (or `bash …`): the variable's
  sole job is to **name a bundled script's path for invocation**. The bundled scripts themselves
  operate on the user's CWD and need **no** root passed to them.
- A **prose mention** — text that describes what the variable resolves to.

Consequently the fix is **entirely at the invocation layer**: the scripts need no change to *find*
a root; only the callers need a portable way to *name* the script path. This document delivers that
portable naming via `scripts/forge-root.sh` (§2) plus a verbatim bootstrap prelude (§3), then
rewrites every caller (§5).

The **only** `${CLAUDE_PLUGIN_ROOT}` permitted to survive in the whole tree after this feature:

1. The single **sanctioned residual** inside `scripts/forge-root.sh` itself (the documented env
   fallback, §2 step 3) — exempt per `00-core-definitions.md §6` `RESIDUAL_VAR_EXEMPT`.
2. The 1 occurrence in `hooks/hooks.json` — non-canonical Claude artifact, exempt per **REQ-VND-04**.

Both are out of scope for REQ-RES-03; every *other* occurrence is rewritten (§5).

**Scope boundary — what "portable" means in this feature (REQ-RES-01).** This feature delivers the
resolver *mechanism* (`forge-root.sh` self-location + sentinel probe) and removes the env-var
coupling from every canonical surface. It does **not** yet make the canon bootstrap-discoverable
under a non-Claude agent: the bootstrap prelude's discovery globs (§3) are deliberately a Claude-only
`$HOME`-Claude subset (`~/.claude/skills/feature-forge`, `~/.claude/plugins/*/feature-forge`), so
under Codex/Copilot/Cursor/Gemini the prelude finds no `forge-root.sh` and the guard exits 1. The
resolver's own self-location step works under any layout once it is *reached*, but wiring per-agent
discovery paths into the prelude/resolver candidate set so a non-Claude agent can bootstrap-discover
`forge-root.sh` is owned by **`cross-agent-installer`** (the same TQ-1 deferral noted in §3). REQ-RES-01
is satisfied at the mechanism level here; full cross-agent discovery is an intended downstream scope
boundary, not a gap in this feature.

## 2. `scripts/forge-root.sh` — the portable resolver (REQ-RES-01, REQ-RES-02, REQ-RES-04, REQ-RES-05, REQ-SEC-01)

`scripts/forge-root.sh` is the exposed **`portable-skill-root-resolver`** contract
(`01-architecture-layout.md §4`). It takes **no arguments**, prints the absolute plugin root to
stdout and exits `0` on success, or writes an actionable message to stderr and exits `1` on
failure — exactly the exit-code/I·O contract in `00-core-definitions.md §7`. It is **idempotent,
side-effect-free**, and copied **verbatim** into per-agent script mirrors by the downstream
`forge-agent-adapters-build` generator (REQ-RES-05), so it must depend on nothing in the repo
beyond POSIX/Bash and the sentinel files.

**Resolution order (REQ-RES-02 — implement these four steps in this exact order):**

1. **Self-location.** Compute `dir = realpath(dirname(BASH_SOURCE[0])/..)`. Because the script
   lives at `<root>/scripts/forge-root.sh`, its parent-of-dir **is** the plugin root. If
   `is_root(dir)`, print it and exit `0`. This works under **any** agent's install layout the
   moment the script is reachable (REQ-RES-01).
2. **Candidate-root probe.** Iterate a maintained list of known install roots — the Claude dev
   symlink `~/.claude/skills/feature-forge`, Claude plugin installs `~/.claude/plugins/*/feature-forge`,
   and forward per-agent dirs (extended downstream). The **first** candidate for which `is_root(c)`
   holds is printed; exit `0`. This step is the **authoritative** multi-root probe (TQ-1, §3).
3. **Env fallback.** If `${CLAUDE_PLUGIN_ROOT}` is set **and** `is_root` of it holds, print it and
   exit `0`. **This is the single sanctioned residual occurrence of the variable in the whole
   canon** (REQ-RES-03; retained for Claude backward-compat per constraint **C-4**).
4. **Failure.** If no strategy resolved a root, write the actionable message to **stderr** and exit
   `1` (REQ-RES-04) — never a silent failure or an empty path. The message is the exact string from
   `00-core-definitions.md §7`.

`is_root(d)` is the **content-based sentinel** from `00-core-definitions.md §2` (do not redefine —
reuse): a directory is a valid root iff **both** `SENTINEL_FILES` exist
(`scripts/epic-manifest.py` **and** `.claude-plugin/plugin.json`). Resolution is **bounded** to the
candidate roots plus the script's own location, and the script **never sources or executes** a
discovered path — it only ever prints a directory string (REQ-SEC-01, §6).

**Complete script (create mode `0755` — `01-architecture-layout.md §5`: `validate.sh` step 6 globs
`scripts/*.sh` and asserts `-x`, so this bit is gate-enforced; a non-executable resolver is silently
invisible to the prelude's `[ -x … ]` guard per `tech-spec.md §2`):**

```bash
#!/usr/bin/env bash
# scripts/forge-root.sh — the portable skill/plugin-root resolver
# (exposed contract: portable-skill-root-resolver; REQ-RES-01..05, REQ-SEC-01).
#
# Prints the absolute feature-forge plugin root to stdout and exits 0, or writes an
# actionable error to stderr and exits 1. Takes no arguments. Idempotent and
# side-effect-free: it NEVER sources or executes a discovered path — it only prints a
# directory (REQ-SEC-01). Resolution is bounded to the candidate roots below plus this
# script's own on-disk location.
#
# This file is copied VERBATIM into per-agent script mirrors by the downstream adapter
# generator (REQ-RES-05); keep it dependency-free beyond POSIX/Bash + the sentinel files.
set -euo pipefail

# Sentinel predicate (00-core-definitions.md §2 / SENTINEL_FILES). A directory is a valid
# plugin root iff BOTH sentinel files exist. Content-based, so it identifies a feature-forge
# install under ANY agent's directory layout.
is_root() {  # $1 = candidate dir
  [ -f "$1/scripts/epic-manifest.py" ] && [ -f "$1/.claude-plugin/plugin.json" ]
}

# ── Step 1: self-location — parent of this script's dir is the plugin root. ──────────────
self_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
root="$(cd -- "$self_dir/.." && pwd -P)"
if is_root "$root"; then
  printf '%s\n' "$root"
  exit 0
fi

# ── Step 2: candidate-root probe (authoritative multi-root list; extend here first). ─────
# Globs that match nothing expand to themselves; the is_root test rejects such literals.
for candidate in \
  "$HOME/.claude/skills/feature-forge" \
  "$HOME"/.claude/plugins/*/feature-forge \
; do
  if is_root "$candidate"; then
    printf '%s\n' "$candidate"
    exit 0
  fi
done

# ── Step 3: env fallback — the SINGLE sanctioned residual ${CLAUDE_PLUGIN_ROOT} (C-4). ───
if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && is_root "$CLAUDE_PLUGIN_ROOT"; then
  printf '%s\n' "$CLAUDE_PLUGIN_ROOT"
  exit 0
fi

# ── Step 4: failure — actionable message to stderr, exit 1 (REQ-RES-04). ─────────────────
echo "feature-forge: cannot locate plugin root. Set CLAUDE_PLUGIN_ROOT or run from an installed skill dir." >&2
exit 1
```

**Notes on the implementation choices (every detail traces to a decision):**

- `set -euo pipefail` is the existing toolchain convention (`tech-spec.md §7`, constraint **C-5**).
- Self-location uses `cd … && pwd -P` rather than a `realpath` binary so the resolver stays
  portable to environments lacking GNU `realpath`; `pwd -P` performs the symlink-resolving
  `realpath(dirname(BASH_SOURCE)/..)` the tech-spec specifies (`tech-spec.md §3.2` step 1).
- `${CLAUDE_PLUGIN_ROOT:-}` (with `:-`) is mandatory under `set -u`: an unset variable would
  otherwise abort the script before reaching the failure message.
- The candidate-list comment marks this as the **authoritative** list (§3, TQ-1): add new install
  roots **here first**.

## 3. The bootstrap prelude (REQ-RES-05, REQ-MAINT-01)

Each fenced shell block an agent runs is a **separate** process with no persisted state, so the
plugin root must be re-resolved **within the same block** as every bundled-script call. The prelude
is a fixed, **byte-identical** 2-line snippet prepended to each invocation block. It is reproduced
here **byte-for-byte** from `00-core-definitions.md §3` (the canonical home is
`references/portable-root.md`, §4; do not edit either copy independently — a single byte of drift
is a spec defect that the checker's rule 5 catches):

```bash
R="$(for d in "$HOME"/.claude/skills/feature-forge "$HOME"/.claude/plugins/*/feature-forge; do [ -x "$d/scripts/forge-root.sh" ] && exec "$d/scripts/forge-root.sh"; done)"
[ -n "$R" ] || { echo "feature-forge: cannot locate plugin root" >&2; exit 1; }
```

After the prelude, scripts are invoked as `python3 "$R/scripts/<x>"` or `bash "$R/scripts/<x>"`
(§5).

**Why per-block re-resolution.** The agent has no shared shell state across fenced blocks, so a
root resolved in one block is gone in the next. Resolving inside the **same** block as each call is
the only way each invocation reliably names the script. This is why the prelude is *prepended to
every* invocation block (§5), not stated once.

**The three invariants (do NOT "fix" these):**

1. **Probes paths, not the env var.** The prelude's `for d in …` enumerates **directory paths** to
   locate an executable `forge-root.sh`; it contains **no** `${CLAUDE_PLUGIN_ROOT}`. That is what
   lets a prelude occurrence satisfy REQ-RES-03's "zero residual var in canonical surfaces" while
   still being portable.
2. **First-discoverable-resolver-wins.** The `exec` inside the `$(…)` command substitution means
   the loop stops at the **first** directory holding an executable `forge-root.sh` and delegates
   ALL final root resolution to that script (which runs the real multi-candidate probe of §2 steps
   1–4). The `for` list is a *discovery order for `forge-root.sh` itself*, **not** a fallback chain
   for the plugin root. **Removing the `exec` to "keep looping" is a regression** — once `exec`'d,
   the loop is replaced by the resolver process and never advances to a second candidate.
3. **Prelude candidate set is a minimal `$HOME` bootstrap subset (TQ-1).** The prelude's `for d`
   list exists only to **bootstrap-discover `forge-root.sh`**; the **authoritative** multi-root
   probe lives in `forge-root.sh` step 2 (§2). When adding an install root, update `forge-root.sh`
   **first**; extend the prelude **only** if the new root is needed to bootstrap-discover
   `forge-root.sh` itself.

**Checker boundary (REQ-MAINT-01).** The spec-purity checker's rule 5
(`05-spec-purity-checker.md`) asserts every prelude occurrence is **byte-identical** to the
canonical string, so the prelude can never drift. The checker does **NOT** assert
prelude-set ⊆ resolver-set — that subset relationship (invariant 3) remains a **manual-review**
item (TQ-1; revisited in `cross-agent-installer`).

## 4. NEW deliverable — `references/portable-root.md` (REQ-RES-05, REQ-MAINT-01)

`references/portable-root.md` is the **single canonical home** of the bootstrap-prelude string plus
its usage documentation. It is a NEW file (`01-architecture-layout.md §2`) and is the **source the
checker's rule 5 compares against** (`05-spec-purity-checker.md`): "byte-identical to canon" means
byte-identical to the fenced snippet in this file. Defining the string in exactly one place is the
mechanism by which REQ-MAINT-01's prelude-identity slice is satisfied — there is one source, every
occurrence is a copy, and the checker enforces the copies match.

**Required contents of `references/portable-root.md`:**

1. A one-paragraph statement of purpose: this file is the canonical source of the bootstrap prelude
   and the portable invocation convention; downstream consumers (`forge-agent-adapters-build`,
   `cross-agent-installer`) and the checker treat it as authoritative.
2. The **canonical prelude**, byte-identical to §3 / `00-core-definitions.md §3`, in a single
   ```bash``` fenced block — this exact block is what rule 5 hashes/compares against.
3. A **usage** subsection showing the full invocation shape: prepend the prelude, then call
   `python3 "$R/scripts/<x>"` or `bash "$R/scripts/<x>"`. Include one worked example, e.g.:

   ```bash
   R="$(for d in "$HOME"/.claude/skills/feature-forge "$HOME"/.claude/plugins/*/feature-forge; do [ -x "$d/scripts/forge-root.sh" ] && exec "$d/scripts/forge-root.sh"; done)"
   [ -n "$R" ] || { echo "feature-forge: cannot locate plugin root" >&2; exit 1; }
   python3 "$R/scripts/epic-manifest.py" render-status "{epic}" --specs-dir "{specsDir}" --json
   ```
4. The **three invariants** from §3 (paths-not-env-var; first-discoverable-resolver-wins / do not
   remove `exec`; prelude-set is a minimal bootstrap subset, resolver step 2 is authoritative —
   TQ-1).
5. A pointer to `scripts/forge-root.sh` as the resolver the prelude delegates to (§2), and a note
   that the checker (rule 5) enforces byte-identity of every prelude occurrence against the snippet
   in **this** file.

**Constraint:** the prelude block in `references/portable-root.md` MUST be byte-identical to the one
in `00-core-definitions.md §3` and §3 of this document. If they ever differ, the checker fails (and
the spec is defective). Cross-reference `00-core-definitions.md §3` as the originating definition.

## 5. Replacement procedure — the 23 loci (REQ-RES-03)

**Grep-verified at authoring** (`grep -rn 'CLAUDE_PLUGIN_ROOT' skills agents references hooks`):
**23 canonical occurrences across 9 files**, plus 1 exempt in `hooks/hooks.json`. Per-file counts
matched the table below exactly. **Re-grep at implementation time; do not trust these counts** —
the grep, not this table, is authoritative (`tech-spec.md §3.2`).

| File | Count | Kind | Action |
|------|-------|------|--------|
| `skills/forge-0-epic/SKILL.md` | 12 | 11 invocations + 1 **prose** (line ~44) | invocations → prelude + `"$R/scripts/…"`; prose → rewrite |
| `skills/forge/SKILL.md` | 3 | invocations | prelude + `"$R/scripts/…"` |
| `skills/forge-5-loop/SKILL.md` | 1 | invocation | prelude + `"$R/scripts/…"` |
| `skills/forge-6-docs/SKILL.md` | 1 | invocation | prelude + `"$R/scripts/…"` |
| `skills/forge-init/SKILL.md` | 1 | `bash` invocation | prelude + `bash "$R/scripts/…"` |
| `skills/forge-verify/SKILL.md` | 1 | invocation | prelude + `"$R/scripts/…"` |
| `skills/forge-verify/references/verification-checklists.md` | 1 | invocation | prelude + `"$R/scripts/…"` |
| `references/shared-conventions.md` | 2 | invocations | prelude + `"$R/scripts/…"` |
| `agents/forge-verifier.md` | 1 | **prose** (line ~104) | rewrite |
| **Total canonical** | **23** | | |

**Confirmed prose loci (read in source — classify these as PROSE, not invocations):**

- `skills/forge-0-epic/SKILL.md` line ~44: `` `${CLAUDE_PLUGIN_ROOT}` resolves to the installed
  plugin root. Pass `--specs-dir "{specsDir}"` …`` — descriptive sentence, **not** a runnable line.
- `agents/forge-verifier.md` line ~104:
  `` - `python`, `python3` — for running validation scripts via `${CLAUDE_PLUGIN_ROOT}/scripts/` ``
  — an allowlist-description line, **not** a runnable line.

**Per-kind transformation:**

- **INVOCATION lines** (`python3 "${CLAUDE_PLUGIN_ROOT}/scripts/<x>" …` / `bash ${CLAUDE_PLUGIN_ROOT}/scripts/<x>`):
  prepend the §3 bootstrap prelude to the **same fenced block** as the call, then rewrite the call
  to `python3 "$R/scripts/<x>" …` (or `bash "$R/scripts/<x>"`). One prelude per fenced block: if a
  block already contains the prelude (multiple calls in one block), it is added **once** and reused
  via `$R` for every call in that block; a fresh block gets its own prelude (per-block
  re-resolution, §3). The `forge-init` line currently reads `bash ${CLAUDE_PLUGIN_ROOT}/scripts/forge-init.sh`
  (note: unquoted) — rewrite to the quoted `bash "$R/scripts/forge-init.sh"` form.
- **PROSE mentions** (forge-0-epic ~44; forge-verifier.md ~104): rewrite the sentence to **describe
  the portable resolver** instead of the env var. The variable name must not survive. Suggested
  rewrites (final wording at impl time, meaning-preserving — REQ-COMPAT-01):
  - forge-0-epic ~44: "`$R` resolves to the installed plugin root via the portable resolver
    (`scripts/forge-root.sh`, bootstrapped by the prelude above; see `references/portable-root.md`).
    Pass `--specs-dir "{specsDir}"` on every invocation."
  - forge-verifier.md ~104: "`python`, `python3` — for running validation scripts under the plugin
    root resolved by the portable resolver (`scripts/forge-root.sh`; see `references/portable-root.md`)."

**EXEMPT (leave in place — do NOT rewrite):**

- `hooks/hooks.json` (1 occurrence, `bash ${CLAUDE_PLUGIN_ROOT}/scripts/session-check.sh`):
  non-canonical Claude artifact, exempt per **REQ-VND-04** / `00-core-definitions.md §6`. Recorded
  as `out-of-canon` in the vendor inventory (`02-frontmatter-purity-and-inventory.md`).
- The sanctioned residual inside `scripts/forge-root.sh` (§2 step 3): the single permitted
  `${CLAUDE_PLUGIN_ROOT}` in the canon, `preserved-as-spec-allowed`.

**Out of scope entirely** (NOT scanned, NOT rewritten — `00-core-definitions.md §6`
`RESIDUAL_VAR_EXEMPT`): `specs/`, `plans/`, `docs/` — these are feature-forge's own forge
artifacts, not shipped skill canon.

After this procedure, a fresh `grep -rn 'CLAUDE_PLUGIN_ROOT' skills agents references` over the
canonical surfaces must return **zero** matches (every match replaced by a prelude/`$R` form); the
only surviving occurrences in the whole tree are the two exempt ones above.

## 6. Error handling & security (REQ-RES-04, REQ-SEC-01)

**Resolver failure (REQ-RES-04).** When no strategy (self-location, candidate probe, env fallback)
resolves a root, `forge-root.sh` writes the exact message
`feature-forge: cannot locate plugin root. Set CLAUDE_PLUGIN_ROOT or run from an installed skill dir.`
to **stderr** and exits **1** (§2 step 4; contract in `00-core-definitions.md §7`). It never prints
an empty path and never exits `0` without a root.

**Prelude guard (REQ-RES-04).** The prelude's second line `[ -n "$R" ] || { echo "feature-forge:
cannot locate plugin root" >&2; exit 1; }` surfaces a failed resolution at the call site rather than
letting a downstream `python3 "$R/scripts/…"` run with an empty `$R` (which would otherwise execute
`python3 "/scripts/…"`). The guard converts "resolver unavailable / not yet executable" into an
immediate, visible failure in the invocation block.

**Security boundary (REQ-SEC-01).** Path resolution is **bounded** to (a) the script's own
on-disk location (step 1) and (b) the fixed candidate-root list (step 2), plus the user-provided
`${CLAUDE_PLUGIN_ROOT}` validated by the sentinel before use (step 3). The resolver:

- **Never sources** a discovered path (no `source`/`.`).
- **Never executes** a discovered path — it only ever `printf`s a directory string. (The `exec` in
  the *prelude* runs the trusted, sentinel-gated `forge-root.sh`, never a discovered candidate.)
- **Validates by content sentinel** (`is_root`, both `SENTINEL_FILES`) before trusting any
  candidate, so an attacker-controlled empty directory cannot masquerade as a root.

**Concurrency.** The resolver is idempotent and side-effect-free — it reads nothing it writes and
only `printf`s a directory string — so it is safe to invoke concurrently (e.g. from parallel skill
blocks) with no locking.

## Dependencies

- **`00-core-definitions.md`** — reuses `SENTINEL_FILES` + `is_root` (§2), the canonical
  `BOOTSTRAP_PRELUDE` string (§3, reproduced byte-identical here), `CANONICAL_SURFACES` /
  `RESIDUAL_VAR_EXEMPT` (§6), and the `forge-root.sh` exit-code contract (§7). Nothing here is
  redefined — all shared names are imported by reference.
- **`01-architecture-layout.md`** — §2 places `scripts/forge-root.sh` and `references/portable-root.md`;
  §4 declares the `portable-skill-root-resolver` contract; §5 notes the `validate.sh` executable-bit
  enforcement for `*.sh`.

**Consumed by other docs in this suite:**

- `04-body-size-discipline.md` accounts for the **size impact** of the prelude additions: swapping
  each `${CLAUDE_PLUGIN_ROOT}` line for the 2-line prelude grows the three oversized bodies, so
  reduction targets must leave headroom under the ≤300-line gate.
- `05-spec-purity-checker.md` **owns the checker** that enforces rule 3 (no residual var in
  canonical surfaces) and rule 5 (prelude byte-identity against `references/portable-root.md`).

## Verification

- [ ] `scripts/forge-root.sh` exists, is mode `0755`, and starts with `#!/usr/bin/env bash` +
      `set -euo pipefail`; `bash scripts/validate.sh` step 6 (`scripts/*.sh` is `-x`) passes for it.
- [ ] Run from inside an installed skill dir: `forge-root.sh` prints the absolute plugin root and
      exits `0` (self-location, step 1).
- [ ] Env-fallback path: with no discoverable root via steps 1–2 but `CLAUDE_PLUGIN_ROOT` set to a
      valid root, `forge-root.sh` prints it and exits `0` (step 3).
- [ ] Failure path: with no discoverable root and `CLAUDE_PLUGIN_ROOT` unset, `forge-root.sh` writes
      the **exact** stderr message and exits `1` (step 4; `00-core-definitions.md §7`).
- [ ] `is_root` uses both `SENTINEL_FILES` (`scripts/epic-manifest.py` +
      `.claude-plugin/plugin.json`) and never sources/executes a discovered path (REQ-SEC-01).
- [ ] `references/portable-root.md` exists and its prelude block is **byte-identical** to
      `00-core-definitions.md §3` and §3 of this doc.
- [ ] `grep -rn 'CLAUDE_PLUGIN_ROOT' skills agents references` returns **zero** matches; the only
      surviving occurrences tree-wide are the sanctioned residual in `scripts/forge-root.sh` and the
      exempt `hooks/hooks.json`.
- [ ] All 9 canonical files are rewritten per §5: invocations carry the prelude + `"$R/scripts/…"`;
      the two prose loci (forge-0-epic ~44, forge-verifier.md ~104) describe the portable resolver,
      not the env var.
- [ ] Every bootstrap-prelude occurrence across the canon is byte-identical (checker rule 5,
      `05-spec-purity-checker.md`).
- [ ] Behavioral smoke (REQ-COMPAT-03): under Claude Code, an `epic-manifest.py`-backed flow runs
      via the prelude + resolver exactly as before.
