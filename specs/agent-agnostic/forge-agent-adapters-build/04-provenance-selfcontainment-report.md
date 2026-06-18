# 04 — Provenance, Self-Containment & the Generation Report

> Feature: `forge-agent-adapters-build` (epic `agent-agnostic`, member 3 of 6, target repo
> **feature-forge** at `/home/gary/workspace/feature-forge`). Source of truth: `PRD.md` (v1) +
> `tech-spec.md` (v1). This document makes three cross-cutting, **agent-independent** concerns
> concrete: (1) the **provenance header** stamped onto every generated file — the three header forms
> from `00-core-definitions.md §7` made concrete with exact emitted bytes, plus the one exempt case;
> (2) the **self-containment pass** that closes each bundle's reference set (whole-tree `references/`
> copy + the byte-identical `forge-root.sh` copy); and (3) the committed
> `adapters/GENERATION-REPORT.md` **content contract** (the "with-record" half of drop-with-record).
> These are the engine's responsibility, **not** the per-agent emitters: the emitters
> (`03-per-agent-emitters.md`) produce native skill/agent artifacts and `DropRecord`s; this document
> specifies the passes the engine (`02-generator-engine.md`) runs *around* them. Shared types and
> constants come from `00-core-definitions.md`; the layout that hosts the output is
> `01-architecture-layout.md`.
>
> **Stack note:** the configured `stack` is `typescript`, but this feature ships **Python 3 + Bash +
> Markdown** in feature-forge — there is **no** TypeScript and **no** `pnpm` gate (constraint
> **C-2**). All code below is exact Python 3 (3.10 baseline, Google-style docstrings, full type
> annotations), not pseudocode. The TypeScript stack profile does not apply.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-OUT-01 | Provenance header on every generated file (3 forms + exempt case) | §1 (all), §1.1 Form A, §1.2 Form B, §1.3 Form C, §1.4 exempt |
| REQ-OUT-02 | Generated `adapters/` (incl. report) committed to VCS | §3 (report is a committed `adapters/` file) |
| REQ-GEN-04 | Self-contained per-agent bundle (own + shared `references/` closure) | §2 (self-containment pass) |
| REQ-GEN-05 | `forge-root.sh` copied byte-identical, mode 0755, no header | §1.4, §2.3 |
| REQ-OBS-01 | Generation report records every dropped/unrepresentable construct | §3 (report content contract) |
| REQ-FMT-03 | Omit-with-record (the "record" half lands in the report) | §3 (report rows from `DropRecord`s) |
| REQ-DET-01 | Determinism: no timestamps; sorted, fixed ordering in headers + report | §1 (no-timestamp rule), §2.2 (sorted copy), §3.1 (sorted rows) |
| OQ-2 | Provenance for non-comment formats (strict JSON) | §1.3 Form C |
| OQ-3 | Generation report is a committed `adapters/` artifact | §3 |

> This document depends on the shared constants in `00-core-definitions.md §7` (the three provenance
> string templates + `provenance_json`) and `§6` (`DropRecord`), and on the engine's emit/publish
> flow in `02-generator-engine.md`. It **references** those — it does not redefine them. The per-agent
> native formats that decide *which* form applies to *which* file are in `03-per-agent-emitters.md`.

## 1. Provenance headers (REQ-OUT-01, OQ-2)

Every generated file in `adapters/` MUST carry provenance: a marker that it is generated
("GENERATED — DO NOT EDIT"), the **canonical source path** it derived from, and the **exact
regenerate command** (REQ-OUT-01). The command is single-sourced as
`REGENERATE_CMD = "python3 scripts/build-adapters.py"` (`00-core-definitions.md §7`) — never
re-typed here.

There are exactly **three header forms**, chosen by the file's format class, plus **one exempt
case**. The mapping from file → form is fixed:

| File class | Example files | Form | Where injected |
|---|---|---|---|
| Has a YAML frontmatter block | `adapters/claude/skills/*/SKILL.md`, `adapters/cursor/skills/*/*.mdc`, `adapters/codex/skills/*/*.md`, `adapters/copilot/skills/*/*.md`, all `adapters/<agent>/agents/*` markdown forms | **A** — YAML comment, first line **inside** the block | by the **emitter** (the emitter owns the frontmatter; see §1.5) |
| Generated markdown with **no** frontmatter | `adapters/GENERATION-REPORT.md` | **B** — HTML comment as the file's first line | by the **report builder** (engine, §3) |
| Strict JSON manifest | `adapters/gemini/gemini-extension.json` | **C** — `_generated` object inside the JSON | by the **gemini emitter** (`03-per-agent-emitters.md`) |
| Copied script, byte-identity required | `adapters/<agent>/scripts/forge-root.sh` | **EXEMPT** — no header; provenance documented in the report | n/a (self-containment pass copies verbatim, §2.3) |
| Verbatim-copied references | every file under `adapters/<agent>/references/**` and `adapters/<agent>/skills/*/references/**` | **EXEMPT** — copied byte-for-byte from canon (§2) | n/a — see §1.6 |

**No-timestamp rule (REQ-DET-01).** No provenance form carries a timestamp, hostname, username,
PID, or any value that varies across runs/machines/time. The only substituted field is `{source}`
(a deterministic, repo-relative POSIX path). This keeps every header byte-identical across runs so
the drift guard (`05-purity-exemption-and-drift-guard.md`) stays meaningful.

### 1.1 Form A — YAML comment inside the frontmatter block

For every generated file that has a YAML frontmatter block, the header is a **YAML comment** placed
as the **first line inside** the block, so the opening `---` remains **byte 0** for strict
frontmatter parsers (Cursor `.mdc`, Copilot, Claude, Codex mirrors). The template is
`PROVENANCE_FM_COMMENT` from `00-core-definitions.md §7`:

```python
# from 00-core-definitions.md §7 — referenced, NOT redefined here:
# PROVENANCE_FM_COMMENT = (
#     "# GENERATED — DO NOT EDIT. Source: {source}. Regenerate: " + REGENERATE_CMD
# )
```

**Exact emitted bytes** — a Claude `SKILL.md` derived from `skills/forge-1-prd/SKILL.md`:

```
---
# GENERATED — DO NOT EDIT. Source: skills/forge-1-prd/SKILL.md. Regenerate: python3 scripts/build-adapters.py
name: forge-1-prd
description: Author the Product Requirements Document for one feature …
argument-hint: <feature-slug>
---
<body copied verbatim from canon>
```

A Cursor `.mdc` rule derived from the same skill (frontmatter keys are the Cursor subset of
`FRONTMATTER_KEY_ORDER`, `00-core-definitions.md §4`):

```
---
# GENERATED — DO NOT EDIT. Source: skills/forge-1-prd/SKILL.md. Regenerate: python3 scripts/build-adapters.py
description: Author the Product Requirements Document for one feature …
globs: []
alwaysApply: false
---
<body copied verbatim from canon>
```

`{source}` is the **canonical** source path (e.g. `skills/forge-1-prd/SKILL.md`,
`agents/forge-verifier.md`) — `SkillRecord.source_path` / `AgentRecord.source_path`
(`00-core-definitions.md §2`) — **not** the adapter output path. The line is rendered with
`PROVENANCE_FM_COMMENT.format(source=record.source_path)`.

**Why a YAML comment and not a body comment for these files.** The frontmatter block must parse
under each agent's loader, and `---` must be byte 0 for parsers that require it; a `#`-comment is the
only marker that is *inside* the block yet invisible to a YAML mapping load (`safe_load` discards
comments). TQ-3 (tech-spec §10) flags that one of Cursor/Copilot/Gemini-body parsers might reject a
leading in-block comment; if a target rejects it at impl, that target falls back to a **body-top**
HTML comment (Form B placement) for its skill files — REQ-OUT-01's intent (visible + greppable) is
preserved either way. Until a rejection is observed, Form A is the default for all frontmatter files.

### 1.2 Form B — HTML body-top comment for frontmatter-less generated markdown

The only generated markdown file with **no** frontmatter block is `adapters/GENERATION-REPORT.md`
(§3). It cannot take Form A (there is no `---` block), so it carries an **HTML comment as the file's
first line** — verifier V-003. The template is `PROVENANCE_BODY_TOP` from `00-core-definitions.md §7`:

```python
# from 00-core-definitions.md §7 — referenced, NOT redefined here:
# PROVENANCE_BODY_TOP = (
#     "<!-- GENERATED — DO NOT EDIT. Regenerate: " + REGENERATE_CMD + " -->"
# )
```

**Exact emitted bytes** (first two lines of `adapters/GENERATION-REPORT.md`):

```
<!-- GENERATED — DO NOT EDIT. Regenerate: python3 scripts/build-adapters.py -->
# Adapter Generation Report
```

Form B carries **no** `{source}` field by design: the report has no single canonical source file
(it aggregates `DropRecord`s from across all of canon, §3). The "source" of the report *is* the whole
canon under the regenerate command, which the line already names. This is the one generated markdown
where the source-path field is intentionally absent; every per-skill/per-agent file (Form A) carries
its specific `{source}`.

### 1.3 Form C — strict-JSON `_generated` object (OQ-2)

`adapters/gemini/gemini-extension.json` is strict JSON: JSON admits **no** comment syntax, so neither
Form A nor Form B is expressible. Provenance is instead carried as a documented top-level object,
keyed by `PROVENANCE_JSON_KEY = "_generated"` (`00-core-definitions.md §7`, resolving **OQ-2**). The
object is produced by `provenance_json(source)` from the foundation:

```python
# from 00-core-definitions.md §7 — referenced, NOT redefined here:
# PROVENANCE_JSON_KEY = "_generated"
# def provenance_json(source: str) -> dict[str, str]:
#     return {"source": source, "regenerate": REGENERATE_CMD}
```

**The merged manifest is written by the engine, not the emitter (V-001).** The gemini emitter returns
one `ManifestEntry` per skill in `EmitResult.manifest_entries` (`00 §5`); the engine collects them
across the per-record loop and writes the single `gemini-extension.json` via `_publish_manifest`
(`02-generator-engine.md §4.1`). The same mechanism produces codex's `agents/openai.yaml` from its
per-agent `ManifestEntry`s. `_publish_manifest` is the one place the whole-bundle manifest is
serialized:

```python
import json

from core_definitions import (  # 00 §7
    GEMINI_EXTENSION_VERSION,
    PROVENANCE_JSON_KEY,
    provenance_json,
)


def _publish_manifest(
    root: Path, dest: Path, agent_id: str, entries: tuple[ManifestEntry, ...]
) -> None:
    """Serialize the whole-bundle manifest from collected ManifestEntry-s (V-001).

    Only `gemini` (gemini-extension.json) and `codex` (agents/openai.yaml) reach
    here; other targets pass no entries (02 §4.1). The serialized object is FIXED-
    ORDER for determinism (REQ-DET-01): `_generated` first, then the manifest's own
    keys, then the per-record array built from `entries` in their (deterministic)
    accumulation order. `version` is the fixed `GEMINI_EXTENSION_VERSION` constant
    (00 §7) — never a timestamp.
    """
    if agent_id == "gemini":
        manifest: dict[str, object] = {
            PROVENANCE_JSON_KEY: provenance_json("skills/"),
            "name": "feature-forge",
            "version": GEMINI_EXTENSION_VERSION,  # fixed constant, 00 §7 (V-002)
            "skills": [
                {"name": e.name, "description": e.description, **e.extra}
                for e in entries
            ],
        }
        rel = "gemini-extension.json"
        content = json.dumps(manifest, indent=2, sort_keys=False, ensure_ascii=False) + "\n"
        safe_write(dest / agent_id, rel, content)  # 02 §4.2 sandbox guard
    elif agent_id == "codex":
        ...  # agents/openai.yaml; shape TQ-1 (03 §4.3), same _generated-first rule
```

**Exact emitted bytes** (head of `adapters/gemini/gemini-extension.json`):

```json
{
  "_generated": {
    "source": "skills/",
    "regenerate": "python3 scripts/build-adapters.py"
  },
  "name": "feature-forge",
  "version": "0.0.0",
  "skills": [
    …
  ]
}
```

Because `_generated` is a real JSON member (not a comment), it survives a strict parse, is greppable,
and is diffable by the drift guard — satisfying REQ-OUT-01 for a comment-less format. `version` is the
fixed `GEMINI_EXTENSION_VERSION` (`00 §7`), so two builds produce byte-identical manifests (REQ-DET-01).

### 1.4 Exempt case — `forge-root.sh` carries NO header (REQ-GEN-05)

`scripts/forge-root.sh` is copied **byte-identical** into every bundle (`adapters/<agent>/scripts/
forge-root.sh`, mode 0755) — REQ-GEN-05 forbids reflowing or editing it. Injecting any provenance
header would change its bytes and break byte-identity. Therefore the copied resolver carries **no
provenance header** of any form.

Its provenance is instead **documented in `GENERATION-REPORT.md`** (§3.3): a fixed "Copied verbatim
(no header)" section names `scripts/forge-root.sh` as the byte-identical source, records mode 0755,
and states why no header is present (REQ-GEN-05). This satisfies REQ-OUT-01's *intent* — every
generated artifact's provenance is discoverable — without violating REQ-GEN-05's byte-identity. The
copy and the byte-identity assertion are part of the self-containment pass (§2.3).

### 1.5 Where each form is injected (consistency with 02 / 03)

To keep responsibility unambiguous and match the engine/emitter split in `00-core-definitions.md §5`
(`EmitResult.files` carries content "provenance header already applied"):

- **Form A** is injected by the **emitter** that owns the frontmatter, because only the emitter knows
  the file's canonical `source_path` and the exact frontmatter shape. The emitter renders
  `PROVENANCE_FM_COMMENT.format(source=record.source_path)` as the first line *inside* the `---`
  block and returns the file in `EmitResult.files` already stamped (`00-core-definitions.md §5`).
  `03-per-agent-emitters.md` shows this per agent.
- **Form C** is injected by the **engine's `_publish_manifest`** (§1.3, `02-generator-engine.md §4.1`),
  which owns the merged whole-bundle JSON/YAML manifest and places the `_generated` member first. The
  emitter only contributes per-record `ManifestEntry`s (`00 §5`); it does not serialize the manifest
  (V-001).
- **Form B** is injected by the **report builder** in the **engine** (§3), because the report is not
  an emitter artifact — it is assembled by the engine from the aggregated `DropRecord`s
  (`02-generator-engine.md`).
- **EXEMPT** files are written by the engine's **self-containment pass** (§2) as raw byte copies; no
  header injection occurs anywhere in that path.

This matches `00-core-definitions.md §5`'s note that "References + forge-root.sh copies are added by
the engine's self-containment pass, not the emitter" — the *emitter* stamps **Form A** onto its own
native frontmatter artifacts; the *engine* handles **Form C** (the merged manifest via
`_publish_manifest`, §1.3), **Form B** (report), and the EXEMPT copies.

### 1.6 Note on verbatim-copied reference files

Files copied under `adapters/<agent>/references/**` and `adapters/<agent>/skills/*/references/**`
are byte-for-byte copies of canonical `references/` content (§2). They are **not** "generated" in the
authored sense — they are transported verbatim — and stamping them would break the byte-identity the
self-containment guarantee relies on (and would corrupt JSON schema files / markdown that other
tools parse). They therefore carry **no** per-file header; their provenance is the whole-tree copy
documented in the report's "Copied verbatim" section (§3.3), exactly as for `forge-root.sh`. This is
the same exempt rationale as §1.4, applied to the reference closure. (REQ-OUT-01 says "every
*generated* file"; verbatim transport copies are recorded collectively in the report rather than
individually stamped — the maintainer-visible provenance requirement is met.)

## 2. Self-containment pass — reference closure + resolver copy (REQ-GEN-04, REQ-GEN-05)

Per REQ-GEN-04, each per-agent bundle MUST be **runnable for that agent without reaching back into
canon**. The engine satisfies this with a **self-containment pass** that runs once per agent bundle,
**after** the emitters have produced that agent's native skill/agent artifacts and **before** the
atomic publish (`02-generator-engine.md §4`). The pass is the engine's job, applied uniformly to
**every** agent — it is **not** per-emitter (`00-core-definitions.md §5`: "References + forge-root.sh
copies are added by the engine's self-containment pass, not the emitter").

The pass adds three things to each `adapters/<agent>/` bundle:

1. The whole repo-root `references/` tree, verbatim (§2.1).
2. Each skill's own `references/` subdir, verbatim, beside that skill's artifact (§2.2).
3. The byte-identical `scripts/forge-root.sh`, mode 0755 (§2.3).

### 2.1 Whole-tree copy of the shared `references/` (decision D5)

Decision **D5** (tech-spec §3) chose **whole-tree copy** of the repo-root `references/` over computed
per-file transitive-closure parsing: parsing every skill/agent body for `references/...` mentions is
fragile (mentions in prose, partial paths, indirect references), whereas markdown + small JSON
schemas are tiny so copying the whole tree has negligible cost (REQ-PERF-01) and is trivially
correct. **Whole-tree copy is itself the transitive-closure guarantee**: every shared reference any
skill could reach is present, so no closure computation can under-collect.

The shared tree is the **14-file** repo-root `references/` (verified ground truth, `tech-spec.md §6`
/ `01-architecture-layout.md §7`, branch `forge/skill-spec-purity`):

```
references/
├── epic-manifest-schema.json
├── forge-config-schema.json
├── pipeline-state-schema.json
├── portable-root.md
├── process-overview.md
├── ralph-loop-contract.md
├── shared-conventions.md
├── stack-resolution.md
├── vendor-construct-inventory.md
└── stacks/
    ├── _generic.md
    ├── go.md
    ├── python.md
    ├── rust.md
    └── typescript.md
```

= **9 root files + 5 `stacks/` files = 14 files.** All 14 are copied **verbatim** (byte-for-byte,
including the JSON schemas and the load-bearing `shared-conventions.md`, `portable-root.md`,
`stack-resolution.md`) into `adapters/<agent>/references/`, preserving the `stacks/` subdirectory
structure. No file is reflowed, filtered, or header-stamped (§1.6).

### 2.2 Each skill's own `references/` subdir

7 of the 11 skills carry their own `references/` subdir (verified ground truth,
`01-architecture-layout.md §7`): `forge-0-epic`, `forge-1-prd`, `forge-2-tech`, `forge-3-specs`,
`forge-5-loop`, `forge-6-docs`, `forge-verify`. Where `SkillRecord.own_refs is not None`
(`00-core-definitions.md §2`), that subdir is copied verbatim to
`adapters/<agent>/skills/<name>/references/`, beside the skill's translated artifact. The other 4
skills have no own-references copy (their bundle skill dir holds only the native skill file). This is
**discovery-driven** (REQ-SCALE-01): the presence of an own-references dir is read from
`own_refs`, never hard-coded, so a new skill that adds a `references/` subdir is covered with no
generator change.

### 2.3 Byte-identical `forge-root.sh` copy (REQ-GEN-05)

`scripts/forge-root.sh` (verified: **50 lines, mode 0755**, `01-architecture-layout.md §7`) is copied
**byte-for-byte** to `adapters/<agent>/scripts/forge-root.sh`, mode **0o755**, with **no** header
(§1.4). The generator MUST NOT reflow, re-indent, normalize line endings of, or otherwise edit it.

The bundle copy will **not** self-resolve to the bundle root (the sentinels it probes —
`scripts/epic-manifest.py`, `.claude-plugin/plugin.json` — are not present in the bundle); that is
**expected and out of scope** here (foreign-agent discovery is owned by `cross-agent-installer`,
PRD §6 / `01-architecture-layout.md §7`). The pass copies verbatim and asserts byte-identity, nothing
more.

### 2.4 Copy procedure + verbatim / byte-identity assertion

The self-containment pass is implemented as a pure copy routine. It uses the **already-read** record
data where available and reads canon read-only otherwise (C-3); it asserts every output path resolves
within the bundle (REQ-SEC-01) and asserts byte-identity for `forge-root.sh`:

> **Cross-OS byte-identity depends on an LF-normalized canon checkout (V-018).** `_copytree_verbatim`
> and the `forge-root.sh` copy use `shutil.copyfile` — a **raw byte copy**, which is correct (it
> preserves byte-identity and never reflows, §1.4/§1.6/REQ-GEN-05). But it also means the bundle
> copies inherit whatever line endings the canonical `references/`/`forge-root.sh` files have on the
> working-tree checkout, whereas emitter-produced files are forced to `\n` (`02 §4.2`, `newline=""`).
> If canon were checked out with CRLF on a Windows working tree, the verbatim copies would carry CRLF
> while the emitted files carry LF, and a fresh build on a different OS could fail the `--check` drift
> guard (`02 §4.3`) for a **non-canon, line-ending** reason. The contract: **canonical `references/`
> and `forge-root.sh` are assumed `\n`-normalized in the repo**, enforced by a `.gitattributes`
> `* text=auto eol=lf` (or equivalent) policy. That `.gitattributes` is **owned by the
> `packaging-docs-ci` epic member** (PRD §6 / epic manifest — "`.gitattributes` LF/export-ignore
> safety"), not by this feature; this feature **declares the dependency** rather than re-normalizing
> on copy, so `shutil.copyfile` + the byte-identity assertion stay intact. The `--check` guard's
> cross-OS validity rests on this assumption (`05-purity-exemption-and-drift-guard.md §2.1`).

```python
from __future__ import annotations

import hashlib
import shutil
from pathlib import Path


def run_self_containment_pass(
    bundle_root: Path,
    repo_root: Path,
    skills: tuple[SkillRecord, ...],
) -> None:
    """Add the reference closure + verbatim forge-root.sh to one agent bundle.

    Runs once per `adapters/<agent>/` bundle, AFTER its emitters have written
    native artifacts and BEFORE atomic publish (`02-generator-engine.md §4`).
    Applies to every agent uniformly — NOT per-emitter (`00-core-definitions.md §5`).
    Satisfies REQ-GEN-04 (self-containment) + REQ-GEN-05 (byte-identical resolver).

    Args:
        bundle_root: The agent's bundle dir (e.g. `<repo>/adapters.tmp-<pid>/claude`).
        repo_root: The resolved feature-forge repo root (canon lives here; read-only, C-3).
        skills: Parsed skills, used to copy each skill's own `references/` (§2.2).

    Raises:
        AssertionError: If `forge-root.sh` byte-identity fails (REQ-GEN-05) or an
            output path escapes `bundle_root` (REQ-SEC-01). Surfaced as a generator
            defect, not a `CanonError` (canon is pre-gated pure upstream).
    """
    # (1) Whole-tree shared references/ copy, verbatim (D5, §2.1).
    src_refs = repo_root / "references"
    dst_refs = bundle_root / "references"
    _copytree_verbatim(src_refs, dst_refs, bundle_root)

    # (2) Each skill's own references/ subdir, where present (§2.2, REQ-SCALE-01).
    for skill in skills:
        if skill.own_refs is None:
            continue
        dst_own = bundle_root / "skills" / skill.name / "references"
        _copytree_verbatim(skill.own_refs, dst_own, bundle_root)

    # (3) Byte-identical forge-root.sh copy, mode 0755, NO header (§2.3, REQ-GEN-05).
    src_resolver = repo_root / "scripts" / "forge-root.sh"
    dst_resolver = bundle_root / "scripts" / "forge-root.sh"
    dst_resolver.parent.mkdir(parents=True, exist_ok=True)
    _assert_within(dst_resolver, bundle_root)
    shutil.copyfile(src_resolver, dst_resolver)   # bytes only — never copystat/edit
    dst_resolver.chmod(0o755)
    _assert_byte_identical(src_resolver, dst_resolver)  # REQ-GEN-05 hard assertion


def _copytree_verbatim(src: Path, dst: Path, bundle_root: Path) -> None:
    """Recursively copy `src` → `dst` byte-for-byte (no header injection, §1.6).

    Walks `src` in sorted POSIX order (REQ-DET-01) so any incidental ordering is
    stable. Every destination is asserted within `bundle_root` (REQ-SEC-01).
    """
    for entry in sorted(src.rglob("*"), key=lambda p: p.relative_to(src).as_posix()):
        rel = entry.relative_to(src)
        target = dst / rel
        _assert_within(target, bundle_root)
        if entry.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(entry, target)  # verbatim bytes; no stamp, no reflow


def _assert_within(path: Path, root: Path) -> None:
    """Assert `path` resolves within `root` (REQ-SEC-01 path-sandbox)."""
    resolved = path.resolve()
    root_resolved = root.resolve()
    assert (
        resolved == root_resolved or root_resolved in resolved.parents
    ), f"path escapes bundle sandbox: {resolved} not under {root_resolved}"


def _assert_byte_identical(src: Path, dst: Path) -> None:
    """Assert `dst` is byte-for-byte identical to `src` (REQ-GEN-05)."""
    src_hash = hashlib.sha256(src.read_bytes()).hexdigest()
    dst_hash = hashlib.sha256(dst.read_bytes()).hexdigest()
    assert src_hash == dst_hash, (
        f"forge-root.sh copy is not byte-identical to canon "
        f"(src {src_hash[:12]} != dst {dst_hash[:12]}) — REQ-GEN-05 violated"
    )
```

**Notes.**

- The pass writes into the **staging** bundle (`adapters.tmp-<pid>/<agent>/`,
  `02-generator-engine.md §4`), which the engine atomic-swaps over `adapters/` only on full success.
  It never writes outside that staging tree (REQ-SEC-01).
- Byte-identity is enforced by SHA-256 hash compare for `forge-root.sh` (REQ-GEN-05) and tested
  independently in `06-testing-strategy.md`.
- `shutil.copyfile` (not `copy2`/`copystat`) is used deliberately: it copies **content only** and
  does not propagate mtime/atime, so the copy carries no machine-dependent timestamp metadata into
  the committed tree (REQ-DET-01). Mode is set explicitly (`0o755` for the resolver; default for
  references — git tracks the executable bit, and reference files are non-executable).
- `LC_ALL=C` byte-order sorting of the walk (REQ-DET-01) makes the copy traversal deterministic; the
  output bytes do not depend on filesystem enumeration order.

## 3. Generation report — `adapters/GENERATION-REPORT.md` content contract (REQ-OBS-01, OQ-3)

The generator emits a **committed** generation report at `adapters/GENERATION-REPORT.md` (OQ-3 →
committed; tech-spec §3.5). It is the "with-record" half of drop-with-record (REQ-OBS-01 /
REQ-FMT-03): per agent, it lists **every** canonical construct that was dropped or could not be
represented, so lost behavior is visible rather than silent.

Because it is a committed `adapters/` file, the report is **itself part of the drift-guarded tree**
(`05-purity-exemption-and-drift-guard.md`): if a regeneration would change which constructs are
dropped, the report changes, `--check` fails, and the maintainer must regenerate and commit — keeping
the drop record permanently truthful (REQ-OUT-02). It carries the **Form B** body-top provenance line
(§1.2) as its first line.

### 3.1 Report assembly + deterministic ordering (REQ-DET-01)

The report is built by the engine from the aggregated `DropRecord`s collected across every emitter's
`EmitResult.drops` (`00-core-definitions.md §5–§6`). All rows are **sorted by
`(agent, source, construct)`** before rendering (`00-core-definitions.md §6` mandates this sort key)
so the report is byte-identical across runs regardless of emit order:

```python
def render_generation_report(drops: tuple[DropRecord, ...]) -> str:
    """Render the committed `adapters/GENERATION-REPORT.md` body (REQ-OBS-01).

    Carries the Form B body-top provenance line (§1.2) as line 1. Drop rows are
    grouped by agent (AGENT_TARGETS order, `00-core-definitions.md §1`) and within
    each agent sorted by (source, construct) — the same total order as the global
    (agent, source, construct) sort in `00-core-definitions.md §6`, so output is
    deterministic (REQ-DET-01).

    Args:
        drops: Every DropRecord produced by every emitter this run.

    Returns:
        The full report text, newline-normalized to `\\n`, ending in a single `\\n`.
    """
    lines: list[str] = [PROVENANCE_BODY_TOP, "", "# Adapter Generation Report", ""]
    lines.append(
        "Generated by `" + REGENERATE_CMD + "`. Each row is a canonical construct "
        "that the target agent's format cannot represent and that was therefore "
        "omitted (REQ-FMT-03) and recorded here (REQ-OBS-01)."
    )
    lines.append("")

    # Stable total order over all drops (REQ-DET-01).
    ordered = sorted(drops, key=lambda d: (d.agent, d.source, d.construct))

    for agent in AGENT_TARGETS:                      # fixed iteration order
        agent_drops = [d for d in ordered if d.agent == agent]
        lines.append(f"## {agent}")
        lines.append("")
        if not agent_drops:
            lines.append("_No dropped constructs — every canonical construct is "
                         "representable in this agent's format._")
            lines.append("")
            continue
        lines.append("| Source | Construct | Reason |")
        lines.append("|--------|-----------|--------|")
        for d in agent_drops:
            lines.append(f"| `{d.source}` | `{d.construct}` | {d.reason} |")
        lines.append("")

    lines.extend(_render_verbatim_copies_section())  # §3.3
    return "\n".join(lines) + "\n"
```

`claude` typically has an empty drops section (it is the lossless native target — REQ-VND-01/02), so
its section renders the "_No dropped constructs_" sentinel. That empty-section line is itself fixed
text, so it is deterministic.

### 3.2 What MUST appear in the report (REQ-OBS-01)

The report MUST record, enumerated **from the parsed frontmatter** of each canonical file (never a
hard-coded list — verifier V-001; `00-core-definitions.md §2`, `AgentRecord.claude_keys`):

- **Dropped sub-agent keys**, per non-Claude agent, for **every** `claude_keys` entry not
  representable in that agent's native form. Because the keys are enumerated per-file, the
  ground-truth union `{tools, model, maxTurns, effort, memory, skills}` is covered *as each file
  actually carries it* — in particular `effort` (present only on `forge-researcher`) and
  `memory` / `skills` (present only on `forge-verifier`) cannot be silently dropped. Example rows:
  `cursor | agents/forge-researcher.md | sub-agent key 'effort' | no Cursor equivalent`;
  `copilot | agents/forge-verifier.md | sub-agent key 'memory' | no Copilot sub-agent construct`.
- **Dropped `argument-hint`** for every non-Claude target that has no invocation-hint field, for each
  of the 10 skills that carry `metadata.argument-hint` (`forge-init` has none — no row for it). The
  exact set of targets that drop vs. reconstruct `argument-hint` is decided by
  `03-per-agent-emitters.md` (per-agent native field availability, TQ-1); whichever drop, this
  document fixes that each such drop yields a report row.
- **Dropped Claude-only artifacts** (e.g. `hooks/hooks.json`) for each non-Claude agent. Per verified
  ground truth no current skill ships a `hooks/` dir (`01-architecture-layout.md §7`), so in the
  current canon there are no `hooks.json` rows; the report contract still covers them so that a
  future Claude-only artifact appearing in canon is recorded for non-Claude targets (REQ-VND-02 /
  REQ-FMT-03). The Claude target **retains** these (REQ-VND-02) — no Claude row.

Every row derives from exactly one `DropRecord` (`00-core-definitions.md §6`); there is no report
content that is not backed by a `DropRecord` (so the report cannot drift from what the emitters
actually dropped — the drift guard enforces this).

### 3.3 "Copied verbatim (no header)" section — resolver + references provenance

To satisfy REQ-OUT-01's intent for the header-exempt files (§1.4, §1.6), the report ends with a fixed
**"Copied verbatim (no provenance header)"** section that documents the provenance of the
byte-identity copies — since they carry no per-file header, this is where their generated-from-canon
provenance lives:

```python
def _render_verbatim_copies_section() -> list[str]:
    """Render the fixed 'copied verbatim' provenance section (§1.4 / §1.6).

    These files carry NO per-file header to preserve byte-identity (REQ-GEN-05) /
    verbatim transport; their provenance is documented here instead, satisfying
    REQ-OUT-01's intent that every generated artifact's provenance is discoverable.
    Fixed text → deterministic (REQ-DET-01).
    """
    return [
        "## Copied verbatim (no provenance header)",
        "",
        "These files are transported byte-for-byte from canon into every "
        "`adapters/<agent>/` bundle and intentionally carry **no** provenance "
        "header (a header would break byte-identity / corrupt parsed files):",
        "",
        "- `scripts/forge-root.sh` → `adapters/<agent>/scripts/forge-root.sh` "
        "(mode 0755, byte-identical — REQ-GEN-05).",
        "- the whole repo-root `references/` tree (14 files: 9 root + `stacks/`×5) "
        "→ `adapters/<agent>/references/` (verbatim — REQ-GEN-04 / D5).",
        "- each skill's own `references/` subdir → "
        "`adapters/<agent>/skills/<name>/references/` (verbatim, where present).",
        "",
        "Regenerate all adapter output with `" + REGENERATE_CMD + "`.",
        "",
    ]
```

### 3.4 Example report body

A small illustrative `adapters/GENERATION-REPORT.md` (abbreviated — real output enumerates every
skill × hint drop and every sub-agent × key drop, sorted):

```markdown
<!-- GENERATED — DO NOT EDIT. Regenerate: python3 scripts/build-adapters.py -->

# Adapter Generation Report

Generated by `python3 scripts/build-adapters.py`. Each row is a canonical construct that the target
agent's format cannot represent and that was therefore omitted (REQ-FMT-03) and recorded here
(REQ-OBS-01).

## claude

_No dropped constructs — every canonical construct is representable in this agent's format._

## codex

| Source | Construct | Reason |
|--------|-----------|--------|
| `agents/forge-researcher.md` | `sub-agent key 'effort'` | no Codex equivalent |
| `agents/forge-researcher.md` | `sub-agent key 'maxTurns'` | no Codex equivalent |
| `agents/forge-verifier.md` | `sub-agent key 'memory'` | no Codex equivalent |
| `agents/forge-verifier.md` | `sub-agent key 'skills'` | no Codex equivalent |
| `skills/forge-1-prd/SKILL.md` | `argument-hint` | no Codex invocation-hint field |
| … | `argument-hint` (×10, one row per hinted skill) | no Codex invocation-hint field |

## cursor

| Source | Construct | Reason |
|--------|-----------|--------|
| `agents/forge-researcher.md` | `sub-agent key 'effort'` | no Cursor equivalent |
| `agents/forge-verifier.md` | `sub-agent key 'memory'` | no Cursor equivalent |
| `agents/forge-verifier.md` | `sub-agent key 'skills'` | no Cursor equivalent |
| `skills/forge-1-prd/SKILL.md` | `argument-hint` | no Cursor field |
| … | `argument-hint` (×10, one row per hinted skill) | no Cursor field |

## copilot

…

## gemini

…

## Copied verbatim (no provenance header)

These files are transported byte-for-byte from canon into every `adapters/<agent>/` bundle and
intentionally carry **no** provenance header (a header would break byte-identity / corrupt parsed
files):

- `scripts/forge-root.sh` → `adapters/<agent>/scripts/forge-root.sh` (mode 0755, byte-identical — REQ-GEN-05).
- the whole repo-root `references/` tree (14 files: 9 root + `stacks/`×5) → `adapters/<agent>/references/` (verbatim — REQ-GEN-04 / D5).
- each skill's own `references/` subdir → `adapters/<agent>/skills/<name>/references/` (verbatim, where present).

Regenerate all adapter output with `python3 scripts/build-adapters.py`.
```

> The exact per-agent rows (which keys/hints each non-Claude agent drops) are determined by the
> native field availability in `03-per-agent-emitters.md`. This document fixes the report's
> **structure, ordering, provenance form, and the rule that every drop is recorded**; the per-agent
> emitter decides *which* `DropRecord`s exist.
>
> **The example is abbreviated — the `… argument-hint (×10 …)` rows above stand for one real row per
> hinted skill (10 rows for the current canon; `forge-init` carries no hint, so no row for it), each
> with its own `skills/<name>/SKILL.md` source.** The report must NOT collapse them into a single
> aggregate row: REQ-OBS-01 requires one `DropRecord` row per dropped construct (§3.2), so every
> hinted skill × dropping target produces its own row.

## Public API — exported vs internal

The feature's only externally-stable contract is the three items in `01-architecture-layout.md §4`;
nothing in this module is a public API. Within it:

| Symbol | Visibility | Notes |
|---|---|---|
| `run_self_containment_pass`, `render_generation_report`, `_publish_manifest` | engine-called entry points | Invoked by the engine (`02 §4.1`) at fixed points in the build; module-internal (test-importable), not an external contract. |
| `_copytree_verbatim`, `_assert_within`, `_assert_byte_identical`, `_render_verbatim_copies_section` | private | Leading-underscore = private; not for cross-module use. |

These are written by the engine's report / self-containment passes — none of their output is an
`EmittedFile` (`00 §5`). All factoring (single-file vs split package, `02 §2`) is implementer's
discretion provided the three `01 §4` contracts hold.

## Dependencies

This document depends on:

- **`00-core-definitions.md`** — the three provenance string templates + `provenance_json` /
  `PROVENANCE_JSON_KEY` / `GEMINI_EXTENSION_VERSION` (§7), `REGENERATE_CMD` (§7), `DropRecord` + its
  `(agent, source, construct)` sort key (§6), `SkillRecord` / `AgentRecord` (incl. `source_path`,
  `own_refs`, `claude_keys`) (§2), `EmitResult` / `EmittedFile` / `ManifestEntry` (§5), `AGENT_TARGETS`
  iteration order (§1). **Referenced, not redefined.**
- **`01-architecture-layout.md`** — the `adapters/<agent>/` bundle layout (§3), the read-only
  integration surfaces (the 14-file `references/` tree, the 7 own-references skills, `forge-root.sh`
  50-line/0755) (§7), and the placement of `GENERATION-REPORT.md` (§2).
- **`02-generator-engine.md`** — the discovery → parse → emit → **self-containment pass** → atomic
  publish flow. The self-containment pass (§2 here) is invoked by the engine after emit and before
  publish; the report builder (§3 here) is invoked by the engine after all emitters run, aggregating
  every `EmitResult.drops`.

Relates to (does **not** depend on): **`03-per-agent-emitters.md`** — the emitters inject Form A/C
headers onto their own native artifacts and produce the `DropRecord`s this document's report
aggregates; the per-agent decision of *which* constructs drop lives there. `05-...-drift-guard.md`
gates the committed report. `06-testing-strategy.md` tests provenance, self-containment, and the
report contract.

**Implementation order:** depends on `02` being scaffolded (engine flow + record types available);
the self-containment pass and report builder are implemented as part of, or immediately after, the
engine, and exercised once the emitters (`03`) produce real `DropRecord`s.

## Verification

An implementation matches this spec iff:

- [ ] **Form A** — every generated file with a frontmatter block has, as the first line **inside**
      `---`, the `PROVENANCE_FM_COMMENT` line with the correct canonical `{source}` path; `---` is
      byte 0 (§1.1). Asserted in `06-testing-strategy.md`.
- [ ] **Form B** — `adapters/GENERATION-REPORT.md`'s first line is exactly `PROVENANCE_BODY_TOP`
      (the HTML comment), and it has no frontmatter block (§1.2, §3).
- [ ] **Form C** — `adapters/gemini/gemini-extension.json` parses as strict JSON and has a top-level
      `_generated` object with `source` + `regenerate` keys, as its first member (§1.3, OQ-2).
- [ ] **EXEMPT** — `adapters/<agent>/scripts/forge-root.sh` carries **no** header and is SHA-256
      byte-identical to `scripts/forge-root.sh`, mode 0755 (§1.4, §2.3, REQ-GEN-05); the verbatim
      `references/` copies carry no per-file header (§1.6).
- [ ] **No timestamps** — no provenance form (A/B/C) or the report contains any timestamp, host,
      user, or PID; only `{source}` varies (§1, REQ-DET-01). Build twice → byte-identical headers +
      report.
- [ ] **Self-containment** — every `adapters/<agent>/` bundle contains all **14** shared
      `references/` files (9 root + 5 `stacks/`), each own-references skill's `references/` subdir
      (the 7 listed), and `forge-root.sh` — the bundle is runnable without reaching back into canon
      (§2, REQ-GEN-04). Asserted in `06-testing-strategy.md`.
- [ ] **Closure correctness** — the shared `references/` copy is whole-tree (D5), so no per-file
      closure parsing is performed and no shared reference can be missing (§2.1).
- [ ] **Path sandbox** — every self-containment write resolves within the staging bundle; an escape
      raises `AssertionError` (§2.4, REQ-SEC-01).
- [ ] **Report completeness** — every `DropRecord` produced by any emitter appears as exactly one
      row in `GENERATION-REPORT.md`; sub-agent keys (incl. `effort`, `memory`, `skills`) and dropped
      `argument-hint` are enumerated from parsed frontmatter, not a fixed list (§3.2, REQ-OBS-01,
      verifier V-001).
- [ ] **Report determinism** — rows are sorted by `(agent, source, construct)`; agent sections are in
      `AGENT_TARGETS` order; the "Copied verbatim" section is fixed text (§3.1, §3.3, REQ-DET-01).
- [ ] **Report is committed + drift-guarded** — `adapters/GENERATION-REPORT.md` is checked in and
      part of the `--check` diff (§3, REQ-OUT-02, OQ-3).
