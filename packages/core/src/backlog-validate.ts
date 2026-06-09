import * as fs from "node:fs";
import * as path from "node:path";

import { type Result, ok, err, ErrorCodes } from "./errors.js";
import { BacklogSchema, normalizeBacklogItems, type BacklogItem } from "./schemas.js";
import type { BacklogPaths } from "./backlog-root.js";

// ─── Types ────────────────────────────────────────────────────────

export type ValidationSeverity = "error" | "warning";

export interface ValidationFinding {
  severity: ValidationSeverity;
  /** Stable machine code, e.g. "SCHEMA", "DUPLICATE_ID", "MISSING_DEPENDENCY". */
  code: string;
  message: string;
  /** Backlog item id the finding relates to, when applicable. */
  itemId?: string;
  /** JSON path for schema issues, e.g. "items.0.status". */
  path?: string;
}

export interface ValidateBacklogResult {
  /** True when there are no error-severity findings (warnings are allowed). */
  valid: boolean;
  findings: ValidationFinding[];
}

export interface ValidateBacklogOptions {
  /**
   * Directory that `specReferences` are resolved against. When omitted, the
   * specReferences-existence check is skipped entirely (the repo-wide ad-hoc
   * flow has no specs dir, and must not be failed for that).
   */
  specsDir?: string;
}

// ─── validateBacklog ─────────────────────────────────────────────
//
// Reads backlog.json, validates it against the Zod schema (the single source
// of truth), and runs semantic checks. IO / JSON-parse problems are returned
// as a Result error (the caller maps these to a usage/IO exit code); schema
// and semantic problems are returned as findings inside `ok`.

export function validateBacklog(
  paths: BacklogPaths,
  opts: ValidateBacklogOptions = {},
): Result<ValidateBacklogResult> {
  // 1. Read raw file
  let raw: string;
  try {
    raw = fs.readFileSync(paths.backlog, "utf-8");
  } catch (e) {
    return err({
      code: ErrorCodes.FILE_NOT_FOUND,
      message: `File not found: ${paths.backlog}`,
      details: { path: paths.backlog, cause: e instanceof Error ? e.message : String(e) },
    });
  }

  // 2. Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return err({
      code: ErrorCodes.INVALID_JSON,
      message: `Invalid JSON in ${paths.backlog}: ${e instanceof Error ? e.message : String(e)}`,
      details: { path: paths.backlog },
    });
  }

  // 3. Schema validation (against the Zod source of truth)
  const normalized = normalizeBacklogItems(parsed);
  const result = BacklogSchema.safeParse(normalized);

  if (!result.success) {
    const findings: ValidationFinding[] = result.error.issues.map((i) => ({
      severity: "error",
      code: "SCHEMA",
      message: i.message,
      path: i.path.join("."),
    }));
    return ok({ valid: false, findings });
  }

  // 4. Semantic checks on the validated backlog
  const backlog = result.data;
  const findings: ValidationFinding[] = [
    ...checkDuplicateIds(backlog.items),
    ...checkDependencies(backlog.items),
    ...checkEmptyAcceptanceCriteria(backlog.items),
    ...checkSpecReferences(backlog.items, opts.specsDir),
  ];

  const valid = !findings.some((f) => f.severity === "error");
  return ok({ valid, findings });
}

// ─── Semantic checks ─────────────────────────────────────────────

function checkDuplicateIds(items: BacklogItem[]): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const seen = new Set<string>();
  const reported = new Set<string>();
  for (const it of items) {
    if (seen.has(it.id) && !reported.has(it.id)) {
      findings.push({
        severity: "error",
        code: "DUPLICATE_ID",
        message: `Duplicate item id: ${it.id}`,
        itemId: it.id,
      });
      reported.add(it.id);
    }
    seen.add(it.id);
  }
  return findings;
}

function checkDependencies(items: BacklogItem[]): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const ids = new Set(items.map((i) => i.id));

  // Missing dependency targets
  for (const it of items) {
    for (const dep of it.dependsOn ?? []) {
      if (!ids.has(dep)) {
        findings.push({
          severity: "error",
          code: "MISSING_DEPENDENCY",
          message: `Item ${it.id} depends on non-existent item ${dep}`,
          itemId: it.id,
        });
      }
    }
  }

  // Cycle detection over the (resolvable) dependency graph
  const graph = new Map<string, string[]>();
  for (const it of items) {
    graph.set(
      it.id,
      (it.dependsOn ?? []).filter((d) => ids.has(d)),
    );
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const id of graph.keys()) color.set(id, WHITE);
  const reportedCycle = new Set<string>();

  const visit = (id: string, stack: string[]): void => {
    color.set(id, GRAY);
    stack.push(id);
    for (const dep of graph.get(id) ?? []) {
      const c = color.get(dep);
      if (c === GRAY) {
        // Found a back-edge; report the cycle slice once (keyed by sorted members).
        const start = stack.indexOf(dep);
        const cycle = stack.slice(start);
        const key = [...cycle].sort().join(",");
        if (!reportedCycle.has(key)) {
          reportedCycle.add(key);
          findings.push({
            severity: "error",
            code: "DEPENDENCY_CYCLE",
            message: `Dependency cycle: ${cycle.join(" → ")} → ${dep}`,
          });
        }
      } else if (c === WHITE) {
        visit(dep, stack);
      }
    }
    stack.pop();
    color.set(id, BLACK);
  };

  for (const id of graph.keys()) {
    if (color.get(id) === WHITE) visit(id, []);
  }

  return findings;
}

function checkEmptyAcceptanceCriteria(items: BacklogItem[]): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  for (const it of items) {
    if (!it.acceptanceCriteria || it.acceptanceCriteria.length === 0) {
      findings.push({
        severity: "warning",
        code: "EMPTY_AC",
        message: `Item ${it.id} has no acceptance criteria`,
        itemId: it.id,
      });
    }
  }
  return findings;
}

function checkSpecReferences(items: BacklogItem[], specsDir?: string): ValidationFinding[] {
  // No-op when no specs dir is provided/resolvable (repo-wide ad-hoc flow).
  if (!specsDir) return [];
  const base = path.resolve(specsDir);

  const findings: ValidationFinding[] = [];
  for (const it of items) {
    for (const ref of it.specReferences ?? []) {
      const resolved = path.resolve(base, ref);
      if (!fs.existsSync(resolved)) {
        findings.push({
          severity: "error",
          code: "MISSING_SPEC",
          message: `Item ${it.id} references missing spec: ${ref}`,
          itemId: it.id,
        });
      }
    }
  }
  return findings;
}
