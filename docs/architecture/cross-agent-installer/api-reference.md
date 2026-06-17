# API Reference

The package is both a CLI (`feature-forge` bin) and a small importable library. All
signatures below are from the implementation in `feature-forge/installer/src/`.

## CLI

```
feature-forge <subcommand> [flags]
```

### Subcommands

| Subcommand | Alias | Description |
|------------|-------|-------------|
| `install`  | `add`    | Install feature-forge into the target agent(s). |
| `update`   | —        | Reconcile an existing install to the current adapter bundles. |
| `uninstall`| `remove` | Remove a prior install (manifest-tracked files only). |
| `list`     | `ls`     | Report per-agent detected / installed / up-to-date / drifted status. |

### Flags

| Flag | Short | Type | Description |
|------|-------|------|-------------|
| `--agent <id>` | `-a` | string | Scope to one agent (`claude\|codex\|copilot\|cursor\|gemini`). Default: all detected. |
| `--global` | `-g` | bool | Install into the user-level config dir (default: project-local). |
| `--symlink` | — | bool | Symlink the bundle instead of copying (default: copy). |
| `--force` | — | bool | Overwrite a locally-modified destination that would otherwise be skipped. |
| `--dry-run` | — | bool | Print the planned actions without changing anything. |
| `--yes` | `-y` | bool | Non-interactive: assume confirmed; never block on input. |
| `--json` | — | bool | Emit the run report as JSON. |
| `--skip-rauf` | — | bool | Skip the rauf resolvability preflight (records `raufPin: null`). |
| `--help` | `-h` | bool | Show help and exit. |
| `--version` | — | bool | Print the installer version and exit. |

> A hidden `--source <dir>` flag overrides the adapters source directory; it exists for
> the test suite only and is not part of the supported surface.

### Exit codes

| Code | Constant | Meaning |
|------|----------|---------|
| `0` | `EXIT.SUCCESS` | The run succeeded (including "zero agents detected — nothing to do"). |
| `1` | `EXIT.FAILURE` | At least one agent failed, or an operational error occurred. |
| `2` | `EXIT.USAGE` | Invalid arguments (unknown subcommand/flag/agent, missing subcommand). |

## Library

Imported from the package barrel (`import { … } from "feature-forge"`). Named exports
only.

### Agent detection map (spec 02)

```ts
const AGENT_TARGETS: Readonly<Record<AgentId, AgentTarget>>;
// Static per-agent config-dir + install-subdir table; keys === AGENT_IDS.

function resolveRoots(opts?: ResolveOpts): { project: string; global: string };
// Resolve the project-local and user-level config roots.

function destinationFor(id: AgentId, scope: Scope, opts?: ResolveOpts): string;
// The absolute install destination for an agent under a given scope.

function detectAgent(id: AgentId, opts?: ResolveOpts): DetectionResult;
function detectAgents(ids?: readonly AgentId[], opts?: ResolveOpts): DetectionResult[];
// Probe whether an agent (or each agent) is present. Pure w.r.t. the filesystem it reads.

function formatZeroDetection(results: DetectionResult[]): string;
// The human "no agents detected" report (dirs probed), for the SUCCESS-exit zero case.
```

### rauf provisioning (spec 06)

```ts
const RAUF_PIN = "rauf@0.6.0";   // the pinned default loop-runner coordinate
```

### Shared types (spec 00)

```ts
type AgentId = "claude" | "codex" | "copilot" | "cursor" | "gemini";
type Scope   = "project" | "global";
type Mode    = "copy" | "symlink";

const EXIT = { SUCCESS: 0, FAILURE: 1, USAGE: 2 } as const;
const MANIFEST_PREFIX = ".feature-forge." as const;   // manifest = `${MANIFEST_PREFIX}${scope}.json`
const SCHEMA_VERSION  = 1 as const;

interface AgentTarget      { /* configDirName, installSubdir, confidence, … */ }
interface DetectionResult  { /* id, detected, configDirsProbed, … */ }
interface ResolveOpts      { /* cwd / home overrides for resolution + tests */ }
interface InstallManifest  { schemaVersion: 1; /* agent, scope, mode, files[]+sha256, … */ }
interface PlannedAction    { /* kind: add|change|unchanged|remove|skip-modified, path, … */ }
interface RunReport        { /* subcommand, scope, mode, dryRun, agents[], exitCode, raufError? */ }
```

(The exact field sets live in `installer/src/types.ts` — `00-core-definitions.md` is the
spec source of truth for their shape.)

### Manifest location

```
<scopeRoot>/<configDirName>/<installSubdir>/.feature-forge.<scope>.json
# e.g.  ~/.claude/skills/.feature-forge.global.json   (identical path for copy & symlink)
```
