import { describe, expect, it } from "vitest";

import { CopilotCliProvider } from "./copilot-cli.js";
import { createProvider, getAgentDescriptors } from "./index.js";
import { getPresetConfig } from "./presets.js";

describe("default provider registry", () => {
  it("registers exactly one dedicated copilot provider under the stable id", () => {
    const copilotDescriptors = getAgentDescriptors().filter(({ id }) => id === "copilot");

    expect(copilotDescriptors).toHaveLength(1);
    expect(copilotDescriptors[0]).toMatchObject({
      id: "copilot",
      displayName: "GitHub Copilot CLI",
      binaryName: "copilot",
    });
    expect(createProvider("copilot")).toBeInstanceOf(CopilotCliProvider);
    expect(getPresetConfig("copilot")).toBeUndefined();
  });
});
