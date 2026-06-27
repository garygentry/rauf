import * as fs from "node:fs";
import * as path from "node:path";

import { type Result, ok } from "./errors.js";
import { atomicWrite } from "./fs-utils.js";
import { updateSentinelBlock } from "./template.js";

// ─── Constants ────────────────────────────────────────────────────
//
// Cross-agent repository instruction file. Codex and several other coding agents
// read AGENTS.md as the shared, host-agnostic repo-instructions surface, so rauf
// installs a managed block here ALONGSIDE the Claude-optimized CLAUDE.md (which
// keeps its own `<!-- rauf:start -->` sentinels — see claude-md.ts). The two files
// use distinct sentinels so they are managed independently. This is additive: the
// Claude path is untouched.

export const AGENTS_MD_FILENAME = "AGENTS.md";
export const AGENTS_MD_SENTINEL_START = "<!-- rauf:agents:start -->";
export const AGENTS_MD_SENTINEL_END = "<!-- rauf:agents:end -->";

// ─── Types ────────────────────────────────────────────────────────

export type ManagedSectionAction = "created" | "merged" | "skipped" | "updated";

export interface ManagedSectionResult {
  action: ManagedSectionAction;
  filePath: string;
}

// ─── mergeManagedSection ─────────────────────────────────────────
//
// Smart-merge a sentinel-bounded managed block into an instruction file. Generic
// over filename + sentinels so it serves AGENTS.md (and any future per-agent
// instruction file) without coupling to a specific agent. Mirrors the four
// scenarios of the CLAUDE.md merge (claude-md.ts), kept as a separate helper so
// changes here never disrupt the Claude path:
//   1. File does not exist → create with the managed block
//   2. File exists, no sentinels → append the managed block
//   3. Sentinels exist, content matches → skip (no-op)
//   4. Sentinels exist, content differs → replace the bounded block only
//
// `blockContent` is the inner content between sentinels (NOT the sentinels).

export function mergeManagedSection(
  projectPath: string,
  filename: string,
  sentinelStart: string,
  sentinelEnd: string,
  blockContent: string,
): Result<ManagedSectionResult> {
  const resolvedProject = path.resolve(projectPath);
  const filePath = path.join(resolvedProject, filename);

  let existingContent: string | null = null;
  try {
    existingContent = fs.readFileSync(filePath, "utf-8");
  } catch {
    // File doesn't exist — scenario 1
  }

  // ── Scenario 1: file does not exist ───────────────────────────
  if (existingContent === null) {
    const content = sentinelStart + "\n" + blockContent + "\n" + sentinelEnd + "\n";
    const writeResult = atomicWrite(filePath, content);
    if (!writeResult.ok) return writeResult;
    return ok({ action: "created" as const, filePath });
  }

  const startIdx = existingContent.indexOf(sentinelStart);
  const endIdx = existingContent.indexOf(sentinelEnd);
  const hasSentinels = startIdx !== -1 && endIdx !== -1 && endIdx > startIdx;

  if (hasSentinels) {
    const currentInner = existingContent.slice(startIdx + sentinelStart.length, endIdx);

    // ── Scenario 3: content matches → skip ────────────────────
    if (currentInner.trim() === blockContent.trim()) {
      return ok({ action: "skipped" as const, filePath });
    }

    // ── Scenario 4: content differs → replace bounded block ───
    const updated = updateSentinelBlock(existingContent, sentinelStart, sentinelEnd, blockContent);
    const writeResult = atomicWrite(filePath, updated);
    if (!writeResult.ok) return writeResult;
    return ok({ action: "updated" as const, filePath });
  }

  // ── Scenario 2: no sentinels → append ─────────────────────────
  const merged = updateSentinelBlock(existingContent, sentinelStart, sentinelEnd, blockContent);
  const writeResult = atomicWrite(filePath, merged);
  if (!writeResult.ok) return writeResult;
  return ok({ action: "merged" as const, filePath });
}

// ─── extractManagedBlock ─────────────────────────────────────────
//
// Extract the inner managed-block content from an addon template, stripping the
// sentinel comments. If no sentinels are present, the whole (trimmed) content is
// treated as the block.

export function extractManagedBlock(
  addonContent: string,
  sentinelStart: string,
  sentinelEnd: string,
): string {
  const startIdx = addonContent.indexOf(sentinelStart);
  const endIdx = addonContent.indexOf(sentinelEnd);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return addonContent.trim();
  }

  return addonContent.slice(startIdx + sentinelStart.length, endIdx).trim();
}

// ─── removeManagedSection ────────────────────────────────────────
//
// Remove a sentinel-bounded managed block from an instruction file. If the file
// becomes empty (only whitespace) it is unlinked. Best-effort: never throws, so
// uninstall is not failed by an instruction-file issue.

export function removeManagedSection(
  projectPath: string,
  filename: string,
  sentinelStart: string,
  sentinelEnd: string,
): void {
  const filePath = path.join(path.resolve(projectPath), filename);

  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return; // file missing — nothing to remove
  }

  try {
    const startIdx = content.indexOf(sentinelStart);
    const endIdx = content.indexOf(sentinelEnd);
    if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return;

    let endOffset = endIdx + sentinelEnd.length;
    if (content[endOffset] === "\n") endOffset++;

    let startOffset = startIdx;
    if (startOffset > 0 && content[startOffset - 1] === "\n") {
      startOffset--;
    }

    const newContent = content.slice(0, startOffset) + content.slice(endOffset);

    if (newContent.trim() === "") {
      fs.unlinkSync(filePath);
    } else {
      atomicWrite(filePath, newContent);
    }
  } catch {
    // Best effort — don't fail uninstall for instruction-file issues
  }
}
