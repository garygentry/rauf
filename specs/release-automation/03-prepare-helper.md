# 03 — Prep Helper (`scripts/release/prepare.ts`)

The single maintainer-facing command that prepares and triggers a release. Run via `pnpm release:prepare <version> [--dry-run] [--no-push]`. It validates repo state (five guards, all before any mutation), bumps all seven version locations, rolls the changelog, commits, tags, and pushes. Supersedes the removed `bump-version.sh` (tech-spec §3.1, §6.1).

## Requirement Coverage

| REQ ID       | Requirement                                                     | Section       |
| ------------ | -------------------------------------------------------------- | ------------- |
| REQ-PREP-01  | One invocation: bump + roll + commit + tag + push              | 1, 3          |
| REQ-PREP-02  | Refuse unless on main, clean tree, up to date with remote      | 2.2           |
| REQ-PREP-03  | Refuse if tag exists locally or on remote                      | 2.3           |
| REQ-PREP-04  | Refuse if version not strictly greater than current            | 2.4           |
| REQ-PREP-05  | Refuse if `## Unreleased` is empty                             | 2.5           |
| REQ-PREP-06  | Lives under `scripts/`, not in the product CLI                 | (whole doc)   |
| REQ-PREP-07  | Any guard fails → no changes, clear message, nonzero exit      | 2, 4          |
| REQ-VER-01/05| Bump all six package.json (incl. docs)                         | 3.2           |
| REQ-VER-02   | Version supplied explicitly by maintainer                      | 1             |
| REQ-VER-04   | Validate semver                                               | 2.1           |
| REQ-NOTES-01 | Roll `## Unreleased` → `## X.Y.Z`                              | 3.3           |

## 1. CLI interface (REQ-PREP-01, REQ-VER-02)

```
pnpm release:prepare <X.Y.Z[-pre]> [--dry-run] [--no-push]
```

| Arg / flag    | Meaning                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------- |
| `<version>`   | Required. The target version (no leading `v`). Validated by `isValidVersion` (guard 2.1).     |
| `--dry-run`   | Run all guards, compute the `PreparePlan`, print the planned edits + rolled section + tag, then exit 0 **without writing or running any git mutation**. |
| `--no-push`   | Perform steps 1–9 (local prep + commit + tag) but stop before the push (step 10), so the maintainer can inspect/undo before the irreversible trigger. |

Exit codes: `0` success (or successful dry-run); `1` any guard failure or mutation error (single message via `fail()`, `00-core-definitions.md` §5).

### Argument parsing

```typescript
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const noPush = args.includes("--no-push");
const positionals = args.filter((a) => !a.startsWith("--"));
if (positionals.length !== 1) {
  fail("usage: pnpm release:prepare <X.Y.Z[-pre]> [--dry-run] [--no-push]");
}
const version = positionals[0]!;
```

## 2. Guards (REQ-PREP-07 — all evaluated BEFORE any mutation)

The guards run in this order; the first failure calls `fail()` and the process exits nonzero, leaving the repo **completely untouched**. `repoRoot` is resolved once via `path.resolve(import.meta.dir, "../..")`. Git is invoked through a small `git()` helper that mirrors the `execGit`/`execFile("git", …)` pattern used by `checkLoopPreconditions` (`packages/loop/src/git-status.ts`) but operates on the repo root.

```typescript
import { execFileSync } from "node:child_process";

/** Run git synchronously at repoRoot; throw with stderr on nonzero exit. */
function git(args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  } catch (e: unknown) {
    const err = e as { stderr?: string; message?: string };
    throw new Error((err.stderr || err.message || "git failed").toString().trim());
  }
}
```

### 2.1 Valid version (REQ-VER-04)

```typescript
if (!isValidVersion(version)) {
  fail(`refusing: "${version}" is not a valid version (expected X.Y.Z[-pre])`);
}
```

### 2.2 Repo state — branch, clean tree, up to date (REQ-PREP-02)

Mirrors `checkLoopPreconditions` (branch/detached/dirty) and **adds the remote up-to-date check that function lacks** (tech-spec §6.2).

```typescript
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
if (branch === "HEAD") fail("refusing: detached HEAD — checkout main first");
if (branch !== "main") fail(`refusing: not on main (on "${branch}")`);

if (git(["status", "--porcelain"]).trim() !== "") {
  fail("refusing: working tree is dirty — commit or stash first");
}

// Remote up-to-date check (new capability beyond checkLoopPreconditions).
git(["fetch", "--quiet", "origin", "main"]);
const local = git(["rev-parse", "@"]).trim();
const remote = git(["rev-parse", "@{u}"]).trim();
const base = git(["merge-base", "@", "@{u}"]).trim();
if (local !== remote) {
  if (local === base) fail("refusing: local main is behind origin/main — pull first");
  if (remote === base) fail("refusing: local main is ahead of origin/main — push first");
  fail("refusing: local main has diverged from origin/main — reconcile first");
}
```

### 2.3 Tag does not exist (REQ-PREP-03)

```typescript
const tag = `v${version}`;
if (git(["tag", "-l", tag]).trim() !== "") {
  fail(`refusing: tag ${tag} already exists locally`);
}
if (git(["ls-remote", "--tags", "origin", tag]).trim() !== "") {
  fail(`refusing: tag ${tag} already exists on origin`);
}
```

### 2.4 Version moves forward (REQ-PREP-04)

Compares against the canonical `version.ts` value (REQ-VER-03).

```typescript
const locations = readVersionLocations(repoRoot);
const current = locations.find((l) => l.canonical)!.version;
if (compareVersions(version, current) !== 1) {
  fail(`refusing: ${version} is not greater than current ${current}`);
}
```

> The comparison is always against the **canonical** `version.ts` value (currently `0.2.0`), never the drifted `packages/docs` `0.1.0` — so the first real release must be strictly greater than `0.2.0` (e.g. `0.3.0` or `0.2.1`). The same `release:prepare` run that bumps forward also corrects the docs drift (§3.2).

### 2.5 Changelog has content (REQ-PREP-05)

```typescript
const changelogPath = path.join(repoRoot, "CHANGELOG.md");
const changelog = fs.readFileSync(changelogPath, "utf8");
if (getUnreleasedBody(changelog) === "") {
  fail("refusing: CHANGELOG.md `## Unreleased` section is empty — write release notes first");
}
```

## 3. Mutations (only after all guards pass)

Computed into a `PreparePlan` (`00-core-definitions.md` §1.3) first, so `--dry-run` can print it without side effects.

```typescript
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
  printDryRun(plan); // version edits, rolled section body, tag — no writes
  process.exit(0);
}
```

### 3.1 Write canonical `version.ts` (REQ-VER-03)

```typescript
const vtsPath = path.join(repoRoot, VERSION_TS_PATH);
fs.writeFileSync(vtsPath, setVersionTs(fs.readFileSync(vtsPath, "utf8"), version));
```

### 3.2 Write all six package.json (REQ-VER-01, REQ-VER-05)

```typescript
for (const rel of PACKAGE_JSON_PATHS) {
  const p = path.join(repoRoot, rel);
  fs.writeFileSync(p, setPackageJsonVersion(fs.readFileSync(p, "utf8"), version));
}
```

> The first real release corrects the existing `packages/docs/package.json` `0.1.0` drift (REQ-VER-05) because docs is in `PACKAGE_JSON_PATHS`.

### 3.3 Roll the changelog (REQ-NOTES-01)

```typescript
fs.writeFileSync(changelogPath, rolledChangelog);
```

### 3.4 Commit & tag

```typescript
git(["add", "-A"]);
git(["commit", "-m", `chore(release): ${tag}`]);
git(["tag", tag]);
```

### 3.5 Push — branch first, then tag (unless `--no-push`)

```typescript
if (!noPush) {
  pushOrRecover(["push", "origin", "main"], "branch");
  pushOrRecover(["push", "origin", tag], "tag");
}
console.log(`Prepared ${tag}.${noPush ? " (not pushed — run the two git push commands when ready)" : " Release workflow triggered."}`);
```

Branch-first ordering is deliberate: the tag is the workflow trigger (`04-ci-preflight-and-workflow.md`), so the tagged commit must already be on `origin/main` before the tag arrives, and pushing the tag last makes the irreversible trigger the final action (tech-spec §3.1 step 10).

## 4. Push-phase failure recovery (REQ-PREP-07, tech-spec §7)

The two pushes are not transactional. `pushOrRecover` prints exact recovery guidance and exits nonzero on failure so the maintainer is never left guessing:

```typescript
function pushOrRecover(args: string[], which: "branch" | "tag"): void {
  try {
    git(args);
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
```

Interaction with REQ-PREP-03: any failure that leaves the local `vX.Y.Z` tag in place means a subsequent full re-run will correctly refuse at guard 2.3; the recovery messages call out `git tag -d ${tag}` so that refusal is never surprising. After a branch-pushed-but-tag-failed state, the recovery is the single `git push origin ${tag}` — **not** a re-run of the helper (the clean-tree and tag guards would now fire).

## 5. Worked example

```
$ pnpm release:prepare 0.3.0 --dry-run
Plan for v0.3.0 (stable):
  packages/core/src/version.ts: 0.2.0 → 0.3.0
  package.json:                 0.2.0 → 0.3.0
  packages/core/package.json:   0.2.0 → 0.3.0
  packages/cli/package.json:    0.2.0 → 0.3.0
  packages/loop/package.json:   0.2.0 → 0.3.0
  packages/web/package.json:    0.2.0 → 0.3.0
  packages/docs/package.json:   0.1.0 → 0.3.0   (corrects drift)
  CHANGELOG.md: roll `## Unreleased` → `## 0.3.0`
  tag: v0.3.0
(dry run — no changes written)
```

## Dependencies

- `00-core-definitions.md` — types, constants, `fail()`.
- `02-shared-lib.md` — `readVersionLocations`, `parseVersionTs`/`setVersionTs`, `setPackageJsonVersion`, `isValidVersion`, `compareVersions`, `isPrerelease`, `getUnreleasedBody`, `rollChangelog`.

## Verification

- `prepare.test.ts` covers the pure guard predicates (valid-version, version-forward, changelog-empty) factored to be testable without touching git (tech-spec §8).
- Manual: against a clean `main`, `pnpm release:prepare <next> --dry-run` prints the seven edits incl. the docs drift correction and exits 0 with no `git status` change.
- Manual: each unsafe condition (not-on-main, dirty, behind/ahead/diverged, existing tag, non-incrementing version, empty changelog) produces a distinct `refusing: …` line and leaves the repo untouched (Success Criteria #2).
- After a real `--no-push` run: a `chore(release): vX.Y.Z` commit + `vX.Y.Z` tag exist locally, nothing pushed; `git reset --hard origin/main && git tag -d vX.Y.Z` fully reverts.
