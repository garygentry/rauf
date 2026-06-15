# agent-agnostic — Epic

## Overall Goal

Make both the **rauf** loop runner (this repo) and the **feature-forge** skill/pipeline repo
(`../feature-forge`) operate optimally under *any* coding agent — Claude Code, OpenAI Codex,
GitHub Copilot, Cursor, Gemini CLI, and the broader open Agent Skills ecosystem — and be
packageable and installable for multiple agents with minimal configuration.

The two repos carry different flavours of "agent-agnostic":

- **rauf** is the loop runner. Here, agent-agnostic primarily means a **coding-agent CLI adapter
  layer**: the runner must be able to drive a single loop iteration through any agent's CLI
  (`claude`, `codex`, `gemini`, `copilot`, `cursor`, …), not just `claude` — while keeping the
  Claude path first-class and the default.
- **feature-forge** is the collection of skills, subagents, and utilities for feature
  development. Here, agent-agnostic carries the full "runbook" treatment: a **spec-pure
  canonical core**, **generated per-agent adapters**, a canonical **`AGENTS.md`**, a **universal
  installer**, and hardened **packaging / docs / CI**.

Because the loop is integral to the feature-forge lifecycle, the two are tackled together:
feature-forge **defaults to rauf**, **ships rauf** as part of its multi-agent install, and still
**supports alternate loop runners**. The epic spans structure, operation, packaging/installation,
and documentation across both repos. Throughout, the Claude Code plugin + marketplace install
path stays first-class and "preferred"; everything else is derived from a single canonical
source, never hand-edited divergently.

## Decomposition Rationale

The change splits along two axes — *which repo* and *which concern* — into six pipeline-sized
features, each a unit a full PRD→loop pipeline can carry end-to-end:

- **rauf's runner work** is one self-contained foundation (`rauf-agent-cli-adapters`) with no
  dependencies; it is the seam everything cross-agent in the loop hangs off.
- **feature-forge's canonical work** is deliberately two units, not one: making every `SKILL.md`
  spec-pure (`forge-skill-spec-purity`) is a repo-wide *refactor* and the single source of truth,
  whereas the *generator* that derives per-agent adapters from that canon
  (`forge-agent-adapters-build`) is new tooling. Keeping them separate gives cleaner traceability
  and lets the generator depend on a settled canon.
- **`cross-agent-installer`** is the packaging seam: it consumes the generated adapters *and*
  bundles rauf, so it depends on both the generator and the rauf adapter layer.
- **`forge-rauf-loop-default`** is the explicit forge↔rauf integration: forge-5-loop defaults to
  rauf across coding agents while staying pluggable.
- **`packaging-docs-ci`** is the capstone that documents and CI-gates the whole assembled system
  across both repos; it sits downstream of everything substantive.

Order is the user-declared presentation sequence (rauf foundation → forge canon → generation →
installer → integration → capstone); the authoritative build order is the dependency graph below,
which is acyclic.

## Features

### rauf-agent-cli-adapters

Target repo: rauf. Give the loop runner a coding-agent CLI adapter layer so a single loop
iteration can be executed by any coding-agent CLI (claude, codex, gemini, copilot, cursor, ...),
not just `claude`, with claude remaining the default. Introduce an AgentAdapter abstraction
(spawn the agent process, parse its stream, detect loop signals) and an agent-cli registry that
maps each supported agent to its invocation/stream/signal configuration plus a detection probe.
Surface agent selection through the runner (e.g. a `--agent` option / config) following the
existing model-selection precedence. Must keep the claude path first-class and not degrade
existing loop behavior. Exposes the adapter interface, the registry, and the agent-selection
surface that the installer bundles and that feature-forge's loop integration drives.

**Depends on:** nothing

#### Contracts
**Exposes:**
- `AgentAdapter` (type) — Abstraction for driving a coding-agent CLI through one loop iteration: process spawn, stream parse, signal detection.
- `agent-cli-registry` (module) — Registry + runtime detection of supported agent CLIs with per-agent invocation/stream/signal config.
- `loop-agent-selection` (module) — Runner surface (e.g. --agent / config) selecting the coding agent for a loop run; defaults to claude.

**Consumes:**
- Nothing consumed.

### forge-skill-spec-purity

Target repo: feature-forge. Establish the spec-pure canonical core: audit every
skills/*/SKILL.md, reduce frontmatter to the spec-sanctioned set (name + description, plus
optional license/compatibility/metadata/allowed-tools), and relocate every vendor-only key
(Claude hook wiring, Codex invocation policy, Copilot invocation flags) out of the canonical
body. Replace ${CLAUDE_PLUGIN_ROOT} inside bundled scripts with a portable multi-root resolver
that probes the candidate skill roots. Keep skill bodies within the recommended size, pushing
detail into references/. This feature owns the single source of truth from which all per-agent
adapters are later generated; it changes no per-agent output itself. Exposes the spec-pure skill
set and the portable resolver that the build step consumes.

**Depends on:** nothing

#### Contracts
**Exposes:**
- `spec-pure-skills` (module) — Canonical skills/*/SKILL.md reduced to spec-sanctioned frontmatter — the single source of truth for adapter generation.
- `portable-skill-root-resolver` (function) — Script-side resolver replacing ${CLAUDE_PLUGIN_ROOT} with multi-root probing across agent skill dirs.

**Consumes:**
- Nothing consumed.

### forge-agent-adapters-build

Target repo: feature-forge. Add the canonical-to-per-agent build step: a generator that walks the
spec-pure canonical skills, parses frontmatter, and emits per-agent artifacts (Codex mirror +
optional agents/openai.yaml, Copilot copy with Copilot frontmatter, Cursor .mdc,
gemini-extension.json) into adapters/, each carrying a DO-NOT-EDIT generated header. Author the
canonical AGENTS.md cross-agent project instructions (documenting build/test/conventions and
install priority). Wire a CI regenerate-and-diff so generated adapters can never drift from canon.
Consumes the spec-pure skills and portable resolver as read-only inputs. Exposes the generator,
AGENTS.md, and the generated adapters/ tree that the installer ships.

**Depends on:** forge-skill-spec-purity

#### Contracts
**Exposes:**
- `build-adapters` (function) — Generator deriving per-agent artifacts (codex/copilot/cursor/gemini) from the canonical skills.
- `AGENTS.md` (module) — Canonical cross-agent project instructions: build/test, conventions, and install-path priority.
- `adapters-output` (module) — Generated adapters/ tree (per-agent skill mirrors + manifests) consumed by the installer and CI diff.

**Consumes:**
- `spec-pure-skills` from `forge-skill-spec-purity` — Read-only canonical input the generator derives all per-agent adapters from.
- `portable-skill-root-resolver` from `forge-skill-spec-purity` — Resolver copied into the generated per-agent script mirrors.

### cross-agent-installer

Target repo: feature-forge (bundles rauf). Ship a cross-platform, zero-config CLI installer that
detects installed coding agents by probing their config dirs and installs the generated per-agent
skills idempotently — supporting add/update/uninstall/list, --dry-run, --global/-g, --agent/-a,
--symlink (opt-in; copy by default on Windows), and -y for CI. The installer also bundles rauf as
the default loop runner so a multi-agent install yields a working loop out of the box. Consumes
the generated adapters output and rauf's agent adapter layer/binary. Exposes the installer CLI
and its per-agent detection map that packaging/docs and the forge loop integration rely on.

**Depends on:** forge-agent-adapters-build, rauf-agent-cli-adapters

#### Contracts
**Exposes:**
- `cross-agent-installer-cli` (module) — npx-style installer: detect agents, copy/symlink skills, dry-run/update/uninstall/list; bundles rauf.
- `agent-detection-map` (function) — Per-agent config-dir map + detection used to target installs and CI dry-runs.

**Consumes:**
- `adapters-output` from `forge-agent-adapters-build` — The generated per-agent artifacts the installer copies/symlinks into each agent's dir.
- `agent-cli-registry` from `rauf-agent-cli-adapters` — rauf's agent adapter layer, bundled as the default loop runner in the multi-agent install.

### forge-rauf-loop-default

Target repo: feature-forge (integration with rauf). Wire the feature-forge loop stage
(forge-5-loop) to default to rauf as its loop runner while still supporting alternate runners
through the existing loopRunner config, and to drive iterations across coding agents via rauf's
agent adapter layer. Ensure forge locates/ships rauf through the installer so the default path
works after a multi-agent install. This feature owns the forge<->rauf seam: the loop-runner
contract, the default-to-rauf-but-pluggable behavior, and agent selection flowing from forge
through rauf. Consumes rauf's adapter layer and the installer; exposes the forge loop-runner
contract that packaging/docs documents.

**Depends on:** rauf-agent-cli-adapters, cross-agent-installer

#### Contracts
**Exposes:**
- `forge-loop-runner-contract` (module) — forge-5-loop drives rauf by default, supports alternate runners, and selects the coding agent per run.

**Consumes:**
- `loop-agent-selection` from `rauf-agent-cli-adapters` — Agent selection surface forge passes through when invoking rauf across coding agents.
- `cross-agent-installer-cli` from `cross-agent-installer` — Locates/ships the bundled rauf so the default loop path works post-install.

### packaging-docs-ci

Target repos: both (capstone). Finalize and gate the assembled cross-agent system. Rewrite both
repos' READMEs to lead with the Claude-preferred marketplace install then the universal one-liner
and a per-surface table; add per-agent setup docs. Stand up CI gates: claude plugin validate
--strict, SKILL.md schema validation (name/description, name==dir), shellcheck/ruff,
trigger-accuracy evals, an OS matrix running the installer --dry-run + uninstall, and the adapters
regenerate-and-diff. Handle cross-OS concerns (.gitattributes LF/export-ignore safety, executable
bits) and align versioning/licensing (semver + CHANGELOG, synced version headers across
plugin.json/gemini-extension.json/SKILL.md, Apache-2.0 + docs license). Consumes the installer,
the forge loop contract, the adapters output, and the spec-pure skills as the things it documents
and gates.

**Depends on:** cross-agent-installer, forge-rauf-loop-default, forge-agent-adapters-build, forge-skill-spec-purity

#### Contracts
**Exposes:**
- `release-and-ci-gates` (module) — READMEs/per-agent docs + CI gates (validate --strict, schema, lint, evals, OS matrix, regen-diff) + versioning/licensing/.gitattributes across both repos.

**Consumes:**
- `cross-agent-installer-cli` from `cross-agent-installer` — Exercised by the OS-matrix dry-run/uninstall CI and documented in the install sections.
- `forge-loop-runner-contract` from `forge-rauf-loop-default` — Documented as the default forge<->rauf loop path in the per-agent docs.
- `adapters-output` from `forge-agent-adapters-build` — Gated by the CI regenerate-and-diff check.
- `spec-pure-skills` from `forge-skill-spec-purity` — Gated by the SKILL.md schema / spec-purity CI check.
