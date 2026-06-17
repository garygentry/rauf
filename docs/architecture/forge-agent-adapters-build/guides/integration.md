# Integration Guide

How `forge-agent-adapters-build` fits the `agent-agnostic` epic, and how to work with it.

## Exposed artifacts (epic manifest contract)

This feature exposes three contracts to the rest of the epic:

| Exposed           | Kind     | Summary                                                                                                     |
| ----------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `build-adapters`  | function | The generator deriving per-agent artifacts (claude/codex/copilot/cursor/gemini) from the canonical skills.  |
| `AGENTS.md`       | module   | Hand-authored cross-agent project instructions: build/test, conventions, install-path priority.             |
| `adapters-output` | module   | The generated `adapters/` tree (per-agent skill mirrors + manifests) consumed by the installer and CI diff. |

It **consumes** two contracts from its dependency `forge-skill-spec-purity`:

- `spec-pure-skills` — the read-only canonical input the generator derives everything from.
- `portable-skill-root-resolver` — `scripts/forge-root.sh`, copied verbatim into every
  generated per-agent bundle so the bundle resolves its own root.

## For `cross-agent-installer` (the direct dependent)

`cross-agent-installer` is the next epic feature and the primary consumer of this one. It
should treat `adapters/` as a **read-only, pre-built input**:

- Install a target agent's bundle by copying `adapters/<agent>/` into the user's project /
  agent config location. Each bundle is self-contained (`references/` + `forge-root.sh`
  included), so no post-copy fixup against feature-forge is required.
- Use `adapters/GENERATION-REPORT.md` if the installer wants to surface what each agent does
  and doesn't support.
- Honor `AGENTS.md`'s documented **install-path priority** (Claude marketplace preferred,
  then the universal/cross-agent fallback).
- The installer should **not** invoke the generator at install time — `adapters/` is
  committed precisely so consumers read it directly. Regeneration is a maintainer action.

## For CI / `packaging-docs-ci`

Wire the drift guard into CI so a stale `adapters/` can't merge:

```bash
bash scripts/validate.sh            # full gate (includes step 6b)
# or, just the adapters drift guard:
python3 scripts/build-adapters.py --check
```

`--check` exits non-zero on drift and prints both the offending diff and the regenerate
command, so a failed CI run is self-explanatory.

## Regeneration workflow (maintainer)

Any change to the canon must be followed by a regenerate-and-commit:

```bash
# 1. Edit canon (skills/, agents/, references/, or scripts/forge-root.sh).
# 2. Regenerate the committed adapter tree.
python3 scripts/build-adapters.py
# 3. Review the diff — especially adapters/GENERATION-REPORT.md for new/changed drops.
git add adapters/ && git status
# 4. Confirm the gate is green before committing.
bash scripts/validate.sh
```

If you bump `PyYAML`, treat it as a determinism change: regenerate, review the (possibly
formatting-only) diff, and commit the new baseline — the pinned version in
`scripts/requirements-adapters.txt` is part of the output contract.

## Adding a new agent target

The generator is built so a new agent is **one emitter + one registry entry** (REQ-SCALE-01):

1. Add `"<agent>"` to `AGENT_TARGETS`.
2. Write a `<Agent>Emitter` class implementing the `Emitter` Protocol (`agent_id`,
   `emit_skill`, `emit_agent`), translating records into that agent's native frontmatter and
   filenames. Drop unsupported keys via `DropRecord` rather than silently.
3. Register it in `AGENT_TARGETS_REGISTRY` (the `build_emitters()` parity assert will fail
   the build if you add to only one of the two).
4. Regenerate, then add the new bundle's snapshot/self-containment expectations to
   `tests/test_build_adapters.py` (the per-agent tests are parametrized) and commit the new
   `adapters/<agent>/` baseline.

No pipeline, discovery, parsing, provenance, or publish code needs to change — those stages
are agent-agnostic.

## Out of scope (do not do here)

- **Authoring new skills/agents** — this feature only _translates_ existing canon.
- **Modifying canon** — `skills/`, `agents/`, `references/`, and `scripts/forge-root.sh` are
  consumed read-only (constraint C-3). The generated bundles' resolvers are byte-identical
  copies, never edited.
- **Hand-editing `adapters/`** — regenerated wholesale; the drift guard rejects manual edits.
- **Generating `AGENTS.md`** — it is hand-authored at the repo root, outside `adapters/` and
  the drift guard.
