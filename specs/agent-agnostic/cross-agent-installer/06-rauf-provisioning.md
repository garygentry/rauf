# 06 — Rauf Provisioning (default loop runner)

> Feature: `cross-agent-installer` (epic `agent-agnostic`, member 4 of 6). Target repo:
> **feature-forge** (`/home/gary/workspace/feature-forge`); specs/backlog/loop driven from **rauf**.
> Source of truth: `PRD.md` (v2, REQ-RAUF-01..05, OQ-1, C-7) + `tech-spec.md` (v1, §3.1 [D1], §6 IR-2,
> §10 OQ-C). This document fixes **module `src/rauf.ts`**: the single pinned rauf coordinate
> (`RAUF_PIN`), the install-time **resolvability preflight**, the `--skip-rauf` escape, the fixed
> unavailable-pin failure mode, and the (vacuous) idempotency/reversibility argument.
>
> **Scope boundary.** This module makes rauf the *provisioned default* loop runner by **recording a
> pin** and **preflighting its resolvability** — it never vendors a binary, never mutates global npm
> state, and never invokes rauf. Actually *publishing* rauf is the cross-repo prerequisite **C-7**
> (owned by `packaging-docs-ci`); *wiring* the forge loop to invoke `npx rauf@<pin>` is
> `forge-rauf-loop-default`. Both are explicitly **out of scope** here.
>
> **Stack:** TypeScript, strict, **zero runtime dependencies** (only `node:` built-ins; this module
> uses `node:child_process` solely for the read-only `npm view` preflight). Named exports only. No
> throw for expected errors — returns `Result<T, E>` from `00-core-definitions.md`. All code below is
> exact TypeScript, never pseudocode.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-RAUF-01 | Post-install outcome: a runnable rauf the forge loop invokes as default | §2 (the lazy-npx contract), §4.1 (record pin), §4.2 (preflight) |
| REQ-RAUF-02 | Delivered as a published Node-ecosystem package via npm/npx, NOT a vendored binary (network permitted at install) | §2, §4.2 (read-only `npm view`), §6 (no-fallback rule) |
| REQ-RAUF-03 | Pin a specific known-compatible version — single source of truth `RAUF_PIN`, advanced per release | §3 `RAUF_PIN`, §7 (configuration) |
| REQ-RAUF-04 | Idempotent + reversible | §5 (vacuous-by-D1 argument) |
| REQ-RAUF-05 | rauf is the default but alternate runners not precluded | §2 (non-preclusion), §5 |
| OQ-1 | Install flow + explicit unavailable-pin failure mode | §2, §4.2, §6 |
| OQ-C | Final published coordinate confirmed by packaging-docs-ci; `RAUF_PIN` is correctable config | §7 |
| C-7 | Publishing rauf is a cross-repo prerequisite this feature MUST NOT own | §1 scope boundary, §6, §8 |
| REQ-OBS-02 | Actionable error (names coordinate + remedy) — the fixed failure text | §6 |
| REQ-OBS-03 | Partial failure: skills still install, overall run exits non-zero | §6 (cross-ref `07`) |

> This module *owns* REQ-RAUF-01..05 and OQ-1. It *contributes to* REQ-OBS-02/03: it produces the
> structured `RAUF_UNRESOLVABLE` error; mapping that error to an exit code and the run report is
> `07-cli-and-reporting.md`'s job.

## 1. Purpose & scope

`src/rauf.ts` is the **single source of truth for the pinned rauf coordinate** and the **install-time
resolvability gate**. It exists so a multi-agent install leaves the user with a *working default loop*
(REQ-RAUF-01) without the installer vendoring a per-platform binary (REQ-RAUF-02) or pinning to a
moving target (REQ-RAUF-03).

**In scope (this module):**

- `RAUF_PIN` — the one pinned coordinate, re-exported by `src/index.ts` (the library barrel).
- `preflightRauf(...)` — a read-only check that `rauf@<pin>` is resolvable from the npm registry, plus
  the `--skip-rauf` short-circuit.
- `RegistryQuery` — the injectable registry-query type so tests mock the registry (no real network).
- The fixed unavailable-pin failure message (§6).

**Out of scope (owned elsewhere — do not implement here):**

- **Publishing rauf** to npm (registry/package-name plumbing, a Node-runnable bin) — **C-7**, sequenced
  with `packaging-docs-ci`. Today rauf is *not* publishable (§8, IR-2); the preflight is *designed* to
  fail until that lands.
- **Invoking** the loop (`npx rauf@<pin> loop run …`) and passing agent selection through —
  `forge-rauf-loop-default` (REQ-RAUF-05).
- **Recording** `raufPin` into the persisted manifest — the *value* this module returns is written by
  `05-manifest-and-uninstall.md` (`InstallManifest.raufPin`).
- **Exit-code / report mapping** of `RAUF_UNRESOLVABLE` — `07-cli-and-reporting.md`.

## 2. The lazy-`npx` provisioning contract (REQ-RAUF-01/02/05) [D1]

The installer provisions rauf by **contract, not by copying**. Three properties define the contract:

1. **Pinned coordinate, recorded.** The installer pins exactly one coordinate, `RAUF_PIN`
   (= `"rauf@0.6.0"`, §3), and records it in each agent's install manifest as
   `InstallManifest.raufPin` (`05`) and in the run report (`07`). This recorded value is the stable
   string the downstream `forge-rauf-loop-default` reads to invoke the loop on demand —
   conceptually `npx rauf@<pin> loop run . --backlog <dir> [--iterations N] [--agent <id>]`
   (the verified rauf loop surface, §8). **This module does not invoke that command.**
2. **No vendored binary, no global mutation (REQ-RAUF-02; REQ-SEC-01).** rauf is delivered as a
   *published Node-ecosystem package* resolved through the same npm/npx machinery as the installer
   itself. The installer never writes a rauf binary into the install destination, never runs
   `npm install -g`, and never mutates the global npm prefix. Network at install time is permitted
   (C-7); offline install is explicitly not a requirement.
3. **Default, not exclusive (REQ-RAUF-05).** rauf is the *default* runner this feature provisions, but
   nothing here forecloses an alternate runner the forge loop config already supports. This module
   touches only the rauf pin; it adds no logic that assumes rauf is the *only* runner. Alternate-runner
   wiring is `forge-rauf-loop-default`'s concern.

> **Why the outcome (REQ-RAUF-01) is satisfied by recording + preflighting, not by vendoring.** "A
> runnable rauf the forge loop can invoke as default" is delivered by (a) a *resolvable* pinned
> coordinate (proven at install by the preflight, §4.2) and (b) the recorded pin the loop later runs
> via `npx`. The runnable artifact lives in the npm registry, fetched lazily at loop time — exactly the
> delivery shape REQ-RAUF-02/03 fix. See §5 for why this also satisfies REQ-RAUF-04.

## 3. Public API — `RAUF_PIN`

```typescript
/**
 * The single pinned rauf coordinate the install provisions as the default loop runner
 * (REQ-RAUF-03). One source of truth: re-exported by `src/index.ts` so importers and the
 * downstream `forge-rauf-loop-default` read the same value, and recorded into each manifest
 * as `InstallManifest.raufPin` (05-manifest-and-uninstall.md).
 *
 * Shape: `<name>@<version>` — UNSCOPED `rauf` (its published bin is already `rauf`, so
 * `npx rauf@<pin>` is the natural loop-invocation surface). Advanced on each feature-forge
 * release to a new known-compatible rauf (REQ-RAUF-03). The current rauf version is 0.6.0.
 *
 * Correctable config (OQ-C / tech-spec §10): the FINAL published coordinate (unscoped `rauf`
 * vs. an alternative) is confirmed by `packaging-docs-ci` when rauf's publish path is stood
 * up. Until then this resolves to a package that does not yet exist on npm (§8, IR-2), so the
 * preflight (§4.2) WILL fail — the known, designed failure mode, not a bug.
 */
export const RAUF_PIN = "rauf@0.6.0";
```

`RAUF_PIN` is a plain `string`-typed constant (its literal type widens at the `index.ts` re-export to
`string`, matching the `export const RAUF_PIN: string` surface declared in
`01-architecture-layout.md` §4 and `tech-spec.md` §5.2). Editing this one line is the entire mechanism
for advancing the pin (REQ-RAUF-03) or correcting the coordinate (OQ-C).

## 4. Public API — `preflightRauf` and `RegistryQuery`

### 4.1 Types

```typescript
/**
 * An injectable, READ-ONLY registry query (D1). Given a coordinate `name@version`, returns the
 * resolved version string on success, or an `InstallerError` if it is not resolvable.
 *
 * Injectable so tests mock the registry with NO real network (tech-spec §8): the default
 * implementation (`defaultRegistryQuery`, §4.3) shells `npm view <coordinate> version`; a test
 * passes a stub returning `ok("0.6.0")` or `err({ code: "RAUF_UNRESOLVABLE", ... })`.
 *
 * Contract: the query MUST be read-only — it MUST NOT install, MUST NOT mutate global npm state,
 * and MUST NOT execute rauf. `npm view` satisfies this (it only reads registry metadata).
 *
 * @param coordinate - the `name@version` to resolve, e.g. "rauf@0.6.0"
 * @returns Result<string> — the resolved version on success; RAUF_UNRESOLVABLE on failure.
 */
export type RegistryQuery = (coordinate: string) => Result<string>;

/** Options for the rauf preflight. */
export interface PreflightRaufOpts {
  /**
   * When true (the `--skip-rauf` flag, tech-spec §3.5), skip the preflight entirely: perform NO
   * network call and return `{ raufPin: null }`. For environments that knowingly defer rauf
   * (e.g. CI dry-runs while rauf is unpublished — §8 IR-2).
   */
  readonly skip?: boolean;
  /**
   * The registry query to use. Default: `defaultRegistryQuery` (`npm view rauf@<pin> version`
   * via node:child_process). Tests inject a stub so no real network call is made.
   */
  readonly query?: RegistryQuery;
}
```

> **`Result`, `ok`, `err`, `InstallerError`, and the `"RAUF_UNRESOLVABLE"` `ErrorCode` are imported
> from `00-core-definitions.md` (§7) — not redefined here.**

### 4.2 `preflightRauf`

```typescript
import { spawnSync } from "node:child_process";
import {
  err,
  ok,
  type InstallerError,
  type Result,
} from "./types.js"; // re-exports of 00-core-definitions

/**
 * Resolvability preflight for the pinned default loop runner (D1; REQ-RAUF-01/02/03, OQ-1).
 *
 * Behavior:
 *  - `opts.skip` (the `--skip-rauf` flag) ⇒ return `ok({ raufPin: null })` immediately, with NO
 *    network call. The caller records `raufPin: null` in the manifest (05) and reports that the
 *    default loop was not provisioned.
 *  - otherwise ⇒ run a READ-ONLY registry resolvability check on `RAUF_PIN` (default query:
 *    `npm view rauf@<pin> version`). No install, no global-npm mutation, no execution of rauf.
 *      · resolvable  ⇒ return `ok({ raufPin: RAUF_PIN })` — the value the manifest records.
 *      · unresolvable ⇒ return `err(<RAUF_UNRESOLVABLE>)` carrying the FIXED message (§6).
 *
 * This function performs the ONLY network access in the whole installer (01 §3 dependency
 * direction: "only `rauf` touches the network"). It NEVER throws for the expected
 * unresolvable case — that is an `err(...)`. An unexpected spawn failure inside the default
 * query is normalized to the same `RAUF_UNRESOLVABLE` error (§4.3), so callers handle one code.
 *
 * @param opts - skip flag and/or an injected registry query (tests)
 * @returns Result<{ raufPin: string | null }>:
 *          ok + `raufPin: RAUF_PIN`  when resolvable,
 *          ok + `raufPin: null`      when skipped,
 *          err(RAUF_UNRESOLVABLE)    when the pin is not resolvable.
 */
export function preflightRauf(
  opts?: { skip?: boolean; query?: RegistryQuery },
): Result<{ raufPin: string | null }> {
  // --skip-rauf: no network, record null (tech-spec §3.1).
  if (opts?.skip) {
    return ok({ raufPin: null });
  }

  const query: RegistryQuery = opts?.query ?? defaultRegistryQuery;
  const resolved = query(RAUF_PIN);

  if (resolved.ok) {
    // Resolvable: record the pin. (We deliberately ignore the resolved version string here —
    // the recorded coordinate is RAUF_PIN itself, the single source of truth, REQ-RAUF-03.)
    return ok({ raufPin: RAUF_PIN });
  }

  // Unresolvable: the designed failure mode (§6). Surface the FIXED, actionable error.
  return err(raufUnresolvableError());
}
```

### 4.3 `defaultRegistryQuery` (internal) and the fixed error constructor

```typescript
/**
 * Internal: the default read-only registry query. Runs `npm view <coordinate> version` via
 * `node:child_process.spawnSync` — registry metadata read ONLY (no install, no global mutation,
 * no rauf execution). Network is permitted at install (C-7).
 *
 * Resolution rule:
 *  - exit code 0 AND non-empty stdout ⇒ ok(trimmed stdout) (the resolved version).
 *  - anything else (non-zero exit, the registry's `E404`, a spawn error, npm absent) ⇒
 *    err(RAUF_UNRESOLVABLE) with the fixed message. We do not distinguish 404 from other
 *    failures to the caller: all mean "the pinned default loop runner is not resolvable now".
 *
 * NOT exported as public API — `preflightRauf`'s `query` option is the seam tests use.
 */
function defaultRegistryQuery(coordinate: string): Result<string> {
  let res: ReturnType<typeof spawnSync>;
  try {
    res = spawnSync("npm", ["view", coordinate, "version"], {
      encoding: "utf8",
      // No shell; argv form avoids injection. Timeout bounds a hung registry (REQ-PERF-01 spirit).
      timeout: 30_000,
      windowsHide: true,
    });
  } catch {
    // spawn itself threw (e.g. npm not found on some platforms) — treat as unresolvable.
    return err(raufUnresolvableError());
  }

  if (res.error || res.status !== 0) {
    return err(raufUnresolvableError());
  }
  const version = (res.stdout ?? "").trim();
  if (version.length === 0) {
    return err(raufUnresolvableError());
  }
  return ok(version);
}

/**
 * Internal: builds the structured RAUF_UNRESOLVABLE error with the FIXED message (§6, REQ-OBS-02).
 * `<pin>` in the message is substituted with `RAUF_PIN`. Single constructor so the wording is
 * identical everywhere the failure can arise (preflight + default query).
 */
function raufUnresolvableError(): InstallerError {
  return {
    code: "RAUF_UNRESOLVABLE",
    message:
      "pinned default loop runner `" +
      RAUF_PIN +
      "` is not resolvable from the npm registry. Network is required at " +
      "install; if rauf is not yet published this is the known cross-repo " +
      "prerequisite (see packaging-docs-ci). Skills were still installed; " +
      "the default loop will be unavailable until rauf publishes.",
    remedy:
      "Ensure network access and that `" +
      RAUF_PIN +
      "` is published, or re-run with `--skip-rauf` to defer the default loop.",
  };
}
```

### 4.4 Example usage (from the install flow, owned by `07`)

```typescript
import { preflightRauf } from "./rauf.js";

// Inside the install command, after skills are materialized for all agents.
// `flags.skipRauf` comes from CliFlags (00-core-definitions §8).
const pre = preflightRauf({ skip: flags.skipRauf });

if (pre.ok) {
  // Record into every agent's manifest (05): pin string, or null when --skip-rauf.
  raufPinToRecord = pre.value.raufPin; // "rauf@0.6.0" | null
} else {
  // pre.error.code === "RAUF_UNRESOLVABLE": skills already installed; surface the fixed
  // message in the report and force a non-zero overall exit (REQ-OBS-03). 07 maps this to
  // EXIT.FAILURE — the run does NOT abort the per-agent skill installs that already happened.
  report.raufError = pre.error;
  raufPinToRecord = null; // nothing resolvable to record
}
```

Test usage (mocked registry — no real network, tech-spec §8):

```typescript
import { preflightRauf, RAUF_PIN } from "./rauf.js";
import { ok, err } from "./types.js";

// Resolvable: stub returns the version.
const resolvable = preflightRauf({ query: () => ok("0.6.0") });
// resolvable.ok === true && resolvable.value.raufPin === RAUF_PIN

// Unresolvable: stub returns the error.
const missing = preflightRauf({
  query: () => err({ code: "RAUF_UNRESOLVABLE", message: "stub", remedy: "" }),
});
// missing.ok === false && missing.error.code === "RAUF_UNRESOLVABLE"
// (the production message is supplied by preflightRauf, not the stub)

// Skipped: no query is consulted at all.
const skipped = preflightRauf({ skip: true, query: () => { throw new Error("must not run"); } });
// skipped.ok === true && skipped.value.raufPin === null
```

## 5. Idempotency & reversibility (REQ-RAUF-04) — satisfied vacuously by D1

REQ-RAUF-04 ("rauf bundling MUST be idempotent and reversible in line with the rest of the
installer") is satisfied **vacuously** by the D1 lazy-`npx` design, with **no rauf-specific filesystem
step**:

- **Idempotent.** Because rauf is *never written into the install destination* (no binary, no vendored
  package, no managed directory — §2), a re-run has nothing to duplicate. `preflightRauf` is a pure
  read (a registry query); running it again only re-records the *same* `RAUF_PIN`. Re-running install
  with no change provisions nothing new (consistent with REQ-IDEM-01, owned by `04`).
- **Reversible.** The *only* durable rauf trace is `InstallManifest.raufPin` (`05`,
  `00-core-definitions.md` §3). Uninstall removes the manifest (and the namespaced skills dir) per
  `05-manifest-and-uninstall.md`; clearing `raufPin` happens automatically with the manifest. There is
  no rauf binary, lockfile, or managed dir to clean up, so reversibility needs no rauf-specific code.
- **Alternate runners not precluded (REQ-RAUF-05).** Recording a pin and preflighting it adds no logic
  that assumes rauf is the only runner; the forge loop config remains free to select an alternate
  runner (wired by `forge-rauf-loop-default`).

This is why `src/rauf.ts` exports only `RAUF_PIN` + `preflightRauf` + `RegistryQuery` and touches **no
filesystem path** — provisioning rauf is a *record + check*, never a *write*.

## 6. The fixed unavailable-pin failure mode (OQ-1, REQ-OBS-02/03, C-7)

When the preflight cannot resolve `RAUF_PIN`, the installer **MUST** surface this **exact** message
(verbatim; `<pin>` substituted with the value of `RAUF_PIN`):

> pinned default loop runner `rauf@<pin>` is not resolvable from the npm registry. Network is required
> at install; if rauf is not yet published this is the known cross-repo prerequisite (see
> packaging-docs-ci). Skills were still installed; the default loop will be unavailable until rauf
> publishes.

Hard rules for this failure mode:

- **No silent degradation, no fallback (REQ-RAUF-02).** The installer **MUST NOT** fall back to a
  vendored binary, a bundled tarball, or any other rauf delivery shape. It records `raufPin: null` (no
  resolvable pin to record) and reports the failure.
- **Skills still install; overall run exits non-zero (REQ-OBS-03).** The rauf preflight failure is a
  *partial* failure: the per-agent skill installs that already succeeded are **not** rolled back. The
  message states "Skills were still installed". The overall process exit is **non-zero** — the
  `RAUF_UNRESOLVABLE` error maps to `EXIT.FAILURE` (1) at the CLI boundary. That exit-code + report
  mapping is owned by `07-cli-and-reporting.md`; this module only produces the structured error.
- **This is the designed state today, not a bug (C-7, §8 IR-2).** rauf is not publishable yet, so this
  failure is expected until the publish prerequisite lands. The `--skip-rauf` flag (§4) lets CI
  dry-runs proceed cleanly in the meantime by short-circuiting the preflight to `raufPin: null` with no
  network call.

## 7. Configuration — the pin and OQ-C

- **`RAUF_PIN` is the sole knob.** Advancing the pin on a new feature-forge release (REQ-RAUF-03) is a
  one-line edit to `src/rauf.ts`. No other module hard-codes a rauf coordinate; all read `RAUF_PIN`
  (re-exported by `src/index.ts`, `01` §4).
- **Coordinate finalization (OQ-C, tech-spec §10).** `RAUF_PIN` is currently `"rauf@0.6.0"` against an
  **unscoped** `rauf` package that does not exist on npm yet (§8). When `packaging-docs-ci` stands up
  rauf's publish path, it confirms the *final* coordinate (unscoped `rauf` vs. an alternative such as a
  scoped name) and that the published bin runs under **plain Node** (not Bun). Applying that decision
  is, again, a single edit to `RAUF_PIN`. This is correctable config — **not** an architectural change
  to this module.
- **No version drift between source and pin.** This module hard-codes `"rauf@0.6.0"`; the current rauf
  version (verified at `packages/core/src/version.ts` → `VERSION = "0.6.0"`, and `@rauf/cli`'s
  `package.json` → `0.6.0`) matches. When rauf releases a new version *and* feature-forge re-tests
  against it, bump `RAUF_PIN` in lockstep.

## 8. Verified ground truth (do not re-derive) — IR-2

The following is **source-verified** and fixed by the tech-spec; treat it as given:

- **rauf is NOT publishable today.** All five rauf packages are `private: true`; `@rauf/cli`'s bin
  shebang is `#!/usr/bin/env bun` (needs Bun at runtime, not Node — verified at
  `rauf/packages/cli/src/index.ts:1`); `packages/web` uses Bun-only APIs; distribution is
  `bun build --compile` → GitHub-Release platform binaries. **Nothing rauf is on npm.** Therefore
  `npm view rauf@0.6.0 version` (the default preflight, §4.3) **404s** and the preflight returns
  `RAUF_UNRESOLVABLE` until the **C-7** publish prerequisite lands. This is the **designed** failure
  mode (§6), not a defect.
- **Current rauf version is `0.6.0`** (verified: `rauf/packages/core/src/version.ts`,
  `rauf/packages/cli/package.json`). `RAUF_PIN` matches.
- **The verified rauf loop surface** the recorded pin is later run against (by
  `forge-rauf-loop-default`, *not* this module) is
  `rauf loop run [path] [--detached|-d] [--iterations <N>] [--agent <id>] [--backlog <dir>] …`
  (verified: `rauf/packages/cli/src/commands.ts` lines 173–226).

> **WARNING: `rauf@0.6.0` is not currently published to npm** (IR-2). The default `preflightRauf`
> will return `RAUF_UNRESOLVABLE` against the real registry until C-7 (`packaging-docs-ci`) publishes a
> Node-runnable rauf. This is expected; verify the final coordinate (OQ-C) before relying on the
> success path against the live registry.

## 9. Error handling

| Situation | Result | Code | Notes |
|-----------|--------|------|-------|
| `--skip-rauf` given (`opts.skip`) | `ok({ raufPin: null })` | — | No network call. Caller records `raufPin: null`. |
| `RAUF_PIN` resolvable (registry returns a version) | `ok({ raufPin: RAUF_PIN })` | — | Recorded in `InstallManifest.raufPin` by `05`. |
| `RAUF_PIN` not resolvable (404 / non-zero exit) | `err(...)` | `RAUF_UNRESOLVABLE` | Fixed message (§6); skills still installed; non-zero exit via `07`. |
| `npm view` spawn fails / npm absent | `err(...)` | `RAUF_UNRESOLVABLE` | Normalized to the same code — caller handles one failure shape. |
| Injected `query` returns `err(...)` (tests) | `err(...)` | `RAUF_UNRESOLVABLE` | `preflightRauf` supplies the production message; the stub's message is not propagated. |

- **No throw for expected errors.** Every expected outcome above is a `Result`. The default query wraps
  its `spawnSync` in try/catch and normalizes any throw to `RAUF_UNRESOLVABLE`, so `preflightRauf`
  itself never throws.
- **Read-only guarantee.** The only side effect this module performs is a `spawnSync("npm", ["view",
  …])` registry metadata read — no install, no global-prefix mutation, no rauf execution (REQ-RAUF-02,
  REQ-SEC-01). With `--skip-rauf` (or an injected query), there is no side effect at all.

## Dependencies

Must be implemented first / referenced:

- **`00-core-definitions.md`** — imports `Result`, `ok`, `err`, `InstallerError`, and the
  `ErrorCode` value `"RAUF_UNRESOLVABLE"`. `RAUF_PIN` is declared **here** (per `00` §6's note) and
  recorded into `InstallManifest.raufPin` (`00` §3).
- **`01-architecture-layout.md`** — `src/index.ts` re-exports `RAUF_PIN` (`01` §4); `src/rauf.ts` is
  module 10 in the layout (`01` §3); dependency direction confirms "only `rauf` touches the network".

Cross-references (consumers of this module's output):

- **`05-manifest-and-uninstall.md`** — writes the returned `raufPin` into `InstallManifest.raufPin`
  and clears it (with the manifest) on uninstall (the reversibility half of §5).
- **`07-cli-and-reporting.md`** — calls `preflightRauf` from the install flow, surfaces the fixed
  message, and maps `RAUF_UNRESOLVABLE` → `EXIT.FAILURE` (non-zero) while keeping already-installed
  skills (REQ-OBS-03). Also owns the `--skip-rauf` flag parsing (`CliFlags.skipRauf`, `00` §8).

External / cross-repo:

- **C-7 / OQ-C** — the published, Node-runnable rauf package is a cross-repo prerequisite owned by
  `packaging-docs-ci`; this module consumes it but MUST NOT own its release. **tech-spec §10 (OQ-C)**
  governs final-coordinate confirmation.

## Verification

An implementation matches this spec iff:

- [ ] `src/rauf.ts` exports `const RAUF_PIN = "rauf@0.6.0"` and `src/index.ts` re-exports it.
- [ ] `src/rauf.ts` exports `preflightRauf(opts?: { skip?: boolean; query?: RegistryQuery }):
      Result<{ raufPin: string | null }>` and the `RegistryQuery` type.
- [ ] `preflightRauf({ skip: true })` returns `ok({ raufPin: null })` and makes **no** network call
      (assert an injected query that throws is never invoked).
- [ ] With an injected query returning `ok("0.6.0")`, `preflightRauf({ query })` returns
      `ok({ raufPin: RAUF_PIN })`.
- [ ] With an injected query returning `err(...)`, `preflightRauf({ query })` returns
      `err({ code: "RAUF_UNRESOLVABLE", ... })` carrying the **fixed §6 message** (with `<pin>`
      substituted by `RAUF_PIN`) — regardless of the stub's message.
- [ ] The default query uses `node:child_process` (`spawnSync("npm", ["view", "rauf@0.6.0",
      "version"])`), performs **no** install / global mutation / rauf execution, and normalizes any
      non-zero exit or spawn error to `RAUF_UNRESOLVABLE`.
- [ ] `preflightRauf` never throws (the unresolvable case is an `err`, not an exception).
- [ ] No filesystem write occurs in `src/rauf.ts` (provisioning is record + check only — §5).
- [ ] `tsc --noEmit` passes under `strict` + `noUncheckedIndexedAccess` for this module.
