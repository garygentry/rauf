/**
 * Maintainer release-prep helper (specs/release-automation/03-prepare-helper.md).
 *
 * Run via `pnpm release:prepare <X.Y.Z[-pre]> [--dry-run] [--no-push]`.
 * Validates repo state (five guards, ALL before any mutation — REQ-PREP-07),
 * bumps all eight version locations, rolls the changelog, commits, tags, and
 * pushes branch-first so the tagged commit is on origin/main before the tag
 * (the workflow trigger) arrives. Supersedes the removed legacy bump script.
 *
 * This file is an executable: nothing imports it except prepare.test.ts, which
 * imports only the pure guard predicates below. The git-touching flow runs only
 * under `bun run` (import.meta.main), never on import.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  PACKAGE_JSON_PATHS,
  VERSION_TS_PATH,
  compareVersions,
  fail,
  getUnreleasedBody,
  isPrerelease,
  isValidVersion,
  readVersionLocations,
  rollChangelog,
  setPackageJsonVersion,
  setVersionTs,
  type PreparePlan,
} from "./lib";

/**
 * Bun's import.meta extensions, typed locally (like the Bun declare in lib.ts)
 * so the file typechecks in both the Bun and Node-based vitest type
 * environments. `main` is true only under `bun run prepare.ts` and undefined
 * when vitest imports the predicates; `dir` is only read inside main().
 */
const meta = import.meta as ImportMeta & { dir: string; main: boolean };

// ── Pure guard predicates (REQ-VER-04, REQ-PREP-04, REQ-PREP-05) ───────────
// Factored out of the git-touching flow so prepare.test.ts can exercise them
// without a repo (07-testing-strategy.md §2.2). Each returns the distinct
// `refusing: …` message on failure, or null when the guard passes.

/** Guard 2.1 — the target version must match SEMVER_RE. */
export function checkValidVersion(version: string): string | null {
  return isValidVersion(version)
    ? null
    : `refusing: "${version}" is not a valid version (expected X.Y.Z[-pre])`;
}

/** Guard 2.4 — the target must be strictly greater than the canonical version. */
export function checkVersionForward(version: string, current: string): string | null {
  return compareVersions(version, current) === 1
    ? null
    : `refusing: ${version} is not greater than current ${current}`;
}

/** Guard 2.5 — `## Unreleased` must have content to roll into the release. */
export function checkChangelogNonEmpty(changelog: string): string | null {
  return getUnreleasedBody(changelog) !== ""
    ? null
    : "refusing: CHANGELOG.md `## Unreleased` section is empty — write release notes first";
}

// ── Dry-run preview ─────────────────────────────────────────────────────────

/** Print the planned edits + rolled section + tag (03-prepare-helper.md §5). */
function printDryRun(plan: PreparePlan): void {
  const canonical = plan.locations.find((l) => l.canonical)!.version;
  console.log(`Plan for ${plan.tag} (${plan.isPrerelease ? "prerelease" : "stable"}):`);
  const width = Math.max(...plan.locations.map((l) => l.file.length)) + 1;
  for (const loc of plan.locations) {
    const drift = loc.version !== canonical ? "   (corrects drift)" : "";
    console.log(`  ${`${loc.file}:`.padEnd(width)} ${loc.version} → ${plan.version}${drift}`);
  }
  console.log(`  CHANGELOG.md: roll \`## Unreleased\` → \`## ${plan.version}\``);
  console.log(`  tag: ${plan.tag}`);
  console.log("");
  console.log(`## ${plan.version} section body:`);
  console.log(plan.sectionBody);
  console.log("");
  console.log("(dry run — no changes written)");
}

// ── Executable flow ─────────────────────────────────────────────────────────

function main(): void {
  // Argument parsing (§1).
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const noPush = args.includes("--no-push");
  const positionals = args.filter((a) => !a.startsWith("--"));
  if (positionals.length !== 1) {
    fail("usage: pnpm release:prepare <X.Y.Z[-pre]> [--dry-run] [--no-push]");
  }
  const version = positionals[0]!;

  const repoRoot = path.resolve(meta.dir, "../..");

  /** Run git synchronously at repoRoot; throw with stderr on nonzero exit. */
  function git(gitArgs: string[]): string {
    try {
      return execFileSync("git", gitArgs, { cwd: repoRoot, encoding: "utf8" });
    } catch (e: unknown) {
      const err = e as { stderr?: string; message?: string };
      throw new Error((err.stderr || err.message || "git failed").toString().trim());
    }
  }

  // Guard 2.1 — valid version (REQ-VER-04).
  const invalidMsg = checkValidVersion(version);
  if (invalidMsg) fail(invalidMsg);

  // Guard 2.2 — branch, clean tree, up to date with origin/main (REQ-PREP-02).
  // Mirrors the branch/detached/dirty pattern of checkLoopPreconditions
  // (packages/loop/src/git-status.ts) and adds the remote up-to-date check.
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  if (branch === "HEAD") fail("refusing: detached HEAD — checkout main first");
  if (branch !== "main") fail(`refusing: not on main (on "${branch}")`);

  if (git(["status", "--porcelain"]).trim() !== "") {
    fail("refusing: working tree is dirty — commit or stash first");
  }

  git(["fetch", "--quiet", "origin", "main"]);
  const local = git(["rev-parse", "@"]).trim();
  const remote = git(["rev-parse", "@{u}"]).trim();
  const base = git(["merge-base", "@", "@{u}"]).trim();
  if (local !== remote) {
    if (local === base) fail("refusing: local main is behind origin/main — pull first");
    if (remote === base) fail("refusing: local main is ahead of origin/main — push first");
    fail("refusing: local main has diverged from origin/main — reconcile first");
  }

  // Guard 2.3 — tag absent locally and on origin (REQ-PREP-03).
  const tag = `v${version}`;
  if (git(["tag", "-l", tag]).trim() !== "") {
    fail(`refusing: tag ${tag} already exists locally`);
  }
  if (git(["ls-remote", "--tags", "origin", tag]).trim() !== "") {
    fail(`refusing: tag ${tag} already exists on origin`);
  }

  // Guard 2.4 — version moves forward vs the CANONICAL version.ts value
  // (REQ-PREP-04, REQ-VER-03) — never the drifted package.json values.
  const locations = readVersionLocations(repoRoot);
  const current = locations.find((l) => l.canonical)!.version;
  const backwardMsg = checkVersionForward(version, current);
  if (backwardMsg) fail(backwardMsg);

  // Guard 2.5 — changelog has unreleased content (REQ-PREP-05).
  const changelogPath = path.join(repoRoot, "CHANGELOG.md");
  const changelog = fs.readFileSync(changelogPath, "utf8");
  const emptyMsg = checkChangelogNonEmpty(changelog);
  if (emptyMsg) fail(emptyMsg);

  // All guards passed — compute the plan (§3) before any side effect so
  // --dry-run can print it without writes.
  const { updated: rolledChangelog, sectionBody } = rollChangelog(changelog, version);
  const plan: PreparePlan = {
    version,
    tag,
    isPrerelease: isPrerelease(version),
    changelog: rolledChangelog,
    sectionBody,
    locations,
  };

  if (dryRun) {
    printDryRun(plan);
    process.exit(0);
  }

  // §3.1 — canonical version.ts.
  const vtsPath = path.join(repoRoot, VERSION_TS_PATH);
  fs.writeFileSync(vtsPath, setVersionTs(fs.readFileSync(vtsPath, "utf8"), version));

  // §3.2 — all seven package.json (corrects the packages/docs drift, REQ-VER-05;
  // includes npm-dist so the npm launcher bumps in lockstep with the binary release).
  for (const rel of PACKAGE_JSON_PATHS) {
    const p = path.join(repoRoot, rel);
    fs.writeFileSync(p, setPackageJsonVersion(fs.readFileSync(p, "utf8"), version));
  }

  // §3.3 — roll the changelog (REQ-NOTES-01).
  fs.writeFileSync(changelogPath, rolledChangelog);

  // §3.4 — commit & tag. The tag carries a message (-m) so it works
  // non-interactively under tag.gpgSign=true (a bare `git tag` would demand
  // an editor for the forced-annotated tag and die with "no tag message").
  git(["add", "-A"]);
  git(["commit", "-m", `chore(release): ${tag}`]);
  git(["tag", "-m", tag, tag]);

  // §3.5 / §4 — push branch FIRST, then the tag (the irreversible trigger).
  // The two pushes are not transactional; on failure print exact recovery
  // commands so the maintainer is never left guessing (tech-spec §7).
  function pushOrRecover(pushArgs: string[], which: "branch" | "tag"): void {
    try {
      git(pushArgs);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      if (which === "branch") {
        fail(
          `push failed: ${detail}\n` +
            `release commit & tag ${tag} exist locally but were NOT pushed.\n` +
            `  retry:  git push origin main && git push origin ${tag}\n` +
            `  abort:  git reset --hard origin/main && git tag -d ${tag}`,
        );
      } else {
        fail(
          `tag push failed: ${detail}\n` +
            `main was pushed but tag ${tag} was not — the release has NOT triggered.\n` +
            `  retry:  git push origin ${tag}`,
        );
      }
    }
  }

  if (!noPush) {
    pushOrRecover(["push", "origin", "main"], "branch");
    pushOrRecover(["push", "origin", tag], "tag");
  }
  console.log(
    `Prepared ${tag}.${
      noPush
        ? " (not pushed — run the two git push commands when ready)"
        : " Release workflow triggered."
    }`,
  );
}

if (meta.main) {
  main();
}
