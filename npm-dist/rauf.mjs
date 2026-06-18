#!/usr/bin/env node
// rauf — npm launcher shim (binary bootstrapper).
//
// The real rauf CLI is a single self-contained binary compiled with
// `bun build --compile` and published per-OS to GitHub Releases. This shim
// downloads the binary matching this package's version and the host platform on
// first run, verifies it against the release SHA256SUMS, caches it under
// ~/.cache/rauf/, then execs it — passing through argv, stdio, and exit code.
//
// No Bun or repo checkout is required on the user's machine: `npx rauf@<ver>`
// works with only Node >= 18. Pure node: builtins, zero dependencies. The
// platform→asset mapping and checksum policy mirror scripts/install-binary.sh.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** owner/repo to fetch release assets from (override for forks/testing). */
const REPO = process.env.RAUF_REPO || "garygentry/rauf";

function fail(msg) {
  process.stderr.write(`rauf: ${msg}\n`);
  process.exit(1);
}

/**
 * The binary version to fetch. Defaults to this package's version so
 * `npx rauf@X.Y.Z` deterministically runs the vX.Y.Z binary; RAUF_VERSION
 * overrides it (used to verify the shim against an older release). A leading
 * "v" is tolerated.
 */
function resolveVersion() {
  const override = process.env.RAUF_VERSION;
  if (override) return override.replace(/^v/, "");
  const pkg = JSON.parse(readFileSync(join(HERE, "package.json"), "utf8"));
  return pkg.version;
}

/**
 * Map the host platform/arch to the release asset name. Kept in sync with
 * `detect_asset` in scripts/install-binary.sh and the --outfile names in
 * .github/workflows/release.yml (only windows-x64 is released for Windows).
 */
function detectAsset() {
  const { platform, arch } = process;
  if (platform === "win32") {
    if (arch !== "x64") fail(`unsupported Windows arch: ${arch} (only x64 is released)`);
    return "rauf-windows-x64.exe";
  }
  let os;
  if (platform === "linux") os = "linux";
  else if (platform === "darwin") os = "darwin";
  else return fail(`unsupported platform: ${platform}`);

  let a;
  if (arch === "x64") a = "x64";
  else if (arch === "arm64") a = "arm64";
  else return fail(`unsupported arch: ${arch}`);
  return `rauf-${os}-${a}`;
}

/** Per-version cache directory (XDG-aware, with a tmpdir fallback). */
function cacheDir(version) {
  const base =
    process.env.RAUF_CACHE_DIR ||
    process.env.XDG_CACHE_HOME ||
    (homedir() ? join(homedir(), ".cache") : tmpdir());
  return join(base, "rauf", "bin", version);
}

async function fetchBuffer(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) fail(`download failed (HTTP ${res.status}): ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function fetchTextOrNull(url) {
  try {
    const res = await fetch(url, { redirect: "follow" });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/**
 * Verify `data` against the release SHA256SUMS. A checksum mismatch is a hard
 * failure; a missing sums file or unlisted asset warns and continues (matches
 * the install-binary.sh policy so a registry/CDN hiccup never bricks the run).
 */
function verifyChecksum(data, asset, sums) {
  if (sums == null) {
    process.stderr.write("rauf: warning — could not fetch SHA256SUMS; skipping verification\n");
    return;
  }
  const line = sums
    .split("\n")
    .find((l) => l.trimEnd().endsWith(` ${asset}`) || l.trimEnd().endsWith(`*${asset}`));
  const expected = line ? line.trim().split(/\s+/)[0] : null;
  if (!expected) {
    process.stderr.write(
      `rauf: warning — ${asset} not listed in SHA256SUMS; skipping verification\n`,
    );
    return;
  }
  const actual = createHash("sha256").update(data).digest("hex");
  if (actual !== expected) {
    fail(`checksum mismatch for ${asset}\n  expected ${expected}\n  actual   ${actual}`);
  }
}

/** Ensure the matching binary is cached and return its path, downloading once. */
async function ensureBinary() {
  const version = resolveVersion();
  const asset = detectAsset();
  const dir = cacheDir(version);
  const binPath = join(dir, asset);
  if (existsSync(binPath)) return binPath;

  const base = `https://github.com/${REPO}/releases/download/v${version}`;
  process.stderr.write(`rauf: fetching ${asset} (v${version})…\n`);
  const data = await fetchBuffer(`${base}/${asset}`);
  verifyChecksum(data, asset, await fetchTextOrNull(`${base}/SHA256SUMS`));

  mkdirSync(dir, { recursive: true });
  // Write to a unique temp name then rename, so concurrent invocations and
  // interrupted downloads never leave a partial binary at binPath.
  const tmp = join(dir, `.${asset}.tmp-${process.pid}`);
  writeFileSync(tmp, data);
  if (process.platform !== "win32") chmodSync(tmp, 0o755);
  renameSync(tmp, binPath);
  return binPath;
}

const binPath = await ensureBinary();
const result = spawnSync(binPath, process.argv.slice(2), { stdio: "inherit" });
if (result.error) fail(result.error.message);
if (result.signal) {
  // Re-raise the terminating signal so the parent's exit reflects it.
  process.kill(process.pid, result.signal);
} else {
  process.exit(result.status ?? 0);
}
