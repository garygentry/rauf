import { describe, it, expect } from "vitest";
import {
  hasSandboxDenialSignature,
  annotateCodexSandboxHint,
} from "./codex-sandbox-diagnostics.js";

describe("hasSandboxDenialSignature", () => {
  it.each([
    "curl: (6) Could not resolve host: registry.npmjs.org",
    "getaddrinfo ENOTFOUND registry.npmjs.org",
    "connect ENETUNREACH 1.2.3.4:443",
    "connect ETIMEDOUT 1.2.3.4:443",
    "Network is unreachable",
    "spawnSync node EPERM",
    "spawnSync grep EPERM",
    "spawn ts-json-schema-generator operation not permitted",
  ])("matches %s", (text) => {
    expect(hasSandboxDenialSignature(text)).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(hasSandboxDenialSignature("COULD NOT RESOLVE HOST")).toBe(true);
    expect(hasSandboxDenialSignature("SPAWNSYNC NODE EPERM")).toBe(true);
  });

  it.each([
    "pnpm install completed successfully",
    "TypeError: Cannot read properties of undefined",
    "AssertionError: expected 1 to equal 2",
    // EPERM/"operation not permitted" alone, with no subprocess-spawn context, is too generic
    // to attribute to Codex's sandbox — a locked file or host ACL can produce the same text.
    "Error: EACCES: permission denied, open '/etc/shadow'",
    "chmod: changing permissions of 'foo.sh': Operation not permitted",
  ])("does not match unrelated text: %s", (text) => {
    expect(hasSandboxDenialSignature(text)).toBe(false);
  });
});

describe("annotateCodexSandboxHint", () => {
  it("appends the hint when the combined output matches a denial signature", () => {
    const reason = "registry.npmjs.org is unreachable, preventing pinned pnpm download";
    const annotated = annotateCodexSandboxHint(
      reason,
      "curl: (6) Could not resolve host: registry.npmjs.org",
    );
    expect(annotated).toContain(reason);
    expect(annotated).toContain("Codex's sandbox policy");
    expect(annotated).toContain("providerConfig");
  });

  it("leaves the reason unchanged when there is no denial signature", () => {
    const reason = "the acceptance test expects a different output shape";
    expect(annotateCodexSandboxHint(reason, "AssertionError: expected 1 to equal 2")).toBe(reason);
  });
});
