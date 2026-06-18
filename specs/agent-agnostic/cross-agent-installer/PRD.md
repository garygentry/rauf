# cross-agent-installer — Product Requirements Document

> Epic: `agent-agnostic` (member 4 of 6). Target repo: **feature-forge** (bundles **rauf**).
> Depends on: `forge-agent-adapters-build` (complete), `rauf-agent-cli-adapters` (complete).
> Downstream consumers: `forge-rauf-loop-default`, `packaging-docs-ci`.
> Specs/backlog/loop are driven from **rauf** (`specs/agent-agnostic/cross-agent-installer/`); implementation lands in **feature-forge** (see Constraints §5).

## 1. Problem Statement

The `forge-agent-adapters-build` feature produces a committed, self-contained `adapters/` tree:
one per-agent bundle for each of the five target agents — `adapters/{claude,codex,copilot,cursor,gemini}/`
— each containing that agent's native skill set (`skills/`), the transitive `references/` closure,
the `scripts/` resolver, sub-agent translations (`agents/`), and (for Gemini) a
`gemini-extension.json` manifest. Generation puts working artifacts *in the repo*, but nothing puts
them *on a user's machine*.

Today a developer who wants feature-forge under Codex, Copilot, Cursor, or Gemini — or even under
Claude outside the marketplace path — must manually figure out each agent's config directory, copy
the right bundle into it, and separately obtain a working loop runner. There is no detection, no
idempotent re-install, no clean uninstall, and no guarantee the autonomous loop works after install.
Without this, the epic's multi-agent promise stops at "the artifacts exist in the repo" and never
reaches "a user can run feature-forge under their agent of choice in one command."

This feature delivers the **packaging seam**: a cross-platform, zero-config CLI installer that
detects installed coding agents, installs the generated per-agent bundles idempotently
(add/update/uninstall/list), and bundles **rauf** as the default loop runner so that a multi-agent
install yields a *working loop out of the box* — not just installed skills.

## 2. User Stories

- As a **developer on any supported agent**, I want to run one command that detects my installed
  agents and installs feature-forge's skills into each, so that I can use the forge pipeline without
  manually locating config directories or copying files.
- As a **developer**, I want to preview exactly what an install/uninstall will do before it touches
  my machine (`--dry-run`), so that I can trust it before running it for real.
- As a **developer who re-runs the installer**, I want it to be idempotent — installing again with
  no changes does nothing, and `update` reconciles my install to the current adapters — so that
  re-running is always safe.
- As a **developer who hand-edited an installed skill**, I want the installer to detect my local
  changes and refuse to silently overwrite them (requiring `--force`), so that my edits are never
  lost.
- As a **developer cleaning up**, I want `uninstall` to remove exactly what the installer wrote and
  nothing else, so that my other skills and config files are untouched.
- As a **developer targeting one agent**, I want `--agent/-a` to scope the operation to a single
  agent, and `--global/-g` to choose between a project-local and a user-level install, so that I
  control where skills land.
- As a **CI system or scripted setup**, I want a non-interactive `-y` mode, so that the installer
  runs unattended.
- As a **first-time user**, I want the install to leave me with a working autonomous loop (rauf)
  ready for `forge-5-loop`, so that I don't have to separately install and wire a loop runner.
- As a **downstream consumer (`forge-rauf-loop-default`, `packaging-docs-ci`)**, I want a stable
  installer CLI and a per-agent detection map, so that the forge loop integration and the OS-matrix
  CI gate can rely on them.

## 3. Functional Requirements

### 3.1 Distribution & Invocation (`cross-agent-installer-cli`)

- **REQ-DIST-01**: The installer MUST be runnable as a zero-config, `npx`-style one-line command on
  a machine that has a Node runtime, with no prior checkout or build step required by the user.
  - Priority: P0
  - Notes: Node was chosen because it is already present for every Claude/Copilot/Cursor user and is
    cross-platform; this fixes the runtime constraint (see Constraints §5, C-6).
- **REQ-DIST-02**: The installer MUST run unattended in CI via a non-interactive flag (`-y`),
  assuming the default/confirmed answer to every prompt and never blocking on input.
  - Priority: P0
- **REQ-DIST-03**: The installer MUST present a single, discoverable CLI surface that enumerates its
  subcommands and flags from `--help`.
  - Priority: P1

### 3.2 Agent Detection (`agent-detection-map`)

- **REQ-DET-01**: The installer MUST provide a per-agent detection map covering the five target
  agents — **claude, codex, copilot, cursor, gemini** — recording, for each, the config
  directory(ies) to probe and the on-disk install destination for skills.
  - Priority: P0
- **REQ-DET-02**: An agent MUST be considered "detected/installed" primarily by the presence of its
  config directory (e.g. `~/.claude`, `~/.codex`, `~/.cursor`). CLI-on-PATH presence MAY be reported
  as secondary information but is not the primary detection signal.
  - Priority: P0
  - Notes: Skills install into config dirs, so config-dir presence is the signal that an install
    target actually exists. This also covers IDE/GUI agents (e.g. Cursor) that may have a config dir
    but no CLI.
- **REQ-DET-03**: When no agent is selected via `--agent`, the default scope of an operation MUST be
  **all detected agents**.
  - Priority: P0
- **REQ-DET-04**: When zero agents are detected, the installer MUST report this clearly (naming the
  config dirs it probed) and MUST NOT create agent config directories speculatively or fail with an
  opaque error.
  - Priority: P1
- **REQ-DET-05**: `agent-detection-map` is exposed as a **single surface** combining (a) the static
  per-agent table of config dir(s) to probe and on-disk install destination (REQ-DET-01) and (b) the
  detection behavior that applies it to a host (REQ-DET-02). Downstream consumers (`packaging-docs-ci`
  drives it for OS-matrix dry-runs, `forge-rauf-loop-default` may read it) MUST be able to obtain both
  the per-agent target paths and a per-agent detected/not-detected result from this one named surface.
  - Priority: P0
  - Notes: This reconciles the `kind: function` characterization in `epic-manifest.json` (the
    detection probe) with the static-table half — they are one exposed contract, not two.

### 3.3 Operations (add / update / uninstall / list)

- **REQ-OPS-01**: The installer MUST support an **install/add** operation that copies (or symlinks,
  per REQ-FLAG-03) each target agent's generated bundle from `adapters/{agent}/` into that agent's
  skills destination.
  - Priority: P0
- **REQ-OPS-02**: The installer MUST support an **update** operation that reconciles an existing
  install to the current `adapters/` content idempotently — adding new skills, refreshing changed
  ones, and removing skills the installer previously wrote that are no longer in canon.
  - Priority: P0
- **REQ-OPS-03**: The installer MUST support an **uninstall** operation that removes a prior install
  (see uninstall-safety, REQ-SAFE-01).
  - Priority: P0
- **REQ-OPS-04**: The installer MUST support a **list** operation that reports, per agent, whether it
  is detected, whether feature-forge is installed for it, and whether the install is up to date with
  the current adapters.
  - Priority: P0
- **REQ-OPS-05**: Every mutating operation (install/update/uninstall) MUST support `--dry-run`,
  printing the exact set of planned filesystem actions (per agent, per skill: create / overwrite /
  skip / remove) without making any change.
  - Priority: P0
- **REQ-OPS-06**: If a target agent is **detected** but its source bundle `adapters/{agent}/` is
  **absent or fails a minimal integrity check** (e.g. a checkout where adapters were never generated,
  or a partial generation), the installer MUST report this clearly — naming the agent and the expected
  source path — and MUST NOT write a partial install for that agent. It MUST continue with the other
  agents per the per-agent partial-failure rule (REQ-OBS-03).
  - Priority: P1
  - Notes: Symmetric to REQ-DET-04's zero-detection handling, but for the consumed-contract side: the
    agent exists on the machine, yet there is nothing valid to install for it. Closes the
    consumed-`adapters-output` seam (C-3).
- **REQ-OPS-07**: For the **Gemini** target, a successful install MUST leave a valid, agent-loadable
  `gemini-extension.json` in the install destination (Gemini's bundle carries this manifest in
  addition to its skills). The exact placement/merge mechanism is deferred (OQ-5); this requirement
  fixes the *outcome* that the manifest is present and loadable.
  - Priority: P1
  - Notes: Mirrors the REQ-RAUF-01-fixes-outcome / OQ-1-defers-shape pattern used for rauf bundling.

### 3.4 Flags & Scoping

- **REQ-FLAG-01**: The installer MUST support `--agent`/`-a` to scope an operation to a single named
  agent (one of the five). Absent the flag, the operation applies to all detected agents (REQ-DET-03).
  - Priority: P0
- **REQ-FLAG-02**: The installer MUST support `--global`/`-g` to select the **user-level** config dir
  as the install scope (e.g. `~/.claude/skills`); the default (no flag) MUST install into the
  **current project's** agent dir (e.g. `./.claude/skills`).
  - Priority: P0
- **REQ-FLAG-03**: The installer MUST support `--symlink` as an **opt-in** that links bundles instead
  of copying. The default MUST be **copy**; on Windows the installer MUST copy regardless (symlink is
  not assumed available).
  - Priority: P0
- **REQ-FLAG-04**: The installer MUST support `--force` to overwrite an install destination that
  would otherwise be skipped because it was locally modified (see REQ-IDEM-02).
  - Priority: P0
- **REQ-FLAG-05**: The installer MUST support `-y` for non-interactive confirmation (REQ-DIST-02).
  - Priority: P0

### 3.5 Idempotency & Conflict Handling

- **REQ-IDEM-01**: Re-running install/update with no canon or destination change MUST produce no
  filesystem changes and report "up to date" (idempotency).
  - Priority: P0
- **REQ-IDEM-02**: If an install destination already exists and has been **locally modified** (it
  differs from what this installer would write and is not a clean prior install tracked in the
  manifest), the installer MUST **skip it and report the skip**, and MUST NOT overwrite it unless
  `--force` is given.
  - Priority: P0
- **REQ-IDEM-03**: A clean prior install (matching the manifest) that is merely out of date MUST be
  refreshed by `update` without requiring `--force`.
  - Priority: P0

### 3.6 Install Manifest & Uninstall Safety

- **REQ-SAFE-01**: The installer MUST record what it wrote in a per-agent install **manifest** (the
  installed skill set and file inventory, plus copy-vs-symlink mode). `uninstall` MUST remove exactly
  the files/skills recorded in the manifest and MUST leave unrelated user files and untracked skills
  untouched.
  - Priority: P0
- **REQ-SAFE-02**: When uninstalling a symlinked install, the installer MUST remove the link itself
  (unlink) and MUST NOT delete the link's target (the repo's `adapters/` source).
  - Priority: P0
- **REQ-SAFE-03**: The manifest MUST be sufficient for `list` (REQ-OPS-04) and `update` (REQ-OPS-02)
  to distinguish installer-written content from user content and to detect drift.
  - Priority: P1

### 3.7 Rauf Bundling (default loop runner)

- **REQ-RAUF-01**: A multi-agent install MUST leave the user with a **runnable rauf** that the forge
  loop can invoke as its default runner — i.e. after install, the default loop path works without the
  user separately installing or wiring a loop runner ("working loop out of the box").
  - Priority: P0
  - Notes: The fixed requirement is the post-install outcome; delivery shape is constrained by
    REQ-RAUF-02/03/04 below.
- **REQ-RAUF-02**: rauf MUST be delivered as a **published package fetched through the Node
  ecosystem** (resolved/run via the same npm/npx machinery as the installer itself), NOT vendored as
  a per-platform binary in feature-forge. The installer MAY use the network at install time to
  obtain it (offline install is not a requirement — see Constraints §5, C-7).
  - Priority: P0
- **REQ-RAUF-03**: The install MUST provision a **specific, known-compatible rauf version** that the
  current feature-forge release is tested against (pinned), so the out-of-the-box default loop is
  reproducible and is not broken by an unexpected upstream rauf change. The pin is advanced on new
  feature-forge releases.
  - Priority: P0
- **REQ-RAUF-04**: rauf bundling MUST be **idempotent** and reversible in line with the rest of the
  installer: re-running does not duplicate it, and uninstall accounts for what bundling added (per
  the manifest, REQ-SAFE-01).
  - Priority: P1
- **REQ-RAUF-05**: rauf is the **default** runner the install provisions; this feature MUST NOT
  preclude alternate loop runners that the forge loop config already supports (alternate-runner
  wiring itself is owned by `forge-rauf-loop-default`).
  - Priority: P1

## 4. Non-Functional Requirements

### 4.1 Performance

- **REQ-PERF-01**: A full detect + install across all detected agents MUST complete in seconds (not
  minutes) on a typical machine, and `--dry-run`/`list` MUST be effectively instant (no network or
  build required for detection and planning).
  - Priority: P1

### 4.2 Security / Safety

- **REQ-SEC-01**: The installer MUST write only within detected agent config directories (user-level
  or project-local, per scope) and its own manifest location. It MUST NOT write outside those targets
  and MUST NOT require or request elevated privileges.
  - Priority: P0
- **REQ-SEC-02**: Path handling MUST be sandboxed: destinations MUST be resolved and validated to lie
  within the intended agent config dir before any write, so a malformed agent id or path cannot
  escape the target tree.
  - Priority: P0
- **REQ-SEC-03**: Symlink operations MUST never follow a link to delete or overwrite outside the
  intended target (reinforces REQ-SAFE-02).
  - Priority: P1

### 4.3 Observability

- **REQ-OBS-01**: Every operation MUST produce a clear per-agent, per-skill summary of what happened
  (created / overwritten / skipped-modified / unchanged / removed), and a non-zero exit on failure.
  - Priority: P0
- **REQ-OBS-02**: Errors MUST be actionable: a failure to detect, a permission denial, or a skipped
  conflict MUST name the agent, the path, and the remedy (e.g. "re-run with --force", "no write
  permission to <path>").
  - Priority: P0
- **REQ-OBS-03**: Partial failure MUST be handled per-agent: a failure installing one agent MUST NOT
  abort the others, and the final summary MUST report which agents succeeded and which failed, with a
  non-zero overall exit if any failed.
  - Priority: P1

### 4.4 Accessibility

- Not applicable — this feature is a CLI installer with no graphical end-user interface.

### 4.5 Scalability

- **REQ-SCALE-01**: Adding a new agent to the system (a new `adapters/{agent}/` bundle) MUST require
  only adding an entry to the detection map — no change to the install/update/uninstall/list logic.
  - Priority: P1
- **REQ-SCALE-02**: Adding a new skill to canon MUST require no installer change — the installer
  copies whatever skills the agent's bundle contains.
  - Priority: P1

## 5. Constraints

- **C-1 (target repo & cross-repo execution):** Implementation lands in
  `/home/gary/workspace/feature-forge`; this feature's specs/backlog/loop are driven from `rauf`. The
  forge-5-loop stage MUST use the validated native-in-feature-forge pattern (staged gitignored
  `.forge-loop/backlog.json` with absolute `specReferences`, run `rauf-stable loop run . --backlog
  .forge-loop` inside feature-forge, sync statuses back). rauf's `pnpm gate` does NOT apply to this
  feature's acceptance.
- **C-2 (verify command):** The feature's verification runs through feature-forge's
  `bash scripts/validate.sh`, extended to build and test the installer (so the installer's tests and
  any added toolchain steps are reachable through the single gate). There is no rauf `pnpm` gate for
  this work.
- **C-3 (consumes, read-only):** The installer consumes two things, both strictly read-only:
  (1) `adapters-output` — the generated `adapters/{agent}/` tree from `forge-agent-adapters-build` —
  which it copies/symlinks; and (2) the **published, runnable rauf** produced by `rauf-agent-cli-adapters`,
  which it provisions as the bundled default loop runner (per REQ-RAUF-02). The consumed rauf artifact
  is the *published bin*, NOT the `agent-cli-registry` code module: the installer never imports or
  drives that module, and §6 explicitly excludes rauf's internal adapter code (incl. `agent-cli-registry`)
  from this feature's scope. This feature MUST NOT modify the generator, canon, or rauf's adapter code.
  - **Manifest reconciliation note:** `epic-manifest.json` currently lists this feature's consume as
    `agent-cli-registry` from `rauf-agent-cli-adapters`. That contract entry mismodels what is actually
    consumed (the published runnable rauf bin, an *artifact*, not the registry *module*). The manifest
    `consumes` entry should be corrected to reflect the bundled rauf bin; flagged here for an
    epic-manifest update (V-001).
- **C-4 (Node toolchain in feature-forge):** Per REQ-DIST-01 the installer is a Node/`npx`-style
  package; feature-forge (today Python + bash tooling) gains a Node package for the installer. Any
  added toolchain MUST be provisioned so `bash scripts/validate.sh` and CI install/run it
  automatically — verification must not require manual setup.
- **C-5 (canon authority / Claude preference):** Claude Code's plugin + marketplace install path
  stays first-class and the *recommended* route for Claude users; the universal installer still
  supports the claude target. Everything the installer ships derives from the single canonical
  `adapters/` source, never hand-edited divergently.
- **C-6 (cross-platform):** Linux, macOS, and Windows are all first-class (REQ-FLAG-03 copy-default /
  symlink-opt-in encodes the Windows handling). The OS-matrix CI that exercises this is owned by
  `packaging-docs-ci`.
- **C-7 (rauf publish prerequisite & sequencing):** REQ-RAUF-02 requires rauf to be available as a
  published, Node-resolvable package with a runnable bin. rauf does not publish one today (it is a
  pnpm/Bun monorepo with a local `rauf-stable` binary). Standing up rauf's publish/release path is a
  cross-repo prerequisite that likely sequences with the `packaging-docs-ci` capstone; this feature
  consumes that published package and MUST NOT itself own rauf's release infrastructure. Network
  access at install time is permitted (no offline-install requirement).

## 6. Out of Scope

The following are explicitly owned by sibling epic members and are NOT part of this feature:

- **Generating the `adapters/` tree** — the generator (`build-adapters.py`) is
  `forge-agent-adapters-build`. The installer consumes `adapters/` read-only; it never generates it.
- **rauf's internal agent-adapter code** — the `AgentAdapter` abstraction, `agent-cli-registry`, and
  agent-selection surface live in rauf (`rauf-agent-cli-adapters`). The installer bundles/ships rauf
  but does not implement or modify its adapter layer.
- **forge-5-loop default-to-rauf wiring** — wiring the forge loop stage to default to rauf (and
  passing agent selection through) is `forge-rauf-loop-default`. The installer makes a runnable rauf
  available; it does not change forge-5-loop behavior.
- **Capstone CI gates & release concerns** — the OS-matrix CI running installer `--dry-run`/uninstall,
  trigger-accuracy evals, `claude plugin validate --strict`, version-header sync, `.gitattributes`/LF
  and licensing alignment, and READMEs/per-agent docs are owned by `packaging-docs-ci`, which consumes
  this installer. This feature ships the installer that those gates exercise, not the gates.
- **Installing agents themselves** — the installer installs feature-forge skills + rauf into agents
  that are already present; it does not install the coding agents (claude/codex/…) or their CLIs.

## 7. Open Questions

- **OQ-1 (rauf publish details — cross-repo, sequencing):** The delivery *shape* is fixed
  (REQ-RAUF-02/03: a pinned, published, Node-resolvable rauf package; no vendored binary). What
  remains open is the cross-repo publish plumbing — registry/package name, how rauf's monorepo emits a
  publishable bin, and the exact handoff/sequencing with `packaging-docs-ci` (C-7). The tech spec
  must reconcile the install flow with whatever published-rauf coordinate exists at implementation
  time, including a clear failure mode if the pinned rauf is unavailable.
- **OQ-2 (manifest location & format):** Where the per-agent install manifest lives (inside each
  agent's config dir vs. a feature-forge-owned state dir) and its exact schema — tech-spec decision.
- **OQ-3 (project-local destination per agent):** The precise project-local skills path for each
  agent (e.g. `./.claude/skills` vs. an agent-specific project convention) needs per-agent
  confirmation in the tech spec; the requirement (project-local default, REQ-FLAG-02) is fixed.
- **OQ-4 (local-modification detection method):** Whether drift detection (REQ-IDEM-02) uses content
  hashing recorded in the manifest, mtime, or a comparison against a freshly materialized bundle —
  tech-spec decision; the requirement (skip-modified-unless-force) is fixed.
- **OQ-5 (Gemini manifest install *mechanism*):** REQ-OPS-07 fixes the *outcome* (a valid,
  agent-loadable `gemini-extension.json` lands in the destination); what remains open is the
  *mechanism* — whether install plain-copies that manifest or places/merges it specially — a per-agent
  tech-spec detail.

## 8. Success Criteria

- From a machine with one or more of the five agents' config dirs present, a single zero-config
  command detects them and installs each agent's feature-forge bundle into the correct destination,
  leaving a runnable rauf — provisioned as a pinned, published, Node-resolvable package (network
  permitted at install) — so the default forge loop works without further setup. (REQ-DIST-01,
  REQ-DET-01/02/03, REQ-OPS-01, REQ-RAUF-01/02/03)
- `--dry-run` prints the exact planned per-agent/per-skill actions and changes nothing on disk; a
  real run then performs exactly those actions. (REQ-OPS-05, REQ-OBS-01)
- Re-running install/update with no change yields "up to date" and no filesystem diff; `update` after
  a canon change reconciles the install (adds/refreshes/removes installer-written skills) without
  `--force`. (REQ-IDEM-01/03, REQ-OPS-02)
- A locally modified install destination is skipped and reported, not clobbered, unless `--force` is
  passed. (REQ-IDEM-02, REQ-FLAG-04)
- `uninstall` removes exactly the manifest-tracked files/skills (and unlinks symlinks without
  touching their targets), leaving unrelated user content intact. (REQ-SAFE-01/02, REQ-OPS-03)
- `list` accurately reports, per agent, detected / installed / up-to-date status. (REQ-OPS-04)
- When a detected agent has no valid `adapters/{agent}/` source bundle, the installer reports it
  (naming the agent + expected path), writes no partial install for it, and proceeds with the others;
  a Gemini install leaves a valid, agent-loadable `gemini-extension.json` in the destination.
  (REQ-OPS-06, REQ-OPS-07, REQ-OBS-03)
- `--agent/-a`, `--global/-g`, `--symlink`, and `-y` behave per their requirements, with copy the
  default and Windows always copying. (REQ-FLAG-01/02/03/05, REQ-DIST-02)
- The installer runs first-class on Linux, macOS, and Windows; partial per-agent failures are
  reported without aborting the rest, and the process exits non-zero on any failure. (C-6,
  REQ-OBS-03)
- `bash scripts/validate.sh` in feature-forge builds and tests the installer and passes; the
  installer's CLI and detection map are stable surfaces the downstream `forge-rauf-loop-default` and
  `packaging-docs-ci` features can rely on. (C-2, downstream contracts)
