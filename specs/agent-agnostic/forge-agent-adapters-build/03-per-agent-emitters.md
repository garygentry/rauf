# 03 — Per-Agent Emitters

> Feature: `forge-agent-adapters-build` (epic `agent-agnostic`, member 3 of 6, target repo
> **feature-forge** at `/home/gary/workspace/feature-forge`). Source of truth: `PRD.md` (v1) §3.2–§3.3
> + `tech-spec.md` (v1) §3.1–§3.3, §5. This document specifies the **five concrete emitters** — one
> per `AGENT_TARGETS` id (`claude`, `codex`, `copilot`, `cursor`, `gemini`) — that each implement the
> `Emitter` protocol from `00-core-definitions.md §5`. For every target it pins: the native skill
> artifact + filename, the exact frontmatter/field mapping (canonical fields projected onto the
> target's native format using `FRONTMATTER_KEY_ORDER` from `00 §4`), how `description` is preserved
> byte-for-byte (REQ-FMT-04), how the invocation-hint is handled (REQ-FMT-02 — reconstructed where a
> field exists, drop-with-record otherwise), the sub-agent translation (REQ-GEN-06 — translate to a
> native construct or drop-with-record **every** `claude_keys` entry per `00 §6`), and which
> Claude-only artifacts are dropped+recorded.
>
> **Out of this document's scope (cross-reference, do not duplicate):** the discovery → parse → publish
> engine and the emitter registry that drives these emitters is `02-generator-engine.md`; the
> references-closure self-containment pass, the provenance-header mechanics, and the
> `GENERATION-REPORT.md` assembly are `04-provenance-selfcontainment-report.md`. This document
> produces `EmitResult`s only — `files` (native bytes) + `drops` (`DropRecord`s) — never the
> `references/`/`forge-root.sh` copies and never the report file.
>
> **Stack note:** the configured `stack` is `typescript`, but this feature ships **Python 3 + Bash +
> Markdown** in feature-forge — there is **no** TypeScript and **no** `pnpm` gate (constraint **C-2**).
> All code below is exact Python 3 (3.10 baseline, Google-style docstrings, full type annotations,
> matching `scripts/epic-manifest.py`), not pseudocode. The TypeScript stack profile does not apply.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-GEN-03 | Five target agents, each a concrete emitter | §1, §3–§7 |
| REQ-GEN-06 | Sub-agent translation; enumerate every `claude_keys` entry | §2.3, §3.3, §4.3, §5.3, §6.3, §7.3 |
| REQ-FMT-01 | Each emitter produces the agent's documented native format | §3–§7 |
| REQ-FMT-02 | Invocation-hint reconstructed where a field exists, else drop-recorded | §2.2, §3.2, §4.2, §5.2, §6.2, §7.2 |
| REQ-FMT-03 | Unrepresentable construct omitted + recorded (never invalid frontmatter) | §2.3, §2.4, §3–§7 (per-agent drops) |
| REQ-FMT-04 | `description` preserved byte-for-byte in every target with a description field | §2.1 |
| REQ-VND-01 | Claude `argument-hint` reconstructed from `metadata.argument-hint` | §3.2 |
| REQ-VND-02 | Claude-only artifacts retained for the Claude target | §3.4 |
| TQ-1 (open) | Per-agent native field names confirmed-or-flagged; emitter isolation | §1.1, §2.5, §3–§7, §8 |

> This is a procedural document: it consumes the **names, types, and constants** from
> `00-core-definitions.md` (`AGENT_TARGETS`, `SkillRecord`, `AgentRecord`, `FRONTMATTER_KEY_ORDER`,
> `Emitter`, `EmittedFile`, `EmitResult`, `DropRecord`, the provenance constants) and **references,
> never redefines, them.**

## 1. Emitter suite overview (REQ-GEN-03)

Each of the five `AGENT_TARGETS` ids (`00 §1`) is implemented by exactly one emitter class
satisfying the `Emitter` protocol (`00 §5`). All five live in `scripts/build-adapters.py`; the engine
(`02-generator-engine.md §2`) instantiates them into a registry literal keyed by
`emitter.agent_id`. This document specifies each emitter's two methods — `emit_skill(skill:
SkillRecord) -> EmitResult` and `emit_agent(agent: AgentRecord) -> EmitResult` — and the cross-cutting
helpers they share (§2).

| `agent_id` | Native skill artifact (relpath under `adapters/<agent>/`) | Native sub-agent form | Manifest | Vendor: REQ-VND |
|---|---|---|---|---|
| `claude` | `skills/<name>/SKILL.md` (YAML frontmatter) | `agents/<name>.md` (full Claude frontmatter) | — | VND-01/02 |
| `codex` | `skills/<name>/<name>.md` (YAML frontmatter mirror) | `agents/openai.yaml` (optional) | — | — |
| `copilot` | `skills/<name>/<name>.md` (Copilot frontmatter) | — (drop-recorded) | — | — |
| `cursor` | `skills/<name>/<name>.mdc` (`.mdc` rule frontmatter) | — (drop-recorded) | — | — |
| `gemini` | `skills/<name>/<name>.md` (body file) | — (drop-recorded) | `gemini-extension.json` | — |

**Determinism (REQ-DET-01):** every emitter is **pure** (`00 §5`) — same `SkillRecord`/`AgentRecord`
in, byte-identical `EmitResult` out. No clock, env, RNG, or filesystem read. All YAML frontmatter is
serialized through the shared dumper (§2.1) with `sort_keys=False` over the subset of
`FRONTMATTER_KEY_ORDER` (`00 §4`) the target defines — never an ad-hoc key order.

### 1.1 TQ-1 — native-schema confirmation status (REQ-GEN-03 notes, tech-spec §10)

The emitter **architecture** is fixed; several **native field names** in §3–§7 were specified from
each agent's published conventions, not from a source artifact in this repo (tech-spec §5, §10).
TQ-1 mandates confirming each against the agent's **official docs at implementation**. Because the
context7 MCP / web docs were **not reachable in this authoring environment**, every field below that
was not directly confirmable carries a visible **`TQ-1`** flag inline. The structural safety net
(emphasized per the dispatch) is that **emitters are isolated**: a wrong field name is contained to
one `emit_*` method, is caught immediately by the drift guard + tests
(`04-provenance-selfcontainment-report.md`, `06-testing-strategy.md`), and a correction is a one-line
edit with no cross-emitter ripple. The TQ-1 fields and their resolution protocol are summarized in
**§8**.

## 2. Cross-cutting emitter rules

These four rules bind **every** emitter; the per-agent sections (§3–§7) state only the deltas.

### 2.1 `description` byte-fidelity & the shared YAML dumper (REQ-FMT-04, REQ-DET-01)

`SkillRecord.description` and `AgentRecord.description` are copied **verbatim** into every target that
has a description field — never reflowed, re-quoted lossily, or trimmed (`00 §2` field contract;
REQ-FMT-04). The shared dumper is configured for byte-stability and scalar preservation per
`02-generator-engine.md §3` (`sort_keys=False`, `default_flow_style=False`, `allow_unicode=True`,
wide `width`). Emitters call **one** shared helper so the options can never drift between targets:

```python
from typing import Any
import yaml  # the pinned dependency (00 §3, 02-generator-engine.md §3)

from build_adapters_types import (  # the 00 §1–§9 definitions, imported as named in the engine
    FRONTMATTER_KEY_ORDER,
    PROVENANCE_FM_COMMENT,
)


def render_frontmatter_block(fields: dict[str, Any], source_path: str) -> str:
    """Serialize a frontmatter mapping into a provenance-stamped `---` block.

    The keys of `fields` MUST already be a subset of FRONTMATTER_KEY_ORDER (00 §4)
    in that fixed order; this helper does NOT reorder (`sort_keys=False`), so the
    caller is responsible for projecting onto the canonical order. The provenance
    comment (00 §7, Form A) is emitted as the first line INSIDE the block so `---`
    stays byte 0 for strict parsers (04-provenance-selfcontainment-report.md §1).

    Args:
        fields: Native frontmatter keys → values, already in FRONTMATTER_KEY_ORDER.
            `description`'s value is the decoded canonical scalar; the dumper
            preserves it byte-for-byte (REQ-FMT-04).
        source_path: Repo-relative POSIX path of the canonical source, for the
            provenance comment (REQ-OUT-01).

    Returns:
        A complete frontmatter block: `---\\n# GENERATED…\\n<yaml>---\\n`.
    """
    body = yaml.safe_dump(
        fields,
        sort_keys=False,
        default_flow_style=False,
        allow_unicode=True,
        width=4096,
    )
    comment = PROVENANCE_FM_COMMENT.format(source=source_path)
    return f"---\n{comment}\n{body}---\n"


def order_fields(native: dict[str, Any]) -> dict[str, Any]:
    """Project a native field map onto FRONTMATTER_KEY_ORDER (00 §4), dropping keys
    the canonical order does not name and skipping keys absent from `native`.

    A key present in `native` but absent from FRONTMATTER_KEY_ORDER is a generator
    bug (emitters MUST only use ordered keys); it is asserted, not silently passed.
    """
    out: dict[str, Any] = {}
    for key in FRONTMATTER_KEY_ORDER:
        if key in native:
            out[key] = native[key]
    assert set(native) <= set(FRONTMATTER_KEY_ORDER), (
        f"emitter produced un-ordered keys: {set(native) - set(FRONTMATTER_KEY_ORDER)}"
    )
    return out
```

> The emitter assembles `description` as `skill.description` (the decoded scalar from `00 §2`); the
> dumper re-encodes it. `06-testing-strategy.md` asserts the **decoded** value round-trips byte-for-byte
> per target — that is the REQ-FMT-04 contract, not the on-disk quoting style.

### 2.2 Invocation-hint handling (REQ-FMT-02)

`metadata.argument-hint` (present on 10 of 11 skills; **absent on `forge-init`** — `01 §7`) is the
single relocated canonical metadata that must be reconstructed where a target has an equivalent
field (REQ-FMT-02). The two-branch rule, applied identically by every emitter:

1. **Target HAS an invocation-hint field** → reconstruct it losslessly from
   `skill.metadata["argument-hint"]`, emitted under the target's native field name. **Only `claude`
   is confirmed to have such a field** (`argument-hint`, §3.2). For Codex/Copilot/Gemini the existence
   of a hint field is **TQ-1-unconfirmed** (§8); the emitters are written to reconstruct *if and only
   if* the field is confirmed, defaulting to branch 2 until then.
2. **Target has NO invocation-hint field** (or `skill.metadata` is `None`, i.e. `forge-init`) → the
   hint is **omitted from output and recorded** as a `DropRecord` (`00 §6`; REQ-FMT-03). `forge-init`
   produces **no** hint and **no** drop (there is nothing to drop — it never carried one).

```python
def hint_value(skill: SkillRecord) -> str | None:
    """Return the canonical argument-hint scalar, or None if the skill has none.

    None for `forge-init` (no metadata) — emitters emit no hint AND record no drop
    for it (there is no construct to drop). For the other 10 skills this is the
    verbatim relocated value (REQ-VND-01 / REQ-FMT-02).
    """
    if skill.metadata is None:
        return None
    hint = skill.metadata.get("argument-hint")
    return hint if isinstance(hint, str) else None
```

### 2.3 Sub-agent translation — enumerate every `claude_keys` entry (REQ-GEN-06, REQ-FMT-03)

`emit_agent` translates each canonical sub-agent (`00 §2`, `AgentRecord`) into the target's native
agent construct **where one exists**, and for **every** `claude_keys` entry not representable in that
construct, emits a `DropRecord`. The enumeration is driven by `agent.claude_keys` (the per-file
parsed keys — `00 §2`/`§3`), **never** a hard-coded list, so `effort` (researcher-only) and
`memory`/`skills` (verifier-only) cannot be silently dropped (verified ground truth, `00 §2` table).

```python
def drop_all_claude_keys(
    agent: AgentRecord, agent_id: str, reason: str
) -> tuple[DropRecord, ...]:
    """Record EVERY claude_keys entry of one sub-agent as dropped for a target that
    has no native sub-agent construct (REQ-GEN-06 / REQ-FMT-03 / REQ-OBS-01).

    Enumerates agent.claude_keys (per-file, not hard-coded), so a future Claude-only
    key is auto-covered (REQ-SCALE-01). `description` and `name` are NOT dropped —
    they are preserved into the body artifact the target still receives.
    """
    return tuple(
        DropRecord(
            agent=agent_id,
            source=agent.source_path,
            construct=f"sub-agent key '{key}'",
            reason=reason,
        )
        for key in agent.claude_keys  # source order (00 §3) → deterministic
    )
```

> Even where a target has **no** agent construct, the sub-agent's **body + `description`** are still
> emitted as an instruction file (so the behavior text is not lost) while the structural keys are
> drop-recorded. Each per-agent §x.3 states whether the target gets a native construct (claude full,
> codex `openai.yaml`) or a body-only fallback (copilot/cursor/gemini), and exactly which keys drop.

### 2.4 Claude-only artifact disposition (REQ-FMT-03, REQ-VND-02)

Claude-valid, non-portable artifacts (per the upstream inventory: `hooks/hooks.json` SessionStart
wiring — `forge-skill-spec-purity` `references/vendor-construct-inventory.md`, disposition
`out-of-canon`) are **retained only for the `claude` target** (§3.4, REQ-VND-02) and
**omitted-with-record for every non-Claude target** (REQ-FMT-03). Per `01 §7`, **no skill currently
has a `hooks/` dir** in the per-skill tree (the hook wiring lives at the plugin root, not under
`skills/`), so in the current canon this is a **latent** rule: it produces no `DropRecord` today, but
each non-Claude emitter MUST record any such artifact it encounters so adding one later cannot
silently lose it. (`hooks/hooks.json` is not a `references/` file and is not part of the D5 whole-tree
references copy, so it never leaks into a non-Claude bundle by accident.)

### 2.5 Emitter isolation (TQ-1 containment)

Each emitter is a standalone class with no shared mutable state; the registry (`02 §2`) wires them by
id. A TQ-1 correction to one target's native field name (§8) touches exactly that emitter's `emit_*`
method and is caught by the drift guard + the per-target byte-snapshot tests. This is the
architectural guarantee that lets §3–§7 ship with convention-based mappings now and firm them at
impl without a redesign.

## 3. `claude` emitter (REQ-VND-01, REQ-VND-02, REQ-GEN-06)

**Confirmed against repo canon** — the Claude formats below are the *source* shapes (the pre-purity
top-level `argument-hint`, the full sub-agent frontmatter still present in `agents/*.md`), so they are
**not TQ-1**: they are a documented round-trip of the canon this repo already contains.

### 3.1 Skill artifact

- **Relpath:** `skills/<name>/SKILL.md` (Claude's native skill filename).
- **Frontmatter keys** (subset of `FRONTMATTER_KEY_ORDER`): `name`, `description`,
  `argument-hint` (when present).
- **Body:** `skill.body` verbatim.
- **Mode:** `0o644`.

### 3.2 `argument-hint` reconstruction (REQ-VND-01, REQ-FMT-02)

The Claude emitter is the one target with a **confirmed** invocation-hint field: top-level
`argument-hint`. It reconstructs it from `metadata.argument-hint`, restoring the pre-purity
Claude-native shape with **no information loss** (REQ-VND-01). The 10 skills that carry a hint get a
top-level `argument-hint`; **`forge-init` gets none** (`hint_value` returns `None` → omit, no drop;
§2.2).

**Worked before → after (claude, `forge-1-prd`):**

```yaml
# ── canonical SOURCE (skills/forge-1-prd/SKILL.md) ──────────
---
name: forge-1-prd
description: "Create a requirements PRD for a feature through structured interview. Use when user runs /feature-forge:forge-1-prd or explicitly asks to start the forge pipeline for a new feature. Do NOT trigger for general requirements discussions, project scoping outside forge, or PRD questions unrelated to the forge pipeline."
metadata:
  argument-hint: "<feature-name>"
---
```

```yaml
# ── EMITTED adapters/claude/skills/forge-1-prd/SKILL.md ─────
---
# GENERATED — DO NOT EDIT. Source: skills/forge-1-prd/SKILL.md. Regenerate: python3 scripts/build-adapters.py
name: forge-1-prd
description: "Create a requirements PRD for a feature through structured interview. Use when user runs /feature-forge:forge-1-prd or explicitly asks to start the forge pipeline for a new feature. Do NOT trigger for general requirements discussions, project scoping outside forge, or PRD questions unrelated to the forge pipeline."
argument-hint: "<feature-name>"
---
```

> Note the relocation is **inverted** vs. upstream: canon nests under `metadata`; the Claude emitter
> lifts `metadata.argument-hint` back to a top-level `argument-hint` and drops the now-empty
> `metadata` wrapper. `forge-init` emits exactly `{name, description}` with no `argument-hint`.

```python
class ClaudeEmitter:
    """Emitter for the `claude` target (REQ-GEN-03). Restores Claude-native skills
    (top-level argument-hint, REQ-VND-01) and full sub-agent frontmatter; retains
    Claude-only artifacts (REQ-VND-02). D1: adapters/claude/ is a parallel packaging
    copy — plugin.json keeps loading skills/ canon (00 §1 / tech-spec D1)."""

    agent_id = "claude"

    def emit_skill(self, skill: SkillRecord) -> EmitResult:
        native: dict[str, Any] = {"name": skill.name, "description": skill.description}
        hint = hint_value(skill)
        if hint is not None:  # REQ-VND-01: reconstruct top-level argument-hint
            native["argument-hint"] = hint
        fields = order_fields(native)
        content = render_frontmatter_block(fields, skill.source_path) + skill.body
        rel = f"skills/{skill.name}/SKILL.md"
        return EmitResult(files=(EmittedFile(relpath=rel, content=content),), drops=())
```

### 3.3 Sub-agent translation — full Claude frontmatter (REQ-GEN-06)

Claude is the **native home** of the sub-agent format, so `emit_agent` emits the **full** Claude
frontmatter: `name`, `description`, then **every** `claude_keys` entry in source order — `tools`,
`model`, `maxTurns`, and the per-file extras (`effort` for `forge-researcher`; `memory` + `skills`
for `forge-verifier`). **Zero drops** for the Claude target (all keys are representable).

- **Relpath:** `agents/<name>.md`.
- **Frontmatter:** `{name, description, **claude_keys}` projected onto `FRONTMATTER_KEY_ORDER`
  (`00 §4` lists `tools, model, maxTurns, effort, memory, skills` in that fixed order).
- **Body:** `agent.body` verbatim. **Drops:** `()`.

```python
    def emit_agent(self, agent: AgentRecord) -> EmitResult:
        native: dict[str, Any] = {"name": agent.name, "description": agent.description}
        native.update(agent.claude_keys)  # all representable for Claude → no drops
        fields = order_fields(native)
        content = render_frontmatter_block(fields, agent.source_path) + agent.body
        rel = f"agents/{agent.name}.md"
        return EmitResult(files=(EmittedFile(relpath=rel, content=content),), drops=())
```

> `forge-verifier`'s `skills: [forge-verify]` (a YAML sequence) and `memory: project` round-trip as-is
> through the dumper; the fixed key order (`00 §4`) places them last. No `DropRecord` is produced for
> any sub-agent under `claude`.

### 3.4 Claude-only artifacts retained (REQ-VND-02)

For the `claude` target, Claude-valid artifacts (`hooks/hooks.json`, etc.) are **representable and
behavior-relevant**, so they are **retained** in `adapters/claude/` rather than dropped (REQ-VND-02).
In the **current** canon no such artifact lives under `skills/` (`01 §7`), so the claude emitter
produces none today; the rule binds if one is added. (The plugin-root `hooks/hooks.json` is a Claude
plugin concern; whether the parallel `adapters/claude/` copy includes it is the engine's
self-containment scope — `04-provenance-selfcontainment-report.md §2` — not the per-skill emitter.)
The symmetric non-Claude omission-with-record is §2.4.

## 4. `codex` emitter (REQ-GEN-06, REQ-FMT-01..03)

### 4.1 Skill artifact

- **Relpath:** `skills/<name>/<name>.md` — a Markdown **skill mirror** (tech-spec §5: "skill mirror
  (`.md`)").
- **Frontmatter keys:** `name`, `description`. **`TQ-1`** — confirm Codex's expected skill
  frontmatter shape (whether it reads YAML frontmatter at all, and the exact key names) against
  OpenAI Codex's official skill/prompt format docs.
- **Body:** `skill.body` verbatim. **Mode:** `0o644`.

### 4.2 Invocation hint — record-dropped (REQ-FMT-02/03)

Codex has **no confirmed invocation-hint field** (tech-spec §5: "record-dropped (`TQ-1`)"). Until
official docs confirm one, the hint is **omitted + recorded** for every skill that carries one (the
10 non-`forge-init` skills). **`TQ-1`** — if Codex does expose a prompt-argument hint, switch to
branch-1 reconstruction (§2.2) and remove this drop.

```python
DropRecord(
    agent="codex",
    source=skill.source_path,
    construct="argument-hint",
    reason="no confirmed Codex invocation-hint field (TQ-1)",
)
```

### 4.3 Sub-agent translation — optional `agents/openai.yaml` (REQ-GEN-06)

Codex is the one non-Claude target with a candidate native agent construct: a single
`agents/openai.yaml` (tech-spec §5, REQ-FMT-01). The emitter maps representable keys into it and
**drop-records every `claude_keys` entry that the OpenAI agent schema does not define**, enumerated
from `agent.claude_keys` (§2.3).

- **Relpath:** `agents/openai.yaml` (one manifest for the sub-agent set; the engine merges per-agent
  emissions — `02 §3`). **`TQ-1`** — confirm the exact `agents/openai.yaml` schema (field names for
  name/description/model/tools, whether per-agent entries are a list or map) against OpenAI Codex's
  official agents-config docs.
- **Mapping baseline (all `TQ-1` until confirmed):** `description` verbatim (REQ-FMT-04);
  `model` → mapped if the schema has a model field; `tools` → mapped if it has a tools field;
  `maxTurns`, `effort`, `memory`, `skills` → **drop-record** unless the schema defines an equivalent.
- Because the mapping is unconfirmed, the **safe default** is: emit `name` + `description` (+ `model`
  only if confirmed) and **drop-record the remaining `claude_keys`**. This guarantees REQ-FMT-03
  (never invalid frontmatter) and REQ-OBS-01 (every dropped key recorded) regardless of how TQ-1
  resolves.

```python
class CodexEmitter:
    """Emitter for `codex`: skill mirror (.md) + optional agents/openai.yaml.
    Native agent schema is TQ-1 (§8); the safe default emits name+description and
    drop-records the rest so no key is silently lost (REQ-GEN-06 / REQ-OBS-01)."""

    agent_id = "codex"
    # Keys confirmed representable in agents/openai.yaml. EMPTY until TQ-1 confirms
    # the schema; expand (e.g. {"model", "tools"}) once verified against OpenAI docs.
    _CODEX_AGENT_KEYS: frozenset[str] = frozenset()

    def emit_skill(self, skill: SkillRecord) -> EmitResult:
        native = order_fields({"name": skill.name, "description": skill.description})
        content = render_frontmatter_block(native, skill.source_path) + skill.body
        rel = f"skills/{skill.name}/{skill.name}.md"
        drops: tuple[DropRecord, ...] = ()
        if hint_value(skill) is not None:  # REQ-FMT-02 branch 2 (TQ-1)
            drops = (DropRecord("codex", skill.source_path, "argument-hint",
                                "no confirmed Codex invocation-hint field (TQ-1)"),)
        return EmitResult(files=(EmittedFile(rel, content),), drops=drops)

    def emit_agent(self, agent: AgentRecord) -> EmitResult:
        # Body+description preserved (REQ-FMT-04); structural keys not in
        # _CODEX_AGENT_KEYS are drop-recorded (REQ-GEN-06). The openai.yaml manifest
        # entry is assembled by the engine from the representable subset (02 §3).
        dropped = tuple(
            DropRecord("codex", agent.source_path, f"sub-agent key '{k}'",
                       "not representable in agents/openai.yaml (TQ-1)")
            for k in agent.claude_keys if k not in self._CODEX_AGENT_KEYS
        )
        rel = f"agents/{agent.name}.md"  # body artifact retains behavior text
        content = render_frontmatter_block(
            order_fields({"name": agent.name, "description": agent.description}),
            agent.source_path,
        ) + agent.body
        return EmitResult(files=(EmittedFile(rel, content),), drops=dropped)
```

> With `_CODEX_AGENT_KEYS` empty (pre-TQ-1), **all** of `{tools, model, maxTurns, effort, memory,
> skills}` present on a given sub-agent are drop-recorded — exactly the "enumerate every key" guarantee
> (§2.3). As TQ-1 confirms representable keys, move them into `_CODEX_AGENT_KEYS` and they stop being
> dropped; the change is one frozenset edit, caught by the drift guard.

### 4.4 Claude-only artifacts

Dropped + recorded per §2.4 (latent in current canon).

## 5. `copilot` emitter (REQ-FMT-01..03, REQ-GEN-06)

### 5.1 Skill artifact

- **Relpath:** `skills/<name>/<name>.md` — a skill copy with **Copilot frontmatter** (tech-spec §5).
- **Frontmatter keys:** `name`, `description`. **`TQ-1`** — confirm GitHub Copilot's skill/instruction
  frontmatter schema (field names, whether `name` is `name` or e.g. `title`, whether it reads
  description from frontmatter or a leading `# heading`) against GitHub's official custom-instructions
  / skillset docs.
- **Body:** `skill.body` verbatim. **Mode:** `0o644`.

### 5.2 Invocation hint — drop-recorded (REQ-FMT-02/03)

Copilot has **no known invocation-hint field** (tech-spec §5: "`TQ-1` (no known hint field)"). Hint is
**omitted + recorded** for the 10 skills that carry one. **`TQ-1`** — verify; switch to branch-1 if a
field is confirmed.

### 5.3 Sub-agent translation — drop-recorded (REQ-GEN-06)

Copilot has **no confirmed native sub-agent construct** (tech-spec §5: "`TQ-1`"). `emit_agent`
therefore emits the sub-agent as a **body-only instruction file** (preserving `description` + body)
and **drop-records every `claude_keys` entry** via `drop_all_claude_keys` (§2.3) with reason
`no Copilot sub-agent construct (TQ-1)`. **`TQ-1`** — if Copilot gains an agent/skillset construct,
upgrade to a native mapping.

```python
class CopilotEmitter:
    """Emitter for `copilot`: skill copy with Copilot frontmatter. Hint + sub-agent
    structural keys are TQ-1-unconfirmed → drop-recorded (REQ-FMT-03 / REQ-GEN-06)."""

    agent_id = "copilot"

    def emit_skill(self, skill: SkillRecord) -> EmitResult:
        native = order_fields({"name": skill.name, "description": skill.description})
        content = render_frontmatter_block(native, skill.source_path) + skill.body
        rel = f"skills/{skill.name}/{skill.name}.md"
        drops: tuple[DropRecord, ...] = ()
        if hint_value(skill) is not None:
            drops = (DropRecord("copilot", skill.source_path, "argument-hint",
                                "no known Copilot invocation-hint field (TQ-1)"),)
        return EmitResult(files=(EmittedFile(rel, content),), drops=drops)

    def emit_agent(self, agent: AgentRecord) -> EmitResult:
        rel = f"agents/{agent.name}.md"
        content = render_frontmatter_block(
            order_fields({"name": agent.name, "description": agent.description}),
            agent.source_path,
        ) + agent.body
        drops = drop_all_claude_keys(agent, "copilot", "no Copilot sub-agent construct (TQ-1)")
        return EmitResult(files=(EmittedFile(rel, content),), drops=drops)
```

### 5.4 Claude-only artifacts

Dropped + recorded per §2.4.

## 6. `cursor` emitter (REQ-FMT-01..03, REQ-GEN-06)

Cursor's `.mdc` rule format is **well-documented** and **confirmed** for its three frontmatter keys
(`description`, `globs`, `alwaysApply`) — these are the canonical Cursor "Project Rules" fields, so
they are **not TQ-1**. The *derivation policy* for `globs`/`alwaysApply` (what values to set) and the
absence of any `name`/hint field are stated below.

### 6.1 Skill artifact — `.mdc` rule file

- **Relpath:** `skills/<name>/<name>.mdc` (Cursor rule files use the `.mdc` extension; tech-spec §5).
- **Frontmatter keys (confirmed):** `description`, `globs`, `alwaysApply` — in that subset of
  `FRONTMATTER_KEY_ORDER` (`00 §4` places `globs`/`alwaysApply` right after `description`).
- **`name`:** Cursor `.mdc` frontmatter has **no `name` field** (tech-spec §5: "`name` → derived").
  The skill identity is carried by the **filename** (`<name>.mdc`); `name` is therefore *not emitted
  in frontmatter* and is **not** a drop (the identity is preserved by the path, not lost).
- **`description` (verbatim, REQ-FMT-04):** `skill.description` → `description`.
- **`globs`:** the file-pattern scope. With no canonical glob source, the deterministic, lossless
  default is an **empty list** `[]` (rule is not auto-attached by path) — see §6.2.
- **`alwaysApply`:** `false` (deterministic default — the rule attaches via description/agent request,
  not unconditionally). A fixed boolean keeps output byte-stable (REQ-DET-01).
- **Body:** `skill.body` verbatim. **Mode:** `0o644`.

### 6.2 Invocation hint — dropped-recorded (REQ-FMT-02/03)

Cursor `.mdc` has **no invocation-hint field** (tech-spec §5: "dropped-recorded (no Cursor field)") —
this is **confirmed** (the `.mdc` schema is `description`/`globs`/`alwaysApply` only). The hint is
**omitted + recorded** for the 10 skills that carry one:

```python
DropRecord("cursor", skill.source_path, "argument-hint",
           "no Cursor .mdc invocation-hint field")
```

**Worked before → after (cursor, `forge-1-prd`):**

```yaml
# ── canonical SOURCE (skills/forge-1-prd/SKILL.md frontmatter) ──
name: forge-1-prd
description: "Create a requirements PRD … unrelated to the forge pipeline."
metadata:
  argument-hint: "<feature-name>"
```

```mdc
# ── EMITTED adapters/cursor/skills/forge-1-prd/forge-1-prd.mdc ──
---
# GENERATED — DO NOT EDIT. Source: skills/forge-1-prd/SKILL.md. Regenerate: python3 scripts/build-adapters.py
description: "Create a requirements PRD … unrelated to the forge pipeline."
globs: []
alwaysApply: false
---
<skill.body verbatim>
```

> `name` and `argument-hint` do **not** appear in the `.mdc` frontmatter: `name` is carried by the
> filename (no drop), `argument-hint` is **dropped + recorded** (no Cursor field). `description` is
> byte-identical (REQ-FMT-04).

### 6.3 Sub-agent translation — dropped-recorded (REQ-GEN-06)

Cursor has **no native sub-agent construct** (tech-spec §5: "dropped+recorded"). `emit_agent` emits a
body-only `.mdc` (preserving `description` + body) and **drop-records every `claude_keys` entry** via
`drop_all_claude_keys` with reason `no Cursor sub-agent equivalent`. This is the canonical example in
the generation report (tech-spec §3.5: "cursor: sub-agent `tools`/`model`/`effort`/`memory` keys — no
Cursor equivalent — dropped").

```python
class CursorEmitter:
    """Emitter for `cursor`: .mdc rule files (description, globs, alwaysApply).
    No name field (carried by filename), no hint field (drop-recorded), no
    sub-agent construct (every claude_keys entry drop-recorded). Confirmed format."""

    agent_id = "cursor"

    def emit_skill(self, skill: SkillRecord) -> EmitResult:
        native = order_fields({
            "description": skill.description,  # verbatim, REQ-FMT-04
            "globs": [],                       # deterministic default (REQ-DET-01)
            "alwaysApply": False,
        })
        content = render_frontmatter_block(native, skill.source_path) + skill.body
        rel = f"skills/{skill.name}/{skill.name}.mdc"
        drops: tuple[DropRecord, ...] = ()
        if hint_value(skill) is not None:
            drops = (DropRecord("cursor", skill.source_path, "argument-hint",
                                "no Cursor .mdc invocation-hint field"),)
        return EmitResult(files=(EmittedFile(rel, content),), drops=drops)

    def emit_agent(self, agent: AgentRecord) -> EmitResult:
        native = order_fields({"description": agent.description, "globs": [],
                               "alwaysApply": False})
        rel = f"agents/{agent.name}.mdc"
        content = render_frontmatter_block(native, agent.source_path) + agent.body
        drops = drop_all_claude_keys(agent, "cursor", "no Cursor sub-agent equivalent")
        return EmitResult(files=(EmittedFile(rel, content),), drops=drops)
```

### 6.4 Claude-only artifacts

Dropped + recorded per §2.4.

## 7. `gemini` emitter (REQ-FMT-01..03, REQ-GEN-06)

Gemini CLI consumes an **extension manifest** plus body files (tech-spec §5: "body files +
`gemini-extension.json` manifest"). The manifest is **strict JSON** (no comments), so its provenance
takes **Form C** (`00 §7`: a `_generated` key) — the manifest-shape and provenance mechanics are
owned by `04-provenance-selfcontainment-report.md §1`; this emitter produces the manifest **fields**
and the body files, and cross-references `04` for the `_generated` injection.

### 7.1 Skill artifact — body file + manifest entry

- **Body relpath:** `skills/<name>/<name>.md` — the skill body file (frontmatter-stripped or
  retained per Gemini's body convention; **`TQ-1`** — confirm whether Gemini reads YAML frontmatter
  in body files or expects pure Markdown).
- **Manifest:** `gemini-extension.json` at the bundle root carries `name`, `version`,
  `description`, and the skill/command registrations (manifest `name` / manifest `description`,
  tech-spec §5). **`TQ-1`** — confirm the exact `gemini-extension.json` schema (top-level keys,
  how skills/commands are registered, required `version`) against the official Gemini CLI extensions
  docs.
- **`description` (verbatim, REQ-FMT-04):** carried in the manifest's per-skill `description`.
- **Mode:** `0o644`.

### 7.2 Invocation hint (REQ-FMT-02/03)

**`TQ-1`** — Gemini CLI commands may support an argument hint (e.g. a command-usage string in the
manifest). Until confirmed, the hint is **omitted + recorded** for the 10 hinted skills
(`construct="argument-hint"`, `reason="Gemini manifest hint field unconfirmed (TQ-1)"`). If a hint
field is confirmed, reconstruct it into the manifest entry (branch 1, §2.2) and drop the record.

### 7.3 Sub-agent translation — dropped-recorded (REQ-GEN-06)

Gemini CLI has **no confirmed native sub-agent construct** (tech-spec §5: "`TQ-1`"). `emit_agent`
emits a body-only `agents/<name>.md` (preserving `description` + body) and **drop-records every
`claude_keys` entry** via `drop_all_claude_keys` with reason `no Gemini sub-agent construct (TQ-1)`.
**`TQ-1`** — upgrade if Gemini exposes an agent construct.

### 7.4 Manifest provenance — `_generated` key (REQ-OUT-01, cross-ref 04)

The `gemini-extension.json` is strict JSON; it carries provenance via the documented top-level
`_generated` object (`00 §7`, `provenance_json(source)` / `PROVENANCE_JSON_KEY`). The emitter produces
the manifest **mapping**; the **serialization** (key order, indent, the `_generated` injection,
trailing newline) is the engine/provenance layer's job — `04-provenance-selfcontainment-report.md §1`.

**Worked before → after (gemini, `forge-1-prd` manifest entry, illustrative — schema `TQ-1`):**

```json
// ── EMITTED adapters/gemini/gemini-extension.json (excerpt) ──
{
  "_generated": {
    "source": "skills/*",
    "regenerate": "python3 scripts/build-adapters.py"
  },
  "name": "feature-forge",
  "version": "0.0.0",
  "skills": [
    {
      "name": "forge-1-prd",
      "description": "Create a requirements PRD … unrelated to the forge pipeline."
    }
  ]
}
```

> The `version` value MUST be a **fixed, canon-sourced** constant (not a timestamp or build counter)
> to satisfy determinism (REQ-DET-01); its source is `04`'s manifest-assembly contract. The
> `description` is byte-identical to canon (REQ-FMT-04). The example schema is **`TQ-1`** pending
> official confirmation.

```python
class GeminiEmitter:
    """Emitter for `gemini`: body files + a gemini-extension.json manifest (strict
    JSON → _generated provenance, 00 §7 Form C, cross-ref 04). Manifest schema and
    any command hint field are TQ-1 (§8)."""

    agent_id = "gemini"

    def emit_skill(self, skill: SkillRecord) -> EmitResult:
        # Body file (frontmatter convention TQ-1); the manifest ENTRY is returned as
        # structured data the engine merges into gemini-extension.json (04 §1). Here
        # we emit the body file + a sidecar the engine collects; the hint is dropped.
        rel = f"skills/{skill.name}/{skill.name}.md"
        content = render_frontmatter_block(
            order_fields({"name": skill.name, "description": skill.description}),
            skill.source_path,
        ) + skill.body
        drops: tuple[DropRecord, ...] = ()
        if hint_value(skill) is not None:
            drops = (DropRecord("gemini", skill.source_path, "argument-hint",
                                "Gemini manifest hint field unconfirmed (TQ-1)"),)
        return EmitResult(files=(EmittedFile(rel, content),), drops=drops)

    def emit_agent(self, agent: AgentRecord) -> EmitResult:
        rel = f"agents/{agent.name}.md"
        content = render_frontmatter_block(
            order_fields({"name": agent.name, "description": agent.description}),
            agent.source_path,
        ) + agent.body
        drops = drop_all_claude_keys(agent, "gemini", "no Gemini sub-agent construct (TQ-1)")
        return EmitResult(files=(EmittedFile(rel, content),), drops=drops)
```

> The `gemini-extension.json` manifest is assembled **once per bundle** from all skills' manifest
> entries by the engine, not per-`emit_skill` (a manifest is a whole-bundle artifact). The exact
> hand-off (whether `emit_skill` returns a manifest-entry sidecar or the engine re-derives from the
> records) is the engine/provenance contract — `02-generator-engine.md §3` and
> `04-provenance-selfcontainment-report.md §1`. This emitter's REQ-FMT-04 obligation is that the
> per-skill `description` reaching the manifest is byte-identical.

### 7.5 Claude-only artifacts

Dropped + recorded per §2.4.

## 8. TQ-1 register — confirmed vs. flagged fields

Per the dispatch, every native field **not** confirmable against a source artifact or official docs
in this authoring environment carries a TQ-1 flag; the implementer resolves each against official
docs and drops the flag (or corrects the mapping — caught by the drift guard either way, §2.5).
**The context7 MCP / web docs were not reachable here, so no flagged field could be firmed up at
authoring; the table records the basis instead.**

| Target | Field / construct | Status | Basis |
|---|---|---|---|
| claude | top-level `argument-hint` | **Confirmed** (not TQ-1) | Round-trip of repo canon's pre-purity shape (`forge-skill-spec-purity`); verified in repo. |
| claude | sub-agent frontmatter (`tools/model/maxTurns/effort/memory/skills`) | **Confirmed** (not TQ-1) | Read directly from `agents/*.md` on branch `forge/skill-spec-purity` (`00 §2` table). |
| cursor | `.mdc` keys `description`/`globs`/`alwaysApply` | **Confirmed** (not TQ-1) | Cursor Project-Rules `.mdc` schema (stable, widely documented). |
| cursor | no `name` / no hint field | **Confirmed** (not TQ-1) | Same `.mdc` schema — only those three keys. |
| codex | skill mirror frontmatter shape | **TQ-1** | Convention (tech-spec §5); confirm OpenAI Codex skill/prompt format. |
| codex | invocation-hint field | **TQ-1** | Convention; confirm a prompt-argument hint exists. |
| codex | `agents/openai.yaml` schema + representable keys (`_CODEX_AGENT_KEYS`) | **TQ-1** | Convention; confirm OpenAI agents-config schema. |
| copilot | skill frontmatter schema (`name`/`description`/?) | **TQ-1** | Convention; confirm GitHub Copilot custom-instructions/skillset format. |
| copilot | invocation-hint field | **TQ-1** | Convention; no known field. |
| copilot | sub-agent construct | **TQ-1** | Convention; none known → drop-recorded. |
| gemini | `gemini-extension.json` schema (top-level keys, skill/command registration, `version`) | **TQ-1** | Convention (tech-spec §5); confirm Gemini CLI extensions manifest docs. |
| gemini | body-file frontmatter convention | **TQ-1** | Convention; confirm whether Gemini reads frontmatter. |
| gemini | command invocation-hint field | **TQ-1** | Convention; confirm Gemini command-usage field. |
| gemini | sub-agent construct | **TQ-1** | Convention; none known → drop-recorded. |

**Resolution protocol (per flagged field):** confirm against the agent's official docs → if a field
exists, set the native key name and (for the hint) switch §2.2 to branch 1 / (for codex agent keys)
add to `_CODEX_AGENT_KEYS`; if it does not exist, keep the drop-with-record and drop the flag with a
"confirmed-absent" note in `GENERATION-REPORT.md`. Either outcome is a localized one-method edit
(§2.5), and the drift guard + `06-testing-strategy.md` byte-snapshots catch any mismatch.

## Dependencies

Implement **after**:

- **`00-core-definitions.md`** — provides every type and constant this document consumes and
  **references, never redefines**: `AGENT_TARGETS` (§1), `SkillRecord` / `AgentRecord` (the emitter
  inputs), `FRONTMATTER_KEY_ORDER` (the fixed projection order, §2.1), the `Emitter` / `EmittedFile` /
  `EmitResult` protocol the five classes satisfy (§5), `DropRecord` (the drop-with-record model, §6),
  the provenance constants `PROVENANCE_FM_COMMENT` / `provenance_json` / `PROVENANCE_JSON_KEY` /
  `REGENERATE_CMD` (§7), and the `CanonError` hierarchy (raised by the parse step, not by emitters).
- **`01-architecture-layout.md`** — the `adapters/<agent>/` bundle layout the `EmittedFile.relpath`s
  target (§3), the per-skill `references/` presence (`01 §7`, informing §2.4), and the confirmation
  that no skill has a `hooks/` dir today (§3.4 / §2.4).
- **`02-generator-engine.md`** — the discovery/parse that produces the `SkillRecord`/`AgentRecord`
  inputs, the emitter **registry literal** that instantiates these five classes, and the shared YAML
  dumper configuration (`02 §3`) that `render_frontmatter_block` (§2.1) relies on. Emitters are pure
  functions of records; the engine owns everything around them.

**Owned elsewhere (cross-referenced, not duplicated here):**

- **`04-provenance-selfcontainment-report.md`** — the references-closure / `forge-root.sh`
  self-containment pass (added to each bundle by the engine, **not** by emitters — `EmitResult.files`
  excludes them), the exact provenance-header placement for all forms, the `gemini-extension.json`
  serialization + `_generated` injection (§7.4), and the `GENERATION-REPORT.md` assembly that
  consumes every `DropRecord` these emitters produce.
- **`05-purity-exemption-and-drift-guard.md`** — the drift guard that catches any TQ-1 mismatch
  (§2.5, §8) and the `validate.sh` wiring.
- **`06-testing-strategy.md`** — the per-target byte-snapshot, description-fidelity, hint-reconstruction,
  and drop-with-record tests that verify each emitter.

## Verification

An implementation matches this document when:

- [ ] There is exactly one emitter class per `AGENT_TARGETS` id, each with `agent_id` and pure
      `emit_skill` / `emit_agent` methods returning `EmitResult` (§1, `00 §5`).
- [ ] Every YAML-frontmatter emit goes through the shared dumper with `sort_keys=False` over a subset
      of `FRONTMATTER_KEY_ORDER` (no ad-hoc key order); `order_fields` asserts no un-ordered key (§2.1).
- [ ] `description` decodes byte-for-byte equal to canon for **every** target with a description
      field — claude, codex, copilot, cursor (`.mdc`), gemini (manifest) (REQ-FMT-04, §2.1).
- [ ] **claude** `SKILL.md` has a **top-level** `argument-hint` reconstructed from
      `metadata.argument-hint` for the 10 hinted skills, and **none** for `forge-init` (REQ-VND-01,
      §3.2); no `DropRecord` for any claude sub-agent (full frontmatter, §3.3).
- [ ] For each non-claude target, the invocation-hint of the 10 hinted skills is **absent from output
      AND present as a `DropRecord`** (REQ-FMT-02/03, §2.2) — and **`forge-init` produces neither a hint
      nor a hint drop** anywhere (§2.2).
- [ ] For every sub-agent and every non-{name,description} key it carries (`claude_keys`, per-file —
      `effort` on researcher, `memory`+`skills` on verifier), each non-representable key is **absent
      from output AND present as a `DropRecord`** for codex/copilot/cursor/gemini; **no key is silently
      dropped** (REQ-GEN-06, §2.3) — driven by enumerating `agent.claude_keys`, never a hard-coded list.
- [ ] **cursor** emits `.mdc` with `description`/`globs`/`alwaysApply` only, no `name` field (identity
      via filename), deterministic `globs: []` / `alwaysApply: false`, `argument-hint` drop-recorded
      (§6).
- [ ] **gemini** emits body files + a `gemini-extension.json` whose `description`s are byte-identical
      and whose provenance is the `_generated` key (`00 §7` Form C), with `version` a fixed constant
      (no timestamp) — serialization owned by `04` (§7.4).
- [ ] No emitter emits a Claude-only artifact for a non-Claude target; any such artifact encountered is
      drop-recorded (§2.4); claude retains them (REQ-VND-02, §3.4).
- [ ] Every field marked **`TQ-1`** in §3–§7 appears in the §8 register; at impl each is either
      confirmed (flag dropped) or corrected, and the change is localized to one emitter (§2.5).
- [ ] Every `DropRecord` an emitter produces carries `agent ∈ AGENT_TARGETS`, the canonical
      `source_path`, a stable `construct`, and a reason — and surfaces in `GENERATION-REPORT.md`
      (`00 §6`, `04 §3`).
