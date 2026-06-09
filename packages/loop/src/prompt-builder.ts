import * as fs from "node:fs";
import * as path from "node:path";
import {
  fileExists,
  readMarkerFile,
  renderTemplate,
  getEmbeddedArtifact,
  type BacklogItem,
  type Backlog,
  type BacklogPaths,
  type InstructionPaths,
  type Result,
} from "@ralph/core";
import { ok, err, ErrorCodes } from "@ralph/core";

/** Summary counts for backlog items by status */
interface BacklogSummary {
  pending: number;
  in_progress: number;
  blocked: number;
  done: number;
  blockedItems: Array<{ id: string; title: string }>;
}

function computeBacklogSummary(backlog: Backlog): BacklogSummary {
  const summary: BacklogSummary = {
    pending: 0,
    in_progress: 0,
    blocked: 0,
    done: 0,
    blockedItems: [],
  };

  for (const item of backlog.items) {
    switch (item.status) {
      case "pending":
        summary.pending++;
        break;
      case "in_progress":
        summary.in_progress++;
        break;
      case "blocked":
        summary.blocked++;
        summary.blockedItems.push({ id: item.id, title: item.title });
        break;
      case "done":
        summary.done++;
        break;
    }
  }

  return summary;
}

function formatBacklogSummary(summary: BacklogSummary): string {
  const lines: string[] = [];
  lines.push(`- Pending: ${summary.pending}`);
  lines.push(`- In Progress: ${summary.in_progress}`);
  lines.push(`- Blocked: ${summary.blocked}`);
  lines.push(`- Done: ${summary.done}`);

  if (summary.blockedItems.length > 0) {
    lines.push("");
    lines.push("Blocked items:");
    for (const item of summary.blockedItems) {
      lines.push(`- ${item.id}: ${item.title}`);
    }
  }

  return lines.join("\n");
}

function formatAcceptanceCriteria(item: BacklogItem): string {
  return item.acceptanceCriteria.map((c) => `- ${c}`).join("\n");
}

function formatDependencies(item: BacklogItem): string {
  if (item.dependsOn && item.dependsOn.length > 0) {
    return `This item depends on: ${item.dependsOn.join(", ")}`;
  }
  return "No dependencies";
}

function formatNotes(item: BacklogItem): string {
  return item.notes ?? "No additional notes";
}

function formatSpecReferences(item: BacklogItem): string {
  if (item.specReferences && item.specReferences.length > 0) {
    const refs = item.specReferences.map((r) => `- ${r}`).join("\n");
    return `Read these specs before starting:\n${refs}`;
  }
  return "No spec references";
}

function formatAgentDelegation(item: BacklogItem): string {
  const delegation = item.agentDelegation;
  if (!delegation) return "";

  const parts: string[] = [];
  parts.push("### Agent Delegation");
  parts.push("This task has delegation guidance. Use the Task tool to parallelize work:");
  parts.push("");

  if (delegation.strategy) {
    parts.push(`**Strategy:** ${delegation.strategy}`);
  }
  if (delegation.recommendedConcurrency) {
    parts.push(`**Recommended concurrency:** ${delegation.recommendedConcurrency} parallel agents`);
  }
  if (delegation.subtasks && delegation.subtasks.length > 0) {
    parts.push("");
    parts.push("**Subtasks to delegate:**");
    delegation.subtasks.forEach((subtask, i) => {
      parts.push(`${i + 1}. ${subtask}`);
    });
  }

  parts.push("");
  parts.push("**Instructions:**");
  parts.push("- Use Task tool to create sub-agents for each subtask");
  parts.push("- Give each sub-agent clear, self-contained instructions");
  parts.push("- Wait for all sub-agents before running final verification");
  parts.push("- You own the RAUF_DONE/RAUF_BLOCKED signal — sub-agents do not emit these");

  return parts.join("\n");
}

function formatEstimatedIterationsHint(item: BacklogItem): string {
  if (!item.estimatedIterations || item.estimatedIterations <= 1) return "";

  return [
    "### Multi-Iteration Guidance",
    `This task is estimated to take ${item.estimatedIterations} iterations. Consider using the Task tool to delegate independent subtasks to parallel agents for efficiency.`,
  ].join("\n");
}

/**
 * Builds the complete prompt string sent to `claude -p`.
 *
 * Reads RAUF.md and progress.md from the project's .rauf/ directory,
 * formats the current backlog item and backlog summary, and assembles
 * them into a structured prompt with clear section headers.
 *
 * Returns Result err if RAUF.md is missing (required for the prompt).
 */
export function buildPrompt(
  paths: BacklogPaths,
  instructionPaths: InstructionPaths,
  item: BacklogItem,
  backlog: Backlog,
): Result<string> {
  if (!instructionPaths.raufMd) {
    return err({
      code: ErrorCodes.FILE_NOT_FOUND,
      message: "RAUF.md not found in backlog root state directory or project .rauf/",
    });
  }

  const raufMdContent = fs.readFileSync(instructionPaths.raufMd, "utf-8");
  const progressContent = fileExists(paths.progress)
    ? fs.readFileSync(paths.progress, "utf-8")
    : null;

  const summary = computeBacklogSummary(backlog);
  const itemJson = JSON.stringify(item, null, 2);

  const agentDelegation = formatAgentDelegation(item);
  const estimatedHint = formatEstimatedIterationsHint(item);

  const sections: string[] = [];

  // Section 1: RAUF.md as system context
  sections.push(`# Rauf — Per-Iteration Instructions\n\n${raufMdContent}`);

  // Section 1.5: Active Backlog Root context (always injected)
  const relativeBacklog = path.relative(paths.projectPath, paths.backlog);
  const relativeStateDir = path.relative(paths.projectPath, paths.stateDir);
  const relativeProgress = path.relative(paths.projectPath, paths.progress);

  sections.push(`## Active Backlog Root
You are working against the backlog at: ${relativeBacklog}
State directory: ${relativeStateDir}/
Progress log: ${relativeProgress}
Do NOT modify files outside this state directory.`);

  // Section 2: Current task
  sections.push(`## Your Current Task

You are working on item **${item.id}**: ${item.title}

\`\`\`json
${itemJson}
\`\`\`

### Acceptance Criteria
${formatAcceptanceCriteria(item)}

### Dependencies
${formatDependencies(item)}

### Notes
${formatNotes(item)}

### Spec References
${formatSpecReferences(item)}`);

  // Agent delegation (if present)
  if (agentDelegation) {
    sections.push(agentDelegation);
  }

  // Estimated iterations hint (if > 1)
  if (estimatedHint) {
    sections.push(estimatedHint);
  }

  // Section 3: Backlog summary
  sections.push(`### Backlog Summary
${formatBacklogSummary(summary)}`);

  // Section 4: Full backlog context
  sections.push(`---
## Full Backlog Context (read-only — do NOT modify this file)
\`\`\`json
${JSON.stringify(backlog, null, 2)}
\`\`\``);

  // Section 5: Progress log (only if file exists)
  if (progressContent !== null) {
    sections.push(`## Progress Log (accumulated learnings from previous iterations)
\`\`\`
${progressContent}
\`\`\``);
  }

  // Section 6: Important reminder
  const relBacklog = path.relative(paths.projectPath, paths.backlog);
  const relState = path.relative(paths.projectPath, paths.state);
  sections.push(`---
**IMPORTANT:** You are working on item ${item.id} ONLY. Do NOT modify ${relBacklog} or ${relState} — the loop runner manages status. When done, output your exit signal as the LAST line of your response.`);

  return ok(sections.join("\n\n\n"));
}

/** Max size for git diff included in review prompt (~100KB) */
const MAX_DIFF_SIZE = 100_000;

/**
 * Builds the review prompt sent to Claude for the post-loop review pass.
 *
 * Reads .rauf/REVIEW.md if it exists (user-customizable), otherwise
 * falls back to the embedded REVIEW.md.tmpl template.
 *
 * Template variables: verifyCommand, completedItemsDetail, gitDiff, progressContent
 */
export function buildReviewPrompt(
  paths: BacklogPaths,
  instructionPaths: InstructionPaths,
  completedItems: BacklogItem[],
  gitDiff: string,
): Result<string> {
  // Read verify command from marker file
  const markerResult = readMarkerFile(paths.projectPath);
  const verifyCommand = markerResult.ok
    ? markerResult.value.profile.verify
    : "echo 'No verify command configured'";

  // Read progress.md
  const progressContent = fileExists(paths.progress)
    ? fs.readFileSync(paths.progress, "utf-8")
    : "No progress log available.";

  // Format completed items detail
  const completedItemsDetail = completedItems
    .map((item) => {
      const criteria = item.acceptanceCriteria.map((c) => `  - ${c}`).join("\n");
      return `### Item ${item.id}: ${item.title}\n- **Type:** ${item.type}\n- **Description:** ${item.description}\n- **Acceptance Criteria:**\n${criteria}`;
    })
    .join("\n\n");

  // Truncate diff if too large
  const truncatedDiff =
    gitDiff.length > MAX_DIFF_SIZE
      ? gitDiff.slice(0, MAX_DIFF_SIZE) + "\n\n... [diff truncated at 100KB] ..."
      : gitDiff;

  // Try to read user-customizable REVIEW.md first (resolved by instructionPaths)
  let templateContent: string;

  if (instructionPaths.reviewMd) {
    templateContent = fs.readFileSync(instructionPaths.reviewMd, "utf-8");
  } else {
    // Fall back to embedded template
    try {
      templateContent = getEmbeddedArtifact(".rauf/REVIEW.md.tmpl");
    } catch {
      return err({
        code: ErrorCodes.FILE_NOT_FOUND,
        message: "REVIEW.md template not found (neither local nor embedded)",
      });
    }
  }

  // Render template variables
  const rendered = renderTemplate(templateContent, {
    verifyCommand,
    completedItemsDetail,
    gitDiff: truncatedDiff,
    progressContent,
  });

  return ok(rendered);
}
