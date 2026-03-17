# Plan: Error on Unrecognized CLI Flags

## Context

The ralph CLI silently ignores unrecognized flags. For example, `ralph loop run --max-iterations 100` parses `max-iterations` into the flags map, but since `handleLoopRun` only extracts `iterations`, the flag is silently dropped and the default (20) is used. This is confusing — the CLI should error on flags it doesn't recognize.

## Architecture

The existing pattern already supports this cleanly:
- `parseArgs()` collects all flags into a `Map<string, string | true>`
- Each handler calls `extract*Flag()` helpers which `.delete()` consumed flags from the map
- After all extractions, any remaining entries in `ctx.flags` are unrecognized

## Approach

Add a `checkUnknownFlags()` utility to `parser.ts` that handlers call after extracting all their known flags. It checks if `ctx.flags` still has entries and returns an error string listing them, or `null` if clean.

**Why per-handler rather than centralized in main.ts:** Handlers consume flags at different points in their logic. A centralized post-handler check would require handlers to always drain the map even for flags they peek at but don't consume. The explicit call is clearer and matches the existing extraction pattern.

## Files to Modify

### 1. `packages/cli/src/parser.ts` — Add utility

Add `checkUnknownFlags(flags: Map<string, string | true>): string | null`:
- If map is empty, return `null`
- Otherwise, return formatted error: `Unknown flag(s): --foo, --bar`
- Include "did you mean" suggestion using levenshtein for close matches (move levenshtein from main.ts to parser.ts or keep it simple — just list the unknowns)

Add tests in `packages/cli/src/parser.test.ts`.

### 2. Every command handler file — Call `checkUnknownFlags` after flag extraction

Each handler already has a section where it extracts all its flags. After that block, add:

```ts
const unknownFlags = checkUnknownFlags(ctx.flags);
if (unknownFlags) {
  error(unknownFlags);
  return ExitCode.INVALID_ARGS;
}
```

Handler files to update:
- `packages/cli/src/loop-commands.ts` — `handleLoopRun`, `handleLoopStart`, `handleLoopStop`, `handleLoopFollow`
- `packages/cli/src/backlog-commands.ts` — `handleBacklogList`, `handleBacklogAdd`, `handleBacklogEdit`, `handleBacklogDelete`, `handleBacklogShow`, `handleBacklogRestore`, `handleBacklogSweep`, `handleBacklogArchiveDispatch`
- `packages/cli/src/install-commands.ts` — `handleInstall`, `handleInit`, `handleUpdate`, `handleUninstall`
- `packages/cli/src/status-commands.ts` — `handleStatus`, `handleLog`, `handleProgress`
- `packages/cli/src/profile-config-commands.ts` — `handleProfileShow`, `handleProfileDetect`, `handleProfileSet`, `handleConfigList`, `handleConfigGet`, `handleConfigSet`, `handleProjectsList`, `handleProjectsStatus`
- `packages/cli/src/server-commands.ts` — `handleServerStart`, `handleServerStop`, `handleServerRestart`, `handleServerStatus`, `handleServerLogs`
- `packages/cli/src/commands.ts` — `handleVersion`, `handleHelp` (trivial — they don't extract flags, so all flags are unknown)

### Special cases to watch for:
- `handleBacklogAdd` uses `extractRepeatableFlag(ctx.rawArgv, "ac")` then `ctx.flags.delete("ac")` — the check must come AFTER this manual delete
- Any handler that peeks at flags without extracting needs adjustment

## Verification

1. `pnpm test` — all existing tests pass
2. `pnpm typecheck` — no type errors
3. Manual test: `ralph loop run --max-iterations 100` should error with "Unknown flag: --max-iterations. Did you mean --iterations?"
4. Manual test: `ralph loop run --iterations 100` should work as before
5. Manual test: `ralph version --bogus` should error
