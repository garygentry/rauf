# Integration Guide

This feature is the **root of the `agent-agnostic` epic dependency graph**: it produces the
read-only inputs every downstream feature consumes. This guide covers how those consumers
use the canon, plus how a maintainer keeps the canon pure.

## Exposed artifacts (epic manifest contract)

| Artifact | What it is | Consumed by |
|----------|-----------|-------------|
| `spec-pure-skills` | The 11 conforming `skills/*/SKILL.md` + their `references/` | `forge-agent-adapters-build`, `packaging-docs-ci` |
| `portable-skill-root-resolver` | `scripts/forge-root.sh` (+ the canonical prelude in `references/portable-root.md`) | `forge-agent-adapters-build` |

## For `forge-agent-adapters-build`

This feature produced the single neutral source; the adapter build derives every per-agent
artifact from it. Two integration points:

1. **Read the canon as-is.** Each `SKILL.md` now has a frontmatter of exactly
   `{name, description[, metadata]}`. Claude's `argument-hint` was relocated **losslessly**
   to `metadata.argument-hint`, so the adapter generator can reconstruct Claude-native
   output with no information loss. Descriptions are byte-unchanged (trigger-tuned).
2. **Copy the resolver verbatim.** `forge-root.sh` is intentionally dependency-free so it
   can be mirrored into each per-agent script tree unchanged. The bootstrap prelude in skill
   bodies references it; when you add per-agent discovery paths, extend the resolver's
   **candidate-probe** list (step 2) — that is the single authoritative multi-root list.

> The prelude's discovery globs are still Claude-only (`~/.claude/...`). Adding non-Claude
> discovery paths so a foreign agent can bootstrap-find the resolver is `cross-agent-installer`'s
> job, not the adapter build's.

## For `packaging-docs-ci`

Wire the checker into CI as the spec-purity gate — it is already runnable and self-contained:

```yaml
- name: spec-purity
  run: python3 scripts/check-spec-purity.py
```

It needs only Python 3 stdlib (no `pyyaml`, no install step), exits non-zero with a
per-violation report on any impurity, and is already invoked unconditionally inside
`scripts/validate.sh` — so CI can call either the checker directly or the full gate. Do not
re-derive the rules; this feature owns them.

## Keeping the canon pure (maintainer)

Run the gate before committing any skill change:

```bash
python3 scripts/check-spec-purity.py     # fast, scoped to the five rules
bash scripts/validate.sh                 # full gate (checker runs as one step)
```

Common violations and fixes:

- **`disallowed frontmatter key '…'`** — move vendor data under `metadata:`; only
  `{name, description, license, compatibility, metadata, allowed-tools}` are allowed.
- **`residual ${CLAUDE_PLUGIN_ROOT} …`** — replace the invocation with the bootstrap
  prelude + `"$R/scripts/…"`. The only sanctioned residual is the fallback inside
  `forge-root.sh`. If you are *documenting* the construct as prose, add the file to
  `RESIDUAL_VAR_EXEMPT` (as `references/vendor-construct-inventory.md` is).
- **`body … lines exceeds 300` / `words exceeds 5000`** — relocate overflow into the
  skill's `references/` and leave an in-body pointer; never delete instructions.
- **`bootstrap prelude not byte-identical to canon`** — copy the prelude verbatim from
  `references/portable-root.md`; do not reflow or edit it.

### Adding a new rule or reason string

The reason strings are `VR_*` constants and the rules are `Rule` enum members. Per the
testing strategy, adding a rule/reason/reader-corner **without** its matching fixture +
assertion is a CI regression — add a fixture under `tests/fixtures/` and an assertion in
`tests/test_check_spec_purity.py` in the same change.

## Out of scope (do not do here)

- No per-agent output (Codex/Copilot/Cursor/Gemini mirrors, `AGENTS.md`) — that is
  `forge-agent-adapters-build`.
- No CI gates / OS matrices / versioning alignment — that is `packaging-docs-ci`.
- No non-Claude bootstrap-discovery paths — that is `cross-agent-installer`.
- No changes to skill descriptions or triggering behavior — this refactor is behavior-preserving.
