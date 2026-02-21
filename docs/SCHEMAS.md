# Schemas Reference

All data structures used across the ralph system. These map directly to Zod schemas in `packages/core/src/schemas.ts`.

## BacklogItem

```typescript
interface BacklogItem {
  id: string;                    // Zero-padded sequential: "001", "002", ...
  type: "bug" | "refactor" | "feature" | "chore";
  priority: 1 | 2 | 3 | 4;     // 1 = highest
  title: string;                 // Non-empty
  description: string;
  acceptanceCriteria: string[];  // At least one after smart defaults
  status: "pending" | "in_progress" | "done" | "blocked";
  completedAt: string | null;    // ISO 8601 datetime or null
  blockedReason?: string;        // Present when status is "blocked"
  dependsOn?: string[];          // Item IDs this depends on
  notes?: string;                // Free-text context, links, hints
  estimatedIterations?: number;  // Expected iterations to complete
}
```

### ID Assignment
- `max(existing IDs as numbers) + 1`, zero-padded to 3 digits
- IDs never renumbered; gaps from deletions are acceptable
- Example sequence: "001", "002", "003" → delete "002" → next is "004"

### Status Transitions (valid)
```
pending → in_progress | blocked
in_progress → done | blocked | pending
blocked → pending
done → pending
```
All other transitions are rejected.

### Smart Default Acceptance Criteria
When creating an item with no explicit criteria, auto-inject: `"{{verifyCommand}} passes"` (resolved from project profile). This criterion gets an "auto" badge in UI.

## Backlog (full file)

```typescript
interface Backlog {
  project: string;       // Project name
  description: string;   // Project description
  items: BacklogItem[];
}
```

File: `.ralph/backlog.json`

## MarkerFile (.ralph.json)

```typescript
interface MarkerFile {
  ralph: true;                    // Sentinel — must be literal true
  version: string;                // Schema version, currently "1"
  variant: "backlog-json";        // Artifact variant
  installedAt: string;            // ISO 8601
  installedBy: string;            // Tool version string
  profile: ProjectProfile;
  artifactHashes: Record<string, string>;  // filename → SHA-256 hex
  options: MarkerOptions;
}

interface ProjectProfile {
  stack: string;                          // e.g., "node-typescript", "python", "go", "unknown"
  packageManager: string | null;          // "pnpm" | "npm" | "yarn" | "bun" | null
  monorepo: boolean;
  commands: ProfileCommands;
  verify: string;                         // Composite: non-null commands joined with " && "
}

interface ProfileCommands {
  test: string | null;
  typecheck: string | null;
  lint: string | null;
  build: string | null;
  format: string | null;
}

interface MarkerOptions {
  ignoreInTool: boolean;       // Default: false
  gitignoreScripts: boolean;   // Default: false
  maxIterations: number;       // Default: 20
}
```

## LoopState (state.json)

```typescript
interface LoopState {
  status: "starting" | "running" | "paused" | "complete" | "paused_human" | "limit_reached" | "error";
  iteration: number;
  maxIterations: number;
  currentItem: string | null;         // Backlog item ID
  lastSignal: "clean" | "blocked" | "needs_human" | "error";
  startedAt: string;                  // ISO 8601
  updatedAt: string;                  // ISO 8601
  completedItems: string[];           // Item IDs
  blockedItems: string[];             // Item IDs
  error: string | null;
}
```

File: `.ralph/state.json` (written by ralph.sh, read-only for manager tool)

## ToolConfig (~/.ralph/config.json)

```typescript
interface ToolConfig {
  rootDirectory: string;    // Absolute path
  port: number;             // Default: 5173
  theme: "light" | "dark" | "system";  // Default: "system"
}
```

## DerivedStatus (output of status module)

```typescript
interface DerivedStatus {
  loopState: LoopStateEnum;      // IDLE | RUNNING | PAUSED | COMPLETE | PAUSED_HUMAN | LIMIT_REACHED | ERROR | NOT_INSTALLED
  stateSource: "state.json" | "log-parsing" | "none";
  iteration: number | null;
  maxIterations: number | null;
  currentItem: string | null;
  lastSignal: string | null;
  startedAt: string | null;
  elapsed: number | null;         // Seconds
  backlogSummary: BacklogSummary;
}

interface BacklogSummary {
  pending: number;
  inProgress: number;
  blocked: number;
  done: number;
  total: number;
}

type LoopStateEnum =
  | "IDLE"
  | "RUNNING"
  | "PAUSED"
  | "COMPLETE"
  | "PAUSED_HUMAN"
  | "LIMIT_REACHED"
  | "ERROR"
  | "NOT_INSTALLED";
```

## DiscoveredProject

```typescript
interface DiscoveredProject {
  id: string;              // Directory name (used in API routes)
  path: string;            // Absolute path to project root
  name: string;            // From backlog.json project field, or directory name
  marker: MarkerFile;      // Parsed .ralph.json
}
```

## InstallationReport

```typescript
interface InstallationReport {
  projectName: string;
  projectPath: string;
  actions: InstallAction[];
  profile: ProjectProfile;
  warnings: string[];
}

interface InstallAction {
  file: string;            // Relative path
  action: "created" | "updated" | "skipped" | "merged" | "rendered";
  detail: string;          // Human-readable description
}
```

## API Response Wrappers

```typescript
// Success
interface ApiSuccess<T> {
  data: T;
}

// Error
interface ApiError {
  error: {
    code: string;           // e.g., "VALIDATION_ERROR", "NOT_FOUND", "CONFLICT"
    message: string;
    details?: Record<string, unknown>;
  };
}
```

## Result Type (core internal)

```typescript
type Result<T, E = RalphError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

interface RalphError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
```

## Template Variables

Variables available in .tmpl files ({{variableName}} syntax):

| Variable | Source |
|----------|--------|
| `projectName` | Marker file / user input |
| `projectDescription` | User input |
| `testCommand` | profile.commands.test |
| `typecheckCommand` | profile.commands.typecheck |
| `lintCommand` | profile.commands.lint |
| `buildCommand` | profile.commands.build |
| `formatCommand` | profile.commands.format |
| `verifyCommand` | profile.verify (composite) |
| `stackDescription` | Human-readable stack label |
| `requirements` | User input (greenfield only) |

## Log Line Patterns (fallback parsing)

```typescript
const LOG_PATTERNS = {
  loopStart:    /Ralph Loop starting \| max=(\d+) iterations/,
  iteration:    /--- Iteration (\d+) \/ (\d+) ---/,
  status:       /Status → pending:(\d+)\s+in_progress:(\d+)\s+blocked:(\d+)\s+done:(\d+)\s+total:(\d+)/,
  done:         /✓ Clean completion signal received/,
  blocked:      /⚠ Task blocked: ([^\s]+)/,
  needsHuman:   /⛔ Loop paused — human input needed: (.+)/,
  complete:     /COMPLETE: (.+)/,
  limitReached: /LIMIT REACHED: (.+)/,
  timestamp:    /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/,
};
```
