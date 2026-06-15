# Documentation Overhaul — Comprehensive Plan

> Make rauf's documentation **first-class from a consumer standpoint** — the published docs
> site **and** the README — correct against the shipped v0.6.0 surface, usable for both new
> users and power users, with professional diagrams. Ratified scope (2026-06-15): **full
> consumer-first site rebuild** + **diagrams as theme-aware SVG via the existing TS
> generator**. This doc is the runbook; work the phases in order, each as its own
> branch → PR → green CI → approved merge (`main` is branch-protected).

## 1. Why / current state

The published site (`packages/docs/`, Astro Starlight) **republishes the internal `docs/*.md`
specs as-is** via symlinks. The sidebar is implementer-shaped (Getting Started→Contributing,
Architecture→Schemas, Reference→contracts). Of the published docs only `SPEC-CLI.md` reads as
user-facing. There is no first-15-minutes path, no concepts page, no task-oriented guides.
Valuable user guidance exists in the **unpublished** forge-generated `docs/architecture/ux-overhaul*/guides/`
(monitoring, migration, recovery) — but it's invisible and carries stale grammar.

Established truths to preserve:

- **`docs/*.md` are the canonical specs / source of truth** (also read by contributors in-repo).
  Keep them. The consumer layer **cross-links** them, never duplicates (drift risk) — same
  "decision layer, cross-link the spec" stance as the `drive-rauf-loop` skill.
- The site already builds clean (single-source symlink model; zero duplicate-id warnings).
- `main` is branch-protected: branch → PR → CI (`pnpm gate`) green → self-merge on approval.
- Dogfood any loop with the frozen `rauf-stable` (0.6.0), never the dev binary.

## 2. Content model (where things live)

- **`docs/*.md`** — canonical specs. Stay put; relocated under the site's **Internals** group.
- **`packages/docs/src/content/docs/`** — the consumer layer. **New task-oriented pages
  (Getting Started, Concepts, Guides) are authored DIRECTLY here** as Markdown/MDX — they are
  teaching/presentation, not canonical specs, so they do NOT live in `docs/` and are NOT
  symlinks. The internal specs remain symlinks into `docs/`.
- **`docs/architecture/ux-overhaul*/guides/`** — **harvest** their content into the new
  task-oriented guides (de-staled, reframed by user-task, not by phase). Do not symlink the
  per-phase docs into the consumer flow; leave them as historical feature records.
- **`docs/images/`** — generated SVGs + screenshots; symlinked into the site as today.

## 3. Target information architecture (the new sidebar)

```
Home (index.mdx — hero CTA → Getting Started, not Contributing)
Getting Started
  - Installation            (prereqs, binary install, verify, macOS gatekeeper, troubleshooting)
  - Your First Loop         (end-to-end tutorial: install → add item → run → watch → interpret → stop/resume)
  - Core Concepts           (backlog, items, acceptance criteria, the loop, signals, status vocab, .rauf/ layout)
Guides
  - Monitoring a Loop       (status / follow / log / progress; --json/--ndjson; events.ndjson; status --all)
  - Recovery & Troubleshooting (reset vs resume vs --recover vs --answer; backlog unblock; blocked/needsHuman/deferred; reading state.json)
  - Multi-Backlog & Multi-Project (--backlog, nested roots, ~/.rauf active-loop registry)
  - The Web Dashboard       (server start; projects; backlog CRUD; status badges; recovery actions)
  - Scripting & CI          (exit codes, --json/--ndjson, the supervisor pattern, headless usage)
  - Customizing the Agent   (RAUF.md project-specific section, model selection, usage limits/budgets)
  - Migrating to v0.5.0+    (the grammar flip: loop start→run --detached, --watch→--follow, top-level follow)
Reference
  - CLI Reference           (→ docs/SPEC-CLI.md)
  - Machine Surfaces & Contract (→ docs/SPEC-BACKLOG-TOOL-CONTRACT.md §A.7)
  - Backlog Schema          (→ docs/SCHEMAS.md backlog section, or a focused page)
Internals (for contributors / tool integrators)
  - System Architecture     (→ docs/ARCHITECTURE.md)
  - Schemas Reference       (→ docs/SCHEMAS.md)
  - Core Package            (→ docs/SPEC-CORE.md)
  - Web API                 (→ docs/SPEC-WEB.md)
  - Artifact Templates      (→ docs/SPEC-ARTIFACTS.md)
  - Claude Code Tasks       (→ docs/CLAUDE-CODE-TASKS.md)
Contributing                (→ CONTRIBUTING.md)
```

## 4. Workstreams

### WS0 — Correctness sweep (do first; unblocks everything)

Fix every stale/incorrect spot found in the audit:

- `docs/architecture/ux-overhaul/README.md` and `guides/monitoring.md` — replace the 3
  `loop start` references with `loop run --detached`.
- `docs/DOGFOODING.md` (~L121) — `0.2.0` → `0.6.0` in the example version output.
- `docs/RELEASE-AUTOMATION-RUNBOOK.md` (~L22, L98) — `0.2.0` → current; document `>= 0.5.0`
  as the feature-forge minimum where relevant.
- `README.md` — `RAUF_VERSION=v0.3.0` → `v0.6.0` (or phrase to avoid pinning a stale tag);
  fix the `your-org/rauf` clone URL → `garygentry/rauf`.
- Verify the core specs are clean (the conformance review already swept them) — spot-check
  exit codes / status vocab / grammar against `docs/SPEC-CLI.md` + `state-labels.ts`.

### WS1 — IA scaffold

- Rebuild `packages/docs/astro.config.mjs` sidebar to the §3 IA.
- Repoint `index.mdx` hero actions (Quick Start → `getting-started/your-first-loop`,
  not `contributing/`); refresh the feature cards to current vocabulary.
- Create the new content directories and stub pages so the nav resolves.

### WS2 — New-user content (author fresh)

- **Installation** — prerequisites (Claude Code, git; Bun only for source builds), the binary
  one-liner, how to verify (`rauf version`), macOS gatekeeper note, common failures.
- **Your First Loop** — the guided narrative: what each command does, what the output means,
  the three signals, how to stop/resume. Use screenshots + the loop diagram.
- **Core Concepts** — backlog/items/acceptance-criteria, the loop, the signal protocol
  (`RAUF_DONE`/`RAUF_BLOCKED`/`RAUF_NEEDS_HUMAN`), the status vocabulary (link the canonical
  table), the `.rauf/` state directory. Cross-link `author-backlog` for writing good items.

### WS3 — Power-user content (author; harvest from existing guides + skills)

- **Monitoring a Loop** — harvest `ux-overhaul/guides/monitoring.md`; align with the
  `drive-rauf-loop` skill's observe section. Cover `--json`/`--ndjson`/`events.ndjson`.
- **Recovery & Troubleshooting** — harvest `ux-overhaul-web/guides/recovery.md`; the
  reset/resume/--recover/--answer/`backlog unblock` decision table; blocked vs needsHuman vs
  deferred; what `state.json` holds.
- **Multi-Backlog & Multi-Project** — `--backlog <dir>`, nested roots, the active-loop registry.
- **The Web Dashboard** — server start, project discovery, backlog CRUD, the status badges
  (REVIEWING / Needs Human / Usage Limit), the recovery action buttons, the backlog-root selector.
- **Scripting & CI** — the unified exit-code table, `--json`/`--ndjson`, the
  `--pause-on-needs-human` → `resume --answer` supervisor pattern.
- **Customizing the Agent** — the RAUF.md project-specific section, per-item/per-project
  `model`, iteration budgets, usage-limit behavior. Cross-link `review-rauf-guidance`.
- **Migrating to v0.5.0+** — harvest `ux-overhaul-grammar/guides/migration.md` (the breaking
  grammar flip).

### WS4 — Reference reframe

- Publish `SPEC-CLI.md` as **CLI Reference** (lightly reframe its intro for a reference reader;
  content is current).
- Publish the machine-surface contract (`SPEC-BACKLOG-TOOL-CONTRACT.md` §A.7) as **Machine
  Surfaces & Contract**.
- A focused **Backlog Schema** reference (or anchor into `SCHEMAS.md`).

### WS5 — Diagrams (extend `scripts/generate-diagrams.ts`)

Refactor the generator to emit multiple theme-aware SVGs into `docs/images/`, wire
`generate:diagrams` into the docs **prebuild** so they never drift, and embed them in the
relevant pages. Priority order:

1. **Fix `architecture.svg`** — it still says "ralph"; regenerate de-ralph'd + current.
2. **Loop lifecycle** (select → prompt → spawn → signal → verify/commit → advance/review).
3. **Observation model** — `state.json` + `events.ndjson` + `iteration-status.json` + `rauf.log`
   as the substrate every observer (CLI/web/follow) reconstructs from.
4. **Execution modes** — in-process `loop run` vs `--detached` (server), both observed identically.
5. **Status state machine** — the canonical status vocabulary transitions.
6. **Package dependency graph** — core ← loop ← cli/web.
7. (Tier 2) **CLI command map** and **backlog → loop → commit flow**.

Verify each renders correctly in Starlight dark **and** light themes.

### WS6 — README refresh

Keep the strong top (pitch, screenshots, how-it-works) but: apply WS0 fixes; repoint the
**Documentation** table at the new site sections (Getting Started / Guides / Reference) rather
than raw specs; add a clear "full docs →" CTA to the site; confirm every CLI snippet matches
v0.6.0 grammar; swap in the regenerated diagram; add a one-line exit-code/status pointer.

### WS7 — QA & guardrails

- Build the site clean (zero warnings); check every internal link and the symlink set.
- **Anti-drift guard:** add a `scripts/check-docs.ts` (or grep-based check) that fails on
  removed grammar (`loop start`/`loop watch`/`loop follow`/`--watch`), `ralph` leakage in
  user-facing docs, and obviously stale version pins — wire into `pnpm gate` (or a docs CI step)
  so this can't regress.
- Fresh-eyes review pass for the new-user journey and the power-user journey; verify every
  documented command/flag against `SPEC-CLI.md`.
- `pnpm gate` green per PR.

## 5. Phasing (each phase = one PR, approved before merge)

- **Phase A — Correctness + diagram fix:** WS0 + WS5.1 (de-ralph `architecture.svg`). Small,
  high-value, lands immediately; removes the most embarrassing errors.
- **Phase B — IA + core diagrams:** WS1 + WS5.2–5.6. Stands up the new structure with stubs and
  the Tier-1 diagrams.
- **Phase C — Content:** WS2 + WS3 (the bulk). Author pages; parallelizable (one writer per page,
  independent). This is the heart of the rebuild.
- **Phase D — Reference + README + QA:** WS4 + WS6 + WS7 + WS5.7. Polish, guardrails, final review.

## 6. Execution vehicle

Hand-author the prose (judgment/teaching-heavy). Within Phase C, **parallelize independent page
authoring with subagents** (one page per writer). Optionally **dogfood the WS0 mechanical sweep**
as a tiny `rauf-stable` backlog — but the authored guides are not loop-shaped; do those by hand.
A forge pipeline is overkill for docs.

## 7. Definition of done

- The site presents a consumer-first IA: a new user can install → run a first loop → understand
  the concepts without reading a spec; a power user can find monitoring, recovery, multi-backlog,
  scripting, and the machine surfaces.
- Zero stale grammar / version / `ralph` references anywhere in docs (guarded by WS7's check).
- The Tier-1 diagrams render (dark + light) and are wired into the docs build.
- README is current, points to the site, and every snippet matches v0.6.0.
- Internal specs remain the source of truth, relocated under Internals and cross-linked.
- Every change merged via approved, CI-green PRs.
```
