# 04 — Trigger-Accuracy Eval (Advisory)

> **Feature:** `packaging-docs-ci` (epic `agent-agnostic`, capstone 6 of 6).
> **Status:** domain document. Depends on `00-core-definitions.md` and `01-architecture-layout.md`.
> **Concern:** the advisory LLM-judged trigger-accuracy eval — `eval/run-eval.py` + `eval/fixtures/`
> + `.github/workflows/eval.yml` (all in **feature-forge**, `../feature-forge`).

This document specifies the **advisory** trigger-accuracy eval: a Python harness that asks a small
Claude model to pick the best-matching skill for a prompt, scored against per-skill
should-trigger / should-not-trigger fixtures. It is **never** a PR gate (REQ-EVAL-02): it runs only
on `workflow_dispatch` + a weekly `schedule`, reads `ANTHROPIC_API_KEY` from CI secrets
(REQ-SEC-02), and always exits 0 — even when accuracy is low or the key is absent.

All artifacts described here live in the **feature-forge** working tree
(`REPO_ROOT["feature-forge"] = "../feature-forge"`, `00-core-definitions.md` §1). The eval is
authored, not consumed; nothing in this document touches the rauf tree.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-EVAL-01 | Trigger-accuracy eval harness + fixtures producing a score | 3, 4, 5, 6 |
| REQ-EVAL-02 | Eval runs advisory, never blocking (workflow_dispatch + schedule) | 2, 7 |
| REQ-SEC-02 | API key from CI secrets; never echoed, never in repo; absent-key path | 6.4, 7.3 |
| REQ-OBS-01 | Eval result is diagnosable (per-skill breakdown, clear skip message) | 5, 6.5 |
| REQ-PERF-01 | Eval kept off the fast per-PR path (own workflow, schedule) | 2, 7 |
| REQ-SEC-01 | Third-party actions version-pinned in eval.yml | 7.1 |

**Open questions settled here:** **OQ-03** (eval runs on `workflow_dispatch` **+** weekly `schedule`,
never on `pull_request` — §2, §7). **OQ-D** (determinism/cost: a pinned small model
`claude-haiku-4-5-20251001`, low `max_tokens`, weekly cadence — §6.3, §8).

## 1. Purpose & Scope

### 1.1 What this eval answers

When a contributor edits a skill's `description` frontmatter, does the skill still *fire reliably* on
the prompts it should — and stay *quiet* on the prompts it should not? The deterministic gates
(`02-ci-blocking-gates.md`) prove a SKILL.md is *schema-valid*; they cannot prove its description is
*discriminating*. This eval supplies that missing, **advisory** signal (PRD §2 contributor story,
PRD §3.5).

### 1.2 What is in scope (this document)

- `eval/run-eval.py` — the full Python harness (uses the `anthropic` SDK).
- `eval/fixtures/<skill>.json` — per-skill fixtures (shape fixed by `00-core-definitions.md` §4); at
  least two are authored here (`forge-1-prd.json`, `forge-5-loop.json`).
- `.github/workflows/eval.yml` — the advisory workflow (`workflow_dispatch` + weekly `schedule`).
- The judge prompt, the score data shape (extends `00 §4`), secret handling, and cost/determinism
  posture.

### 1.3 What is explicitly out of scope

- **A blocking eval threshold** — excluded by PRD §6 and REQ-EVAL-02; the job exits 0 regardless of
  the score. This document MUST NOT introduce a pass/fail accuracy bar that fails the workflow.
- **The deterministic gates and the OS matrix** — `02-ci-blocking-gates.md` and
  `03-os-matrix-installer-gate.md` respectively.
- **The ruff/shellcheck *configuration*** (`ruff.toml`, `.shellcheckrc`) — owned by
  `02-ci-blocking-gates.md` §lint. This document only obligates `eval/run-eval.py` to *pass* that
  ruff floor (§3.3) and flags the `eval/`-ordering constraint (§9).

## 2. Trigger & Blocking Posture (REQ-EVAL-02, REQ-PERF-01 — settles OQ-03)

`eval.yml` runs on exactly two triggers and **never** on `pull_request`:

| Trigger | Cadence | Rationale |
|---|---|---|
| `workflow_dispatch` | on demand | a contributor checks the effect of a description change |
| `schedule` (`cron: "0 6 * * 1"`) | weekly, Mondays 06:00 UTC | a recurring health signal that bounds API cost (OQ-D) |

- The job is **non-blocking**: it is in its own workflow (not part of `ci.yml`), so it can never be a
  required check on a PR (`01-architecture-layout.md` §2 topology table).
- `run-eval.py` **always exits 0** for low accuracy (it is advisory) and for the absent-key path
  (§6.4). The *only* non-zero exit is a genuine harness bug (an unhandled exception / a malformed
  fixture file), which signals "the harness itself is broken," not "skills regressed."
- Keeping the LLM eval off the per-PR path also satisfies REQ-PERF-01 (the fast gate stays fast).

## 3. Harness Design (REQ-EVAL-01)

### 3.1 Algorithm

For each fixture `eval/fixtures/<skill>.json` (shape = `EvalFixture`, `00 §4`):

1. Load the **candidate skill catalog** once: read every `skills/*/SKILL.md`, parse its YAML
   frontmatter, and collect `(name, description)` pairs. This is the exact set the real agent selects
   among, so the eval mirrors production selection.
2. For each prompt in `shouldTrigger` and `shouldNotTrigger`, send **one** Messages API request: the
   system prompt presents the catalog and the selection rules; the user message is the raw prompt.
   The model returns a single chosen skill name (or the sentinel `none`).
3. **Score** (the rule from PRD §3.5 / tech-spec §3.8):
   - a `shouldTrigger` case is **correct** iff the model's choice **equals** the fixture's `skill`;
   - a `shouldNotTrigger` case is **correct** iff the model's choice **does not equal** the fixture's
     `skill` (any other skill, or `none`, is correct).
4. Aggregate into a per-skill breakdown and one overall trigger-accuracy percentage (§5).

### 3.2 Why LLM-judged (tech-spec §3.8 decision 6)

Trigger selection is exactly the natural-language routing the live agent performs; a deterministic
string-match heuristic would not reflect how descriptions actually compete. The eval is therefore an
LLM-as-selector, accepting non-determinism as the price of fidelity (OQ-D, §8).

### 3.3 ruff cleanliness (tech-spec §3.4)

`eval/*.py` is a ruff target (rules `E`, `F`, `W`; line-length 100 — config owned by
`02-ci-blocking-gates.md`). The harness below is written to pass that floor: no unused imports
(`F401`), no bare `except` (`E722`), no lines over 100 cols, no f-strings without placeholders
(`F541`). The CI composite action installs `ruff` and runs it over `scripts/ eval/`; see §9 for the
`eval/`-must-exist-or-be-tolerated ordering constraint cross-referenced to
`02-ci-blocking-gates.md`.

## 4. Fixture Format (ref `00-core-definitions.md` §4)

The fixture shape is **defined in `00-core-definitions.md` §4** (`EvalFixture`) and is **not**
redefined here:

```jsonc
// EvalFixture (authoritative in 00 §4) — for reference only
{ "skill": "<name>", "shouldTrigger": ["prompt", …], "shouldNotTrigger": ["prompt", …] }
```

Constraints this document adds for the harness:

- `skill` MUST equal a `skills/<skill>/` directory and that skill's SKILL.md `name` (`00 §4`,
  verified at load — §6.2 raises on a fixture whose `skill` is not in the catalog).
- `shouldTrigger` is non-empty; `shouldNotTrigger` MAY be empty (`00 §4`).
- A fixture exists per *evaluated* skill; not every one of the 11 skills needs a fixture for the eval
  to run (the score is computed over whatever fixtures are present).

### 4.1 Sample fixtures (real skill names — verified)

Verified against `feature-forge/skills/*/SKILL.md`: the 11 skills are `forge`, `forge-0-epic`,
`forge-1-prd`, `forge-2-tech`, `forge-3-specs`, `forge-4-backlog`, `forge-5-loop`, `forge-6-docs`,
`forge-fix`, `forge-init`, `forge-verify` (each `name == <dir>`). Two fixtures are authored here, using
prompts drawn from the real descriptions of `forge-1-prd` and `forge-5-loop`.

**`eval/fixtures/forge-1-prd.json`** (description verified at
`feature-forge/skills/forge-1-prd/SKILL.md:3` — "Create a requirements PRD … Do NOT trigger for
general requirements discussions …"):

```json
{
  "skill": "forge-1-prd",
  "shouldTrigger": [
    "start a PRD for a new feature with feature-forge",
    "run forge-1-prd for the auth feature",
    "kick off the forge pipeline and interview me for requirements on the billing feature"
  ],
  "shouldNotTrigger": [
    "let's have a general discussion about our product requirements",
    "scope out the next quarter's roadmap",
    "what's the weather today"
  ]
}
```

**`eval/fixtures/forge-5-loop.json`** (description verified at
`feature-forge/skills/forge-5-loop/SKILL.md:3` — "Execute the autonomous coding loop (rauf by
default) … Do NOT trigger for general rauf usage, standalone loop runs …"):

```json
{
  "skill": "forge-5-loop",
  "shouldTrigger": [
    "run the forge loop against the backlog for the auth feature",
    "run forge-5-loop now that the backlog is verified",
    "implement the forge feature autonomously with rauf"
  ],
  "shouldNotTrigger": [
    "run rauf on this random project",
    "start a standalone autonomous loop unrelated to forge",
    "generate the backlog for this feature"
  ]
}
```

> The `forge-5-loop` `shouldNotTrigger` cases ("standalone loop", "generate the backlog") are the
> exact negative cases its own description calls out — and the "generate the backlog" prompt is a
> `shouldTrigger` case for `forge-4-backlog`, so the two fixtures discriminate against each other.

### 4.2 Coverage target (SC-06)

The eval scores over whatever fixtures are present (§4), so "done" needs an explicit floor rather
than an implicit one:

- **SC-06 is satisfied by ≥2 authored fixtures that discriminate against each other** — here
  `forge-1-prd.json` and `forge-5-loop.json` (the cross-discrimination is shown above). This is the
  verifiable minimum: deleting a fixture below this floor is a coverage regression, not a no-op.
- **Broadening fixtures to all 11 forge/rauf skills is explicitly out of scope for this capstone**
  and is recorded as follow-up — so the two-fixture coverage reads as a deliberate floor, not an
  oversight. New skills *should* add a fixture as they land, but this feature does not block on
  full-catalog coverage.

## 5. Score Data Shape (extends `00-core-definitions.md` §4)

`00 §4` defers the aggregate/breakdown shape to this document. It is the harness's structured stdout
(`--json`) and the basis of the human-readable summary. Expressed as TypeScript for parity with the
foundation docs. **The wire-format JSON keys are `snake_case`** — the `--json` output is
`json.dumps(asdict(report))` (§6), and `dataclasses.asdict()` preserves the Python field names
verbatim, so these interface fields use the exact dataclass key names a consumer will see (not
camelCase):

```typescript
/** Per-prompt judgement record. */
interface EvalCaseResult {
  prompt: string;        // the natural-language prompt judged
  kind: "shouldTrigger" | "shouldNotTrigger";
  chosen: string;        // the skill the model selected, or "none"
  correct: boolean;      // per the §3.1 scoring rule
}

/** Per-skill rollup (one fixture). */
interface EvalSkillResult {
  skill: string;         // == EvalFixture.skill
  total: number;         // shouldTrigger.length + shouldNotTrigger.length
  correct: number;       // count of correct cases
  accuracy: number;      // correct / total, 0..1 (0 when total == 0)
  cases: EvalCaseResult[];
}

/** Whole-run aggregate — the advisory signal (REQ-EVAL-01). */
interface EvalReport {
  model: string;         // pinned model id (§6.3)
  skills: EvalSkillResult[];
  total_cases: number;   // sum of per-skill totals (dataclass field `total_cases`)
  total_correct: number; // dataclass field `total_correct`
  accuracy: number;      // total_correct / total_cases, 0..1 — the headline score
  skipped: boolean;      // true when no API key (§6.4); skills == [] in that case
  skip_reason?: string;  // dataclass field `skip_reason`; e.g. "no ANTHROPIC_API_KEY"
}
```

The harness prints a human-readable per-skill breakdown (REQ-OBS-01 — the result is diagnosable) and,
under `--json`, the `EvalReport` as JSON for machine consumption. The headline `accuracy` is the
trigger-accuracy score REQ-EVAL-01 requires.

## 6. `eval/run-eval.py` (full harness)

The complete harness. Python ≥3.10, stdlib + `anthropic`. It is the authoritative artifact — an
engineer copies it verbatim (adjusting only fixtures).

```python
#!/usr/bin/env python3
"""Advisory trigger-accuracy eval for feature-forge skills.

For each eval/fixtures/<skill>.json the harness asks a small Claude model to pick the
best-matching skill from the canonical skills/*/SKILL.md descriptions, then scores:
  - a shouldTrigger prompt is correct when the expected skill is chosen;
  - a shouldNotTrigger prompt is correct when the expected skill is NOT chosen.

Advisory only (REQ-EVAL-02): always exits 0 for a low score or an absent API key.
The only non-zero exit is a harness bug (bad fixture / unexpected error).

Usage:
    python3 eval/run-eval.py [--json]

Reads ANTHROPIC_API_KEY from the environment (REQ-SEC-02 — never hardcoded, never
echoed). When absent, prints "skipped (no key)" and exits 0.
"""

from __future__ import annotations

import json
import os
import re
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path

# Pinned, low-cost model (OQ-D). Date-suffixed Haiku id is intentional for a hard pin
# of an advisory job; see shared/models.md (claude-api skill).
MODEL = "claude-haiku-4-5-20251001"
MAX_TOKENS = 64  # the judge returns just a skill name; keep the cap tiny (OQ-D / cost)

REPO_ROOT = Path(__file__).resolve().parent.parent  # eval/ -> feature-forge/
SKILLS_DIR = REPO_ROOT / "skills"
FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"

NONE_SENTINEL = "none"


@dataclass
class CaseResult:
    prompt: str
    kind: str  # "shouldTrigger" | "shouldNotTrigger"
    chosen: str
    correct: bool


@dataclass
class SkillResult:
    skill: str
    total: int = 0
    correct: int = 0
    accuracy: float = 0.0
    cases: list[CaseResult] = field(default_factory=list)


@dataclass
class Report:
    model: str
    skills: list[SkillResult] = field(default_factory=list)
    total_cases: int = 0
    total_correct: int = 0
    accuracy: float = 0.0
    skipped: bool = False
    skip_reason: str | None = None


def load_catalog() -> dict[str, str]:
    """Map skill name -> description from every skills/*/SKILL.md frontmatter."""
    catalog: dict[str, str] = {}
    for skill_md in sorted(SKILLS_DIR.glob("*/SKILL.md")):
        text = skill_md.read_text(encoding="utf-8")
        name = _frontmatter_value(text, "name") or skill_md.parent.name
        desc = _frontmatter_value(text, "description") or ""
        catalog[name] = desc
    return catalog


def _frontmatter_value(text: str, key: str) -> str | None:
    """Extract a scalar frontmatter value (quoted, plain, or block-scalar) for `key`.

    Tolerant by design: skill descriptions use ``"..."``, ``|-`` blocks, and plain
    forms across the suite. We only need name/description, so a focused parser avoids a
    PyYAML dependency (the adapter venv pins PyYAML, but the eval job does not install it).
    """
    if not text.startswith("---"):
        return None
    end = text.find("\n---", 3)
    if end == -1:
        return None
    fm = text[3:end]
    # Quoted single-line: key: "value"
    m = re.search(rf'^{re.escape(key)}:\s*"(.*)"\s*$', fm, re.MULTILINE)
    if m:
        return m.group(1)
    # Block scalar: key: |- (or |, >-, >) then indented lines
    m = re.search(rf"^{re.escape(key)}:\s*[|>][+-]?\s*\n", fm, re.MULTILINE)
    if m:
        lines = fm[m.end():].splitlines()
        block: list[str] = []
        for line in lines:
            if line and not line.startswith((" ", "\t")):
                break
            block.append(line.strip())
        return " ".join(s for s in block if s).strip()
    # Plain single-line: key: value
    m = re.search(rf"^{re.escape(key)}:\s*(.+?)\s*$", fm, re.MULTILINE)
    if m:
        return m.group(1).strip()
    return None


def build_system_prompt(catalog: dict[str, str]) -> str:
    """The judge instructions + the candidate skill catalog (stable prefix)."""
    lines = [
        "You are a skill router. Given a user request, choose the SINGLE skill whose "
        "description best matches it, or 'none' if no skill is a good match.",
        "",
        "Respond with ONLY the skill name (e.g. forge-1-prd) or the word none. "
        "No punctuation, no explanation.",
        "",
        "Available skills:",
    ]
    for name, desc in catalog.items():
        lines.append(f"- {name}: {desc}")
    return "\n".join(lines)


def judge(client, system_prompt: str, prompt: str, valid: set[str]) -> str:
    """Ask the model to pick one skill; normalise to a known name or NONE_SENTINEL."""
    resp = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=system_prompt,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = "".join(b.text for b in resp.content if b.type == "text").strip()
    token = raw.split()[0].strip(".,:`\"'").lower() if raw else NONE_SENTINEL
    if token in valid:
        return token
    return NONE_SENTINEL


def score_fixture(client, system_prompt: str, fixture: dict, valid: set[str]) -> SkillResult:
    skill = fixture["skill"]
    if skill not in valid:
        raise ValueError(f"fixture skill {skill!r} is not a known skills/ directory")
    result = SkillResult(skill=skill)
    for kind in ("shouldTrigger", "shouldNotTrigger"):
        for prompt in fixture.get(kind, []):
            chosen = judge(client, system_prompt, prompt, valid)
            if kind == "shouldTrigger":
                correct = chosen == skill
            else:
                correct = chosen != skill
            result.cases.append(CaseResult(prompt, kind, chosen, correct))
            result.total += 1
            result.correct += int(correct)
    result.accuracy = (result.correct / result.total) if result.total else 0.0
    return result


def load_fixtures() -> list[dict]:
    if not FIXTURES_DIR.is_dir():
        return []
    fixtures = []
    for path in sorted(FIXTURES_DIR.glob("*.json")):
        fixtures.append(json.loads(path.read_text(encoding="utf-8")))
    return fixtures


def print_human(report: Report) -> None:
    if report.skipped:
        print(f"trigger-accuracy eval: skipped ({report.skip_reason})")
        return
    print(f"trigger-accuracy eval (model={report.model})")
    for sr in report.skills:
        pct = round(sr.accuracy * 100, 1)
        print(f"  {sr.skill}: {sr.correct}/{sr.total} ({pct}%)")
        for c in sr.cases:
            mark = "ok " if c.correct else "MISS"
            print(f"    [{mark}] {c.kind}: chose {c.chosen!r} <- {c.prompt!r}")
    overall = round(report.accuracy * 100, 1)
    print(f"OVERALL trigger-accuracy: {report.total_correct}/{report.total_cases} ({overall}%)")


def main(argv: list[str]) -> int:
    as_json = "--json" in argv

    if not os.environ.get("ANTHROPIC_API_KEY"):
        report = Report(model=MODEL, skipped=True, skip_reason="no ANTHROPIC_API_KEY")
        print(json.dumps(asdict(report)) if as_json else
              "trigger-accuracy eval: skipped (no key)")
        return 0  # advisory — absent key is not a failure (REQ-SEC-02, REQ-EVAL-02)

    import anthropic  # imported only when a key is present (keeps absent-key path dep-free)

    catalog = load_catalog()
    valid = set(catalog.keys())
    system_prompt = build_system_prompt(catalog)
    client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY from the environment

    report = Report(model=MODEL)
    for fixture in load_fixtures():
        sr = score_fixture(client, system_prompt, fixture, valid)
        report.skills.append(sr)
        report.total_cases += sr.total
        report.total_correct += sr.correct
    report.accuracy = (report.total_correct / report.total_cases) if report.total_cases else 0.0

    print(json.dumps(asdict(report), indent=2) if as_json else "")
    if not as_json:
        print_human(report)
    return 0  # advisory — a low score never fails the job (REQ-EVAL-02)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

### 6.1 SDK usage (verified against the claude-api skill)

- **Import / client:** `import anthropic` then `anthropic.Anthropic()` — the default constructor reads
  `ANTHROPIC_API_KEY` from the environment (verified: `claude-api` skill,
  `python/claude-api/README.md:11-17`). The key is **never** passed as a literal (REQ-SEC-02).
- **Call:** `client.messages.create(model=..., max_tokens=..., system=..., messages=[...])` — verified
  shape (`python/claude-api/README.md:91-117`). `response.content` is a list of content blocks; we
  read `block.text` only for `block.type == "text"` (verified: README "Check `.type` before accessing
  `.text`").
- **No `thinking` parameter:** Haiku 4.5 does not need (and the eval does not want) thinking; omitting
  it is correct for a Haiku-class model.

### 6.2 Catalog & fixture loading

`load_catalog()` reads every `skills/*/SKILL.md` and parses `name`/`description` from frontmatter with
a focused, dependency-free parser (`_frontmatter_value`) that handles the three frontmatter forms the
suite uses (quoted single-line — `forge-1-prd`/`forge-5-loop`; block scalar `|-` — `claude-api`-style;
plain). This avoids adding PyYAML to the eval job (the adapter venv's PyYAML pin is not installed
here). `score_fixture` raises `ValueError` for a fixture whose `skill` is not a real directory, so a
typo'd fixture is a loud harness error (non-zero exit), not a silent miscount (REQ-OBS-01).

### 6.3 Model pin & token cap (OQ-D)

`MODEL = "claude-haiku-4-5-20251001"` — the Haiku 4.5 full id, pinned for cost and reproducibility of
the *configuration* (the model's *output* remains non-deterministic; that is acceptable for an
advisory signal — §8). `MAX_TOKENS = 64` because the judge returns only a skill name; a tiny cap
bounds per-call cost. At Haiku-4.5 pricing ($1/$5 per MTok, `shared/models.md`) the entire suite is a
handful of cents per run; the weekly cadence (§2) bounds recurring spend.

### 6.4 Absent-key path (REQ-SEC-02, REQ-EVAL-02)

If `ANTHROPIC_API_KEY` is unset, `main` returns a `Report(skipped=True, skip_reason="no
ANTHROPIC_API_KEY")`, prints `trigger-accuracy eval: skipped (no key)` (or the JSON form), and
**exits 0** — before `import anthropic`, so the harness needs no SDK to report a skip. This is the
local-dev and the no-secret-CI path.

### 6.5 Output / diagnosability (REQ-OBS-01)

Default output is the human-readable per-skill breakdown with a per-case `ok`/`MISS` marker and the
headline `OVERALL trigger-accuracy`. `--json` emits the `EvalReport` (§5) for machine consumption. A
contributor can see exactly which prompt regressed and what the model chose instead — no silent score.

## 7. `.github/workflows/eval.yml` (advisory workflow)

The complete workflow (feature-forge, `01-architecture-layout.md` §1.1). Third-party actions are
pinned to major tags consistent with the other feature-forge workflows (REQ-SEC-01,
`01-architecture-layout.md` §4).

```yaml
name: trigger-accuracy-eval

# Advisory ONLY (REQ-EVAL-02 / OQ-03): on demand + weekly. NEVER on pull_request.
on:
  workflow_dispatch: {}
  schedule:
    - cron: "0 6 * * 1" # Mondays 06:00 UTC — weekly cadence bounds API cost (OQ-D)

# Least privilege: the job only reads the tree and calls the API (REQ-SEC-02).
permissions:
  contents: read

jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v5

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Install the Anthropic SDK
        run: pip install --quiet anthropic

      - name: Run trigger-accuracy eval (advisory, non-blocking)
        env:
          # Secret injected from repo/org settings — never echoed, never in the repo
          # (REQ-SEC-02). The harness skips + exits 0 when this is empty (e.g. on forks).
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: python3 eval/run-eval.py
```

### 7.1 Action pinning (REQ-SEC-01)

`actions/checkout@v5` and `actions/setup-python@v5` are pinned to major tags, matching the pinning
posture of `ci.yml`/`os-matrix.yml` (`01-architecture-layout.md` §4 — rauf already pins to major
tags; feature-forge's new workflows follow). A maintainer MAY tighten to commit SHAs.

### 7.2 Non-blocking by construction (REQ-EVAL-02, REQ-PERF-01)

- No `pull_request` trigger ⇒ the job is never a PR check.
- `run-eval.py` exits 0 for any score ⇒ even if a maintainer wires this as a required check by
  mistake, a low score cannot fail it. The only red is a harness bug.
- It is a separate workflow from `ci.yml` ⇒ the fast per-PR gate is unaffected (REQ-PERF-01).

### 7.3 Secret handling (REQ-SEC-02)

- The key is read from `secrets.ANTHROPIC_API_KEY` and surfaced only as the `ANTHROPIC_API_KEY`
  **env** of the run step — GitHub masks secret values in logs, and the harness never prints the key.
- On forks / PRs from forks the secret is empty by GitHub policy; combined with the absent-key path
  (§6.4) this means the eval **skips and exits 0** there — never leaking and never erroring.
- The deterministic gates (`ci.yml`, `os-matrix.yml`) require **no** secrets (REQ-SEC-02); only this
  advisory workflow touches one.

## 8. Cost & Determinism (OQ-D)

- **Determinism:** an LLM selector is inherently non-deterministic; a given prompt may route
  differently across runs. This is **acceptable for an advisory signal** — the eval reports a *trend*,
  not a gate. The *configuration* is pinned (fixed model id, fixed `max_tokens`, stable system-prompt
  prefix) so run-to-run variation is the model's, not the harness's.
- **Cost:** small model (`claude-haiku-4-5-20251001`, $1/$5 per MTok), `max_tokens = 64`, a few dozen
  prompts ⇒ cents per run. The weekly `schedule` + on-demand `workflow_dispatch` (§2) bound recurring
  spend; there is no per-PR invocation.
- **Stable prefix (cost hygiene):** the catalog/instructions live in the `system` prompt, identical
  across every call in a run — friendly to provider-side prompt caching should it ever matter, though
  at this volume it is not load-bearing.

## 9. Lint / Ordering Constraint (cross-ref `02-ci-blocking-gates.md`)

`eval/run-eval.py` is in scope for the `ruff` gate (`ruff check scripts/ eval/`, tech-spec §3.4). Two
coupling constraints, both **owned by `02-ci-blocking-gates.md`**, are flagged here:

1. **ruff-clean harness:** §3.3 — the harness above is authored to pass `E`/`F`/`W` at line-length
   100. The lazy `import anthropic` inside `main` (only on the key-present path) is intentional and
   ruff-clean (it is *used*, so no `F401`).
2. **`eval/` must exist or the ruff target must tolerate its absence:** before this feature's eval
   item lands, `eval/` does not exist, so `ruff check scripts/ eval/` would error on a missing path.
   Per tech-spec §3.4 the resolution is a forge-4 **backlog ordering** rule — sequence the lint-gate
   item *after* the eval-harness item, **or** make the ruff invocation tolerate an absent `eval/`. The
   authoritative handling is specified in `02-ci-blocking-gates.md` (lint section); this document only
   records the dependency so the backlog author orders the two items correctly.

## Dependencies

- **`00-core-definitions.md`** — `EvalFixture` shape (§4), the supported-agent/skill context (§2),
  repo roots & cross-repo classification (§1), gate-diagnostic conventions (§8). This document
  **extends** `00 §4` with the score data shape (§5); it does **not** redefine `EvalFixture`.
- **`01-architecture-layout.md`** — eval.yml's place in the workflow topology and trigger table (§2),
  the `eval/` file inventory (§1.1), action-pinning posture (§4).
- **`02-ci-blocking-gates.md`** — owns the `ruff.toml` floor and the `ruff check scripts/ eval/`
  invocation + the `eval/`-ordering resolution (§9). (Cross-reference only; not authored here.)
- **claude-api skill** (`shared/models.md`, `python/claude-api/README.md`) — the source for the pinned
  model id and the verified `anthropic` SDK usage (§6.1, §6.3).
- **Tooling (CI-installed, not committed):** `anthropic` Python SDK; Python ≥3.10. No new runtime
  dependency is added to the repo.

## Verification

Confirms an implementation matches this spec and satisfies **SC-06** ("the trigger-accuracy eval
harness runs and emits a score, wired as a non-blocking job").

- [ ] `eval/fixtures/forge-1-prd.json` and `eval/fixtures/forge-5-loop.json` exist and conform to
      `EvalFixture` (`00 §4`); each `skill` resolves to a `skills/<skill>/` directory.
- [ ] `python3 eval/run-eval.py` with **no** `ANTHROPIC_API_KEY` set prints `skipped (no key)` and
      exits 0 (REQ-SEC-02, REQ-EVAL-02). `echo $?` is `0`.
- [ ] `python3 eval/run-eval.py` **with** a key set runs against the fixtures and prints a per-skill
      breakdown + an `OVERALL trigger-accuracy` percentage (REQ-EVAL-01, SC-06); `--json` emits a
      valid `EvalReport` (§5).
- [ ] The harness exits 0 even when the printed accuracy is low (advisory — REQ-EVAL-02).
- [ ] `ruff check eval/` reports no violations (E/F/W, line-length 100) (tech-spec §3.4).
- [ ] `.github/workflows/eval.yml` triggers on `workflow_dispatch` + `schedule` and **not** on
      `pull_request` (OQ-03, REQ-EVAL-02); it is not a required check.
- [ ] `eval.yml` reads `secrets.ANTHROPIC_API_KEY` into the step env, never echoes it, and declares
      `permissions: contents: read` (REQ-SEC-02).
- [ ] Third-party actions in `eval.yml` are pinned to a tag/SHA (REQ-SEC-01).
- [ ] The pinned model id is a current Claude model (`claude-haiku-4-5-20251001`) and `max_tokens` is
      small (OQ-D).
```
