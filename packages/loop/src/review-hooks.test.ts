import { describe, expect, it } from "vitest";

import { resolveChildEnv, REVIEW_HOOK_SUPPRESSION_ENV } from "./review-hooks.js";

describe("resolveChildEnv", () => {
  it("returns undefined when nothing is opted in (default behavior preserved)", () => {
    expect(resolveChildEnv({})).toBeUndefined();
    expect(resolveChildEnv({ suppressIterationReview: false })).toBeUndefined();
    expect(resolveChildEnv({ childEnv: {} })).toBeUndefined();
  });

  it("returns the suppression set when suppressIterationReview is true", () => {
    const env = resolveChildEnv({ suppressIterationReview: true });
    expect(env).toEqual(REVIEW_HOOK_SUPPRESSION_ENV);
  });

  it("passes through generic childEnv overrides without suppression", () => {
    const env = resolveChildEnv({ childEnv: { MY_HOOK_OFF: "1" } });
    expect(env).toEqual({ MY_HOOK_OFF: "1" });
  });

  it("merges suppression set with generic childEnv (childEnv wins)", () => {
    const overrideKey = Object.keys(REVIEW_HOOK_SUPPRESSION_ENV)[0]!;
    const env = resolveChildEnv({
      suppressIterationReview: true,
      childEnv: { [overrideKey]: "custom", EXTRA: "2" },
    });
    expect(env?.[overrideKey]).toBe("custom");
    expect(env?.EXTRA).toBe("2");
  });

  it("REVIEW_HOOK_SUPPRESSION_ENV includes the security-review opt-out and is not plugin-locked", () => {
    // Documented entry for the known security-review hook, but the map is the
    // generic extension point — callers can add more via childEnv.
    expect(REVIEW_HOOK_SUPPRESSION_ENV.ENABLE_CODE_SECURITY_REVIEW).toBe("0");
  });
});
