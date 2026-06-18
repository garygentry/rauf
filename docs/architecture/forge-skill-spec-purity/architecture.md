# Architecture

This document explains how the spec-purity canon is defined and enforced: the canonical
surface the checker polices, the five rules, the portable resolver and the bootstrap
prelude that replaced the Claude-only env var, how the checker hard-gates `validate.sh`,
and the decisions that bound the work.

## The canonical surface

"Canon" is the set of shipped, vendor-neutral skill files. The checker scans exactly:

```python
CANONICAL_SURFACES = (
    "skills/**/SKILL.md",        # the 11 skill bodies
    "skills/**/references/**/*",  # per-skill relocated reference docs
    "references/**/*",            # shared reference docs (incl. the prelude canon)
    "agents/*.md",                # dispatched subagent definitions
)
```

> **Glob shape matters.** A bare trailing `/**` matches _directories only_ in `pathlib`;
> the recursive patterns therefore end in `/**/*` to reach the files inside the
> `references/` trees. (An earlier `/**` form silently scanned 0 reference files — a
> false PASS caught in impl verification and fixed; the test suite now plants violations
> under `references/` paths to lock the scope.)

Deliberately **outside** canon: `hooks/hooks.json` (a Claude-specific artifact, REQ-VND-04)
and the feature's own `specs/`, `plans/`, `docs/`. These, plus `scripts/forge-root.sh` and
the audit-prose inventory, form `RESIDUAL_VAR_EXEMPT` — paths skipped by the residual-var
rule even when they fall under a scanned tree.

## The five rules

`check-spec-purity.py` runs five independent checks (each a `Rule` enum member). All are
hard-fail: any violation makes the checker exit 1.

| #   | Rule (`Rule.value`) | What it asserts                                                                                                                                                                        | Requirement  |
| --- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1   | `frontmatter-keys`  | Frontmatter parses; keys ⊆ {name, description, license, compatibility, metadata, allowed-tools}; name+description present. A malformed block is a _reported violation_, never a crash. | REQ-FM-01/04 |
| 2   | `name-matches-dir`  | Each skill's frontmatter `name` equals its containing directory.                                                                                                                       | REQ-FM-02    |
| 3   | `no-residual-var`   | No literal `${CLAUDE_PLUGIN_ROOT}` in any canonical-surface file, except `RESIDUAL_VAR_EXEMPT` paths.                                                                                  | REQ-RES-03   |
| 4   | `body-size`         | Each `SKILL.md` body (below the closing `---`) is ≤ 300 lines AND ≤ 5000 words. Both limbs are checked, so an over-budget body can emit two violations.                                | REQ-SIZE-03  |
| 5   | `prelude-identity`  | Any file containing the prelude sentinel must contain the canonical `BOOTSTRAP_PRELUDE` byte-for-byte.                                                                                 | REQ-RES-05   |

Violations are collected, then **sorted by `(path, rule.value, reason)`** so repeated runs
over the same tree produce byte-identical output (a determinism contract the test suite
pins). The reason strings are single-source constants (`VR_*`), never re-typed inline, so a
fixture asserting a reason token can't drift from what the checker emits.

The frontmatter reader is hand-rolled (stdlib only — no `pyyaml`), tolerant of the corners
that matter: colon-in-value, folded scalars, nested `metadata`, blank lines, and CRLF; a
missing closing `---` is reported as `malformed frontmatter block`.

## Portable script-root resolution

Before this feature, bundled scripts were located via `${CLAUDE_PLUGIN_ROOT}` — undefined
under any non-Claude agent. `scripts/forge-root.sh` replaces that with a content-based,
four-step resolution (it only ever **prints** a directory — never sources or executes one,
REQ-SEC-01):

```
1. Self-location   — parent of the script's own dir, if it is a valid root.
2. Candidate probe — $HOME/.claude/skills/feature-forge and
                     $HOME/.claude/plugins/*/feature-forge.
3. Env fallback    — $CLAUDE_PLUGIN_ROOT, the single sanctioned residual (Claude, C-4).
4. Failure         — actionable message to stderr, exit 1.
```

A directory is a valid root iff **both** sentinel files exist — `scripts/epic-manifest.py`
AND `.claude-plugin/plugin.json` — so the probe identifies a real install under any
agent's layout and rejects an unexpanded glob literal (globs matching nothing expand to
themselves). The resolver is deliberately dependency-free: `forge-agent-adapters-build`
copies it **verbatim** into per-agent script mirrors.

### The bootstrap prelude

Skill bodies and references can't call a Bash function, so each former `${CLAUDE_PLUGIN_ROOT}`
invocation now opens its fenced block with a canonical two-line prelude that runs the
resolver and binds `$R`:

```bash
R="$(for d in "$HOME"/.claude/skills/feature-forge "$HOME"/.claude/plugins/*/feature-forge; do [ -x "$d/scripts/forge-root.sh" ] && exec "$d/scripts/forge-root.sh"; done)"
[ -n "$R" ] || { echo "feature-forge: cannot locate plugin root" >&2; exit 1; }
```

Invocations then call `python3 "$R/scripts/<x>"`. One prelude per fenced block; `$R` is
reused for multiple calls. The single canonical copy lives in `references/portable-root.md`;
rule 5 enforces byte-identity everywhere it appears (23 canonical occurrences across 9
files were routed).

> **Scope boundary.** The prelude's discovery globs are still Claude-only (`~/.claude/...`).
> Wiring per-agent discovery paths so a non-Claude agent can bootstrap-discover the resolver
> belongs to `cross-agent-installer`, not here. This feature removes the env-var coupling;
> it does not add non-Claude discovery.

## Gate wiring

`check-spec-purity.py` is invoked as one **unconditional** top-level step in
`scripts/validate.sh`, placed _after_ the script-permission loop and _before_ the
`epic-manifest` helper guard (so it runs even when that guard is skipped). A non-zero
checker exit increments `ERRORS`, so `validate.sh` fails hard — there is no soft-skip path
(the checker needs only Python 3 stdlib, so it is always available). `*.py` is intentionally
not added to the executable-permission glob; the checker is invoked via `python3`.

## Decisions

- **D1 — Body budget = ≤ 300 lines AND ≤ 5000 words.** Tightens the PRD's provisional
  500/5000 (explicitly permitted; never loosened). 300 captures all three over-budget
  skills (`forge-0-epic` 517, `forge-5-loop` 418, `forge-verify` 337) with the next-largest
  skill comfortably under. Overflow was **relocated** into each skill's `references/`
  (never deleted), with an explicit in-body pointer to each moved block.
- **D2 — One Bash resolver.** A single `forge-root.sh` (not a Bash+Python pair) keeps the
  unit copy-able verbatim into per-agent mirrors and dependency-free.
- **D3 — `hooks.json` stays out of canon.** Left in place as a documented Claude artifact
  (REQ-VND-04); the adapter build treats it accordingly.
- **D4 — Stdlib-only checker.** No `pyyaml`, matching `epic-manifest.py`; the frontmatter
  reader is hand-rolled. `Rule` uses the `(str, enum.Enum)` mixin (not 3.11's `StrEnum`) to
  run on the repo's Python 3.10 baseline.

## Data flow

```
skills/*/SKILL.md + references/ + agents/   ──┐
                                              ├─► check-spec-purity.py ─► sorted Violations ─► exit 0|1
RESIDUAL_VAR_EXEMPT, BOOTSTRAP_PRELUDE canon ─┘            ▲
                                                           │ (unconditional step)
bundled script invocation ─► bootstrap prelude ─► forge-root.sh ─► $R   validate.sh gate
```
