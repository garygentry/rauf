# API Reference

All paths are relative to the **feature-forge** repo root.

## `build-adapters.py` — CLI

```
python3 scripts/build-adapters.py [--check] [--root PATH]
```

| Flag          | Description                                                                                                                                                     |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (none)        | **Full regenerate.** Rebuild the adapter tree from canon and atomically swap it over `adapters/`.                                                               |
| `--check`     | **Drift guard.** Regenerate to a temp dir and `diff -r` against the committed `adapters/`; print the diff + remediation on mismatch. Never mutates `adapters/`. |
| `--root PATH` | Repo root. Default: the parent of the script's directory (mirroring `check-spec-purity.py`).                                                                    |

### Exit codes (00 §9)

| Code | `generate()` (default)                                                                            | `check()` (`--check`)                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Regenerated successfully                                                                          | `adapters/` is in sync                                                                                                     |
| `1`  | `CanonError` — malformed/missing canon (`source_path: reason` on stderr); `adapters/` left intact | Drift detected — prints the diff and the regenerate remediation                                                            |
| `2`  | argparse usage error                                                                              | Usage error, missing `diff` binary, or a `diff -r` tool fault (returncode > 1) — distinct message, **no** remediation text |

## Key types (00 §2, §5, §6)

All record types are **frozen dataclasses**.

| Type            | Role                                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| `SkillRecord`   | A parsed `skills/<name>/SKILL.md` (name, description, frontmatter, body, source path, sibling files).     |
| `AgentRecord`   | A parsed `agents/<name>.md`.                                                                              |
| `EmittedFile`   | One output file (relative path + bytes) an emitter produced.                                              |
| `ManifestEntry` | An entry for an aggregate manifest (e.g. Gemini's `gemini-extension.json`, Codex's `agents/openai.yaml`). |
| `EmitResult`    | What an emitter returns for one record: `EmittedFile`s + `DropRecord`s + `ManifestEntry`s.                |
| `DropRecord`    | A dropped frontmatter key: file, agent, key, reason.                                                      |

### `Emitter` Protocol

```python
class Emitter(Protocol):
    agent_id: str
    def emit_skill(self, skill: SkillRecord) -> EmitResult: ...
    def emit_agent(self, agent: AgentRecord) -> EmitResult: ...
```

Implementations: `ClaudeEmitter`, `CursorEmitter`, `CodexEmitter`, `CopilotEmitter`,
`GeminiEmitter`.

### Error classes

`CanonError(Exception)` — base; renders `f"{source_path}: {reason}"` and stores both
attributes. Subclasses: `MalformedFrontmatterError`, `MissingNameError`,
`UnreadableFileError`. Any `CanonError` aborts the run with exit 1, staging removed,
`adapters/` intact.

## Module constants

| Constant                                                           | Value / meaning                                                                                                |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `AGENT_TARGETS`                                                    | `("claude", "codex", "copilot", "cursor", "gemini")` — canonical target order.                                 |
| `AGENT_TARGETS_REGISTRY`                                           | `dict[agent_id -> Emitter class]`; `build_emitters()` asserts its keys equal `AGENT_TARGETS`.                  |
| `FRONTMATTER_KEY_ORDER`                                            | Fixed emission order for frontmatter keys (determinism, REQ-DET-01).                                           |
| `REGENERATE_CMD`                                                   | `"python3 scripts/build-adapters.py"` — single-sourced into every provenance form and the remediation message. |
| `PROVENANCE_FM_COMMENT`                                            | Form A marker (YAML comment, first line inside `---`).                                                         |
| `PROVENANCE_BODY_TOP`                                              | Form B marker (HTML comment, first line of frontmatter-less markdown).                                         |
| `provenance_json(source)` / `PROVENANCE_JSON_KEY` (`"_generated"`) | Form C marker (JSON object) for strict-JSON manifests.                                                         |
| `GEMINI_EXTENSION_VERSION`                                         | `"0.0.0"` — fixed, canon-sourced manifest version (C-2).                                                       |
| `REMEDIATION_MESSAGE`                                              | Printed on `--check` drift, pointing at `REGENERATE_CMD`.                                                      |
| `RESIDUAL_VAR_EXEMPT` (`check-spec-purity.py`)                     | Includes `"adapters/**"` so generated output is not flagged by the purity checker.                             |

## Key functions

| Function                                                    | Purpose                                                                                          |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `discover_skill_paths(root)` / `discover_agent_paths(root)` | Sorted globs of `skills/*/SKILL.md` and `agents/*.md`.                                           |
| `parse_skill(path, root)` / `parse_agent(path, root)`       | Frontmatter → record; fail-fast on malformed/missing-name/unreadable.                            |
| `build_emitters()`                                          | Construct the agent-id → emitter map (in `AGENT_TARGETS` order); asserts registry/target parity. |
| `render_generation_report(drops)`                           | Render `GENERATION-REPORT.md` (Form B) from all `DropRecord`s.                                   |
| `_publish_manifest(...)`                                    | Serialize an aggregate manifest (Gemini JSON / Codex YAML) with its provenance.                  |
| `generate(root)`                                            | Full regenerate → staging → atomic swap. Returns the process exit code.                          |
| `check(root)`                                               | Build to staging → `diff -r` vs committed `adapters/`; never mutates. Returns the exit code.     |
| `main(argv=None)`                                           | argparse wiring; dispatches to `check` or `generate`.                                            |

## `adapters/` output layout

```
adapters/
├── GENERATION-REPORT.md          # Form B; per-file drop records
├── claude/   { skills/<name>/SKILL.md, agents/<name>.md, references/**, scripts/forge-root.sh }
├── codex/    { skills/<name>/<name>.md, agents/openai.yaml, references/**, scripts/forge-root.sh }
├── copilot/  { skills/<name>/<name>.md, agents/<name>.md, references/**, scripts/forge-root.sh }
├── cursor/   { skills/<name>/<name>.mdc, references/**, scripts/forge-root.sh }
└── gemini/   { <bodies>, gemini-extension.json, references/**, scripts/forge-root.sh }
```

Each `<agent>/` bundle carries its own `references/` tree and a byte-identical
`scripts/forge-root.sh` (mode 0755), so it is self-contained.

## `validate.sh` — gate integration

`scripts/validate.sh` step **6b** (a hard, top-level step) provisions `.venv-adapters` from
`scripts/requirements-adapters.txt` (`PyYAML==6.0.2`) and runs `build-adapters.py --check`.
A drift verdict and a venv-provisioning fault are reported as distinct failures; the step
has no SKIP/WARNING path. The feature's pytest suite (`tests/test_build_adapters.py`) runs
in the gate's pytest step.

## Tests

`tests/test_build_adapters.py` covers determinism (build-twice byte-equality + committed
snapshot), no-timestamp scan, atomic orphan purge, self-containment (parametrized per
agent), verbatim resolver hash, provenance Forms A/B/C, Claude `argument-hint` round-trip,
per-target description byte-fidelity, per-file drop enumeration, fail-fast (no partial tree /
no `adapters.tmp-*` leak), and the `--check` drift guard (clean → 0, mutated → 1 +
remediation). The purity-exemption behavior is covered in `tests/test_check_spec_purity.py`.
The suite skips gracefully when PyYAML is absent (`pytest.importorskip("yaml")`); the gate's
venv ensures it actually runs.
