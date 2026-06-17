# 03 — OS-Matrix Installer Gate

> **Feature:** `packaging-docs-ci` (epic `agent-agnostic`, capstone 6 of 6).
> **Status:** domain document. Depends on `00-core-definitions.md` and `01-architecture-layout.md`.

This document specifies the `feature-forge/.github/workflows/os-matrix.yml` workflow in full: the
exact YAML, the per-leg commands, the cross-platform JSON-assertion mechanics, Windows-shell
handling, and the error surface. It is a **separate, blocking** workflow (P0) that exercises the
cross-agent installer's `--dry-run` plan and `uninstall` path on Ubuntu, macOS, and Windows so that
cross-OS breakage is caught before a user hits it. It builds on the consumed installer-CLI contract
fixed in `00-core-definitions.md` §7 — it **invokes** that surface and defines no new installer
behavior (PRD §6: "No new product features").

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-CI-07 | Installer `--dry-run` + `uninstall` on ubuntu/macos/windows; fail PR on any-OS error | §2, §3, §4 |
| REQ-CI-08 | Windows leg exercises copy-by-default (no `--symlink`), no POSIX-only assumptions | §3.2, §5 |
| REQ-PERF-01 | Matrix kept off the fast per-PR path; own workflow, independently tunable required-check | §2 |
| REQ-OBS-01 | Each leg asserts installer exit 0 + valid JSON; surfaces the installer's own error on failure | §4, §6 |
| REQ-SEC-01 | Third-party actions version-pinned | §3.1 |
| REQ-SEC-02 | No secrets; the matrix gate requires none | §3.1 |
| REQ-CONST-01 | Implemented as a GitHub Actions workflow | §2, §3 |
| REQ-MAINT-01 | Consumes generated `adapters/<agent>/`; never hand-edits | §3.3 |

## 1. Purpose & Scope

### 1.1 What this gate proves

REQ-CI-07 requires CI to run the installer's `--dry-run` followed by an `uninstall` on a matrix
covering **Ubuntu (Linux), macOS, and Windows**, failing the PR if the installer errors on any OS.
SC-05 fixes the done bar: the installer `--dry-run` + `uninstall` complete without error when run
locally on the available OS legs, and **the workflow declares all three** matrix legs.

The gate validates three things that the fast per-PR `ci.yml` gate (specified in
`02-ci-blocking-gates.md`) cannot, because `ci.yml` runs on `ubuntu-latest` only:

1. The installer **builds** (`npm ci && npm run build`) on each OS toolchain.
2. The installer's `install --dry-run` **planner** runs to completion and emits a valid `--json`
   report (exit 0) on each OS — proving the plan path makes no POSIX-only assumption.
3. The installer's `uninstall` **path** runs to completion (exit 0) on each OS.

### 1.2 What is explicitly out of scope here

- **No real install/apply.** The matrix uses `--dry-run` (plan only, no writes — verified:
  `finishAgent` returns early with `flags.dryRun`, `cli.ts:470-472`). It never mutates the runner's
  agent config dirs.
- **No rauf registry preflight.** Every leg passes `--skip-rauf` (see §3.4); rauf is unpublished
  (IR-2 / tech-spec decision 1). Without it the dry-run would fail for an out-of-scope reason.
- **No symlink assertion on Windows** (REQ-CI-08, §5). The Linux/macOS legs MAY add a
  `--symlink --dry-run` variant; Windows MUST NOT pass `--symlink`.
- **No "green-on-real-GitHub" requirement.** Per PRD §6 and §8, "done" is *authored + locally
  validated*: the locally available leg passes, and the workflow declares all three legs. Observing a
  live three-OS green run is a post-merge confirmation, not a gate on this feature.

### 1.3 Why a separate workflow (REQ-PERF-01, `01-architecture-layout.md` §2)

The matrix is slower than the deterministic single-runner gate (three OS legs, each doing
`npm ci && npm run build`). Keeping it in its own workflow:

- keeps it **off the fast per-PR feedback path** (`ci.yml` stays a few minutes — REQ-PERF-01); and
- lets the maintainer tune the **required-checks set independently** — the matrix check can be made
  required or advisory in branch protection without touching the fast gate. It is **blocking (P0)**
  by intent (REQ-CI-07, SC-05), but its required-ness is a branch-protection setting, not baked into
  the workflow.

It triggers on `pull_request` + `push` (matching `ci.yml`; `01-architecture-layout.md` §2 topology
table).

## 2. Workflow Topology (REQ-CI-07, REQ-PERF-01, REQ-CONST-01)

| Property | Value | Source |
|---|---|---|
| File | `feature-forge/.github/workflows/os-matrix.yml` (NEW) | `01-architecture-layout.md` §1.1 |
| Triggers | `pull_request`, `push` | tech-spec §3.2; `01` §2 |
| Blocking | Yes (P0) — required-ness tuned in branch protection | REQ-CI-07, SC-05 |
| Strategy | `matrix.os = [ubuntu-latest, macos-latest, windows-latest]`, `fail-fast: false` | REQ-CI-07 |
| Permissions | `contents: read` (least privilege) | `01` §4; REQ-SEC-01/02 |
| Secrets | none — operates on the repo tree only | REQ-SEC-02 |

`fail-fast: false` is mandatory: REQ-CI-07 requires the PR to fail "if the installer errors on **any**
OS", and a maintainer must see *which* OS broke. With `fail-fast: true` a Windows failure could cancel
the macOS leg before it reports, hiding a second break. All three legs always run to completion.

## 3. The Workflow — `os-matrix.yml` (full YAML)

```yaml
# feature-forge/.github/workflows/os-matrix.yml
#
# OS-matrix installer gate (REQ-CI-07, REQ-CI-08). Exercises the cross-agent installer's
# `install --dry-run` (plan only, no writes) and `uninstall` path on Ubuntu, macOS, and Windows,
# failing the PR if the installer errors on ANY OS. Kept in its own workflow (REQ-PERF-01) so it
# stays off the fast per-PR path in ci.yml and its required-check status is tunable independently.
#
# --skip-rauf is mandatory on every leg: rauf is unpublished (IR-2), so the rauf registry preflight
# would otherwise fail the gate for an out-of-scope reason (tech-spec decision 1). See 00 §7.
name: OS Matrix (installer)

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  installer:
    name: installer dry-run + uninstall (${{ matrix.os }})
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false # REQ-CI-07: every OS must report; one OS's failure must not cancel the others
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]

    steps:
      - name: Checkout
        uses: actions/checkout@v5 # pinned to a major tag (REQ-SEC-01), mirrors rauf/ci.yml

      - name: Set up Node
        uses: actions/setup-node@v4 # pinned (REQ-SEC-01)
        with:
          node-version: "20" # >=18 required by installer/package.json "engines"; 20 is LTS

      # Build the installer on this OS's toolchain. `cd installer` for npm; the run commands below
      # invoke the built entry from the REPO ROOT (the working dir GitHub Actions restores per step).
      - name: Build installer
        working-directory: installer
        run: npm ci && npm run build

      # ---- LEG 1: install --dry-run --skip-rauf --json -------------------------------------------
      # Plan only (no writes), --skip-rauf (no rauf preflight), --json for a machine-checkable report.
      # The step asserts exit 0 (the `run:` fails the job on non-zero) AND that stdout is valid JSON
      # (the node -e pipe below). On any installer error the installer's own message is on stderr and
      # surfaced in the log (REQ-OBS-01). shell: bash makes the pipe portable across all three OSes.
      - name: install --dry-run (assert exit 0 + valid JSON)
        shell: bash
        run: |
          set -euo pipefail
          node installer/dist/cli.js install --dry-run --skip-rauf --json | tee dry-run.json
          # Cross-platform JSON validation: node is guaranteed present (setup-node above), so we
          # parse with node -e rather than python/jq (which are not uniformly available on the
          # Windows runner). A parse failure exits non-zero and fails the leg.
          node -e "JSON.parse(require('node:fs').readFileSync('dry-run.json','utf8'))"

      # ---- LEG 2: uninstall -y --skip-rauf -------------------------------------------------------
      # Exercises the uninstall path. -y is non-interactive (never blocks on input); with nothing
      # installed this is an "ok, no-op" per agent (cli.ts runOneAgent uninstall branch) and exits 0.
      - name: uninstall -y --skip-rauf (assert exit 0)
        shell: bash
        run: |
          set -euo pipefail
          node installer/dist/cli.js uninstall -y --skip-rauf

      # ---- LEG 3 (Linux/macOS ONLY): --symlink --dry-run ----------------------------------------
      # REQ-CI-08: the Windows leg MUST NOT pass --symlink (copy-by-default). POSIX legs MAY exercise
      # the symlink plan path. Guarded off Windows so the matrix never asserts symlink there.
      - name: install --symlink --dry-run (POSIX only)
        if: runner.os != 'Windows'
        shell: bash
        run: |
          set -euo pipefail
          node installer/dist/cli.js install --symlink --dry-run --skip-rauf --json | tee symlink-dry-run.json
          node -e "JSON.parse(require('node:fs').readFileSync('symlink-dry-run.json','utf8'))"
```

### 3.1 Action pinning & permissions (REQ-SEC-01, REQ-SEC-02)

- `actions/checkout@v5` and `actions/setup-node@v4` are pinned to major tags, mirroring rauf's
  verified pinning style (`rauf/.github/workflows/ci.yml:16` uses `actions/checkout@v5`;
  `01-architecture-layout.md` §4). A maintainer MAY tighten these to commit SHAs (REQ-SEC-01 is a P2
  SHOULD — tag pinning satisfies it).
- `permissions: contents: read` at the workflow level grants the minimum the job needs (clone +
  read). The matrix gate requires **no secrets** (REQ-SEC-02): it operates entirely on the repo tree.
  Contrast `eval.yml`, which is the only workflow that reads a secret (`01-architecture-layout.md`
  §4).

### 3.2 Why `node-version: "20"`

`installer/package.json` declares `"engines": { "node": ">=18" }` (verified). Node 20 is the current
LTS and is what a typical `npx feature-forge install` user runs. Pinning a concrete major keeps the
matrix deterministic across runner image updates. Any `>=18` value satisfies the contract.

### 3.3 Consuming the generated bundle (REQ-MAINT-01)

The installer's source-bundle resolver (`installer/src/source.ts`) locates `adapters/<agent>/` from
`import.meta.url`, cwd-independently (verified: candidates are
`<installerPkgRoot>/adapters/<agent>` then `<repoRoot>/adapters/<agent>`,
`source.ts:170-171`). The matrix therefore relies on the **committed** generated adapters being
present in the checkout — it never regenerates or edits them (REQ-MAINT-01; the regen-diff gate that
guards those lives in `02-ci-blocking-gates.md`). No `build-adapters.py` run is needed in this
workflow.

### 3.4 `--skip-rauf` rationale (tech-spec decision 1 / §6.1, IR-2)

Every install leg passes `--skip-rauf`. Verified behavior (`installer/src/rauf.ts:84-104`):

- `preflightRauf({ skip: true })` returns `ok({ raufPin: null })` immediately with **no network
  call** (`rauf.ts:88-90`).
- Without `--skip-rauf`, a non-dry-run install would run `defaultRegistryQuery` =
  `npm view rauf@0.6.0 version` (`rauf.ts:120`). Because `rauf` is `private:true` / unpublished
  (IR-2), that resolves to a non-existent package and the installer emits its **non-silent**
  `RAUF_UNRESOLVABLE` error: *"pinned default loop runner `rauf@0.6.0` is not resolvable from the npm
  registry…"* (`rauf.ts:146-161`).

> **Documented expectation:** until rauf 0.6.0 is published, that `RAUF_UNRESOLVABLE` message is the
> *known, designed* failure mode (not a bug). CI never hits it because every leg uses `--skip-rauf`.
> The publishability context behind `--skip-rauf` — what it takes to make rauf resolvable — lives in
> `06-packaging-versioning-hygiene.md` (tech-spec §3.13).
>
> Note on `--dry-run` + preflight interaction: the install leg uses **both** `--dry-run` and
> `--skip-rauf`. The preflight is additionally gated on `!flags.dryRun` (`cli.ts:348-353`), so a
> dry-run would skip the network query even without `--skip-rauf`; `--skip-rauf` is retained anyway so
> the documented invocation is identical to the non-dry uninstall leg and to the 00 §7 contract, and
> so a future change to the dry-run/preflight gating cannot silently reintroduce a network call.

## 4. Per-Leg Commands (exact)

The canonical per-leg sequence (matches `00-core-definitions.md` §7 verbatim):

```bash
# build (working-directory: installer)
npm ci && npm run build

# leg 1 — plan only; assert exit 0 + valid JSON (working-directory: repo root)
node installer/dist/cli.js install --dry-run --skip-rauf --json

# leg 2 — uninstall path; assert exit 0
node installer/dist/cli.js uninstall -y --skip-rauf

# leg 3 — POSIX only; symlink plan (REQ-CI-08 carve-out)
node installer/dist/cli.js install --symlink --dry-run --skip-rauf --json
```

**Working-directory note (load-bearing):** the build step runs in `installer/` (npm needs the
package manifest there). The run steps execute from the **repo root** (the default working dir Actions
restores for each step), where `installer/dist/cli.js` resolves. The CLI's source resolution is
cwd-independent (§3.3), so the run commands work regardless — but the documented form runs them from
the repo root.

**Flag verification (against `installer/src/cli.ts`):**

| Flag | parseArgs binding | Effect | Verified at |
|---|---|---|---|
| `install` | subcommand (alias `add`) | plan/apply pipeline | `cli.ts:77-82` |
| `uninstall` | subcommand (alias `remove`) | manifest → planUninstall → apply | `cli.ts:77-82`, `cli.ts:402-423` |
| `--dry-run` | `dryRun` | plan only, no writes (early return) | `cli.ts:90`, `cli.ts:470-472` |
| `--skip-rauf` | `skipRauf` | no rauf preflight, `raufPin: null` | `cli.ts:93`, `rauf.ts:88-90` |
| `--json` | `json` | report rendered as JSON to stdout | `cli.ts:92`, `cli.ts:299` |
| `-y / --yes` | `yes` | non-interactive; never blocks on input | `cli.ts:91` |
| `--symlink` | `symlink` | request symlink (ignored on Windows) | `cli.ts:88`, `plan.ts:127-128` |

**Exit-code contract (verified `cli.ts:205-207`, `EXIT` in `types.ts` via 00 §7):** `EXIT.SUCCESS=0`,
`EXIT.USAGE=2` (bad flags/subcommand), `EXIT.FAILURE=1` (any agent failed, or an unresolvable rauf
preflight). A leg passes iff the command exits `0`. The `run:` step's default shell behavior fails the
job on any non-zero exit, and `set -euo pipefail` makes the JSON-validation pipe failure (or any
intermediate command failure) propagate.

## 5. Windows Specifics (REQ-CI-08)

REQ-CI-08: the Windows leg MUST exercise the installer's Windows behavior (copy-by-default, no
symlink) and pass **without relying on POSIX-only assumptions**. Two concerns:

### 5.1 Copy-by-default — never `--symlink` on Windows

Verified (`installer/src/plan.ts:127-128`):

```ts
export function resolveMode(wantSymlink: boolean, windows = isWindows()): Mode {
  return wantSymlink && !windows ? "symlink" : "copy";
}
```

`resolveMode` returns `"copy"` whenever `windows` is true — even if `--symlink` is passed (it is
*ignored* on Windows, exactly per cross-agent-installer D8). The matrix therefore:

- runs the **same** `install --dry-run` / `uninstall` commands on the Windows leg (legs 1 and 2);
- **omits** the symlink variant (leg 3) on Windows via `if: runner.os != 'Windows'` — there is no
  symlink plan path to assert there, and asserting one would be testing a behavior the installer
  deliberately does not perform.

The Windows leg thus exercises the copy plan (the only mode Windows uses), satisfying REQ-CI-08
without a Windows-specific command.

### 5.2 Shell portability — `shell: bash` for the run steps

The default shell on `windows-latest` runners is **PowerShell (`pwsh`)**, whereas Ubuntu/macOS default
to `bash`. The run steps use shell features that are not portable across pwsh/bash:

- the `cmd | tee file` pipe and `set -euo pipefail`;
- POSIX-style multi-command `&&` chaining and quoting.

**Decision:** every run step that uses these constructs declares **`shell: bash`** explicitly.
`bash` is available on all three GitHub-hosted runner images (Git-Bash ships on the Windows runner),
so a single command body works identically on all three OSes. This is the simplest cross-platform
form (the alternative — writing each step twice, once for pwsh and once for bash — is rejected as
duplication that would drift).

> The `working-directory: installer` build step (`npm ci && npm run build`) also uses `&&`; it too
> runs under `shell: bash` implicitly is **not** safe to assume — so it is written as a single
> `npm ci && npm run build` line which Actions runs under the OS default shell. `&&` chaining works in
> both `pwsh` (7+) and `bash`, so the build step does not need an explicit `shell:`. Every step that
> uses a **pipe** or `set -euo pipefail` MUST set `shell: bash` (legs 1–3 do).

### 5.3 No POSIX path assumptions in the leg commands

The leg commands reference `installer/dist/cli.js` with a forward slash. Node accepts forward slashes
as path separators on Windows, and the installer resolves all internal paths via `node:path` /
`import.meta.url` (cwd- and separator-independent, §3.3). The matrix commands therefore make no
POSIX-only path assumption (REQ-CI-08).

## 6. Error Handling & Diagnostics (REQ-OBS-01)

`00-core-definitions.md` §8 requires every gate to fail loudly and actionably. For each leg:

| Failure | How it surfaces | Diagnostic content |
|---|---|---|
| Installer exits non-zero | the `run:` step fails the job (non-zero exit) | the installer's own stderr message — e.g. a `USAGE` error (exit 2) or an agent `FAILURE` (exit 1) — is in the step log |
| Installer exits 0 but stdout is not valid JSON | `node -e "JSON.parse(...)"` throws → non-zero → step fails | Node's `SyntaxError` with the offending position, plus the captured `dry-run.json` content in the log (via `tee`) |
| Build fails on an OS | `npm ci`/`npm run build` non-zero → step fails | tsc / npm error output in the log |
| One OS breaks, others pass | `fail-fast: false` → the broken leg is red, others stay green | the matrix view names the failing OS (`installer dry-run + uninstall (windows-latest)`) |

The installer never emits a bare stack for an expected error: `main`'s boundary catch prints a
one-line `error: unexpected failure: …` and exits 1 (`cli.ts:291-297`), and expected errors render a
structured message (`renderReport`, `cli.ts:299`). The `tee dry-run.json` keeps the machine report in
the log so a JSON-shape failure is diagnosable from the captured bytes (REQ-OBS-01).

**`GateDiagnostic` mapping (00 §8):** for the `os-matrix` gate — `gate: "os-matrix"`,
`what: "installer install --dry-run / uninstall failed on <os>"`,
`evidence: "<installer stderr message + captured --json>"`,
`remedy: "reproduce locally: cd installer && npm ci && npm run build, then node installer/dist/cli.js install --dry-run --skip-rauf --json"`.

## Dependencies

- `00-core-definitions.md` §7 — the consumed `InstallerCliContract` (bin, entry, subcommands,
  flags, exit codes, `raufPin`) and the canonical per-leg invocation. This document **invokes** that
  surface; it defines no installer behavior.
- `00-core-definitions.md` §8 — the `GateDiagnostic` conventions this gate satisfies (§6).
- `01-architecture-layout.md` §2 — the three-workflow topology and this workflow's blocking/trigger
  classification; §4 — action pinning and least-privilege permissions.
- `06-packaging-versioning-hygiene.md` — the rauf-publishability context behind `--skip-rauf` (why
  rauf is unresolvable today and what makes it publishable). Cross-referenced from §3.4.
- **Consumed, not authored here:** `feature-forge/installer/` (the `cross-agent-installer-cli`
  contract) and the committed `adapters/<agent>/` bundles (the `adapters-output` contract).

## Verification

SC-05 done bar — *installer dry-run + uninstall complete without error on the locally available leg,
and the workflow declares all three legs.*

- [ ] `os-matrix.yml` exists at `feature-forge/.github/workflows/` and declares
      `matrix.os = [ubuntu-latest, macos-latest, windows-latest]` with `fail-fast: false` (REQ-CI-07,
      SC-05 — all three legs declared).
- [ ] Triggers are `pull_request` + `push`; the workflow is not on `schedule`/`workflow_dispatch`
      (it is the blocking matrix, not the advisory eval) — `01` §2.
- [ ] `permissions: contents: read`; no `secrets.*` reference anywhere in the file (REQ-SEC-02).
- [ ] `actions/checkout` and `actions/setup-node` are pinned to a tag/SHA (REQ-SEC-01).
- [ ] **Local single-leg validation (the SC-05 "available leg"):** from a feature-forge checkout on
      the developer's OS, run:
      ```bash
      cd installer && npm ci && npm run build && cd ..
      node installer/dist/cli.js install --dry-run --skip-rauf --json | node -e "JSON.parse(require('node:fs').readFileSync(0,'utf8'))"   # exit 0, valid JSON
      node installer/dist/cli.js uninstall -y --skip-rauf                                                                                 # exit 0
      ```
      Both commands exit 0; the first emits valid JSON. (Reading stdin via fd `0` in the local check;
      the workflow uses `tee` + a temp file because pipelines on the Windows runner are simplest that
      way.)
- [ ] On the local POSIX leg, `node installer/dist/cli.js install --symlink --dry-run --skip-rauf --json`
      also exits 0 with valid JSON (leg 3) (REQ-CI-08 POSIX variant).
- [ ] The Windows leg in the YAML does **not** pass `--symlink` (leg 3 is guarded by
      `if: runner.os != 'Windows'`) (REQ-CI-08).
- [ ] Every run step using a pipe or `set -euo pipefail` declares `shell: bash` (§5.2).
- [ ] Forcing an installer error locally (e.g. an unknown flag → exit 2) makes the corresponding leg
      fail and surfaces the installer's own message in the output (REQ-OBS-01).
```
