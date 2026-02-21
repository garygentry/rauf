import * as fs from "node:fs";
import * as path from "node:path";

import { type Result, err, ErrorCodes } from "./errors.js";
import { atomicWrite } from "./fs-utils.js";

// ─── renderTemplate ──────────────────────────────────────────────
//
// Replace all {{variableName}} occurrences in a template string.
// - Known variables with non-null values are replaced.
// - Null/undefined values are replaced with empty string.
// - Unknown variables (not present in the variables map) are left as-is.

export function renderTemplate(
  templateContent: string,
  variables: Record<string, string | null | undefined>,
): string {
  return templateContent.replace(/\{\{(\w+)\}\}/g, (match, varName: string) => {
    if (!(varName in variables)) {
      return match; // Unknown variable — leave as-is
    }
    const value = variables[varName];
    return value == null ? "" : value;
  });
}

// ─── renderTemplateFile ──────────────────────────────────────────
//
// Read a template file, render it with the provided variables,
// and write the result atomically to the output path.

export function renderTemplateFile(
  templatePath: string,
  outputPath: string,
  variables: Record<string, string | null | undefined>,
): Result<void> {
  const resolvedTemplate = path.resolve(templatePath);

  // Read template
  let templateContent: string;
  try {
    templateContent = fs.readFileSync(resolvedTemplate, "utf-8");
  } catch (e) {
    return err({
      code: ErrorCodes.FILE_NOT_FOUND,
      message: `Template file not found: ${resolvedTemplate}`,
      details: {
        path: resolvedTemplate,
        cause: e instanceof Error ? e.message : String(e),
      },
    });
  }

  // Render and write atomically
  const rendered = renderTemplate(templateContent, variables);
  return atomicWrite(outputPath, rendered);
}

// ─── updateSentinelBlock ─────────────────────────────────────────
//
// Find content between sentinelStart and sentinelEnd markers in
// the given file content. Replace it with newBlockContent.
// If sentinels are not found, append the full block (with sentinels).
// Everything outside the sentinels is preserved exactly.

export function updateSentinelBlock(
  fileContent: string,
  sentinelStart: string,
  sentinelEnd: string,
  newBlockContent: string,
): string {
  const startIdx = fileContent.indexOf(sentinelStart);
  const endIdx = fileContent.indexOf(sentinelEnd);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    // Sentinels not found (or malformed) — append the block
    const separator = fileContent.length > 0 && !fileContent.endsWith("\n") ? "\n" : "";
    const trailingNewline = fileContent.length > 0 ? "\n" : "";
    return (
      fileContent +
      separator +
      trailingNewline +
      sentinelStart +
      "\n" +
      newBlockContent +
      "\n" +
      sentinelEnd +
      "\n"
    );
  }

  // Replace content between sentinels (inclusive of sentinels themselves)
  const before = fileContent.slice(0, startIdx);
  const after = fileContent.slice(endIdx + sentinelEnd.length);

  return before + sentinelStart + "\n" + newBlockContent + "\n" + sentinelEnd + after;
}
