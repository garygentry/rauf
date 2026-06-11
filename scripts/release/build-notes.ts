/**
 * Release-notes composer
 * (specs/release-automation/04-ci-preflight-and-workflow.md §3 step 9).
 *
 * Invoked by release.yml via `bun run scripts/release/build-notes.ts` with
 * TAG and VERSION (from the preflight output) in the env. Writes dist/NOTES.md:
 * the verbatim curated `## X.Y.Z` changelog section (REQ-NOTES-02) plus a
 * Full Changelog compare link when a prior v* release tag exists
 * (REQ-NOTES-03).
 *
 * This file is an executable: nothing imports it except build-notes.test.ts,
 * which imports only the pure composeNotes below. The env/git/filesystem flow
 * runs only under `bun run` (import.meta.main), never on import.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { extractSection, REPO_SLUG } from "./lib";

/**
 * Bun's import.meta extensions, typed locally (same pattern as prepare.ts /
 * preflight.ts) so the file typechecks in both the Bun and Node-based vitest
 * type environments. `main` is true only under `bun run build-notes.ts` and
 * undefined when vitest imports composeNotes; `dir` is only read inside main().
 */
const meta = import.meta as ImportMeta & { dir: string; main: boolean };

// ── Pure notes composition (REQ-NOTES-02/03) ────────────────────────────────

/**
 * Compose the NOTES.md content: the curated changelog section body, plus —
 * only when a prior v* release tag exists — the Full Changelog compare link.
 * `prevTag === null` means first release: the line is omitted entirely rather
 * than fabricating a compare base (e.g. against the unrelated pre-rauf-rename
 * tag). Pure — factored out of main() so build-notes.test.ts exercises both
 * branches without git (07-testing-strategy.md §2.3).
 */
export function composeNotes(
  sectionBody: string,
  prevTag: string | null,
  tag: string,
  repoSlug: string,
): string {
  let notes = sectionBody;
  if (prevTag !== null) {
    notes += `\n\n**Full Changelog**: https://github.com/${repoSlug}/compare/${prevTag}...${tag}\n`;
  }
  return notes;
}

// ── Main (release-workflow-only flow) ───────────────────────────────────────

function main(): void {
  const repoRoot = path.resolve(meta.dir, "../..");
  const version = process.env.VERSION!; // from preflight output
  const tag = process.env.TAG!;
  const changelog = fs.readFileSync(path.join(repoRoot, "CHANGELOG.md"), "utf8");

  // REQ-NOTES-02: the verbatim curated section body.
  const sectionBody = extractSection(changelog, version);

  // REQ-NOTES-03: find the prior release tag. `--match 'v*'` is mandatory so
  // the unrelated pre-rauf-rename tag is never selected as the compare base.
  // git describe exits nonzero when no prior v* tag exists (first release).
  let prev = "";
  try {
    prev = execFileSync("git", ["describe", "--tags", "--abbrev=0", "--match", "v*", `${tag}^`], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
  } catch {
    prev = ""; // first release — no prior v* tag
  }

  const notes = composeNotes(sectionBody, prev === "" ? null : prev, tag, REPO_SLUG);

  fs.mkdirSync(path.join(repoRoot, "dist"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "dist/NOTES.md"), notes);
  console.log(
    `wrote dist/NOTES.md for ${tag}${prev ? ` (compare base ${prev})` : " (first release)"}`,
  );
}

if (meta.main) main();
