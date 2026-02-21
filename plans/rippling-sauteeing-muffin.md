# Plan: Validate Ralph Loop Readiness for Self-Hosting Bootstrap

## Context

Ralph is a CLI + web tool for managing autonomous coding loops. The project is bootstrapping itself — using a manually-created ralph loop infrastructure (`.ralph/`, `ralph.sh`, `backlog.json`) to build the actual ralph tool code. The backlog contains 42 items covering all functionality described in the docs/ specifications.

Before running `./ralph.sh` to kick off the first iteration, we need to fix one critical bug and commit the scaffolded baseline so the loop can run cleanly.

## Findings Summary

### What's Ready
- **42 backlog items** — all pending, valid dependency DAG, no circular deps, no missing references
- **Backlog coverage** — comprehensive across core (001-012), CLI (013-019), web API (020-025), frontend (026-034), artifacts (035-037), integration (038-042)
- **ralph.sh** — fully implemented, handles state.json writes, targeted jq updates, exit signal parsing, cleanup trap
- **Helper scripts** — ralph-add.sh, ralph-status.sh both complete and executable
- **RALPH.md** — proper per-iteration instructions with verification commands
- **Prerequisites** — jq 1.6 installed, claude CLI available, all scripts chmod +x
- **.ralph.json** — valid marker file with correct profile for node-typescript/pnpm monorepo

### Critical Bug: `select_next_item()` Ignores Dependencies

**File:** `ralph.sh` (line 128-130) and `artifacts/backlog-json/ralph.sh` (identical)

```bash
select_next_item() {
  jq -r '[.items[] | select(.status == "pending")] | sort_by(.priority) | .[0].id // empty' "$BACKLOG"
}
```

**Problem:** This selects the first pending item by priority without checking if `dependsOn` items are all `"done"`. Within Priority 1, array ordering happens to work (deps come before dependents). But in Priority 2, item 014 depends on 020 — and 014 comes first in the array. The loop will:
1. Select 014 before 020 is done
2. Agent will RALPH_BLOCKED (dependency not met)
3. 014 stays blocked **permanently** — even after 020 completes later

**Affected P2 items**: 014 (depends on 020), plus 021-024 all depend on 020 and various P1 items.

**Fix:** Update `select_next_item()` to filter out items whose `dependsOn` are not all `"done"`:

```bash
select_next_item() {
  jq -r '
    [.items[] | select(.status == "done")] | map(.id) as $done_ids |
    [.items[] | select(.status == "pending") | select(
      (.dependsOn == null) or (.dependsOn | length == 0) or
      (.dependsOn | all(. as $d | $done_ids | index($d) != null))
    )] | sort_by(.priority) | .[0].id // empty
  ' "$BACKLOG"
}
```

This must be updated in **both** `ralph.sh` (project root) and `artifacts/backlog-json/ralph.sh` (canonical template).

### Minor Issue: Uncommitted Mode Changes

`ralph.sh`, `ralph-add.sh`, `ralph-status.sh` have mode-only diffs (644→755). These should be committed before the loop starts so the first iteration starts from a clean git state.

### Note: Pre-existing Artifacts (035-037)

Items 035, 036, 037 describe creating artifacts that already exist and are fully implemented. The loop agent should recognize they're complete, verify against spec, and signal RALPH_DONE. This is expected behavior — the bootstrap manually created these files.

## Changes to Make

### 1. Fix `select_next_item()` in ralph.sh (root)
- **File:** `/home/gary/workspace/ralph/ralph.sh`
- Replace the `select_next_item` function with dependency-aware version

### 2. Fix `select_next_item()` in artifacts/backlog-json/ralph.sh
- **File:** `/home/gary/workspace/ralph/artifacts/backlog-json/ralph.sh`
- Same fix — keep both files in sync

### 3. Commit the baseline
- Stage mode changes (ralph.sh, ralph-add.sh, ralph-status.sh) + the dependency fix
- Commit with descriptive message

## Verification

After making changes:
1. Run `./ralph.sh` with `MAX_ITERATIONS=1` to process item 001
2. Confirm item 001 gets selected (it has no deps, should be first)
3. Confirm the agent creates ESLint/Prettier/Vitest configs and runs `pnpm install`
4. Confirm RALPH_DONE signal is detected and item marked done
5. After item 001, the next eligible items should be 002 and 035 (both depend only on 001)
