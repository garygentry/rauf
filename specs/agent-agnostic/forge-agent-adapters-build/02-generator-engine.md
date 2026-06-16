# 02 — Generator Engine

> Feature: `forge-agent-adapters-build` (epic `agent-agnostic`, member 3 of 6, target repo
> **feature-forge** at `/home/gary/workspace/feature-forge`). Source of truth: `PRD.md` (v1) +
> `tech-spec.md` (v1). This document specifies the **orchestration core** of the generator
> `scripts/build-adapters.py`: the four-stage pipeline **discovery → parse → per-agent emit →
> atomic publish**, the emitter registry literal, the determinism / pinned-YAML contract, the
> atomic-publish and `--check` mechanics, the path-safety sandbox, the fail-fast error handling, and
> the `main()` / argparse control flow.
>
> **Scope boundary — what this doc does NOT own.** The five per-agent **emitters** themselves
> (their native field mappings, `.mdc`/manifest shapes) are `03-per-agent-emitters.md`. The
> **references-closure / self-containment pass**, the **provenance-header application**, and the
> **`GENERATION-REPORT.md` assembly** are `04-provenance-selfcontainment-report.md`. The
> **purity exemption, the `--check` wiring into `validate.sh` step 6b, venv provisioning, and
> `AGENTS.md`** are `05-purity-exemption-and-drift-guard.md`. This doc cross-references those; it
> never duplicates them. The shared **types, constants, error hierarchy, and exit-code contract**
> live in `00-core-definitions.md`; the **file tree and integration surfaces** live in
> `01-architecture-layout.md`. This doc imports and uses them — it never re-defines them.
>
> **Stack note:** the configured `stack` is `typescript`, but this artifact ships **Python 3 +
> Bash** in feature-forge — there is **no** TypeScript and **no** `pnpm` gate (constraint **C-2**).
> All Python below is exact (3.10 baseline, matching `scripts/epic-manifest.py` /
> `scripts/check-spec-purity.py`): `from __future__ import annotations`, full type annotations,
> Google-style docstrings. The one permitted runtime dependency is the **pinned YAML library**
> (`scripts/requirements-adapters.txt`, default PyYAML; constraint **C-4**, decision **D2**).

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-GEN-01 | Walk `skills/` + `agents/`; parse frontmatter+body | §1 (discovery), §3 (parse) |
| REQ-GEN-02 | Single non-interactive command | §5 (argparse / `main`), §6 |
| REQ-GEN-03 | Five target agents via the emitter registry | §2 (`AGENT_TARGETS_REGISTRY`) |
| REQ-SCALE-01 | New skill/sub-agent → no generator change | §1 (discovery is glob-driven) |
| REQ-DET-01 | Determinism: sorted walks, pinned/configured YAML, `\n` newlines | §1, §4 |
| REQ-DET-02 | Full regenerate: build-from-scratch, no orphan survival | §1, §4.1 (atomic publish) |
| REQ-DET-03 | Idempotency: no-change run → no diff | §4 (determinism), §4.3 (`--check`) |
| REQ-ROB-01 | Fail-fast on bad canon; no partial tree | §3, §6 (error handling), §4.1 |
| REQ-OBS-02 | Error names offending file + reason | §6 (`CanonError` rendering) |
| REQ-CI-01 | `--check` regenerate + `diff -r` vs committed | §4.3 |
| REQ-CI-03 | Drift remediation message | §4.3 |
| REQ-SEC-01 | Writes only within resolved root under `adapters/` (+ its tmp) | §4.2 (path-safety) |
| REQ-PERF-01 | ~11 skills × 5 agents, sub-second | §7 (performance) |

---

## 1. Pipeline overview & discovery (REQ-GEN-01, REQ-SCALE-01, REQ-DET-01, REQ-DET-02)

`build-adapters.py` is structured as four ordered stages (tech-spec §3.1). The control flow that
sequences them is `build_tree()` (§4); this section specifies stage 1 (**discovery**), §3 specifies
stage 2 (**parse**), the emitters (`03-per-agent-emitters.md`) are stage 3 (**emit**), and §4
specifies stage 4 (**atomic publish**).

```
discovery ──→ parse ──→ per-agent emit ──→ atomic publish
(glob canon)  (→Records) (Records→EmitResults) (temp tree → os.replace)
```

### 1.1 Discovery (stage 1)

Discovery globs the canon under the **resolved repo root** in **sorted POSIX byte order**. The input
set is *discovered*, never hard-coded — adding a skill or sub-agent needs **no generator change**
(REQ-SCALE-01). The glob patterns mirror the upstream checker's `_skill_md_files` / `iter_canonical_files`
conventions (`scripts/check-spec-purity.py`, verified live: `root.glob("skills/*/SKILL.md")`,
`agents/*.md`, references via recursive `/**/*`) so the two tools agree on the canon surface
(`01-architecture-layout.md §7`).

```python
from __future__ import annotations

from pathlib import Path

# Discovery globs, relative to the resolved repo root (REQ-GEN-01). Mirrors
# check-spec-purity.py's surfaces so generator input == purity-gated canon.
SKILLS_GLOB: str = "skills/*/SKILL.md"
AGENTS_GLOB: str = "agents/*.md"
REFERENCES_ROOT: str = "references"  # whole-tree copy (D5); not parsed, see §3.


def discover_skill_paths(root: Path) -> list[Path]:
    """Return every canonical SKILL.md, sorted by repo-relative POSIX path.

    Args:
        root: The resolved repo root.

    Returns:
        Absolute paths to `skills/<name>/SKILL.md`, sorted (LC_ALL=C / byte
        order) for deterministic emit ordering (REQ-DET-01). Currently 11.
    """
    return sorted(
        root.glob(SKILLS_GLOB),
        key=lambda p: p.relative_to(root).as_posix(),
    )


def discover_agent_paths(root: Path) -> list[Path]:
    """Return every canonical sub-agent definition, sorted by relpath.

    Args:
        root: The resolved repo root.

    Returns:
        Absolute paths to `agents/<name>.md`, sorted (byte order). Currently 3
        (`forge-researcher`, `forge-spec-writer`, `forge-verifier`).
    """
    return sorted(
        root.glob(AGENTS_GLOB),
        key=lambda p: p.relative_to(root).as_posix(),
    )
```

**Sorted-walk contract (REQ-DET-01).** Every directory walk in the generator — discovery here, and
the references-tree copy in `04-provenance-selfcontainment-report.md §2` — sorts entries by their
repo-relative POSIX path using plain string ordering, which is **byte order** for the ASCII paths in
this repo (equivalent to `LC_ALL=C`). The generator never relies on the OS-returned `glob` /
`os.scandir` order, never sorts by locale, and never introduces a secondary key derived from the
filesystem (mtime, inode). This is what makes the emitted tree byte-identical across machines and
runs (REQ-DET-01) and is verified by the determinism test (`06-testing-strategy.md`).

**Discovery does not parse `references/`.** The repo-root `references/` tree is a **whole-tree
verbatim copy** (decision **D5**), not parsed into records — it has no frontmatter the generator
reads. Its discovery + copy is owned by the self-containment pass
(`04-provenance-selfcontainment-report.md §2`); §1.1 lists `REFERENCES_ROOT` only so the engine can
hand that pass the resolved tree root. The two parsed surfaces are `skills/` and `agents/` (REQ-GEN-01).

---

## 2. Emitter registry (REQ-GEN-03)

Stage 3 (**emit**) dispatches each parsed record to the per-agent emitter for every target in
`AGENT_TARGETS` (`00-core-definitions.md §1`). The engine holds the **registry literal** — the
single mapping of agent id → concrete `Emitter` (`00-core-definitions.md §5`) — so the dispatch loop
is uniform and a per-agent fix stays localized (tech-spec §3.1). The concrete emitter classes
(`ClaudeEmitter`, `CodexEmitter`, …) are defined in `03-per-agent-emitters.md`; this engine only
**imports and registers** them.

```python
from typing import Callable

# Concrete emitters are defined in 03-per-agent-emitters.md. The engine imports
# them and binds the registry; AGENT_TARGETS (00 §1) is the iteration order.
from build_adapters_emitters import (  # same module file in practice; see §5 note
    ClaudeEmitter,
    CodexEmitter,
    CopilotEmitter,
    CursorEmitter,
    GeminiEmitter,
)
from core_definitions import AGENT_TARGETS, Emitter  # 00 §1, §5

# Registry literal: agent id -> emitter factory. Keys MUST equal AGENT_TARGETS
# exactly (asserted at startup, §5). One entry per target (REQ-GEN-03); adding a
# sixth agent is one new entry + one AGENT_TARGETS element, never a structural
# change (00 §1).
AGENT_TARGETS_REGISTRY: dict[str, Callable[[], Emitter]] = {
    "claude": ClaudeEmitter,
    "codex": CodexEmitter,
    "copilot": CopilotEmitter,
    "cursor": CursorEmitter,
    "gemini": GeminiEmitter,
}


def build_emitters() -> dict[str, Emitter]:
    """Instantiate one emitter per target, validating registry coverage.

    Returns:
        Mapping agent id -> Emitter, iterated in AGENT_TARGETS order (00 §1).

    Raises:
        AssertionError: If the registry keys do not exactly equal
            AGENT_TARGETS (a generator bug, not a CanonError — fail loud).
    """
    assert set(AGENT_TARGETS_REGISTRY) == set(AGENT_TARGETS), (
        "AGENT_TARGETS_REGISTRY must cover exactly AGENT_TARGETS (00 §1)"
    )
    return {agent_id: AGENT_TARGETS_REGISTRY[agent_id]() for agent_id in AGENT_TARGETS}
```

> **Module-layout note.** Per `01-architecture-layout.md §2`, all of this ships as the single file
> `scripts/build-adapters.py` (the hyphenated name is loaded in tests via `conftest.py`'s importlib
> loader). The `from build_adapters_emitters import …` / `from core_definitions import …` lines
> above are spec-level **logical imports** showing provenance of each symbol across this suite; in
> the single-file implementation the emitter classes and shared types are defined in-file (as the
> upstream `check-spec-purity.py` inlines its `00`-defined constants). An implementer MAY split into
> a package, but the registry, records, and emitters must resolve to the symbols defined in
> `00-core-definitions.md` and `03-per-agent-emitters.md`.

The dispatch loop calls `emitter.emit_skill(skill)` for each `SkillRecord` and
`emitter.emit_agent(agent)` for each `AgentRecord` (the `Emitter` protocol, `00-core-definitions.md §5`),
collecting `EmitResult`s. Emitters are **pure** (no clock/env/RNG/FS) — the references closure and
provenance are applied afterward by the self-containment pass, not by the emitter
(`04-provenance-selfcontainment-report.md §2`).

---

## 3. Parse stage (REQ-GEN-01, REQ-ROB-01, REQ-OBS-02)

Stage 2 turns each discovered path into a frozen `SkillRecord` or `AgentRecord`
(`00-core-definitions.md §2`). Parsing is the **only** place canon is read from disk; emitters
consume records, never files (`00-core-definitions.md §5`).

The frontmatter parse contract is fixed in `00-core-definitions.md §3`: split on the first/next
column-0 `---`, `safe_load` the block (must be a mapping), require a string `name`, and for skills
assert `name == <dir>`. Any violation raises a `CanonError` subclass (`00-core-definitions.md §8`) —
never a crash, never a silent skip (REQ-ROB-01). This section gives the engine-side procedures.

```python
import io

import yaml  # the pinned dep (requirements-adapters.txt); D2, C-4

from core_definitions import (  # 00 §2, §8
    AgentRecord,
    MalformedFrontmatterError,
    MissingNameError,
    SkillRecord,
    UnreadableFileError,
)

# Frontmatter delimiter: a line that is exactly "---" (column 0). Per REQ-GEN-01
# (parse) + REQ-ROB-01 (fail-fast): a file without a well-formed open/close pair is
# a MalformedFrontmatterError (reported source_path: reason), not a crash.
_FM_DELIM: str = "---"


def split_frontmatter(text: str, source_path: str) -> tuple[dict[str, object], str]:
    """Split a canonical markdown file into (frontmatter_map, body).

    The frontmatter block is delimited by the first column-0 `---` and the next
    column-0 `---`. The block is `safe_load`-ed and MUST be a mapping.

    Args:
        text: Full file contents (already newline-normalized to `\\n`, §4).
        source_path: Repo-relative POSIX path, for error messages (REQ-OBS-02).

    Returns:
        (frontmatter_map, body) where body is everything after the closing `---`.

    Raises:
        MalformedFrontmatterError: No balanced `---/---` pair, or the block is
            not a YAML mapping, or YAML fails to load (REQ-ROB-01).
    """
    lines = text.split("\n")
    if not lines or lines[0].strip() != _FM_DELIM:
        raise MalformedFrontmatterError(source_path, "missing opening frontmatter '---'")
    close_idx: int | None = None
    for i in range(1, len(lines)):
        if lines[i].strip() == _FM_DELIM:
            close_idx = i
            break
    if close_idx is None:
        raise MalformedFrontmatterError(source_path, "missing closing frontmatter '---'")

    block = "\n".join(lines[1:close_idx])
    body = "\n".join(lines[close_idx + 1 :])
    try:
        loaded = yaml.safe_load(io.StringIO(block))
    except yaml.YAMLError as exc:  # pinned-dep parse failure
        raise MalformedFrontmatterError(source_path, f"invalid YAML frontmatter: {exc}")
    if not isinstance(loaded, dict):
        raise MalformedFrontmatterError(
            source_path, "frontmatter is not a YAML mapping"
        )
    return loaded, body


def read_canon_text(path: Path, source_path: str) -> str:
    """Read a canonical file as UTF-8 text with normalized `\\n` newlines.

    Args:
        path: Absolute path to the canonical file.
        source_path: Repo-relative POSIX path, for error messages.

    Returns:
        File contents with CRLF/CR normalized to `\\n` (REQ-DET-01).

    Raises:
        UnreadableFileError: The file cannot be read (permissions, encoding, I/O).
    """
    try:
        raw = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise UnreadableFileError(source_path, f"cannot read file: {exc}")
    return raw.replace("\r\n", "\n").replace("\r", "\n")


def parse_skill(path: Path, root: Path) -> SkillRecord:
    """Parse one `skills/<name>/SKILL.md` into a SkillRecord (00 §2).

    Args:
        path: Absolute path to the SKILL.md.
        root: Resolved repo root (to compute source_path + own_refs).

    Returns:
        A frozen SkillRecord; `description` preserved byte-for-byte (REQ-FMT-04).

    Raises:
        UnreadableFileError, MalformedFrontmatterError, MissingNameError: per
            the parse contract (00 §3, §8) — fail-fast (REQ-ROB-01).
    """
    source_path = path.relative_to(root).as_posix()
    fm, body = split_frontmatter(read_canon_text(path, source_path), source_path)

    name = fm.get("name")
    if not isinstance(name, str) or not name:
        raise MissingNameError(source_path, "missing or non-string 'name'")
    dir_name = path.parent.name
    if name != dir_name:
        raise MissingNameError(
            source_path, f"name '{name}' != directory '{dir_name}'"
        )

    description = fm.get("description", "")
    if not isinstance(description, str):
        raise MalformedFrontmatterError(source_path, "'description' is not a string")

    metadata = fm.get("metadata")
    if metadata is not None and not isinstance(metadata, dict):
        raise MalformedFrontmatterError(source_path, "'metadata' is not a mapping")

    own_refs_dir = path.parent / "references"
    own_refs = own_refs_dir if own_refs_dir.is_dir() else None

    return SkillRecord(
        name=name,
        description=description,
        metadata=metadata,
        body=body,
        own_refs=own_refs,
        source_path=source_path,
    )


def parse_agent(path: Path, root: Path) -> AgentRecord:
    """Parse one `agents/<name>.md` into an AgentRecord (00 §2).

    `claude_keys` = the parsed frontmatter MINUS `name`/`description`, in source
    order (Python dict insertion order == YAML document order). NOT a fixed
    schema — whatever Claude-only keys the file carries are captured per-file,
    so a future sub-agent's new key is auto-covered (REQ-SCALE-01, REQ-GEN-06).

    Args:
        path: Absolute path to the agent file.
        root: Resolved repo root.

    Returns:
        A frozen AgentRecord.

    Raises:
        UnreadableFileError, MalformedFrontmatterError, MissingNameError: per the
            parse contract (00 §3, §8).
    """
    source_path = path.relative_to(root).as_posix()
    fm, body = split_frontmatter(read_canon_text(path, source_path), source_path)

    name = fm.get("name")
    if not isinstance(name, str) or not name:
        raise MissingNameError(source_path, "missing or non-string 'name'")
    if name != path.stem:
        raise MissingNameError(source_path, f"name '{name}' != file stem '{path.stem}'")

    description = fm.get("description", "")
    if not isinstance(description, str):
        raise MalformedFrontmatterError(source_path, "'description' is not a string")

    claude_keys: dict[str, object] = {
        k: v for k, v in fm.items() if k not in ("name", "description")
    }

    return AgentRecord(
        name=name,
        description=description,
        body=body,
        claude_keys=claude_keys,
        source_path=source_path,
    )
```

**Verified ground truth (do not contradict).** Sub-agent frontmatter is **not uniform**:
`forge-researcher` carries `{tools, model, maxTurns, effort}`, `forge-spec-writer`
`{tools, model, maxTurns}`, `forge-verifier` `{tools, model, maxTurns, memory, skills}`
(`00-core-definitions.md §2`, `01-architecture-layout.md §7`). `claude_keys` therefore captures
each file's actual set, never a hard-coded union. Of the 11 skills, 10 carry
`metadata.argument-hint`; `forge-init` has **no** `metadata` (→ `SkillRecord.metadata is None`).

---

## 4. Atomic publish, path-safety & `--check` (REQ-DET-02, REQ-DET-03, REQ-ROB-01, REQ-SEC-01, REQ-CI-01, REQ-CI-03)

### 4.1 `build_tree` — build the complete tree into a temp dir (REQ-DET-02, REQ-ROB-01)

The whole tree is built into a **sibling temp dir** (`adapters.tmp-<pid>/`, ignored by `.gitignore`
per `01-architecture-layout.md §2.1`) and only swapped over `adapters/` on **full success**. This
delivers three guarantees at once:

1. **Full regenerate (REQ-DET-02):** the published tree is built from scratch each run, so stale or
   orphaned files from a prior generation cannot survive (the directory is `os.replace`-swapped
   whole, not merged into).
2. **No partial tree on failure (REQ-ROB-01):** a `CanonError` aborts before the swap, so a failed
   build leaves the previously-committed `adapters/` **untouched** (and the temp dir is removed).
3. **Determinism is testable in isolation (REQ-DET-01/03):** the temp tree is a complete, swap-ready
   artifact the `--check` path (§4.3) and tests diff without mutating the repo.

```python
import os
import shutil

from core_definitions import CanonError, EmitResult, ManifestEntry  # 00 §5, §8

ADAPTERS_DIRNAME: str = "adapters"


def build_tree(root: Path, dest: Path) -> tuple[EmitResult, ...]:
    """Build the COMPLETE adapters tree into `dest` (a fresh empty dir).

    Stages 1–3: discover (§1) → parse (§3) → per-agent emit (§2). The
    references-closure, provenance, and GENERATION-REPORT writes are delegated to
    the self-containment pass (04-provenance-selfcontainment-report.md §2),
    invoked here with the parsed records and the open `dest`.

    Args:
        root: Resolved repo root (canon source).
        dest: A fresh directory to populate (the temp staging dir, §4.2). MUST be
            empty/new; `build_tree` never writes outside it (REQ-SEC-01, §4.2).

    Returns:
        The tuple of EmitResults (for the report assembly in 04).

    Raises:
        CanonError: Any unprocessable canon (00 §8) — aborts before publish so no
            partial `adapters/` is ever produced (REQ-ROB-01).
    """
    emitters = build_emitters()  # §2

    skills = [parse_skill(p, root) for p in discover_skill_paths(root)]  # §1, §3
    agents = [parse_agent(p, root) for p in discover_agent_paths(root)]  # §1, §3

    results: list[EmitResult] = []
    # AGENT_TARGETS order (00 §1) — deterministic emit/write order (REQ-DET-01).
    for agent_id, emitter in emitters.items():
        # Whole-bundle manifest aggregation (V-001): codex's agents/openai.yaml and
        # gemini's gemini-extension.json are NOT 1:1 with any one record, so each
        # emitter returns its per-record contribution in EmitResult.manifest_entries
        # (00 §5) and the engine collects them ACROSS the per-record loop below, then
        # writes the single merged manifest AFTER the loop. Order of accumulation is
        # the deterministic emit order (skills then agents, each sorted), so the
        # merged manifest is byte-stable (REQ-DET-01).
        manifest_entries: list[ManifestEntry] = []
        for skill in skills:
            result = emitter.emit_skill(skill)
            _publish_emit_result(root, dest, agent_id, result)  # 04 §2 writes files
            manifest_entries.extend(result.manifest_entries)
            results.append(result)
        for agent in agents:
            result = emitter.emit_agent(agent)
            _publish_emit_result(root, dest, agent_id, result)
            manifest_entries.extend(result.manifest_entries)
            results.append(result)
        # Merged whole-bundle manifest, if this target emits one (codex/gemini). The
        # serialization (key order, `_generated` provenance first, gemini `version`)
        # is owned by 04 §1.3; a target with no manifest_entries writes nothing here.
        if manifest_entries:
            _publish_manifest(root, dest, agent_id, tuple(manifest_entries))  # 04 §1.3
        # references closure + verbatim forge-root.sh copy for this bundle (04 §2)
        _copy_self_containment(root, dest, agent_id)

    # GENERATION-REPORT.md from all DropRecords (04 §3); provenance applied per file
    # by the emitters/closure pass (04 §1). Returned for the report writer.
    return tuple(results)
```

`_publish_emit_result`, `_publish_manifest`, `_copy_self_containment`, and the `GENERATION-REPORT.md`
writer are specified in `04-provenance-selfcontainment-report.md §1.3, §2–§3`; they are listed here
only to show the engine's call sequence. `_publish_manifest` receives the accumulated
`ManifestEntry` tuple and serializes the single whole-bundle manifest (codex `agents/openai.yaml`,
gemini `gemini-extension.json`) with the `_generated` provenance object first and, for gemini, the
fixed `GEMINI_EXTENSION_VERSION` (`00 §7`). The **path-safety guard** (§4.2) wraps every write they
perform.

### 4.2 Path-safety sandbox (REQ-SEC-01)

The generator writes **only** within the resolved repo root, under `adapters/` or its sibling
`adapters.tmp-<pid>/` staging dir — never elsewhere, never outside the repo (REQ-SEC-01). `AGENTS.md`
is hand-authored; the generator never writes it (`01-architecture-layout.md §5`). Every file write
goes through `safe_write`, which resolves the target and asserts containment **before** writing.

```python
def _assert_within(path: Path, allowed_root: Path) -> Path:
    """Return the resolved `path`, asserting it is inside `allowed_root`.

    Args:
        path: Candidate output path (may be relative or contain `..`).
        allowed_root: The staging dir (adapters.tmp-<pid>/) or, post-swap,
            `adapters/` under the resolved repo root.

    Returns:
        The resolved absolute path.

    Raises:
        AssertionError: If the resolved path escapes `allowed_root` — a generator
            bug (e.g. a malicious `name` with `../`), never silently allowed.
    """
    resolved = path.resolve()
    allowed = allowed_root.resolve()
    assert resolved == allowed or allowed in resolved.parents, (
        f"refusing to write outside sandbox: {resolved} not under {allowed}"
    )
    return resolved


def safe_write(allowed_root: Path, relpath: str, content: str, mode: int = 0o644) -> None:
    """Write `content` to `allowed_root/relpath`, sandbox-checked (REQ-SEC-01).

    Newlines are already normalized to `\\n` by the emitters; this writes bytes
    verbatim (no platform translation) for cross-OS byte-identity (REQ-DET-01).

    Args:
        allowed_root: The staging dir for the current build.
        relpath: POSIX-relative path under the agent bundle (EmittedFile.relpath).
        content: Full file text (provenance header already applied, 04 §1).
        mode: POSIX mode; 0o644 default, 0o755 for copied scripts (00 §5).

    Raises:
        AssertionError: If the target escapes the sandbox (§ guard above).
    """
    target = _assert_within(allowed_root / relpath, allowed_root)
    target.parent.mkdir(parents=True, exist_ok=True)
    # newline="" → write content's `\n` verbatim, never translate to CRLF.
    with open(target, "w", encoding="utf-8", newline="") as fh:
        fh.write(content)
    os.chmod(target, mode)
```

The `name`-as-directory-name re-check in `parse_skill`/`parse_agent` (§3) plus this resolved-path
assertion together close the path-traversal surface: a canonical `name` is the only record-derived
path segment, and it is validated against its own directory before use.

### 4.3 `generate` (default) and `check` (`--check`) (REQ-DET-02/03, REQ-CI-01/03, REQ-SEC-01)

Both modes build to a fresh temp dir via `build_tree`. The **default** mode then `os.replace`-swaps
the temp dir over `adapters/`; the **`--check`** mode never mutates `adapters/` — it `diff -r`s and
removes the temp dir (so it works outside git, tech-spec §3.8).

```python
import subprocess
import sys

from core_definitions import REMEDIATION_MESSAGE  # 00 §9


def _new_staging_dir(root: Path) -> Path:
    """Return a fresh sibling staging dir `adapters.tmp-<pid>/` (matches the
    `.gitignore` glob, 01 §2.1). Removed/replaced by the caller."""
    staging = root / f"{ADAPTERS_DIRNAME}.tmp-{os.getpid()}"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    return staging


def generate(root: Path) -> int:
    """Full regenerate: build to temp, atomic-swap over `adapters/` (REQ-DET-02).

    On a CanonError, the staging dir is removed and `adapters/` is left intact —
    no partial tree (REQ-ROB-01). Returns the process exit code (00 §9).
    """
    staging = _new_staging_dir(root)
    try:
        build_tree(root, staging)  # §4.1 — raises CanonError on bad canon
    except CanonError as exc:
        shutil.rmtree(staging, ignore_errors=True)
        print(str(exc), file=sys.stderr)  # "<source_path>: <reason>" (REQ-OBS-02)
        return 1
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise  # a generator bug — propagate as a stack trace (00 §8)

    # Atomic swap: replace adapters/ wholesale (REQ-DET-02 — no orphan survives).
    final = root / ADAPTERS_DIRNAME
    backup = root / f"{ADAPTERS_DIRNAME}.tmp-{os.getpid()}.prev"
    if final.exists():
        os.replace(final, backup)  # move old out of the way (same filesystem)
    os.replace(staging, final)  # publish the new tree atomically
    if backup.exists():
        shutil.rmtree(backup, ignore_errors=True)
    return 0


def check(root: Path) -> int:
    """Drift guard: build to temp, `diff -r` vs committed `adapters/`, never
    mutate `adapters/` (REQ-CI-01, REQ-DET-03). Returns the exit code (00 §9).
    """
    staging = _new_staging_dir(root)
    try:
        build_tree(root, staging)
    except CanonError as exc:
        shutil.rmtree(staging, ignore_errors=True)
        print(str(exc), file=sys.stderr)
        return 1
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise

    committed = root / ADAPTERS_DIRNAME
    try:
        # `diff -r` exit 0 == identical; 1 == differs; >1 == diff TOOL error.
        proc = subprocess.run(
            ["diff", "-r", str(committed), str(staging)],
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:
        # `diff` is not installed — an environment fault, NOT a drift verdict.
        shutil.rmtree(staging, ignore_errors=True)
        print(
            "adapters: `diff` executable not found — cannot run the drift guard; "
            "this is an environment fault, not a drift verdict.",
            file=sys.stderr,
        )
        return 2
    finally:
        shutil.rmtree(staging, ignore_errors=True)  # never leave a tmp tree

    if proc.returncode == 0:
        return 0  # identical — no drift
    if proc.returncode == 1:
        # Real drift: show the diff + remediation (REQ-CI-03). exit 1 is a verdict.
        sys.stdout.write(proc.stdout)
        sys.stderr.write(proc.stderr)
        print(REMEDIATION_MESSAGE, file=sys.stderr)  # 00 §9, single-sourced
        return 1
    # returncode > 1: `diff` itself failed (e.g. an unreadable file). This is a TOOL
    # error, never drift — do NOT print REMEDIATION_MESSAGE (it would be misleading).
    sys.stderr.write(proc.stderr)
    print(
        f"adapters: `diff -r` failed to compare trees (exit {proc.returncode}) — "
        "this is a diff-tool error, not a drift verdict.",
        file=sys.stderr,
    )
    return 2
```

`diff` errors and a missing `diff` binary both return exit **2** — the same "neither a
canon error nor a drift verdict" class as an argparse usage error (`00 §9`). A CI consumer
(`packaging-docs-ci`) MUST treat only `1` as "drift found"; `2` is an environment/tool fault
to surface, not a regenerate-and-commit prompt.

**Why `os.replace`, not `shutil.move`.** `os.replace` is atomic on a single filesystem (POSIX
`rename(2)`); `adapters/` and its sibling temp dir are always on the same filesystem (both under the
repo root), so the swap cannot leave a half-published tree. The brief move-old-aside step keeps the
operation crash-safe without a window where `adapters/` is absent.

**`--check` is read-only w.r.t. `adapters/` (REQ-DET-03, REQ-CI-01).** It builds into the temp dir,
runs `diff -r`, and always removes the temp dir in a `finally`. It never calls `os.replace` over
`adapters/`, so it works in a clean checkout, in CI, and outside git. The remediation string is
`REMEDIATION_MESSAGE` from `00-core-definitions.md §9` — not re-typed here. This `check()` is invoked
by `validate.sh` step 6b (wiring owned by `05-purity-exemption-and-drift-guard.md §2`).

---

## 5. `main()` & argparse control flow (REQ-GEN-02)

`build-adapters.py` is a single non-interactive command (REQ-GEN-02). `main()` parses args, resolves
the root, and dispatches to `generate` (§4.3) or `check` (§4.3). The `--root` default mirrors
`check-spec-purity.py` exactly (verified live: `default=Path(__file__).resolve().parent.parent`),
so the script works whether invoked from the repo root or by absolute path from `validate.sh`.

```python
import argparse


def main(argv: list[str] | None = None) -> int:
    """Parse args and run the generator (REQ-GEN-02). Returns an exit code (00 §9).

    Args:
        argv: CLI args (excluding program name); None → sys.argv[1:].

    Returns:
        0 ok; 1 canon error (default) or drift (`--check`); argparse exits 2 on a
        usage error before this returns (a caller mistake, never a verdict, 00 §9).
    """
    parser = argparse.ArgumentParser(
        prog="build-adapters.py",
        description=(
            "Generate per-agent adapters/ from the feature-forge canon "
            "(skills/, agents/, references/). Deterministic, full-regenerate."
        ),
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Drift guard: regenerate to a temp dir and diff vs committed "
        "adapters/; exit non-zero on drift. Does not modify adapters/.",
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parent.parent,
        help="Repo root (default: parent of this script's dir), mirroring "
        "check-spec-purity.py.",
    )
    args = parser.parse_args(argv)
    root: Path = args.root.resolve()

    return check(root) if args.check else generate(root)


if __name__ == "__main__":
    raise SystemExit(main())
```

**Control-flow summary (REQ-GEN-02).** No prompts, no stdin reads, no environment toggles affect
behavior; the only inputs are `--check`, `--root`, and the canon on disk. Exactly one of `generate`
/ `check` runs and its return value is the process exit code (`00-core-definitions.md §9`). The
top-level handler in `generate`/`check` is the **only** place `CanonError` is caught — it renders
`source_path: reason` to stderr (REQ-OBS-02) and maps to exit 1; any non-`CanonError` exception is a
generator bug and propagates as a stack trace (`00-core-definitions.md §8`).

---

## 6. Error handling (REQ-ROB-01, REQ-OBS-02, REQ-SEC-01)

| Condition | Where raised | Type (`00 §8`) | Outcome |
|---|---|---|---|
| Missing / unbalanced `---`, non-mapping or invalid YAML frontmatter | `split_frontmatter` (§3) | `MalformedFrontmatterError` | exit 1, `source_path: reason` stderr, no partial tree |
| Missing/non-string `name`; `name != dir`/`stem` | `parse_skill` / `parse_agent` (§3) | `MissingNameError` | exit 1, same |
| Unreadable / non-UTF-8 canonical file | `read_canon_text` (§3) | `UnreadableFileError` | exit 1, same |
| Output path escapes the sandbox | `_assert_within` (§4.2) | `AssertionError` (generator bug) | stack trace, non-zero (not a `CanonError`) |
| Registry ≠ `AGENT_TARGETS` | `build_emitters` (§2) | `AssertionError` (generator bug) | stack trace, non-zero |
| Drift detected (`--check`) | `check` (§4.3) | — (not an exception) | exit 1, diff + `REMEDIATION_MESSAGE` |
| `diff` missing, or `diff -r` returncode > 1 (`--check`) | `check` (§4.3) | — (tool/env fault, not a `CanonError`) | exit **2**, distinct stderr message, **no** `REMEDIATION_MESSAGE` |
| Pinned-dep provisioning fails (venv/pip) | `validate.sh` step 6b (`05 §2`) | — (env fault, not a `CanonError`) | gate aborts under `set -euo pipefail` with a remediation message (`05 §2`) |

**Fail-fast, no partial tree (REQ-ROB-01).** All parse errors raise **before** any emit/write for
the run completes, but even a `CanonError` raised mid-emit cannot corrupt `adapters/`: writes go to
the staging dir, and the `os.replace` swap happens only after `build_tree` returns cleanly (§4.1,
§4.3). On any exception the staging dir is `shutil.rmtree`-ed and `adapters/` is left exactly as
committed. Canon is pre-gated pure by `check-spec-purity.py` upstream
(`05-purity-exemption-and-drift-guard.md`), so any `CanonError` here is a **real defect that must
block** — never soft-skipped (tech-spec §7).

**Error message format (REQ-OBS-02).** `CanonError.__init__` builds `f"{source_path}: {reason}"`
(`00-core-definitions.md §8`); the top-level handler prints `str(exc)`, so a maintainer sees exactly
which canonical file failed and why, e.g. `agents/forge-verifier.md: missing closing frontmatter
'---'`.

---

## 7. Performance (REQ-PERF-01)

The workload is **~11 skills × 5 agents** of small-markdown emit + 5 verbatim copies of the
~14-file `references/` tree + 5 copies of the 50-line `forge-root.sh` (`01-architecture-layout.md §7`).
This is a few hundred small file writes and a handful of `safe_load`/`safe_dump` calls — it
completes in **well under a second** and is acceptable inside every `validate.sh`/CI invocation
(tech-spec §3.6). Design choices that keep it fast and bounded:

- Canon is read **once** per file in the parse stage; emitters consume in-memory records and never
  re-read disk (`00-core-definitions.md §5`).
- The references tree is copied with `shutil.copytree` (per bundle), not parsed
  (`04-provenance-selfcontainment-report.md §2`).
- No subprocess is spawned in the default (`generate`) path; the only subprocess is the single
  `diff -r` in `--check` (§4.3).

There is no caching/incremental layer (it would jeopardize the full-regenerate guarantee, REQ-DET-02);
the whole-tree rebuild is cheap enough not to need one.

---

## 8. Public API — exported vs internal

The feature's only externally-stable contract is the three items in `01-architecture-layout.md §4`
(the `build-adapters` CLI, the hand-authored `AGENTS.md`, and the `adapters-output` tree). Everything
in this module is implementation detail an implementer MAY refactor (single-file `scripts/build-adapters.py`
vs a split package, `01 §2`) **as long as those three contracts hold**. Within this engine:

| Symbol | Visibility | Notes |
|---|---|---|
| `main` / the CLI | **public** | The one true entry point (REQ-GEN-02). The stable programmatic surface. |
| `generate`, `check`, `build_tree`, `build_emitters` | module-internal | Importable by tests (subprocess-driven via the CLI, plus importlib unit access, `06 §1`); not a public API. |
| `discover_skill_paths`, `discover_agent_paths`, `parse_skill`, `parse_agent`, `split_frontmatter`, `read_canon_text`, `safe_write` | module-internal | Test-importable helpers; callable across the in-file module but not an external contract. |
| `AGENT_TARGETS_REGISTRY`, `SKILLS_GLOB`, `AGENTS_GLOB`, `REFERENCES_ROOT`, `ADAPTERS_DIRNAME` | module-internal | Module constants. |
| `_new_staging_dir`, `_assert_within` | private | Leading-underscore = private; not for cross-module use. |

(`_publish_emit_result`, `_publish_manifest`, `_copy_self_containment`, and the report writer are
owned by `04-provenance-selfcontainment-report.md`; this engine only calls them.)

---

## Dependencies

- **`00-core-definitions.md`** — `AGENT_TARGETS`, `SkillRecord` / `AgentRecord`, `Emitter` /
  `EmitResult` / `EmittedFile`, the `CanonError` hierarchy, `REMEDIATION_MESSAGE`, and the exit-code
  contract. This engine **imports and uses** them; it never re-defines them.
- **`01-architecture-layout.md`** — the `scripts/build-adapters.py` location, the `adapters/`
  output layout, the `--root` default convention, the `.gitignore` `adapters.tmp-*/` /
  `.venv-adapters/` amendment, and the read-only integration surfaces.
- **The pinned YAML dependency** (`scripts/requirements-adapters.txt`, default PyYAML; **D2**,
  **C-4**) — provisioned by `validate.sh` step 6b (`05-purity-exemption-and-drift-guard.md §2`).

**Implemented before:** `03-per-agent-emitters.md` (provides the `Emitter` classes this engine's
registry binds) and `04-provenance-selfcontainment-report.md` (provides `_publish_emit_result`,
`_copy_self_containment`, and the report writer this engine calls). The engine scaffold (this doc)
is built first; the emitters and closure pass are slotted into its call sites (`01-architecture-layout.md §8`).

## Verification

- [ ] Discovery globs are exactly `skills/*/SKILL.md` and `agents/*.md`, each `sorted` by
      repo-relative POSIX path (byte order) — no reliance on OS glob order (REQ-DET-01, REQ-SCALE-01).
- [ ] `AGENT_TARGETS_REGISTRY` keys equal `AGENT_TARGETS` exactly; `build_emitters` asserts coverage
      and iterates in `AGENT_TARGETS` order (REQ-GEN-03, REQ-DET-01).
- [ ] `split_frontmatter` / `parse_skill` / `parse_agent` raise the correct `CanonError` subclass
      (`00 §8`) for each malformed case and never crash; `claude_keys` is built per-file from parsed
      frontmatter, not a fixed list (REQ-ROB-01, REQ-GEN-06, REQ-SCALE-01).
- [ ] All file text is newline-normalized to `\n` on read and written with `newline=""` (no CRLF
      translation), so output is byte-identical across OSes (REQ-DET-01).
- [ ] `build_tree` writes only into the staging dir; `generate` `os.replace`-swaps it over
      `adapters/` whole, so seeding an orphan file under `adapters/` then regenerating removes it
      (REQ-DET-02). A no-canon-change run produces no diff (REQ-DET-03).
- [ ] On any `CanonError`, the staging dir is removed and `adapters/` is left as committed (no
      partial tree); the error message is `source_path: reason` on stderr; exit code 1 (REQ-ROB-01,
      REQ-OBS-02, `00 §9`).
- [ ] `safe_write` rejects any path that resolves outside the staging/`adapters/` sandbox under the
      resolved root; the generator never writes `AGENTS.md` or any path outside `adapters/`
      (REQ-SEC-01).
- [ ] `check` builds to temp, `diff -r`s vs committed `adapters/`, removes the temp dir in a
      `finally`, never mutates `adapters/`, and prints `REMEDIATION_MESSAGE` on drift (REQ-CI-01,
      REQ-CI-03, REQ-DET-03).
- [ ] `--root` default is `Path(__file__).resolve().parent.parent`, matching
      `check-spec-purity.py`; `main` is non-interactive and returns the exit code (REQ-GEN-02).
- [ ] A full regeneration completes in well under a second on the 11×5 workload (REQ-PERF-01).
