#!/usr/bin/env bun
/**
 * Documentation anti-drift guard (docs-overhaul WS7).
 *
 * Fails the gate when user-facing docs drift from the shipped v0.6.0 surface. Catches the
 * specific classes of rot this overhaul had to clean up by hand:
 *
 *   1. Removed grammar used as current — `loop start`, `loop watch`, `loop follow`,
 *      `status --watch`, bare `--watch`. The migration guide is allowlisted (it documents
 *      these as REMOVED), and lines that talk ABOUT the removal (contain "removed",
 *      "replaces", "→", "migrat…", "legacy", …) are exempt — only USAGE is flagged.
 *   2. `ralph` branding leakage in user-facing docs + the diagram source. Legitimate
 *      migration references (the `rauf migrate` legacy path, `~/.ralph`) are exempt, as are
 *      references to the generic "ralph" loop ARCHETYPE — the technique rauf implements
 *      (https://ghuntley.com/ralph/), written as the quoted `"ralph"` pattern/runner or with
 *      the canonical link. We guard the old PRODUCT NAME, not the word; the archetype is fair
 *      game and is deliberately surfaced in the README + landing essence.
 *   3. Obviously stale RAUF version-tag pins (v0.0.x–v0.3.x) hard-coded in docs.
 *   4. A CLI command/subcommand registered in packages/cli/src/commands.ts but ABSENT from
 *      docs/SPEC-CLI.md — the drift that hid `validate`/`unblock` (and `migrate`) from the
 *      reference. A cheap name-set diff catches the class.
 *
 * Scope: packages/docs/src/content/docs/** (symlinked specs included) + README.md, plus
 * scripts/generate-diagrams.ts for the ralph check. Wired into `pnpm gate`.
 *
 * Exit 0 when clean; exit 1 with a per-finding report otherwise.
 */
import { readFileSync, readdirSync, statSync, lstatSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const rel = (p: string) => relative(repoRoot, p);

// ─── File collection ─────────────────────────────────────────────
// Manual walk so symlinked .md spec pages are included (statSync follows the link; a Dirent
// type check would drop them). Skip the symlinked `images/` dir — no prose lives there.
function walkDocs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "images") continue;
    const full = join(dir, entry);
    const st = statSync(full); // follows symlinks
    if (st.isDirectory()) out.push(...walkDocs(full));
    else if (st.isFile() && /\.mdx?$/.test(entry)) out.push(full);
  }
  return out;
}

const docsContentDir = join(repoRoot, "packages/docs/src/content/docs");
const docFiles = [...walkDocs(docsContentDir), join(repoRoot, "README.md")];
const diagramSource = join(repoRoot, "scripts/generate-diagrams.ts");

// The migration guide documents the removed grammar and the ralph→rauf history on purpose.
const MIGRATION_PAGE = "packages/docs/src/content/docs/guides/migrating-v0-5.md";

// A line that talks ABOUT removed/renamed things is documentation, not usage.
const REMOVAL_CONTEXT =
  /removed|replaces|instead of|no longer|formerly|deprecated|renamed|migrat|legacy|→|->/i;

// A line referencing the generic "ralph" loop ARCHETYPE (the technique rauf implements), not the
// old product name. Signalled by the canonical link, the quoted archetype name, or pattern-adjacent
// wording. These are legitimately user-facing and exempt from the branding-leak check.
const RALPH_PATTERN_CONTEXT =
  /ghuntley\.com\/ralph|["“'`]ralph["”'`]|ralph[-\s](pattern|technique|archetype|loop|runner|style)|(pattern|technique|archetype|loop|runner|style)[-\s]ralph/i;

interface Finding {
  file: string;
  line: number;
  text: string;
  why: string;
}
const findings: Finding[] = [];
const add = (file: string, line: number, text: string, why: string) =>
  findings.push({ file: rel(file), line, text: text.trim(), why });

// ─── 1 + 2 + 3: line-scanned content checks ──────────────────────
for (const file of docFiles) {
  const isMigrationPage = rel(file) === MIGRATION_PAGE;
  // Authored pages are real files; the canonical specs are symlinks into docs/.
  const isAuthored = !lstatSync(file).isSymbolicLink();
  const lines = readFileSync(file, "utf8").split("\n");

  lines.forEach((line, i) => {
    const lineNo = i + 1;

    // (1) Removed grammar — only when used as a CURRENT command, not prose ("at loop start")
    //     or a documented removal. A hit means: the form sits inside a single inline-code span
    //     (`loop start`), or is written `rauf loop start`, or leads a command line in a fence.
    if (!isMigrationPage && !REMOVAL_CONTEXT.test(line)) {
      const inlineSpans = line.match(/`[^`]+`/g) ?? [];
      const removedRe = /\b(rauf\s+)?loop\s+(start|watch|follow)\b/;
      const inInlineCode = inlineSpans.some((s) => removedRe.test(s));
      const asRaufCmd = /\brauf\s+loop\s+(start|watch|follow)\b/.test(line);
      const asCmdLine = /^\s*(\$\s*)?(rauf\s+)?loop\s+(start|watch|follow)\b/.test(line);
      if (inInlineCode || asRaufCmd || asCmdLine) {
        const m = line.match(/loop\s+(start|watch|follow)/);
        add(
          file,
          lineNo,
          line,
          `removed grammar: \`loop ${m?.[1]}\` (use \`loop run --detached\` / \`follow\`)`,
        );
      }
      if (/(?<![A-Za-z-])--watch\b/.test(line)) {
        add(file, lineNo, line, "removed flag: `--watch` (use `--follow` / `status --follow`)");
      }
    }

    // (2) ralph branding leakage — authored consumer pages + README only (canonical specs are
    //     maintained as source-of-truth and legitimately carry historical / archetype terms).
    if (
      isAuthored &&
      !isMigrationPage &&
      /\bralph\b/i.test(line) &&
      !REMOVAL_CONTEXT.test(line) &&
      !RALPH_PATTERN_CONTEXT.test(line) &&
      !/\.ralph\b/.test(line)
    ) {
      add(file, lineNo, line, "ralph branding leak (rauf was formerly ralph)");
    }

    // (3) Obviously stale RAUF version-tag pins (v0.0.x–v0.3.x). The `v` prefix avoids matching
    //     IP addresses (127.0.0.1) and the contract's own schemaVersion (0.1.0/0.2.0).
    if (!isMigrationPage && !REMOVAL_CONTEXT.test(line)) {
      const v = line.match(/\bv0\.[0-3]\.\d+\b/);
      if (v)
        add(file, lineNo, line, `stale version pin: ${v[0]} (current is the version.ts value)`);
    }
  });
}

// Diagram source: ralph-only check (no prose grammar there).
{
  const lines = readFileSync(diagramSource, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (/\bralph\b/i.test(line) && !REMOVAL_CONTEXT.test(line) && !/\.ralph\b/.test(line)) {
      add(diagramSource, i + 1, line, "ralph branding leak in diagram source");
    }
  });
}

// ─── 4: command/subcommand ↔ SPEC-CLI parity ─────────────────────
// Extract every command + subcommand name from the COMMANDS registry (string `name:` literals
// that are not flags, i.e. don't start with "-"), then require each to appear in SPEC-CLI.md.
const commandsSrc = readFileSync(join(repoRoot, "packages/cli/src/commands.ts"), "utf8");
const specCli = readFileSync(join(repoRoot, "docs/SPEC-CLI.md"), "utf8");
const names = new Set<string>();
for (const m of commandsSrc.matchAll(/\bname:\s*"([^"]+)"/g)) {
  const name = m[1]!;
  if (!name.startsWith("-")) names.add(name);
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const missingCommands = [...names]
  .filter((n) => !new RegExp(`\\b${escapeRe(n)}\\b`, "i").test(specCli))
  .sort();
for (const n of missingCommands) {
  findings.push({
    file: "docs/SPEC-CLI.md",
    line: 0,
    text: `command/subcommand "${n}" (from packages/cli/src/commands.ts)`,
    why: "registered CLI name absent from SPEC-CLI.md — document it or remove the command",
  });
}

// ─── Report ──────────────────────────────────────────────────────
if (findings.length > 0) {
  console.error(`✗ check-docs found ${findings.length} issue(s):\n`);
  for (const f of findings) {
    const loc = f.line > 0 ? `${f.file}:${f.line}` : f.file;
    console.error(`  ${loc}\n    ${f.why}\n    > ${f.text}\n`);
  }
  console.error(
    "Fix the above (the migration guide is allowlisted for documented-removal grammar).",
  );
  process.exit(1);
}

console.log(
  `check-docs clean: ${docFiles.length} doc file(s) scanned, ` +
    `${names.size} CLI names all present in SPEC-CLI.md.`,
);
