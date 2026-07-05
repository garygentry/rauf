# 03 — Target Resolution

> **Phase 2 — the target-resolution half.** Specifies the exported
> `resolveTarget()` resolver (context-aware, cwd-default, strict-in-machine-context)
> and the CLI wiring that consumes it in `handleStatus` / `handleStatusFollow` /
> `handleFollow`. Builds on the contract types defined in
> [`00-core-definitions.md`](./00-core-definitions.md) §4 — those types are
> **referenced, never redefined here**. Traces to [`PRD.md`](./PRD.md) §3.4
> (REQ-SCOPE-01…05), §4.2 (REQ-SAFE-01/02), §9 (REQ-SUCCESS-04) and
> [`tech-spec.md`](./tech-spec.md) §3.5, §7. Placement/exports per
> [`01-architecture-layout.md`](./01-architecture-layout.md) §4, §5 (rows 9–11).

The companion prescription half of Phase 2 (the `drive-rauf-loop` poll recipe) is
[`05-supervision-recipe.md`](./05-supervision-recipe.md). The item-level `follow`
feed and `--all` **rendering** detail belong to
[`04-event-altitude-follow.md`](./04-event-altitude-follow.md); this doc owns only
`--all` as a *resolution front door* (§6).

---

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-SCOPE-01 | Machine context: missing/ambiguous target is a hard error | 3.1, 3.3, 4 |
| REQ-SCOPE-02 | TTY: default root to cwd; one active root used; several → pick list | 3.2, 3.3 |
| REQ-SCOPE-03 | Bare `status` cwd → `--all` broadening when no local live loop | 5 |
| REQ-SCOPE-04 | Machine-wide `--all` front door; `--all --json` is human/tooling scope | 6 |
| REQ-SCOPE-05 | Scope axis: default → `--backlog` → all roots → `--all` | 3.3, 6 |
| REQ-SAFE-01 | Sandbox containment delegated to `resolveBacklogRoot` — never reimplemented | 2, 4 (`outside_sandbox`) |
| REQ-SAFE-02 | Strict machine-context resolution IS the safety property | 3.1, 4 |
| REQ-SUCCESS-04 | Ambiguous target in machine context = hard error, not silent wrong-root scan | 3.1, 4, 7 |
| C-01 | `resolveTarget` lives in `core`; zero `cli`/`web` imports | 1, 2 |
| C-06 | Single-explicit-backlog-per-agent makes `<root>` + `--backlog` addressing cheap | 3.1, 8 |

---

## 1. Purpose & Scope

`resolveTarget()` centralizes the **one** decision that today is duplicated and
under-specified across every read command: *given the CLI's arguments and its
output context, which single backlog root (if any) does this invocation address?*

Today `status` / `follow` / `log` each **require** a positional `<path>` and, if
it is missing, emit an ad-hoc `USAGE` message with **no `--json` error path**
(`status-commands.ts:46`, `follow-command.ts:54`). That gap means a machine caller
that omits the target gets human prose on stderr, not a structured error. It also
means there is **no cwd default** for a human at a terminal, and **no guard** that
prevents an implicit scan from silently picking the wrong root in a machine
context.

`resolveTarget()` replaces that scattered logic with a single context-aware
resolver whose behavior is:

- **Machine context** (`--json` OR non-TTY stdout, D5) — a missing or ambiguous
  target is a **hard `Result` error** (REQ-SCOPE-01, REQ-SAFE-02, REQ-SUCCESS-04).
  Never an implicit scan.
- **TTY** — convenient: default the root to **cwd**; use the single active root if
  exactly one exists; return `kind:"ambiguous"` with candidates when several exist
  (REQ-SCOPE-02).
- **Always** — end in the existing sandbox containment check by delegating the
  final path join to `resolveBacklogRoot()` (REQ-SAFE-01).

**In scope:** the `resolveTarget()` function; its resolution algorithm across all
input combinations; the CLI wiring in `handleStatus` / `handleStatusFollow` /
`handleFollow`; the bare-`status` cwd→`--all` broadening; the `--all` front door as
a resolution short-circuit.

**Out of scope (owned elsewhere):** the `health` block (`02`); item-level `follow`
rendering and the sticky header (`04`); the `--all` **rendering** (`04`); the poll
recipe and decision tree (`05`); the interactive pick-list UI beyond "render
`candidates` and re-invoke with a chosen root" (`04`). Tests live in
[`06-testing-strategy.md`](./06-testing-strategy.md).

---

## 2. File home — co-located in `backlog-root.ts` (DECISION)

**Decision:** `resolveTarget()` and its contract types are added to the existing
`packages/core/src/backlog-root.ts`, **not** a new `target-resolution.ts`.

This ratifies the tech-spec §3.5 / OTQ-1 **leaning** and overrides the open
alternative. **Rationale:**

1. **The load-bearing part is the sandbox containment check**, and that seam
   already lives in `backlog-root.ts` — `resolveBacklogRoot()` at
   `backlog-root.ts:94` performs the `path.resolve()` + `validatePath()`
   containment that `resolveTarget()` **must** delegate to (REQ-SAFE-01). Splitting
   resolution across two files would put the context-aware caller in one module and
   the safety-critical join in another, inviting drift on the exact property this
   feature exists to harden.
2. `resolveTarget()` also delegates to `resolveBacklogPaths()`
   (`backlog-root.ts:128`) for existence + `backlog.json` location, and reuses
   `DEFAULT_ROOT_DIR` (`:22`) — all already in this module. Co-location keeps the
   whole "arguments → validated concrete root" pipeline in one cohesive file.
3. Lower churn: no new file, no new barrel entry beyond the four new symbols
   (`01-architecture-layout.md` §4 already lists them under `backlog-root.ts`).

The only import `resolveTarget()` adds to `backlog-root.ts` is
`listActiveLoops` from `./loop-registry.js` (for TTY enumeration, §3.2). That is a
`core → core` import — **C-01 is preserved** (no `cli`/`web` import). `core` stays
free of any `process`/TTY probing: the CLI computes `isMachineContext` / `isTTY`
and passes them in (`00-core-definitions.md` §4.1).

---

## 3. Public API — `resolveTarget()`

The contract **types** — `ResolveTargetOptions`, `ResolvedTarget`, `TargetError`,
`TargetErrorCode` — are defined in `00-core-definitions.md` §4.1–4.3 and are
**imported/re-exported, not redefined**. This section specifies the **function**
and its algorithm.

```ts
// packages/core/src/backlog-root.ts  (added)

import { listActiveLoops } from "./loop-registry.js";
import type { ActiveLoopEntry } from "./schemas.js";
// ResolveTargetOptions / ResolvedTarget / TargetError / TargetErrorCode are
// declared in this module per 00-core-definitions.md §4 (co-located here).

/**
 * Resolve the CLI arguments + output context to a single backlog target, or a
 * structured reason it cannot be resolved.
 *
 * Context-aware (REQ-SCOPE-01/02, D5):
 *  - **Machine context** (`opts.isMachineContext` — `--json` OR non-TTY stdout):
 *    a missing or ambiguous target is a HARD ERROR (`missing_target` /
 *    `ambiguous_target`). Never scans implicitly — that would risk silently
 *    acting on the wrong backlog (REQ-SAFE-02, REQ-SUCCESS-04).
 *  - **TTY**: defaults `root` to cwd; if exactly one active root is live, uses it;
 *    if several, returns `kind:"ambiguous"` with `candidates` for the CLI to
 *    render as a pick list.
 *
 * The final (root, backlogDir) always flows through `resolveBacklogRoot()` +
 * `resolveBacklogPaths()`, so the sandbox containment check is NEVER
 * reimplemented here (REQ-SAFE-01). A containment failure surfaces as
 * `outside_sandbox`; a non-existent root as `not_found`.
 *
 * Pure except for the filesystem reads already done by the delegates
 * (`resolveBacklogPaths` stat, `listActiveLoops` registry read) — no subprocess,
 * no `process`/TTY probing (the caller supplies context flags).
 *
 * @param opts - Path/flag args + machine-context/TTY flags (00 §4.1).
 * @returns ok(ResolvedTarget) on success; err(TargetError) on a hard failure.
 */
export function resolveTarget(
  opts: ResolveTargetOptions,
): Result<ResolvedTarget, TargetError>;
```

### 3.1 Resolution algorithm — numbered branches

Let `pathArg`, `backlogFlag`, `isMachineContext`, `isTTY` be the `opts` fields.

1. **Explicit `pathArg` given** (the agent's canonical, unambiguous form — C-06):
   1. `root0 = pathArg`.
   2. Delegate to `resolveBacklogRoot(root0, backlogFlag)` — see §4 for the
      error mapping (`PATH_VIOLATION → outside_sandbox`). On error, return it.
   3. Delegate to `resolveBacklogPaths(root0, <resolved root>)` — this does the
      directory-exists + `backlog.json`-locate check. On `FILE_NOT_FOUND`, return
      `not_found`. On `PATH_VIOLATION`, return `outside_sandbox`.
   4. Return `ok({ kind: "resolved", root: paths.projectPath, backlogDir: paths.root })`.
   > **Explicit `pathArg` is context-independent:** once a path is given, machine
   > vs. TTY does not change the outcome. Strictness only governs the *no-path*
   > case (steps 2–3).

2. **No `pathArg`, `isMachineContext === true`** (REQ-SCOPE-01, REQ-SAFE-02):
   - Return `err({ code: "missing_target", message, offending: undefined })`.
   - **Never** consult `listActiveLoops()` or cwd — a machine caller MUST pass an
     explicit `<root>` (+ optional `--backlog <dir>`). This is the wrong-root
     safety guard (REQ-SUCCESS-04).

3. **No `pathArg`, `isTTY === true`** (REQ-SCOPE-02):
   1. `active = listActiveLoops()`. On the (rare) `IO_ERROR`, treat as **zero
      active loops** (fall through to 3.b) — a registry read failure must not block
      the convenient cwd default; the containment check still runs.
   2. Branch on the live-loop count:
      - **exactly one active loop** → resolve *that* loop's root (delegate its
        `entry.projectPath` + `entry.backlogRoot` through `resolveBacklogRoot` /
        `resolveBacklogPaths` for the same containment guarantee) and return
        `kind:"resolved"`.
      - **several active loops** → return
        `ok({ kind: "ambiguous", candidates: active })`. The CLI renders the pick
        list (`04`); ambiguity is a normal, resolvable state on a TTY — **not** an
        error.
      - **zero active loops** → default `root0 = process.cwd()` **(supplied by the
        CLI as `pathArg` is absent — see the note below)**; run steps 1.2–1.4 of
        branch 1 against cwd. If cwd has no installed backlog, `resolveBacklogPaths`
        yields `not_found`, which the caller renders (a TTY user then re-runs with
        an explicit path or `--all`, see §5).

4. **Neither machine nor TTY** (`isMachineContext === false && isTTY === false`):
   this combination cannot occur — `isMachineContext = json || !isTTY`, so
   `!isTTY` already implies `isMachineContext === true` and is handled by branch 2.
   The type permits it; the implementation treats it identically to branch 2
   (machine strictness) as a defensive default.

> **cwd source note.** To keep `core` free of `process` probing (C-01 spirit /
> `00` §4.1), the **CLI** passes cwd as `pathArg` before calling `resolveTarget`
> whenever it wants the cwd default *and* the context is a TTY (i.e. bare
> `status`). Equivalently, the resolver treats "TTY, no `pathArg`, zero active
> loops" as "resolve cwd" and the CLI has already set `opts.pathArg =
> process.cwd()` for that path. Either wiring is acceptable; §5 specifies the CLI
> side concretely. What matters: cwd defaulting happens **only** on a TTY with no
> explicit path, never in machine context.

### 3.2 TTY enumeration source

The `candidates` in a `kind:"ambiguous"` result are exactly
`listActiveLoops()`'s reconciled, machine-wide live-loop entries
(`loop-registry.ts:129`) — the same reconciled registry the `--all` front door
uses (§6). Each is an `ActiveLoopEntry` (`schemas.ts:757`) carrying `stateDir`,
`projectPath`, `backlogRoot`, `pid`, `startedAt`, and an advisory `status`. No new
scan and no new data source (REQ-CMD-05 discipline).

### 3.3 Decision table (all input combinations)

`P` = `pathArg` present · `B` = `backlogFlag` present · `M` = `isMachineContext` ·
`T` = `isTTY` · `#A` = number of active loops from `listActiveLoops()`.

| P | M | T | #A | Outcome |
|---|---|---|-----|---------|
| ✔ | any | any | any | Resolve `pathArg` (+`B`) via `resolveBacklogRoot`/`resolveBacklogPaths` → `resolved` \| `not_found` \| `outside_sandbox` |
| ✘ | ✔ | ✘ | any | `err(missing_target)` — hard fail (REQ-SCOPE-01) |
| ✘ | ✔ | ✔ | any | `err(missing_target)` — `--json` on a TTY is still machine context (D5) |
| ✘ | ✘ | ✔ | 1 | Resolve the single active loop's root → `resolved` |
| ✘ | ✘ | ✔ | ≥2 | `ok(ambiguous, candidates)` — TTY pick list |
| ✘ | ✘ | ✔ | 0 | Resolve **cwd** (+`B`) → `resolved` \| `not_found` |

> `M` and `T` are not independent: `M = json || !T`. The row `✘/✘/✔` (not machine,
> TTY) only occurs when `--json` is absent. `--json` on a TTY sets `M = true` and
> falls in the `missing_target` row — the agent contract wins over TTY convenience.

---

## 4. Error Handling

`resolveTarget()` returns `Result<ResolvedTarget, TargetError>` and **never
throws** for an expected condition (project convention). `TargetError` /
`TargetErrorCode` are defined in `00-core-definitions.md` §4.3. Each variant, its
exact trigger, and its CLI rendering:

| `code` | Exact condition | `message` (example) | `offending` | CLI render | Exit |
|--------|-----------------|---------------------|-------------|------------|------|
| `missing_target` | No `pathArg` **and** `isMachineContext` (branches 2, 4) | `"A target root is required in machine context (--json or non-TTY). Pass <root> [--backlog <dir>]."` | `undefined` | `outputJson({ error })` under `--json`; else `error(message)` | `USAGE(2)` |
| `ambiguous_target` | Only reachable if a caller forces machine-context enumeration (see note) | `"Multiple live loops found; specify <root> --backlog <dir>."` | `undefined` | `outputJson({ error })` / `error(message)` | `USAGE(2)` |
| `not_found` | Delegated `resolveBacklogPaths` returns `FILE_NOT_FOUND` (root dir absent, or no `backlog.json` in root/stateDir) | `"No rauf backlog found at '<root>'."` | the offending root | `outputJson({ error })` / `error(message)` | `USAGE(2)` |
| `outside_sandbox` | Delegated `resolveBacklogRoot`/`resolveBacklogPaths` returns `PATH_VIOLATION` (containment failure, REQ-SAFE-01) | `"Target '<path>' is outside the project root."` | the offending path | `outputJson({ error })` / `error(message)` | `USAGE(2)` |

**Mapping delegate errors → `TargetError`.** `resolveTarget` never runs its own
`path.resolve` + `startsWith`; it maps the `RaufError.code` returned by the
existing delegates (`ErrorCodes` in `errors.ts`):

- `resolveBacklogRoot(...)` err with `code === PATH_VIOLATION` → `outside_sandbox`.
- `resolveBacklogPaths(...)` err with `code === PATH_VIOLATION` → `outside_sandbox`.
- `resolveBacklogPaths(...)` err with `code === FILE_NOT_FOUND` → `not_found`.
- Any other delegate `code` → `not_found` with the delegate's `message`
  (defensive default; no other codes are currently reachable from these two
  functions).

**On `ambiguous_target`.** In the algorithm above, ambiguity in machine context
cannot arise from `resolveTarget` itself, because branch 2 returns
`missing_target` **before** enumerating (a machine caller with no path fails fast).
`ambiguous_target` exists in the type surface (`00` §4.3, §5) so that a future or
alternative caller which *does* enumerate in machine context has the correct hard-
fail code available, and so the CLI's error switch is exhaustive. The resolver
guarantees: **in machine context, no path ⇒ `missing_target`; ambiguity is never
silently resolved.** (REQ-SUCCESS-04 is satisfied by `missing_target`.)

**CLI rendering rule (all four codes).** This closes the current gap where a
missing positional arg has **no `--json` error path** (`status-commands.ts:46`):

```ts
// in each handler, after resolveTarget(...)
if (!res.ok) {
  if (ctx.globalFlags.json) outputJson({ error: res.error });
  else error(res.error.message);
  return ExitCode.USAGE; // = 2, from commands.ts:94
}
```

Every `TargetError` maps to `USAGE(2)` — a resolution failure is a
bad-args/precondition failure, consistent with the existing `USAGE` returns for
missing-arg and containment failures (`status-commands.ts:49,72`).

---

## 5. CLI wiring & the bare-`status` cwd→`--all` broadening (REQ-SCOPE-03)

`handleStatus` (`status-commands.ts:44`) is rewired to delegate targeting to
`resolveTarget`, replacing the `if (!targetPath) { error(...); return USAGE }`
preamble. The `--all` short-circuit (§6) and `--backlog`-specific path remain, but
the **no-`--all`** path now flows through the resolver.

**Context flags the CLI computes** (passed into `opts`, per `00` §4.1):

```ts
const isTTY = Boolean(process.stdout.isTTY);
const isMachineContext = ctx.globalFlags.json || !isTTY; // D5
```

**Rewired `handleStatus` control flow (no-`--all`):**

1. Compute `isTTY` / `isMachineContext`; read `backlogFlag`, `follow`, `interval`.
2. `res = resolveTarget({ pathArg: ctx.args[0], backlogFlag: backlogFlag ?? undefined, isMachineContext, isTTY })`.
   - The CLI supplies `pathArg = ctx.args[0]`. For **bare `status` on a TTY** (no
     `ctx.args[0]`), `resolveTarget` takes branch 3 (TTY, no path): single active
     root → resolved; several → `ambiguous`; zero → cwd default (§3.1).
3. On `!res.ok` → render per §4, return `USAGE`.
4. On `res.ok && res.value.kind === "ambiguous"` → render the candidate pick list
   (delegated to `04`'s renderer) and return `SUCCESS`; on a machine context this
   branch is unreachable (branch 2 already errored).
5. On `res.ok && res.value.kind === "resolved"` → build `BacklogPaths` from
   `{ root, backlogDir }` via `resolveBacklogPaths`, then proceed exactly as today:
   `deriveStatus` → `--json` `outputJson` / TTY `printStatusSummary` → `statusExitCode`.
   (`--follow` forwards `{ root, backlogDir }` to `handleStatusFollow`, §7.)

**Bare-`status` cwd → `--all` broadening (REQ-SCOPE-03, D2).** When there is **no
local live loop**, bare `status` broadens to the machine-wide `--all` view rather
than dead-ending on "no loop here":

- The broadening fires **only** on a **TTY** with **no explicit `pathArg`** and
  **no `--backlog`** (the true "bare `status`" invocation). It never fires in
  machine context (a machine caller already got `missing_target`) and never when
  the user named a target.
- "No local live loop" is determined from the resolved cwd target: after step 5
  derives status for the cwd root, if `deriveStatus` reports **no live loop**
  locally (`loopState` is terminal/idle **and** the cwd is not a live root) **and**
  `listActiveLoops()` returns **≥1** loop elsewhere, `handleStatus` additionally
  invokes `handleStatusAll(ctx.globalFlags.json)` to surface those loops, then
  returns its exit code.
- If cwd itself has a live loop, **no broadening** — the local loop is the answer.
- If cwd has no installed backlog at all (`not_found` from branch 3's cwd
  default), the existing empty-is-never-silent surfacing
  (`renderInspectedStatus` / `surfaceInspectedDir`, `status-commands.ts:124,187`)
  already names the directory and any loop live elsewhere; the broadening
  composes with — does not replace — that footer.

> **Relationship to the existing footer.** Today's "A loop is live in another
> backlog root" footer (`renderInspectedStatus`, `:204`) is the *empty-dir*
> surfacing. REQ-SCOPE-03's broadening is the *installed-but-idle-cwd* case: cwd
> has a backlog but no live loop, and another root does — broaden to `--all`. The
> two are complementary; keep both.

---

## 6. The `--all` front door (REQ-SCOPE-04, REQ-SCOPE-05)

`--all` is an **unchanged** resolution short-circuit: when `extractBoolFlag(ctx.flags,
"all")` is set, `handleStatus` calls `handleStatusAll(ctx.globalFlags.json)`
(`status-commands.ts:60,225`) **before** any `resolveTarget` call. `--all` needs no
single-root resolution — it enumerates *every* live loop via the reconciled
registry `listActiveLoops()` (`loop-registry.ts:129`).

- **Mechanism unchanged.** `handleStatusAll` reads `listActiveLoops()`, then:
  `--json` → `outputJson({ loops: live.value })`, `SUCCESS`; TTY → the
  `Live loops (machine-wide):` list. This doc does not alter that surface; the
  humane rendering refinements (if any) belong to `04`.
- **`--all --json` is human/tooling scope, NOT the agent contract (REQ-SCOPE-04).**
  Its shape is `{ loops: ActiveLoopEntry[] }` — a *cross-loop enumeration*, deliberately
  distinct from the single-loop `DerivedStatus` an agent polls. An agent drives
  exactly one backlog and MUST use `status <root> --backlog <dir> --json`
  (the single-loop contract, PRD §7 "no cross-loop control for agents"). `--all`
  answers the human's "show me every live loop" (REQ-SUCCESS-03), not an agent's
  next-action decision.
- **Scope axis (REQ-SCOPE-05).** The four scope forms are consistently supported:
  default root (`.rauf/`, via cwd/`pathArg`) → named backlog (`--backlog <dir>`) →
  all backlog roots in a repo (existing `scanActiveRoots` footer, `:156`) → all
  live loops on the machine (`--all` / `listActiveLoops`). `resolveTarget` owns the
  first two; the footer and `--all` own the last two.

---

## 7. `handleStatusFollow` & `handleFollow` wiring

Both live-view entry points require a target today via the same
`resolveBacklogRoot` preamble (`status-commands.ts:461`, `follow-command.ts:66`)
and share the same missing-`--json`-error-path gap. Both are rewired identically.

**`handleStatusFollow` (`status-commands.ts:439`).** Its caller `handleStatus`
already resolves the target (§5 step 5) before entering follow, so the cleanest
wiring passes the **already-resolved** `{ root, backlogDir }` in rather than
re-resolving inside the polling closure. Recommended signature change:

```ts
// was: (projectPath, intervalSeconds, backlogFlag, json)
async function handleStatusFollow(
  root: string,        // resolved, sandbox-validated project root
  backlogDir: string,  // resolved backlog/state root under `root`
  intervalSeconds: number,
  json: boolean,
): Promise<number>;
```

The per-tick body still calls `resolveBacklogPaths(root, backlogDir)` +
`deriveStatus` (unchanged), but no longer re-derives the root each tick. If a
future caller invokes `handleStatusFollow` directly without a pre-resolved target,
it MUST call `resolveTarget` first and render a `TargetError` per §4 before
entering the poll loop — a follow loop must never start against an unresolved or
out-of-sandbox target.

**`handleFollow` (`follow-command.ts:52`).** Replace the
`if (!targetPath) { … USAGE }` + `resolveBacklogRoot` preamble with:

```ts
const isTTY = Boolean(process.stdout.isTTY);
const res = resolveTarget({
  pathArg: ctx.args[0],
  backlogFlag: extractStringFlag(ctx.flags, "backlog") ?? undefined,
  isMachineContext: ctx.globalFlags.json || !isTTY,
  isTTY,
});
if (!res.ok) {
  if (ctx.globalFlags.json) outputJson({ error: res.error });
  else error(res.error.message);
  return ExitCode.USAGE;
}
if (res.value.kind === "ambiguous") {
  // render pick list (04); a machine ctx never reaches here
  return renderAmbiguous(res.value.candidates); // → SUCCESS
}
const pathsResult = resolveBacklogPaths(res.value.root, res.value.backlogDir);
// … existing followEvents(pathsResult.value, { json, intervalSeconds })
```

This makes `follow [root]` optional on a TTY (cwd default) and gives `follow
--json` with no target a **structured** `missing_target` error instead of stderr
prose — closing the gap for the item-feed/diagnostic agent case too. The
item-level filtering and sticky header applied inside `followEvents` are owned by
`04`; this doc changes only the *targeting* preamble.

> **Note — `outputJson` is not currently imported in `follow-command.ts`.** Add it
> to the `@rauf/core`-adjacent `./formatter.js` import (`formatter.ts:113`) when
> wiring the `--json` error path.

---

## 8. Example usage

```ts
// Agent (machine) — canonical, unambiguous single-loop poll (C-06):
resolveTarget({ pathArg: "/proj", backlogFlag: "specs/auth",
                isMachineContext: true, isTTY: false });
// → ok({ kind:"resolved", root:"/proj", backlogDir:"/proj/specs/auth" })

// Agent forgot the target under --json:
resolveTarget({ isMachineContext: true, isTTY: true });   // --json on a TTY
// → err({ code:"missing_target", message:"A target root is required …" })
//   CLI: outputJson({ error }) ; exit USAGE(2)

// Human at a terminal, one loop live:
resolveTarget({ isMachineContext: false, isTTY: true });  // #A === 1
// → ok({ kind:"resolved", root:"<that loop's root>", backlogDir:"…" })

// Human, several loops live:
resolveTarget({ isMachineContext: false, isTTY: true });  // #A ≥ 2
// → ok({ kind:"ambiguous", candidates:[…ActiveLoopEntry…] })  // CLI picks

// Human, cwd out of sandbox via --backlog:
resolveTarget({ pathArg: "/proj", backlogFlag: "../escape",
                isMachineContext: false, isTTY: true });
// → err({ code:"outside_sandbox", message:"… outside the project root", offending:"…/escape" })
```

---

## Dependencies

**Must be implemented first:**

- **[`00-core-definitions.md`](./00-core-definitions.md) §4** — defines
  `ResolveTargetOptions`, `ResolvedTarget`, `TargetError`, `TargetErrorCode`, and
  the `resolveTarget` signature. This doc specifies their behavior; it does not
  redefine them.
- **[`01-architecture-layout.md`](./01-architecture-layout.md) §4, §5** — placement
  (`backlog-root.ts`), the export table, and integration-map rows 9–11.

**Consumes existing, unchanged core surfaces** (verified from source):

- `resolveBacklogRoot(projectPath, backlogFlag?): Result<string>` —
  `packages/core/src/backlog-root.ts:94` (final path join + `validatePath`
  containment; the seam `resolveTarget` delegates to — REQ-SAFE-01).
- `resolveBacklogPaths(projectPath, backlogRoot): Result<BacklogPaths>` —
  `backlog-root.ts:128` (dir-exists + `backlog.json` locate; source of
  `not_found`).
- `listActiveLoops(): Result<ActiveLoopEntry[]>` —
  `packages/core/src/loop-registry.ts:129` (reconciled machine-wide live loops;
  TTY enumeration + `--all`).
- `scanBacklogRoots(projectPath): Result<BacklogRootEntry[]>` —
  `backlog-root.ts:317` (available for repo-wide root listing; the existing
  `scanActiveRoots` footer covers the current CLI need).
- `validatePath`, `ErrorCodes` (`PATH_VIOLATION`, `FILE_NOT_FOUND`), `Result`/`ok`/
  `err` — `packages/core/src/fs-utils.ts:191`, `errors.ts:9,21`.
- `ActiveLoopEntry` type — `packages/core/src/schemas.ts:757`
  (`ActiveLoopEntrySchema` `:656`).

**CLI-side consumers** (verified from source):

- `handleStatus` (`packages/cli/src/status-commands.ts:44`), `handleStatusAll`
  (`:225`), `handleStatusFollow` (`:439`), `handleFollow`
  (`packages/cli/src/follow-command.ts:52`).
- `ExitCode` (`packages/cli/src/commands.ts:91` — `USAGE = 2`, `:94`),
  `outputJson` / `error` (`packages/cli/src/formatter.ts:113`).

---

## Verification

- [ ] `resolveTarget` is exported from `packages/core/src/backlog-root.ts` and
      importable from `@rauf/core`; its type is
      `(opts: ResolveTargetOptions) => Result<ResolvedTarget, TargetError>`.
- [ ] The only new import added to `backlog-root.ts` is `listActiveLoops` from
      `./loop-registry.js` (a `core → core` import) — `core` still has zero
      `cli`/`web` imports (C-01):
      `grep -rE "from \"\.\./(cli|web)" packages/core/src` returns nothing.
- [ ] **REQ-SCOPE-01 / REQ-SUCCESS-04:** `{ isMachineContext: true }` with no
      `pathArg` returns `err(missing_target)`; no `listActiveLoops` / cwd read
      occurs on that path (assert via a call spy).
- [ ] **REQ-SCOPE-02:** on a TTY with no `pathArg`, exactly one active loop →
      `kind:"resolved"` for that loop; several → `kind:"ambiguous"` with those
      candidates; zero → cwd default resolution.
- [ ] **REQ-SAFE-01:** `resolveTarget` contains no `path.resolve` + `startsWith`
      containment of its own; an out-of-root `pathArg`/`backlogFlag` yields
      `outside_sandbox` **via** `resolveBacklogRoot`/`resolveBacklogPaths`
      (`PATH_VIOLATION` mapped).
- [ ] All four `TargetErrorCode` variants are reachable and each maps to
      `USAGE(2)`; under `--json` each renders as `outputJson({ error })`, else a
      stderr `error()` — including the previously-missing missing-arg `--json` path.
- [ ] **REQ-SCOPE-03:** bare `status` on a TTY with an idle cwd backlog and ≥1 loop
      live elsewhere additionally surfaces `handleStatusAll`; with a live cwd loop
      it does **not** broaden.
- [ ] **REQ-SCOPE-04:** `--all` short-circuits before `resolveTarget`;
      `--all --json` emits `{ loops: ActiveLoopEntry[] }`, never a `DerivedStatus`.
- [ ] `handleStatus` / `handleStatusFollow` / `handleFollow` no longer emit the old
      ad-hoc `"Missing required argument: <path>"` string on the resolver path.
- [ ] `pnpm gate` is green at the tip of Phase 2.
