import { describe, it, expect, vi } from "vitest";

import {
  resolveAgentId,
  normalizeAgentAlias,
  DEFAULT_AGENT_ID,
  GENERIC_AGENT_ID,
} from "./agent-selection.js";

describe("resolveAgentId — precedence matrix (04 §3.1)", () => {
  // Rows from the 04 §3.1 precedence matrix.
  it("row 1 — all four layers set → itemProvider wins (REQ-SEL-04)", () => {
    expect(
      resolveAgentId({
        itemProvider: "codex",
        runProvider: "gemini",
        projectProvider: "cursor",
        globalProvider: "copilot",
      }),
    ).toBe("codex");
  });

  it("row 2 — item unset → runProvider", () => {
    expect(
      resolveAgentId({
        runProvider: "gemini",
        projectProvider: "cursor",
        globalProvider: "copilot",
      }),
    ).toBe("gemini");
  });

  it("row 3 — only project/global set → projectProvider", () => {
    expect(resolveAgentId({ projectProvider: "cursor", globalProvider: "copilot" })).toBe("cursor");
  });

  it("row 4 — only global set → globalProvider", () => {
    expect(resolveAgentId({ globalProvider: "copilot" })).toBe("copilot");
  });

  it("row 5 (keystone) — no layer set → DEFAULT_AGENT_ID (REQ-SEL-03)", () => {
    // Keystone: compare against the imported constant, not a literal.
    expect(resolveAgentId({})).toBe(DEFAULT_AGENT_ID);
  });

  it("row 6 — item + global → item beats global", () => {
    expect(resolveAgentId({ itemProvider: "codex", globalProvider: "copilot" })).toBe("codex");
  });

  it("row 7 — run + global → run beats global", () => {
    expect(resolveAgentId({ runProvider: "gemini", globalProvider: "copilot" })).toBe("gemini");
  });

  it("row 8 — whitespace item is skipped → runProvider (defensive)", () => {
    expect(resolveAgentId({ itemProvider: "   ", runProvider: "gemini" })).toBe("gemini");
  });

  it("row 9 — all layers equal → idempotent", () => {
    expect(
      resolveAgentId({
        itemProvider: "cursor",
        runProvider: "cursor",
        projectProvider: "cursor",
        globalProvider: "cursor",
      }),
    ).toBe("cursor");
  });

  it("preserves the existing copilot id at item, project, and global layers", () => {
    expect(resolveAgentId({ itemProvider: "copilot" })).toBe("copilot");
    expect(resolveAgentId({ projectProvider: "copilot" })).toBe("copilot");
    expect(resolveAgentId({ globalProvider: "copilot" })).toBe("copilot");
  });

  it("empty-string layers are skipped at every position", () => {
    expect(resolveAgentId({ itemProvider: "" })).toBe(DEFAULT_AGENT_ID);
    expect(resolveAgentId({ itemProvider: "", runProvider: "", projectProvider: "codex" })).toBe(
      "codex",
    );
  });

  it("totality — returns a non-empty string for a representative sweep and never throws", () => {
    const opts = [undefined, "", "   ", "codex"];
    for (const itemProvider of opts) {
      for (const runProvider of opts) {
        for (const projectProvider of opts) {
          for (const globalProvider of opts) {
            const out = resolveAgentId({
              itemProvider,
              runProvider,
              projectProvider,
              globalProvider,
            });
            expect(typeof out).toBe("string");
            expect(out.length).toBeGreaterThan(0);
          }
        }
      }
    }
  });
});

describe("normalizeAgentAlias (04 §3.2)", () => {
  it("folds agent → provider when only the alias is present", () => {
    const out = normalizeAgentAlias({ agent: "codex" });
    expect(out).toEqual({ provider: "codex" });
    expect("agent" in out).toBe(false);
  });

  it("passes through unchanged when only provider is present (no warning)", () => {
    const onWarn = vi.fn();
    const out = normalizeAgentAlias({ provider: "codex" }, onWarn);
    expect(out).toEqual({ provider: "codex" });
    expect(onWarn).not.toHaveBeenCalled();
  });

  it("passes through unchanged when neither key is present (additive)", () => {
    const onWarn = vi.fn();
    const out = normalizeAgentAlias({ title: "x" } as { title: string; provider?: string }, onWarn);
    expect(out).toEqual({ title: "x" });
    expect("agent" in out).toBe(false);
    expect("provider" in out).toBe(false);
    expect(onWarn).not.toHaveBeenCalled();
  });

  it("provider wins and onWarn is called once when both are set", () => {
    const onWarn = vi.fn();
    const out = normalizeAgentAlias({ provider: "codex", agent: "gemini" }, onWarn);
    expect(out).toEqual({ provider: "codex" });
    expect("agent" in out).toBe(false);
    expect(onWarn).toHaveBeenCalledTimes(1);
  });

  it("output never contains an `agent` key", () => {
    expect("agent" in normalizeAgentAlias({ agent: "codex" })).toBe(false);
    expect("agent" in normalizeAgentAlias({ provider: "p", agent: "a" })).toBe(false);
  });
});

describe("constant re-exports (04 §4)", () => {
  it("re-exports DEFAULT_AGENT_ID and GENERIC_AGENT_ID from constants", () => {
    expect(DEFAULT_AGENT_ID).toBe("claude-cli");
    expect(GENERIC_AGENT_ID).toBe("generic-cli");
  });
});
