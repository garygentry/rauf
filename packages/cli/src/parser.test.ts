import { describe, it, expect } from "vitest";
import {
  parseArgs,
  extractBoolFlag,
  extractStringFlag,
  extractNumberFlag,
  extractRepeatableFlag,
} from "./parser.js";

describe("parseArgs", () => {
  describe("command parsing", () => {
    it("returns null command for empty args", () => {
      const result = parseArgs([]);
      expect(result.command).toBeNull();
      expect(result.subcommand).toBeNull();
      expect(result.args).toEqual([]);
    });

    it("parses single command", () => {
      const result = parseArgs(["version"]);
      expect(result.command).toBe("version");
      expect(result.subcommand).toBeNull();
      expect(result.args).toEqual([]);
    });

    it("treats second positional as arg when no subcommandNames provided", () => {
      const result = parseArgs(["backlog", "list"]);
      expect(result.command).toBe("backlog");
      expect(result.subcommand).toBeNull();
      expect(result.args).toEqual(["list"]);
    });

    it("parses subcommand when subcommandNames provided", () => {
      const subs = new Set(["list", "add", "edit"]);
      const result = parseArgs(["backlog", "list"], subs);
      expect(result.command).toBe("backlog");
      expect(result.subcommand).toBe("list");
      expect(result.args).toEqual([]);
    });

    it("does not treat unknown second positional as subcommand", () => {
      const subs = new Set(["list", "add"]);
      const result = parseArgs(["backlog", "unknown"], subs);
      expect(result.command).toBe("backlog");
      expect(result.subcommand).toBeNull();
      expect(result.args).toEqual(["unknown"]);
    });

    it("parses command + subcommand + positional args", () => {
      const subs = new Set(["list", "show"]);
      const result = parseArgs(["backlog", "show", "001"], subs);
      expect(result.command).toBe("backlog");
      expect(result.subcommand).toBe("show");
      expect(result.args).toEqual(["001"]);
    });

    it("collects multiple positional args", () => {
      const result = parseArgs(["install", "/foo", "/bar"]);
      expect(result.command).toBe("install");
      expect(result.args).toEqual(["/foo", "/bar"]);
    });
  });

  describe("global flags", () => {
    it("extracts --json", () => {
      const result = parseArgs(["--json", "version"]);
      expect(result.globalFlags.json).toBe(true);
      expect(result.command).toBe("version");
    });

    it("extracts --no-color", () => {
      const result = parseArgs(["version", "--no-color"]);
      expect(result.globalFlags.noColor).toBe(true);
      expect(result.command).toBe("version");
    });

    it("extracts --quiet", () => {
      const result = parseArgs(["--quiet", "status", "."]);
      expect(result.globalFlags.quiet).toBe(true);
      expect(result.command).toBe("status");
    });

    it("extracts -q shorthand", () => {
      const result = parseArgs(["-q", "version"]);
      expect(result.globalFlags.quiet).toBe(true);
    });

    it("extracts --root with value", () => {
      const result = parseArgs(["--root", "/home/user/projects", "status"]);
      expect(result.globalFlags.root).toBe("/home/user/projects");
      expect(result.command).toBe("status");
    });

    it("handles --root at end without value", () => {
      const result = parseArgs(["version", "--root"]);
      expect(result.globalFlags.root).toBeNull();
    });

    it("handles multiple global flags", () => {
      const result = parseArgs(["--json", "--no-color", "-q", "version"]);
      expect(result.globalFlags.json).toBe(true);
      expect(result.globalFlags.noColor).toBe(true);
      expect(result.globalFlags.quiet).toBe(true);
    });

    it("defaults all global flags to false/null", () => {
      const result = parseArgs(["version"]);
      expect(result.globalFlags.json).toBe(false);
      expect(result.globalFlags.noColor).toBe(false);
      expect(result.globalFlags.quiet).toBe(false);
      expect(result.globalFlags.root).toBeNull();
    });

    it("allows global flags after command", () => {
      const result = parseArgs(["status", ".", "--json"]);
      expect(result.globalFlags.json).toBe(true);
      expect(result.command).toBe("status");
      expect(result.args).toEqual(["."]);
    });

    it("allows global flags interspersed", () => {
      const subs = new Set(["list"]);
      const result = parseArgs(
        ["--json", "backlog", "--no-color", "list", "."],
        subs,
      );
      expect(result.globalFlags.json).toBe(true);
      expect(result.globalFlags.noColor).toBe(true);
      expect(result.command).toBe("backlog");
      expect(result.subcommand).toBe("list");
      expect(result.args).toEqual(["."]);
    });
  });

  describe("command-level flags", () => {
    it("parses --flag as boolean", () => {
      const result = parseArgs(["install", ".", "--yes"]);
      expect(result.flags.get("yes")).toBe(true);
    });

    it("parses --flag value", () => {
      const result = parseArgs(["backlog", "add", "--title", "Fix bug"]);
      expect(result.flags.get("title")).toBe("Fix bug");
    });

    it("parses --flag=value", () => {
      const result = parseArgs(["config", "set", "--key=rootDir"]);
      expect(result.flags.get("key")).toBe("rootDir");
    });

    it("parses --flag=value with equals in value", () => {
      const result = parseArgs(["config", "set", "--value=a=b"]);
      expect(result.flags.get("value")).toBe("a=b");
    });

    it("treats next token starting with -- as separate flag", () => {
      const result = parseArgs(["install", "--yes", "--force"]);
      expect(result.flags.get("yes")).toBe(true);
      expect(result.flags.get("force")).toBe(true);
    });

    it("collects unknown short flags", () => {
      const result = parseArgs(["version", "-v"]);
      expect(result.flags.get("v")).toBe(true);
    });

    it("does not confuse global flags with command flags", () => {
      const result = parseArgs(["status", "--json", "--verbose"]);
      expect(result.globalFlags.json).toBe(true);
      expect(result.flags.has("json")).toBe(false);
      expect(result.flags.get("verbose")).toBe(true);
    });
  });

  describe("-- separator", () => {
    it("treats everything after -- as positional", () => {
      const result = parseArgs(["install", "--", "--weird-path"]);
      expect(result.args).toEqual(["--weird-path"]);
      expect(result.flags.size).toBe(0);
    });

    it("handles -- with no remaining args", () => {
      const result = parseArgs(["version", "--"]);
      expect(result.command).toBe("version");
      expect(result.args).toEqual([]);
    });

    it("treats flags after -- as positional", () => {
      const result = parseArgs(["install", "--", "--json", "--no-color"]);
      expect(result.args).toEqual(["--json", "--no-color"]);
      expect(result.globalFlags.json).toBe(false);
    });
  });
});

describe("extractBoolFlag", () => {
  it("returns true and removes flag when present", () => {
    const flags = new Map<string, string | true>([["yes", true]]);
    expect(extractBoolFlag(flags, "yes")).toBe(true);
    expect(flags.has("yes")).toBe(false);
  });

  it("returns false when flag absent", () => {
    const flags = new Map<string, string | true>();
    expect(extractBoolFlag(flags, "yes")).toBe(false);
  });

  it("returns true even if flag has string value", () => {
    const flags = new Map<string, string | true>([["yes", "value"]]);
    expect(extractBoolFlag(flags, "yes")).toBe(true);
    expect(flags.has("yes")).toBe(false);
  });
});

describe("extractStringFlag", () => {
  it("returns value and removes flag when present", () => {
    const flags = new Map<string, string | true>([["title", "Fix bug"]]);
    expect(extractStringFlag(flags, "title")).toBe("Fix bug");
    expect(flags.has("title")).toBe(false);
  });

  it("returns null when flag absent", () => {
    const flags = new Map<string, string | true>();
    expect(extractStringFlag(flags, "title")).toBeNull();
  });

  it("returns null when flag is boolean (no value)", () => {
    const flags = new Map<string, string | true>([["title", true]]);
    expect(extractStringFlag(flags, "title")).toBeNull();
  });
});

describe("extractNumberFlag", () => {
  it("returns number when valid", () => {
    const flags = new Map<string, string | true>([["tail", "50"]]);
    expect(extractNumberFlag(flags, "tail")).toBe(50);
    expect(flags.has("tail")).toBe(false);
  });

  it("returns null for non-numeric string", () => {
    const flags = new Map<string, string | true>([["tail", "abc"]]);
    expect(extractNumberFlag(flags, "tail")).toBeNull();
  });

  it("returns null when flag absent", () => {
    const flags = new Map<string, string | true>();
    expect(extractNumberFlag(flags, "tail")).toBeNull();
  });

  it("returns null when flag is boolean", () => {
    const flags = new Map<string, string | true>([["tail", true]]);
    expect(extractNumberFlag(flags, "tail")).toBeNull();
  });

  it("handles floating point numbers", () => {
    const flags = new Map<string, string | true>([["val", "3.14"]]);
    expect(extractNumberFlag(flags, "val")).toBe(3.14);
  });

  it("returns null for Infinity", () => {
    const flags = new Map<string, string | true>([["val", "Infinity"]]);
    expect(extractNumberFlag(flags, "val")).toBeNull();
  });
});

describe("extractRepeatableFlag", () => {
  it("extracts multiple values for repeated flag", () => {
    const argv = [
      "backlog",
      "add",
      "--ac",
      "Tests pass",
      "--ac",
      "Linting passes",
    ];
    expect(extractRepeatableFlag(argv, "ac")).toEqual([
      "Tests pass",
      "Linting passes",
    ]);
  });

  it("returns empty array when flag not present", () => {
    const argv = ["backlog", "add", "--title", "Fix bug"];
    expect(extractRepeatableFlag(argv, "ac")).toEqual([]);
  });

  it("handles single occurrence", () => {
    const argv = ["backlog", "add", "--ac", "Tests pass"];
    expect(extractRepeatableFlag(argv, "ac")).toEqual(["Tests pass"]);
  });

  it("skips flag at end without value", () => {
    const argv = ["backlog", "add", "--ac"];
    expect(extractRepeatableFlag(argv, "ac")).toEqual([]);
  });

  it("skips flag where next token is a flag", () => {
    const argv = ["backlog", "add", "--ac", "--title", "Fix"];
    expect(extractRepeatableFlag(argv, "ac")).toEqual([]);
  });

  it("works with -- prefix in flagName", () => {
    const argv = ["backlog", "add", "--ac", "One", "--ac", "Two"];
    expect(extractRepeatableFlag(argv, "--ac")).toEqual(["One", "Two"]);
  });
});
