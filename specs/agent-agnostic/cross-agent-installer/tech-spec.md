# cross-agent-installer — Technical Specification

> **Epic:** `agent-agnostic` (member 4 of 6) · **Version:** 1 · Based on **PRD v2**.
> **Target repo:** `feature-forge` (`/home/gary/workspace/feature-forge`) — per **C-1** all implementation lands there; this spec, the backlog, and the loop are driven from `rauf` (`specs/agent-agnostic/cross-agent-installer/`).
> **Depends on:** `forge-agent-adapters-build` (complete), `rauf-agent-cli-adapters` (complete).
> **Exposes:** `cross-agent-installer-cli`, `agent-detection-map`. **Downstream:** `forge-rauf-loop-default`, `packaging-docs-ci`.
> **Verify command:** `bash scripts/validate.sh` (in feature-forge), extended to build + test the installer (**C-2**). There is **no** rauf `pnpm gate` for this feature.

## 1. Overview

This feature adds feature-forge's **packaging seam**: a cross-platform, zero-config CLI installer that detects installed coding agents by probing their config dirs, copies (or symlinks) the generated `adapters/{agent}/` bundles into each agent's skills destination idempotently, and records a per-agent manifest so `update`/`list`/`uninstall` are exact and safe. It also makes a **pinned, published, Node-resolvable rauf** the default loop runner so a multi-agent install yields a working loop out of the box.

It is the repository's **first-ever Node package** — feature-forge is otherwise Python + bash (verified: zero `package.json`/JS/TS in the tree). The installer is a self-contained TypeScript package under `installer/` with **zero runtime dependencies** (only `node:` built-ins), compiled by `tsc`, tested with the built-in `node:test` runner, and reachable through the single `bash scripts/validate.sh` gate.

### Key architectural decisions (settled in interview)

- **D1 — Rauf provisioning = lazy `npx` + install-time resolvability preflight** (resolves **OQ-1**; REQ-RAUF-01/02/03). The installer records a pinned coordinate `rauf@<pin>` (unscoped `rauf`; its bin is already `rauf`, so `npx rauf …` is the natural surface) and performs a **resolvability preflight** at install. The default loop path resolves rauf on demand via `npx rauf@<pin>` (network permitted, **C-7**). No vendored binary, no global/system mutation. The spec defines the **consumption contract + the unavailable-pin failure mode**; actually publishing rauf is a **cross-repo prerequisite this feature MUST NOT own** (C-7, sequenced with `packaging-docs-ci`). Today nothing rauf is on npm (§6, **IR-2**) — the pin is correctable config.
- **D2 — Installer stack = TypeScript, zero runtime deps, `node:test`, `node:util.parseArgs`** (REQ-DIST-01/03; C-4). Compiled to JS via `tsc`; runs under **plain Node ≥ 18** (REQ-DIST-01 — not Bun). Types pay off on the detection map, manifest schema, and the plan/action model. Mirrors the repo's minimalist ethos (Python stdlib + one pinned dep).
- **D3 — Layout = `installer/` subdirectory** with its own `package.json`; the published npm package **bundles `dist/` + a copy of `adapters/`** as package data (`files`), so `npx` needs no checkout (REQ-DIST-01; D7).
- **D4 — Gate = a hard `validate.sh` step** that runs `npm ci && npm run build && npm test` in `installer/`; absent Node/npm **fails** the gate with remediation (C-2/C-4).
- **D5 — Install structure = a namespaced `feature-forge/` dir per agent** inside the agent's skills/rules/extensions location (REQ-OPS-01, REQ-SAFE-01). Uninstall removes that one dir; the user's other skills are untouched.
- **D6 — Manifest = a hidden sibling `.feature-forge.<scope>.json`** in the *parent* of the namespace dir (uniform for copy **and** symlink — see D8), recording a **SHA-256 per written file** + a bundle `sourceHash` (resolves **OQ-2/OQ-4**; REQ-SAFE-01/03, REQ-IDEM-01/02/03).
- **D7 — Adapters source = bundled into the npm package** (`files: ["dist","adapters"]`); in-repo dev resolves `../adapters/`; a hidden `--source <dir>` aids tests. REQ-OPS-06 integrity check validates the located source.
- **D8 — Symlink = link the whole namespace dir → source bundle**; Windows always copies (REQ-FLAG-03); uninstall **unlinks** the dir and never deletes the target (REQ-SAFE-02/REQ-SEC-03). Because the link points into the read-only source, the manifest is the parent-sibling of D6.
- **D9 — Gemini manifest = plain copy** (resolves **OQ-5**; REQ-OPS-07). The namespaced `feature-forge/` dir *is* the Gemini extension dir; the bundle already carries `gemini-extension.json` at its root, so a plain bundle copy lands a valid, loadable manifest with no Gemini-only code path.

> **Decision map (backlog/specs cite against this):** D1 rauf provisioning · D2 stack · D3 layout · D4 gate · D5 install structure · D6 manifest+drift · D7 adapters source · D8 symlink · D9 gemini.

## 2. Module Structure

All paths relative to the `feature-forge` repo root. **NEW** unless noted.

```
feature-forge/
├── installer/                         — NEW Node package (exposed: cross-agent-installer-cli)
│   ├── package.json                   — name + bin "feature-forge"; files:["dist","adapters"]; engines.node>=18; zero deps
│   ├── tsconfig.json                  — strict; target ES2022; module nodenext; outDir dist
│   ├── adapters/                      — packaged copy of repo ../adapters (D7); present in the published tarball only
│   ├── src/
│   │   ├── cli.ts                     — arg parsing (node:util.parseArgs), subcommand dispatch, --help/--version
│   │   ├── agent-targets.ts           — NEW exposed contract: agent-detection-map (static table + detect)
│   │   ├── detect.ts                  — config-dir probe + optional CLI-on-PATH (REQ-DET-02)
│   │   ├── source.ts                  — locate adapters/<agent>/ (packaged | ../adapters | --source) + integrity check (REQ-OPS-06)
│   │   ├── plan.ts                    — pure planner → per-agent/per-skill action list (dry-run engine, REQ-OPS-05)
│   │   ├── apply.ts                   — execute a plan: copy/symlink/remove (REQ-OPS-01/02/03)
│   │   ├── manifest.ts               — read/write .feature-forge.<scope>.json; sha256 inventory (REQ-SAFE-01/03)
│   │   ├── hash.ts                    — sha256 file/tree hashing (node:crypto) (OQ-4)
│   │   ├── rauf.ts                    — RAUF_PIN constant + resolvability preflight (D1, REQ-RAUF-*)
│   │   ├── fsutil.ts                  — sandboxed copy/symlink/rm (path.resolve + containment, REQ-SEC-01/02)
│   │   ├── report.ts                  — per-agent/per-skill summary + --json (REQ-OBS-01)
│   │   └── types.ts                   — AgentId, Scope, Mode, PlannedAction, InstallManifest, DetectionResult
│   └── test/                          — node:test suites + fixtures (fake adapters tree + sandboxed HOME)
├── scripts/validate.sh                — EXTENDED: new hard step "8. Installer build + test" (D4, C-2)
├── .gitignore                         — EXTENDED: installer/node_modules/, installer/dist/, installer/adapters/ (dev copy)
├── adapters/                          — UNCHANGED, consumed read-only (C-3)
└── AGENTS.md / README.md              — UNCHANGED here (install-section rewrite is packaging-docs-ci, §6)
```

### Public API surface (the two exposed contracts)

- **`cross-agent-installer-cli`** (module) — the `installer/` package; bin `feature-forge` with subcommands `install` (alias `add`), `update`, `uninstall` (alias `remove`), `list` (alias `ls`). CLI in §5. *(The published package coordinate / final bin name is finalized by `packaging-docs-ci`; this feature ships a working, npx-runnable package.)*
- **`agent-detection-map`** (function/module, **REQ-DET-05**) — `src/agent-targets.ts` exposes the static per-agent table **and** the detection that applies it to a host as **one surface**, consumable two ways: (a) **importable** — `AGENT_TARGETS` (target paths) + `detectAgent(id)` / `detectAgents()` (per-agent detected/not-detected); (b) **shell** — `feature-forge list --json` for `packaging-docs-ci`'s OS-matrix dry-runs and any non-Node consumer. This reconciles the `kind: function` characterization with the static-table half (REQ-DET-05).

## 3. Technical Decisions

### 3.1 Rauf provisioning — lazy npx + preflight (REQ-RAUF-01..05, OQ-1, C-7) [D1]

The installer does **not** vendor a binary and does **not** mutate the global npm prefix. It:

1. **Pins** a single coordinate in one source of truth — `src/rauf.ts` → `RAUF_PIN = "rauf@0.6.0"` (the current rauf version; **REQ-RAUF-03** — advanced on each feature-forge release). Unscoped `rauf`, bin `rauf`.
2. **Records** the pin in each agent's install manifest (`raufPin`, §4) and reports it in the install summary (REQ-OBS-01). This is the stable value `forge-rauf-loop-default` (downstream) reads to invoke `npx rauf@<pin> loop run . --backlog …` — wiring the loop default is **its** scope, not this feature's (REQ-RAUF-05 keeps alternate runners open).
3. **Preflights resolvability** at install (network permitted, C-7): a **read-only** registry query `npm view rauf@<pin> version` (no install, no global mutation, no execution of rauf). Success → record the pin. Failure → an **actionable** error (REQ-OBS-02) naming the coordinate and remediation, and (per partial-failure, REQ-OBS-03) the overall run still completes other work and exits non-zero.

**Idempotent + reversible (REQ-RAUF-04):** REQ-RAUF-04 is satisfied **vacuously** by D1 — because rauf is resolved lazily via `npx` and is **never written into the install destination**, re-running provisions nothing to duplicate, and uninstall has no rauf files to remove. The only durable rauf trace is `raufPin` in the manifest (§4); uninstall clears it with the manifest (§3.6), so bundling is reversible with no rauf-specific filesystem step.

> **Unavailable-pin failure mode (OQ-1 mandate).** Because rauf is not yet published (§6 **IR-2**), the preflight will fail until the C-7 publish prerequisite lands. The error text is fixed and explicit: *"pinned default loop runner `rauf@<pin>` is not resolvable from the npm registry. Network is required at install; if rauf is not yet published this is the known cross-repo prerequisite (see packaging-docs-ci). Skills were still installed; the default loop will be unavailable until rauf publishes."* The installer **MUST NOT** fall back to a vendored binary or silently degrade. A `--skip-rauf` flag suppresses the preflight (and records `raufPin: null`) for environments that knowingly defer it (e.g. CI dry-runs).

> *Alternatives considered (rejected):* **eager local `npm install` into a managed dir** (offline-capable after install, but adds a second tracked filesystem location and more uninstall surface for no PRD-required benefit — offline install is explicitly *not* required, C-7); **global `npm install -g rauf`** (mutates the global prefix, may need elevation — violates REQ-SEC-01).

### 3.2 Agent detection map — the single exposed surface (REQ-DET-01..05) [agent-detection-map]

`src/agent-targets.ts` is the one named surface combining the static table and the detection behavior (REQ-DET-05). The table (REQ-DET-01, REQ-SCALE-01 — adding an agent is a table row, no logic change):

| Agent | Global config dir | Install destination — global / project-local | Skill file form | Confidence |
|---|---|---|---|---|
| **claude** | `~/.claude` | `~/.claude/skills/feature-forge/` · `./.claude/skills/feature-forge/` | `SKILL.md` | **Confirmed** (forge-root.sh, portable-root.md) |
| **codex** | `~/.codex` | `~/.codex/skills/feature-forge/` · `./.codex/skills/feature-forge/` | `<name>.md` (+`agents/openai.yaml`) | Best-known — TQ-1 |
| **copilot** | `~/.copilot` | `~/.copilot/skills/feature-forge/` · `./.copilot/skills/feature-forge/` | `<name>.md` | Best-known — TQ-1 |
| **cursor** | `~/.cursor` | `~/.cursor/rules/feature-forge/` · `./.cursor/rules/feature-forge/` | `<name>.mdc` | Best-known — TQ-1 |
| **gemini** | `~/.gemini` | `~/.gemini/extensions/feature-forge/` · `./.gemini/extensions/feature-forge/` | `<name>.md` (+`gemini-extension.json`) | Best-known — TQ-1 |

- **Detection signal (REQ-DET-02):** an agent is "detected/installed" primarily by **presence of its config dir** (a `stat`, never an agent subprocess). CLI-on-PATH is reported as **secondary** `cliOnPath?` info only. This covers IDE/GUI agents (Cursor) that have a config dir but no CLI.
- **Default scope (REQ-DET-03):** no `--agent` → operate on **all detected agents**.
- **Zero detected (REQ-DET-04):** report clearly, **naming every config dir probed**; never create an agent config dir speculatively; never an opaque error.
- **Per-agent paths** are isolated table entries, so the **TQ-1** best-known paths (codex/copilot/cursor/gemini) are corrected at implementation with a localized edit (REQ-SCALE-01) — verify each against the agent's current docs/layout before/at impl.
- **Home injection for tests:** every path is derived through a single `resolveRoots({ home, cwd })` helper defaulting to `os.homedir()` / `process.cwd()`, so tests sandbox detection and writes without touching the real `~` (§8).

### 3.3 Operations engine — plan then apply (REQ-OPS-01..06, REQ-OPS-05) 

A **pure planner** (`plan.ts`) computes, per agent, a per-skill/per-file action list — `create | overwrite | skip-modified | unchanged | remove` — by diffing the located source bundle (D7) against the destination and the recorded manifest (D6). `--dry-run` prints exactly that plan and changes nothing (REQ-OPS-05); a real run hands the **same plan** to `apply.ts`. This guarantees "dry-run prints exactly what a real run does" (Success Criteria).

- **install/add (REQ-OPS-01):** materialize the bundle into `<dest>/feature-forge/` (copy, or symlink per D8) and write the manifest.
- **update (REQ-OPS-02/REQ-IDEM-03):** reconcile a clean prior install to current `adapters/` — `create` new skills, `overwrite` changed ones, `remove` skills the manifest records but canon no longer has — **without** `--force`. Orphan removal is manifest-scoped (only installer-written paths).
- **uninstall (REQ-OPS-03):** remove exactly the manifest-recorded files/dir (D5/D6); see §3.6.
- **list (REQ-OPS-04):** per agent — detected? installed (manifest present)? up to date (`sourceHash` matches current bundle)? plus drift (any `skip-modified`).
- **Missing/invalid source (REQ-OPS-06):** if an agent is **detected** but `adapters/<agent>/` is absent or fails the minimal integrity check (`skills/` non-empty, `scripts/forge-root.sh` present, and for gemini `gemini-extension.json` present), report it — naming the agent + expected source path — write **no** partial install for it, and **continue** with the other agents (REQ-OBS-03).

### 3.4 Idempotency & conflict handling (REQ-IDEM-01..03, REQ-FLAG-04) [D6]

Drift is decided by SHA-256 (OQ-4), never mtime:

- **`sourceHash`** = sha256 over the bundle's canonical (sorted-path) file set. Manifest `sourceHash` ≠ current bundle ⇒ **out of date** ⇒ `update` refreshes (no `--force`, REQ-IDEM-03).
- **Per-file `sha256`** recorded for every written file. A destination file whose current hash ≠ the recorded hash **and** ≠ what we would now write is **locally modified** ⇒ `skip-modified` + report; never overwritten unless `--force` (REQ-IDEM-02, REQ-FLAG-04). A destination not tracked by any manifest is treated as user content and skipped (never clobbered).
- **No-op (REQ-IDEM-01):** source unchanged + destination clean ⇒ all actions `unchanged` ⇒ zero writes, report "up to date".

### 3.5 Flags & scoping (REQ-FLAG-01..05, REQ-DIST-02) 

`--agent/-a <id>` (one of five; absent ⇒ all detected, REQ-FLAG-01) · `--global/-g` (user-level dir; default = project-local `./.<agent>/…`, REQ-FLAG-02) · `--symlink` (opt-in; copy default; **Windows always copies**, REQ-FLAG-03/D8) · `--force` (REQ-FLAG-04) · `--dry-run` (REQ-OPS-05) · `-y/--yes` (non-interactive, assume confirmed; REQ-DIST-02/REQ-FLAG-05) · `--json` (machine-readable report; REQ-DET-05) · `--skip-rauf` (§3.1) · `--source <dir>` (hidden, tests; D7).

### 3.6 Manifest & uninstall safety (REQ-SAFE-01..03, REQ-SEC-02/03) [D6/D8]

- **Location:** `<skillsRoot>/.feature-forge.<scope>.json` — a hidden file in the **parent** of the namespace dir (e.g. `~/.claude/skills/.feature-forge.global.json`). Parent-sibling (not inside the dir) so it is identical for **copy and symlink** (a symlinked namespace dir points into the read-only source and cannot hold the manifest). Scope (`global`/`project`) is encoded in the filename and implied by location.
- **uninstall (REQ-SAFE-01):** remove exactly the manifest's recorded files/dir, then the manifest; untracked user files and other skills are untouched.
- **Symlink uninstall (REQ-SAFE-02/REQ-SEC-03):** **unlink the namespace dir** (remove the link) — never recurse into or delete the link's target (the repo `adapters/` source). `apply.ts` uses `lstat` + `unlink` on the link, never `rm -rf` through it.
- **Sufficiency (REQ-SAFE-03):** the manifest (file inventory + hashes + `mode` + `sourceHash`) is what `list` and `update` use to distinguish installer-written content from user content and to detect drift.

### 3.7 Security / path sandboxing (REQ-SEC-01..03) 

Every destination is `path.resolve`d and asserted to lie within the intended agent config root (per scope) **before any write** (REQ-SEC-02) — a malformed agent id or `..` cannot escape the target tree. The installer writes **only** within detected agent config dirs and the manifest location (REQ-SEC-01); it requests **no** elevated privileges. Symlink ops never follow a link to write/delete outside the target (REQ-SEC-03; see §3.6).

### 3.8 Cross-platform (C-6, REQ-FLAG-03) 

`node:os.homedir()` + `node:path` for all path building; no shelling out for fs ops. Copy via `fs.cp`/recursive copy; symlink via `fs.symlink` with a **Windows → copy** fallback (symlink not assumed available). Newline/exec-bit concerns on generated content are `packaging-docs-ci`'s `.gitattributes` scope (§6), not the installer's.

### 3.9 validate.sh integration (C-2, C-4) [D4]

A new **top-level hard step "8. Installer build + test"** is appended after step 7, following the step-6b provisioning idiom (verified §6) but mirrored for Node, and using the `if … then PASS else ERRORS=$((ERRORS+1)) fi` accumulation so the final summary reports it:

```bash
# 8. Installer build + test (C-2/C-4) — TOP-LEVEL hard step. The installer is the
#    feature's deliverable; verification must build and test it through the single gate.
echo ""; echo "Building + testing the cross-agent installer..."
if command -v npm >/dev/null 2>&1; then
  if ( cd "$REPO_ROOT/installer" && npm ci --silent && npm run build --silent && npm test --silent ); then
    echo "PASS: installer build + node:test suite"
  else
    echo "FAIL: installer build/test (see above)"
    ERRORS=$((ERRORS + 1))
  fi
else
  echo "FAIL: node/npm not found — required to build + test the installer (install Node >= 18)"
  ERRORS=$((ERRORS + 1))
fi
```

Node/npm absence is an **ERROR** (hard, per interview) — not a pytest-style soft skip — because the installer is the deliverable C-2 requires verifying. The OS-matrix CI (`packaging-docs-ci`) guarantees Node is present where this runs.

## 4. Data Model

No persistent store beyond the per-install manifest. In-memory types in `src/types.ts`; the persisted schema:

```ts
type AgentId = "claude" | "codex" | "copilot" | "cursor" | "gemini";
type Scope = "global" | "project";
type Mode  = "copy" | "symlink";

interface InstallManifest {                 // .feature-forge.<scope>.json
  schemaVersion: 1;
  agent: AgentId;
  scope: Scope;
  mode: Mode;
  destination: string;                      // abs path of the feature-forge/ namespace dir
  featureForgeVersion: string | null;       // bundle version coordinate; null today — the consumed adapters/ bundles carry no version (no plugin.json/version header). Source deferred to the generator under OQ-A/IR-1; C-3 forbids reading outside adapters/
  sourceHash: string;                       // sha256 over the bundle's sorted file set (drift)
  raufPin: string | null;                   // e.g. "rauf@0.6.0" recorded at install; null if --skip-rauf
  installedAt: string;                      // ISO-8601
  updatedAt: string;                        // ISO-8601
  skills: string[];                         // installed skill ids
  files: Array<{ path: string; sha256: string }>;  // path relative to destination; sha256 omitted for symlink mode
  link?: { target: string };                // symlink mode only: the bundle the namespace dir links to
}

interface DetectionResult {                 // one row of the agent-detection-map surface
  agent: AgentId;
  detected: boolean;                        // config dir present (primary signal, REQ-DET-02)
  configDirsProbed: string[];               // named in zero-detection report (REQ-DET-04)
  cliOnPath?: boolean;                      // secondary info only
  destination: string;                      // resolved install dest for the active scope
}

interface PlannedAction {                   // dry-run engine output (REQ-OPS-05)
  agent: AgentId; scope: Scope; mode: Mode;
  files: Array<{ relpath: string; action: "create"|"overwrite"|"skip-modified"|"unchanged"|"remove" }>;
  raufPin?: string | null;                  // surfaced in the plan/report
}
```

## 5. API Design

### 5.1 CLI (`bin: feature-forge`)

```
feature-forge <install|add | update | uninstall|remove | list|ls> [flags]

Flags: -a|--agent <id>  -g|--global  --symlink  --force  --dry-run  -y|--yes
       --json  --skip-rauf  --source <dir>(hidden)  -h|--help  --version
```

- `install` / `update` / `uninstall` mutate; all three honor `--dry-run` (REQ-OPS-05).
- `list` is read-only and effectively instant — detection + manifest read + hash compare, **no network, no build** (REQ-PERF-01).
- `--help` enumerates subcommands + flags from a single spec (REQ-DIST-03).
- Parsed via `node:util.parseArgs` (zero-dep); unknown agent / flag ⇒ usage error (exit 2, §7).

### 5.2 Library surface (`agent-detection-map`, REQ-DET-05)

```ts
export const AGENT_TARGETS: Record<AgentId, AgentTarget>;     // static table (§3.2)
export function detectAgent(id: AgentId, opts?: ResolveOpts): DetectionResult;
export function detectAgents(opts?: ResolveOpts): DetectionResult[];
export const RAUF_PIN: string;                                // "rauf@0.6.0" (D1, single source of truth)
```

Plus the shell surface `feature-forge list --json` (same data) for `packaging-docs-ci`'s OS-matrix dry-runs and `forge-rauf-loop-default`.

## 6. Integration Points

**Consumes (read-only, C-3):**

1. **`adapters-output`** from `forge-agent-adapters-build` — the committed `adapters/{claude,codex,copilot,cursor,gemini}/` tree. **Verified ground truth:** each bundle has `skills/` (11 skills), `references/`, `scripts/forge-root.sh`, `agents/`; **gemini** adds `gemini-extension.json` (4,631 B); **codex** adds `agents/openai.yaml`; **cursor** uses `.mdc`. The installer copies/symlinks these verbatim (REQ-SCALE-02 — no per-skill installer change) and bundles a copy into its own npm package (D7).
2. **The published, runnable rauf bin** from `rauf-agent-cli-adapters` — consumed as the coordinate `rauf@<pin>` resolved via `npx` (D1). **Verified loop surface:** `rauf loop run <path> --backlog <dir> [--iterations N] [--agent <id>] …`. The installer only **records + preflights** the pin; invoking the loop is downstream (`forge-rauf-loop-default`).

> **Manifest reconciliation (V-001, from PRD C-3):** `epic-manifest.json` lists this feature's consume as `agent-cli-registry` (a *module*). What is actually consumed is the **published rauf bin** (an *artifact*). The installer never imports or drives rauf's `agent-cli-registry` code. The consume should be corrected to the published rauf bin — flagged for an epic-level update (not done here; this spec modifies neither file). The same stale consume appears in **both** `epic-manifest.json` (`features[].consumes` for this feature) **and** `EPIC.md` (the cross-agent-installer "Consumes" block); the correction MUST be applied to **both in lockstep** so it does not introduce a new EPIC.md⇆manifest drift (CHECK-E06).

**Extends (in feature-forge):**
- **`scripts/validate.sh`** (204 lines, `set -euo pipefail`) — new hard step 8 (§3.9). Verified: steps end with an `ERRORS` summary at lines 194–204; step 6b is the venv-provisioning precedent.
- **`.gitignore`** (16 lines) — add `installer/node_modules/`, `installer/dist/`, and `installer/adapters/` (the dev-time packaged copy; the committed source is repo-root `adapters/`). *(Spec decision: keep `installer/adapters/` out of git — it is reproducible from `../adapters/` and bundled at publish time.)*

**Exposed to downstream:** `cross-agent-installer-cli` (CLI + `list --json`) and `agent-detection-map` (importable + `--json`) — `packaging-docs-ci` drives `--dry-run`/`uninstall` on the OS matrix; `forge-rauf-loop-default` reads `RAUF_PIN` / the manifest and the detection map.

**Conflict check:** the installer is purely additive (a new `installer/` dir + one `validate.sh` step + `.gitignore`). It touches no canon (`skills/`/`references/`/`agents/`), no generator, no rauf code (C-3). No in-progress sibling feature writes `installer/`. No missing exports — every consumed surface was located in source.

> ### ⚠️ IR-1 — installed bundle is not resolver-discoverable (source-verified)
> `scripts/forge-root.sh:19` (`is_root()`) requires **both** `scripts/epic-manifest.py` **and** `.claude-plugin/plugin.json` at a candidate root. The generated `adapters/<agent>/` bundles contain **neither** (verified: `adapters/claude/` holds only `agents/ references/ scripts/forge-root.sh skills/`; `epic-manifest.py` is not copied into any bundle). Consequently a freshly **installed** `feature-forge/` bundle fails `is_root()`, so its own copied `forge-root.sh` cannot self-locate it, and any skill that shells to `epic-manifest.py` (e.g. forge-2-tech's Feature Directory Resolution) cannot run from a non-Claude installed bundle. The installer **cannot** fix this without violating **C-3** (it copies the bundle read-only). This is an `adapters-output` **completeness gap** owned by `forge-agent-adapters-build` (and possibly the resolver's sentinel design in `forge-skill-spec-purity`). **Recommendation:** the generator should emit the two sentinels (and, if skills need it, `epic-manifest.py`) into each bundle so installed bundles are self-locating. Tracked as **OQ-A** (§10) for forge-3-specs + an epic-level coordination/manifest note.

> ### ⚠️ IR-2 — rauf is not publishable today (source-verified; the C-7 prerequisite)
> All 5 rauf packages are `private: true`; `@rauf/cli`'s bin shebang is `#!/usr/bin/env bun` (needs Bun at runtime, not Node); `packages/web` uses Bun-only APIs; distribution is `bun build --compile` → GitHub Release platform binaries; nothing rauf is on npm. So `npx rauf@<pin>` 404s until the cross-repo publish work lands. This spec's D1 preflight + unavailable-pin failure mode (§3.1) is exactly the reconciliation OQ-1 requires; the publish itself is **C-7**, owned by `packaging-docs-ci`, **not** this feature.

## 7. Error Handling

- **Per-agent partial failure (REQ-OBS-03):** each agent is processed independently; one agent's failure (missing source, permission denial, conflict) never aborts the others. The final summary reports per-agent success/failure; overall exit is non-zero if **any** failed.
- **Actionable messages (REQ-OBS-02):** every failure names the **agent**, the **path**, and the **remedy** — e.g. `skip-modified` → "re-run with --force", write denial → "no write permission to <path>", missing source → "expected adapters/<agent>/ (run the adapters build)", rauf pin → §3.1.
- **Exit codes:** `0` success; `1` one-or-more operational failures (REQ-OBS-01/03); `2` usage error (unknown agent/flag/subcommand). 
- **Internal style:** core functions return a `Result`-like `{ ok, value | error }` (matching the project's no-throw-for-expected-errors convention); `cli.ts` maps these to exit codes + reports. Unexpected exceptions surface as exit 1 with the message (never a raw stack as the only output).

## 8. Testing Approach

`installer/test/*.test.ts` via the built-in **`node:test`** runner (zero dep), driven through `resolveRoots({ home, cwd })` against a **sandboxed temp HOME** and a **fixture adapters tree**, so no real `~` is touched:

- **Detection (REQ-DET-01/02/03/04):** config-dir-present ⇒ detected; absent ⇒ not; zero-detected report names probed dirs; `--agent` scoping.
- **Dry-run = real run (REQ-OPS-05):** the plan from `--dry-run` equals the actions `apply` performs; `--dry-run` writes nothing (assert temp tree unchanged).
- **Idempotency (REQ-IDEM-01):** install → install ⇒ second run all-`unchanged`, zero writes, "up to date".
- **Update reconcile (REQ-OPS-02/REQ-IDEM-03):** add/change/remove a fixture skill ⇒ update adds/refreshes/removes without `--force`; orphan removal is manifest-scoped.
- **Skip-modified (REQ-IDEM-02/REQ-FLAG-04):** hand-edit a destination file ⇒ `skip-modified` + reported; `--force` overwrites.
- **Uninstall exactness (REQ-SAFE-01):** seed an unrelated user file in the skills root ⇒ uninstall removes only manifest-tracked content + manifest; user file survives.
- **Symlink (REQ-FLAG-03/REQ-SAFE-02):** `--symlink` links the namespace dir; uninstall `unlink`s it and the source bundle is intact (target untouched); manifest is the parent-sibling.
- **Source integrity / partial failure (REQ-OPS-06/REQ-OBS-03):** detected agent with missing/invalid `adapters/<agent>/` ⇒ reported, no partial install, others proceed, exit non-zero.
- **Gemini outcome (REQ-OPS-07):** install leaves a valid, parseable `gemini-extension.json` at the destination.
- **Rauf preflight (REQ-RAUF-01..03, D1):** preflight invoked with `RAUF_PIN`; the registry call is injectable/mocked — resolvable ⇒ `raufPin` recorded; unresolvable ⇒ the fixed failure message + non-zero, skills still installed; `--skip-rauf` ⇒ `raufPin: null`, no network.
- **Sandboxing (REQ-SEC-02):** a crafted agent id / `..` cannot resolve a destination outside the agent root (rejected before any write).
- **Gate (C-2):** `bash scripts/validate.sh` builds + tests the installer and passes end-to-end.

## 9. Dependencies

- **Runtime:** **none** beyond Node ≥ 18 `node:` built-ins (`fs`, `path`, `os`, `crypto`, `util.parseArgs`, `child_process` only for the read-only `npm view` preflight). The published npm payload is `dist/` + the bundled `adapters/` (small markdown).
- **Dev:** `typescript`, `@types/node` (devDependencies; provisioned by `npm ci` in the gate, C-4). Test runner is built-in `node:test` — no vitest/jest.
- **External (provisioned, not vendored):** the pinned `rauf@<pin>` package, resolved lazily via `npx` at loop time (D1) — not an install-time dependency of the installer package.
- **No new Python/bash deps** in feature-forge; `validate.sh` gains one step.

## 10. Open Technical Questions

- **OQ-A (installed-bundle self-location — IR-1; + bundle version coordinate):** the generated bundles lack the `forge-root.sh` sentinels (`scripts/epic-manifest.py`, `.claude-plugin/plugin.json`) and `epic-manifest.py`, so installed non-Claude bundles are not resolver-discoverable. **Relatedly**, the bundles carry **no version coordinate** (no `plugin.json` / `SKILL.md` version header), so the manifest's `featureForgeVersion` is `null` today (§4); C-3 forbids the installer reading outside `adapters/` to synthesize one. Resolution is **upstream** (generator emits the sentinels and a version coordinate into each bundle, and/or the resolver's sentinel set is revisited) — settle in forge-3-specs with an epic-level coordination note; the installer copies whatever the bundle ships and records `featureForgeVersion` from it once present (C-3, REQ-SCALE-02).
- **OQ-B (per-agent target paths — TQ-1):** the codex/copilot/cursor/gemini destination paths in §3.2 are best-known; confirm each against the agent's current config-dir/skills-dir convention at implementation. Isolated table entries ⇒ localized corrections (REQ-SCALE-01).
- **OQ-C (published-rauf coordinate finalization — OQ-1 residual / C-7):** `RAUF_PIN` is `rauf@0.6.0` against an unscoped `rauf` package that does not exist yet (IR-2). When `packaging-docs-ci` stands up rauf's publish path, confirm the final coordinate (unscoped `rauf` vs the alternative) and that the published bin runs under plain Node; update the single `RAUF_PIN` constant. Correctable config, not an architectural change.
- **OQ-D (installer package coordinate / bin name):** the published npm coordinate and final bin name for the installer itself are `packaging-docs-ci`'s to finalize; this spec uses bin `feature-forge` so the package is npx-runnable today.
```
