# Phase 4 Kickoff — `ux-overhaul-web` (Web Parity + Vocabulary + Agent Contract)

> **Purpose.** A self-contained handoff so a *fresh* session can start the **final** phase of the UX/DX
> overhaul without re-deriving context. Open a clean session, read this top to bottom, then run the first
> command in §6. (Same format as `PHASE-2-KICKOFF.md`, which drove the Phase 2+3 feature.)

## 1. Where we are

The overhaul is **3 of 4 phases shipped**:

- **Phase 1 — observation substrate** (`ux-overhaul`): `events.ndjson`, active-loop registry, file-backed
  CLI+web observation, clean-break monitor surface, commit-rule fix. Merged to `main` (`e85e878`).
- **Phase 2+3 — command grammar + contract flip** (`ux-overhaul-grammar`): `loop run --detached` replacing
  `loop start`, unified exit codes, explicit `review` signal, versioned `events.ndjson`, flag canon.
  Shipped as **rauf v0.5.0** — merged (`3d98e44`), tagged `v0.5.0`, pushed; feature-forge bumped to 0.10.0
  (`minRunnerVersion ≥ 0.5.0`) in lockstep; `rauf-stable` re-frozen at 0.5.0. Docs at
  `docs/architecture/ux-overhaul-grammar/`.

**Phase 4 is the last phase.** The north-star canon for the whole overhaul is `specs/ux-overhaul/CANON.md` —
**read §4.3 (status vocabulary), §4.6 (agent contract), §5 (phase table, row 4), and §8 (out of scope)
before starting.** Where this doc and CANON disagree, CANON wins.

Phase 4 is **mostly additive** (no breaking flip, no `minRunnerVersion` bump, no feature-forge lockstep
edit — unlike Phase 2/3). It depends only on the Phase 1 substrate, which is shipped.

## 2. What this phase is

Feature name: **`ux-overhaul-web`**. Three workstreams (CANON §5 row 4):

### 2a. Web recovery parity (CANON §6 CLI↔web gap; mostly additive)

Today these recovery/ops actions are **CLI-only** — a stuck loop has no web recovery path: `reset`,
`resume`, `loop review`, `backlog unblock`, `backlog validate`. Phase 4 adds them to the web (backend
routes + frontend controls). Phase 1 already shipped the web **read** path (`/loop/events` SSE,
`/api/loops`, `<EventTimeline>`) and the `loop start`/`stop` routes (note: post-v0.5.0 the start route is
the detached-run backend). Phase 4 adds the **action** surface.

- Backend: new mutation endpoints (Hono, 127.0.0.1-only, **`X-Rauf-Request: true`** required on every
  mutation — see CLAUDE.md rule #4) wrapping the existing core functions (`reset`, `resume`, `unblockItems`,
  `validate`, the review pass). Core already implements all of these — the web layer is thin adapters
  (rule #1: web/cli call core; no new core logic).
- Frontend: recovery controls on the project/status page (React + TanStack Router/Query).

### 2b. Status vocabulary — the shared label map + missing badges (CANON §4.3)

One **shared label-map module** is the single source of truth for status display across **the CLI, the
projects dashboard, and the status page**. Per §4.3:
- The derived enum must cover **every** raw `state.json.status` — no silent fallback to IDLE.
- Add the two missing derived-enum values + **badges**: `REVIEWING` (raw `reviewing`) and
  `PAUSED_USAGE_LIMIT` (raw `paused_usage_limit`). (These were explicitly deferred from Phase 1/2/3 — the
  grammar feature's `LoopStateEnum` does **not** include them yet.)
- `PAUSED_HUMAN` displays as **"Needs Human"** on every surface.
- Title Case on human surfaces; SCREAMING_SNAKE is the machine enum only (`--json`, API).
- **Exit-code interaction:** adding `REVIEWING`/`PAUSED_USAGE_LIMIT` to the derived enum means
  `statusExitCode` (unified v0.5.0 table, `packages/cli/src/status-commands.ts`) must map them — likely
  `paused_usage_limit → LIMIT(4)` and `reviewing → RUNNING(6)` (confirm against CANON §4.4 in the tech
  spec). This is additive to the existing mapping, not a breaking change.

### 2c. Agent contract — provider-agnostic templates (CANON §4.6) — **scope caveat**

§4.6's agent-contract items are mostly **already done or coupled elsewhere**:
- Commit-rule fix — **DONE in Phase 1** (single rule across `RAUF.md` / addon / prompt-builder).
- Signal spec, model cascade, `progress.md` stub — documentation items; cheap to land here.
- **The `CLAUDE_ADDON.md → AGENT_ADDON.md` rename + provider-neutral language ("Task tool" → "your
  sub-agent / delegation mechanism") is COUPLED to the separate Part-B provider refactor** (CANON §4.6 +
  §8: "this overhaul only coordinates with it on the agent-template rename"). **This is the main Phase-4
  scope decision** (§3 below) — do it now decoupled, or defer to Part-B so it isn't done twice.

## 3. Decisions to ratify FIRST (in the forge-1-prd interview)

| # | Decision | Lean |
|---|----------|------|
| 1 | **Agent-addon rename timing.** Do the `CLAUDE_ADDON.md → AGENT_ADDON.md` rename + provider-neutral wording in Phase 4, or defer to the Part-B provider refactor? | Likely **defer the rename to Part-B** (CANON §4.6 says it couples there); land only the cheap doc items (signal spec, model cascade, progress.md stub) here. Confirm. |
| 2 | **Web recovery scope.** All five actions (reset/resume/review/unblock/validate), or a subset for v1? | All five — they're thin adapters over existing core fns. Confirm. |
| 3 | **`reviewing`/`paused_usage_limit` exit-code mapping** (§2b) — confirm `reviewing→RUNNING(6)`, `paused_usage_limit→LIMIT(4)`. | As noted; confirm in tech spec. |
| 4 | **Web mutation auth/CSRF** — confirm the recovery endpoints follow the existing `X-Rauf-Request` + 127.0.0.1 pattern (they must). | Yes. |

> Gary trusts recommendations — "use your recommendations" → proceed with the leaning option for anything
> left blank. (See [[project_ux_overhaul]] memory.)

## 4. Constraints & landmines

- **Mostly additive — NO breaking flip.** No `minRunnerVersion` bump, no feature-forge lockstep edit, no
  forced version bump (a normal minor version bump for the new web features is fine, but it's not a
  contract break). This is unlike Phase 2/3.
- **Architecture rules (CLAUDE.md):** core has ZERO imports from cli/web (rule #1) — the web recovery
  endpoints are thin adapters over existing `packages/core` functions; do not put logic in web. Web binds
  127.0.0.1 only; **all mutation endpoints require `X-Rauf-Request: true`** (rule #4). Atomic writes (rule
  #2), path sandboxing (rule #3), status derivation reads files / no subprocess (rule #6).
- **The web frontend has NO test harness today** (noted since Phase 1). Lean on backend route tests for the
  new endpoints; the label-map module (shared, pure) is unit-testable on the CLI/core side.
- **Shared label map = single source.** Don't fork the label/badge logic per surface — one module consumed
  by CLI + both web pages (§4.3 rule 4). Put it in `packages/core` (so CLI and web both import it) — verify
  it has no cli/web deps.
- **Dogfood with `rauf-stable` (now 0.5.0).** `forge.config.json` pins `loopRunner.bin = rauf-stable`,
  re-frozen at 0.5.0 at the v0.5.0 cutover — so the gate passes. Never run an implementing loop with the
  dev binary if this phase rewrites the surface that loop uses (web is lower-risk than CLI here, but keep
  the discipline). Dev runner executes built `dist/` — rebuild before testing runner edits.
- **Out of scope (CANON §8):** the Part-B provider architecture itself (which LLM drives an iteration);
  backlog schema redesign; eliminating an execution mode.

## 5. Likely files in play (orientation, not a spec)

- `packages/web/src/server/routes/` — new recovery mutation routes (mirror the existing `loop.ts` route +
  CSRF middleware in `app.ts`).
- `packages/web/src/server/loop-manager.ts` / core fns — `reset`, `resume`, `unblockItems`, `validate`,
  review pass (already exist in `packages/core` — wrap them).
- `packages/web/src/client/routes/projects/` (`status.tsx` etc.) — recovery controls + the badge rendering.
- `packages/core/src/` — NEW shared status label-map module (derived enum → Title Case label + badge);
  extend `LoopStateEnumSchema` / `deriveStatus` with `REVIEWING` + `PAUSED_USAGE_LIMIT` (schemas.ts).
- `packages/cli/src/status-commands.ts` — consume the shared label map; extend `statusExitCode` for the two
  new states.
- `docs/SPEC-WEB.md`, `docs/SCHEMAS.md`, `docs/SPEC-ARTIFACTS.md` — update for the new endpoints, status
  vocabulary, and any agent-template doc items.

## 6. How to start (in the new session)

```bash
# From repo root on a clean main (v0.5.0)
git checkout -b forge/ux-overhaul-web
/feature-forge:forge-1-prd ux-overhaul-web
```

Then run the pipeline in order (as Phases 1–3 did): forge-1-prd → forge-verify prd → forge-2-tech →
forge-verify tech → forge-3-specs → forge-verify specs → forge-4-backlog → forge-verify backlog →
forge-5-loop (dogfood rauf-stable) → forge-verify impl → forge-fix → forge-6-docs.

### Paste-able kickoff prompt

> Start Phase 4 (the final phase) of the rauf UX/DX overhaul. Read
> `specs/ux-overhaul/PHASE-4-KICKOFF.md` and `specs/ux-overhaul/CANON.md` (§4.3, §4.6, §5 row 4, §8) first.
> This is the `ux-overhaul-web` feature = web recovery parity (add reset/resume/review/unblock/validate to
> the web as thin adapters over existing core fns), the shared status label-map + the missing badges
> (`REVIEWING`, `PAUSED_USAGE_LIMIT`, "Needs Human"), and the cheap agent-contract doc items. It is **mostly
> additive** — no breaking flip, no minRunnerVersion bump, no feature-forge change. Ratify the §3 decisions
> in the PRD interview (I lean toward the noted options — esp. **defer the AGENT_ADDON/provider-neutral
> rename to the separate Part-B refactor**). Create branch `forge/ux-overhaul-web`, then run
> `/feature-forge:forge-1-prd ux-overhaul-web`. Dogfood with `rauf-stable` (now 0.5.0).

## 7. Definition of done

- Web has reset/resume/review/unblock/validate actions (backend routes, CSRF-gated + 127.0.0.1; frontend
  controls), as thin adapters over existing core fns.
- One shared label-map module (in core) drives status display on CLI + both web pages; the derived enum
  covers every raw status (no silent IDLE fallback); `REVIEWING` + `PAUSED_USAGE_LIMIT` added with badges;
  `PAUSED_HUMAN` shows "Needs Human" everywhere; `statusExitCode` maps the two new states.
- Cheap agent-contract doc items landed (signal spec, model cascade, progress.md stub); the AGENT_ADDON
  rename either done or explicitly deferred to Part-B per the §3 decision.
- Affected `docs/SPEC-*.md` updated; full gate green; branch merged.
- **This completes the 4-phase UX/DX overhaul.**

## 8. After this phase

The overhaul is done. The remaining adjacent effort is **Part B — the LLM-agnostic provider architecture**
(`docs/SPEC-BACKLOG-TOOL-CONTRACT.md` Part B, FR-12 etc.) — a *separate* initiative, not part of this
overhaul. If the AGENT_ADDON rename was deferred (§3 decision 1), it lands there.
