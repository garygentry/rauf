# 00 — Core Definitions

> **Feature:** `packaging-docs-ci` (epic `agent-agnostic`, capstone 6 of 6).
> **Status:** foundation document. Every other spec in this suite references the contracts defined here.

This capstone is **not a conventional importable package** — it is the union of CI workflows, config
files, schema artifacts, scripts, and docs across two repos (`rauf` = this repo, `feature-forge` =
`../feature-forge`). There are therefore no runtime TypeScript types to export. Instead this document
fixes the **structured artifacts** the feature authors and the **consumed contracts** it depends on:
the SKILL.md frontmatter JSON Schema, the eval-fixture JSON shape, the version-sync contract, the
agent-ID set, the consumed installer-CLI surface, the cross-repo file classification, and the
gate-diagnostic conventions. Treat every shape here as authoritative; the domain docs (02–06) build
on these.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-CI-02 | SKILL.md schema (name+description, name==dir) | §3 |
| REQ-VER-03 | SKILL.md carries no version field | §3 |
| REQ-CONST-03 | Spec-purity: no vendor/version keys in SKILL.md | §3 |
| REQ-EVAL-01 | Trigger-accuracy eval harness + fixtures | §4 |
| REQ-VER-01 | Independent semver per repo | §5 |
| REQ-VER-02 | Within-repo version fields reconciled to 0.10.0 | §5 |
| REQ-CI-05 | Version-sync gate over the three fields | §5 |
| REQ-DOCS-01 | Per-agent setup doc per supported agent | §2, §6 |
| REQ-CI-07 / REQ-CI-08 | OS-matrix installer invocation surface | §7 |
| REQ-OBS-01 | Gate failures are diagnosable | §8 |
| REQ-CONST-02 | Cross-repo working-tree reality | §1 |
| REQ-MAINT-01 | Generated artifacts clearly marked | §5, §7 |

## 1. Repos, Roots, and Cross-Repo Classification (REQ-CONST-02)

Two working trees are edited by this feature; the pipeline/backlog state lives only in `rauf`.

```typescript
/** The two working trees this feature edits. */
type RepoId = "rauf" | "feature-forge";

/**
 * Absolute roots as seen from the rauf loop's working directory.
 * `rauf` is the loop's own repo; `feature-forge` is its sibling at ../feature-forge.
 */
const REPO_ROOT: Record<RepoId, string> = {
  rauf: ".", // the loop runs here; backlog + pipeline state live here
  "feature-forge": "../feature-forge",
};

/** How a touched file participates in the build — drives the regen-diff / version gates. */
type FileDisposition =
  | "NEW" //         authored from scratch by this feature
  | "EDIT" //        hand-edited existing file
  | "REGENERATED" // produced by a generator (DO-NOT-EDIT); never hand-edited (REQ-CONST-04)
  | "UNCHANGED"; //  referenced/consumed, not modified
```

**Cross-repo commit rule (REQ-CONST-02):** the loop runner commits in the `rauf` repo. Edits under
`../feature-forge` are staged/committed in *that* repo's working tree per the established cross-repo
loop technique used by sibling features. Every backlog item (forge-4) MUST declare which repo each
file it touches lives in. See `01-architecture-layout.md` for the full per-repo file inventory.

## 2. Supported Agent Set (REQ-DOCS-01, REQ-CI-07)

The closed set of five coding agents is the single source for the per-agent doc set, the README
per-surface table rows, and the installer `--agent` validation. It MUST match the installer's
`AGENT_IDS` (consumed contract, §7) and the `adapters/<agent>/` directory set exactly.

```typescript
/**
 * The five supported coding agents. This exact spelling is used for:
 *   - docs/agents/<agent>.md filenames (feature-forge)
 *   - adapters/<agent>/ directory names (verified to exist, all five)
 *   - the installer's -a/--agent values (consumed; see §7)
 *   - README per-surface table rows
 * Claude is first-class / preferred (marketplace install); the rest are derived.
 */
const SUPPORTED_AGENTS = ["claude", "codex", "copilot", "cursor", "gemini"] as const;
type AgentId = (typeof SUPPORTED_AGENTS)[number];
```

**Path conventions (settles PRD OQ-01):**

```typescript
/** Per-agent setup doc path within feature-forge (mirrors adapters/<agent>/ naming). */
const agentDocPath = (a: AgentId) => `docs/agents/${a}.md`; // e.g. docs/agents/codex.md
/** Per-agent generated adapter dir within feature-forge (consumed; verified present). */
const agentAdapterDir = (a: AgentId) => `adapters/${a}/`;
```

## 3. SKILL.md Frontmatter Schema (REQ-CI-02, REQ-VER-03, REQ-CONST-03)

The feature authors **one declarative JSON Schema** as the single source of truth for the
spec-sanctioned SKILL.md frontmatter, at `feature-forge/references/skill-frontmatter.schema.json`.
The schema fixes *which keys are allowed*; `check-spec-purity.py` loads its key sets from this file
(see `02-ci-blocking-gates.md` §for the checker integration).

**Authoritative artifact — `references/skill-frontmatter.schema.json` (JSON Schema draft 2020-12):**

```jsonc
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://github.com/garygentry/feature-forge/references/skill-frontmatter.schema.json",
  "title": "feature-forge canonical SKILL.md frontmatter",
  "description": "Spec-pure frontmatter for canonical skills/*/SKILL.md. Source of truth for the allowed/required key sets loaded by scripts/check-spec-purity.py. NO version key (REQ-VER-03): versions live in manifests only.",
  "type": "object",
  "required": ["name", "description"],
  "additionalProperties": false,
  "properties": {
    "name": { "type": "string" },
    "description": { "type": "string" },
    "license": { "type": "string" },
    "compatibility": {},
    "metadata": { "type": "object" },
    "allowed-tools": {}
  }
}
```

**Invariants this schema fixes:**

```typescript
/** The exact spec-pure key set (from forge-skill-spec-purity). MUST equal the schema's
 *  `properties` keys and check-spec-purity.py's loaded ALLOWED set (anti-drift, tech-spec §3.3). */
const ALLOWED_FRONTMATTER_KEYS = [
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
] as const;
const REQUIRED_FRONTMATTER_KEYS = ["name", "description"] as const;
```

- `additionalProperties: false` **mechanically enforces spec-purity** (REQ-CONST-03): any vendor key
  (Claude hook wiring, Codex invocation policy, Copilot flags) or a `version` key (REQ-VER-03) fails
  validation.
- **No `version` key** exists in the schema — this is the deliberate charter deviation REQ-CONS-02
  (versions live in per-repo manifests only, §5).
- Two checks the schema **cannot** express stay in Python (REQ-CI-02): `name == <directory name>`
  (per-file context) and the `${CLAUDE_PLUGIN_ROOT}` / portable-prelude / body-size rules. The
  existing `check-spec-purity.py` already encodes these (`REQUIRED_FRONTMATTER_KEYS`,
  `ALLOWED_FRONTMATTER_KEYS` at `scripts/check-spec-purity.py:35-43`; `VR_NAME_MISMATCH`,
  `VR_RESIDUAL_VAR`, `check_body_size`).

> Verified against source: the current checker hard-codes the identical 6-key allowed set and the
> 2-key required set. The §3.3 edit replaces those literals with values loaded from this schema, plus
> a pytest assertion that the loaded set equals the schema `properties` keys.

## 4. Eval Fixture Shape (REQ-EVAL-01)

The trigger-accuracy harness (`eval/run-eval.py`) consumes one fixture per skill at
`eval/fixtures/<skill>.json`.

```typescript
/**
 * A trigger-accuracy fixture for one canonical skill.
 * - shouldTrigger: prompts that SHOULD select this skill (correct = this skill chosen).
 * - shouldNotTrigger: prompts that should NOT select this skill (correct = this skill NOT chosen).
 */
interface EvalFixture {
  /** Canonical skill name; MUST equal a skills/<name>/ directory and SKILL.md `name`. */
  skill: string;
  /** Natural-language prompts expected to fire this skill. Non-empty. */
  shouldTrigger: string[];
  /** Natural-language prompts expected NOT to fire this skill. May be empty. */
  shouldNotTrigger: string[];
}
```

**Example — `eval/fixtures/forge-1-prd.json`:**

```json
{
  "skill": "forge-1-prd",
  "shouldTrigger": [
    "start a PRD for a new feature with feature-forge",
    "run forge-1-prd for the auth feature"
  ],
  "shouldNotTrigger": [
    "what's the weather today",
    "run the backlog generator"
  ]
}
```

The aggregate score and per-skill breakdown shape are defined in `04-trigger-accuracy-eval.md`.

## 5. Version-Sync Contract (REQ-CI-05, REQ-VER-01, REQ-VER-02, REQ-MAINT-01)

**Independent semver per repo (REQ-VER-01):** `rauf` and `feature-forge` keep separate version lines.
No requirement that they match. rauf's half is its existing `pnpm version:check` (source of truth
`packages/core/src/version.ts`, 6 package.jsons) — unchanged by this feature.

**feature-forge within-repo sync (REQ-CI-05, REQ-VER-02):** exactly three fields MUST agree, reconciled
to **`0.10.0`** (settles PRD OQ-02 — highest of the desynced trio).

```typescript
/** The three feature-forge version fields the gate keeps byte-equal. installer/package.json is EXCLUDED. */
interface VersionSyncContract {
  /** .claude-plugin/plugin.json -> "version". Currently 0.10.0 (already correct; confirm). */
  pluginJson: "0.10.0";
  /** .claude-plugin/marketplace.json -> plugins[0].version. Currently 0.9.0 -> hand-edit to 0.10.0. */
  marketplaceJson: "0.10.0";
  /** adapters/gemini/gemini-extension.json -> "version". Currently 0.0.0; REGENERATED to 0.10.0. */
  geminiExtensionJson: "0.10.0";
}

/** EXCLUDED from the sync gate — installer/ is a separately npm-published sub-package (currently 0.1.0). */
const VERSION_SYNC_EXCLUDED = ["installer/package.json"] as const;

const RECONCILED_VERSION = "0.10.0" as const;
```

**Reconciliation path (REQ-MAINT-01 — generated files never hand-edited):**

| Field | Current | Disposition | How reconciled |
|---|---|---|---|
| `.claude-plugin/plugin.json` | `0.10.0` | UNCHANGED | already correct; gate confirms |
| `.claude-plugin/marketplace.json` (`plugins[0].version`) | `0.9.0` | EDIT | hand-edit to `0.10.0` (not generated) |
| `adapters/gemini/gemini-extension.json` (`version`) | `0.0.0` | REGENERATED | bump `GEMINI_EXTENSION_VERSION` const in `scripts/build-adapters.py` (`:298`) → `"0.10.0"`, then regenerate |

> Verified: `scripts/build-adapters.py:298` declares `GEMINI_EXTENSION_VERSION: str = "0.0.0"` and
> `adapters/gemini/gemini-extension.json` carries a DO-NOT-EDIT header — so the generator constant is
> the only sanctioned reconciliation path (REQ-VER-02, REQ-MAINT-01).

The gate MUST **currently fail** on the live desync and pass only after reconciliation (SC-03). Gate
design is in `02-ci-blocking-gates.md`; reconciliation execution in `06-packaging-versioning-hygiene.md`.

## 6. Documentation Artifact Set (REQ-DOCS-01..04, REQ-README-01..03)

```typescript
/** The authored documentation deliverables (all in feature-forge unless noted). */
interface DocArtifacts {
  /** Five per-agent setup docs, one per SUPPORTED_AGENTS member. */
  agentDocs: `docs/agents/${AgentId}.md`[];
  /** feature-forge README, rewritten install-first (REQ-README-01). */
  featureForgeReadme: "README.md";
  /** rauf README, EDIT only: add a labeled cross-agent section (REQ-README-02). */
  raufReadme: "../? rauf README.md (this repo)";
}
```

Full content rules live in `05-readme-and-agent-docs.md`. The default forge↔rauf loop path
(REQ-DOCS-04) is sourced from `feature-forge/references/ralph-loop-contract.md` (the
`forge-loop-runner-contract` expose) — verified present.

## 7. Consumed Installer-CLI Contract (REQ-CI-07, REQ-CI-08)

The OS-matrix gate and the install docs consume the `cross-agent-installer-cli` contract; this feature
defines nothing here, it **invokes** the verified surface.

```typescript
/** Verified from feature-forge/installer/src/cli.ts + rauf.ts (not authored here). */
interface InstallerCliContract {
  /** bin name; package "feature-forge"; entry dist/cli.js (Node >=18, zero runtime deps). */
  bin: "feature-forge";
  entry: "installer/dist/cli.js";
  /** subcommand -> accepted aliases (cli.ts SUBCOMMANDS table). */
  subcommands: {
    install: ["add"];
    update: [];
    uninstall: ["remove"];
    list: ["ls"];
  };
  /** flags exercised by this feature's CI legs / docs. */
  flags: ["-a/--agent", "-g/--global", "--symlink", "--force", "--dry-run", "-y/--yes", "--json", "--skip-rauf", "-h/--help", "--version"];
  /** EXIT.SUCCESS=0, USAGE/validation=2, runtime FAILURE=1 (cli.ts exitCode mapping). */
  exitCodes: { success: 0; usage: 2; failure: 1 };
  /** rauf provisioning pin (installer/src/rauf.ts). --skip-rauf bypasses the registry preflight. */
  raufPin: "rauf@0.6.0";
}
```

**OS-matrix invocation (per leg) — REQ-CI-07/-08:**

```bash
cd installer && npm ci && npm run build          # build first on each leg
node installer/dist/cli.js install --dry-run --skip-rauf --json   # plan only; assert exit 0 + valid JSON
node installer/dist/cli.js uninstall -y --skip-rauf               # exercise uninstall path
```

`--skip-rauf` suppresses the npm registry preflight because rauf is unpublished (IR-2); without it the
dry-run fails for an out-of-scope reason. The Windows leg uses copy-by-default (never `--symlink`,
REQ-CI-08). Full matrix design in `03-os-matrix-installer-gate.md`.

## 8. Gate-Diagnostic Conventions (REQ-OBS-01)

Every gate this feature authors MUST fail loudly and actionably — no silent failures.

```typescript
/** The minimum diagnostic each gate emits on failure (REQ-OBS-01). */
interface GateDiagnostic {
  gate: string; //                 e.g. "version-sync", "adapters-regen-diff", "shellcheck"
  what: string; //                 one-line failure summary
  evidence: string; //             the proof: conflicting files+values | unified diff | file:line:rule
  remedy: string; //               the fix command, e.g. "run python3 scripts/build-adapters.py and commit"
}
```

Concrete obligations:
- **version-sync** prints each conflicting file and its value.
- **adapters regen-diff** prints the unified `diff` (delegated to `build-adapters.py --check` /
  validate.sh step 6b — verified present).
- **shellcheck / ruff** print `file:line:rule`.
- **OS-matrix** asserts installer exit 0 + valid JSON, surfacing the installer's own error on failure.
- **claude plugin validate --strict** failure (or its documented-equivalent fallback) is logged, never
  silently skipped (see `02-ci-blocking-gates.md` §3.1.1).

## Dependencies

None — this is the foundation document. All other docs in this suite depend on it.

## Verification

- [ ] `references/skill-frontmatter.schema.json` parses as valid JSON Schema draft 2020-12.
- [ ] The schema's `properties` keys equal `ALLOWED_FRONTMATTER_KEYS` (6) and `required` equals
      `REQUIRED_FRONTMATTER_KEYS` (2) — matching `check-spec-purity.py`'s loaded sets.
- [ ] `SUPPORTED_AGENTS` matches the `adapters/<agent>/` dir set and the installer's `AGENT_IDS`.
- [ ] The three version fields reconcile to `0.10.0`; `installer/package.json` is excluded.
- [ ] Every `EvalFixture.skill` resolves to a `skills/<skill>/` directory.
