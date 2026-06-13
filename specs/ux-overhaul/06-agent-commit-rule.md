# 06 — Agent Commit-Rule: Single Source

> **Phase:** UX/DX Overhaul — Phase 1
> **Concern (archetype):** cross-cutting reconciliation — collapse a contradictory instruction that lives in six places down to **one** rule, identical everywhere, and add it where it is missing.
> **Upstream sources:** [`tech-spec.md` §3.11](./tech-spec.md) (commit-rule single source + embedded-artifacts locus + `RUNTIME_EXCLUDE_PATHSPECS`), [`tech-spec.md` §8](./tech-spec.md) (doc/template grep guard), [`01-architecture-layout.md` §6](./01-architecture-layout.md) (build & regeneration: `embedded-artifacts.ts` is generated), [`PRD.md` §3.6](./PRD.md) (REQ-COMMIT-01/02/03), [`PRD.md` §8 SC-5](./PRD.md).

## Intent

The agent contract currently tells the iteration agent to **"Commit your changes"** in three installed templates and in their two generated copies, while the loop runner *also* owns the commit (`git add -A && git commit`, [`packages/loop/src/git-commit.ts:36`](../../packages/loop/src/git-commit.ts)). Result: **double-commits** — the agent commits its work, then the runner commits again, producing a duplicate `[rauf] <id>: <title>` and tripping per-iteration commit hooks.

The repo's own loop state already encodes the correct rule (the live [`.rauf/RAUF.md:40`](../../.rauf/RAUF.md)), but the **templates** that get installed into *other* projects — and the **generated `embedded-artifacts.ts`** that is the installed source of truth — were never reconciled. This spec reconciles all six loci to a single canonical sentence, **adds** the rule to the runner's prompt-builder (which currently states no commit rule at all), and excludes the new `events.ndjson` event log from the runner's `git add -A` so it never lands in a per-item commit.

This concern is almost entirely independent of the events.ndjson persistence work (specs 02–05); it shares only the `git-commit.ts` file (a one-line array addition) and the build chain.

---

## Requirement Coverage

| Requirement | Summary | Covered in section |
| --- | --- | --- |
| **REQ-COMMIT-01** | One commit rule, stated identically everywhere it appears: *the iteration agent never commits or stages; the loop runner owns the commit.* | §1 (canonical sentence), §2 (loci table), §3 (before/after for all 6 loci) |
| **REQ-COMMIT-02a** | Remove/replace the "Commit your changes…" / "Commit with:…" instruction in the **three templates**. | §3.1 (CLAUDE_ADDON.md), §3.2 (CLAUDE_GREENFIELD.md.tmpl), §3.3 (RAUF.md.tmpl) |
| **REQ-COMMIT-02b** | **Add** an explicit no-commit reminder to the runner's `prompt-builder.ts`, which currently states no commit rule. | §3.6 (prompt-builder ADD) |
| **REQ-COMMIT-02** (generated copies) | Reconcile the **generated, installed** `embedded-artifacts.ts` and the two verbatim copies in `SPEC-ARTIFACTS.md`. | §3.4 (embedded-artifacts via regeneration), §3.5 (SPEC-ARTIFACTS.md), §4 (regeneration as hard requirement) |
| **REQ-COMMIT-02** (runtime exclude) | Add `events.ndjson` to `RUNTIME_EXCLUDE_PATHSPECS` so the runner's `git add -A` never stages the event log. | §5 (git-commit.ts pathspec change) |
| **REQ-COMMIT-03** | Scope guard: `CLAUDE_ADDON.md → AGENT_ADDON.md` rename and provider-neutral wording are **NOT** in scope; signal-placement "final line" reconciliation is **Phase 3** even though it edits the same templates. | §6 (Scope Guard) |

---

## 1. The canonical rule (REQ-COMMIT-01)

Every locus reconciles to exactly this sentence (verbatim, as fixed in [`PRD.md` §3.6](./PRD.md) and [`tech-spec.md` §3.11](./tech-spec.md)):

> **the iteration agent never commits or stages; the loop runner owns the commit.**

The repo's own live [`.rauf/RAUF.md:40`](../../.rauf/RAUF.md) already expresses this rule operationally, and its wording is the design anchor:

```
- Do NOT run `git commit` or `git add` — the loop runner stages and commits your work
  automatically. Committing yourself causes a duplicate commit and triggers per-iteration
  commit hooks.
```

> **Wording rule for implementers.** Where a locus is a *numbered workflow step* that previously said "Commit…", replace that step with a **no-commit step** whose normative clause is the canonical sentence. Where a locus is a *rules/important list*, add a bullet whose normative clause is the canonical sentence. The exact surrounding prose may vary per locus (see §3), but the canonical clause **"the iteration agent never commits or stages; the loop runner owns the commit"** MUST appear verbatim in each, so the §7 grep can assert identity. Do **not** invent alternate phrasings.

---

## 2. Loci table

All line numbers verified against source on 2026-06-12 (branch `forge/ux-overhaul`). The three `.tmpl`/`.md` templates are hand-authored; `embedded-artifacts.ts` is **generated** from them (see §4); `SPEC-ARTIFACTS.md` carries two **documentation copies**; `prompt-builder.ts` and `git-commit.ts` are runner code.

| # | File:line | Kind | Current text (the bug) | Action |
| --- | --- | --- | --- | --- |
| 1 | [`artifacts/variants/backlog-json/CLAUDE_ADDON.md:21`](../../artifacts/variants/backlog-json/CLAUDE_ADDON.md) | template | `10. Commit your changes with message: ` `` `[rauf] <item-id>: <title>` `` | replace step 10 → no-commit step |
| 2 | [`artifacts/variants/backlog-json/CLAUDE_GREENFIELD.md.tmpl:47`](../../artifacts/variants/backlog-json/CLAUDE_GREENFIELD.md.tmpl) | template | `10. Commit your changes with message: ` `` `[rauf] <item-id>: <title>` `` | replace step 10 → no-commit step |
| 3a | [`artifacts/variants/backlog-json/.rauf/RAUF.md.tmpl:32`](../../artifacts/variants/backlog-json/.rauf/RAUF.md.tmpl) | template | `7. Commit with: ` `` `[rauf] <id>: <title>` `` | replace step 7 → no-commit step |
| 3b | [`…/.rauf/RAUF.md.tmpl:51–59`](../../artifacts/variants/backlog-json/.rauf/RAUF.md.tmpl) ("Important Rules") | template | *(silent — no commit rule)* | **ADD** a no-commit bullet |
| 4 | [`packages/core/src/embedded-artifacts.ts:42, 364, 423`](../../packages/core/src/embedded-artifacts.ts) | **generated** | l.42 `7. Commit with:…` ; l.364 & l.423 `10. Commit your changes…` | **regenerate** (do NOT hand-edit) |
| 5 | [`docs/SPEC-ARTIFACTS.md:236, 330`](../../docs/SPEC-ARTIFACTS.md) | doc copy | l.236 `10. Commit your changes…` ; l.330 `7. Commit with:…` | replace both to match templates |
| 6 | [`packages/loop/src/prompt-builder.ts:249–250`](../../packages/loop/src/prompt-builder.ts) (final IMPORTANT section) | runner code | *(no commit rule present)* | **ADD** no-commit reminder |
| 7 | [`packages/loop/src/git-commit.ts:18–27`](../../packages/loop/src/git-commit.ts) `RUNTIME_EXCLUDE_PATHSPECS` | runner code | array lacks `events.ndjson` | add exclude pathspec |

> **Why locus 4 is regenerated, not edited.** `embedded-artifacts.ts` is produced by `scripts/generate-embedded-artifacts.ts`, which reads the template files verbatim into TypeScript string constants ([`01-architecture-layout.md` §6](./01-architecture-layout.md)). Hand-editing it would (a) be overwritten on the next build and (b) drift from the template source. Edit the templates (loci 1–3), then run the build (§4). The three `embedded-artifacts.ts` occurrences correspond 1:1 to the three template fixes.

---

## 3. Before / after for each locus

> Code fences below show the **exact** current line and its replacement. Markdown-table cells that contain backticks are escaped; the actual file content is the literal shown in the fences.

### 3.1 Locus 1 — `CLAUDE_ADDON.md` (REQ-COMMIT-02a)

Current (`CLAUDE_ADDON.md:17–28`, "Completing" + "Rules"):

```markdown
### Completing
7. If all acceptance criteria pass: output `RAUF_DONE` as your final line
8. If blocked (missing dependency, unclear requirement): output `RAUF_BLOCKED:<reason>`
9. If human input needed (API key, design decision): output `RAUF_NEEDS_HUMAN:<reason>`
10. Commit your changes with message: `[rauf] <item-id>: <title>`

### Rules
- ONE item per iteration — do not work on multiple items
- Do not modify `backlog.json` — the loop runner manages status
```

Replacement (step 10 becomes a no-commit step carrying the canonical clause):

```markdown
### Completing
7. If all acceptance criteria pass: output `RAUF_DONE` as your final line
8. If blocked (missing dependency, unclear requirement): output `RAUF_BLOCKED:<reason>`
9. If human input needed (API key, design decision): output `RAUF_NEEDS_HUMAN:<reason>`
10. Do NOT commit or stage — the iteration agent never commits or stages; the loop runner owns the commit. Leave your changes in the working tree.

### Rules
- ONE item per iteration — do not work on multiple items
- Do not modify `backlog.json` — the loop runner manages status
```

> **Scope note (REQ-COMMIT-03):** do not touch step 7's "as your final line" wording — signal-placement reconciliation is Phase 3 (§6). Only step 10 changes here.

### 3.2 Locus 2 — `CLAUDE_GREENFIELD.md.tmpl` (REQ-COMMIT-02a)

Identical structure at `CLAUDE_GREENFIELD.md.tmpl:47`. Current:

```markdown
10. Commit your changes with message: `[rauf] <item-id>: <title>`
```

Replacement (must match locus 1 verbatim — these two templates carry the same "Autonomous Loop (Rauf)" block):

```markdown
10. Do NOT commit or stage — the iteration agent never commits or stages; the loop runner owns the commit. Leave your changes in the working tree.
```

### 3.3 Locus 3 — `.rauf/RAUF.md.tmpl` (REQ-COMMIT-02a, two edits)

This is the **installed `RAUF.md`** template. Unlike the live repo `.rauf/RAUF.md`, this template is **not** already correct — it instructs the agent to commit at step 7 and is **silent** in its "Important Rules" section.

**Edit 3a — Workflow step 7** (`.rauf/RAUF.md.tmpl:23–36`):

Current:

```markdown
5. Implement the task
6. Run verification: `{{verifyCommand}}`
7. Commit with: `[rauf] <id>: <title>`
8. Output your exit signal:
   - `RAUF_DONE` — all criteria met, verification passes
```

Replacement:

```markdown
5. Implement the task
6. Run verification: `{{verifyCommand}}`
7. Leave your changes in the working tree — do NOT commit. The iteration agent never commits or stages; the loop runner owns the commit (it commits as `[rauf] <id>: <title>` after you signal `RAUF_DONE`).
8. Output your exit signal:
   - `RAUF_DONE` — all criteria met, verification passes
```

**Edit 3b — add no-commit bullet to "Important Rules"** (`.rauf/RAUF.md.tmpl:51–59`):

Current:

```markdown
## Important Rules

- Work on ONE item only — the current `in_progress` item
- Do NOT modify `backlog.json` — the loop runner manages status
- Do NOT modify `state.json` — the loop runner manages state
```

Replacement (insert the canonical no-commit bullet immediately after the "ONE item" bullet, mirroring the live `.rauf/RAUF.md:40`):

```markdown
## Important Rules

- Work on ONE item only — the current `in_progress` item
- Do NOT run `git commit` or `git add` — the iteration agent never commits or stages; the loop runner owns the commit. Committing yourself causes a duplicate commit and triggers per-iteration commit hooks.
- Do NOT modify `backlog.json` — the loop runner manages status
- Do NOT modify `state.json` — the loop runner manages state
```

### 3.4 Locus 4 — `embedded-artifacts.ts` (REQ-COMMIT-02 — via regeneration ONLY)

**Do not hand-edit.** The three occurrences are escaped copies of the template lines:

```text
embedded-artifacts.ts:42   7. Commit with: \`[rauf] <id>: <title>\`          ← copy of RAUF.md.tmpl:32
embedded-artifacts.ts:364  10. Commit your changes with message: \`[rauf]…\`  ← copy of CLAUDE_ADDON.md:21
embedded-artifacts.ts:423  10. Commit your changes with message: \`[rauf]…\`  ← copy of CLAUDE_GREENFIELD.md.tmpl:47
```

After loci 1–3 are edited, run the build (§4). The generator re-reads the templates and rewrites these constants to the new wording. The §7 grep guard then asserts none of `Commit your changes` / `Commit with:` survive in `embedded-artifacts.ts`.

### 3.5 Locus 5 — `docs/SPEC-ARTIFACTS.md` (REQ-COMMIT-02)

Two verbatim documentation copies of the templates. They must be hand-edited to match the new template wording (the generator does **not** touch docs).

`SPEC-ARTIFACTS.md:236` (inside the "CLAUDE_ADDON.md — Merge Block" fenced copy):

Current → Replacement:

```markdown
10. Commit your changes with message: `[rauf] <item-id>: <title>`
```
→
```markdown
10. Do NOT commit or stage — the iteration agent never commits or stages; the loop runner owns the commit. Leave your changes in the working tree.
```

`SPEC-ARTIFACTS.md:330` (inside the "RAUF.md.tmpl — Per-Iteration Prompt" fenced copy):

Current → Replacement:

```markdown
7. Commit with: `[rauf] <id>: <title>`
```
→
```markdown
7. Leave your changes in the working tree — do NOT commit. The iteration agent never commits or stages; the loop runner owns the commit (it commits as `[rauf] <id>: <title>` after you signal `RAUF_DONE`).
```

> The `CLAUDE_GREENFIELD.md.tmpl` copy in SPEC-ARTIFACTS.md is abbreviated (`SPEC-ARTIFACTS.md:289` reads `...same content as CLAUDE_ADDON.md...`), so it needs no separate edit — fixing the CLAUDE_ADDON copy covers it.

### 3.6 Locus 6 — `prompt-builder.ts` — ADD the reminder (REQ-COMMIT-02b)

The runner's `buildPrompt` ends with a "Section 6: Important reminder" that currently states **no** commit rule — there is nothing to "correct," it must be **added**.

Current (`prompt-builder.ts:246–250`):

```ts
  // Section 6: Important reminder
  const relBacklog = path.relative(paths.projectPath, paths.backlog);
  const relState = path.relative(paths.projectPath, paths.state);
  sections.push(`---
**IMPORTANT:** You are working on item ${item.id} ONLY. Do NOT modify ${relBacklog} or ${relState} — the loop runner manages status. When done, output your exit signal as the LAST line of your response.`);
```

Replacement (append the canonical no-commit clause to the IMPORTANT section; the existing "LAST line" sentence is unchanged — that is Phase-3 territory and stays as-is):

```ts
  // Section 6: Important reminder
  const relBacklog = path.relative(paths.projectPath, paths.backlog);
  const relState = path.relative(paths.projectPath, paths.state);
  sections.push(`---
**IMPORTANT:** You are working on item ${item.id} ONLY. Do NOT modify ${relBacklog} or ${relState} — the loop runner manages status. Do NOT commit or stage — the iteration agent never commits or stages; the loop runner owns the commit. When done, output your exit signal as the LAST line of your response.`);
```

> The canonical clause **"the iteration agent never commits or stages; the loop runner owns the commit"** appears verbatim in the emitted prompt string, so the §7 grep finds it in `prompt-builder.ts` and SC-5's "reads identically across all four loci … and the prompt-builder reminder" holds.

---

## 4. Regeneration step (HARD REQUIREMENT — REQ-COMMIT-02)

`embedded-artifacts.ts` is generated. Editing the templates alone does **not** fix new installs; the installer copies from `embedded-artifacts.ts`, not from the `artifacts/` tree. The fix is only complete after regeneration.

Required order:

1. Edit the three templates (loci 1, 2, 3a, 3b — §3.1–§3.3).
2. Run the regeneration build chain ([`01-architecture-layout.md` §6](./01-architecture-layout.md)):

   ```bash
   pnpm --filter @rauf/core build
   #   → bun run scripts/generate-embedded-artifacts.ts   (regenerates embedded-artifacts.ts from templates)
   #   → prettier --write src/embedded-artifacts.ts && tsc
   ```

   > `tech-spec.md` §3.11 phrases the generator as `bun run scripts/generate-embedded-artifacts.ts`; `01-architecture-layout.md` §6 wraps it in `pnpm --filter @rauf/core build`. Run the **pnpm** form — it invokes the generator, then formats and typechecks. Both refer to the same generator.

3. **Grep-guard** the regenerated file (§7): confirm `embedded-artifacts.ts` no longer contains `Commit your changes` or `Commit with:`, and that the canonical clause is present three times.
4. Hand-edit `SPEC-ARTIFACTS.md` (§3.5) and add the prompt-builder reminder (§3.6) — these are not regenerated.

> **Failure mode if skipped:** if step 2 is omitted, the templates read correctly but `embedded-artifacts.ts` still carries `Commit with:` / `Commit your changes`, so **every new `rauf install` keeps the double-commit bug** while the source-of-truth templates look fixed — a silent regression. This is the single most important step in this spec.

---

## 5. `git-commit.ts` — exclude `events.ndjson` from `git add -A` (REQ-COMMIT-02)

The runner stages with `git add -A -- . <exclude-pathspecs>` ([`git-commit.ts:44`](../../packages/loop/src/git-commit.ts)). The new event log ([`tech-spec.md` §3.4](./tech-spec.md): `events.ndjson` lives at `stateDir/events.ndjson`) is a runtime artifact and must never land in a per-item commit — same class as `state.json`, `.loop.lock`, `iteration-status.json`.

Current (`git-commit.ts:18–27`):

```ts
export const RUNTIME_EXCLUDE_PATHSPECS = [
  ":(exclude,glob)**/.rauf/.loop.lock",
  ":(exclude,glob)**/.rauf/state.json",
  ":(exclude,glob)**/.rauf/DONE",
  ":(exclude,glob)**/.rauf/CANCEL",
  ":(exclude,glob)**/.rauf/iteration-status.json",
  ":(exclude,glob)**/.rauf/rauf.log",
  // backlog.json.bak sits beside backlog.json (root .rauf/ or specs/<feature>/).
  ":(exclude,glob)**/backlog.json.bak",
];
```

Replacement (add one entry; the `**/` glob covers the root `.rauf/` and nested `specs/<feature>/.rauf/` backlog dirs, matching the existing comment at `git-commit.ts:13–14`):

```ts
export const RUNTIME_EXCLUDE_PATHSPECS = [
  ":(exclude,glob)**/.rauf/.loop.lock",
  ":(exclude,glob)**/.rauf/state.json",
  ":(exclude,glob)**/.rauf/DONE",
  ":(exclude,glob)**/.rauf/CANCEL",
  ":(exclude,glob)**/.rauf/iteration-status.json",
  ":(exclude,glob)**/.rauf/rauf.log",
  ":(exclude,glob)**/.rauf/events.ndjson",
  // backlog.json.bak sits beside backlog.json (root .rauf/ or specs/<feature>/).
  ":(exclude,glob)**/backlog.json.bak",
];
```

> **Coordination note (not a hard dependency).** Spec 02 (events.ndjson persistence) may also rotate the log to `archive/{ts}-events.ndjson` ([`tech-spec.md` §3.3 D4](./tech-spec.md)). Rotated archives live under `.rauf/archive/`, which the runner intentionally commits (per `git-commit.ts:11`, `archive/` is *not* excluded), so only the **live** `events.ndjson` is excluded here — consistent with how `state.json` (excluded) vs. archived state are handled. No edit beyond the single line above is required from this spec.
>
> **Failure mode if skipped:** without this exclude, every iteration's `git add -A` stages the live `events.ndjson`, so each per-item commit carries a churning, ever-growing event log diff — noisy commits and a corrupted notion of "what the item changed."

---

## 6. Scope guard (REQ-COMMIT-03)

These changes touch files that *also* host larger pending refactors. This spec changes **only the commit wording / the `events.ndjson` exclude**. The following are explicitly **out of scope for Phase 1**, even though they edit the same templates:

| Out of scope here | Why deferred | Where it belongs |
| --- | --- | --- |
| `CLAUDE_ADDON.md → AGENT_ADDON.md` rename | Couples to the Part-B provider refactor; renaming the file now would churn the installer and docs for no commit-rule benefit. | Part-B provider refactor (post-Phase-1) — [`PRD.md` §3.6 REQ-COMMIT-03](./PRD.md) |
| Provider-neutral wording (e.g. "the agent" instead of "Claude", "Rauf" branding rephrasings) | Same provider-refactor coupling. Keep existing surrounding prose; change only the commit clause. | Part-B provider refactor |
| Signal-placement "final line" reconciliation (making `RAUF_DONE` / exit-signal phrasing consistent across templates) | This is **Phase 3** per [`PRD.md` §6](./PRD.md), even though it edits the **same** template lines/steps. Touching it now would entangle two phases. | Phase 3 |

**Concretely:** in §3.1 the "step 7 … as your final line" text is left untouched; in §3.6 the existing "output your exit signal as the LAST line" sentence is left untouched. Only the commit clause is added/replaced in this spec.

---

## 7. Verification (maps to SC-5)

All checks are read-only greps plus one dogfood run. They directly verify [`PRD.md` §8 SC-5](./PRD.md) and the [`tech-spec.md` §8 doc/template grep guard](./tech-spec.md).

**V1 — No stale commit instruction remains (REQ-COMMIT-01/02a).** No `Commit your changes` or `Commit with:` in the three templates **or** the generated `embedded-artifacts.ts`:

```bash
grep -rn "Commit your changes\|Commit with:" \
  artifacts/variants/backlog-json/CLAUDE_ADDON.md \
  artifacts/variants/backlog-json/CLAUDE_GREENFIELD.md.tmpl \
  artifacts/variants/backlog-json/.rauf/RAUF.md.tmpl \
  packages/core/src/embedded-artifacts.ts \
  docs/SPEC-ARTIFACTS.md
# Expected: no matches (exit 1).
```

**V2 — Canonical clause present and identical across all loci (REQ-COMMIT-01).** The verbatim clause appears in every fixed locus:

```bash
grep -rl "the iteration agent never commits or stages; the loop runner owns the commit" \
  artifacts/variants/backlog-json/CLAUDE_ADDON.md \
  artifacts/variants/backlog-json/CLAUDE_GREENFIELD.md.tmpl \
  artifacts/variants/backlog-json/.rauf/RAUF.md.tmpl \
  packages/core/src/embedded-artifacts.ts \
  packages/loop/src/prompt-builder.ts \
  docs/SPEC-ARTIFACTS.md
# Expected: all six files listed.
```

**V3 — prompt-builder no-commit reminder added (REQ-COMMIT-02b).** Covered by V2 (`prompt-builder.ts` must appear); additionally confirm it sits in the final IMPORTANT section:

```bash
grep -n "never commits or stages" packages/loop/src/prompt-builder.ts
# Expected: one match within the Section 6 sections.push(...) block.
```

**V4 — `events.ndjson` excluded from staging (REQ-COMMIT-02).**

```bash
grep -n "events.ndjson" packages/loop/src/git-commit.ts
# Expected: ":(exclude,glob)**/.rauf/events.ndjson" present in RUNTIME_EXCLUDE_PATHSPECS.
```

**V5 — Regeneration is idempotent (REQ-COMMIT-02, §4).** After editing templates and running `pnpm --filter @rauf/core build`, re-running the build produces no diff in `embedded-artifacts.ts` (proves the generated file matches the templates):

```bash
pnpm --filter @rauf/core build && git diff --quiet packages/core/src/embedded-artifacts.ts
# Expected: clean (exit 0) on the second consecutive build.
```

**V6 — Dogfood single-commit (SC-5, end-to-end).** Run one loop iteration with the **frozen `rauf-stable`** binary (per project memory: never run dev `rauf` against this repo root — use an isolated sandbox or `rauf-stable` against a throwaway project) and confirm **exactly one** commit per item, with **no** agent-side commit:

```bash
# In an isolated test project (NOT this repo root):
git log --oneline -1   # before
rauf-stable loop run .  # single iteration
git log --oneline -2   # after: exactly ONE new "[rauf] <id>: <title>" commit, no duplicate
```

> Expected: one new commit authored by the runner; the agent leaves changes in the working tree and emits no commit of its own. A *second* `[rauf]` commit for the same item is the regression this spec eliminates.

**V7 — Existing tests stay green.** `pnpm test && pnpm typecheck && pnpm lint && pnpm build && pnpm format:check` — the `prompt-builder` and `git-commit` snapshot/unit tests (if present) must be updated to reflect the new prompt text and pathspec list.

---

## 8. Error / failure modes (summary)

| If… | Then… | Caught by |
| --- | --- | --- |
| The build (§4) is not run after editing templates | New `rauf install` runs keep the double-commit bug; templates look fixed but `embedded-artifacts.ts` still says "Commit your changes" | V1, V5 |
| `events.ndjson` is not added to `RUNTIME_EXCLUDE_PATHSPECS` | The live event log is staged into every per-item commit → noisy, churning diffs | V4, V6 |
| Locus wording drifts (alternate phrasings used) | SC-5 "reads identically across all four loci" fails; grep V2 misses a file | V2 |
| Phase-3 signal-placement changes are made here | Scope creep entangling two phases | §6 scope guard (review) |

---

## Dependencies

- **[`01-architecture-layout.md` §6](./01-architecture-layout.md)** — the build & regeneration chain (`pnpm --filter @rauf/core build` → `scripts/generate-embedded-artifacts.ts`). This spec's §4 is a hard dependency on that chain: the fix is incomplete without it.
- **Largely independent of specs 02–05.** The only shared file is [`git-commit.ts`](../../packages/loop/src/git-commit.ts) (§5 adds one array entry; spec 02 introduces `events.ndjson` itself). The `events.ndjson` path string is referenced here as a literal pathspec, so this spec can land before *or* after 02 without a code-level merge conflict beyond the single array line. If 02 lands first, the exclude is added alongside the new persistence; if this spec lands first, the exclude simply pre-empts the file's existence (harmless — git ignores a pathspec that matches nothing).

---

## Cross-references emitted

- → [`01-architecture-layout.md` §6](./01-architecture-layout.md) — build/regeneration chain (consumed by §4).
- → [`tech-spec.md` §3.11](./tech-spec.md), [`§3.4`](./tech-spec.md) (events.ndjson path), [`§8`](./tech-spec.md) (grep guard) — upstream technical basis.
- → [`PRD.md` §3.6](./PRD.md) (REQ-COMMIT-01/02/03), [`§6`](./PRD.md) (Phase-3 signal placement out of scope), [`§8 SC-5`](./PRD.md) — requirement and success-criterion basis.
