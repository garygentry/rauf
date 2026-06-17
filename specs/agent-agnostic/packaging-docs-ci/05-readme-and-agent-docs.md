# 05 — READMEs & Per-Agent Setup Docs

> **Feature:** `packaging-docs-ci` (epic `agent-agnostic`, capstone 6 of 6).
> **Status:** domain document. Depends on `00-core-definitions.md` and `01-architecture-layout.md`.

This document specifies the **user-facing documentation surface** of the capstone: the
install-first rewrite of the feature-forge README, the labeled cross-agent edit to the rauf README,
the five per-agent setup docs (`docs/agents/<agent>.md`), the default forge↔rauf loop-path content,
and the accuracy-verification recipe that keeps every command/path in both READMEs real. It builds
on the agent set, doc-artifact set, and consumed installer-CLI contract fixed in
`00-core-definitions.md`; it does not redefine them.

The deliverable is prose + markdown, not code — but the structure (section ordering, table columns,
per-doc outline) is treated as a contract with verifiable bars, in the same way a function signature
is. Every authored sentence traces to a `REQ-XXX-NN` or a tech-spec decision.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-README-01 | feature-forge README leads with (a)→(b)→(c) install story | §1 |
| REQ-README-02 / REQ-CONS-01 | rauf README keeps loop-runner shape + cross-links cross-agent story | §2 |
| REQ-README-03 / SC-08 | Both READMEs accurate against shipped artifacts | §1.4, §2.2, §5 |
| REQ-DOCS-01 | A dedicated setup doc per supported agent (five files) | §3 |
| REQ-DOCS-02 | Per-agent docs reachable from the README table | §1.3, §3.1 |
| REQ-DOCS-03 | Per-agent docs cover install + first-use check | §3.2 |
| REQ-DOCS-04 | Default forge↔rauf loop path documented (consumes `forge-loop-runner-contract`) | §4 |

## 0. Verified Source Facts (cited)

Every concrete command, coordinate, and path below was confirmed against the working trees on
authoring. Implementers MUST re-confirm with the §5 recipe before considering the docs done.

| Fact | Value | Source (file:line) |
|---|---|---|
| Marketplace add coordinate | `garygentry/feature-forge` | `feature-forge/README.md:17` (current install block) |
| Marketplace install coordinate | `feature-forge@feature-forge` | `feature-forge/README.md:20`; `.claude-plugin/marketplace.json` (`name: "feature-forge"`, `plugins[0].name: "feature-forge"`) |
| Universal one-liner bin | `npx feature-forge install` | `installer/package.json:5` (`"bin": { "feature-forge": "dist/cli.js" }`); examples at `installer/src/cli.ts:612` |
| Per-agent scope flag | `-a/--agent <id>` (values `claude\|codex\|copilot\|cursor\|gemini`) | `installer/src/cli.ts:86`; `AGENT_IDS` (cli.ts:33); validated cli.ts:143-148 |
| Global scope flag | `-g/--global` | `installer/src/cli.ts:87` |
| Dry-run / JSON flags | `--dry-run`, `--json` | `installer/src/cli.ts:90,92` |
| Skip-rauf flag | `--skip-rauf` | `installer/src/cli.ts:93`; `installer/src/rauf.ts:51` |
| rauf pin | `RAUF_PIN = "rauf@0.6.0"` (unpublished today) | `installer/src/rauf.ts:30` |
| Adapter dirs (all five present) | `adapters/{claude,codex,copilot,cursor,gemini}/` | `ls feature-forge/adapters/` — verified |
| Per-agent doc paths (NEW) | `docs/agents/<agent>.md` | `00-core-definitions.md` §2 (`agentDocPath`); `docs/agents/` does NOT exist yet — verified |
| Loop-contract source | `feature-forge/references/ralph-loop-contract.md` | verified present; the `forge-loop-runner-contract` expose |

> **PATH-DERIVATION WARNING (tech-spec §6.1 / OQ-E; cross-agent-installer TQ-1).** The
> per-agent **config-dir install paths** for codex / copilot / cursor / gemini are marked
> "best-known, NOT source-verified" in the cross-agent-installer spec. Per-agent docs MUST
> therefore **derive the install destination from the installer's own
> `npx feature-forge install -a <agent> --dry-run --json` output** rather than asserting an
> agent's config convention. Claude's `~/.claude` destination is the only one treated as
> well-known. See §3.2 ("Install") and §3.4 for the exact wording each doc uses.

## 1. feature-forge README — Install-First Rewrite (REQ-README-01, REQ-DOCS-02)

### 1.1 The verifiable bar

The current README (verified) opens `# feature-forge` → `## Overview` → `## Install`. The rewrite
moves the install elements ahead of all non-install content. **The verifiable bar (SC-01):** before
the **first non-install `##`-level heading after the title**, the README presents, *in order*:

1. **(a)** the Claude-preferred marketplace install,
2. **(b)** the universal one-liner install,
3. **(c)** the per-surface table (5 agents → install path + link to `docs/agents/<agent>.md`).

"Non-install" means any `##` section that is not one of these three install elements (e.g.
`## Pipeline`, `## Pipeline Stages`, `## Quick Start`, `## Overview`). The existing pitch sentence
(the one-line description under the title) MAY remain above the install blocks — it is not a `##`
section. Everything after (c) (Pipeline, Stages, Overview, etc.) is retained **unchanged in
content**; only its position moves below the install story.

### 1.2 Target top-of-README structure (skeleton)

The three install elements may share one `## Install` umbrella or be three sibling `##` sections;
either satisfies the bar so long as (a)→(b)→(c) ordering holds and no non-install `##` interleaves.
The skeleton below uses a single `## Install` umbrella with `###` sub-blocks (preferred — it keeps
one install anchor):

```markdown
# feature-forge

End-to-end feature development pipeline that runs on any coding agent — Claude, Codex,
Copilot, Cursor, or Gemini. Transforms a feature idea into an implementation-ready spec
suite through structured interviews, automated verification, and persistent state tracking.

## Install

### (a) Claude Code (preferred) — marketplace

```bash
# Register the marketplace (one-time)
/plugin marketplace add garygentry/feature-forge

# Install the plugin
/plugin install feature-forge@feature-forge
```

### (b) Any agent — one-liner

Installs the canonical skills into every coding agent detected on your machine:

```bash
npx feature-forge install
```

Scope to one agent with `-a`, or preview without writing using `--dry-run`:

```bash
npx feature-forge install -a codex        # one agent
npx feature-forge install --dry-run --json # preview the plan, change nothing
```

### (c) Per-surface setup

| Agent   | Install                                              | Setup doc |
|---------|------------------------------------------------------|-----------|
| Claude  | `/plugin install feature-forge@feature-forge` *(or `npx feature-forge install -a claude`)* | [docs/agents/claude.md](docs/agents/claude.md) |
| Codex   | `npx feature-forge install -a codex`                 | [docs/agents/codex.md](docs/agents/codex.md) |
| Copilot | `npx feature-forge install -a copilot`               | [docs/agents/copilot.md](docs/agents/copilot.md) |
| Cursor  | `npx feature-forge install -a cursor`                | [docs/agents/cursor.md](docs/agents/cursor.md) |
| Gemini  | `npx feature-forge install -a gemini`                | [docs/agents/gemini.md](docs/agents/gemini.md) |

<!-- first non-install `##` section begins below this point -->

## Overview
...(existing content, unchanged)...
```

### 1.3 Table contract (REQ-DOCS-02)

The per-surface table (element c) MUST:
- have **exactly five rows**, one per `SUPPORTED_AGENTS` member (`00-core-definitions.md` §2), in the
  canonical order `claude, codex, copilot, cursor, gemini`;
- give each row an **Install** cell whose command resolves (Claude's marketplace coordinate or a real
  `npx feature-forge install -a <agent>` invocation — the `-a` value is a validated `AGENT_IDS`
  member, cli.ts:143-148);
- link each row to its `docs/agents/<agent>.md` via a **relative** link (so it resolves on GitHub and
  in a local clone) — satisfying REQ-DOCS-02. Each linked path is `ls`-confirmed by §5.

The Claude row's primary install is the marketplace path (preferred per `00` §2: Claude is
first-class); the `npx … -a claude` alternative is shown parenthetically so the table is internally
consistent with element (b).

### 1.4 Accuracy carve-out — the only aspirational command (REQ-README-03, tech-spec §3.6/decision 1)

Every command in the feature-forge README resolves **today** — the marketplace coordinate is real,
and `npx feature-forge install …` runs the built installer. The README MUST NOT show any
`npx rauf@0.6.0` command as currently working: rauf is `private:true` / unpublished
(`installer/src/rauf.ts:30`, `RAUF_PIN = "rauf@0.6.0"`). If the loop-runner default is mentioned
here (it is more fully covered in `docs/agents/claude.md`, §4), any reference to the rauf npm path
MUST carry the literal label **"available once rauf 0.6.0 is published"** and MUST NOT be presented
as a working install step. This is the single sanctioned aspirational reference (decision 1); all
other commands/paths are real-today (REQ-README-03, SC-08).

## 2. rauf README — Cross-Agent Cross-Link Edit (REQ-README-02, REQ-CONS-01)

### 2.1 What changes and what does not

rauf's README (verified) is a loop-runner **product** README: title pitch
("Autonomous coding loops, managed."), MIT badge, "How It Works", "Features", "Install"
(from-source + prebuilt binary), "Quick Start". Per **REQ-CONS-01** (deliberate divergence from the
charter's "rewrite both READMEs to the same shape"), rauf is a binary, not a per-agent skills
bundle, so it **keeps this shape entirely**. This is an **EDIT, not a rewrite**: it ADDS one clearly
labeled section and changes nothing else.

**Add** a section — recommended heading `## Multi-agent / feature-forge` — that cross-links
feature-forge's cross-agent install story. Recommended placement: after `## Features` and before or
just after `## Install` (it is product context, not a rauf install step). rauf does **not** adopt the
marketplace-first per-surface table.

Skeleton for the added section:

```markdown
## Multi-agent / feature-forge

Rauf is the default loop runner for [feature-forge](https://github.com/garygentry/feature-forge),
an agent-agnostic spec-and-backlog pipeline that runs on Claude, Codex, Copilot, Cursor, and
Gemini. feature-forge hands its generated backlog to a conforming runner; when no runner is
configured it defaults to rauf. See feature-forge's README for the cross-agent install story and
its per-agent setup docs.
```

### 2.2 Keeping `check:docs` green (tech-spec §6.5; verified against `scripts/check-docs.ts`)

The added section is scanned by rauf's `check:docs` gate (`scripts/check-docs.ts`, run by
`pnpm gate`/CI; it scans `README.md` among other docs — `check-docs.ts:47`). The new section MUST
avoid every trigger the gate flags, confirmed from source:

1. **Removed grammar (check-docs.ts:80-98).** Do NOT write `loop start`, `loop watch`,
   `loop follow`, `status --watch`, or a bare `--watch` as a current command (in inline code, as
   `rauf loop start`, or leading a fenced command line). Use the current grammar
   (`loop run --detached`, `--follow`, `status --follow`) if any loop command is shown — but the
   recommended section shows **no** rauf loop commands at all, sidestepping this entirely.
2. **`ralph` branding leak (check-docs.ts:101-110).** The README is an *authored* page (not a
   symlinked spec), so any bare `ralph` token (outside a `.ralph` path or a removal-context line)
   fails. Do NOT write "ralph" anywhere in the section. Use "feature-forge" / "rauf" only. (Note: the
   loop-contract source file is named `ralph-loop-contract.md`; do NOT name that file in the rauf
   README — link to feature-forge's README instead, which avoids surfacing the token.)
3. **Stale version-tag pins (check-docs.ts:113-118).** Do NOT hard-code a `v0.0.x`–`v0.3.x` pin. The
   recommended section pins no version. If a version must appear, use the current `version.ts` value,
   never a `v0.[0-3].x` literal.
4. **CLI command/spec parity (check-docs.ts:132-153).** This check diffs `packages/cli/src/commands.ts`
   names against `docs/SPEC-CLI.md` — the README edit introduces **no new CLI command**, so it cannot
   trip this. Do NOT invent a rauf subcommand in the section.

The MIT badge at `README.md:5` stays accurate (rauf remains MIT — tech-spec §3.11); no badge change.

> **Verification:** after the edit, `pnpm gate` (which includes `check:docs`) MUST stay green
> (tech-spec §8 rauf bar). The §5 recipe + a local `pnpm gate` run confirm this.

## 3. Per-Agent Setup Docs (REQ-DOCS-01, REQ-DOCS-02, REQ-DOCS-03)

### 3.1 The five files

Author exactly five files, one per `SUPPORTED_AGENTS` member, at the paths fixed by
`00-core-definitions.md` §2 (`agentDocPath`, settling PRD OQ-01):

```
feature-forge/docs/agents/claude.md     (NEW — also hosts the default-loop-path content, §4)
feature-forge/docs/agents/codex.md      (NEW)
feature-forge/docs/agents/copilot.md    (NEW)
feature-forge/docs/agents/cursor.md     (NEW)
feature-forge/docs/agents/gemini.md     (NEW)
```

The `docs/agents/` directory does **not** exist yet (verified) — it is created by this feature. Each
file MUST be linked from the README per-surface table (REQ-DOCS-02, §1.3).

### 3.2 Per-doc template (REQ-DOCS-03)

Every per-agent doc MUST cover **Install** + a **First-use check**. Use this outline for all five
(substitute `<agent>` and adjust the marketplace block, which appears only in `claude.md`):

```markdown
# feature-forge on <Agent>

> Canonical skills for the feature-forge pipeline, installed onto <Agent>.
> The skills are spec-pure; <Agent>'s adapter is generated from canon (do not hand-edit
> `adapters/<agent>/`).

## Install

<!-- Claude only: marketplace block first (preferred) -->
```bash
/plugin marketplace add garygentry/feature-forge
/plugin install feature-forge@feature-forge
```

<!-- All agents: the installer path -->
```bash
npx feature-forge install -a <agent>
```

This copies the generated `adapters/<agent>/` bundle into <Agent>'s config directory.
To see the exact destination on your machine without writing anything, run:

```bash
npx feature-forge install -a <agent> --dry-run --json
```

The `--dry-run --json` plan reports the resolved install destination — use that as the
authoritative path. (The install destination is derived from the installer, not asserted
here; see the note below.)

> **Note (install path):** the destination for non-Claude agents is taken from the
> installer's `--dry-run --json` plan, not hard-coded in this doc — the cross-agent
> installer treats codex/copilot/cursor/gemini config-dir conventions as best-known but
> unverified. Claude installs under `~/.claude`.

> **Known gap (installed-bundle self-location):** an installed non-Claude
> `adapters/<agent>/` bundle does not currently carry `epic-manifest.py` /
> `.claude-plugin/plugin.json`, so the portable resolver `scripts/forge-root.sh` cannot
> self-locate from an installed bundle. This is a known limitation owned by the adapter
> generator; it does not block install/first-use here.

## First-use check

1. List what got installed:
   ```bash
   npx feature-forge list -a <agent>          # per-agent installed / up-to-date status
   ```
2. Invoke a forge skill on <Agent> (e.g. start a status check or `forge-init`) and confirm
   the skill fires. <Agent>-specific invocation: <one concrete invocation line for this agent>.

## Loop runner (forge-5-loop)

See [The default loop runner](#the-default-loop-runner) — feature-forge defaults to rauf and
selects the coding agent via the precedence below.  <!-- claude.md hosts the full §4 content;
the other four link to it / to claude.md#the-default-loop-runner -->
```

**Per-doc requirements:**
- **Install** (REQ-DOCS-03) — every doc shows the installer invocation
  `npx feature-forge install -a <agent>` (verified flag, cli.ts:86) AND references the adapter
  location `adapters/<agent>/` (verified present). `claude.md` additionally leads with the
  marketplace block (preferred surface).
- **First-use check** (REQ-DOCS-03) — every doc gives a confirmation step: `list -a <agent>`
  (verified subcommand, cli.ts:80) to enumerate installed state, plus one concrete "invoke a forge
  skill" line for that agent.
- **Install-path derivation** (PATH-DERIVATION WARNING) — every non-Claude doc instructs the reader
  to read the destination from `--dry-run --json`, never asserting an unverified config-dir
  convention.
- **Self-location gap (tech-spec OQ-B / IR-1)** — every doc FLAGS the installed-bundle self-location
  gap in its install flow (the "Known gap" callout). The docs **flag it, they do not fix it** — the
  fix is owned by the adapter generator (`forge-agent-adapters-build`).

### 3.3 The Claude doc carries the default-loop content

`docs/agents/claude.md` is the natural home for the full default-loop-path section (§4), since rauf
is the default runner and Claude is the default agent. The other four docs link to it
(`docs/agents/claude.md#the-default-loop-runner`) rather than duplicating it, satisfying REQ-DOCS-04
via "at least one doc."

### 3.4 No `ralph` token leakage in feature-forge docs

The loop-contract source file is `references/ralph-loop-contract.md`. feature-forge has **no
`check:docs` gate** (that gate is rauf-only), so naming the file is not a hard failure there — but
for cross-repo consistency the per-agent docs SHOULD link the contract by its repo-relative path
(`references/ralph-loop-contract.md`) only where necessary and otherwise refer to "the loop-runner
contract." (The rauf README, §2.2, must avoid the token outright.)

## 4. Default forge↔rauf Loop Path (REQ-DOCS-04 — consumes `forge-loop-runner-contract`)

This content lives under a `## The default loop runner` heading in `docs/agents/claude.md`
(linkable as `#the-default-loop-runner`). It is sourced **verbatim in substance** from
`feature-forge/references/ralph-loop-contract.md` (the `forge-loop-runner-contract` expose, verified
present) and MUST link that file. Authoring this section satisfies the charter's
`consumes forge-loop-runner-contract` obligation.

**Content the section MUST state (each traced to the contract doc):**

1. **forge-5-loop defaults to rauf.** When `forge.config.json` has no `loopRunner` block,
   feature-forge uses the built-in defaults and announces "defaulting to the rauf loop runner."
   *(Source: ralph-loop-contract.md "The seam" + "rauf is the default and reference implementation".)*

2. **Agent-selection precedence flows forge→rauf.** State the precedence exactly:
   **`item > run > project > default`**, realized as:
   - **item** — `BacklogItem.provider`, applied by **rauf** from the backlog; forge never reads,
     writes, or overrides it (pass-through) — a deliberate per-item agent always wins.
   - **run** — forge's per-run `--agent` selector (`forge-5-loop` Step 2d).
   - **project** — forge's `loopRunner.defaultAgent`.
   - **default** — the runner's own default, **`claude-cli`** for rauf, when forge sends nothing.

   Render it as the contract's one-line summary so it is unambiguous:
   > Agent selection precedence: **`item (rauf backlog) > run (forge --agent) > project (forge
   > loopRunner.defaultAgent) > rauf default (claude-cli)`**.
   *(Source: ralph-loop-contract.md "Precedence and the run-layer mapping".)*

3. **`validate` is agent-agnostic.** Backlog validation (`forge-4-backlog`, `forge-verify`) runs the
   `validate` verb and **never** passes an agent (`--agent`, `{agent}`, or any id). Only
   `forge-5-loop` (execution) carries the agent dimension.
   *(Source: ralph-loop-contract.md "`validate` is agent-agnostic" + "Per-stage agent applicability".)*

4. **Version floor.** feature-forge floors the runner at **rauf 0.6.0**
   (`loopRunner.minRunnerVersion`) — the version that ships the `--agent` flag, the `agents` probe,
   and the preset agent registry; forge checks `{bin} version --json` before any run.
   *(Source: ralph-loop-contract.md "Version gating".)*

5. **The rauf-on-npm caveat (REQ-README-03 carve-out, tech-spec decision 1).** If the section
   mentions provisioning rauf via npm (`npx rauf@0.6.0`), it MUST carry the literal label
   **"available once rauf 0.6.0 is published"** — rauf is unpublished today (`RAUF_PIN`,
   rauf.ts:30). Do not present it as a working command.

**Link requirement:** the section MUST link the contract doc, e.g.
`See [the loop-runner contract](../../references/ralph-loop-contract.md)` (relative path from
`docs/agents/claude.md`).

Skeleton:

```markdown
## The default loop runner

`forge-5-loop` hands the generated `backlog.json` to a loop runner that implements each item.
With no `loopRunner` block in `forge.config.json`, feature-forge **defaults to rauf** and
announces "defaulting to the rauf loop runner."

**Agent selection** flows forge → rauf with this precedence:

> `item (rauf backlog) > run (forge --agent) > project (forge loopRunner.defaultAgent) >
> rauf default (claude-cli)`

- **item** — `BacklogItem.provider` in the backlog; rauf applies it, forge passes it through.
- **run** — `forge --agent <id>` for this run (forge-5-loop selector).
- **project** — `loopRunner.defaultAgent` in `forge.config.json`.
- **default** — rauf's own default, `claude-cli`, when forge sends nothing.

Backlog **`validate`** (forge-4-backlog / forge-verify) is **agent-agnostic** — it never takes
an agent. Only execution (forge-5-loop) carries the agent dimension.

feature-forge floors the runner at **rauf 0.6.0** (`minRunnerVersion`) and checks
`rauf version --json` before running. *(rauf provisioning via `npx rauf@0.6.0` is available
once rauf 0.6.0 is published.)*

See [the loop-runner contract](../../references/ralph-loop-contract.md) for the full spec.
```

## 5. Accuracy Verification Recipe (REQ-README-03, SC-08)

Before the docs are considered done, exercise every install command/path in a **local dry-run** and
`ls`-confirm every referenced artifact. This is the SC-08 bar: "zero stale or failing instructions."

```bash
# (1) Marketplace coordinate is real — confirm the plugin name/source exist.
cat feature-forge/.claude-plugin/marketplace.json   # name: feature-forge, plugins[0].name: feature-forge
# => /plugin marketplace add garygentry/feature-forge ; /plugin install feature-forge@feature-forge

# (2) Universal one-liner + every -a <agent> value resolve via the installer dry-run.
cd feature-forge/installer && npm ci && npm run build
for a in claude codex copilot cursor gemini; do
  node dist/cli.js install -a "$a" --dry-run --skip-rauf --json   # assert exit 0 + valid JSON
done
node dist/cli.js install --dry-run --skip-rauf --json             # the bare one-liner

# (3) Every per-surface table link + adapter dir is a real path.
for a in claude codex copilot cursor gemini; do
  ls feature-forge/docs/agents/$a.md      # REQ-DOCS-01 file exists, table link resolves
  ls -d feature-forge/adapters/$a/        # adapter dir exists (verified)
done

# (4) The one aspirational command carries its label — it is NOT exercised as working.
grep -n "rauf@0.6.0" feature-forge/README.md feature-forge/docs/agents/*.md
#   every hit MUST be on/near a line containing "available once rauf 0.6.0 is published"

# (5) rauf README edit keeps the docs gate green.
cd rauf && pnpm gate          # includes check:docs (scripts/check-docs.ts) — must pass
```

`--skip-rauf` is used in step (2) because rauf is unpublished; without it the dry-run fails for an
out-of-scope reason (`installer/src/rauf.ts` preflight; `00-core-definitions.md` §7).

## Dependencies

- **`00-core-definitions.md`** — `SUPPORTED_AGENTS` + canonical ordering (§2); `agentDocPath` /
  `agentAdapterDir` path conventions (§2, settles OQ-01); the consumed `InstallerCliContract`
  surface and OS-matrix invocation (§7); the doc-artifact set (§6).
- **`01-architecture-layout.md`** — the cross-repo file inventory (§1): README dispositions
  (feature-forge REWRITE, rauf EDIT), the five `docs/agents/*.md` as NEW, and the
  feature-forge-vs-rauf repo split (REQ-CONST-02).

These two foundation docs MUST be authored first. This document authors **no** new shared types; it
references the above. (Sibling domain docs `02`/`03`/`04`/`06` are independent of this one and may be
authored in parallel.)

## Verification

Maps to the success criteria this document owns:

- [ ] **SC-01 (REQ-README-01):** feature-forge README presents (a) marketplace → (b) one-liner →
      (c) per-surface table, in order, before the first non-install `##` section. Confirm by reading
      the heading sequence top-down (§1.1).
- [ ] **SC-01 (REQ-README-02 / REQ-CONS-01):** rauf README retains its loop-runner shape and adds one
      labeled cross-agent section linking feature-forge; no marketplace table added (§2.1).
- [ ] **SC-01 / SC-08 (REQ-README-03):** every install command/path in both READMEs resolves to a
      real artifact via the §5 recipe; the only aspirational command (`npx rauf@0.6.0`) carries the
      "available once rauf 0.6.0 is published" label (§1.4, §4).
- [ ] **rauf gate:** `pnpm gate` (incl. `check:docs`) stays green after the rauf README edit — no
      removed grammar, no `ralph` token, no stale `v0.[0-3].x` pin, no phantom CLI command (§2.2).
- [ ] **SC-02 (REQ-DOCS-01):** five `docs/agents/{claude,codex,copilot,cursor,gemini}.md` exist
      (`ls`-confirmed) (§3.1).
- [ ] **SC-02 (REQ-DOCS-02):** the README per-surface table links all five docs with resolving
      relative links (§1.3).
- [ ] **REQ-DOCS-03:** each per-agent doc covers Install (`npx feature-forge install -a <agent>` +
      adapter location) and a first-use check (`list -a <agent>` + a skill-invocation line) (§3.2).
- [ ] **Path-derivation:** each non-Claude doc derives the install destination from
      `--dry-run --json`, not from an asserted config-dir convention (§3.2 / WARNING).
- [ ] **Self-location gap flagged:** each per-agent doc carries the installed-bundle self-location
      "Known gap" callout (tech-spec OQ-B) — flagged, not fixed (§3.2).
- [ ] **SC-02 (REQ-DOCS-04):** `docs/agents/claude.md` documents forge-5-loop defaults to rauf, the
      `item > run > project > default` precedence, the agent-agnostic `validate`, and the 0.6.0
      floor, and links `references/ralph-loop-contract.md` (§4).
