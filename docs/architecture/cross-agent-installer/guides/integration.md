# Integration Guide

How the cross-agent installer fits into a workflow, the rauf relationship, and where
its responsibilities end.

## Running it

The installer is meant to be run with `npx` from the published `feature-forge` package
— no global install, no project dependency:

```bash
npx feature-forge install --dry-run     # always preview first
npx feature-forge install -y            # apply
```

It writes into each detected agent's config dir under a self-contained `feature-forge/`
namespace and records a `.feature-forge.<scope>.json` manifest. Re-running `install`
(or `update`) is idempotent: unchanged files are left alone, changed files are updated,
removed-from-source files are pruned, and a destination you hand-edited is **skipped and
reported** (re-run with `--force` to overwrite it).

### When to use

- Onboarding a machine that has one or more of Claude Code / Codex / Copilot / Cursor /
  Gemini and you want the feature-forge skills available in each.
- Keeping an existing install in sync after the adapter bundles change (`update`).
- Auditing install state across agents (`list`, `list --json`).

### When *not* to use

- As a build step that mutates `adapters/` — the installer treats the bundle source as
  read-only and never writes into it. Generating the bundles is
  [`forge-agent-adapters-build`](../../forge-agent-adapters-build/)'s job.
- To author end-user installation/usage documentation — see the boundary note below.

## The rauf bundle relationship

The installer **provisions** the rauf loop runner rather than vendoring it. It pins a
single coordinate (`RAUF_PIN = rauf@0.6.0`) and runs a resolvability **preflight** at
install time:

- If the pin resolves, the install records it and rauf is later invoked on demand via
  `npx` (lazy — the binary isn't downloaded by the installer itself).
- If the pin is unresolvable, the run reports a `RAUF_UNRESOLVABLE` condition but the
  **skills still install** — rauf provisioning is non-fatal.
- `--skip-rauf` bypasses the preflight entirely and records `raufPin: null`.

rauf is an *external* published artifact (npm / GitHub-release coordinate), not an
intra-epic contract — the installer just needs to know the pin resolves.

## CI dry-runs

`list --json` and `install --dry-run --json` are the machine-readable seams for CI. A
pipeline can assert install planning across an OS/agent matrix without mutating
anything:

```bash
npx feature-forge install -a claude --dry-run --json
npx feature-forge list --json
```

Detection and planning are deterministic given the same source bundle + destination
state, so these are stable to assert against. (The OS-matrix dry-run harness that
consumes this surface is owned by the downstream `packaging-docs-ci` feature.)

## Responsibility boundary

This feature delivers the **installer mechanism** and its *architecture* docs (this
directory). It deliberately does **not** ship:

- the package's user-facing **README / install-usage docs** — owned by the sibling
  `packaging-docs-ci` feature (the installer package's `installer/README.md` is
  intentionally absent here);
- the **rauf binary itself** — provisioned as an external published artifact;
- the **adapter bundles** — produced read-only by `forge-agent-adapters-build`.

Keeping those out of scope is what lets the installer stay a small, dependency-free,
read-only-consuming tool.
