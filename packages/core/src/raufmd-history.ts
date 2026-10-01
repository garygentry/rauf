// ─── raufmd-history ───────────────────────────────────────────────
//
// Recognizes `.rauf/RAUF.md` files that are byte-for-byte what a past rauf release rendered
// (pre-ownership layouts, 0.3.0–0.18.0), so the installer can migrate them to the full-contract
// managed layout without a backup and without duplicating the old instructions.
//
// A pristine file is identified by a canonical hash, insensitive to everything a shipped release
// could legitimately have varied per project:
//   - CRLF vs LF line endings, trailing whitespace, runs of blank lines;
//   - the managed block's contents (verification commands, profile values) — `rauf update` keeps
//     those current, so an older install's managed block may come from a newer release;
//   - bytes below the user anchor (project-specific content, preserved separately);
//   - the profile's verify command in Workflow step 6, the only template placeholder that any
//     shipped release rendered outside its managed block (pinned by raufmd-history.test.ts).
// A file with no sentinels is canonicalized by treating its `## Verification Commands` section as
// the managed block, which is exactly where every shipped release put the sentinels.

import * as crypto from "node:crypto";
import { SHIPPED_RAUF_MD_HASHES } from "./raufmd-shipped-hashes.js";

const MANAGED_START = "<!-- rauf:managed:start -->";
const MANAGED_END = "<!-- rauf:managed:end -->";
const USER_ANCHORS = [
  "<!-- Add custom instructions below this line — they survive rauf update and uninstall -->",
  "<!-- Add custom instructions below this line — they survive rauf update -->",
];
const VERIFY_STEP = /(Run verification: `)[^`\n]*(`)/g;

function countOf(content: string, marker: string): number {
  return content.split(marker).length - 1;
}

/**
 * Canonical text of a pre-ownership RAUF.md (or of a shipped template), or null when the layout
 * cannot be a shipped one (malformed sentinels, or no verification section to stand in for them).
 */
export function canonicalizeLegacyRaufMd(content: string): string | null {
  let text = content.replace(/\r\n?/g, "\n");

  for (const anchor of USER_ANCHORS) {
    const idx = text.indexOf(anchor);
    if (idx !== -1) {
      text = text.slice(0, idx + anchor.length);
      break;
    }
  }

  const starts = countOf(text, MANAGED_START);
  const ends = countOf(text, MANAGED_END);
  if (starts === 1 && ends === 1) {
    const startIdx = text.indexOf(MANAGED_START);
    const endIdx = text.indexOf(MANAGED_END);
    if (endIdx < startIdx) return null;
    text =
      text.slice(0, startIdx) +
      `${MANAGED_START}\n${MANAGED_END}` +
      text.slice(endIdx + MANAGED_END.length);
  } else if (starts === 0 && ends === 0) {
    const verifyIdx = text.indexOf("## Verification Commands");
    const workflowIdx = text.indexOf("## Workflow");
    if (verifyIdx === -1 || workflowIdx < verifyIdx) return null;
    text =
      text.slice(0, verifyIdx) + `${MANAGED_START}\n${MANAGED_END}\n\n` + text.slice(workflowIdx);
  } else {
    return null;
  }

  text = text.replace(VERIFY_STEP, "$1{{verifyCommand}}$2");
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** sha256 of {@link canonicalizeLegacyRaufMd}, or null when the content has no canonical form. */
export function legacyRaufMdHash(content: string): string | null {
  const canonical = canonicalizeLegacyRaufMd(content);
  return canonical === null ? null : crypto.createHash("sha256").update(canonical).digest("hex");
}

/**
 * The rauf releases whose rendered RAUF.md this content is (ignoring the per-project parts listed
 * above), or null when it matches none — i.e. the user edited rauf's text.
 */
export function matchShippedRaufMd(content: string): readonly string[] | null {
  const hash = legacyRaufMdHash(content);
  if (hash === null) return null;
  return SHIPPED_RAUF_MD_HASHES.find((entry) => entry.sha256 === hash)?.versions ?? null;
}
