# 08 — Testing Strategy

> Feature: `cross-agent-installer` (epic `agent-agnostic`, member 4 of 6). Target repo:
> **feature-forge** (`/home/gary/workspace/feature-forge`); specs/backlog/loop driven from **rauf**.
> Source of truth: `PRD.md` (v2, §8 Success Criteria) + `tech-spec.md` (v1, §8 Testing Approach, §3.9
> validate.sh). This document fixes the **test approach for the whole installer** — framework,
> sandboxing/fixtures, the per-area test matrix, coverage targets, and the single `validate.sh` gate.
> Shared types come from `00-core-definitions.md`; module behavior is specified in `02`–`07` and is
> **referenced, not re-specified** here. This is the **last numbered doc**.
>
> **Stack:** TypeScript, strict (`strict: true`, `noUncheckedIndexedAccess: true`), **zero runtime
> dependencies**. Tests use the **built-in `node:test` runner** (`node --test`) with assertions from
> `node:assert/strict` — no vitest/jest, no extra deps. All code below is exact TypeScript, not
> pseudocode. Named exports for every test helper; JSDoc on fixtures.

## Requirement Coverage

The primary requirement of this doc is **C-2** (verification runs through feature-forge
`bash scripts/validate.sh`, extended to build + test the installer). Every *behavioral* REQ is
exercised by at least one test; the table maps each to the test area that proves it. The behavior
itself is specified in `02`–`07` — this doc fixes how it is verified.

| REQ ID | Requirement | Test area (this doc) |
|--------|-------------|----------------------|
| **C-2** | Verify via feature-forge `validate.sh` (build + test installer) | §9 The gate |
| REQ-DET-01 | Per-agent detection map (5 agents) | §5.1 Detection |
| REQ-DET-02 | Config-dir presence is the primary signal | §5.1 Detection |
| REQ-DET-03 | No `--agent` ⇒ all detected agents | §5.1 Detection |
| REQ-DET-04 | Zero detected reports probed dirs, no speculative dirs | §5.1 Detection |
| REQ-SCALE-01 | New agent = one `AGENT_TARGETS` row, no logic change | §5.14 Scale: synthetic agent row |
| REQ-SCALE-02 | New skill = no installer change (multi-skill bundle, no per-skill branch) | §5.4 Update reconcile |
| REQ-OPS-01 | install/add materializes the bundle | §5.2 Dry-run = real run, §5.3 Idempotency |
| REQ-OPS-02 | update reconciles (add/refresh/remove) | §5.4 Update reconcile |
| REQ-OPS-03 | uninstall removes a prior install | §5.6 Uninstall exactness, §5.7 Symlink |
| REQ-OPS-04 | list reports detected/installed/up-to-date, no network | §5.13 list status |
| REQ-OPS-05 | --dry-run prints exact plan, writes nothing | §5.2 Dry-run = real run |
| REQ-OPS-06 | Detected-but-missing/invalid source ⇒ reported, no partial, others proceed | §5.8 Source integrity |
| REQ-OPS-07 | Gemini leaves a valid loadable `gemini-extension.json` | §5.9 Gemini outcome |
| REQ-FLAG-01 | `--agent/-a` scoping to one agent | §5.1 Detection |
| REQ-FLAG-02 | `--global/-g` vs project-local destination | §5.1 Detection, §5.2 |
| REQ-FLAG-03 | `--symlink` opt-in; Windows always copies | §5.7 Symlink |
| REQ-FLAG-04 | `--force` overwrites skip-modified | §5.5 Skip-modified + force |
| REQ-IDEM-01 | Re-run no-op ⇒ "up to date", zero writes | §5.3 Idempotency |
| REQ-IDEM-02 | Locally-modified ⇒ skip + report, never clobbered | §5.5 Skip-modified + force |
| REQ-IDEM-03 | Clean out-of-date refreshed by update, no `--force` | §5.4 Update reconcile |
| REQ-SAFE-01 | Manifest-exact uninstall; untracked user files survive | §5.6 Uninstall exactness |
| REQ-SAFE-02 | Symlink uninstall unlinks, never deletes target | §5.7 Symlink |
| REQ-SAFE-03 | Manifest sufficient for list/update drift | §5.13 list status, §5.4 Update reconcile |
| REQ-SEC-01 | Writes only within agent dirs + manifest loc; no elevation | §5.2 Dry-run = real run, §5.8 Source integrity |
| REQ-SEC-02 | Path sandbox: crafted id / `..` rejected before any write | §5.11 Path sandbox |
| REQ-SEC-03 | Symlink ops never write/delete outside the target | §5.7 Symlink |
| REQ-OBS-01 | Per-agent/per-skill outcome summary; non-zero exit on failure | §5.12 Exit codes, §5.2 |
| REQ-OBS-03 | Partial failure: one agent fails, others proceed, non-zero exit | §5.8 Source integrity |
| REQ-RAUF-01 | Working loop out of the box (pin recorded/resolvable) | §5.10 Rauf preflight |
| REQ-RAUF-02 | rauf via the Node ecosystem (resolvability preflight, no vendored bin) | §5.10 Rauf preflight |
| REQ-RAUF-03 | Pinned `rauf@<pin>` coordinate recorded | §5.10 Rauf preflight |
| REQ-RAUF-04 | rauf bundling idempotent + reversible (re-run no dup; uninstall clears `raufPin`) | §5.10 Rauf preflight |
| REQ-PERF-01 | detect/dry-run/list instant — no network, no build | §5.13 list status |
| REQ-DIST-02 | `-y` non-interactive | §5.12 Exit codes (run-helper drives `-y`) |
| REQ-DIST-03 | `--help` enumerates subcommands/flags | §5.12 Exit codes |

> Foundation/strategy doc: it **implements** no module behavior. The mapping above asserts that every
> behavioral REQ in `02`–`07` is reachable by a test; the precise behavior under test is owned by the
> cited module spec.

## 1. Goals & non-goals

**Goals.** Prove, through the single `bash scripts/validate.sh` gate (C-2), that:

1. Every public function exported by `02`–`07` has at least one test (§6).
2. Every `FileActionKind` (`create`/`overwrite`/`skip-modified`/`unchanged`/`remove`, `00` §4) is
   produced by at least one test, and every `ErrorCode` (`00` §7) is produced by at least one test.
3. The end-to-end behavioral guarantees in PRD §8 (dry-run = real run, idempotency, skip-modified,
   uninstall exactness, symlink safety, partial failure, gemini outcome, rauf preflight, path
   sandbox) each hold.

**Non-goals.** Network calls to a real npm registry (the rauf `RegistryQuery` is mocked, §3); the
OS-matrix CI that runs the installer across Linux/macOS/Windows (owned by `packaging-docs-ci`, PRD §6
/ C-6); trigger-accuracy / eval suites (also `packaging-docs-ci`); testing rauf's internal adapter
code (out of scope, C-3). Tests run on the host's own OS; Windows-specific copy-fallback behavior is
asserted via a **platform-injection seam** (§5.7), not by requiring a Windows runner.

## 2. Framework & tooling

- **Runner:** Node's built-in **`node:test`** — `npm test` is `node --test` (`01` §2 `package.json`).
  Zero extra dependencies; the gate's `npm ci` provisions only `typescript` + `@types/node`.
- **Assertions:** **`node:assert/strict`** exclusively. No expectation library.
- **Language / execution model.** Test files are TypeScript (`installer/test/*.test.ts`) and import the
  installer's **compiled** modules from `dist/` (e.g. `import { plan } from "../dist/plan.js"`). This
  is consistent with `01`'s build model: `tsconfig.json` has `rootDir: "src"` and `include: ["src"]`,
  so the test dir is **not** compiled by the package build; instead the gate's ordering
  (`npm run build && npm test`, `01` §6) guarantees `dist/` is fresh before `node --test` runs. The
  test files themselves are executed by `node --test`, which natively strips TypeScript types on
  Node ≥ 22.6 (`--experimental-strip-types` is the default from 23.6); for the project's Node ≥ 18
  floor the gate already builds first, and the test glob `node --test "test/*.test.ts"` runs the
  stripped sources. **Chosen approach (single, explicit):** tests import the **built `.js`** from
  `dist/` and are themselves run as `.ts` via the runner's native type-stripping; no loader flag, no
  second tsconfig, no extra dep. If the host Node predates native `.ts` execution, the gate still
  builds `dist/` first and the runner errors loudly rather than silently skipping — failure is a hard
  gate ERROR (§9), never a soft skip.

  > **Why import from `dist/` not `src/`.** The package ships `dist/` (`files:["dist","adapters"]`,
  > `01` §2); testing the emitted artifact tests what users actually run, and keeps the test dir out of
  > the `rootDir: "src"` compile so `npm run build` stays the single deterministic emit (`01` §2/§5).

- **Determinism.** Iteration order everywhere follows `AGENT_IDS` (`00` §1), so report/plan output is
  stable and assertable. Timestamps (`installedAt`/`updatedAt`, `00` §3) are asserted by **shape**
  (parseable ISO-8601), never by value.
- **No global state.** Every test allocates its own sandbox (§3) and removes it in a `finally`; tests
  never share a HOME, a cwd, or a fixture tree, so `node --test`'s concurrency is safe.

## 3. Sandboxing & fixtures (REQ-SEC-02)

**Principle.** No test may touch the real `~`, the real `process.cwd()`, or the network. Every test
drives the installer through the injectable seams the modules already expose:

- `resolveRoots({ home, cwd, scope })` (`00` §2 `ResolveOpts`; defined in `02-agent-detection-map.md`)
  — pointed at a **temp HOME** (`fs.mkdtemp` under `os.tmpdir()`) and a **temp cwd**, so detection and
  every derived destination land inside the sandbox.
- `--source <dir>` (`00` §8 `CliFlags.source`; resolved in `03-source-and-hashing.md`) — pointed at
  a **fixture adapters tree**, so the installer never reads the repo's real `adapters/`.
- The injectable `RegistryQuery` (§3.3 below; defined in `06-rauf-provisioning.md`) — a mock, so the
  rauf preflight never hits the network.

### 3.1 The sandbox fixture — `withSandbox`

A single helper allocates a disposable HOME + project cwd + adapters-source root, runs the test body
against them, and tears the whole tree down. It returns the resolved roots so the test can both drive
the installer and assert on-disk results.

```typescript
// test/helpers/sandbox.ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentId, ResolveOpts, Scope } from "../../dist/types.js";

/** The disposable roots a single test operates within. All absolute, all under os.tmpdir(). */
export interface Sandbox {
  /** Temp HOME — stands in for `~`; global-scope destinations resolve under here. */
  readonly home: string;
  /** Temp project dir — stands in for `process.cwd()`; project-scope destinations resolve here. */
  readonly cwd: string;
  /** Temp adapters source root — passed to the installer as `--source <dir>` / `source` flag. */
  readonly source: string;
  /** Build a ResolveOpts bound to this sandbox (never the real ~ ). */
  resolve(scope?: Scope): ResolveOpts;
}

/**
 * Allocate a fresh {@link Sandbox}, run `fn` against it, and remove the whole tree afterwards
 * (even on throw). No real `~`, cwd, or network is touched (REQ-SEC-02). Each call is independent
 * so `node --test` may run suites concurrently.
 *
 * @example
 * await withSandbox(async (sb) => {
 *   await makeFixtureBundle(sb, "claude");
 *   const res = await runInstall(["install", "-a", "claude", "--source", sb.source], sb);
 *   assert.equal(res.exitCode, 0);
 * });
 */
export async function withSandbox(fn: (sb: Sandbox) => Promise<void>): Promise<void> {
  const base = await mkdtemp(join(tmpdir(), "ffi-test-"));
  const home = join(base, "home");
  const cwd = join(base, "project");
  const source = join(base, "adapters");
  const sb: Sandbox = {
    home,
    cwd,
    source,
    resolve: (scope: Scope = "project"): ResolveOpts => ({ home, cwd, scope }),
  };
  try {
    await fn(sb);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}
```

> The helper makes only `base`; the agent config dirs (`<home>/.claude` …) are created **by the test**
> (via `seedConfigDir`, below) so that "agent detected" vs "not detected" is explicit per test —
> the installer itself must **never** create a config dir speculatively (REQ-DET-04, asserted in §5.1).

```typescript
// test/helpers/sandbox.ts (cont.)
import { mkdir } from "node:fs/promises";
import { AGENT_TARGETS } from "../../dist/agent-targets.js";

/**
 * Create an agent's config dir inside the sandbox so detection (REQ-DET-02) sees it as installed.
 * For project scope the dir is created under `cwd`; for global under `home`.
 * @returns the absolute config-dir path created.
 */
export async function seedConfigDir(
  sb: Sandbox,
  agent: AgentId,
  scope: Scope = "project",
): Promise<string> {
  const root = scope === "global" ? sb.home : sb.cwd;
  const dir = join(root, AGENT_TARGETS[agent].configDirName);
  await mkdir(dir, { recursive: true });
  return dir;
}
```

### 3.2 The fixture-bundle factory — `makeFixtureBundle`

Tests need a **minimal valid bundle** under the sandbox `source` so the integrity check
(`03`, `00` §6 `BUNDLE_REQUIRED_PATHS`) passes without copying the real (large) `adapters/` tree. The
factory writes exactly the required shape: a non-empty `skills/<name>/`, `scripts/forge-root.sh`, and
— for gemini only — a valid `gemini-extension.json` at the bundle root (matching ground truth verified
in `00` §6 / tech-spec §6).

```typescript
// test/helpers/fixtures.ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentId } from "../../dist/types.js";
import type { Sandbox } from "./sandbox.js";

/** What was materialized, so tests can mutate/inspect individual files deterministically. */
export interface FixtureBundle {
  /** Absolute path of the bundle root: `<sb.source>/<agent>`. */
  readonly dir: string;
  /** The skill ids written (default: one skill "forge-1-prd"). */
  readonly skills: string[];
}

/**
 * Materialize a **minimal valid** `<source>/<agent>/` bundle that passes the integrity check
 * (skills/ non-empty + scripts/forge-root.sh [+ gemini-extension.json for gemini]).
 * Mirrors the verified ground-truth shape of the real adapters bundles (00 §6) at minimal size.
 *
 * @param sb     the sandbox whose `source` root receives the bundle
 * @param agent  which agent bundle to write
 * @param skills skill ids to include (default ["forge-1-prd"]); each becomes skills/<id>/SKILL.md
 * @example
 *   const fx = await makeFixtureBundle(sb, "gemini", ["forge-1-prd", "forge-2-tech"]);
 */
export async function makeFixtureBundle(
  sb: Sandbox,
  agent: AgentId,
  skills: string[] = ["forge-1-prd"],
): Promise<FixtureBundle> {
  const dir = join(sb.source, agent);
  await mkdir(join(dir, "scripts"), { recursive: true });
  await writeFile(join(dir, "scripts", "forge-root.sh"), "#!/usr/bin/env bash\n# fixture\n");
  for (const id of skills) {
    await mkdir(join(dir, "skills", id), { recursive: true });
    await writeFile(join(dir, "skills", id, "SKILL.md"), `# ${id}\nfixture skill body\n`);
  }
  if (agent === "gemini") {
    const ext = { name: "feature-forge", version: "0.0.0", skills: skills.map((name) => ({ name })) };
    await writeFile(join(dir, "gemini-extension.json"), JSON.stringify(ext, null, 2) + "\n");
  }
  return { dir, skills };
}
```

### 3.3 The injectable rauf registry (REQ-RAUF-01..03)

The rauf preflight (`06-rauf-provisioning.md`, tech-spec §3.1) performs a **read-only** registry query
(`npm view rauf@<pin> version`) — the **one** place the installer touches the network. `06` exposes the
query as an **injectable `RegistryQuery`** so tests substitute a mock with **no network**:

```typescript
// test/helpers/registry.ts
// RegistryQuery is the SYNCHRONOUS Result-returning seam owned by 06-rauf-provisioning.md
// (`(coordinate: string) => Result<string>`, backed by spawnSync `npm view`). Import the real
// type from the built module — do NOT redeclare it here (it must match 06 exactly).
import type { RegistryQuery } from "../../dist/rauf.js";
import { ok, err } from "../../dist/types.js";

/** Resolves the pin (REQ-RAUF preflight success). */
export const resolvableRegistry: RegistryQuery = () => ok("0.6.0");
/** Fails to resolve (the IR-2 / unpublished-rauf case, tech-spec §3.1 unavailable-pin failure mode). */
export const unresolvableRegistry: RegistryQuery = () =>
  err({ code: "RAUF_UNRESOLVABLE", message: "stub: not resolvable", remedy: "stub" });
/** Asserts it is never called (used for --skip-rauf and for list/dry-run no-network proofs). */
export const neverCalledRegistry: RegistryQuery = () => {
  throw new Error("registry must not be queried in this path");
};
```

These three (`resolvable`, `unresolvable`, `neverCalled`) are the only registry behaviors any test
uses; each conforms to 06's synchronous `RegistryQuery = (coordinate) => Result<string>`. No real
`npm view` runs in the suite.

### 3.4 The run helper — driving a full subcommand

End-to-end tests invoke the installer the way the CLI does, but with the sandbox + mock registry
injected. The installer exposes a single programmatic entry (`runCli` in `07-cli-and-reporting.md`)
that accepts an injected environment so `cli.ts`'s `main()` stays a thin `process.argv` wrapper.

```typescript
// test/helpers/run.ts
import { runCli } from "../../dist/cli.js"; // signature fixed in 07-cli-and-reporting.md
import type { RunReport } from "../../dist/types.js";
import type { Sandbox } from "./sandbox.js";
import type { RegistryQuery } from "../../dist/rauf.js";
import { resolvableRegistry } from "./registry.js";

/**
 * Run a full subcommand against a sandbox with an injected (mock) registry. Returns the structured
 * {@link RunReport} (00 §5) — `exitCode`, per-agent `actions`, errors — so tests assert on data, not
 * captured stdout. `argv` is the post-`node` argument list, e.g. ["install","-a","claude","--source",sb.source].
 *
 * @param platform override `process.platform` for the Windows copy-fallback test (default: host).
 */
export async function runCli2(
  argv: string[],
  sb: Sandbox,
  opts: { registry?: RegistryQuery; platform?: NodeJS.Platform } = {},
): Promise<RunReport> {
  return runCli(argv, {
    home: sb.home,
    cwd: sb.cwd,
    registry: opts.registry ?? resolvableRegistry,
    platform: opts.platform ?? process.platform,
  });
}
```

> `runCli`'s injectable `{ home, cwd, registry, platform }` environment is the contract this test
> strategy **requires** of `07-cli-and-reporting.md` and `06-rauf-provisioning.md`. If those docs name
> the entry or option keys differently, the test helper adapts — but the **seams** (home/cwd injection,
> mock registry, platform override) must exist or the matrix below cannot run hermetically.

## 4. Unit vs integration approach

Two tiers, both under `node:test`, both hermetic via §3:

- **Unit (pure-module) tests** target a single module's public functions directly with no full-CLI
  dispatch — e.g. `plan(...)` (`04`), `sha256Tree(...)` (`03`), `detectAgents(...)` (`02`),
  `resolveWithin(...)` containment (`04`/`fsutil`), `readManifest`/`writeManifest` (`05`),
  `preflightRauf(...)` with a mock registry (`06`). These give the coverage targets in §6 their
  per-function floor and pin error codes precisely.
- **Integration (end-to-end subcommand) tests** drive `runCli2(...)` (§3.4) through a real plan→apply→
  manifest cycle against the sandbox FS, asserting the on-disk result and the `RunReport`. These prove
  the cross-module guarantees (dry-run = real run, idempotency, uninstall exactness).

Every matrix area in §5 names which tier(s) it uses.

## 5. The test matrix

One subsection per area, each naming the REQ(s) and the concrete assertion. Areas mirror tech-spec §8.

### 5.1 Detection (REQ-DET-01/02/03/04, REQ-FLAG-01/02)

*Tier:* unit (`detectAgents`/`detectAgent` from `02`) + integration (default-scope dispatch).

- **DET-01 — all five agents present in the map.** `assert.deepEqual(Object.keys(AGENT_TARGETS).sort(),
  ["claude","codex","copilot","cursor","gemini"])`; each row has the `configDirName`/`installSubdir`
  from `00` §6.
- **DET-02 — config-dir presence is the signal.** `seedConfigDir(sb,"claude")` then
  `detectAgents(sb.resolve())` ⇒ the claude row has `detected: true`; an un-seeded agent has
  `detected: false`. Detection performs only a `stat` (no subprocess) — asserted by the absence of any
  child-process seam in `02` (documented expectation; no `child_process` import in `detect.ts`).
- **DET-03 — default scope = all detected.** Seed `claude` + `gemini`; `runCli2(["install","--source",
  sb.source], sb)` (no `--agent`) ⇒ `report.agents` contains exactly the two detected agents acted on.
- **DET-04 — zero detected.** Seed nothing; `runCli2(["install","--source",sb.source], sb)` ⇒ each
  agent's `DetectionResult.detected === false`, `configDirsProbed` is non-empty and names the probed
  dirs, and **no config dir was created** (`assert` the sandbox HOME/cwd contain no `.<agent>` dir).
  Exit is `EXIT.SUCCESS` (nothing to do is not a failure) with a clear "no agents detected" report.
- **FLAG-01 — `--agent` scoping.** Seed `claude`+`codex`; `["install","-a","claude",…]` ⇒
  `report.agents` is exactly `["claude"]`. An unknown id `["install","-a","bogus"]` ⇒
  `EXIT.USAGE` / `ErrorCode "USAGE"` (§5.12).
- **FLAG-02 — global vs project destination.** `detectAgent("claude", sb.resolve("global"))` resolves
  under `home/.claude/skills/feature-forge`; `sb.resolve("project")` resolves under
  `cwd/.claude/skills/feature-forge`. Asserts the destination string ends with the scope-correct path.

### 5.2 Dry-run = real run (REQ-OPS-05, REQ-OPS-01, REQ-OBS-01)

*Tier:* integration.

- Seed `claude`, `makeFixtureBundle(sb,"claude")`.
- Capture `planReport = runCli2(["install","-a","claude","--dry-run","--source",sb.source], sb)`.
- Snapshot the destination tree (recursive listing) **before** and after the dry-run; assert **byte-
  identical** — `--dry-run` wrote nothing.
- Run for real: `realReport = runCli2(["install","-a","claude","--source",sb.source], sb)`.
- Assert `planReport.agents[0].actions` deep-equals `realReport.agents[0].actions` (the *same* plan was
  executed) — the canonical "dry-run prints exactly what a real run does" guarantee (PRD §8). The
  worked example in §8 implements this assertion verbatim.
- Assert every planned `create` produced a real file on disk after the real run, and the per-agent
  summary (`AgentReport.actions`) lists each skill file (REQ-OBS-01).
- **SEC-01 — positive containment (REQ-SEC-01).** After the real run, assert **nothing** was written
  outside the agent's config root: every created path lies under `<scopeRoot>/.claude/skills/` (the
  namespace dir) or is the parent-sibling manifest; assert the sandbox HOME/cwd contain no file
  outside those locations and no elevation occurred (distinct from §5.11's negative path-escape test).

### 5.3 Idempotency (REQ-IDEM-01, REQ-OPS-01)

*Tier:* integration.

- Install once (real). Snapshot the destination tree + manifest `updatedAt`.
- Install again. Assert: every `FileAction.action === "unchanged"`; the destination tree is byte-
  identical to the snapshot; the report renders "up to date"; **zero writes** occurred (manifest
  `updatedAt` unchanged because no file changed). Exit `EXIT.SUCCESS`.

### 5.4 Update reconcile — add / change / remove (REQ-OPS-02, REQ-IDEM-03)

*Tier:* integration.

- Install a fixture bundle with skills `["a"]`. Then mutate the **source** fixture:
  - **add** skill `b` (`makeFixtureBundle` with `["a","b"]`) ⇒ `update` (no `--force`) yields a
    `create` for `b`'s files; `b` exists on disk; manifest `skills` now `["a","b"]`.
  - **change** skill `a`'s `SKILL.md` body ⇒ `update` yields `overwrite` for that file; the new bytes
    are on disk; manifest `files[].sha256` for it updated.
  - **remove** skill `a` from source ⇒ `update` yields `remove` for `a`'s files; `a` is gone from disk;
    manifest no longer lists it. **Orphan removal is manifest-scoped** — assert a sibling untracked
    file placed inside the namespace dir is **not** removed.
- **IDEM-03 — clean out-of-date refreshes without `--force`.** After a source change, a clean prior
  install (matching the manifest before the change) is refreshed by `update` with no `--force` flag.
- **SCALE-02 — multi-skill bundle, no per-skill branch (REQ-SCALE-02).** Install a fixture bundle with
  several skills (`makeFixtureBundle(sb, "claude", ["a","b","c"])`) and assert **all** skill dirs land
  on disk and appear in `manifest.skills` — proving the installer copies whatever skills the bundle
  contains with no per-skill logic (a new skill needs no installer change). No skill file is parsed.
- **SAFE-03 — manifest sufficient for update drift (REQ-SAFE-03).** Assert the post-install manifest
  carries `sourceHash`, per-file `sha256`, and `mode` — exactly the fields `update` uses to classify
  `unchanged`/`overwrite`/`skip-modified` here (and `list` uses in §5.13). The reconcile sub-tests
  above already exercise that those fields drive the diff; this bullet pins the sufficiency contract.

### 5.5 Skip-modified + `--force` (REQ-IDEM-02, REQ-FLAG-04)

*Tier:* integration.

- Install (real). Hand-edit a destination file so its bytes differ from both the recorded hash and the
  current source bytes (a genuine local modification).
- `update` (no `--force`) ⇒ that file's action is `skip-modified`; the on-disk bytes are **unchanged**
  (the user's edit survives); the report names the file with remedy "re-run with --force"
  (`ErrorCode "LOCALLY_MODIFIED"` surfaced per REQ-OBS-02).
- `update --force` ⇒ the file's action is `overwrite`; the on-disk bytes now match source; manifest
  hash updated. Confirms `--force` is the only path that clobbers a local modification.

### 5.6 Uninstall exactness — untracked user file survives (REQ-SAFE-01, REQ-OPS-03)

*Tier:* integration.

- Install (real). Seed an **unrelated user file** in the skills root *outside* the `feature-forge/`
  namespace dir (e.g. `<dest>/../my-own-skill/SKILL.md`) **and** an untracked file *inside* the
  namespace dir.
- `uninstall` ⇒ removes exactly the manifest-recorded files + the namespace dir + the manifest file
  itself; the **unrelated user file outside the namespace survives**. Assert the untracked-inside file:
  per `05`/`04`, uninstall removes the recorded inventory then the now-(or-still-)present namespace
  dir; the test asserts the documented behavior from `05-manifest-and-uninstall.md` (manifest-recorded set removed,
  user content outside the manifest never touched) and that the manifest file is gone.
- Re-running `uninstall` on an already-removed install is a no-op with `EXIT.SUCCESS` (idempotent
  uninstall).

### 5.7 Symlink — link + uninstall unlinks, target intact, manifest parent-sibling (REQ-FLAG-03, REQ-SAFE-02, REQ-SEC-03)

*Tier:* integration.

- `runCli2(["install","-a","claude","--symlink","--source",sb.source], sb)` on a non-Windows host ⇒
  the namespace dir is a **symlink** (`lstat(dest).isSymbolicLink()`) whose target is the source
  bundle; the manifest is the **parent-sibling** hidden file
  (`<skillsRoot>/.feature-forge.<scope>.json`), `mode: "symlink"`, with `link.target` set and per-file
  `sha256` omitted (`00` §3).
- **SAFE-02/SEC-03 — uninstall unlinks, target intact.** `uninstall` ⇒ `lstat` shows the link is gone;
  the **source bundle is byte-for-byte intact** (assert source files still present + unchanged). The
  test confirms uninstall used `lstat`+`unlink` (never recursed through the link): the source tree's
  mtimes/contents are unchanged.
- **FLAG-03 — Windows always copies.** `runCli2([...,"--symlink",...], sb, { platform: "win32" })` ⇒
  the namespace dir is a **real directory** (not a symlink), `mode: "copy"` in the manifest — proving
  the Windows copy fallback via the injected `platform` seam (no Windows runner needed).

### 5.8 Source integrity / partial failure (REQ-OPS-06, REQ-OBS-03)

*Tier:* integration.

- Seed **two** detected agents (`claude`, `gemini`). Make `claude`'s source **valid**
  (`makeFixtureBundle`), but make `gemini`'s source **invalid** in three independent sub-tests:
  (a) bundle dir absent entirely (`SOURCE_MISSING`); (b) present but empty `skills/`
  (`SOURCE_INVALID`); (c) gemini present but missing `gemini-extension.json` (`SOURCE_INVALID`, the
  per-agent extra in `00` §6 `BUNDLE_REQUIRED_PATHS.perAgent.gemini`).
- Assert: gemini's `AgentReport.ok === false` with the right `ErrorCode`, naming the agent and the
  **expected source path**; **no partial install** for gemini (its destination has no namespace dir);
  **claude succeeded** (its `AgentReport.ok === true`, files on disk); overall
  `report.exitCode === EXIT.FAILURE` (non-zero because one agent failed) — the per-agent partial-
  failure rule (REQ-OBS-03).

### 5.9 Gemini outcome — valid `gemini-extension.json` at dest (REQ-OPS-07)

*Tier:* integration.

- Seed `gemini`, `makeFixtureBundle(sb,"gemini")`, install (real).
- Assert `<dest>/gemini-extension.json` exists and `JSON.parse(readFileSync(...))` succeeds and has the
  expected shape (`name`, `version`, `skills[]`) — a valid, agent-loadable manifest landed via the
  plain bundle copy (D9). Also assert the symlink variant: with `--symlink` the manifest is reachable
  through the linked namespace dir.

### 5.10 Rauf preflight — three cases (REQ-RAUF-01/02/03)

*Tier:* unit (`preflightRauf` from `06`) + integration (install records `raufPin`).

- **RAUF-resolvable.** `runCli2(["install","-a","claude","--source",sb.source], sb,
  { registry: resolvableRegistry })` ⇒ install succeeds; manifest `raufPin === RAUF_PIN` (e.g.
  `"rauf@0.6.0"`, `06`); the report surfaces the pin (REQ-OBS-01). No real network (mock only).
- **RAUF-unresolvable.** Same with `unresolvableRegistry` ⇒ the preflight fails with `ErrorCode
  "RAUF_UNRESOLVABLE"` and the **fixed** failure text (tech-spec §3.1 — "pinned default loop runner
  `rauf@<pin>` is not resolvable …"); **skills are still installed** (the namespace dir + manifest
  exist); overall exit is **non-zero** (`EXIT.FAILURE`). Asserts the installer **never** falls back to
  a vendored binary (no extra files written) and **never** silently degrades.
- **RAUF-skip.** `runCli2(["install","-a","claude","--skip-rauf","--source",sb.source], sb,
  { registry: neverCalledRegistry })` ⇒ manifest `raufPin === null`; the registry mock is **never
  called** (no network); install succeeds, exit `EXIT.SUCCESS`.
- **RAUF-04 — idempotent + reversible (REQ-RAUF-04).** Re-run install with `resolvableRegistry`: the
  manifest still records exactly one `raufPin` (no duplicated rauf state — provisioning is record +
  preflight, never a write, `06` §5). Then `uninstall` and assert the manifest is gone, so the recorded
  `raufPin` is cleared with it (the reversibility half — there is no rauf binary/dir to clean up).

### 5.11 Path sandbox — crafted id / `..` rejected before any write (REQ-SEC-02)

*Tier:* unit (the containment guard in `fsutil`/`04`).

- Call the destination resolver/containment guard (`resolveWithin`, `04` §7.1 `fsutil`) with a
  crafted agent id or a relative segment that would escape the agent root (e.g. an `installSubdir`
  containing `../../etc`, or a skill relpath `../../../evil`). Assert it returns
  `err({ code: "PATH_ESCAPE" })` (`00` §7) — **before** any filesystem write. After the call, assert
  the sandbox tree is unchanged (no file created outside the intended root). Confirms a malformed path
  cannot escape the target tree (REQ-SEC-02).

### 5.12 Exit codes 0 / 1 / 2 + help + non-interactive (REQ-OBS-01, REQ-DIST-03, REQ-DIST-02)

*Tier:* integration.

- **0** — a successful `install`/`list` returns `EXIT.SUCCESS`.
- **1** — any per-agent operational failure (e.g. §5.8 invalid source, §5.10 unresolvable rauf)
  returns `EXIT.FAILURE`.
- **2** — an unknown subcommand (`["frobnicate"]`), unknown flag (`["install","--nope"]`), or unknown
  agent (`["install","-a","bogus"]`) returns `EXIT.USAGE` with `ErrorCode "USAGE"`.
- **`--help`** — `runCli2(["--help"], sb)` produces output naming every subcommand
  (`install`/`add`/`update`/`uninstall`/`remove`/`list`/`ls`) and every flag (`-a`,`-g`,`--symlink`,
  `--force`,`--dry-run`,`-y`,`--json`,`--skip-rauf`), exit `EXIT.SUCCESS` (REQ-DIST-03).
- **`-y`** — every mutating test in this matrix drives `-y` (or its default-confirmed behavior) so the
  suite is non-interactive; a test asserts that with `-y` no prompt is awaited (the run completes
  without an input seam) (REQ-DIST-02).

### 5.13 `list` status derivation + no network (REQ-OPS-04, REQ-PERF-01)

*Tier:* integration.

- **Not installed:** seed `claude` config dir only ⇒ `list --json` reports `detected: true`,
  installed `false`.
- **Installed + up to date:** after a clean install ⇒ `detected: true`, installed `true`, up-to-date
  `true` (manifest `sourceHash` matches the current bundle).
- **Installed + out of date:** mutate the source after install ⇒ up-to-date `false`.
- **Drift present:** hand-edit a destination file ⇒ `list` flags drift (a `skip-modified` would occur).
- **No network / instant (REQ-PERF-01):** run `list` with `neverCalledRegistry` injected and assert
  the registry mock is **never invoked** — `list` does detection + manifest read + hash compare only,
  no network, no build.
- **SAFE-03 (list half) — manifest sufficiency (REQ-SAFE-03).** The "up to date" / "out of date" /
  "drift" derivations above read **only** the manifest (`sourceHash`, per-file `sha256`) against a
  fresh local hash — proving the manifest alone is sufficient for `list` to distinguish
  installer-written content from user content and to detect drift (pairs with §5.4's update half).

### 5.14 Scale: a synthetic agent row drives the pipeline (REQ-SCALE-01)

*Tier:* unit (`detectAgents`/`plan` over an injected `AGENT_TARGETS` row).

- Add a synthetic sixth row to a **local copy** of `AGENT_TARGETS` (and its `AgentId` to a local
  `AGENT_IDS`) and drive it through `detectAgents` + `destinationFor` + `plan` against a fixture
  bundle — assert detection, destination derivation, and planning all cover it with **no edit** to any
  function (REQ-SCALE-01: a new agent is exactly one table row, no logic change). This is the test-side
  proof of the `02` §5.6 scalability invariant.

## 6. Coverage targets

The bar (asserted structurally, not by a coverage tool — zero deps):

- **Every public function** exported by `02`–`07` has **≥ 1 test.** Concretely: `detectAgent`,
  `detectAgents`, `resolveRoots`, `destinationFor`, `formatZeroDetection` (`02`); `locateBundle`,
  `checkIntegrity`, `locateSource`, `sha256File`, `sha256Tree`, `computeSourceHash`,
  `listBundleSkills`, `listBundleFiles` (`03`); `plan`, `planInstall`, `planUpdate`, `apply`,
  `resolveWithin` (`04`); `manifestPath`, `readManifest`, `writeManifest`, `buildManifest`,
  `validateManifest`, `planUninstall` (`05`); `preflightRauf`, `RAUF_PIN` (`06`); `parseCliArgs`,
  `runCli`, `main`, `helpText`, `renderReport(report, { json })` (`07`). A checklist test
  (`coverage.test.ts`) may assert each named export is defined and reachable.
- **Every `FileActionKind`** (`create`, `overwrite`, `skip-modified`, `unchanged`, `remove`; `00` §4)
  is produced by at least one test — covered across §5.2 (`create`), §5.4 (`overwrite`,`remove`), §5.5
  (`skip-modified`), §5.3 (`unchanged`).
- **Every `ErrorCode`** (`00` §7) is produced by at least one test: `USAGE` (§5.12), `SOURCE_MISSING`
  + `SOURCE_INVALID` (§5.8), `LOCALLY_MODIFIED` (§5.5), `PATH_ESCAPE` (§5.11), `RAUF_UNRESOLVABLE`
  (§5.10), `MANIFEST_CORRUPT` (a `05` unit test feeds malformed JSON), `WRITE_DENIED` (a `04` unit test
  injects a write primitive that throws `EACCES`/`EPERM` — mirroring the `UNEXPECTED` throwing-seam —
  so `toWriteError` maps it to `WRITE_DENIED` **deterministically on every platform**; an additional,
  platform-gated `chmod` read-only-dir test exercises the real OS path where supported. The floor is
  therefore met **unconditionally**, with no soft skip — consistent with §2/§9's "never soft skip"),
  `UNEXPECTED` (a `cli.ts` boundary test injects a throwing seam and asserts exit 1 with the message,
  never a bare stack).
- **Both materialization modes** (`copy`, `symlink`) and **both scopes** (`project`, `global`) are each
  exercised by at least one integration test.

> These are **floors**, not ceilings. The matrix in §5 already meets them; the checklist test exists so
> a future module addition that lacks a test fails the gate loudly.

## 7. Test location & naming conventions

- **Location:** all tests under `installer/test/`. One `*.test.ts` per module/concern, named for the
  module under test: `detect.test.ts`, `agent-targets.test.ts`, `source.test.ts`, `hash.test.ts`,
  `plan.test.ts`, `apply.test.ts`, `manifest.test.ts`, `rauf.test.ts`, `cli.test.ts`,
  `report.test.ts`. End-to-end subcommand suites live in `cli.test.ts` (or
  `e2e-<subcommand>.test.ts`). The coverage checklist is `coverage.test.ts`.
- **Helpers:** non-test support lives in `installer/test/helpers/` (`sandbox.ts`, `fixtures.ts`,
  `registry.ts`, `run.ts`) and is **not** matched by the test glob (helper files do not end in
  `.test.ts`, so `node --test "test/*.test.ts"` ignores them).
- **Run command:** `npm test` ⇒ `node --test` (`01` §2). The package's `test` script targets the
  `test/*.test.ts` glob; helpers are imported, never auto-run.
- **Structure:** each file uses `test(...)` (or `describe`/`it`) from `node:test` and asserts with
  `node:assert/strict`. Every test wraps its body in `withSandbox` so teardown is guaranteed.
- **Imports:** modules under test import from `../dist/*.js` (the built artifact, §2); shared types
  import from `../../dist/types.js`. Helpers import the same way.

## 8. Example test

A complete, runnable `node:test` + `node:assert/strict` test demonstrating the sandbox fixture and the
**dry-run = real run** assertion (REQ-OPS-05). This is real syntax, not pseudocode.

```typescript
// installer/test/cli.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { withSandbox, seedConfigDir } from "./helpers/sandbox.js";
import { makeFixtureBundle } from "./helpers/fixtures.js";
import { runCli2 } from "./helpers/run.js";
import { resolvableRegistry } from "./helpers/registry.js";

/** Recursively list relpath+bytes for a tree, for byte-identical snapshot comparison. */
async function snapshot(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  async function walk(dir: string, prefix: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // dir absent ⇒ empty snapshot (e.g. before any install)
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = join(dir, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(abs, rel);
      else out[rel] = await readFile(abs, "utf8");
    }
  }
  await walk(root, "");
  return out;
}

test("install: --dry-run prints exactly the plan a real run performs, and writes nothing", async () => {
  await withSandbox(async (sb) => {
    // Arrange: a detected claude agent + a minimal valid source bundle, no real ~ touched.
    await seedConfigDir(sb, "claude", "project");
    await makeFixtureBundle(sb, "claude", ["forge-1-prd"]);
    const dest = join(sb.cwd, ".claude", "skills", "feature-forge");

    // Act 1 — dry run.
    const before = await snapshot(dest);
    const dry = await runCli2(
      ["install", "-a", "claude", "--dry-run", "-y", "--source", sb.source],
      sb,
      { registry: resolvableRegistry },
    );
    const afterDry = await snapshot(dest);

    // Assert: dry-run succeeded and changed NOTHING on disk (REQ-OPS-05).
    assert.equal(dry.exitCode, 0);
    assert.deepEqual(afterDry, before, "--dry-run must not write any file");

    // Act 2 — real run.
    const real = await runCli2(
      ["install", "-a", "claude", "-y", "--source", sb.source],
      sb,
      { registry: resolvableRegistry },
    );

    // Assert: the real run executed exactly the plan the dry-run printed (PRD §8).
    assert.equal(real.exitCode, 0);
    const dryActions = dry.agents.find((a) => a.agent === "claude")?.actions ?? [];
    const realActions = real.agents.find((a) => a.agent === "claude")?.actions ?? [];
    assert.deepEqual(realActions, dryActions, "real run actions must equal the dry-run plan");

    // Assert: every planned `create` produced a real file.
    for (const fa of realActions.filter((a) => a.action === "create")) {
      const s = await stat(join(dest, fa.relpath));
      assert.ok(s.isFile(), `${fa.relpath} should exist after the real install`);
    }
  });
});
```

## 9. The gate (C-2) [D4]

The feature's entire verification flows through **`bash scripts/validate.sh`** in feature-forge —
there is **no** rauf `pnpm` gate for this work (C-1/C-2). `01-architecture-layout.md` §6 specifies the
appended **hard step 8** verbatim; this doc fixes the **assertion** that step makes:

```bash
# scripts/validate.sh — step 8 (verbatim from 01 §6); the source-verified file uses
# `ERRORS=$((ERRORS + 1))` (spaced) and a final summary block at lines 194–204.
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

**End-to-end gate assertion (what "green" means for this feature):**

1. `npm ci` provisions `typescript` + `@types/node` (the only devDeps; zero runtime deps, `01` §2),
   so the toolchain is auto-provisioned — no manual setup (C-4).
2. `npm run build` (`tsc`) compiles `src/` → `dist/` cleanly under `strict` +
   `noUncheckedIndexedAccess`; **build ordering is load-bearing** — it runs before `npm test` so the
   tests' `../dist/*.js` imports resolve against a fresh emit (§2).
3. `npm test` (`node --test`) runs the entire `test/*.test.ts` suite — the whole §5 matrix — with **0
   failures**. Because every test is hermetic (§3), the suite passes with no network and touches no
   real `~`.
4. Any of build-fail / test-fail / **npm-absent** ⇒ `ERRORS` increments ⇒ the line-194 summary prints
   `N error(s) found.` and `exit 1` ⇒ the whole gate is red. **npm absence is a hard ERROR**, never a
   pytest-style soft skip (tech-spec §3.9, `01` §6): the installer is the deliverable C-2 must verify,
   and the OS-matrix CI (`packaging-docs-ci`) guarantees Node where this runs.

This makes the installer's tests and toolchain **reachable through the single gate** — the C-2
mandate — so a downstream consumer (`forge-rauf-loop-default`, `packaging-docs-ci`) can rely on
`bash scripts/validate.sh` as the one "is it green?" command for this feature.

## Dependencies

Implement these first; this doc's tests exercise their public surfaces:

- `00-core-definitions.md` — every type/constant the tests import (`AgentId`, `Scope`, `Mode`,
  `PlannedAction`/`FileActionKind`, `InstallManifest`, `DetectionResult`, `RunReport`, `ErrorCode`,
  `EXIT`, `AGENT_TARGETS`, `BUNDLE_REQUIRED_PATHS`).
- `01-architecture-layout.md` — the `package.json` (`test: "node --test"`, devDeps), `tsconfig.json`
  (build → `dist/`), the `test/` dir, and the **validate.sh step 8** this doc's gate asserts.
- `02-agent-detection-map.md` — `detectAgent`/`detectAgents`/`resolveRoots` + the `ResolveOpts` home/cwd
  injection seam (§3.1).
- `03-source-and-hashing.md` — `locateSource` (`--source` seam), `checkIntegrity`, `sha256*`.
- `04-plan-and-apply.md` — `plan` (dry-run engine), `apply`, the `fsutil` containment guard (§5.11).
- `05-manifest-and-uninstall.md` — `manifestPath`, `readManifest`/`writeManifest`, `buildManifest`,
  `planUninstall` (§5.4/§5.6).
- `06-rauf-provisioning.md` — `RAUF_PIN`, `preflightRauf`, and the **injectable `RegistryQuery`** seam
  (§3.3) the mock registry relies on.
- `07-cli-and-reporting.md` — `runCli` (the programmatic entry with the injectable
  `{ home, cwd, registry, platform }` environment, §3.4) and the report renderers.

> **Required seams.** This strategy depends on three injection points existing in `02`/`06`/`07`:
> home+cwd injection (`resolveRoots`/`runCli`), the mock-able `RegistryQuery` (`06`/`runCli`), and a
> `platform` override (`runCli`, §5.7). They are already called for by those docs' designs; if a
> sibling writer names them differently, the helpers in §3 adapt to the actual names — but the seams
> must exist for the suite to run hermetically.

## Verification

An implementation matches this spec iff:

- [ ] `installer/test/` contains `*.test.ts` suites covering every §5 area, plus
      `test/helpers/{sandbox,fixtures,registry,run}.ts`; `npm test` runs `node --test` (`01` §2).
- [ ] Every test runs hermetically: a temp HOME under `os.tmpdir()` via `withSandbox`, a fixture
      bundle via `makeFixtureBundle`, and a **mock** `RegistryQuery` — **no** real `~`, no network.
      (Grep the suite: no `os.homedir()` without injection, no real `npm view`/`child_process` in tests.)
- [ ] Coverage floors hold: every public fn in `02`–`07` has ≥ 1 test; every `FileActionKind` and
      every `ErrorCode` is produced by ≥ 1 test; both modes + both scopes exercised (§6 checklist test
      present and passing).
- [ ] The dry-run = real-run test (§8) asserts byte-identical dest before/after dry-run **and**
      `deepEqual` of dry vs real per-agent actions.
- [ ] `scripts/validate.sh` step 8 builds + tests the installer; the full suite passes with 0 failures
      and `bash scripts/validate.sh` exits 0 end-to-end (C-2).
- [ ] With Node/npm absent, `bash scripts/validate.sh` increments `ERRORS` and exits 1 (hard error,
      not a soft skip).
