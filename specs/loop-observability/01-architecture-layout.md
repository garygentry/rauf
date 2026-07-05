# 01 — Architecture & Layout

> **Foundation document.** Defines *where* every change lands, the new public
> exports, the (unchanged) package dependency direction, the phase→file matrix,
> and the consolidated integration map. Domain docs (`02`–`05`) reference this
> file for placement and exports. Traces to [`tech-spec.md`](./tech-spec.md) §2
> (Module Structure), §6 (Integration Points), §9 (Dependencies).

**No new package, no new module, no new persisted file** (tech-spec §2, PRD §7).
Every change edits an existing file or adds an export to one. This is a
**prescription + rendering** change on a sound substrate plus **one additive
contract change**.

---

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| C-01 | `core` has zero imports from `cli`/`web` | 3, 4 |
| REQ-COMPAT-01 | Machine surface unchanged by human-render work | 3, 5 |
| REQ-GATE-01 | Each phase independently shippable & green under `pnpm gate` | 2 |
| REQ-CONTRACT-05 | Additive-only status change | 5 (#1, #3) |
| REQ-CMD-05 | Human views reuse existing renderer/scan machinery | 5 (#6, #7, #8) |
| REQ-SAFE-01 | Resolution ends in existing sandbox containment | 5 (#9) |
| REQ-PERF-01 | ≤1 `readIterationStatus` per `deriveStatus` | 5 (#1, #2) |

---

## 1. Directory tree (files touched)

No files are *created*. Every path below already exists; the "Δ" column marks the
nature of the edit.

```
rauf/
├── packages/
│   ├── core/
│   │   └── src/
│   │       ├── schemas.ts            Δ add HealthSchema; +2 fields on DerivedStatusSchema
│   │       ├── status.ts             Δ populate health; export STATUS_SCHEMA_VERSION;
│   │       │                             promote shared readIterationStatus read
│   │       ├── iteration-status.ts   · (unchanged) source of readIterationStatus()
│   │       ├── events-log.ts         Δ add eventAltitude() + EventAltitude type
│   │       ├── backlog-root.ts       Δ add resolveTarget() (co-located — see 03 §1)
│   │       ├── loop-registry.ts      · (unchanged) listActiveLoops() reused
│   │       └── index.ts              Δ re-export new public symbols (if barrel present)
│   └── cli/
│       └── src/
│           ├── status-commands.ts    Δ delegate to resolveTarget(); cwd→--all broadening
│           ├── follow-command.ts     Δ item-level default via eventAltitude; --verbose;
│           │                             sticky header from deriveStatus
│           ├── event-format.ts       Δ add sticky-header renderer (reuses formatEvent)
│           └── formatter.ts          · (unchanged) outputJson / detectColorSupport reused
├── skills/
│   └── drive-rauf-loop/SKILL.md            Δ rewrite into the canonical poll recipe
├── .codex-plugin/
│   └── skills/drive-rauf-loop/SKILL.md      Δ mirror — kept in lockstep
├── agents/
│   └── rauf-loop-driver.md                  · verify defers to skill (likely no edit)
├── .codex/
│   └── agents/rauf-loop-driver.toml         · verify defers to skill (likely no edit) — see 05 §1/§4.3
└── docs/
    ├── SPEC-CLI.md                          Δ document health, version, item-feed, scope
    └── SPEC-BACKLOG-TOOL-CONTRACT.md        Δ document the agent single-poll contract
```

> **Path caveat (verify before writing):** the skill/agent homes above
> (`skills/`, `.codex-plugin/skills/`, `agents/`, `.codex/agents/`) follow
> tech-spec §2. Confirm the exact in-repo paths with
> `git ls-files | grep -iE "drive-rauf-loop|rauf-loop-driver"` before editing —
> see `05-supervision-recipe.md` §1, which owns that resolution (it enumerates all
> four files, including the `.codex/agents/rauf-loop-driver.toml` mirror).

---

## 2. Phase → file matrix

Each phase is **independently shippable and green under `pnpm gate`**
(REQ-GATE-01). A later phase never edits an earlier phase's contract in a
breaking way.

| Phase | Spec doc | Files | Ships |
|-------|----------|-------|-------|
| **1 — Complete the contract** | `02-health-status-contract.md` | `core/schemas.ts`, `core/status.ts` (+tests) | Additive `health` + `statusSchemaVersion` on `DerivedStatus` |
| **2 — Make it consistent** | `03-target-resolution.md`, `05-supervision-recipe.md` | `core/backlog-root.ts`, `cli/status-commands.ts` (+tests); `skills/drive-rauf-loop/*`; `agents/rauf-loop-driver.md` + `.codex/agents/rauf-loop-driver.toml` (verify-only, likely no edit) | `resolveTarget()`; the canonical poll recipe |
| **3 — Make it humane** | `04-event-altitude-follow.md` | `core/events-log.ts`, `cli/follow-command.ts`, `cli/event-format.ts` (+tests) | `eventAltitude()` + item-level `follow` + sticky header + `--all` |
| **4 — Parity & docs** | `05-supervision-recipe.md` §Docs | `docs/SPEC-CLI.md`, `docs/SPEC-BACKLOG-TOOL-CONTRACT.md` | Docs only (web parity deferred — Q2) |

**Ordering is a requirement** (PRD §6): the contract must be *complete* (Phase 1)
before it can be *prescribed* (Phase 2); the human layer (Phase 3) comes last so
it cannot gate the agent work.

---

## 3. Package dependency direction (unchanged)

```
        ┌────────────────────────────┐
        │            cli             │  imports: eventAltitude, resolveTarget,
        │  status-commands.ts        │           HealthSchema, STATUS_SCHEMA_VERSION,
        │  follow-command.ts         │           EventAltitude, ResolvedTarget, TargetError
        │  event-format.ts           │
        └──────────────┬─────────────┘
                       │ (depends on)
                       ▼
        ┌────────────────────────────┐
        │           core             │  imports from cli/web: ZERO (C-01)
        │  schemas.ts  status.ts     │
        │  events-log.ts             │
        │  backlog-root.ts           │
        └────────────────────────────┘

        web  →  does NOT import any new export (web parity deferred, Q2).
```

- **`core` → nothing** (C-01) — all new logic (`health` derivation,
  `eventAltitude`, `resolveTarget`) is pure/`fs`-only and lives in `core`.
- **`cli` → `core` (+ `loop`)** — the only consumer of the new exports.
- **`web` → unchanged** — deferred to a follow-up feature (Q2). The
  `eventAltitude` core seam is deliberately reusable so that follow-up needs no
  re-classification (tech-spec §3.3).
- **No new external dependency** and **no workspace version bump** (tech-spec §9):
  only `zod`, Node built-ins (`node:fs`, `node:path`, `node:os`), and Vitest.

---

## 4. Public API surface added (all in `core`)

Every new symbol is exported from `core` and consumed by `cli` only. If a barrel
(`packages/core/src/index.ts`) re-exports the modules below, add the new symbols
there too; otherwise `cli` imports from the module subpath as it does today.

| Symbol | Kind | Home file | Defined in | Consumed by |
|--------|------|-----------|-----------|-------------|
| `HealthSchema` | Zod schema | `schemas.ts` | `00` §1.1 | `cli` (rendering), tests |
| `Health` | type | `schemas.ts` | `00` §1.1 | `cli`, tests |
| `STATUS_SCHEMA_VERSION` | `const "1"` | `status.ts` | `00` §1.3 | `cli`, tests |
| `EventAltitude` | type | `events-log.ts` | `00` §2 | `cli` (`follow`) |
| `eventAltitude()` | function | `events-log.ts` | `04` §2 | `cli` (`follow`) |
| `ResolveTargetOptions` | interface | `backlog-root.ts` | `00` §4.1 | `cli` |
| `ResolvedTarget` | type | `backlog-root.ts` | `00` §4.2 | `cli` |
| `TargetError` / `TargetErrorCode` | type | `backlog-root.ts` | `00` §4.3 | `cli` |
| `resolveTarget()` | function | `backlog-root.ts` | `03` §2 | `cli` |

**No export is removed or renamed** (REQ-CONTRACT-05, REQ-COMPAT-01).

---

## 5. Consolidated integration map

Verified from source (file:line), confirmed against the researched code. Each row
names the existing surface and how this feature integrates; the owning spec doc
carries the detail.

| # | Existing surface | Location | Integration | Owner doc |
|---|------------------|----------|-------------|-----------|
| 1 | `deriveStatus(paths): Result<DerivedStatus>` | `core/src/status.ts:365` | Stamp `statusSchemaVersion`; populate `health` from a single promoted `readIterationStatus` read (feeds both freshness & health). | `02` |
| 2 | `isLoopLive` / `ITERATION_STATUS_FRESH_MS` | `status.ts:143` (sole call `:179`), `:36` | Reuse the 60s constant for `iterationFresh`; replace `isLoopLive`'s conditional read with the shared read so total stays **≤1 per `deriveStatus`** (REQ-PERF-01). | `02` |
| 3 | `readIterationStatus` | imported `status.ts:9` from `iteration-status.ts` | The shared read; unchanged signature. | `02` |
| 4 | `DerivedStatusSchema` / `BacklogSummarySchema` | `schemas.ts:279`, `:249` | Add `health` + `statusSchemaVersion`; `BacklogSummary` untouched (REQ-CONTRACT-06). | `00`, `02` |
| 5 | `IterationStatusSchema` | `schemas.ts:710` | Read-only source of `stuckWarning`, `lastActivityAt`, `updatedAt`. | `00`, `02` |
| 6 | `LoopEventSchema` (24 types) | `schemas.ts:591` | `eventAltitude()` exhaustively classifies all 24 (a `never` guard enforces it). | `04` |
| 7 | `readEvents` / `watchEvents` | `events-log.ts:86`, `:174` | Reused unchanged by the item-level `follow` feed (REQ-CMD-05). | `04` |
| 8 | `formatEvent(ev): string` | `cli/src/event-format.ts:43` | Reused to render events passing the item filter; new sticky-header renderer added alongside. | `04` |
| 9 | `resolveBacklogRoot()` | `core/src/backlog-root.ts:94` | `resolveTarget()` delegates the final path join + sandbox containment to it (REQ-SAFE-01). | `03` |
| 10 | `listActiveLoops()` / `ActiveLoopEntry` | `loop-registry.ts:129`; `schemas.ts:656`/`:757` | Backs TTY enumeration in `resolveTarget()` and the `--all` front door. | `03`, `04` |
| 11 | `handleStatus` / `handleStatusAll` / `handleStatusFollow` | `status-commands.ts:44` / `:225` / `:439` | Delegate target resolution to `resolveTarget()`; bare-`status` cwd→`--all` broadening. | `03` |
| 12 | `handleFollow` | `cli/src/follow-command.ts:52` | Apply `eventAltitude` filter + sticky header; `--verbose` restores firehose. | `04` |
| 13 | `outputJson` | `cli/src/formatter.ts:113` | Unchanged — passes enriched `DerivedStatus` through as-is; version marker rides along. | `02` |
| 14 | `detectColorSupport()` | `cli/src/formatter.ts:33` | Reused for A11Y-safe header degradation (REQ-A11Y-01). | `04` |

**Conflict check (tech-spec §6):** no other in-progress feature under `specs/`
touches `status.ts`, `follow-command.ts`, `events-log.ts`, or the
`drive-rauf-loop` skill. `forge/loop-observability` is the sole owner. The
feature-forge-side `runner-contract.md` edit (Q3) is a *different repo* — no local
conflict.

> **WARNING — verify before implementing (from tech-spec §6):**
> `resolveTarget()`'s home is a spec-author call resolved to **`backlog-root.ts`**
> in `03-target-resolution.md` §1 (co-locate — the containment check is the
> load-bearing part). `isLoopLive` is currently **private** in `status.ts` and
> reads `iteration-status.json` **only** in the staleness-downgrade branch
> (`:179`), **not** on the healthy path — so `health` population **requires**
> promoting a shared `readIterationStatus` read into
> `deriveStatus`/`deriveFromStateJson`, and the refactor **must** keep **≤1
> `readIterationStatus` call per `deriveStatus`** (REQ-PERF-01). Owned by `02`.

---

## 6. Build & test considerations

- **Toolchain unchanged:** Bun runtime, pnpm workspaces, TypeScript project
  references (`core` is `composite`; `cli` → `core`). No `tsconfig`/build-script
  change.
- **The gate is the source of truth:** `pnpm gate` (build + schema:check +
  version:check + typecheck + lint + format:check + test) must be green at the end
  of **each** phase (REQ-GATE-01). Editor LSP `@rauf/*` errors are phantom until
  `pnpm build` refreshes `dist/*.d.ts` (see project CLAUDE.md).
- **`schema:check`:** the additive `DerivedStatusSchema` change must keep any
  committed schema snapshot in sync — regenerate if the gate's `schema:check`
  flags it (part of Phase 1's acceptance).
- **No version bump:** in-repo workspace deps only (tech-spec §9); the feature
  ships without touching `version.ts` / package versions.

---

## Dependencies

- **Depends on `00-core-definitions.md`** for every type/schema/const referenced
  in the export table (§4) and integration map (§5).

## Verification

- [ ] `git diff --stat` after each phase touches **only** that phase's files
      (§2 matrix) — no cross-phase leakage.
- [ ] `core` still has zero imports from `cli`/`web` after all phases
      (`grep -rE "from \"\.\./(cli|web)" packages/core/src` returns nothing) —
      C-01.
- [ ] `web` imports none of the new exports (§3).
- [ ] Every new public symbol in §4 is exported and importable from `cli`.
- [ ] `pnpm gate` is green at the tip of each phase branch (REQ-GATE-01).
- [ ] No package version changed (`pnpm version:check` passes without a bump).
