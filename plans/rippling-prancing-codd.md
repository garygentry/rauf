# Plan: Backlog Audit — Correct statuses, descriptions, dependencies, and risks

## Context

The `.ralph/backlog.json` items were authored before implementation began and haven't been updated since. Three exploration agents audited every item (001–014) against the current codebase. This plan captures the findings and prescribes concrete edits to make the backlog accurate and actionable.

---

## Audit Findings

### Items confirmed DONE (no changes needed)

| Item | Title | Notes |
|------|-------|-------|
| 001 | Core schemas: Rename events + add provider fields | All acceptance criteria verified in `packages/core/src/schemas.ts` and tests |
| 002 | Provider types + registry | All interfaces, registry functions, barrel exports, and tests confirmed |
| 003 | Claude CLI provider adapter | `ClaudeCliProvider` class, delegation, registration, and tests all present |
| 005 | Update CLI + Web for new event names | `llm_spawned`/`llm_exited` used everywhere; zero remaining `claude_spawned`/`claude_exited` references in code |

### Items requiring backlog corrections

#### Item 004 — Refactor LoopRunner to use provider interface (`pending` — CORRECT but description needs update)

**Current state:** Runner emits `llm_spawned`/`llm_exited` with `provider: "claude-cli"` (hardcoded string). But it still:
- Calls `spawnClaude()` directly (`runner.ts:365`)
- Calls `readClaudeOAuthToken()` + `checkUsageLimit()` directly (not via provider)
- Does NOT accept an `LLMProvider` parameter
- Does NOT call `validateCredentials()` or `dispose()`
- Tests still use `writeMockClaude()` shell scripts, not mock provider objects

**Action:** Status is correctly `pending`. Add a note acknowledging that event names were already renamed (partial work from item 005 overlap). Update description to clarify that event emission changes are done; the remaining work is execution path + tests.

#### Item 008 — Template renames + prompt builder generalization (`pending` — description partially stale)

**Current state:**
- `CLAUDE_ADDON.md` and `CLAUDE_GREENFIELD.md.tmpl` still exist under old names (**not renamed**)
- `installer.ts:46` still has `CLAUDE_ADDON_FILE = "CLAUDE_ADDON.md"`
- `embedded-artifacts.ts` still uses old filenames as map keys
- Prompt builder already says "Task tool" (not "Claude Code Tasks") — this part of the acceptance criteria is **already satisfied**

**Action:** Update description/notes to reflect that prompt builder language is already generic. Remaining work is file renames + reference updates only.

#### Item 009 — LLM progress event schema (`pending` — dependency valid but needs risk note)

**Current state:** `LlmProgressSchema` does not exist. No `llm_progress` in `LoopEventSchema` union, CLI formatter, or web `LOOP_EVENT_TYPES`.

**Action:** Add a note that this is a pure additive schema change with no breaking risk. Consider whether this item is truly needed before item 010 or could be deferred (it's only consumed by SDK providers that don't exist yet).

#### Items 011 & 012 — OpenAI Codex CLI + Gemini CLI providers

**Current state:** Neither file exists. Both depend only on item 002 (done).

**Risk:** The backlog descriptions contain TBD flags for CLI arguments. These need research at implementation time. The codex CLI landscape has changed significantly since these items were written.

**Action:** Add notes flagging that CLI flags are TBD and may require research. Consider whether items 011/012 should depend on item 006 (generic-cli) since they could potentially be implemented *as configurations of* the generic-cli provider rather than separate provider files.

#### Item 013 — Per-item provider routing

**Current state:** Schema supports `item.provider` (from item 001), but runner has zero routing logic.

**Dependency issue:** Depends on items 007, 011, 012. Items 011/012 are not strictly required — routing can work with any two registered providers (e.g., claude-cli + generic-cli). Consider relaxing dependencies to `[007]` only, with 011/012 as nice-to-have test scenarios.

#### Item 014 — Documentation updates

**Current state:** `docs/SPEC-LLM-AGNOSTIC.md` still says "DRAFT — Pending approval before implementation". All other docs unchanged.

**No issues.** This is correctly the final item.

---

## Risk Assessment

### High Risk

1. **Item 004 is the critical bottleneck.** It blocks items 007, 008, and transitively 013, 014. The refactor touches `runner.ts` — the heart of the loop engine. Must preserve exact behavioral parity with current claude-cli execution (NFR-1 in spec). Estimated 2 iterations is reasonable.

2. **Test strategy for item 004.** Switching from `writeMockClaude()` shell scripts to mock `LLMProvider` objects is a significant test refactor. If done poorly, tests could pass but miss integration issues.

### Medium Risk

3. **Items 011/012 have TBD CLI flags.** The codex and gemini CLI tools may have changed since the spec was written. Implementation may require significant research or may discover that the described approach doesn't work.

4. **Item 010 (Claude SDK provider) has complex async patterns.** The SDK's `query()` async generator, MCP tool registration for `ralph_signal`, and progress streaming add substantial complexity. Dynamic import for optional dependency adds another layer.

### Low Risk

5. **Items 006, 008, 009 are straightforward.** Generic CLI is well-specified with clear patterns from claude-cli. Template renames are mechanical. Progress schema is additive.

6. **Item 005 was already fully completed** — no residual risk.

---

## Identified Gaps

### Gap 1: No integration test for provider swap

No backlog item explicitly covers an end-to-end test that runs the loop with a non-claude-cli provider. Item 004 tests with mocks, and item 013 tests per-item routing, but there's no item for "run a real loop iteration with generic-cli" as a smoke test.

**Recommendation:** Add acceptance criterion to item 006 or 007: "Integration test: run loop with generic-cli provider using a simple echo script, verify RALPH_DONE signal is captured."

### Gap 2: No migration/backward-compatibility item for event consumers

External SSE consumers (if any) will break when `claude_spawned`/`claude_exited` disappear. Item 005 notes this is acceptable at current scale, but there's no deprecation path.

**Recommendation:** No action needed now (spec §11 accepts this risk), but add a note to item 014 to document the breaking change in a changelog or migration guide.

### Gap 3: Items 011/012 may be redundant with item 006

If `generic-cli` supports configurable binary + args + env, then codex and gemini providers could be pre-built configurations rather than separate provider implementations. This would reduce code and maintenance burden.

**Recommendation:** Add a decision note to items 011/012: "Evaluate whether this should be a separate provider or a generic-cli configuration preset. If the provider needs no custom logic beyond binary+args, use generic-cli with a preset config."

---

## Proposed Backlog Changes

### File: `.ralph/backlog.json`

**1. Item 004 — Update notes:**
Add: `"Event name changes (llm_spawned/llm_exited emission) already done via item 005. Remaining work: replace spawnClaude() with provider.execute(), add provider DI to constructor, add validateCredentials()/dispose() calls, refactor tests from writeMockClaude() to mock LLMProvider."`

**2. Item 008 — Update notes:**
Add: `"Prompt builder already uses generic 'Task tool' language (lines 105, 124, 137 of prompt-builder.ts). Remaining work is file renames (git mv) and reference updates in installer.ts + embedded-artifacts.ts only."`

**3. Item 009 — Update notes:**
Add: `"Pure additive schema change — no breaking risk. Only consumed by SDK providers (item 010+). Could be implemented alongside item 010 if preferred."`

**4. Items 011 & 012 — Update notes:**
Add to both: `"CLI flags are TBD and require research at implementation time. Evaluate whether this should be a standalone provider or a generic-cli configuration preset — if no custom logic is needed beyond binary+args, prefer generic-cli preset."`

**5. Item 013 — Relax dependencies:**
Change `dependsOn` from `["007", "011", "012"]` to `["007"]`. Items 011/012 are nice-to-have for testing but not logically required — routing works with any two registered providers.

**6. Item 006 — Add integration test criterion:**
Add acceptance criterion: `"Integration test: run a loop iteration with generic-cli provider using a simple echo script that outputs RALPH_DONE, verify signal is captured and iteration completes successfully."`

---

## Verification

After making the edits:

```bash
# Validate JSON
jq . .ralph/backlog.json

# Verify done items
cat .ralph/backlog.json | jq '.items[] | select(.status == "done") | .id'
# Expected: "001", "002", "003", "005"

# Verify pending items
cat .ralph/backlog.json | jq '.items[] | select(.status == "pending") | .id'
# Expected: "004", "006", "007", "008", "009", "010", "011", "012", "013", "014"

# Verify item 013 dependencies relaxed
cat .ralph/backlog.json | jq '.items[] | select(.id == "013") | .dependsOn'
# Expected: ["007"]

# Spot-check updated notes contain new text
cat .ralph/backlog.json | jq '.items[] | select(.id == "004") | .notes' | grep -q "writeMockClaude"
cat .ralph/backlog.json | jq '.items[] | select(.id == "008") | .notes' | grep -q "already uses generic"
```
