import { describe, it, expect } from "vitest";

import { classifyChannel, detectRuntimeChannel } from "./runtime-channel";

const NPM_CACHE = "/home/user/.cache/rauf/bin";

describe("classifyChannel", () => {
  it("reports source when there is no compile-time stamp", () => {
    // A source run (`bun run index.ts`) never sees the RAUF_BUILD_CHANNEL define.
    expect(classifyChannel("", "/home/user/.bun/bin/bun", NPM_CACHE)).toBe("source");
  });

  it("reports npm-launcher for a stamped binary running out of the npm cache", () => {
    const cached = "/home/user/.cache/rauf/bin/0.15.0/rauf-linux-x64";
    // The npm cache always holds release binaries, but the launcher is the
    // operative channel regardless of the stamp.
    expect(classifyChannel("release-binary", cached, NPM_CACHE)).toBe("npm-launcher");
    expect(classifyChannel("compiled-local", cached, NPM_CACHE)).toBe("npm-launcher");
  });

  it("reports release-binary for a stamped release binary outside the cache", () => {
    expect(classifyChannel("release-binary", "/home/user/.local/bin/rauf", NPM_CACHE)).toBe(
      "release-binary",
    );
  });

  it("reports compiled-local for a locally-compiled snapshot", () => {
    expect(classifyChannel("compiled-local", "/home/user/.local/bin/rauf-stable", NPM_CACHE)).toBe(
      "compiled-local",
    );
  });

  it("reports unknown for an unrecognized stamp value", () => {
    expect(classifyChannel("bogus", "/home/user/.local/bin/rauf", NPM_CACHE)).toBe("unknown");
  });

  it("does not treat a sibling path that merely shares a prefix as cached", () => {
    // ".../rauf/bin-old/..." must not match ".../rauf/bin".
    expect(
      classifyChannel("release-binary", "/home/user/.cache/rauf/bin-old/rauf", NPM_CACHE),
    ).toBe("release-binary");
  });
});

describe("detectRuntimeChannel", () => {
  it("classifies the test runner (no define) as source with a string path", () => {
    const rt = detectRuntimeChannel();
    expect(rt.channel).toBe("source");
    expect(typeof rt.path).toBe("string");
    // distStale is best-effort — either a boolean or omitted, never throwing.
    if (rt.distStale !== undefined) expect(typeof rt.distStale).toBe("boolean");
  });
});
