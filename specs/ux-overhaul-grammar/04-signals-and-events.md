# 04 — Signals & Events (ux-overhaul-grammar)

The parsed-signal vocabulary and the `events.ndjson` machine surface: making `signal_parsed` report `review` truthfully, reconciling the signal-placement documentation with the actual scan-from-end parser, and formalizing the `events.ndjson` versioning discipline. All shared definitions (the `signal_parsed` enum change, the versioning rules) are **owned by [`00-core-definitions.md`](./00-core-definitions.md) §3 and §4** — this document references them by name and specifies the runner edit, the doc reconciliation, and the surface-shape reasoning. Re-confirm line numbers at implementation time (they drift).

## Requirement Coverage

| REQ | Covered by (section) |
|-----|----------------------|
| REQ-SIG-01 | §1 explicit `review` signal (enum per 00 §3 + collapse removal) |
| REQ-SIG-02 | §2 signal-placement doc reconciliation |
| REQ-EVT-01 | §3 events.ndjson versioning discipline (per 00 §4) |
| REQ-EVT-02 | §4 same shapes across persisted log and `--ndjson` stream |

## 1. Explicit `review` signal (REQ-SIG-01)

Two coordinated edits make `signal_parsed.signal` expose `"review"` truthfully. The **enum addition** is authoritatively defined in [`00-core-definitions.md`](./00-core-definitions.md) §3; it is repeated here only for the diff context. The **collapse removal** is owned by this document.

### 1a. Enum addition (`@rauf/core`, owned by 00 §3)

`SignalParsedSchema.signal` at `packages/core/src/schemas.ts:~466` gains `"review"`:

```ts
// BEFORE (schemas.ts:466)
const SignalParsedSchema = LoopEventBaseSchema.extend({
  type: z.literal("signal_parsed"),
  itemId: z.string(),
  signal: z.enum(["done", "blocked", "needs_human", "none"]),
  reason: z.string().optional(),
});

// AFTER (+"review")
const SignalParsedSchema = LoopEventBaseSchema.extend({
  type: z.literal("signal_parsed"),
  itemId: z.string(),
  signal: z.enum(["done", "blocked", "needs_human", "review", "none"]),
  reason: z.string().optional(),
});
```

This aligns the on-wire event enum with the already-existing internal `SignalType` (`packages/loop/src/signal-parser.ts:4` = `"done" | "blocked" | "needs_human" | "review" | "none"`) — the parser already emits `{ signal: "review", reviewPayload }` from `matchSignal` on a `RAUF_REVIEW:<json>` line. The change is purely **additive** to the enum; it does not touch any other `LoopEvent` member.

### 1b. Remove the `review→done` collapse (`@rauf/loop`, owned here)

Delete the downcast at the `signal_parsed` emit site in `packages/loop/src/runner.ts:~654-658` so the event carries the parser's real value:

```ts
// BEFORE (runner.ts:654-658)
const parsed = parseSignal(signalText);
this.emitEvent("signal_parsed", {
  itemId: item.id,
  signal: parsed.signal === "review" ? "done" : parsed.signal,
  reason: parsed.reason,
});

// AFTER — emit the parsed signal verbatim
const parsed = parseSignal(signalText);
this.emitEvent("signal_parsed", {
  itemId: item.id,
  signal: parsed.signal,
  reason: parsed.reason,
});
```

With the enum change (1a) landed first, `parsed.signal` (typed `SignalType`) now assigns cleanly to the widened `signal_parsed` field — strict TS is satisfied and the ternary's only purpose (squeezing `"review"` into the narrower enum) is gone.

### 1c. Latent bug this fixes

Before this change, an item whose output ends in `RAUF_REVIEW:<json>` emitted `signal_parsed: "done"` on every observation surface, **regardless of whether the item was a review pass**. The actual review *handling* is gated separately downstream at `runner.ts:~980` (`if (parsed.signal === "review" && parsed.reviewPayload)` → enqueue review items, set `reviewItemsCreated`/`reviewSummary`). When a **work** item (not a review-pass item) emits `RAUF_REVIEW`, that handling branch does not enqueue it as a completion — the spawn falls through `classifyExit` (`packages/loop/src/exit-classifier.ts`, which branches only on `done`/`blocked`/`needs_human` and otherwise returns `genuine_retry`) and the item is **retried/deferred**. So observers saw `signal_parsed: "done"` for an item that was never completed — the event lied. Emitting `"review"` makes the observation match reality.

### 1d. Scope guard — NO change to review handling semantics

This is the **minimal fix** (ratified, tech-spec §3.4). Out of scope, explicitly unchanged:

- Review-pass **routing** — the `runner.ts:~980` review-enqueue branch is untouched.
- Item **status** transitions and the retry/defer behavior for a work item that emits `RAUF_REVIEW`.
- `exit-classifier.ts` — **no change**; it does not gain a `"review"` branch. (It already does not collapse review into `done`; review simply is not one of its explicit early-return cases and flows to `genuine_retry` as today.)
- `state.json.lastSignal` (`LoopStateSignalSchema`, `schemas.ts:~183` = `clean | blocked | needs_human | error`) — a **separate loop-level vocabulary**, NOT changed. `review` is a per-item parsed signal, not a loop outcome.

The deliverable is solely: the `signal_parsed` event now distinguishes `review` from `done`. How review is *acted on* is unchanged.

## 2. Signal-placement doc reconciliation (REQ-SIG-02)

The parser (`parseSignal`, `packages/loop/src/signal-parser.ts:27-38`) splits stdout into lines and **scans backwards from the END**, returning the first line that `trim()`s to an exact `RAUF_DONE` / `RAUF_BLOCKED:` / `RAUF_NEEDS_HUMAN:` / `RAUF_REVIEW:` match; blank lines are skipped, and any text **after** the signal line (commit messages, summaries) does not defeat detection. The current docs describe this inaccurately as the **"final line"** and still document the `review→done` collapse. Reconcile both.

### 2a. Canonical signal-placement wording (use verbatim)

Replace the "final line" framing in `docs/SPEC-BACKLOG-TOOL-CONTRACT.md` §A.2 (~line 59-60: *"emitting a signal as the **final line** of its output"*) — and the equivalent wording in the agent templates (`artifacts/RAUF.md` / `CLAUDE_ADDON.md` and any `artifacts/variants/**` copies) — with:

> A work item's execution communicates its outcome by emitting a signal token **on a line by itself**. The runner scans the output **backwards from the end** and uses the **last** such signal line, so the signal should be the agent's final meaningful output — but **trailing text after it (commit messages, summaries, tool epilogues) does not break detection**. The token must be the entire trimmed content of its line (e.g. a bare `RAUF_DONE`, or `RAUF_BLOCKED:<reason>` / `RAUF_NEEDS_HUMAN:<reason>` / `RAUF_REVIEW:<json>` with no other text on that line). Blank lines are ignored. If multiple signal lines appear, the last one wins.

Agent-instruction phrasing for templates (operator-facing, e.g. RAUF.md "Completing" section): keep the existing directive to **output the signal as your final line** (it is the safest habit and matches "last one wins"), but the contract no longer *requires* it to be strictly last — so drop any wording that implies trailing output will be ignored/cause failure.

### 2b. Update the collapse note in the same doc

`docs/SPEC-BACKLOG-TOOL-CONTRACT.md` currently has (~lines 198, 206-210):

- The `signal_parsed` payload row: `` `signal` (`done` | `blocked` | `needs_human` | `none`) ``.
- Gotcha #1: *"`signal_parsed.signal` collapses `review` → `done`. … there is no `review` value in the event enum. Do not expect a distinct review signal here."*

Apply:

- Update the payload row to `` `signal` (`done` | `blocked` | `needs_human` | `review` | `none`) ``.
- Replace gotcha #1 with the corrected note:

> **`signal_parsed.signal` distinguishes `review`.** As of v0.5.0 the on-the-wire `signal` enum is `done | blocked | needs_human | review | none`. A `RAUF_REVIEW` review-pass signal is reported as `signal === "review"` (previously it was collapsed to `"done"` — that collapse is removed). A `review` value indicates the item emitted a review-pass payload; consult the review-pass handling (not item completion) to interpret it.

(Other gotchas — e.g. the `loop_error`/circuit-breaker note — are unchanged by this feature.)

### 2c. Where the placement/collapse wording lives

| Surface | Edit |
|---|---|
| `docs/SPEC-BACKLOG-TOOL-CONTRACT.md` §A.2 "final line" wording | → §2a canonical wording (scan-from-end) |
| `docs/SPEC-BACKLOG-TOOL-CONTRACT.md` `signal_parsed` row + gotcha #1 (~198, 206-210) | → add `review` to enum row; replace collapse note (§2b) |
| `artifacts/` agent templates (`RAUF.md`, `CLAUDE_ADDON.md`, `variants/**`) | align "final line" → "line by itself / last one wins; trailing text OK" |
| `docs/SCHEMAS.md` (signal enum) | reflected via §3 below |

## 3. events.ndjson versioning discipline (REQ-EVT-01)

`events.ndjson` is a **stable, versioned, additive-only-within-a-major** machine surface, on equal footing with `--json` output and the live `--ndjson` stream. The full rule set is **owned by [`00-core-definitions.md`](./00-core-definitions.md) §4** — this section restates it for the doc-update task and pins the no-bump decision.

The discipline (per 00 §4) to document in `docs/SCHEMAS.md` and `docs/SPEC-BACKLOG-TOOL-CONTRACT.md`:

1. **Additive-only within a major.** Within a major version, no event `type` discriminator value is renamed or removed, and no documented field is removed.
2. **New types/fields are additive.** Adding a new event `type` to the union, or a new optional field to an existing event, requires **no** version bump.
3. **Readers MUST tolerate the unknown.** Consumers ignore unknown `type` values and unknown fields. (This is already promised for the 24-member type list in `SPEC-BACKLOG-TOOL-CONTRACT.md` ~lines 180-188.)
4. **Bump only on a breaking change.** `EVENTS_SCHEMA_VERSION` is incremented **only** when a `type` or documented field is renamed/removed.

### No bump this release

`EVENTS_SCHEMA_VERSION` stays **`"1"`** (`packages/core/src/schemas.ts:~663`, stamped onto every persisted record at `runner.ts:~1213`). **No code change** to the constant. Adding `"review"` to the `signal_parsed.signal` enum (§1) is an **additive** change to an existing field's value set — it does not rename or remove a type or field, so it falls under rule 2 and triggers no bump. This release is the **first formal statement** of the discipline, not a breaking change to the log shape.

> The current code comment at `schemas.ts:~661-662` already says "Bumped only under the formal versioning discipline that lands in Phase 3." This feature *is* that Phase-3 formalization: the discipline is now documented in the two spec docs; the comment may be tightened to point at them, but the value stays `"1"`.

## 4. Same shapes across both surfaces (REQ-EVT-02)

The persisted log and the live `--ndjson` stream carry the **same event shapes**, and the §1 `review` addition applies to both with no extra work:

- **`LoopEventSchema`** (`packages/core/src/schemas.ts:~574-599`) is the 24-member discriminated union (`type` discriminator) shared by both surfaces. `SignalParsedSchema` is member #6 of that union, so widening its `signal` enum widens it for every consumer of `LoopEventSchema` at once.
- **The live `--ndjson` stream** emits raw `LoopEvent` records (no envelope).
- **The persisted `events.ndjson`** writes `PersistedEventSchema` (`schemas.ts:~614-629`) = `LoopEventSchema` **∩** `{ seq, schemaVersion }` (a `z.intersection`). The envelope adds only the monotonic per-run `seq` and the `schemaVersion` tag (`"1"`); the entire `LoopEvent` body is preserved flat, so the two surfaces are identical modulo that envelope.

Because `PersistedEventSchema` is built **from** `LoopEventSchema`, no second edit is needed for the persisted surface — the `review` value flows through the intersection automatically. The stamping site (`runner.ts:~1213`, `{ ...event, seq, schemaVersion }`) is unchanged. REQ-EVT-02 is structurally satisfied by the shared union; this feature does not introduce any per-surface divergence.

## Error handling / back-compat notes

- **Clean break, no alias (NFR-COMPAT-01).** The `review` value is a new enum member with no compatibility shim. A consumer that hard-codes the old four-value enum and rejects unknowns will now see `"review"`; per the rule-3 reader contract (§3) consumers MUST tolerate unknown values, so a spec-conformant reader is unaffected. The in-house consumer (feature-forge) renders `signal` by string interpolation and does not switch on its value (tech-spec §6), so it needs no code change.
- **No throw path.** Both edits are pure data-shape changes (a Zod enum widening and the removal of a ternary). There is no new error path; core continues to return `Result<T,E>` and the runner's emit path is non-throwing.
- **Ordering dependency.** The enum addition (§1a, `@rauf/core`) MUST land before the collapse removal (§1b, `@rauf/loop`) so the emitted `"review"` value validates against `SignalParsedSchema` and strict TS accepts the assignment (matches 01 §3 ordering steps 1→2).
- **Version stability.** `EVENTS_SCHEMA_VERSION` is **not** bumped (§3); persisted logs from before and after this release remain version `"1"` and inter-readable. Only the *value set* of one field grew.

## Dependencies

- [`00-core-definitions.md`](./00-core-definitions.md) — **authoritative** for the `signal_parsed` enum change (§3) and the events.ndjson versioning discipline (§4). This document does not redefine them.
- [`01-architecture-layout.md`](./01-architecture-layout.md) — per-package change map (@rauf/core schemas, @rauf/loop runner, docs) and the change-ordering graph (steps 1, 2, 6).

## Verification

- `signal_parsed` emits `"review"` for a `RAUF_REVIEW` item (no longer `"done"`); `SignalParsedSchema` validates a `signal: "review"` record; the `parsed.signal === "review" ? "done" : …` downcast is gone from `runner.ts`.
- A **work** item emitting `RAUF_REVIEW` no longer shows `signal_parsed: "done"` (the latent bug is fixed); review *handling* (the `runner.ts:~980` enqueue branch) and item status are unchanged.
- `PersistedEventSchema` accepts the `review` value with no separate edit (same-shape, REQ-EVT-02); the `--ndjson` stream and `events.ndjson` agree on the widened enum.
- `EVENTS_SCHEMA_VERSION === "1"` (unchanged); the additive-only discipline (00 §4) is documented in `docs/SCHEMAS.md` and `docs/SPEC-BACKLOG-TOOL-CONTRACT.md`.
- `docs/SPEC-BACKLOG-TOOL-CONTRACT.md` signal-placement wording matches `parseSignal` (scan-from-end, line-by-itself, trailing text tolerated); the `signal_parsed` enum row and gotcha note include `review`; agent templates no longer claim the signal must be strictly the final line.
- Full quality gate (typecheck/lint/format/tests) green (NFR-QUALITY-01).
