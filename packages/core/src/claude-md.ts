import * as fs from "node:fs";
import * as path from "node:path";

import { type Result, ok } from "./errors.js";
import { atomicWrite } from "./fs-utils.js";
import { updateSentinelBlock } from "./template.js";

// ─── Constants ────────────────────────────────────────────────────

export const CLAUDE_MD_FILENAME = "CLAUDE.md";
export const CLAUDE_MD_SENTINEL_START = "<!-- rauf:start -->";
export const CLAUDE_MD_SENTINEL_END = "<!-- rauf:end -->";

// ─── Types ────────────────────────────────────────────────────────

export type ClaudeMdMergeAction = "created" | "merged" | "skipped" | "updated";

export interface ClaudeMdMergeResult {
  action: ClaudeMdMergeAction;
  filePath: string;
}

// ─── mergeClaudeMd ───────────────────────────────────────────────
//
// Smart-merge a ralph section into a project's CLAUDE.md file.
// Uses sentinel comments to identify and manage the ralph block.
//
// Four scenarios:
//   1. CLAUDE.md does not exist → create with ralph section
//   2. CLAUDE.md exists, no sentinels → append ralph block
//   3. Sentinels exist, content matches → skip (no-op)
//   4. Sentinels exist, content differs → replace bounded block only
//
// The raufBlockContent parameter is the inner content between
// sentinels (NOT including the sentinel comments themselves).

export function mergeClaudeMd(
  projectPath: string,
  raufBlockContent: string,
): Result<ClaudeMdMergeResult> {
  const resolvedProject = path.resolve(projectPath);
  const claudeMdPath = path.join(resolvedProject, CLAUDE_MD_FILENAME);

  // Try to read existing CLAUDE.md
  let existingContent: string | null = null;
  try {
    existingContent = fs.readFileSync(claudeMdPath, "utf-8");
  } catch {
    // File doesn't exist — that's fine, scenario 1
  }

  // ── Scenario 1: CLAUDE.md does not exist ──────────────────────
  if (existingContent === null) {
    const content =
      CLAUDE_MD_SENTINEL_START + "\n" + raufBlockContent + "\n" + CLAUDE_MD_SENTINEL_END + "\n";

    const writeResult = atomicWrite(claudeMdPath, content);
    if (!writeResult.ok) return writeResult;

    return ok({ action: "created" as const, filePath: claudeMdPath });
  }

  // ── Check for existing sentinels ──────────────────────────────
  const startIdx = existingContent.indexOf(CLAUDE_MD_SENTINEL_START);
  const endIdx = existingContent.indexOf(CLAUDE_MD_SENTINEL_END);
  const hasSentinels = startIdx !== -1 && endIdx !== -1 && endIdx > startIdx;

  if (hasSentinels) {
    // Extract current content between sentinels
    const currentInner = existingContent.slice(startIdx + CLAUDE_MD_SENTINEL_START.length, endIdx);

    // Normalize for comparison: trim leading/trailing whitespace
    const normalizedCurrent = currentInner.trim();
    const normalizedNew = raufBlockContent.trim();

    // ── Scenario 3: Content matches → skip ────────────────────
    if (normalizedCurrent === normalizedNew) {
      return ok({ action: "skipped" as const, filePath: claudeMdPath });
    }

    // ── Scenario 4: Content differs → replace bounded block ───
    const updated = updateSentinelBlock(
      existingContent,
      CLAUDE_MD_SENTINEL_START,
      CLAUDE_MD_SENTINEL_END,
      raufBlockContent,
    );

    const writeResult = atomicWrite(claudeMdPath, updated);
    if (!writeResult.ok) return writeResult;

    return ok({ action: "updated" as const, filePath: claudeMdPath });
  }

  // ── Scenario 2: No sentinels → append ─────────────────────────
  const merged = updateSentinelBlock(
    existingContent,
    CLAUDE_MD_SENTINEL_START,
    CLAUDE_MD_SENTINEL_END,
    raufBlockContent,
  );

  const writeResult = atomicWrite(claudeMdPath, merged);
  if (!writeResult.ok) return writeResult;

  return ok({ action: "merged" as const, filePath: claudeMdPath });
}

// ─── extractRaufBlock ───────────────────────────────────────────
//
// Extract the ralph block content from a CLAUDE addon template file.
// Strips the sentinel comments and returns just the inner content.

export function extractRaufBlock(addonContent: string): string {
  const startIdx = addonContent.indexOf(CLAUDE_MD_SENTINEL_START);
  const endIdx = addonContent.indexOf(CLAUDE_MD_SENTINEL_END);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    // No sentinels found — treat entire content as the block
    return addonContent.trim();
  }

  const inner = addonContent.slice(startIdx + CLAUDE_MD_SENTINEL_START.length, endIdx);

  return inner.trim();
}
