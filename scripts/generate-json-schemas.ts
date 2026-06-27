#!/usr/bin/env bun
/**
 * generate-json-schemas.ts
 *
 * Generates JSON Schema files from the Zod schemas in packages/core/src/schemas.ts.
 * Resolves the GitHub raw URL dynamically from git remote or package.json fallback.
 *
 * Outputs:
 *   schemas/backlog.schema.json         — committed to repo for GitHub hosting
 *   artifacts/variants/backlog-json/.rauf/backlog.schema.json — embedded & installed locally
 *
 * Usage:
 *   bun run scripts/generate-json-schemas.ts            # regenerate + write
 *   bun run scripts/generate-json-schemas.ts --check    # drift guard: fail if
 *                                                        # committed files are stale
 *
 * The `--check` mode is the single-source-of-truth guard: it rebuilds the JSON
 * Schema from the Zod source and compares it against the committed copies,
 * exiting non-zero on any difference. This is what would have caught the
 * `bugfix`/`test` enum drift. Wire it into CI.
 */

import { zodToJsonSchema } from "zod-to-json-schema";
import { BacklogSchema } from "../packages/core/src/schemas.js";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..");

/** Relative paths of the committed JSON Schema copies (all generator outputs). */
export const SCHEMA_OUTPUT_PATHS = [
  "schemas/backlog.schema.json",
  "artifacts/variants/backlog-json/.rauf/backlog.schema.json",
] as const;

function parseGitHubOwnerRepo(url: string): string | null {
  const sshMatch = url.match(/git@github\.com:(.+?)(?:\.git)?$/);
  if (sshMatch?.[1]) return sshMatch[1];
  const httpsMatch = url.match(/https?:\/\/github\.com\/(.+?)(?:\.git)?$/);
  if (httpsMatch?.[1]) return httpsMatch[1];
  return null;
}

function resolveGitHubRawBase(): string {
  // 1. Try git remote (safe: uses execFileSync with array args, no shell)
  try {
    const remote = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf-8",
      cwd: REPO_ROOT,
    }).trim();
    const ownerRepo = parseGitHubOwnerRepo(remote);
    if (ownerRepo) return `https://raw.githubusercontent.com/${ownerRepo}/main`;
  } catch {
    /* fall through */
  }

  // 2. Fallback: package.json repository.url
  const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, "package.json"), "utf-8")) as {
    repository?: { url?: string };
  };
  const repoUrl: string = pkg.repository?.url ?? "";
  const ownerRepo = parseGitHubOwnerRepo(repoUrl);
  if (ownerRepo) return `https://raw.githubusercontent.com/${ownerRepo}/main`;

  throw new Error("Cannot resolve GitHub URL from git remote or package.json repository field");
}

/**
 * Build the backlog JSON Schema string from the Zod source of truth.
 * Pure: depends only on `schemaId` (the `$id`) and `BacklogSchema`. No git,
 * no filesystem — so it is safe to call from both the writer and a drift check.
 */
export function buildBacklogSchemaJson(schemaId: string): string {
  const schema = zodToJsonSchema(BacklogSchema, {
    $refStrategy: "none",
  }) as Record<string, unknown>;

  schema["$schema"] = "http://json-schema.org/draft-07/schema#";
  schema["$id"] = schemaId;
  schema["title"] = "Rauf Backlog";
  schema["description"] = "Task backlog for a rauf autonomous coding loop project";

  // Post-process: add descriptions to top-level properties
  const props = schema["properties"] as Record<string, Record<string, unknown>>;
  props["project"]!.description = "Project name (human-readable)";
  props["description"]!.description = "Brief description of the project and its goals";
  props["items"]!.description = "Ordered list of backlog items";

  // Add descriptions to item properties (inlined since $refStrategy=none)
  const itemSchema = (props["items"] as Record<string, unknown>)["items"] as Record<
    string,
    unknown
  >;
  const itemProps = itemSchema["properties"] as Record<string, Record<string, unknown>>;
  itemProps["id"]!.description = "Zero-padded sequential ID (e.g. '001', '042'). Never reused.";
  itemProps["type"]!.description = "Work category";
  itemProps["priority"]!.description = "1 = highest priority, 4 = lowest";
  itemProps["title"]!.description = "Short imperative title";
  itemProps["description"]!.description = "Full description of the work to be done";
  itemProps["acceptanceCriteria"]!.description =
    "Checklist items — each must pass before marking done";
  itemProps["status"]!.description = "Current lifecycle state";
  itemProps["completedAt"]!.description = "ISO 8601 timestamp set when status becomes 'done'";
  if (itemProps["blockedReason"]) {
    itemProps["blockedReason"].description = "Explanation when status is 'blocked'";
  }
  if (itemProps["dependsOn"]) {
    itemProps["dependsOn"].description = "IDs of items that must be 'done' before this can start";
  }
  if (itemProps["notes"]) {
    itemProps["notes"].description = "Free-text context, links, or hints for the agent";
  }
  if (itemProps["estimatedIterations"]) {
    itemProps["estimatedIterations"].description = "Expected number of loop iterations to complete";
  }
  if (itemProps["model"]) {
    itemProps["model"].description =
      "Per-item model override passed to the selected provider. Omit by default for portability. Claude tier aliases such as 'opus', 'sonnet', and 'opus[1m]' are Claude-only and may fail under non-Claude agents.";
  }
  if (itemProps["package"]) {
    itemProps["package"].description =
      "Target workspace package path (e.g. 'packages/web'). Scopes agent verification in monorepos.";
  }

  return JSON.stringify(schema, null, 2) + "\n";
}

// ─── CLI entry (side-effectful: skipped on import) ──────────────────

if (import.meta.main) {
  const check = process.argv.includes("--check");
  const rawBase = resolveGitHubRawBase();
  const schemaId = `${rawBase}/schemas/backlog.schema.json`;
  const output = buildBacklogSchemaJson(schemaId);

  if (check) {
    const stale: string[] = [];
    for (const rel of SCHEMA_OUTPUT_PATHS) {
      const abs = resolve(REPO_ROOT, rel);
      const current = existsSync(abs) ? readFileSync(abs, "utf-8") : "";
      if (current !== output) stale.push(rel);
    }
    if (stale.length > 0) {
      // eslint-disable-next-line no-console
      console.error(
        `Schema drift detected — these committed copies differ from the Zod source:\n` +
          stale.map((s) => `  - ${s}`).join("\n") +
          `\n\nRun: bun run scripts/generate-json-schemas.ts  (then commit the result)`,
      );
      process.exit(1);
    }
    // eslint-disable-next-line no-console
    console.log("Schemas are in sync with the Zod source.");
    process.exit(0);
  }

  // Write to schemas/ (for GitHub hosting)
  mkdirSync(resolve(REPO_ROOT, "schemas"), { recursive: true });
  writeFileSync(resolve(REPO_ROOT, "schemas/backlog.schema.json"), output);

  // Write to artifacts/ (for local installation alongside backlog.json)
  writeFileSync(
    resolve(REPO_ROOT, "artifacts/variants/backlog-json/.rauf/backlog.schema.json"),
    output,
  );

  // eslint-disable-next-line no-console
  console.log(`Generated schemas/backlog.schema.json`);
  // eslint-disable-next-line no-console
  console.log(`  $id: ${schemaId}`);
}
