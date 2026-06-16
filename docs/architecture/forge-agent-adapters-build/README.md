# Agent Adapters Build

`build-adapters` is feature-forge's **canonical-to-per-agent generator**. feature-forge
authors its skills and agents **once**, as a spec-pure canon (`skills/`, `agents/`,
`references/`). This generator walks that canon and emits a self-contained adapter bundle
for **five coding agents** — `claude`, `codex`, `copilot`, `cursor`, `gemini` — into a
committed `adapters/` tree. Each bundle is runnable by its agent **without reaching back**
into feature-forge, and carries a `GENERATED — DO NOT EDIT` provenance header.

Generation is **deterministic** (same canon → byte-identical output, no timestamps or
machine state) and a **full regenerate** (the output tree is rebuilt from scratch and
atomically swapped, never patched in place). A `--check` drift guard, wired into
`validate.sh`, fails the build if the committed `adapters/` no longer matches a fresh
generation.

> **Where this lives.** The implementation is in the **feature-forge** repo
> (`scripts/build-adapters.py` + the generated `adapters/` tree). The forge specs,
> backlog, and these architecture docs live in **rauf** (`specs/agent-agnostic/`,
> `docs/architecture/`) — this feature is member 3 of the `agent-agnostic` epic.

## Quick Start

```bash
# From the feature-forge repo root.

# Full regenerate: rebuild adapters/ from canon (atomic swap; exit 0 on success).
python3 scripts/build-adapters.py

# Drift guard: regenerate to a temp dir and diff vs the committed adapters/.
# Exit 0 = in sync, 1 = drift (prints diff + remediation), 2 = usage / diff-tool fault.
# Never mutates adapters/.
python3 scripts/build-adapters.py --check

# The full validation gate — provisions a venv and runs --check as a hard step (6b),
# alongside spec-purity and the pytest suite.
bash scripts/validate.sh
```

The single runtime dependency (`PyYAML==6.0.2`, pinned in
`scripts/requirements-adapters.txt`) is auto-provisioned by `validate.sh` into a
gitignored `.venv-adapters/`; everything else is Python 3 stdlib.

## Key Concepts

- **Canon** — the spec-pure source of truth: `skills/*/SKILL.md`, `agents/*.md`, and the
  shared `references/` tree, plus the portable `scripts/forge-root.sh` resolver. The
  generator treats canon as **read-only** (it never modifies it).
- **Emitter** — a per-agent strategy (one class per target) that translates one canonical
  `SkillRecord` / `AgentRecord` into that agent's native file shape. The five emitters are
  isolated, so a fix for one agent's format never touches another's.
- **Drop-with-record** — when a target's native frontmatter schema can't carry a canonical
  key (e.g. Codex/Copilot have no `argument-hint`), the emitter **drops** it and records
  the drop. All drops are enumerated in `adapters/GENERATION-REPORT.md` for auditability.
- **Provenance** — every generated file declares it is generated and how to regenerate, in
  one of three forms (YAML comment / HTML comment / JSON `_generated` key) depending on the
  file format.
- **Self-containment** — each `adapters/<agent>/` bundle ships its own copy of `references/`
  and a byte-identical `forge-root.sh`, so it runs standalone.
- **Determinism + drift guard** — output is a pure function of canon; `--check` proves the
  committed tree still matches, so a stale `adapters/` can never silently ship.

## Package Exports

| Entry point | Description |
|-------------|-------------|
| `scripts/build-adapters.py` | The generator CLI (`build-adapters`). Default = full regenerate; `--check` = drift guard. |
| `adapters/<agent>/` | Generated, committed per-agent bundles (`claude`, `codex`, `copilot`, `cursor`, `gemini`) — each self-contained. |
| `adapters/GENERATION-REPORT.md` | Audit record of every per-file frontmatter-key drop. |
| `AGENTS.md` (repo root) | Hand-authored cross-agent project instructions (build/test, conventions, install-path priority). Not generated. |
| `scripts/validate.sh` step 6b | The drift-guard gate (venv provision → `--check`). |
| `scripts/check-spec-purity.py` | Canon purity checker; carries the `adapters/**` residual-var exemption so generated output is not flagged. |

## When to use

- **After editing the canon** (`skills/`, `agents/`, `references/`, `forge-root.sh`):
  re-run `python3 scripts/build-adapters.py` and commit the regenerated `adapters/`.
- **In CI / pre-commit**: run `bash scripts/validate.sh` (or `build-adapters.py --check`)
  to fail fast when `adapters/` is out of date.
- **When adding a new agent target**: add one emitter class + one registry entry (see the
  [Integration Guide](./guides/integration.md)).

## When NOT to use

- **Do not hand-edit anything under `adapters/`** — it is regenerated wholesale and the
  drift guard will reject manual changes. Edit the canon instead, then regenerate.
- **Do not edit `AGENTS.md` via the generator** — it is hand-authored and lives at the repo
  root, outside `adapters/` and outside the drift guard.
- **Do not use it to author new skills** — it only *translates* existing canonical skills.

## Further Reading

- [Architecture](./architecture.md) — the generation pipeline, registry, provenance, and drift guard
- [API Reference](./api-reference.md) — CLI surface, exit codes, types, and constants
- [Integration Guide](./guides/integration.md) — consuming `adapters/`, regen workflow, adding an agent
