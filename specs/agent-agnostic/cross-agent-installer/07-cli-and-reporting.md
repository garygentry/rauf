# 07 — CLI & Reporting

> Feature: `cross-agent-installer` (epic `agent-agnostic`, member 4 of 6). Target repo:
> **feature-forge** (`/home/gary/workspace/feature-forge`); specs/backlog/loop driven from **rauf**.
> Source of truth: `PRD.md` (v2) + `tech-spec.md` (v1, esp. §5 API design / CLI, §7 error handling).
> This document fixes the installer's **orchestration layer** — `src/cli.ts` (entry, arg parsing,
> subcommand dispatch, exit-code mapping, `--help`/`--version`) and `src/report.ts` (the run reporter:
> human-readable per-agent/per-skill summary + `--json` machine surface).
>
> **Stack:** TypeScript, strict (`strict: true`, `noUncheckedIndexedAccess: true`), **zero runtime
> dependencies** (`node:` built-ins only — `node:util.parseArgs`, `node:process`), compiled with
> `tsc`, tested with `node:test`. Named exports only. Core functions return `Result<T, E>` and never
> throw for expected errors; `cli.ts` is the single boundary that maps `Result`/`RunReport` to exit
> codes (project convention). All code below is exact TypeScript, not pseudocode.
>
> Shared types — `AgentId`, `Subcommand`, `Scope`, `Mode`, `CliFlags`, `EXIT`/`ExitCode`,
> `AgentReport`, `RunReport`, `PlannedAction`, `FileAction`, `InstallerError`/`ErrorCode`,
> `Result`/`ok`/`err`, `AGENT_IDS`, `AGENT_TARGETS` — come from
> [`00-core-definitions.md`](./00-core-definitions.md) and are **not** redefined here.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-DIST-01 | npx-style, zero-config entry — bin `feature-forge` | §1.1, §3.1 `main` |
| REQ-DIST-02 | `-y`/`--yes` non-interactive: assume confirmed, never block on input | §1.3, §3.1 (no prompt path), §4 |
| REQ-DIST-03 | Single discoverable CLI surface — `--help` from one spec | §1.4 `CLI_SPEC`, §3.4 `helpText` |
| REQ-FLAG-01 | `--agent`/`-a` scope to one agent | §1.3, §2.1 (`agent` resolution) |
| REQ-FLAG-02 | `--global`/`-g` user-level scope | §1.3, §2.1 |
| REQ-FLAG-03 | `--symlink` opt-in (copy default; Windows copies) | §1.3, §2.1 (mode), §3.1 |
| REQ-FLAG-04 | `--force` overwrite locally-modified | §1.3, §3.2 (passed to plan) |
| REQ-FLAG-05 | `-y`/`--yes` non-interactive confirm | §1.3, §2.1 |
| REQ-OPS-04 | `list`/`ls` orchestration (detected? installed? up to date? + drift) | §3.3 `runList` |
| REQ-OBS-01 | Per-agent/per-skill summary + non-zero exit on failure | §3.5 `renderReport`, §3.1 exit |
| REQ-OBS-02 | Actionable errors name agent + path + remedy | §3.6 `formatError`, §4 |
| REQ-OBS-03 | Per-agent partial failure: one fail never aborts others; non-zero overall | §3.1, §3.2 (per-agent try), §2.2 |
| REQ-PERF-01 | `list`/`--dry-run` instant — no network, no build | §3.3 (no rauf preflight), §3.2 (`--dry-run` short-circuit) |

> This document **orchestrates** the per-module behaviors specified in `02`–`06`; it does not
> re-specify their internals. Where it calls into them it cites the exact signature and the owning
> spec file. The flags table (§1.3) is shared with `03`–`06` but the **parse-and-validate** contract
> (the `USAGE` error surface) is owned here.

## Purpose & Scope

`cli.ts` is the installer's process entry point and dispatcher. It is the **only** module that:

1. Reads `process.argv` and turns it into a typed `{ subcommand, flags }` via `node:util.parseArgs`
   (zero-dep), resolving aliases (`add`→`install`, `remove`→`uninstall`, `ls`→`list`) and rejecting
   unknown subcommands/flags/agents with a `USAGE` error.
2. Resolves the **target agent set** (one via `--agent`, else all detected agents).
3. Runs the per-agent plan/apply (or list) pipeline, **catching every per-agent failure** so one
   agent never aborts the others (REQ-OBS-03), and assembles a `RunReport`.
4. Renders the report (human-readable or `--json`) and **returns the process exit code**.

`report.ts` is a **pure** renderer: it turns a `RunReport` into a string. It performs no I/O beyond
returning text; the caller (`main`) writes it to `stdout`/`stderr` and returns the exit code. The
`--json` form emits the same `RunReport` data, which is the shell surface
`agent-detection-map` consumers (`packaging-docs-ci` OS-matrix dry-runs) read (REQ-DET-05).

**Out of scope here** (owned by sibling specs, cited but not re-specified):

- Detection — `detectAgent`/`detectAgents`/`resolveRoots` ([`02-agent-detection-map.md`](./02-agent-detection-map.md)).
- Bundle location & integrity — `locateBundle`/`checkIntegrity` ([`03-source-and-hashing.md`](./03-source-and-hashing.md)).
- Planning & applying — `plan`/`apply` ([`04-plan-and-apply.md`](./04-plan-and-apply.md)).
- Manifest read & uninstall planning — `readManifest`/`planUninstall` ([`05-manifest-and-uninstall.md`](./05-manifest-and-uninstall.md)).
- Rauf preflight — `preflightRauf`/`RAUF_PIN` ([`06-rauf-provisioning.md`](./06-rauf-provisioning.md)).

> **Sibling-signature caveat.** `02`–`06` are authored in parallel with this document. The exact
> signatures cited below are taken from `tech-spec.md` §3/§5/§6 and this feature's dispatch contract.
> The orchestration depends only on those public shapes; if a sibling spec finalizes a slightly
> different name, treat the cited shape here as the contract `cli.ts` requires and reconcile in
> implementation. See **Warnings** at the end of this document.

## 1. CLI surface

### 1.1 Invocation (REQ-DIST-01)

The package's `bin` is `feature-forge` (`installer/package.json` → `"bin": { "feature-forge":
"dist/cli.js" }`, see [`01-architecture-layout.md`](./01-architecture-layout.md) §2). It is
npx-runnable with no prior checkout or build:

```
npx feature-forge <subcommand> [flags]
```

`dist/cli.js` ends with a tiny entry shim that calls `main(process.argv.slice(2))` and sets the exit
code (§3.1). The bundled `adapters/` copy (`files: ["dist","adapters"]`) means `npx` needs nothing
on disk beyond the tarball (REQ-DIST-01).

### 1.2 Subcommands & aliases

| Canonical (`Subcommand`) | Aliases | Mutates? | `--dry-run`? | Honors network? |
|---|---|---|---|---|
| `install` | `add` | yes | yes | yes (rauf preflight, unless `--skip-rauf`) |
| `update` | — | yes | yes | yes (rauf preflight, unless `--skip-rauf`) |
| `uninstall` | `remove` | yes | yes | no |
| `list` | `ls` | no (read-only) | n/a | **no** (REQ-PERF-01) |

Aliases are resolved to the canonical `Subcommand` (from `00-core-definitions.md`) **before** dispatch
(§2.1). An unknown or missing subcommand is a `USAGE` error → `EXIT.USAGE` (2).

### 1.3 Flags (REQ-FLAG-01..05, REQ-DIST-02)

The single flag spec drives both `parseArgs` config **and** `--help` output (REQ-DIST-03, §1.4). All
flags are parsed by `node:util.parseArgs`; unknown flags are rejected as `USAGE` errors.

| Flag | Short | Type | Default | Requirement | Effect |
|---|---|---|---|---|---|
| `--agent <id>` | `-a` | string | (all detected) | REQ-FLAG-01 | Scope to one of the five `AGENT_IDS`. Unknown id ⇒ `USAGE`. |
| `--global` | `-g` | boolean | `false` (project) | REQ-FLAG-02 | Install into the user-level config dir (`~/.<agent>/…`). |
| `--symlink` | — | boolean | `false` (copy) | REQ-FLAG-03 | Link the namespace dir instead of copying. Ignored on Windows (always copy). |
| `--force` | — | boolean | `false` | REQ-FLAG-04 | Overwrite a `skip-modified` (locally-modified) destination. |
| `--dry-run` | — | boolean | `false` | REQ-OPS-05 | Print the plan; change nothing. Mutating subcommands only. |
| `--yes` | `-y` | boolean | `false` | REQ-DIST-02 / REQ-FLAG-05 | Non-interactive: assume confirmed; never block on input. |
| `--json` | — | boolean | `false` | REQ-DET-05 / REQ-OBS-01 | Emit the `RunReport` as JSON instead of human text. |
| `--skip-rauf` | — | boolean | `false` | tech-spec §3.1 | Suppress the rauf resolvability preflight; record `raufPin: null`. |
| `--source <dir>` | — | string | (resolved) | tech-spec D7 | **Hidden** (tests). Override the located adapters source. Not shown in `--help`. |
| `--help` | `-h` | boolean | — | REQ-DIST-03 | Print `helpText()` and exit `0`. |
| `--version` | — | boolean | — | REQ-DIST-03 | Print the installer package version and exit `0`. |

> **Non-interactive by design (REQ-DIST-02).** This installer **never prompts**. Every operation
> proceeds on its computed plan: destructive overwrites require the explicit `--force` flag rather
> than an interactive y/N. `-y/--yes` therefore changes no control flow today — it is accepted (and
> surfaced in `--help`) so the documented non-interactive contract is satisfied and CI scripts that
> pass `-y` work unchanged, and so a future interactive confirmation can be added without breaking the
> CLI surface. There is **no** code path that reads from `stdin`.

### 1.4 `--help` and `--version` (REQ-DIST-03)

`--help` text is **generated from a single source**, `CLI_SPEC` (§1.5), so the enumerated subcommands
and flags can never drift from what `parseArgs` accepts (REQ-DIST-03). `--version` prints the
installer package's own version, read from the bundled `package.json` at runtime.

`--help`/`--version` are recognized **before** subcommand validation: `feature-forge --help` and
`feature-forge` with no subcommand both print help (the no-subcommand case exits `USAGE` = 2 *after*
printing help; an explicit `--help` exits `0`). See §3.1 for the precise precedence.

### 1.5 The single CLI spec (`CLI_SPEC`)

One declarative spec object is the source of truth for parsing, validation, and help. It lives in
`cli.ts`.

```typescript
import { type AgentId, AGENT_IDS, type Subcommand } from "./types.js";

/** A flag's declarative spec — drives both parseArgs config and helpText (REQ-DIST-03). */
interface FlagSpec {
  /** Long name without leading dashes, e.g. "agent". */
  readonly name: string;
  /** Single-char alias without dash, e.g. "a"; omitted if none. */
  readonly short?: string;
  /** parseArgs type. */
  readonly type: "boolean" | "string";
  /** One-line help description. */
  readonly help: string;
  /** Hidden from --help (e.g. --source for tests). */
  readonly hidden?: boolean;
  /** Placeholder shown in help for string flags, e.g. "<id>". */
  readonly arg?: string;
}

/** A subcommand's declarative spec. */
interface SubcommandSpec {
  readonly canonical: Subcommand;
  /** Accepted aliases that resolve to `canonical` (e.g. ["add"]). */
  readonly aliases: readonly string[];
  readonly help: string;
}

/** Canonical subcommand table (REQ-DIST-03, §1.2). */
export const SUBCOMMANDS: readonly SubcommandSpec[] = [
  { canonical: "install", aliases: ["add"], help: "Install feature-forge into the target agent(s)." },
  { canonical: "update", aliases: [], help: "Reconcile an existing install to the current adapters." },
  { canonical: "uninstall", aliases: ["remove"], help: "Remove a prior install (manifest-tracked files only)." },
  { canonical: "list", aliases: ["ls"], help: "Report per-agent detected / installed / up-to-date status." },
];

/** Canonical flag table (REQ-FLAG-01..05, §1.3). */
export const FLAGS: readonly FlagSpec[] = [
  { name: "agent", short: "a", type: "string", arg: "<id>", help: `Scope to one agent (${AGENT_IDS.join("|")}). Default: all detected.` },
  { name: "global", short: "g", type: "boolean", help: "Install into the user-level config dir (default: project-local)." },
  { name: "symlink", type: "boolean", help: "Symlink the bundle instead of copying (default: copy; Windows always copies)." },
  { name: "force", type: "boolean", help: "Overwrite a locally-modified destination that would otherwise be skipped." },
  { name: "dry-run", type: "boolean", help: "Print the planned actions without changing anything." },
  { name: "yes", short: "y", type: "boolean", help: "Non-interactive: assume confirmed; never block on input." },
  { name: "json", type: "boolean", help: "Emit the run report as JSON." },
  { name: "skip-rauf", type: "boolean", help: "Skip the rauf resolvability preflight (records raufPin: null)." },
  { name: "source", type: "string", arg: "<dir>", hidden: true, help: "(test only) Override the adapters source directory." },
  { name: "help", short: "h", type: "boolean", help: "Show this help and exit." },
  { name: "version", type: "boolean", help: "Print the installer version and exit." },
];
```

## 2. Public API — `cli.ts` parse surface

### 2.1 `parseCliArgs`

Parses `argv` into a validated `{ subcommand, flags }`, resolving aliases and rejecting anything the
`CLI_SPEC` does not declare. Pure: no I/O, no exit; returns a `Result` so the boundary (§3.1) maps the
`USAGE` error to `EXIT.USAGE`.

```typescript
import { parseArgs } from "node:util";
import {
  type AgentId,
  AGENT_IDS,
  type CliFlags,
  type Result,
  type Subcommand,
  err,
  ok,
} from "./types.js";

/** Parsed CLI invocation: a resolved subcommand plus normalized flags. */
export interface ParsedCli {
  readonly subcommand: Subcommand;
  readonly flags: CliFlags;
}

/**
 * Parse and validate `argv` (already sliced past `node` + script — i.e.
 * `process.argv.slice(2)`), via `node:util.parseArgs` (zero-dep).
 *
 * Behavior:
 *  - The first positional is the subcommand; aliases resolve (`add`→install,
 *    `remove`→uninstall, `ls`→list) to a canonical `Subcommand` (REQ-DIST-03, §1.2).
 *  - Flags are read from the single `CLI_SPEC` (§1.5), so accepted flags == `--help`-listed flags.
 *  - `--agent/-a` must be one of `AGENT_IDS`; any other value is a `USAGE` error (REQ-FLAG-01).
 *  - An unknown subcommand, an unknown flag, a missing subcommand, or extra positionals all yield a
 *    `USAGE` error (mapped to EXIT.USAGE = 2 at the boundary, §3.1; tech-spec §7).
 *  - `--help`/`--version` are NOT validated here (they short-circuit in `main`, §3.1) but ARE
 *    recognized as booleans so `parseArgs` does not reject them.
 *
 * This function performs NO filesystem or network I/O and never throws for an expected error —
 * `parseArgs`'s own throw (on a malformed token) is caught and converted to a `USAGE` `Result`.
 *
 * @param argv - process args past the node binary + script path (`process.argv.slice(2)`).
 * @returns Ok(ParsedCli) or Err(InstallerError{ code: "USAGE" }).
 *
 * @example
 *   parseCliArgs(["install", "-a", "claude", "--global", "--dry-run"]);
 *   // ok: { subcommand: "install", flags: { agent: "claude", global: true, dryRun: true, ... } }
 *   parseCliArgs(["add", "--json"]);          // ok: { subcommand: "install", flags: { json: true, ... } }
 *   parseCliArgs(["frobnicate"]);             // err: USAGE "unknown subcommand 'frobnicate'"
 *   parseCliArgs(["install", "-a", "vscode"]);// err: USAGE "unknown agent 'vscode'"
 */
export function parseCliArgs(argv: string[]): Result<ParsedCli> {
  // Build parseArgs `options` from the single FLAGS spec (§1.5) so parsing == documented surface.
  const options: Parameters<typeof parseArgs>[0]["options"] = {};
  for (const f of FLAGS) {
    options[f.name] = f.short
      ? { type: f.type, short: f.short }
      : { type: f.type };
  }

  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      options,
      allowPositionals: true,
      // strict:true (default) => unknown flags throw, which we convert to USAGE below.
    });
  } catch (e) {
    return usage(`invalid arguments: ${(e as Error).message}`);
  }

  const positionals = parsed.positionals;
  const values = parsed.values as Record<string, string | boolean | undefined>;

  // --help / --version are recognized but resolved in main(); still need a subcommand for everything
  // else. We surface them via a synthetic subcommand only when present; main() reads flags.help first.
  const wantsHelp = values.help === true;
  const wantsVersion = values.version === true;

  // Resolve the subcommand (first positional) unless help/version short-circuits in main().
  const raw = positionals[0];
  let subcommand: Subcommand | undefined;
  if (raw !== undefined) {
    subcommand = resolveSubcommand(raw);
    if (subcommand === undefined) {
      return usage(`unknown subcommand '${raw}'. Run 'feature-forge --help' for usage.`);
    }
    if (positionals.length > 1) {
      return usage(`unexpected extra argument '${positionals[1]}'.`);
    }
  } else if (!wantsHelp && !wantsVersion) {
    return usage("no subcommand given. Run 'feature-forge --help' for usage.");
  }

  // Validate --agent against the closed set (REQ-FLAG-01).
  let agent: AgentId | undefined;
  const agentRaw = values.agent;
  if (typeof agentRaw === "string") {
    if (!isAgentId(agentRaw)) {
      return usage(`unknown agent '${agentRaw}'. Valid: ${AGENT_IDS.join(", ")}.`);
    }
    agent = agentRaw;
  }

  const flags: CliFlags = {
    agent,
    global: values.global === true,
    symlink: values.symlink === true,
    force: values.force === true,
    dryRun: values["dry-run"] === true,
    yes: values.yes === true,
    json: values.json === true,
    skipRauf: values["skip-rauf"] === true,
    source: typeof values.source === "string" ? values.source : undefined,
  };

  // help/version with no subcommand is still "ok": main() acts on flags before requiring a subcommand.
  // We synthesize "list" only as a harmless placeholder that main() never reaches in that case.
  return ok({ subcommand: subcommand ?? "list", flags });
}

/** Resolve an alias/canonical token to a `Subcommand`, or undefined if unknown. */
function resolveSubcommand(token: string): Subcommand | undefined {
  for (const s of SUBCOMMANDS) {
    if (s.canonical === token || s.aliases.includes(token)) return s.canonical;
  }
  return undefined;
}

/** Narrowing guard for the closed `AgentId` set. */
function isAgentId(v: string): v is AgentId {
  return (AGENT_IDS as readonly string[]).includes(v);
}

/** Small helper: a USAGE Result (mapped to EXIT.USAGE at the boundary). */
function usage(message: string): Result<never> {
  return err({ code: "USAGE", message, remedy: "Run 'feature-forge --help' for usage." });
}
```

**Error handling:**
- Unknown subcommand / unknown flag / unknown agent / missing subcommand / extra positional →
  `Err(InstallerError{ code: "USAGE" })` → `EXIT.USAGE` (2) at the boundary (§3.1, tech-spec §7).
- `parseArgs` internal throw (malformed `--flag=` token, value for a boolean, etc.) is caught and
  converted to the same `USAGE` `Result` — `parseCliArgs` never propagates an exception.

### 2.2 `mapErrorToExit`

The single mapping from a structured error to an exit code (tech-spec §7): `USAGE` → `EXIT.USAGE`
(2); **everything else** → `EXIT.FAILURE` (1).

```typescript
import { EXIT, type ExitCode, type InstallerError } from "./types.js";

/**
 * Map a structured `InstallerError` to a process exit code (tech-spec §7).
 * - "USAGE"  → EXIT.USAGE   (2): the args were invalid.
 * - anything else → EXIT.FAILURE (1): an operational failure
 *   (SOURCE_MISSING, SOURCE_INVALID, LOCALLY_MODIFIED, WRITE_DENIED, PATH_ESCAPE,
 *    RAUF_UNRESOLVABLE, MANIFEST_CORRUPT, UNEXPECTED).
 *
 * @param err - the structured error.
 * @returns EXIT.USAGE for "USAGE", else EXIT.FAILURE.
 */
export function mapErrorToExit(err: InstallerError): ExitCode {
  return err.code === "USAGE" ? EXIT.USAGE : EXIT.FAILURE;
}
```

## 3. Internal implementation — dispatch & orchestration

### 3.1 `main` — the dispatch boundary

`main` is the one async entry that ties the whole pipeline together. It is the **only** place that
catches per-agent failures (REQ-OBS-03), writes to `stdout`/`stderr`, and decides the exit code.

```typescript
import process from "node:process";
import {
  EXIT,
  type ExitCode,
  type RunReport,
} from "./types.js";
import { renderReport } from "./report.js";

/**
 * Parse → resolve targets → run per-agent pipeline (catching per-agent errors) → render → exit code.
 *
 * Control flow (precedence matters):
 *  1. parseCliArgs(argv). On Err(USAGE): print the message to stderr, print helpText() to stderr,
 *     return EXIT.USAGE (2).  [REQ-DIST-03, tech-spec §7]
 *  2. If flags.help: print helpText() to stdout, return EXIT.SUCCESS (0).
 *  3. If flags.version: print the installer version to stdout, return EXIT.SUCCESS (0).
 *  4. If no subcommand was given (the parse synthesized one only for help/version): print helpText()
 *     to stderr and return EXIT.USAGE (2).
 *  5. Dispatch on subcommand:
 *       install/update/uninstall → runMutation(subcommand, flags)   (§3.2)
 *       list                     → runList(flags)                   (§3.3)
 *     Each returns a fully-assembled RunReport whose exitCode already reflects per-agent outcomes.
 *  6. Render the RunReport via renderReport(report, { json: flags.json }) and write to stdout
 *     (success/info) — failures are already embedded per-agent in the report (REQ-OBS-01/03).
 *  7. Return report.exitCode.
 *
 * The whole body runs inside a try/catch: any UNEXPECTED exception is converted to a one-line
 * actionable message on stderr (never a bare stack as the only output) and EXIT.FAILURE (tech-spec §7).
 *
 * `main` itself never reads stdin (REQ-DIST-02): the installer is non-interactive. The env-dependent
 * orchestration is factored into `runCli(argv, env)` (§3.1a); `main` delegates to it with all-real
 * defaults (`runCli(argv, {})`) and owns only the `process` boundary (argv read, stdout/stderr,
 * exit-code mapping). An uncaught exception still maps to `EXIT.FAILURE` via the boundary catch.
 *
 * @param argv - process args past node + script (`process.argv.slice(2)`).
 * @returns the process exit code (0 success, 1 operational failure, 2 usage).
 */
export async function main(argv: string[]): Promise<ExitCode> {
  let report: RunReport;
  try {
    const parsed = parseCliArgs(argv);
    if (!parsed.ok) {
      process.stderr.write(`error: ${parsed.error.message}\n\n`);
      process.stderr.write(helpText() + "\n");
      return mapErrorToExit(parsed.error); // EXIT.USAGE
    }

    const { subcommand, flags } = parsed.value;

    if (flags.help) {
      process.stdout.write(helpText() + "\n");
      return EXIT.SUCCESS;
    }
    if (flags.version) {
      process.stdout.write(readInstallerVersion() + "\n");
      return EXIT.SUCCESS;
    }
    if (!hadSubcommand(argv)) {
      process.stderr.write("error: no subcommand given.\n\n");
      process.stderr.write(helpText() + "\n");
      return EXIT.USAGE;
    }

    report =
      subcommand === "list"
        ? await runList(flags)
        : await runMutation(subcommand, flags);
  } catch (e) {
    // Boundary catch: an UNEXPECTED exception (a bug, an unforeseen fs error) must never surface as
    // a bare stack alone (tech-spec §7). Print a one-line actionable message and exit 1.
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`error: unexpected failure: ${msg}\n`);
    return EXIT.FAILURE;
  }

  const rendered = renderReport(report, { json: flags2(report).json });
  // Human report goes to stdout; --json also to stdout (it IS the machine output, REQ-DET-05).
  process.stdout.write(rendered + "\n");
  return report.exitCode;
}
```

> Two tiny helpers are elided above for clarity: `hadSubcommand(argv)` re-checks whether the first
> positional was present (so `--help` short-circuits before "no subcommand" but a bare invocation
> still exits `USAGE`), and `flags2(report)` is shorthand for the `{ json }` rendering option threaded
> from `flags`. Implementations may instead thread `flags.json` directly into `main`'s tail — both are
> equivalent. The load-bearing contract is the **precedence** (help/version before subcommand
> requirement) and that **`report.exitCode` is the return value**.

The process entry shim (end of `cli.ts`):

```typescript
// Entry: only when run as the bin, not when imported (keeps `index.ts` library import side-effect-free).
main(process.argv.slice(2))
  .then((code) => { process.exitCode = code; })
  .catch((e) => {
    process.stderr.write(`error: fatal: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = EXIT.FAILURE;
  });
```

### 3.1a `runCli` — the injectable programmatic entry (hermetic-test seam)

`runCli` is the **testable core** of the CLI: it does everything `main` does *except* read
`process.argv`, write to `stdout`/`stderr`, and call `process.exit`. It accepts an injected
environment (`CliEnv`) so the whole pipeline can run against a temp HOME/cwd, a mock registry, and a
forced platform — the seam `08-testing-strategy.md` (§3.4 `runCli2`) relies on to run the entire
suite without touching the real `~` or the network.

```typescript
import { type RegistryQuery } from "./rauf.js"; // 06 — the injectable registry seam

/**
 * Injected environment for a programmatic CLI run (the hermetic-test seam, 08 §3.4). Every field is
 * optional; an omitted field falls back to the real default `main` uses (os.homedir() / process.cwd()
 * / the real `npm view` RegistryQuery / process.platform).
 */
export interface CliEnv {
  /** Stand-in for `~` — threaded into detection/destination/manifest resolution as ResolveOpts.home. */
  readonly home?: string;
  /** Stand-in for `process.cwd()` — threaded into resolution as ResolveOpts.cwd. */
  readonly cwd?: string;
  /** Mock rauf registry query (06) for the preflight; default = the real `npm view` query. */
  readonly registry?: RegistryQuery;
  /** Forced platform for the copy/symlink mode decision (REQ-FLAG-03); default = process.platform. */
  readonly platform?: NodeJS.Platform;
}

/**
 * Run the full CLI pipeline programmatically and return the assembled `RunReport` WITHOUT touching
 * `process` (no argv read, no stdout/stderr write, no exit). This is the testable core (08 §3.4):
 *
 *  - parse `argv` via `parseCliArgs` (§2.1);
 *  - thread `env.home`/`env.cwd` into the detection / `destinationFor` / manifest calls (as the
 *    `ResolveOpts` every `02`/`05` function accepts) so all roots resolve inside the sandbox;
 *  - thread `env.registry` into `preflightRauf` (06) so the rauf preflight never hits the network;
 *  - thread `env.platform` into the copy/symlink mode decision (REQ-FLAG-03 — Windows always copies);
 *  - return the fully-assembled `RunReport` (exitCode already reflecting per-agent outcomes).
 *
 * `main(argv)` is now a thin wrapper around `runCli`: it calls `runCli(argv, {})` (all real defaults),
 * renders the report, writes it, and `process.exit(report.exitCode)`; an uncaught exception maps to
 * `EXIT.FAILURE` via `main`'s boundary catch (§3.1). Because every env-dependent call receives the
 * injected `home`/`cwd`/`registry`/`platform`, tests run hermetically with no real `~`/network.
 *
 * @param argv - the post-`node` argument list (e.g. `["install","-a","claude","--source",dir]`).
 * @param env  - the injectable environment; defaults to the real `~`/cwd/registry/platform.
 * @returns the assembled `RunReport`.
 */
export async function runCli(argv: string[], env?: CliEnv): Promise<RunReport>;
```

> **`main` delegates to `runCli`.** The §3.1 control flow (help/version precedence, the boundary
> try/catch, `report.exitCode` as the return value) is unchanged; `main` simply calls
> `runCli(argv, {})`, prints the rendered report, and returns/exits with `report.exitCode`. The
> env-injection is the only difference, and it is invisible to a normal CLI invocation.

### 3.2 `runMutation` — install / update / uninstall

Drives the per-agent pipeline for the three mutating subcommands. **Each agent is wrapped in its own
try/`Result` boundary** so one agent's failure produces a failed `AgentReport` but never aborts the
loop (REQ-OBS-03). The `--dry-run` short-circuit guarantees no network and no writes (REQ-PERF-01 for
the planning half).

```typescript
import {
  type AgentId,
  type AgentReport,
  type CliFlags,
  type DetectionResult,
  type InstallerError,
  type Mode,
  type PlannedAction,
  type RunReport,
  type Scope,
  type Subcommand,
  EXIT,
} from "./types.js";
import { detectAgents, detectAgent, resolveRoots } from "./agent-targets.js"; // 02
import { locateBundle, checkIntegrity } from "./source.js";                   // 03
import { plan, apply } from "./plan.js";                                      // 04 (apply re-exported or from apply.js)
import { readManifest, planUninstall } from "./manifest.js";                  // 05
import { preflightRauf, RAUF_PIN } from "./rauf.js";                          // 06

/**
 * Orchestrate a mutating run (install | update | uninstall).
 *
 * Steps:
 *  1. Resolve scope + mode from flags (scope = global?project; mode = symlink?symlink:copy, forced to
 *     copy on Windows by apply/fsutil — REQ-FLAG-03/§04).
 *  2. Resolve the target agent set:
 *       - flags.agent given  → exactly that agent (REQ-FLAG-01); still report `detected:false` if its
 *         config dir is absent, but the operation is scoped to it.
 *       - else               → all DETECTED agents (REQ-DET-03) via detectAgents().
 *  3. For install/update only: run the rauf resolvability preflight ONCE (not per agent), unless
 *     --skip-rauf or --dry-run (REQ-PERF-01: dry-run does no network). A preflight failure is an
 *     OPERATIONAL failure recorded on the run (it does NOT abort skill installs — REQ-RAUF/OBS-03):
 *     skills still install; the run's exitCode becomes FAILURE.
 *  4. Per agent (independent, REQ-OBS-03):
 *       a. install/update: locateBundle → checkIntegrity → plan(...) → (dry-run? stop : apply(...)).
 *       b. uninstall:      readManifest → planUninstall → (dry-run? stop : apply(removalPlan)).
 *     Any per-agent Err becomes a failed AgentReport (ok:false, error) — the loop continues.
 *  5. Assemble RunReport; exitCode = FAILURE if ANY agent failed OR the rauf preflight failed, else
 *     SUCCESS.
 *
 * @returns the assembled RunReport (never throws for expected per-agent errors).
 */
async function runMutation(subcommand: Subcommand, flags: CliFlags): Promise<RunReport> {
  const scope: Scope = flags.global ? "global" : "project";
  const mode: Mode = flags.symlink ? "symlink" : "copy";
  const roots = resolveRoots({ scope }); // 02 — injects home/cwd; tests override

  const targets: AgentId[] = flags.agent
    ? [flags.agent]
    : detectAgents({ scope }).filter((d) => d.detected).map((d) => d.agent);

  const agentReports: AgentReport[] = [];
  let raufPin: string | null = flags.skipRauf ? null : RAUF_PIN;
  let raufError: InstallerError | undefined;

  // Rauf preflight: install/update only, once, network only when not dry-run/skip (REQ-PERF-01).
  if ((subcommand === "install" || subcommand === "update") && !flags.skipRauf && !flags.dryRun) {
    const pf = await preflightRauf(RAUF_PIN); // 06: read-only `npm view`, injectable for tests
    if (!pf.ok) {
      raufError = pf.error;     // RAUF_UNRESOLVABLE — recorded, does NOT abort skill installs
      raufPin = null;           // not resolvable ⇒ no usable pin recorded this run
    }
  }

  for (const agent of targets) {
    const detection: DetectionResult = detectAgent(agent, { scope }); // 02
    const r = await runOneAgent(subcommand, agent, detection, flags, scope, mode, raufPin);
    agentReports.push(r);
  }

  const anyAgentFailed = agentReports.some((r) => !r.ok);
  const exitCode = anyAgentFailed || raufError !== undefined ? EXIT.FAILURE : EXIT.SUCCESS;

  return {
    subcommand,
    scope,
    mode,
    dryRun: flags.dryRun,
    agents: raufError ? attachRaufError(agentReports, raufError) : agentReports,
    exitCode,
  };
}

/**
 * Run the pipeline for a single agent, returning its AgentReport. Catches every expected error into
 * a failed report (REQ-OBS-03) so the caller's loop is never aborted by one agent.
 */
async function runOneAgent(
  subcommand: Subcommand,
  agent: AgentId,
  detection: DetectionResult,
  flags: CliFlags,
  scope: Scope,
  mode: Mode,
  raufPin: string | null,
): Promise<AgentReport> {
  // uninstall path: manifest → planUninstall → apply.
  if (subcommand === "uninstall") {
    const m = readManifest(agent, { scope }); // 05 → Result<InstallManifest | null>
    if (!m.ok) return failed(agent, detection.detected, m.error);
    if (m.value === null) {
      // Nothing installed for this agent: not an error — an "ok, no-op" report.
      return { agent, detected: detection.detected, ok: true, actions: [], raufPin: null };
    }
    const rp = planUninstall(m.value); // 05 → Result<PlannedAction>
    if (!rp.ok) return failed(agent, detection.detected, rp.error);
    return finishAgent(agent, detection.detected, rp.value, flags, raufPin);
  }

  // install/update path: locate → integrity → plan → apply.
  const located = locateBundle(agent, { source: flags.source }); // 03 → Result<string>
  if (!located.ok) return failed(agent, detection.detected, located.error); // SOURCE_MISSING

  const integ = checkIntegrity(located.value, agent); // 03 → Result<void>
  if (!integ.ok) return failed(agent, detection.detected, integ.error); // SOURCE_INVALID

  const planned = plan({
    subcommand,
    agent,
    scope,
    mode,
    bundleDir: located.value,
    destination: detection.destination,
    force: flags.force,
  }); // 04 → Result<PlannedAction>
  if (!planned.ok) return failed(agent, detection.detected, planned.error);

  return finishAgent(agent, detection.detected, planned.value, flags, raufPin);
}

/** Apply a plan unless --dry-run; build the agent's report either way. */
async function finishAgent(
  agent: AgentId,
  detected: boolean,
  planned: PlannedAction,
  flags: CliFlags,
  raufPin: string | null,
): Promise<AgentReport> {
  if (flags.dryRun) {
    // Plan only: the actions shown are exactly what a real run performs (REQ-OPS-05). No writes.
    return { agent, detected, ok: true, actions: planned.files, raufPin };
  }
  const applied = await apply(planned, { raufPin }); // 04 → Result<{ actions: FileAction[] }>
  if (!applied.ok) return failed(agent, detected, applied.error); // e.g. WRITE_DENIED, PATH_ESCAPE
  return { agent, detected, ok: true, actions: applied.value.actions, raufPin };
}

/** A failed single-agent report (REQ-OBS-03): ok:false + the structured error. */
function failed(agent: AgentId, detected: boolean, error: InstallerError): AgentReport {
  return { agent, detected, ok: false, actions: [], error };
}

/** Mark every agent report failed-by-rauf (preflight failure is run-wide) for visibility. */
function attachRaufError(reports: AgentReport[], raufError: InstallerError): AgentReport[] {
  // Skills still installed (each report keeps its own ok); the rauf error is surfaced once in render.
  // We attach it to the report list via a sentinel agentless entry is avoided — instead the renderer
  // reads it from a run-level field. To keep RunReport.agents homogeneous, we leave per-agent ok as-is
  // and rely on exitCode + the renderer's rauf line (§3.5). This function is a no-op hook kept for
  // future per-agent attribution; current behavior returns `reports` unchanged.
  return reports;
}
```

> **Rauf preflight reporting note.** The rauf preflight is **run-level**, not per-agent: a single
> `npm view rauf@<pin>` check (06). On failure the run's `exitCode` becomes `EXIT.FAILURE` while every
> agent's skill install still succeeds (`AgentReport.ok` stays `true`) — exactly the "skills still
> install; default loop unavailable" contract (tech-spec §3.1, REQ-OBS-03). To carry the rauf error
> into the rendered summary without polluting the homogeneous `agents[]`, an implementation MAY add an
> optional run-level field to `RunReport` (e.g. `raufError?: InstallerError`) **in addition to** the
> fields fixed in `00-core-definitions.md`; the renderer (§3.5) prints the fixed failure message from
> §3.1 of the tech-spec when present. The exit-code contract (FAILURE if the preflight failed) is the
> load-bearing part and is satisfied via `exitCode` regardless of how the message is threaded.

### 3.3 `runList` — the `list`/`ls` orchestration (REQ-OPS-04, REQ-PERF-01)

`list` is read-only and **instant**: detection + manifest read + hash compare only. It performs **no
network call** (no rauf preflight) and **no build** (REQ-PERF-01).

```typescript
import { sha256Tree } from "./hash.js"; // 03

/**
 * Orchestrate the read-only `list` operation (REQ-OPS-04). For EVERY agent (detected or not — list
 * is informational across the whole table) compute:
 *   - detected?      → detection.detected (config-dir presence, REQ-DET-02)
 *   - installed?     → a manifest exists for the active scope (readManifest != null)
 *   - up to date?    → manifest.sourceHash === sha256Tree(located bundle) (drift anchor, §03/§04)
 *   - drift?         → any destination file locally modified — derived by planning in "list mode"
 *                      (a plan whose files contain a "skip-modified" action), still WITHOUT writing.
 *
 * No network (no preflightRauf), no apply, no writes ⇒ effectively instant (REQ-PERF-01).
 * Per-agent errors (e.g. MANIFEST_CORRUPT, SOURCE_MISSING for an installed agent) are caught into a
 * failed AgentReport (REQ-OBS-03); overall exitCode is FAILURE iff any agent's status check failed.
 *
 * @returns a RunReport whose AgentReport.actions encode the status (see renderReport §3.5 for the
 *          per-agent "detected/installed/up-to-date/drift" lines derived from this data).
 */
async function runList(flags: CliFlags): Promise<RunReport> {
  const scope: Scope = flags.global ? "global" : "project";
  const targets: AgentId[] = flags.agent ? [flags.agent] : [...AGENT_IDS];

  const agentReports: AgentReport[] = [];
  for (const agent of targets) {
    const detection = detectAgent(agent, { scope }); // 02
    const r = listOneAgent(agent, detection, flags, scope);
    agentReports.push(r);
  }

  const anyFailed = agentReports.some((r) => !r.ok);
  return {
    subcommand: "list",
    scope,
    mode: "copy",          // mode is irrelevant for list; report the default for shape stability
    dryRun: false,
    agents: agentReports,
    exitCode: anyFailed ? EXIT.FAILURE : EXIT.SUCCESS,
  };
}

/** Compute one agent's list status without any write or network call (REQ-PERF-01). */
function listOneAgent(
  agent: AgentId,
  detection: DetectionResult,
  flags: CliFlags,
  scope: Scope,
): AgentReport {
  const m = readManifest(agent, { scope }); // 05 → Result<InstallManifest | null>
  if (!m.ok) return failed(agent, detection.detected, m.error); // MANIFEST_CORRUPT

  const installed = m.value !== null;
  // Status is carried as synthetic FileAction rows the renderer decodes (status, not file writes):
  const statusActions: FileAction[] = [
    { relpath: `detected:${detection.detected}`, action: "unchanged" },
    { relpath: `installed:${installed}`, action: "unchanged" },
  ];

  if (installed) {
    const located = locateBundle(agent, { source: flags.source }); // 03
    if (located.ok) {
      const current = sha256Tree(located.value); // 03 — local hash, no network
      const upToDate = current === m.value!.sourceHash;
      statusActions.push({ relpath: `up-to-date:${upToDate}`, action: "unchanged" });
    } else {
      // installed but source gone (e.g. checkout without adapters) — informational, not a hard fail.
      statusActions.push({ relpath: "up-to-date:unknown(source-missing)", action: "unchanged" });
    }
  }

  return { agent, detected: detection.detected, ok: true, actions: statusActions, raufPin: m.value?.raufPin ?? null };
}
```

> **List status encoding.** `list` reuses the `AgentReport`/`FileAction` shapes from
> `00-core-definitions.md` rather than introducing a new type: the per-agent status booleans are
> carried as `relpath`-encoded synthetic rows that the renderer (§3.5) decodes into the human
> "detected / installed / up-to-date" line and the `--json` object. This keeps the `RunReport`
> homogeneous across all four subcommands (one render path). An implementation MAY instead add an
> optional `status?: { detected; installed; upToDate }` field to `AgentReport`; the renderer must
> handle whichever encoding the implementation picks. The **REQ-OPS-04 contract** — per agent,
> detected? installed? up to date? plus drift — is the load-bearing part.

### 3.4 `helpText` and `--version`

```typescript
/**
 * Build the full `--help` text from the single CLI_SPEC (SUBCOMMANDS + FLAGS, §1.5) so the listed
 * surface can never drift from what parseArgs accepts (REQ-DIST-03). Hidden flags (--source) are
 * omitted. Pure: returns a string, no I/O.
 *
 * @returns the multi-line help text.
 */
export function helpText(): string {
  const lines: string[] = [];
  lines.push("feature-forge — cross-agent installer for the feature-forge skill suite");
  lines.push("");
  lines.push("USAGE:");
  lines.push("  feature-forge <command> [flags]");
  lines.push("");
  lines.push("COMMANDS:");
  for (const s of SUBCOMMANDS) {
    const alias = s.aliases.length ? ` (alias: ${s.aliases.join(", ")})` : "";
    lines.push(`  ${s.canonical.padEnd(10)} ${s.help}${alias}`);
  }
  lines.push("");
  lines.push("FLAGS:");
  for (const f of FLAGS) {
    if (f.hidden) continue;
    const long = `--${f.name}${f.arg ? " " + f.arg : ""}`;
    const short = f.short ? `-${f.short}, ` : "    ";
    lines.push(`  ${short}${long.padEnd(18)} ${f.help}`);
  }
  lines.push("");
  lines.push("EXAMPLES:");
  lines.push("  npx feature-forge install                 # install into all detected agents (project scope)");
  lines.push("  npx feature-forge install -a claude -g    # install into ~/.claude only");
  lines.push("  npx feature-forge update --dry-run        # preview an update, change nothing");
  lines.push("  npx feature-forge list --json             # machine-readable per-agent status");
  lines.push("  npx feature-forge uninstall -a cursor     # remove the cursor install (manifest-tracked only)");
  return lines.join("\n");
}

/**
 * Read the installer package's own version from the bundled package.json (REQ-DIST-03 `--version`).
 * Resolved relative to the compiled module via `import.meta` so it works when run via `npx`.
 *
 * @returns the installer version string (e.g. "0.1.0").
 */
function readInstallerVersion(): string {
  // package.json sits one dir up from dist/cli.js in the published tarball.
  // Implementation: new URL("../package.json", import.meta.url) → read → JSON.parse → .version.
  // On any read error, fall back to "unknown" (never throw from --version).
  // (Exact fs read elided; see Verification.)
  return resolvePackageVersionSafely();
}
```

### 3.5 `renderReport` — the run reporter (`report.ts`, REQ-OBS-01)

`report.ts` is pure: it turns a `RunReport` into a string. The human form is the per-agent /
per-skill summary REQ-OBS-01 mandates; the `--json` form is the same `RunReport` data, which is the
machine surface `agent-detection-map` consumers read (REQ-DET-05).

```typescript
import {
  type AgentReport,
  type FileAction,
  type FileActionKind,
  type RunReport,
} from "./types.js";
import { formatError } from "./report-errors.js"; // §3.6 (may live in report.ts)

/** Options for rendering a run report. */
export interface RenderOpts {
  /** Emit machine-readable JSON instead of human text (REQ-DET-05, REQ-OBS-01). */
  readonly json: boolean;
}

/**
 * Render a RunReport to a string (REQ-OBS-01). Pure — no I/O; the caller writes it.
 *
 * Human form (default): a header line, then per agent a status line and, indented, the per-file
 * actions (created / overwritten / skipped-modified / unchanged / removed), then per-agent failures
 * with actionable messages (REQ-OBS-02), then a final summary line. For `list`, the per-agent line is
 * "detected / installed / up-to-date" decoded from the synthetic status rows (§3.3).
 *
 * JSON form (--json): JSON.stringify of the RunReport (same data), so non-Node consumers and the
 * OS-matrix CI dry-runs can parse it (REQ-DET-05). Stable key order via the type's field order.
 *
 * @param report - the assembled run report.
 * @param opts - { json } selecting the output form.
 * @returns the rendered string (no trailing newline; the caller adds one).
 *
 * @example (human, install dry-run)
 *   install (project, copy) — dry-run
 *   claude: ok
 *     create   skills/forge-1-prd/SKILL.md
 *     unchanged skills/forge-2-tech/SKILL.md
 *   codex: FAILED — SOURCE_INVALID
 *     bundle adapters/codex/ is missing scripts/forge-root.sh (run the adapters build)
 *   Summary: 1 ok, 1 failed (exit 1)
 *
 * @example (--json)
 *   {"subcommand":"install","scope":"project","mode":"copy","dryRun":true,"agents":[...],"exitCode":1}
 */
export function renderReport(report: RunReport, opts: RenderOpts): string {
  if (opts.json) {
    return JSON.stringify(report);
  }
  return renderHuman(report);
}

/** Human-readable rendering (REQ-OBS-01/02). */
function renderHuman(report: RunReport): string {
  const out: string[] = [];
  const dr = report.dryRun ? " — dry-run" : "";
  out.push(`${report.subcommand} (${report.scope}, ${report.mode})${dr}`);

  for (const a of report.agents) {
    out.push(...renderAgent(report.subcommand, a));
  }

  const okCount = report.agents.filter((a) => a.ok).length;
  const failCount = report.agents.length - okCount;
  out.push(
    `Summary: ${okCount} ok, ${failCount} failed (exit ${report.exitCode})`,
  );
  return out.join("\n");
}

/** One agent's block: status line, per-file actions, and (if failed) the actionable error. */
function renderAgent(subcommand: RunReport["subcommand"], a: AgentReport): string[] {
  const lines: string[] = [];
  if (subcommand === "list") {
    // Decode the synthetic status rows (§3.3) into one human line.
    const status = a.actions.map((f) => f.relpath).join("  ");
    lines.push(`${a.agent}: ${a.detected ? "detected" : "not detected"}  ${status}`);
    return lines;
  }

  if (!a.ok && a.error) {
    lines.push(`${a.agent}: FAILED — ${a.error.code}`);
    lines.push(`  ${formatError(a.error)}`); // actionable: agent + path + remedy (REQ-OBS-02)
    return lines;
  }

  lines.push(`${a.agent}: ok`);
  for (const f of a.actions) {
    lines.push(`  ${actionVerb(f.action)} ${f.relpath}`);
  }
  if (a.raufPin) lines.push(`  rauf default runner pinned: ${a.raufPin}`);
  return lines;
}

/** Map a FileActionKind to its human verb (REQ-OBS-01 vocabulary). */
function actionVerb(kind: FileActionKind): string {
  switch (kind) {
    case "create": return "create   ";
    case "overwrite": return "overwrite";
    case "skip-modified": return "skip     "; // (locally modified — see error/remedy)
    case "unchanged": return "unchanged";
    case "remove": return "remove   ";
  }
}
```

### 3.6 `formatError` — actionable error lines (REQ-OBS-02)

Every failure line names the **agent**, the **path**, and the **remedy** (REQ-OBS-02). The structured
`InstallerError` (from `00-core-definitions.md`) already carries `agent`, `path`, and `remedy`;
`formatError` composes them into one line, falling back to the per-code default remedy when the error
omits one.

```typescript
import { type ErrorCode, type InstallerError } from "./types.js";

/**
 * Compose a single actionable line from a structured error (REQ-OBS-02): always prefer the error's
 * own `message`/`remedy`; supply a per-code default remedy when absent. Pure.
 *
 * @param e - the structured error.
 * @returns "<message> [path: <path>] [remedy: <remedy>]" — agent is already in the section header.
 */
export function formatError(e: InstallerError): string {
  const parts: string[] = [e.message];
  if (e.path) parts.push(`path: ${e.path}`);
  const remedy = e.remedy ?? DEFAULT_REMEDY[e.code];
  if (remedy) parts.push(`remedy: ${remedy}`);
  return parts.join(" — ");
}

/** Per-code default remedy when the error did not carry one (REQ-OBS-02). */
const DEFAULT_REMEDY: Partial<Record<ErrorCode, string>> = {
  USAGE: "run 'feature-forge --help' for usage",
  SOURCE_MISSING: "run the adapters build to generate adapters/<agent>/",
  SOURCE_INVALID: "regenerate the bundle (run the adapters build)",
  LOCALLY_MODIFIED: "re-run with --force to overwrite local changes",
  WRITE_DENIED: "check write permission to the path, or choose --global vs project scope",
  PATH_ESCAPE: "report this — a destination resolved outside the agent config dir",
  RAUF_UNRESOLVABLE:
    "the default loop will be unavailable until rauf publishes (see packaging-docs-ci); skills were still installed",
  MANIFEST_CORRUPT: "remove the corrupt .feature-forge.<scope>.json and re-run install",
};
```

## 4. Error handling (consolidated)

| Failure | Code | Where caught | Exit | Message form (REQ-OBS-02) |
|---|---|---|---|---|
| Unknown subcommand/flag/agent, missing subcommand | `USAGE` | `parseCliArgs` → `main` | 2 | message + "run --help" |
| Detected agent, no `adapters/<agent>/` | `SOURCE_MISSING` | `runOneAgent` (03) | 1 | names agent + expected source path + "run the adapters build" |
| Bundle fails integrity check | `SOURCE_INVALID` | `runOneAgent` (03) | 1 | names agent + the missing required path |
| Destination locally modified | `LOCALLY_MODIFIED` | `apply`/`plan` (04) | 1 | names agent + path + "re-run with --force" |
| No write permission | `WRITE_DENIED` | `apply`/`fsutil` (04) | 1 | "no write permission to `<path>`" |
| Resolved path escaped agent root | `PATH_ESCAPE` | `fsutil` (04) | 1 | names agent + path (sandbox violation) |
| Pinned rauf not resolvable | `RAUF_UNRESOLVABLE` | `preflightRauf` (06) | 1 | fixed text (tech-spec §3.1); **skills still install** |
| Manifest unreadable/invalid JSON | `MANIFEST_CORRUPT` | `readManifest` (05) | 1 | names agent + manifest path + "remove and re-run" |
| Unforeseen exception | `UNEXPECTED` | `main` boundary try/catch | 1 | one-line message — **never** a bare stack as the only output (tech-spec §7) |

**Cross-cutting rules (tech-spec §7):**

- **Per-agent isolation (REQ-OBS-03):** `runMutation`/`runList` wrap each agent so a single failure
  yields `AgentReport{ ok:false }` and the loop continues. The run's `exitCode` is `EXIT.FAILURE` iff
  **any** agent failed or the rauf preflight failed; otherwise `EXIT.SUCCESS`.
- **Rauf failure is operational, not fatal:** install/update still write every agent's skills; only
  the run exit code goes non-zero and the summary surfaces the fixed rauf message (§3.1, REQ-RAUF).
- **No throw for expected errors:** every core call returns a `Result`; `main`'s outer try/catch
  exists solely for the truly unexpected (`UNEXPECTED` → exit 1 with a message).
- **`-y/--yes` never gates flow (REQ-DIST-02):** there is no `stdin` read anywhere; the flag is
  accepted and documented so CI invocations are valid and the non-interactive contract is explicit.

## Dependencies

This document orchestrates the others; it must be implemented **after** the modules it calls:

- [`00-core-definitions.md`](./00-core-definitions.md) — `AgentId`, `AGENT_IDS`, `Subcommand`,
  `Scope`, `Mode`, `CliFlags`, `EXIT`/`ExitCode`, `AgentReport`, `RunReport`, `PlannedAction`,
  `FileAction`/`FileActionKind`, `InstallerError`/`ErrorCode`, `Result`/`ok`/`err`, `AGENT_TARGETS`.
  **(required first)**
- [`01-architecture-layout.md`](./01-architecture-layout.md) — `cli.ts` is the `bin` entry
  (`dist/cli.js`); `report.ts` re-exported only as needed; module dependency direction
  (`cli.ts` → everything → `types`).
- [`02-agent-detection-map.md`](./02-agent-detection-map.md) — `detectAgent`, `detectAgents`,
  `resolveRoots`.
- [`03-source-and-hashing.md`](./03-source-and-hashing.md) — `locateBundle`, `checkIntegrity`,
  `sha256Tree` (for `list` up-to-date compare).
- [`04-plan-and-apply.md`](./04-plan-and-apply.md) — `plan`, `apply`.
- [`05-manifest-and-uninstall.md`](./05-manifest-and-uninstall.md) — `readManifest`, `planUninstall`.
- [`06-rauf-provisioning.md`](./06-rauf-provisioning.md) — `preflightRauf`, `RAUF_PIN`.

Implementation order: `00` → `02`/`03`/`06` → `04`/`05` → **`07` (this doc)**.

## Verification

An implementation matches this spec iff:

- [ ] `src/cli.ts` exports `parseCliArgs(argv): Result<ParsedCli>`, `main(argv): Promise<ExitCode>`,
      `runCli(argv, env?): Promise<RunReport>` + the `CliEnv` type (§3.1a),
      `mapErrorToExit(err): ExitCode`, `helpText(): string`, and the `SUBCOMMANDS`/`FLAGS` spec
      tables; `src/report.ts` exports `renderReport(report, { json }): string`.
- [ ] `runCli(argv, { home, cwd, registry, platform })` threads each injected value into the
      detection/`destinationFor`/manifest calls (`home`/`cwd`), `preflightRauf` (`registry`), and the
      copy/symlink mode decision (`platform`), and returns the assembled `RunReport` without touching
      `process` — the hermetic seam `08` §3.4 relies on; `main(argv)` delegates via `runCli(argv, {})`.
- [ ] `parseCliArgs` resolves aliases: `add`→install, `remove`→uninstall, `ls`→list (asserted).
- [ ] Unknown subcommand, unknown flag, and unknown `--agent` each return `Err({code:"USAGE"})`, and
      `mapErrorToExit` returns `EXIT.USAGE` (2) for them; every other code returns `EXIT.FAILURE` (1).
- [ ] `main(["--help"])` and `main(["install","--help"])` print `helpText()` and return `0`;
      `main([])` (no subcommand) prints help to stderr and returns `2`.
- [ ] `main(["--version"])` prints the installer package version and returns `0`.
- [ ] `helpText()` lists every non-hidden flag in `FLAGS` and every subcommand in `SUBCOMMANDS`, and
      does **not** list `--source` (hidden) — i.e. the help surface == the parse surface (REQ-DIST-03).
- [ ] A run where one agent fails (e.g. `SOURCE_INVALID`) and another succeeds returns a `RunReport`
      with both an `ok:false` and an `ok:true` `AgentReport` and `exitCode === EXIT.FAILURE`
      (per-agent partial failure, REQ-OBS-03).
- [ ] `install`/`update` with `--dry-run` perform **no** network call (rauf preflight skipped) and
      **no** writes; `list` performs no network call and no writes (REQ-PERF-01) — asserted by mocking
      `preflightRauf`/`apply` and checking they are not invoked.
- [ ] A failed rauf preflight (mocked unresolvable) yields `exitCode === EXIT.FAILURE` while every
      agent's skill `AgentReport.ok` is `true` and the summary contains the fixed rauf message
      (tech-spec §3.1).
- [ ] `list` reports, per agent, detected / installed / up-to-date derived from detection +
      `readManifest` + `sha256Tree` compare (REQ-OPS-04), with no apply call.
- [ ] `renderReport(report, { json: true })` returns parseable JSON equal to the `RunReport`;
      `{ json: false }` returns the human per-agent/per-skill summary with a final exit-code line
      (REQ-OBS-01) and actionable failure lines naming path + remedy (REQ-OBS-02).
- [ ] No code path reads from `stdin` (REQ-DIST-02); `-y/--yes` is accepted and shown in help.
- [ ] An injected `throw` inside a core call surfaces via `main`'s boundary catch as a one-line
      `error: unexpected failure: …` on stderr and `EXIT.FAILURE` — never a bare stack alone
      (tech-spec §7).
- [ ] `node dist/cli.js --help` runs under plain Node ≥ 18 with zero runtime deps (`node:util`,
      `node:process` only).
