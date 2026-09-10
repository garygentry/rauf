// ─── rauf runtime channel detection ─────────────────────────────
//
// `rauf version --json` reports WHICH binary is running, so a fleet can tell how
// a host was provisioned (gnet-lg ADR 0028 client-deployment model). The four
// channels rauf ships as:
//
//   npm-launcher   — the @garygentry/rauf npm shim (npm-dist/rauf.mjs) exec'd a
//                    cached release binary from ~/.cache/rauf/bin/<version>/.
//   release-binary — a release binary installed by scripts/install-binary.sh.
//   compiled-local — a `pnpm compile` / `pnpm dogfood:runner` local snapshot.
//   source         — scripts/bin/rauf → `bun run packages/cli/src/index.ts`.
//
// `npm-launcher` and `source` are detectable at runtime; `release-binary` and
// `compiled-local` are byte-identical `bun build --compile` artifacts and cannot
// be told apart from the binary alone, so the build stamps `RAUF_BUILD_CHANNEL`
// via `bun build --define` (release.yml → "release-binary"; the local `compile`
// script → "compiled-local"). Source runs never see the define.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { VERSION } from "@rauf/core";

// Injected by `bun build --define RAUF_BUILD_CHANNEL='"…"'` at compile time.
// In a source run (`bun run`) the identifier is undeclared, and `typeof` on an
// undeclared name is safely "undefined" (never a ReferenceError), which is how
// we distinguish a compiled binary from source.
declare const RAUF_BUILD_CHANNEL: string;

export type RaufChannel =
  | "npm-launcher"
  | "release-binary"
  | "compiled-local"
  | "source"
  | "unknown";

export interface RuntimeChannel {
  /** How this binary reached the host. */
  channel: RaufChannel;
  /** Absolute path of the running binary (or the source entry, under bun). */
  path: string;
  /**
   * Source channel only: true when the running version (compiled from
   * packages/core/dist) differs from packages/core/src/version.ts — i.e. the
   * dist is stale and `rauf version` is under-reporting. Omitted otherwise.
   */
  distStale?: boolean;
}

/**
 * Root the npm launcher caches release binaries under. Mirrors `cacheDir()` in
 * npm-dist/rauf.mjs; the binary inherits the launcher's env, so recomputing the
 * base here yields the same directory.
 */
function npmCacheRoot(): string {
  const base =
    process.env.RAUF_CACHE_DIR ||
    process.env.XDG_CACHE_HOME ||
    (os.homedir() ? path.join(os.homedir(), ".cache") : os.tmpdir());
  return path.join(base, "rauf", "bin");
}

/** True when `p` resolves inside `root`. */
function isUnder(root: string, p: string): boolean {
  const rel = path.relative(root, p);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Pure channel classifier — the runtime signals in, the channel out. Separated
 * from process/filesystem access so every branch is unit-testable.
 *
 * @param buildChannel  the `RAUF_BUILD_CHANNEL` define ("" in a source run)
 * @param execPath      process.execPath (the compiled binary, when compiled)
 * @param npmCache      npm-launcher cache root (npmCacheRoot())
 */
export function classifyChannel(
  buildChannel: string,
  execPath: string,
  npmCache: string,
): RaufChannel {
  // No compile-time stamp → not a `bun build --compile` artifact → source run.
  if (!buildChannel) return "source";
  // A stamped binary running out of the npm cache was exec'd by the launcher.
  if (isUnder(npmCache, execPath)) return "npm-launcher";
  if (buildChannel === "release-binary" || buildChannel === "compiled-local") {
    return buildChannel;
  }
  return "unknown";
}

/**
 * Source channel only: compare the running (dist-compiled) VERSION against
 * packages/core/src/version.ts. Best-effort — any read/parse failure returns
 * undefined so the field is simply omitted rather than guessed.
 */
function detectDistStale(): boolean | undefined {
  try {
    // In a source run this module executes from packages/cli/src/, so core's
    // canonical version source is a sibling package.
    const srcVersionPath = path.join(import.meta.dirname, "..", "..", "core", "src", "version.ts");
    const text = fs.readFileSync(srcVersionPath, "utf-8");
    const m = text.match(/VERSION\s*=\s*"([^"]+)"/);
    if (!m || m[1] === undefined) return undefined;
    return m[1] !== VERSION;
  } catch {
    return undefined;
  }
}

/** Determine how the running rauf binary reached this host. */
export function detectRuntimeChannel(): RuntimeChannel {
  const buildChannel = typeof RAUF_BUILD_CHANNEL !== "undefined" ? RAUF_BUILD_CHANNEL : "";
  // For a `bun build --compile` standalone, process.execPath is the on-disk path
  // of the executable (it is import.meta.url that carries the /$bunfs/ virtual
  // path, not execPath) — verified end-to-end: a compiled binary run from a
  // simulated npm cache reports channel=npm-launcher with its real cache path.
  const channel = classifyChannel(buildChannel, process.execPath, npmCacheRoot());

  if (channel === "source") {
    // In a source run, process.execPath is the bun binary; argv[1] is the entry.
    const entry = process.argv[1] || process.execPath;
    const stale = detectDistStale();
    return stale === undefined
      ? { channel, path: entry }
      : { channel, path: entry, distStale: stale };
  }
  // Compiled binary: process.execPath is the binary itself.
  return { channel, path: process.execPath };
}
