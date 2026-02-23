#!/usr/bin/env bun
/**
 * generate-json-schemas.ts
 *
 * Generates JSON Schema files from the Zod schemas in packages/core/src/schemas.ts.
 * Resolves the GitHub raw URL dynamically from git remote or package.json fallback.
 *
 * Outputs:
 *   schemas/backlog.schema.json         — committed to repo for GitHub hosting
 *   artifacts/variants/backlog-json/.ralph/backlog.schema.json — embedded & installed locally
 *
 * Usage: bun run scripts/generate-json-schemas.ts
 */

import { zodToJsonSchema } from "zod-to-json-schema";
import { BacklogSchema } from "../packages/core/src/schemas.js";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..");

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

const rawBase = resolveGitHubRawBase();
const schemaId = `${rawBase}/schemas/backlog.schema.json`;

const schema = zodToJsonSchema(BacklogSchema, {
  $refStrategy: "none",
}) as Record<string, unknown>;

schema["$schema"] = "http://json-schema.org/draft-07/schema#";
schema["$id"] = schemaId;
schema["title"] = "Ralph Backlog";
schema["description"] = "Task backlog for a ralph autonomous coding loop project";

// Post-process: add descriptions to top-level properties
const props = schema["properties"] as Record<string, Record<string, unknown>>;
props["project"]!.description = "Project name (human-readable)";
props["description"]!.description = "Brief description of the project and its goals";
props["items"]!.description = "Ordered list of backlog items";

// Add descriptions to item properties (inlined since $refStrategy=none)
const itemSchema = (props["items"] as Record<string, unknown>)["items"] as Record<string, unknown>;
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
  itemProps["model"].description = "Per-item Claude model override (e.g. 'claude-opus-4-6')";
}
if (itemProps["package"]) {
  itemProps["package"].description =
    "Target workspace package path (e.g. 'packages/web'). Scopes agent verification in monorepos.";
}

const output = JSON.stringify(schema, null, 2) + "\n";

// Write to schemas/ (for GitHub hosting)
mkdirSync(resolve(REPO_ROOT, "schemas"), { recursive: true });
writeFileSync(resolve(REPO_ROOT, "schemas/backlog.schema.json"), output);

// Write to artifacts/ (for local installation alongside backlog.json)
writeFileSync(
  resolve(REPO_ROOT, "artifacts/variants/backlog-json/.ralph/backlog.schema.json"),
  output,
);

// eslint-disable-next-line no-console
console.log(`Generated schemas/backlog.schema.json`);
// eslint-disable-next-line no-console
console.log(`  $id: ${schemaId}`);
