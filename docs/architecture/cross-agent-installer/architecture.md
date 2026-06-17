# Architecture

The installer is a single-process, zero-dependency Node CLI. Its design is shaped by
three safety guarantees: it **never writes outside an agent's sandbox**, it **never
mutates the source bundles**, and **every run is idempotent and exactly reversible**
via a manifest. Those guarantees drive the module layout below.

## Module graph

The dependency direction is strictly acyclic — `cli` at the top orchestrates; the
leaves (`types`, `agent-targets`, `hash`, `fsutil`) hold no cross-module state.

```
cli ──┬─ detect ──── agent-targets ── types
      ├─ source ───── hash ────────── (node:crypto)
      ├─ plan  ─────── manifest ────── fsutil
      ├─ apply ─────── fsutil
      ├─ rauf  ─────── (node:child_process spawnSync)
      └─ report
index  (library barrel — re-exports the public surface only)
```

| Module          | Responsibility                                                                                                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types`         | Shared types + constants: `AGENT_IDS`, `EXIT`, `MANIFEST_PREFIX`, `Scope`, `Mode`, `InstallManifest`, `PlannedAction`, `RunReport`, the `ErrorCode` union, and the `Result<T,E>` helpers. |
| `agent-targets` | The static per-agent config-dir map plus detection (`detectAgent`/`detectAgents`) and root/destination resolution (`resolveRoots`, `destinationFor`).                                     |
| `detect`        | Filesystem + advisory PATH probing that decides whether each agent is present.                                                                                                            |
| `source`        | Locates the `adapters/<agent>/` bundle (packaged copy or repo checkout, cwd-independent via `import.meta.url`) and integrity-checks its required paths. **Read-only.**                    |
| `hash`          | SHA-256 of file bytes — the basis for change and drift detection.                                                                                                                         |
| `plan`          | **Pure** planner: given the source tree, the destination, and the prior manifest, classify every path (add / change / unchanged / remove / skip-modified). No I/O.                        |
| `apply`         | Executes a plan through sandboxed, atomic primitives (copy mode = per-file; symlink mode = whole-dir link), then writes the manifest.                                                     |
| `manifest`      | Read/serialize the `.feature-forge.<scope>.json` manifest; compute drift against recorded SHA-256s.                                                                                       |
| `fsutil`        | The sandbox: `resolveWithin` containment, atomic `.tmp`→rename writes, symlink-safe removal, empty-dir pruning.                                                                           |
| `rauf`          | The rauf pin (`RAUF_PIN`) and the install-time resolvability preflight (`preflightRauf`, synchronous `spawnSync`).                                                                        |
| `report`        | Renders the `RunReport` as human text or `--json`, and formats structured errors one-line.                                                                                                |
| `cli`           | Arg parsing (`node:util.parseArgs`), subcommand dispatch, the `main()` boundary, and exit-code mapping.                                                                                   |

## Data flow (an `install` run)

1. **Parse** argv via `node:util.parseArgs` against the single `FLAGS` spec; resolve
   the subcommand (and aliases) and scope. Unknown subcommand/flag/agent → `USAGE`.
2. **Detect** the in-scope agents (`--agent` narrows to one; default is all detected).
   Zero detected → render "no agents detected" and exit `SUCCESS`.
3. **Preflight rauf** once (unless `--skip-rauf`): resolve `RAUF_PIN`. An unresolvable
   pin is reported but **non-fatal to the skill install**.
4. **Per agent:** locate + integrity-check the source bundle (`source`), read the prior
   manifest (`manifest`), and compute a **plan** (`plan`, pure). With `--dry-run`, stop
   here and report the plan.
5. **Apply** the plan (`apply`) through `fsutil` — every write goes through
   `resolveWithin` containment, the manifest is written `.tmp`→rename. A locally-modified
   destination is **skipped** (kept, reported) unless `--force`.
6. **Report** the aggregate `RunReport`; the process exit code is `FAILURE` if any agent
   failed, else `SUCCESS`.

`update`, `uninstall`, and `list` reuse the same detect → locate → plan spine;
`uninstall` plans removals from the manifest and deletes the manifest **last**;
`list` derives each agent's status (not-installed / up-to-date / out-of-date / drifted)
from the manifest without writing anything.

## Design decisions

- **Pure planner, effectful applier.** Separating classification (`plan`) from
  execution (`apply`) makes the hard part — deciding what changes — trivially testable
  and lets `--dry-run` be the _same_ plan minus the apply step.
- **Manifest as the contract.** Tracking installed paths + SHA-256 in
  `.feature-forge.<scope>.json` is what makes re-runs idempotent, uninstall exact (only
  manifest-tracked files), and drift detectable (a hand-edited destination differs from
  its recorded hash). Manifests are per-scope so project/global installs are independent.
- **Sandbox everything.** Every destination path is run through `resolveWithin`
  (`path.relative` + `..`-prefix check, not naive `startsWith`); a resolved path that
  escapes the agent root is a `PATH_ESCAPE` error, not a write. Removal uses `lstat`+
  `unlink` so symlinks are never followed out of the sandbox.
- **Source is read-only (C-3).** `source`/`hash` only read the `adapters/<agent>/`
  bundles; there is no write path into the source tree. The bundle's per-agent files
  (including `gemini-extension.json`) are treated uniformly — there is **no**
  agent-specific apply branch; copy vs symlink is a global `--mode` choice.
- **Atomic manifest writes.** The manifest is written to a `.tmp` file and `rename`d
  into place, so an interrupted run never leaves a half-written manifest.
- **rauf is external, and its absence is non-fatal.** The runner is a published bin
  resolved at install time, not vendored. A failed preflight degrades gracefully
  (skills install; `raufPin` recorded as the failure) rather than aborting the install.

## Errors

All expected failures are returned as a structured `InstallerError` (`Result<T,E>`,
never thrown), each with an `ErrorCode`: `USAGE`, `SOURCE_MISSING`, `SOURCE_INVALID`,
`PATH_ESCAPE`, `WRITE_DENIED`, `RAUF_UNRESOLVABLE`, `MANIFEST_CORRUPT`, and `UNEXPECTED`
(the `main()` boundary catch — one-line message, never a bare stack). `LOCALLY_MODIFIED`
is report-vocabulary only: a drifted destination is surfaced as a `skip-modified`
action, not an emitted error. `USAGE` maps to exit 2; every other code maps to exit 1.
