// ─── ralph CLI Main Logic ───────────────────────────────────────
//
// Extracted from index.ts so the unified binary entry point can
// call runCli() without side effects on import.

import { VERSION } from "@ralph/core";
import { parseArgs } from "./parser.js";
import { configureOutput, detectColorSupport, error, c, info, print, outputJson } from "./formatter.js";
import { COMMANDS, findCommand, getSubcommandNames, findSubcommand, ExitCode } from "./commands.js";
import type { CommandContext } from "./commands.js";

export async function runCli(): Promise<number> {
  const argv = process.argv.slice(2);

  // Intercept --version / -V before full parsing
  if (argv.includes("--version") || argv.includes("-V")) {
    const wantJson = argv.includes("--json");
    const autoColor = detectColorSupport();
    configureOutput({ noColor: !autoColor, quiet: false, json: wantJson });
    if (wantJson) {
      outputJson({ version: VERSION });
    } else {
      print(`ralph v${VERSION}`);
    }
    return ExitCode.SUCCESS;
  }

  // First pass: parse to get command name and global flags
  const preparse = parseArgs(argv);
  const commandName = preparse.command;

  // Configure output based on flags + environment
  const autoColor = detectColorSupport();
  configureOutput({
    noColor: preparse.globalFlags.noColor || !autoColor,
    quiet: preparse.globalFlags.quiet,
    json: preparse.globalFlags.json,
  });

  // No command → show help
  if (!commandName) {
    const helpCmd = findCommand("help");
    if (helpCmd?.handler) {
      return helpCmd.handler({
        args: [],
        flags: new Map(),
        globalFlags: preparse.globalFlags,
        rawArgv: argv,
      });
    }
    return ExitCode.SUCCESS;
  }

  // Look up command
  const cmd = findCommand(commandName);
  if (!cmd) {
    error(`Unknown command: ${commandName}`);
    info("");
    info(`Run ${c.cyan("ralph help")} for available commands.`);

    // Suggest similar commands
    const suggestion = findSimilarCommand(commandName);
    if (suggestion) {
      info(`Did you mean ${c.cyan(suggestion)}?`);
    }

    return ExitCode.INVALID_ARGS;
  }

  // Re-parse with subcommand awareness if this command has subcommands
  let parsed = preparse;
  if (cmd.subcommands) {
    parsed = parseArgs(argv, getSubcommandNames(cmd));
  }

  // Build command context
  const ctx: CommandContext = {
    args: parsed.args,
    flags: parsed.flags,
    globalFlags: parsed.globalFlags,
    rawArgv: argv,
  };

  // If command has subcommands, route to subcommand handler
  if (cmd.subcommands) {
    if (!parsed.subcommand) {
      error(`Missing subcommand for '${commandName}'.`);
      info("");
      info(`Available subcommands:`);
      for (const sc of cmd.subcommands) {
        info(`  ${c.cyan(sc.name)}  ${sc.description}`);
      }
      info("");
      info(`Run ${c.cyan(`ralph help ${commandName}`)} for details.`);
      return ExitCode.INVALID_ARGS;
    }

    const subcmd = findSubcommand(cmd, parsed.subcommand);
    if (!subcmd) {
      error(`Unknown subcommand '${parsed.subcommand}' for '${commandName}'.`);
      info("");
      info(`Available subcommands:`);
      for (const sc of cmd.subcommands) {
        info(`  ${c.cyan(sc.name)}  ${sc.description}`);
      }
      return ExitCode.INVALID_ARGS;
    }

    if (!subcmd.handler) {
      error(`'${commandName} ${parsed.subcommand}' is not yet implemented.`);
      return ExitCode.ERROR;
    }

    return subcmd.handler(ctx);
  }

  // No subcommands — invoke command handler directly
  if (!cmd.handler) {
    error(`'${commandName}' is not yet implemented.`);
    return ExitCode.ERROR;
  }

  return cmd.handler(ctx);
}

// ─── Helpers ─────────────────────────────────────────────────────

function findSimilarCommand(input: string): string | null {
  const names = COMMANDS.map((c) => c.name);
  let best: string | null = null;
  let bestDist = Infinity;

  for (const name of names) {
    const dist = levenshtein(input.toLowerCase(), name.toLowerCase());
    if (dist < bestDist && dist <= 3) {
      bestDist = dist;
      best = name;
    }
  }
  return best;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array.from({ length: n + 1 }, () => 0),
  );

  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
    }
  }

  return dp[m]![n]!;
}
