# Handoff — start `forge-agent-adapters-build` (epic: agent-agnostic)

> Session aid (not a pipeline artifact). Open a fresh session in `/home/gary/workspace/rauf` and start with the **First command** below.

## First command

```
/feature-forge:forge-1-prd forge-agent-adapters-build
```

This feature is at stage `forge-1-prd` (only `forge-0-epic` complete). forge-1-prd will inject epic context automatically. Its dependency `forge-skill-spec-purity` is **complete** (loop 9/9, impl-verified clean), so it is actionable now.

## What just finished (its upstream dependency)

`forge-skill-spec-purity` is **done** — it produced the read-only inputs this feature consumes:
- **`spec-pure-skills`** — the 11 vendor-neutral `feature-forge/skills/*/SKILL.md` + their `references/`. Frontmatter is `{name, description[, metadata]}`; Claude's `argument-hint` lives losslessly under `metadata.argument-hint`.
- **`portable-skill-root-resolver`** — `feature-forge/scripts/forge-root.sh` (+ canonical prelude in `feature-forge/references/portable-root.md`), to be copied verbatim into per-agent script mirrors.
- Also available: `feature-forge/references/vendor-construct-inventory.md` (the vendor-construct audit + dispositions) and the architecture docs at **`rauf/docs/architecture/forge-skill-spec-purity/`** — especially `guides/integration.md`, which is written *for this feature*.
- Open: **PR #5** (https://github.com/garygentry/feature-forge/pull/5) on branch `forge/skill-spec-purity` — awaiting review/merge. And a **manual REQ-COMPAT behavioral smoke** is still outstanding for that feature (maintainer-run; not loop-automatable).

## This feature's charter (from the epic manifest)

Target repo: **feature-forge**. Add the canonical→per-agent build step: a generator that walks the spec-pure canonical skills, parses frontmatter, and emits per-agent artifacts (Codex mirror + optional `agents/openai.yaml`, Copilot copy with Copilot frontmatter, Cursor `.mdc`, `gemini-extension.json`) into `adapters/`, each with a DO-NOT-EDIT generated header. Author canonical `AGENTS.md` (build/test/conventions + install priority). Wire a CI regenerate-and-diff so generated adapters can't drift from canon.

- **dependsOn:** `forge-skill-spec-purity` (met)
- **exposes:** `build-adapters` (generator), `AGENTS.md`, `adapters-output` (generated `adapters/` tree)
- **consumes:** `spec-pure-skills`, `portable-skill-root-resolver` (both from forge-skill-spec-purity, read-only)

## CRITICAL — cross-repo execution model (same as the last feature)

Impl lands in **`/home/gary/workspace/feature-forge`**; specs/backlog/loop run from **`rauf`** (`specs/agent-agnostic/forge-agent-adapters-build/`). This only bites at the **forge-5-loop** stage — `rauf-stable` is runner-owns-commit + path-sandboxes `--backlog`, so you CANNOT run the loop from rauf. Use the validated native-in-feature-forge pattern: stage a gitignored `feature-forge/.forge-loop/backlog.json` (with `specReferences` rewritten to absolute rauf paths), `git/info/exclude` it, run `cd feature-forge && rauf-stable loop run . --backlog .forge-loop --create-branch forge/<feature> --ndjson`, then sync statuses back to rauf. Full detail in the `forge-crossrepo-loop-execution` memory. This feature is Bash/Python3/Markdown — ignore rauf's `pnpm gate`; verify is `bash scripts/validate.sh` in feature-forge.

Note for PRD/tech stages: confirm whether `adapters/` output should be checked in (the CI diff implies yes) — likely needs its own purity/exemption story so `check-spec-purity.py` doesn't scan generated per-agent copies (they intentionally carry vendor frontmatter). Flag early.

## Epic status: 2/6 complete

Done: `rauf-agent-cli-adapters`, `forge-skill-spec-purity`. This feature unblocks `cross-agent-installer` → `forge-rauf-loop-default` / `packaging-docs-ci` downstream.
