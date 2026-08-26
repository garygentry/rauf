import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  COPILOT_REPOSITORY_ARTIFACTS,
  NPM_LAUNCHER_FILES,
  checkCopilotDistribution,
} from "./check-copilot-distribution";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function write(root: string, relative: string, content: string): void {
  const absolute = path.join(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
}

/** A minimal repository that satisfies every distribution contract at `version`. */
function makeFixture(version = "1.2.3"): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rauf-copilot-dist-"));
  temporaryDirectories.push(root);
  for (const relative of COPILOT_REPOSITORY_ARTIFACTS) write(root, relative, "x\n");
  write(root, "adapters/copilot/plugin.json", JSON.stringify({ name: "rauf", version }));
  write(
    root,
    "packages/loop/dist/providers/copilot-cli.js",
    'export const COPILOT_AGENT_ID = "copilot";\n',
  );
  write(
    root,
    "packages/core/dist/embedded-artifacts.js",
    '"AGENTS_ADDON.md"; ".rauf/RAUF.md.tmpl"; "<!-- rauf:managed:start -->";\n',
  );
  write(
    root,
    "npm-dist/package.json",
    JSON.stringify({
      version,
      files: NPM_LAUNCHER_FILES.filter((file) => file !== "package.json"),
    }),
  );
  write(root, "npm-dist/LICENSE", "MIT\n");
  write(root, "npm-dist/README.md", "# rauf\n");
  write(
    root,
    "npm-dist/rauf.mjs",
    'const pkg = readFileSync(join(HERE, "package.json"));\n' +
      "const base = `https://github.com/x/releases/download/v${version}`;\n",
  );
  write(root, "npm-dist/adapters/pi/skills/a/SKILL.md", "x\n");
  return root;
}

describe("checkCopilotDistribution", () => {
  it("passes on a complete, version-locked fixture", () => {
    expect(() => checkCopilotDistribution(makeFixture(), "1.2.3")).not.toThrow();
  });

  it("fails on a stale Copilot plugin version", () => {
    const root = makeFixture();
    write(root, "adapters/copilot/plugin.json", JSON.stringify({ version: "9.9.9" }));
    expect(() => checkCopilotDistribution(root, "1.2.3")).toThrow(
      "adapters/copilot/plugin.json version 9.9.9 != 1.2.3",
    );
  });

  it("fails when a generated Copilot artifact is missing", () => {
    const root = makeFixture();
    fs.rmSync(path.join(root, "adapters/copilot/agents/rauf-loop-driver.agent.md"));
    expect(() => checkCopilotDistribution(root, "1.2.3")).toThrow(
      "repository artifact missing: adapters/copilot/agents/rauf-loop-driver.agent.md",
    );
  });

  it("fails when the built loop lacks the dedicated provider", () => {
    const root = makeFixture();
    write(root, "packages/loop/dist/providers/copilot-cli.js", "export {};\n");
    expect(() => checkCopilotDistribution(root, "1.2.3")).toThrow("dedicated Copilot provider");
  });

  it("fails when built core lacks an embedded instruction marker", () => {
    const root = makeFixture();
    write(root, "packages/core/dist/embedded-artifacts.js", '"AGENTS_ADDON.md";\n');
    expect(() => checkCopilotDistribution(root, "1.2.3")).toThrow(
      "missing embedded marker: .rauf/RAUF.md.tmpl",
    );
  });

  it("fails when the Copilot plugin leaks into the npm launcher", () => {
    const root = makeFixture();
    write(root, "npm-dist/adapters/copilot/plugin.json", "{}");
    expect(() => checkCopilotDistribution(root, "1.2.3")).toThrow(
      "npm-dist/adapters must contain only pi, found: copilot, pi",
    );
  });

  it("fails when the npm files allowlist widens", () => {
    const root = makeFixture();
    write(
      root,
      "npm-dist/package.json",
      JSON.stringify({ version: "1.2.3", files: ["rauf.mjs", "README.md", "LICENSE", "adapters"] }),
    );
    expect(() => checkCopilotDistribution(root, "1.2.3")).toThrow("npm files allowlist changed");
  });

  it("fails on a non-lockstep npm launcher version", () => {
    const root = makeFixture();
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "npm-dist/package.json"), "utf-8"));
    write(root, "npm-dist/package.json", JSON.stringify({ ...pkg, version: "0.0.1" }));
    expect(() => checkCopilotDistribution(root, "1.2.3")).toThrow("not lockstep");
  });
});
