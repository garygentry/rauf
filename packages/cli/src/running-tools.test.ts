import { describe, expect, it } from "vitest";

import { RunningTools } from "./running-tools.js";

describe("RunningTools (#141)", () => {
  it("keeps showing a still-running call when a parallel one ends", () => {
    const t = new RunningTools();
    t.start("Bash", "gate");
    t.start("Bash", "ls");
    expect(t.current()).toBe("Bash");
    t.end("Bash", "ls");
    expect(t.current()).toBe("Bash");
    t.end("Bash", "gate");
    expect(t.current()).toBeNull();
  });

  it("falls back to the parent Task when a nested call ends", () => {
    const t = new RunningTools();
    t.start("Task", "task");
    t.start("Grep", "nested");
    expect(t.current()).toBe("Grep");
    t.end("Grep", "nested");
    expect(t.current()).toBe("Task");
  });

  it("shows the most recently started call, whatever order they end in", () => {
    const t = new RunningTools();
    t.start("Read", "a");
    t.start("Edit", "b");
    t.start("Glob", "c");
    t.end("Read", "a");
    expect(t.current()).toBe("Glob");
    t.end("Glob", "c");
    expect(t.current()).toBe("Edit");
  });

  it("pairs id-less events by name (older runners / agents without ids)", () => {
    const t = new RunningTools();
    t.start("Read");
    t.start("Bash");
    t.end("Read");
    expect(t.current()).toBe("Bash");
    t.end("unknown"); // pre-#141 end events carried no tool name
    expect(t.current()).toBeNull();
  });

  it("ignores an end with no matching start, and clears", () => {
    const t = new RunningTools();
    t.start("Bash", "x");
    t.end("Bash", "never-started");
    expect(t.current()).toBe("Bash");
    t.clear();
    expect(t.current()).toBeNull();
  });
});
