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

// ─── AGENTS.md import shim (#173) ───────────────────────────────
//
// Some projects keep all agent guidance in AGENTS.md and make CLAUDE.md a thin
// shim that imports it (`@AGENTS.md`). rauf also writes its cross-agent section
// into AGENTS.md, so a rauf block in such a CLAUDE.md makes Claude Code load the
// loop rules twice. The AGENTS.md block's Delegation section already covers the
// Claude Task-tool case host-agnostically, so nothing is lost by skipping it.

/**
 * True when `content` imports AGENTS.md the way Claude Code resolves memory
 * imports: an `@AGENTS.md` / `@./AGENTS.md` token anywhere in prose (its own
 * line or inline, e.g. "See @AGENTS.md"), but NOT inside a fenced code block or
 * an inline code span, which Claude Code does not evaluate.
 */
export function claudeMdImportsAgentsMd(content: string): boolean {
  const prose = content
    // Fenced blocks (``` or ~~~, 3+ chars, closed by the same fence or EOF).
    .replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]*\1[ \t]*\r?$|(?![\s\S]))/gm, "")
    // Inline code spans (`…` / ``…``).
    .replace(/(`+)[^`\n][\s\S]*?\1/g, "");
  return /(?:^|[\s(])@(?:\.\/)?AGENTS\.md(?=$|[\s.,;:!?)])/m.test(prose);
}

/**
 * Remove EVERY complete rauf sentinel block (and the blank line before each)
 * from CLAUDE.md content, preserving the file's LF or CRLF line endings.
 * Returns null when there is no complete block. Shared by uninstall and the
 * `@AGENTS.md` shim cleanup.
 */
export function stripClaudeMdRaufBlock(content: string): string | null {
  let out = content;
  let removed = false;
  for (;;) {
    const startIdx = out.indexOf(CLAUDE_MD_SENTINEL_START);
    const endIdx = out.indexOf(CLAUDE_MD_SENTINEL_END, startIdx);
    if (startIdx === -1 || endIdx === -1) break;

    // Sentinel start to sentinel end (inclusive) plus its line ending…
    let endOffset = endIdx + CLAUDE_MD_SENTINEL_END.length;
    if (out.startsWith("\r\n", endOffset)) endOffset += 2;
    else if (out[endOffset] === "\n") endOffset++;
    // …and the line ending before it (the blank line separating the block).
    let startOffset = startIdx;
    if (startOffset >= 2 && out.slice(startOffset - 2, startOffset) === "\r\n") startOffset -= 2;
    else if (startOffset > 0 && out[startOffset - 1] === "\n") startOffset--;

    out = out.slice(0, startOffset) + out.slice(endOffset);
    removed = true;
  }
  return removed ? out : null;
}

export type ClaudeMdShimAction = "removed" | "kept-out" | "incomplete-block";

/**
 * When CLAUDE.md imports AGENTS.md, keep rauf's section out of it: remove any
 * existing rauf block (so an already-duplicated install cleans itself up) and
 * report it. A dangling sentinel with no complete block is reported, not
 * guessed at. Returns null when CLAUDE.md is missing or has no such import, so
 * the caller merges as usual. Callers must deploy AGENTS.md's rauf section
 * FIRST: this assumes Claude gets the rules from there.
 */
export function reconcileAgentsImportShim(
  projectPath: string,
): Result<{ action: ClaudeMdShimAction; filePath: string } | null> {
  const claudeMdPath = path.join(path.resolve(projectPath), CLAUDE_MD_FILENAME);
  let content: string;
  try {
    content = fs.readFileSync(claudeMdPath, "utf-8");
  } catch {
    return ok(null);
  }
  if (!claudeMdImportsAgentsMd(content)) return ok(null);

  const stripped = stripClaudeMdRaufBlock(content);
  const source = stripped ?? content;
  if (source.includes(CLAUDE_MD_SENTINEL_START) || source.includes(CLAUDE_MD_SENTINEL_END)) {
    // A broken block left behind (hand-edited). Write any complete-block
    // removal, but tell the user about the remainder rather than claim clean.
    if (stripped !== null) {
      const writeResult = atomicWrite(claudeMdPath, stripped);
      if (!writeResult.ok) return writeResult;
    }
    return ok({ action: "incomplete-block", filePath: claudeMdPath });
  }
  if (stripped === null) return ok({ action: "kept-out", filePath: claudeMdPath });
  const writeResult = atomicWrite(claudeMdPath, stripped);
  if (!writeResult.ok) return writeResult;
  return ok({ action: "removed", filePath: claudeMdPath });
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
