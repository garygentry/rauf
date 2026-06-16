# 00 — Core Definitions

> Feature: `forge-agent-adapters-build` (epic `agent-agnostic`, member 3 of 6, target repo
> **feature-forge** at `/home/gary/workspace/feature-forge`). Source of truth: `PRD.md` (v1) +
> `tech-spec.md` (v1). This document defines the shared contracts every other spec in this suite
> references: the target-agent set, the in-memory record types the generator parses canon into, the
> emitter protocol + registry, the drop-with-record and provenance data models, the error
> hierarchy, the fixed key-emission order, and the CLI exit-code contract. Cross-references use exact
> filenames (e.g. `03-per-agent-emitters.md`).
>
> **Stack note:** the configured `stack` is `typescript`, but this feature ships **Python 3 +
> Bash + Markdown** in feature-forge — there is **no** TypeScript and **no** `pnpm` gate (constraint
> **C-2**). All code below is exact Python 3 / Bash, not pseudocode, following the existing
> `scripts/epic-manifest.py` / `tests/conftest.py` conventions (Google-style docstrings, full type
> annotations, `set -euo pipefail` for shell, **3.10 baseline** — same as `epic-manifest.py`). The
> TypeScript stack profile does not apply.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-GEN-01 | Walk skills/ + agents/; parse frontmatter+body | §2 (`SkillRecord`, `AgentRecord`), §3 (parse contract) |
| REQ-GEN-03 | Five target agents in v1 | §1 (`AGENT_TARGETS`) |
| REQ-GEN-06 | Sub-agent translation; per-file Claude-only keys | §2 (`AgentRecord.claude_keys`), §5 (`Emitter`) |
| REQ-FMT-01 | Native per-agent output | §5 (`Emitter`, `EmitResult`, `EmittedFile`) |
| REQ-FMT-03 | Omit-with-record for unrepresentable constructs | §6 (`DropRecord`), §5 |
| REQ-FMT-04 | `description` byte-fidelity | §2 (field contracts), §4 (key order) |
| REQ-VND-01 | Claude `argument-hint` reconstruction | §2 (`SkillRecord.metadata`) |
| REQ-OUT-01 | Provenance header on every generated file | §7 (`Provenance`, header constants) |
| REQ-DET-01 | Determinism: fixed ordering, no nondeterminism | §1, §4 (`FRONTMATTER_KEY_ORDER`), §8 |
| REQ-ROB-01 / REQ-OBS-02 | Fail-fast with per-file error | §8 (`CanonError` hierarchy) |
| REQ-OBS-01 | Generation report / drop-with-record record | §6 (`DropRecord`) |
| REQ-CI-03 | Drift remediation message | §9 (`REMEDIATION_MESSAGE`) |
| REQ-GEN-02 | Single non-interactive command; exit codes | §9 (CLI exit contract) |

> This is a foundation document: it defines **names, types, and constants** only. The *procedures*
> that use them live in `02-generator-engine.md` (discovery/parse/publish),
> `03-per-agent-emitters.md` (the five emitters), and
> `04-provenance-selfcontainment-report.md` (headers + report). The layout that hosts them is
> `01-architecture-layout.md`.

## 1. Target Agents (REQ-GEN-03, REQ-DET-01)

The five v1 targets, in a **fixed canonical order** (also alphabetical) that pins directory-walk
and report ordering for determinism:

```python
from __future__ import annotations

# The five v1 target agents (REQ-GEN-03). Order is FIXED (alphabetical) and is the
# emit/report iteration order — never sort at runtime, never reorder (REQ-DET-01).
AGENT_TARGETS: tuple[str, ...] = ("claude", "codex", "copilot", "cursor", "gemini")
```

Every emitter (`§5`) is keyed by one of these ids. Adding a sixth agent is an additive registry
entry (a new `Emitter` + one tuple element), never a structural change — but is out of v1 scope.

## 2. Canonical Record Types (REQ-GEN-01)

The generator parses each canonical markdown file into one of two frozen records. These are the
**only** data the emitters consume — an emitter never re-reads canon from disk (`02-generator-engine.md §2`).

```python
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class SkillRecord:
    """One parsed canonical skill (`skills/<name>/SKILL.md`).

    Attributes:
        name: The skill id; MUST equal the containing directory name
            (`skills/<name>/`). Emitters MUST NOT rename it.
        description: Skill description, preserved BYTE-FOR-BYTE from canon
            (REQ-FMT-04). Never reflowed, re-quoted lossily, or trimmed.
        metadata: The optional `metadata` map, or None. For 10 of 11 skills this
            holds `{"argument-hint": "<...>"}` (relocated from Claude's top-level
            key upstream); `forge-init` has no metadata (None). The Claude emitter
            reconstructs top-level `argument-hint` from `metadata["argument-hint"]`
            (REQ-VND-01).
        body: The markdown body — everything after the closing frontmatter `---`.
            Copied verbatim into each target's skill artifact.
        own_refs: Absolute path to this skill's own `references/` subdir if it has
            one, else None. 7 of 11 skills have one (see `01-architecture-layout.md §7`).
        source_path: Repo-relative POSIX path of the SKILL.md (for provenance + errors).
    """

    name: str
    description: str
    metadata: dict[str, object] | None
    body: str
    own_refs: Path | None
    source_path: str


@dataclass(frozen=True)
class AgentRecord:
    """One parsed canonical sub-agent (`agents/<name>.md`).

    Sub-agent frontmatter is NOT a fixed schema (tech-spec §4 / verifier V-001):
    each file carries its own subset of Claude-only keys, discovered per-file. The
    union actually present across the current 3 agents is
    {tools, model, maxTurns, effort, memory, skills} — `effort` only on
    forge-researcher, `memory`+`skills` only on forge-verifier. A future agent that
    adds a new Claude-only key is auto-covered: `claude_keys` carries whatever
    non-{name,description} keys the file actually has (REQ-SCALE-01).

    Attributes:
        name: Sub-agent id; equals `agents/<name>.md` stem.
        description: Preserved BYTE-FOR-BYTE (REQ-FMT-04).
        body: Markdown body after the closing frontmatter `---`.
        claude_keys: Ordered mapping of every parsed frontmatter key EXCEPT
            `name`/`description`, in source order. Drives drop-with-record: each
            emitter enumerates THIS dict, never a hard-coded list, so no key is
            silently dropped (REQ-GEN-06, REQ-FMT-03, REQ-OBS-01).
        source_path: Repo-relative POSIX path (for provenance + errors).
    """

    name: str
    description: str
    body: str
    claude_keys: dict[str, object]
    source_path: str
```

**Verified canon ground truth** (forge-researcher report, branch `forge/skill-spec-purity`):

| Agent | `claude_keys` actually present |
|-------|-------------------------------|
| `forge-researcher` | `tools`, `model`, `maxTurns`, `effort` |
| `forge-spec-writer` | `tools`, `model`, `maxTurns` |
| `forge-verifier` | `tools`, `model`, `maxTurns`, `memory`, `skills` |

`SkillRecord.description` / `AgentRecord.description`: the **decoded scalar** is what must round-trip
byte-for-byte; the YAML dumper is configured to preserve it (`02-generator-engine.md §3`), and a
test asserts decoded equality per target (`06-testing-strategy.md`).

## 3. Frontmatter Parse Contract (REQ-GEN-01, REQ-ROB-01)

Canon is parsed with the **pinned YAML library** (`safe_load`) — unlike the upstream checker, this
generator is permitted a YAML dependency (constraint **C-4**; the pin is part of the determinism
contract, `02-generator-engine.md §3`). The parse step splits each file into
`(frontmatter_map: dict, body: str)`:

- The frontmatter block is delimited by the first `---` line (column 0) and the next `---` line. A
  file with no well-formed open/close pair → `MalformedFrontmatterError` (§8), never a crash.
- `frontmatter_map` is the `safe_load` of the block. A non-mapping result (e.g. a bare scalar) →
  `MalformedFrontmatterError`.
- A missing or non-string `name` → `MissingNameError` (§8). `name` for skills is additionally
  asserted to equal `<dir>` (a defensive re-check; canon is pre-gated pure upstream).
- `AgentRecord.claude_keys` = `frontmatter_map` minus `name`/`description`, preserving source key
  order (Python dicts preserve insertion order; `safe_load` inserts in document order).

Because canon is pre-gated pure by `check-spec-purity.py` upstream (`05-purity-exemption-and-drift-guard.md`),
any parse failure here is a **real defect that MUST block** (REQ-ROB-01) — never silently skipped.

## 4. Fixed Key-Emission Order (REQ-DET-01)

Every emitter that writes YAML frontmatter MUST emit keys in a **fixed order** (the YAML dumper is
invoked with `sort_keys=False`, `02-generator-engine.md §3`). The canonical order:

```python
# Fixed frontmatter key-emission order for determinism (REQ-DET-01). Emitters
# project their native key set onto this order; keys a target doesn't use are
# skipped, never reordered. `description` is emitted verbatim (REQ-FMT-04).
FRONTMATTER_KEY_ORDER: tuple[str, ...] = (
    "name",
    "description",
    "argument-hint",   # claude only (reconstructed, REQ-VND-01)
    "globs",           # cursor .mdc
    "alwaysApply",     # cursor .mdc
    "tools",           # sub-agents, where representable
    "model",
    "maxTurns",
    "effort",
    "memory",
    "skills",
)
```

This is the **superset** ordering; each emitter (`03-per-agent-emitters.md`) selects the subset its
native format defines. A key present in a record but absent from a target's selected subset is a
**drop-with-record** (§6), not a silent omission.

## 5. Emitter Protocol & Registry (REQ-FMT-01, REQ-GEN-06)

Each target agent is implemented by one **emitter** — a pluggable unit keyed by agent id. The
registry maps `AGENT_TARGETS` → emitter, so the engine (`02-generator-engine.md`) iterates targets
uniformly and a per-agent fix stays localized (tech-spec §3.1).

```python
from typing import Protocol


@dataclass(frozen=True)
class EmittedFile:
    """One file an emitter produces, relative to its agent bundle root.

    Attributes:
        relpath: Path under `adapters/<agent>/` (POSIX). E.g.
            `skills/forge-1-prd/SKILL.md` or `gemini-extension.json`.
        content: Full file bytes as text (provenance header already applied,
            §7). The engine writes this verbatim.
        mode: POSIX file mode; 0o644 default, 0o755 for copied scripts
            (forge-root.sh, REQ-GEN-05).
    """

    relpath: str
    content: str
    mode: int = 0o644


@dataclass(frozen=True)
class EmitResult:
    """Everything one emitter produces for one canonical record.

    Attributes:
        files: The native artifact(s) for this record (skill body, manifest, etc.).
            References + forge-root.sh copies are added by the engine's
            self-containment pass, not the emitter (`04-...-report.md §2`).
        drops: Constructs that had no native representation in this target
            (REQ-FMT-03), each recorded for the generation report (§6, REQ-OBS-01).
    """

    files: tuple[EmittedFile, ...]
    drops: tuple["DropRecord", ...]


class Emitter(Protocol):
    """Translates one canonical record into one target agent's native artifacts.

    One implementation per agent id in AGENT_TARGETS. Emitters are PURE: given the
    same record they return byte-identical EmitResults (REQ-DET-01); they read no
    clock, env, RNG, or filesystem. The engine owns discovery, the references/
    closure, atomic publish, and report assembly — the emitter only maps a record
    to native bytes + drop records.
    """

    agent_id: str  # one of AGENT_TARGETS

    def emit_skill(self, skill: SkillRecord) -> EmitResult:
        """Map a canonical skill to this agent's native skill artifact(s)."""
        ...

    def emit_agent(self, agent: AgentRecord) -> EmitResult:
        """Map a canonical sub-agent to this agent's native agent construct, or
        record every claude_keys entry as dropped where no construct exists
        (REQ-GEN-06)."""
        ...
```

The concrete per-agent field mappings, native formats, and which sub-agent constructs each target
supports are specified in `03-per-agent-emitters.md`. The registry literal lives in
`02-generator-engine.md §2`.

## 6. Drop-With-Record Data Model (REQ-FMT-03, REQ-OBS-01)

Every canonical construct that cannot be represented in a target is **omitted from output AND
recorded** — never written as invalid frontmatter (REQ-FMT-03), never silently lost (REQ-OBS-01).

```python
@dataclass(frozen=True)
class DropRecord:
    """One canonical construct that a target agent could not represent.

    Attributes:
        agent: Target agent id (AGENT_TARGETS) that dropped it.
        source: Repo-relative POSIX path of the canonical file it came from.
        construct: Stable identifier of the dropped construct, e.g.
            `sub-agent key 'effort'`, `argument-hint`, `hooks.json`.
        reason: Short human-readable why, e.g. `no Cursor equivalent`.
    """

    agent: str
    source: str
    construct: str
    reason: str
```

`DropRecord`s aggregate (sorted by `(agent, source, construct)` for determinism) into the committed
`adapters/GENERATION-REPORT.md` — content contract in `04-provenance-selfcontainment-report.md §3`.

## 7. Provenance (REQ-OUT-01)

Every generated file in `adapters/` carries provenance: it is generated, names its canonical
**source**, and states the exact **regenerate** command. There are **three forms** (one per
file-format class) plus one exempt case — the full rules and per-format placement live in
`04-provenance-selfcontainment-report.md §1`; the shared constants are defined here once:

```python
# The regenerate command, single-sourced (REQ-OUT-01). Used in every provenance
# form and in the drift-guard remediation message (§9).
REGENERATE_CMD: str = "python3 scripts/build-adapters.py"

# Form A — files WITH a YAML frontmatter block (SKILL.md mirrors, .mdc, agent
# files): a YAML COMMENT as the first line INSIDE the block (`---` stays byte 0
# for strict parsers). `{source}` = canonical source path.
PROVENANCE_FM_COMMENT: str = (
    "# GENERATED — DO NOT EDIT. Source: {source}. Regenerate: " + REGENERATE_CMD
)

# Form B — frontmatter-LESS generated markdown (GENERATION-REPORT.md): an HTML
# comment as the file's first line (verifier V-003).
PROVENANCE_BODY_TOP: str = (
    "<!-- GENERATED — DO NOT EDIT. Regenerate: " + REGENERATE_CMD + " -->"
)

# Form C — strict JSON (gemini-extension.json), no comments possible (OQ-2): a
# documented top-level object. Serialized with the manifest.
def provenance_json(source: str) -> dict[str, str]:
    """Return the `_generated` provenance object for strict-JSON manifests."""
    return {"source": source, "regenerate": REGENERATE_CMD}

PROVENANCE_JSON_KEY: str = "_generated"

# Exempt — `forge-root.sh`: copied BYTE-IDENTICAL (REQ-GEN-05), so NO header is
# injected. Its provenance is documented in GENERATION-REPORT.md instead.
```

## 8. Error Hierarchy (REQ-ROB-01, REQ-OBS-02)

The generator fails fast on any unprocessable canon, aborting the **entire** build with a clear
`source_path: reason` message to stderr and a non-zero exit. Because the tree is built to a temp dir
and only atomic-swapped on full success (`02-generator-engine.md §4`), a failure **never** leaves a
partial `adapters/`.

```python
class CanonError(Exception):
    """Base: the generator cannot process a canonical input (REQ-ROB-01).

    Carries the offending file so the top-level handler can render
    `<source_path>: <reason>` to stderr (REQ-OBS-02).

    Attributes:
        source_path: Repo-relative POSIX path of the offending canonical file.
        reason: Human-readable cause.
    """

    def __init__(self, source_path: str, reason: str) -> None:
        super().__init__(f"{source_path}: {reason}")
        self.source_path = source_path
        self.reason = reason


class MalformedFrontmatterError(CanonError):
    """Frontmatter block missing/unbalanced `---`, or not a YAML mapping."""


class MissingNameError(CanonError):
    """Required `name` absent, non-string, or (skills) != directory name."""


class UnreadableFileError(CanonError):
    """A canonical file could not be read (permissions, encoding, I/O)."""
```

Any `CanonError` → exit non-zero with the rendered message; no other exception type is expected from
canon processing (a non-`CanonError` is a generator bug and propagates as a stack trace).

## 9. CLI Exit-Code Contract (REQ-GEN-02, REQ-CI-01, REQ-CI-03)

`scripts/build-adapters.py` is the feature's single programmatic interface (full CLI table in
`01-architecture-layout.md §4`). Exit codes:

| Exit | Mode | Meaning |
|------|------|---------|
| 0 | default | Full regenerate succeeded; `adapters/` atomically published. |
| 0 | `--check` | Committed `adapters/` is identical to a fresh generation (no drift). |
| 1 | default | `CanonError` — bad canon; `source_path: reason` on stderr; **no** partial tree written. |
| 1 | `--check` | Drift detected; the `diff` + remediation message printed; `adapters/` untouched. |
| 2 | any | argparse usage error (bad flag) — a **caller** mistake, never a canon/drift verdict. |

```python
# Drift-guard remediation, single-sourced (REQ-CI-03). Printed after the diff on
# `--check` mismatch and by validate.sh step 6b.
REMEDIATION_MESSAGE: str = (
    "adapters/ is out of date — run `" + REGENERATE_CMD + "` and commit the result."
)
```

Only `0` and `1` are **verdict** codes; a CI consumer (`packaging-docs-ci`) MUST NOT read `2` as
"drift found".

## Dependencies

This is the root foundation document; it depends on no other spec document. Every other document in
this suite depends on it.

## Verification

- [ ] `AGENT_TARGETS` is exactly `(claude, codex, copilot, cursor, gemini)` and is the iteration
      order everywhere (no runtime sort).
- [ ] `AgentRecord.claude_keys` is populated per-file from parsed frontmatter (not a fixed list);
      the three-agent ground-truth table in §2 matches canon on branch `forge/skill-spec-purity`.
- [ ] `SkillRecord.description` / `AgentRecord.description` round-trip byte-for-byte per target
      (asserted in `06-testing-strategy.md`).
- [ ] `FRONTMATTER_KEY_ORDER` is consumed by every YAML-emitting emitter with `sort_keys=False`.
- [ ] Every `DropRecord` produced by an emitter appears in `GENERATION-REPORT.md`
      (`04-provenance-selfcontainment-report.md §3`).
- [ ] The three provenance forms + the script-exempt case in §7 match
      `04-provenance-selfcontainment-report.md §1`.
- [ ] `CanonError` subclasses render `source_path: reason` and map to exit 1 (no partial tree).
- [ ] `REGENERATE_CMD` / `REMEDIATION_MESSAGE` are referenced (not re-typed) by the emitters, the
      drift guard, and `validate.sh` step 6b.
