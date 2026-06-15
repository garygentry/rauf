# AGENT_REFACTOR_RUNBOOK.md — Make a Claude-Native Skill Repo Cross-Agent Without Degrading the Claude Path

> **Audience:** a Claude Code coding agent executing against an existing repository that currently contains Claude-Code-specific plugin/skill tooling.
> **Mode:** executable runbook. Follow steps in order. Verify each acceptance criterion before moving on.

## 1. Objective and Constraints

**Goal:** Refactor this repository so its skills are LLM-agnostic / cross-agent (Claude Code, OpenAI Codex, GitHub Copilot, Cursor, Gemini CLI, Windsurf, OpenCode, and the broader open Agent Skills ecosystem), while keeping the Claude Code plugin + marketplace install path first-class and "preferred." The Vercel-maintained `npx skills` CLI alone advertises broad reach — its `vercel-labs/skills` README states: *"The CLI for the open agent skills ecosystem. Supports OpenCode, Claude Code, Codex, Cursor, and 67 more"* (i.e. 71 hosts) — so "write once, run everywhere" is realistic if the core stays spec-pure.

**Hard constraints (do not violate):**
1. **Do NOT degrade the Claude-native path.** `/plugin marketplace add <owner>/<repo>` then `/plugin install <plugin>@<marketplace>` must remain the recommended, auto-updating install. Claude leads the README.
2. **Core `SKILL.md` files must be spec-pure** — only the two required frontmatter fields (`name`, `description`) plus optional spec-sanctioned fields. No vendor-only frontmatter keys in the canonical skill.
3. **Single source of truth.** Per-agent artifacts are *generated* from the canonical core, never hand-edited divergently.
4. **Idempotent, reversible installs.** The universal installer must support `--dry-run`, update, and uninstall with no residue.

The architecture is **shared-canonical-core + per-agent-adapters**: one spec-pure skill body, with thin per-agent manifests/wrappers layered on top and a build step that derives them.

## 2. What the Two Reference Repos Teach

### 2.1 `mvanhorn/last30days-skill` — single-skill repo, maximal install-surface
- Structure: one skill at `skills/last30days/SKILL.md` with bundled `scripts/` (Python engine), `references/`, `fixtures/`, `tests/`. Claude manifest in `.claude-plugin/`. A `.agents/plugins/` directory, a root `gemini-extension.json`, `AGENTS.md`, `CLAUDE.md`, `pyproject.toml`, `uv.lock`, `.gitattributes`.
- README leads with: **Claude Code (recommended — auto-updates via marketplace)** → `/plugin marketplace add mvanhorn/last30days-skill` + `/plugin install last30days`; then a universal line `npx skills add mvanhorn/last30days-skill -g`; then a surface/install table (claude.ai `.skill` upload, OpenClaw `clawhub`, manual symlink).
- `AGENTS.md` is literally `@CLAUDE.md` (a one-line import pointer), keeping one source of truth for agent instructions.
- Build step: `scripts/build-skill.sh` produces a `.skill` bundle for claude.ai (under the 200-file cap); `scripts/sync.sh` detects installed agents (`~/.claude/skills`, `~/.agents/skills`, `~/.codex/skills`, `~/.hermes/skills`) and deploys.
- **Real footguns it hit (learn from these):** `"skills": ["./"]` in `plugin.json` broke on Claude Code v2.1.109 with `Path escapes plugin directory: ./ (skills)` — they dropped the key (PR #264, v3.0.4) so Claude auto-discovers `skills/*/SKILL.md`. And `.gitattributes` `export-ignore` rules once stripped `skills/` and `.claude-plugin/` from the `git archive` tarball that `/plugin install` consumes, shipping an empty plugin (the v3.0.1/v3.0.2 incident).
- Tests: large pytest suite (README claims 1,012 tests passing in v3); `npx skills add . -g -y` install copies are frozen at install time (re-run to sync, or symlink for live dev).

### 2.2 `addyosmani/agent-skills` — collection-of-skills repo, lifecycle pack
- Structure: 23+ skills under `skills/<name>/SKILL.md` (lifecycle pack: spec → plan → build → test → review → ship + a `using-agent-skills` meta-skill), plus `agents/` (persona `.md`), `references/` (shared checklists), `hooks/`, `.claude/commands/` and `.gemini/commands/` (per-agent slash commands), `.opencode/`, `docs/` (per-tool setup guides), `.claude-plugin/`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`.
- README leads with **Claude Code (recommended)** marketplace install (`/plugin marketplace add addyosmani/agent-skills` + `/plugin install agent-skills@addy-agent-skills`), with an SSH-vs-HTTPS troubleshooting note, then per-tool sections (Cursor `.cursor/rules/`, Gemini CLI `gemini skills install`, Windsurf rules, OpenCode AGENTS.md + `skill` tool, GitHub Copilot `agents/` + `.github/copilot-instructions.md`, Kiro `.kiro/skills/`, "Codex/other: skills are plain Markdown").
- Each skill follows a consistent anatomy (frontmatter → Overview → When to Use → Process → Rationalizations → Red Flags → Verification); `docs/skill-anatomy.md` is the format spec. "How Skills Work" documents progressive disclosure explicitly: name+description at startup (~100 tokens each), full body on activation (recommended <5,000 tokens), references on demand.

**Key contrast:** last30days is a *product* skill optimizing for install ubiquity and zero-config runtime (one skill, many install surfaces, a Python engine with scripts); agent-skills is a *library* optimizing for many portable Markdown skills + per-tool documentation. Your target repo should borrow last30days's installer/build rigor and agent-skills's clean `skills/` + `docs/` + per-agent-adapter layout.

## 3. Target End-State Repository Structure

```
your-repo/
├── skills/                          # CANONICAL, spec-pure skills (source of truth)
│   ├── <skill-a>/
│   │   ├── SKILL.md                 # name + description only (+ spec-optional)
│   │   ├── scripts/                 # bundled executables (bash/python/js)
│   │   ├── references/              # progressive-disclosure docs (load on demand)
│   │   └── assets/                  # templates, static resources
│   └── <skill-b>/
│       └── SKILL.md
├── AGENTS.md                        # canonical cross-agent project instructions
├── .claude-plugin/                  # CLAUDE-PREFERRED adapter (first-class)
│   ├── plugin.json                  # plugin manifest
│   └── marketplace.json             # marketplace catalog
├── .mcp.json                        # MCP servers (separate file, NOT inline in plugin.json)
├── adapters/                        # GENERATED per-agent artifacts (build output)
│   ├── codex/                       # mirror for ~/.agents/skills (+ optional openai.yaml)
│   ├── copilot/                     # .github/skills + copilot-instructions snippet
│   ├── cursor/                      # .cursor/rules/*.mdc
│   └── gemini/                      # gemini-extension.json (+ skills mirror)
├── installer/                       # cross-platform zero-config CLI
│   ├── package.json                 # bin: your-skills-install
│   ├── index.mjs                    # detect agents, copy/symlink, dry-run/update/uninstall
│   └── lib/agents.mjs               # per-agent dir map + detection
├── scripts/                         # repo-level build/dev scripts
│   ├── build-adapters.(sh|mjs)      # derive adapters/ from skills/ (canonical → per-agent)
│   └── validate.(sh|mjs)            # schema + lint runner
├── docs/                            # per-agent setup guides
│   ├── claude-code.md  codex.md  copilot.md  cursor.md  gemini.md  windsurf.md
├── tests/                           # skill + installer tests
├── .github/workflows/ci.yml         # validate + lint + OS matrix
├── .gitattributes                   # line endings + export-ignore safety
├── .gitignore
├── CHANGELOG.md                     # semver / changesets
├── LICENSE                          # Apache-2.0 (code)
├── LICENSE-docs                     # CC-BY-4.0 (docs/skill prose) [optional]
└── README.md                        # Claude-preferred install FIRST, then universal
```

> **Rationale:** `skills/` stays portable and is what every spec-compliant host reads. `.claude-plugin/` + `.mcp.json` sit beside it so Claude Code auto-discovers `skills/*/SKILL.md`. `adapters/` is build output that other ecosystems consume. Generic artifacts are never degraded because they are derived, not edited.

## 4. Step-by-Step Refactor

### Step 1 — Audit and classify
List every file. Tag each as **canonical-generic** (portable: SKILL.md bodies, scripts, references, assets, README prose) or **Claude-specific** (`.claude-plugin/*`, `CLAUDE.md`, inline `mcpServers`, Claude slash commands, hooks, `${CLAUDE_PLUGIN_ROOT}` references). Produce a table in your working notes. Anything Claude-specific that lives *inside* a `SKILL.md` frontmatter must move to the adapters layer in Step 2.

### Step 2 — Make SKILL.md spec-pure; push vendor keys to adapters
For each `skills/<name>/SKILL.md`:
- Keep only `name` (≤64 chars, lowercase/numbers/hyphens, matching the directory) and `description` (≤1024 chars; front-load *what* + *when/trigger* words). Optionally keep spec-sanctioned `license`, `compatibility`, `metadata`, `allowed-tools`.
- Remove vendor-only keys (e.g., Claude hook wiring, Codex invocation policy, Copilot `user-invocable`/`disable-model-invocation`). Relocate them:
  - Codex invocation policy → a per-skill `agents/openai.yaml`. Per OpenAI Codex docs: *"Add agents/openai.yaml to configure UI metadata in the Codex app, to set invocation policy, and to declare tool dependencies for a more seamless experience."* The implicit-invocation toggle is documented verbatim as: *"`allow_implicit_invocation` (default: true): When false, Codex won't implicitly invoke the skill based on user prompt; explicit `$skill` invocation still works."*
  - Copilot invocation flags → generated Copilot copy only.
- Replace `${CLAUDE_PLUGIN_ROOT}` inside scripts with a portable resolver that probes multiple roots (`.`, `$CLAUDE_PLUGIN_ROOT`, `~/.claude/skills/<name>`, `~/.agents/skills/<name>`, `~/.codex/skills/<name>`) — mirror last30days's `SKILL_ROOT` discovery loop.
- Keep the body under ~500 lines / ~5,000 tokens; move detail into `references/` for progressive disclosure.

### Step 3 — Keep the Claude plugin + marketplace as the preferred install
- Ensure `.claude-plugin/plugin.json` exists with valid metadata and **no `skills` key** so Claude auto-discovers `skills/*/SKILL.md` (the explicit `"skills": ["./"]` value is rejected by current Claude Code with a path-escape error).
- Ensure `.claude-plugin/marketplace.json` lists the plugin with a name + source.
- Run `claude plugin validate .` from the marketplace dir and `claude plugin validate ./<plugin-dir>` from the plugin dir.

### Step 4 — Add AGENTS.md as canonical instructions
Create a root `AGENTS.md` — *"A simple, open format for guiding coding agents, used by over 60k open-source projects"* (agents.md). It is now stewarded by the Agentic AI Foundation under the Linux Foundation and is read by Codex, Copilot, Cursor, Gemini CLI, Aider, Zed, Jules, Factory and more. The format is intentionally minimal Markdown with no required fields. Document build/test/conventions and the install-path priority. If you maintain a `CLAUDE.md`, make `AGENTS.md` import it (last30days's `AGENTS.md` is just `@CLAUDE.md`) to avoid drift — but verify the importing agent supports `@import`; otherwise inline the shared content. Note nested `AGENTS.md` files are valid and common in monorepos (agents.md notes *"at time of writing the main OpenAI repo has 88 AGENTS.md files"*; closest file to the edited file wins).

### Step 5 — Add per-agent install artifacts/instructions
- **Codex:** skills install to `~/.agents/skills/<name>` (global) or `.agents/skills/` (repo). Per OpenAI Codex docs: *"For repositories, Codex scans `.agents/skills` in every directory from your current working directory up to the repository root."* **Use `~/.agents/skills`, NOT `~/.codex/skills`, for the cross-agent global path** — see footguns.
- **Copilot:** project skills in `.github/skills/<name>/SKILL.md` (Copilot also reads `.claude/skills/` and `.agents/skills/`); personal skills in `~/.copilot/skills` or `~/.agents/skills`. Add `.github/copilot-instructions.md` for always-on rules.
- **Cursor:** copy SKILL.md content into `.cursor/rules/*.mdc`.
- **Gemini CLI:** emit `gemini-extension.json` (manifest with `name`/`version`, optional `contextFileName`, `mcpServers`) plus a `.gemini/skills/<name>/SKILL.md` mirror, or document `gemini skills install <repo> --path skills`.

### Step 6 — Add a cross-platform zero-config CLI installer
Primary recommendation: **Node/`npx`** (broadest availability, no global install required, CI-safe, works in containers without pre-install). It should detect installed agents by probing their config dirs, copy (or symlink) the canonical skill into each agent's directory idempotently, and support `--dry-run`, `update`, `uninstall`, `--global/-g`, `--agent/-a`, and `-y`. Model the UX on `npx skills` / `add-skill` (auto-detection + multi-agent + selective install). Keep `npx skills add <owner>/<repo> -g` documented as the universal one-liner: the Vercel `skills.sh` CLI (launched January 20, 2026) already supports the broad host list in its README (*"OpenCode, Claude Code, Codex, Cursor, and 67 more"*). Ship your own installer for repo-specific behavior (post-install setup wizard, env detection, secret prompts).

### Step 7 — Add a build/generation step (canonical → per-agent)
`scripts/build-adapters` walks `skills/*/SKILL.md`, parses frontmatter, and emits per-agent artifacts into `adapters/`: Codex mirror + optional `agents/openai.yaml`, Copilot copy with Copilot frontmatter, Cursor `.mdc`, `gemini-extension.json` with a `version` synced to `plugin.json`. The canonical files are read-only inputs; generated files carry a "DO NOT EDIT — generated" header. CI fails if `adapters/` is out of date (regenerate-and-diff).

### Step 8 — Handle cross-OS concerns
- `.gitattributes`: force LF on shell scripts and `SKILL.md` (CRLF breaks `#!` shebangs); mark binaries. Be cautious with `export-ignore` — never exclude `skills/` or `.claude-plugin/` from the archive `/plugin install` consumes.
- Preserve executable bits on scripts; the installer should `chmod +x` after copy.
- Provide both `bash` and PowerShell entry points, or rely on the Node installer to abstract the shell.
- Detect Python (`python3`/`uv`) at runtime and degrade gracefully; never hard-require it for skills that don't need it.
- On Windows, prefer copy over symlink by default (symlinks need elevated privileges/Developer Mode); offer `--symlink` opt-in.

### Step 9 — Update the README
Lead with the Claude-preferred marketplace block, then the universal one-liner, then a per-surface table, then per-agent doc links. (Template in §5.6.)

### Step 10 — Validation, testing, CI, versioning, licensing
- `claude plugin validate --strict` (treat warnings as errors in CI — catches stray vendor fields, type errors, misspelled keys; note that Claude Code ignores unrecognized top-level fields at runtime but `--strict` flags them).
- SKILL.md schema validation (name/description constraints, name==dir).
- `shellcheck` on shell, `ruff`/`mypy` on Python.
- Trigger-accuracy evals: assert each skill's `description` activates on representative prompts and not on unrelated ones.
- OS matrix in CI (ubuntu/macos/windows) running installer `--dry-run` + uninstall.
- Versioning: semver, Changesets or equivalent, `CHANGELOG.md`; keep `plugin.json`, `gemini-extension.json`, and SKILL.md version headers in sync (last30days had drift bugs here — enforce in CI).
- Licensing: **Apache-2.0** for code (`LICENSE`), **CC-BY-4.0** for docs/skill prose (`LICENSE-docs`); add SPDX headers. (Both reference repos use MIT; Apache-2.0 adds an explicit patent grant, which is preferable for code you expect others to redistribute and adapt.)

## 5. Copy-Paste Templates

### 5.1 Spec-pure `skills/<name>/SKILL.md`
```markdown
---
name: my-skill
description: >-
  Does X for Y. Use when the user asks to <trigger phrase>, mentions <keyword>,
  or needs <task>. Do not use for <out-of-scope>.
license: Apache-2.0
---

# My Skill

## Overview
What this does and when to reach for it.

## Process
1. Step…
2. Step…  (run `scripts/do-thing.py` for deterministic work)

## Verification
- Evidence the task succeeded (tests pass, output matches).

## References
- See `references/details.md` for the full spec (loaded on demand).
```

### 5.2 `.claude-plugin/plugin.json`
```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "Cross-agent skills for X. Preferred install via Claude Code marketplace.",
  "author": { "name": "Your Name", "url": "https://github.com/you" },
  "homepage": "https://github.com/you/your-repo",
  "license": "Apache-2.0",
  "keywords": ["skills", "agents", "x"]
}
```
> Omit any `skills` key — Claude auto-discovers `skills/*/SKILL.md`. Do NOT inline `mcpServers` here; use `.mcp.json`.

### 5.3 `.claude-plugin/marketplace.json`
```json
{
  "name": "my-marketplace",
  "owner": { "name": "Your Name", "url": "https://github.com/you" },
  "plugins": [
    { "name": "my-plugin", "source": "./", "description": "Cross-agent skills for X." }
  ]
}
```
> Avoid reserved marketplace names (`claude-code-plugins`, `anthropic-plugins`, `agent-skills`, etc.). Each plugin entry needs at minimum `name` + `source`; it may carry any `plugin.json` field plus marketplace-only fields (`category`, `tags`, `strict`).

### 5.4 `.mcp.json` (only if you ship MCP servers)
```json
{
  "mcpServers": {
    "my-server": {
      "type": "stdio",
      "command": "${CLAUDE_PLUGIN_ROOT}/scripts/server",
      "args": []
    }
  }
}
```
> Use `stdio` for local processes and `streamable-http` for remote servers (WebSocket is not a supported transport). On Windows, `npx`-based servers need a `cmd /c` wrapper.

### 5.5 `AGENTS.md` skeleton
```markdown
# AGENTS.md

## Project
Cross-agent skill pack. Canonical skills live in `skills/<name>/SKILL.md` (spec-pure).

## Install priority
1. Claude Code (preferred): `/plugin marketplace add you/your-repo` → `/plugin install my-plugin@my-marketplace`
2. Universal: `npx skills add you/your-repo -g`

## Dev
- Build adapters: `npm run build:adapters`
- Validate: `npm run validate` (claude plugin validate --strict, SKILL.md schema, shellcheck, ruff)
- Test: `uv run pytest`

## Conventions
- Edit only `skills/**`; `adapters/**` is generated — never hand-edit.
- LF line endings; scripts keep the executable bit.
- Never commit secrets; use env-based auth and dummy values in fixtures.
```

### 5.6 README sections
````markdown
## Install

### Claude Code (recommended — auto-updates via marketplace)
```
/plugin marketplace add you/your-repo
/plugin install my-plugin@my-marketplace
```
Recommended because the marketplace versions the plugin cache and auto-refreshes on new releases.
> SSH errors? The marketplace clones via SSH; use the full HTTPS URL to force HTTPS cloning:
> `/plugin marketplace add https://github.com/you/your-repo.git`

### Codex, Cursor, Copilot, Gemini CLI, and 50+ other Agent Skills hosts
```
npx skills add you/your-repo -g
```
`-g` installs globally for your user (drop it to scope per-project).

| Surface | Install |
|---|---|
| Claude Code (recommended) | `/plugin marketplace add you/your-repo` |
| Any Agent Skills host | `npx skills add you/your-repo -g` |
| Codex (manual) | copy skill into `~/.agents/skills/<name>/` |
| Copilot (manual) | copy into `.github/skills/<name>/` |
| Gemini CLI | `gemini extensions install https://github.com/you/your-repo` |

> Use one install method per machine — Claude Code does not dedupe across the marketplace plugin
> and an `npx skills` copy, so installing both shows duplicate slash-command entries.
````

### 5.7 Installer CLI interface
```
your-skills-install <command> [options]

Commands:
  add         Detect agents and install skills (default)
  update      Re-sync installed skills to current version
  uninstall   Remove installed skills, leave no residue
  list        Show what is installed and where

Options:
  -g, --global        Install to user dir instead of project
  -a, --agent <name>  Target specific agent(s); repeatable
  --dry-run           Print planned actions, write nothing
  --symlink           Symlink instead of copy (opt-in; Windows needs privileges)
  -y, --yes           Non-interactive (CI)
```

### 5.8 `.gitattributes`
```
* text=auto eol=lf
*.sh    text eol=lf
*.py    text eol=lf
*.md    text eol=lf
*.ps1   text eol=crlf
*.png   binary
*.skill binary
# Do NOT export-ignore skills/ or .claude-plugin/ — /plugin install needs them in the archive.
```

## 6. Known Footguns (call these out explicitly)
1. **Codex global skills path is `~/.agents/skills`, NOT `~/.codex/skills`.** Repo-scoped Codex skills are `.agents/skills/` (Codex scans `.agents/skills` from cwd up to repo root). Older docs/symlink tricks referenced `~/.codex/skills`; the cross-agent global convention is `~/.agents/skills` (shared by Copilot too).
2. **Inline `mcpServers` in `plugin.json` can be silently dropped** during manifest parsing (documented bug) — always declare MCP servers in a separate `.mcp.json`.
3. **`"skills": ["./"]` in `plugin.json` breaks Claude Code** with `Path escapes plugin directory: ./ (skills)`. Omit the key; let auto-discovery handle `skills/*/SKILL.md`.
4. **Windows symlink privileges:** default to copy; symlink only with elevation/Developer Mode.
5. **CRLF breaks shebangs:** enforce LF on `.sh`/`.py` via `.gitattributes`.
6. **`export-ignore` can empty your plugin:** if `.gitattributes` excludes `skills/`/`.claude-plugin/`, `git archive` (used by `/plugin install`) ships an empty plugin — exactly the last30days v3.0.1/v3.0.2 incident.
7. **Skills are a security risk:** they can carry prompt injection or malicious scripts (GitHub warns skills "may contain prompt injections, hidden instructions, or malicious scripts"). Document that users should inspect skills before install; Copilot's `gh skill preview` exists for this.
8. **Install-method dedup:** Claude Code does not dedupe across the marketplace plugin vs an `npx skills` copy — using both surfaces duplicate slash-command entries. Document "one method per machine."
9. **Version drift:** keep `plugin.json`, `gemini-extension.json`, and SKILL.md version headers synced — last30days shipped multiple PRs just to close header/manifest drift.

## 7. Acceptance Criteria (verify before done)
- [ ] Every `skills/*/SKILL.md` contains only `name` + `description` (+ spec-optional); no vendor-only frontmatter.
- [ ] `claude plugin validate --strict` passes on plugin and marketplace dirs.
- [ ] `plugin.json` has no `skills` key; Claude auto-discovers all skills.
- [ ] No inline `mcpServers` in `plugin.json`; MCP (if any) is in `.mcp.json`.
- [ ] `AGENTS.md` exists and documents install priority + dev commands.
- [ ] `adapters/` is fully generated by the build step; CI regenerate-and-diff is clean.
- [ ] Installer `--dry-run` works on macOS, Linux, Windows in CI.
- [ ] Re-running the installer reports "unchanged" (idempotent).
- [ ] Uninstall removes all installed files and leaves no residue.
- [ ] README leads with the Claude marketplace install, then the universal install.
- [ ] Versions in `plugin.json`, `gemini-extension.json`, and SKILL.md headers match; CHANGELOG updated.
- [ ] LICENSE (Apache-2.0) and docs license (CC-BY-4.0) present; shellcheck/ruff clean.

---

### Appendix A — Authoritative sources behind this runbook
- **Agent Skills open spec** (agentskills.io): SKILL.md = directory + `SKILL.md`; required frontmatter `name` (≤64 chars, lowercase/numbers/hyphens) and `description` (≤1024 chars); optional `scripts/`, `references/`, `assets/`; four-stage progressive disclosure (advertise ~100 tok → load <5,000 tok → read resources on demand). Released by Anthropic as an open standard December 18, 2025.
- **Claude Code plugins/marketplaces** (code.claude.com/docs): `plugin.json` optional; auto-discovers `skills/*/SKILL.md`; MCP via `.mcp.json` or inline (inline can be dropped — use the file); `claude plugin validate --strict` for CI; reserved marketplace names; plugins copied to cache (no `../` paths; use symlinks).
- **OpenAI Codex** (developers.openai.com/codex): repo skills in `.agents/skills`; `agents/openai.yaml` for invocation policy + MCP deps; `allow_implicit_invocation` default true.
- **GitHub Copilot** (docs.github.com, code.visualstudio.com): `.github/skills` (project) and `~/.copilot/skills` or `~/.agents/skills` (personal); reads `.claude/skills`/`.agents/skills`; `gh skill` (preview/install/publish, writes provenance frontmatter); SKILL.md added Dec 18 2025.
- **AGENTS.md** (agents.md): open Markdown format, 60k+ projects, Linux Foundation / Agentic AI Foundation stewardship; OpenAI repo uses 88 AGENTS.md files; nearest file wins.
- **Vercel `skills` / skills.sh** (github.com/vercel-labs/skills): `npx skills add/remove/list/find/update/init`; `-g`, `-a <agents>`, `-s <skills>`, `-y`, `--list`, `--copy`; supports "OpenCode, Claude Code, Codex, Cursor, and 67 more"; launched Jan 20, 2026.
- **Gemini CLI** (geminicli.com): `gemini-extension.json` manifest (`name`, `version`, `contextFileName`, `mcpServers`); skills under `skills/<name>/SKILL.md`; `gemini extensions install/update/link`.
- **MCP Registry** (modelcontextprotocol.io): `server.json` (reverse-DNS `name`, `packages`, `transport`); separate from Claude's `.mcp.json` runtime config.
- **Reviewed repos:** `mvanhorn/last30days-skill` (single-skill, MIT, marketplace `last30days-skill`, plugin `last30days`); `addyosmani/agent-skills` (skill library, MIT, marketplace `addy-agent-skills`, plugin `agent-skills`).

> **Sourcing caveat:** the exact verbatim JSON of both repos' `plugin.json`/`marketplace.json` could not be machine-fetched (GitHub raw/blob file bodies were not retrievable by the tools used). Plugin/marketplace **names**, MIT licensing, owners, and the dropped-`skills`-key fix are well-corroborated from READMEs, release notes, and the ClaudePluginHub catalog; precise field ordering, version strings, and `source` values were inferred. Treat §5 manifests as best-practice templates, not literal copies of the reviewed repos.