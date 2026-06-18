# Architecture

`build-adapters.py` is a single-file, stdlib-plus-PyYAML generator structured as a linear
pipeline with isolated per-agent emitters at the end. It is built for two properties above
all: **determinism** (same canon in → byte-identical tree out) and **safety** (a failed run
never leaves a partial or stale `adapters/`).

## The generation pipeline

```
discover → parse → emit (per agent) → provenance → self-containment → atomic publish
```

1. **Discover** (`discover_skill_paths`, `discover_agent_paths`) — glob `skills/*/SKILL.md`
   and `agents/*.md` under the repo root, sorted by repo-relative POSIX path so iteration
   order is stable across machines.
2. **Parse** (`parse_skill`, `parse_agent`) — read each file's YAML frontmatter into a
   frozen `SkillRecord` / `AgentRecord`. Parsing is **fail-fast**: a malformed frontmatter
   block raises `MalformedFrontmatterError`, a missing `name` raises `MissingNameError`, and
   an unreadable file raises `UnreadableFileError`. Any of these aborts the whole run before
   a single output file is published (see _Atomic publish_).
3. **Emit** — for each target agent (in `AGENT_TARGETS` order), the registered `Emitter`
   translates every record into that agent's native files, returning an `EmitResult`
   (`EmittedFile`s + any `DropRecord`s + `ManifestEntry`s).
4. **Provenance** — each emitted file gets a `GENERATED — DO NOT EDIT` marker in the form
   its format allows (see _Provenance forms_).
5. **Self-containment** — each `adapters/<agent>/` bundle receives a verbatim copy of the
   whole `references/` tree and a byte-identical `scripts/forge-root.sh`, so it runs without
   the canon present.
6. **Atomic publish** — the full tree is built into a sibling staging dir and swapped over
   `adapters/` in one move (see _Atomic publish & failure semantics_).

## The five emitters & the registry

Each target is one class implementing the `Emitter` Protocol (`emit_skill`, `emit_agent`,
`agent_id`):

| Agent     | Emitter          | Native skill shape | Agent files                      | Notes                                                                           |
| --------- | ---------------- | ------------------ | -------------------------------- | ------------------------------------------------------------------------------- |
| `claude`  | `ClaudeEmitter`  | `SKILL.md` mirror  | `agents/<name>.md`               | Lossless; reconstructs top-level `argument-hint` for hinted skills.             |
| `cursor`  | `CursorEmitter`  | `<name>.mdc` rule  | —                                | Frontmatter reduced to `description` / `globs` / `alwaysApply` (no `name`).     |
| `codex`   | `CodexEmitter`   | `<name>.md`        | aggregate `agents/openai.yaml`   | Safe-default `{name, description}` frontmatter; extra keys dropped-with-record. |
| `copilot` | `CopilotEmitter` | `<name>.md`        | `agents/<name>.md`               | Copilot frontmatter; extra keys dropped-with-record.                            |
| `gemini`  | `GeminiEmitter`  | body file          | `gemini-extension.json` manifest | Manifest carries skills/agents; fixed canon-sourced `version` (`0.0.0`).        |

The registry (`AGENT_TARGETS_REGISTRY`) maps each agent id to its emitter class.
`build_emitters()` asserts the registry's key set equals `AGENT_TARGETS` exactly, so adding
an agent to one place but not the other fails loudly rather than silently skipping a target.

## Provenance forms

A generated file must announce itself, but the marker syntax depends on the format. There
are three forms (00 §7):

- **Form A — files _with_ a YAML frontmatter block** (Claude `SKILL.md`, Cursor `.mdc`,
  agent files): a YAML **comment** as the first line _inside_ the `---` block, so `---`
  stays byte 0 for strict parsers.
- **Form B — frontmatter-less generated markdown** (`GENERATION-REPORT.md`): an HTML comment
  as the file's first line.
- **Form C — strict JSON** (`gemini-extension.json`): no comments are possible, so a
  documented top-level `_generated` object is serialized alongside the manifest.

All three single-source the same regenerate command (`python3 scripts/build-adapters.py`).

## Drop-with-record

Not every agent's frontmatter schema can carry every canonical key. Rather than silently
losing data, an emitter drops the unsupported key and appends a `DropRecord` naming the
file, the agent, the dropped key, and the reason. Every drop is enumerated per-file in
`adapters/GENERATION-REPORT.md`, so the translation is fully auditable (and a _missing_
expected drop is as visible as an unexpected one).

## Atomic publish & failure semantics

`generate()` never edits `adapters/` in place:

1. Build the entire new tree into a sibling staging dir `adapters.tmp-<pid>/`.
2. On success, `os.replace()`-swap the staging dir over `adapters/` (atomic rename), then
   remove the old tree.
3. On **any** error (a `CanonError` from parse, or any other exception), remove the staging
   dir and leave the existing `adapters/` **untouched**.

So a run either fully succeeds or changes nothing — there is no partial-write window and no
leaked `adapters.tmp-*` dir.

`check()` (the `--check` path) builds the same staging tree, runs `diff -r` against the
committed `adapters/`, and **never** mutates `adapters/`. It cleans its staging dir in a
`finally` block regardless of outcome.

## Gate wiring & purity exemption

- **`validate.sh` step 6b** — a hard top-level step (outside the optional-helper guard):
  provision `.venv-adapters` from `requirements-adapters.txt`, then run
  `build-adapters.py --check`. A drift verdict and a venv-provisioning fault are reported as
  distinct failures; either bumps the error count and fails the gate.
- **`check-spec-purity.py` exemption** — the generated tree would otherwise trip the canon
  purity checker (it legitimately contains residual template vars copied from canon). A
  single `adapters/**` entry is added to `RESIDUAL_VAR_EXEMPT`. The exemption is scoped to
  `adapters/` only — `CANONICAL_SURFACES` is unchanged, so canon enforcement is not weakened.

## Decisions

- **Determinism over convenience (REQ-DET-01).** No timestamps, PIDs, or host state appear
  in output; frontmatter keys are emitted in a fixed `FRONTMATTER_KEY_ORDER`; discovery is
  sorted. This is what makes `--check` a reliable drift guard.
- **Pinned YAML (TQ-2).** `PyYAML==6.0.2` is pinned in `requirements-adapters.txt`; the YAML
  emitter's formatting is part of the determinism contract, so the version is part of it too.
- **Isolated emitters (TQ-1).** Codex/Copilot/Cursor/Gemini native frontmatter schemas are
  confirmed against each agent's docs; because each emitter is a separate class, a schema
  correction stays local to one target.
- **Fixed Gemini extension version (C-2).** feature-forge ships no `package.json`, so the
  manifest `version` is a fixed canon-sourced constant rather than derived at runtime.
- **Committed output (not build-time only).** `adapters/` is committed so consumers (the
  cross-agent installer, CI) can read it without running the generator; the drift guard keeps
  it honest.

## Data flow

```
skills/*/SKILL.md ─┐
agents/*.md ───────┤ discover+parse ─→ records ─→ [Emitter per agent] ─→ EmittedFiles
references/** ─────┘                                   │                    + DropRecords
forge-root.sh ─────────── verbatim copy ───────────────┤                    + ManifestEntries
                                                        ▼
                                  adapters.tmp-<pid>/{claude,codex,copilot,cursor,gemini}/
                                          + GENERATION-REPORT.md
                                                        │  os.replace (atomic)
                                                        ▼
                                                   adapters/
```
