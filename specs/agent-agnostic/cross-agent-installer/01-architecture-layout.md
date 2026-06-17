# 01 — Architecture & Layout

> Feature: `cross-agent-installer` (epic `agent-agnostic`, member 4 of 6). Target repo:
> **feature-forge** (`/home/gary/workspace/feature-forge`). Source of truth: `PRD.md` (v2) +
> `tech-spec.md` (v1). This document fixes the on-disk structure of the installer package, its
> manifest/build config, its module export map, and the two feature-forge files it extends
> (`scripts/validate.sh`, `.gitignore`). Shared types come from `00-core-definitions.md`.
>
> The installer is **feature-forge's first-ever Node package** (verified: zero `package.json`/`*.ts`/
> `*.js`/`tsconfig*.json` anywhere in the tree). It is self-contained under `installer/` with **zero
> runtime dependencies** (only `node:` built-ins), compiled by `tsc`, tested with `node:test`, and
> reached through the single `bash scripts/validate.sh` gate.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-DIST-01 | npx-style, zero-config, no checkout/build by user | §2 `package.json` (bin, `files`), §5 npm bundling |
| REQ-DIST-03 | Single discoverable CLI surface | §4 exports (`cli.ts` entry) |
| REQ-SCALE-01 | New agent = one table row | §3 module map (`agent-targets.ts`) |
| REQ-SCALE-02 | New skill = no installer change | §5 (bundle copied verbatim) |
| C-2 | Verify via feature-forge `validate.sh` (build+test installer) | §6 validate.sh step 8 |
| C-4 | Node toolchain auto-provisioned in the gate | §6 (`npm ci` in step 8), §2 devDeps |
| (tech D3/D7) | `installer/` subdir; npm bundles `dist`+`adapters` | §1 tree, §2, §5 |

## 1. Directory tree

All paths relative to the **feature-forge** repo root. **NEW** unless noted.

```
feature-forge/
├── installer/                         — NEW Node package (exposed: cross-agent-installer-cli)
│   ├── package.json                   — name + bin; files:["dist","adapters"]; engines.node>=18; zero deps
│   ├── tsconfig.json                  — strict; target ES2022; module NodeNext; outDir dist; declaration
│   ├── adapters/                      — packaged copy of repo ../adapters (D7); in the published tarball ONLY (gitignored)
│   ├── src/
│   │   ├── cli.ts                     — entry: parseArgs, subcommand dispatch, --help/--version (§07)
│   │   ├── agent-targets.ts           — exposed: agent-detection-map (AGENT_TARGETS + detect*) (§02)
│   │   ├── detect.ts                  — config-dir probe + optional CLI-on-PATH (§02)
│   │   ├── source.ts                  — locate adapters/<agent>/ (packaged|../adapters|--source) + integrity (§03)
│   │   ├── hash.ts                    — sha256 file/tree hashing via node:crypto (§03)
│   │   ├── plan.ts                    — pure planner → PlannedAction (dry-run engine) (§04)
│   │   ├── apply.ts                   — execute a plan: copy/symlink/remove (§04)
│   │   ├── fsutil.ts                  — sandboxed copy/symlink/rm (path.resolve + containment) (§04)
│   │   ├── manifest.ts                — read/write .feature-forge.<scope>.json; sha256 inventory (§05)
│   │   ├── rauf.ts                    — RAUF_PIN constant + resolvability preflight (§06)
│   │   ├── report.ts                  — per-agent/per-skill summary + --json (§07)
│   │   ├── index.ts                   — library barrel: re-exports the agent-detection-map surface (§4)
│   │   └── types.ts                   — all shared types/constants from 00-core-definitions.md
│   └── test/                          — node:test suites + fixtures (fake adapters tree + sandboxed HOME) (§08)
├── scripts/validate.sh                — EXTENDED: new hard step "8. Installer build + test" (§6)
├── .gitignore                         — EXTENDED: installer/node_modules/, installer/dist/, installer/adapters/ (§7)
├── adapters/                          — UNCHANGED, consumed read-only (C-3)
└── AGENTS.md / README.md              — UNCHANGED here (install-section rewrite is packaging-docs-ci)
```

## 2. Package manifest & build config

### `installer/package.json`

```jsonc
{
  "name": "feature-forge",                  // working coordinate; final name finalized by packaging-docs-ci (OQ-D)
  "version": "0.1.0",                        // installer's own version (NOT the bundle/feature-forge version)
  "type": "module",
  "bin": { "feature-forge": "dist/cli.js" }, // npx-runnable bin (REQ-DIST-01)
  "exports": {                              // library surface (agent-detection-map) for importers
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }
  },
  "files": ["dist", "adapters"],            // tarball payload: compiled JS + bundled adapters copy (D3/D7)
  "engines": { "node": ">=18" },            // plain Node ≥ 18 (REQ-DIST-01; not Bun)
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "node --test"                   // built-in node:test runner (zero dep)
  },
  "dependencies": {},                        // ZERO runtime deps (node: built-ins only)
  "devDependencies": {
    "typescript": "^5.4.0",
    "@types/node": "^20.0.0"
  }
}
```

> **Why `node --test` not a framework.** REQ-DIST-01/Constraints favor zero deps; Node's built-in
> test runner needs no vitest/jest. The gate (`npm ci`) provisions only `typescript` + `@types/node`.

### `installer/tsconfig.json`

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,                     // emit .d.ts so importers get the agent-detection-map types
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

## 3. Module structure & responsibilities

| Module | Responsibility | Spec |
|--------|----------------|------|
| `types.ts` | All shared types/constants (00-core-definitions) | `00` |
| `agent-targets.ts` | `AGENT_TARGETS` + `detectAgent`/`detectAgents` + `resolveRoots` (the exposed surface) | `02` |
| `detect.ts` | config-dir `stat` probe; optional PATH check (internal helper for `agent-targets.ts`) | `02` |
| `source.ts` | locate the agent bundle (packaged / `../adapters` / `--source`); minimal integrity check | `03` |
| `hash.ts` | `sha256File`, `sha256Tree` (canonical sorted-path) via `node:crypto` | `03` |
| `plan.ts` | pure planner: diff source ⇆ dest ⇆ manifest → `PlannedAction` | `04` |
| `apply.ts` | execute a plan: copy/symlink/remove + write manifest | `04` |
| `fsutil.ts` | sandboxed `path.resolve` + containment; copy/symlink/rm primitives | `04` |
| `manifest.ts` | read/write `.feature-forge.<scope>.json`; build/compare inventory | `05` |
| `rauf.ts` | `RAUF_PIN` constant; resolvability preflight; `--skip-rauf` handling | `06` |
| `report.ts` | render human + `--json` run summary | `07` |
| `cli.ts` | arg parse, subcommand dispatch, exit-code mapping, `--help`/`--version` | `07` |
| `index.ts` | library barrel — re-exports the agent-detection-map surface for importers | this doc |

**Internal dependency direction (acyclic):** `cli.ts` → {`plan`,`apply`,`source`,`detect`,`manifest`,
`rauf`,`report`} → {`hash`,`fsutil`,`agent-targets`} → `types`. `plan` is pure (no fs writes); only
`apply`/`manifest`/`fsutil` touch the filesystem; only `rauf` touches the network.

## 4. Public API surface (the two exposed contracts)

The feature exposes exactly two stable surfaces that downstream `forge-rauf-loop-default` and
`packaging-docs-ci` rely on:

1. **`cross-agent-installer-cli`** — the `installer/` package; bin `feature-forge` with subcommands
   `install` (alias `add`), `update`, `uninstall` (alias `remove`), `list` (alias `ls`). Full CLI in
   `07-cli-and-reporting.md`. The published coordinate and final bin name are finalized by
   `packaging-docs-ci` (OQ-D); this feature ships a working, npx-runnable package.

2. **`agent-detection-map`** — `src/agent-targets.ts`, re-exported via `src/index.ts`, consumable two
   ways (REQ-DET-05):
   - **Importable:** `AGENT_TARGETS`, `detectAgent(id, opts?)`, `detectAgents(opts?)`, plus
     `RAUF_PIN` (re-export from `rauf.ts`). Signatures in `02-agent-detection-map.md` / `06`.
   - **Shell:** `feature-forge list --json` — the same data for non-Node consumers and the OS-matrix
     CI dry-runs.

```typescript
// src/index.ts — the library barrel (exact exports)
export {
  AGENT_TARGETS,
  detectAgent,
  detectAgents,
  resolveRoots,
} from "./agent-targets.js";
export { RAUF_PIN } from "./rauf.js";
export type {
  AgentId,
  AgentTarget,
  DetectionResult,
  ResolveOpts,
  Scope,
  Mode,
  InstallManifest,
  PlannedAction,
  RunReport,
} from "./types.js";
```

## 5. Build, bundling & deployment

- **Build:** `npm run build` → `tsc` emits `dist/*.js` + `dist/*.d.ts`. No bundler; Node resolves
  `dist/cli.js` directly.
- **Adapters bundling (D7):** the published npm tarball carries a **copy** of the repo-root
  `adapters/` at `installer/adapters/` (declared in `files`). At publish time this copy is produced
  from `../adapters/`; in-repo dev resolves `../adapters/` directly; tests use `--source <dir>`
  (§03). The dev-time `installer/adapters/` copy is **gitignored** (§7) — it is reproducible and
  only materialized for packaging.
- **Verbatim copy (REQ-SCALE-02):** the installer copies/symlinks whatever skills the bundle
  contains; adding a skill to canon needs **no** installer change.
- **No publish here.** Publishing the installer package (and rauf) is `packaging-docs-ci` (OQ-D, C-7);
  this feature produces a build- and test-clean, npx-runnable package.

## 6. `scripts/validate.sh` extension — hard step 8 (C-2, C-4)

A new **top-level hard step "8. Installer build + test"** is appended **after step 7** (the last
numbered step; the file is **204 lines**, `set -euo pipefail`, with a venv-provisioning precedent at
step 6b). It mirrors the failure-accumulation idiom the file already uses.

> **Source-verified idiom (codebase research):** the actual file uses `ERRORS=$((ERRORS + 1))`
> **with spaces** (the tech-spec §3.9 snippet omitted them — match the file's spaced form). The final
> summary block is at **lines 194–204** (`if [ "$ERRORS" -eq 0 ]; then … "All checks passed!" … else
> "$ERRORS error(s) found."; exit 1; fi`). The new step is inserted **before** that summary block.

```bash
# 8. Installer build + test (C-2/C-4) — TOP-LEVEL hard step. The installer is the
#    feature's deliverable; verification must build and test it through the single gate.
echo ""
echo "Building + testing the cross-agent installer..."
if command -v npm >/dev/null 2>&1; then
  if ( cd "$REPO_ROOT/installer" && npm ci --silent && npm run build --silent && npm test ); then
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

Node/npm absence is a **hard ERROR** (not a pytest-style soft skip): the installer is the deliverable
C-2 requires verifying, and the OS-matrix CI (`packaging-docs-ci`) guarantees Node where this runs.
`REPO_ROOT` is the existing variable validate.sh already resolves for paths.

## 7. `.gitignore` extension

The feature-forge `.gitignore` is **16 lines** (source-verified) and already contains
`.venv-adapters/` and `adapters.tmp-*/` (from `forge-agent-adapters-build`). Append the three
installer entries (currently absent):

```gitignore
# Cross-agent installer (Node package)
installer/node_modules/
installer/dist/
installer/adapters/
```

`installer/adapters/` is the dev-time packaged copy (reproducible from `../adapters/`, materialized
only at publish — §5); `node_modules/` and `dist/` are standard build artifacts.

## Dependencies

- `00-core-definitions.md` — all types/constants imported by every module here.
- Consumes (read-only, C-3): the repo-root `adapters/` tree (`forge-agent-adapters-build`).

## Verification

- [ ] `installer/` exists with `package.json` (bin `feature-forge`, `files:["dist","adapters"]`,
      `engines.node>=18`, empty `dependencies`), `tsconfig.json` (strict, NodeNext, `declaration`),
      `src/` with the 13 modules in §3, and `test/`.
- [ ] `npm ci && npm run build` in `installer/` emits `dist/cli.js` + `dist/*.d.ts`; `node dist/cli.js
      --help` prints the subcommand/flag surface (REQ-DIST-03).
- [ ] `src/index.ts` re-exports exactly the agent-detection-map surface in §4.
- [ ] `scripts/validate.sh` has a step 8 inserted before the line-194 summary, using
      `ERRORS=$((ERRORS + 1))`, that builds+tests the installer and fails the gate on npm absence.
- [ ] `.gitignore` contains the three `installer/` entries; `installer/adapters/`, `dist/`,
      `node_modules/` are not tracked.
- [ ] `bash scripts/validate.sh` runs green end-to-end with the installer present (C-2).
