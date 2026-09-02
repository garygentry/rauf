import { describe, expect, it } from "vitest";

import { INTERACTION_ENV, resolveChildEnv, REVIEW_HOOK_SUPPRESSION_ENV } from "./review-hooks.js";

describe("resolveChildEnv", () => {
  it("always stamps the interaction contract, even with nothing else opted in", () => {
    // Every loop child is spawned with a `nonInteractive` argv, so this is a
    // fact the runner knows and the agent inside cannot observe. It is not an
    // opt-in.
    expect(resolveChildEnv({})).toEqual(INTERACTION_ENV);
    expect(resolveChildEnv({ suppressIterationReview: false })).toEqual(INTERACTION_ENV);
    expect(resolveChildEnv({ childEnv: {} })).toEqual(INTERACTION_ENV);
  });

  it("returns the suppression set plus the stamp when suppressIterationReview is true", () => {
    const env = resolveChildEnv({ suppressIterationReview: true });
    expect(env).toEqual({ ...INTERACTION_ENV, ...REVIEW_HOOK_SUPPRESSION_ENV });
  });

  it("passes through generic childEnv overrides without suppression", () => {
    const env = resolveChildEnv({ childEnv: { MY_HOOK_OFF: "1" } });
    expect(env).toEqual({ ...INTERACTION_ENV, MY_HOOK_OFF: "1" });
  });

  it("lets a caller override the interaction stamp for an attended child", () => {
    const env = resolveChildEnv({ childEnv: { FORGE_INTERACTION: "interactive" } });
    expect(env?.FORGE_INTERACTION).toBe("interactive");
  });

  it("names the stamp so no sandbox env filter strips it", () => {
    // Agent sandboxes drop variables whose NAME matches KEY/SECRET/TOKEN
    // patterns before a tool call sees them; a filtered stamp reads as unknown,
    // which silently returns the agent to guessing.
    for (const name of Object.keys(INTERACTION_ENV)) {
      expect(name).not.toMatch(/KEY|SECRET|TOKEN/i);
    }
    expect(INTERACTION_ENV.FORGE_INTERACTION).toBe("non-interactive");
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
