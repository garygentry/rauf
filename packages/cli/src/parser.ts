// ─── Argument Parser ─────────────────────────────────────────────
//
// Lightweight CLI argument parser for rauf.
// Extracts global flags, identifies command/subcommand, and passes
// remaining args to command handlers for per-command parsing.

export interface GlobalFlags {
  json: boolean;
  noColor: boolean;
  quiet: boolean;
  root: string | null;
}

export interface ParsedArgs {
  command: string | null;
  subcommand: string | null;
  args: string[];
  flags: Map<string, string | true>;
  globalFlags: GlobalFlags;
}

/**
 * Parse CLI arguments into structured form.
 *
 * Global flags (--json, --no-color, --quiet, --root) are extracted first.
 * Remaining positionals are split into command, subcommand (if applicable),
 * and args. Non-global flags are collected into the flags map.
 *
 * @param argv - Raw argument array (typically process.argv.slice(2))
 * @param subcommandNames - Set of valid subcommand names for the resolved command.
 *   If the second positional matches, it's treated as a subcommand rather than an arg.
 */
export function parseArgs(argv: string[], subcommandNames?: Set<string>): ParsedArgs {
  const globalFlags: GlobalFlags = {
    json: false,
    noColor: false,
    quiet: false,
    root: null,
  };
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;

    // -- terminates flag parsing
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }

    // Global boolean flags
    if (arg === "--json") {
      globalFlags.json = true;
      i++;
      continue;
    }
    if (arg === "--no-color") {
      globalFlags.noColor = true;
      i++;
      continue;
    }
    if (arg === "--quiet" || arg === "-q") {
      globalFlags.quiet = true;
      i++;
      continue;
    }

    // Global value flag: --root <path>
    if (arg === "--root") {
      const next = argv[i + 1];
      globalFlags.root = next ?? null;
      i += next !== undefined ? 2 : 1;
      continue;
    }

    // Long flags: --flag, --flag=value, --flag value
    if (arg.startsWith("--") && arg.length > 2) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        // --flag=value
        flags.set(arg.slice(2, eqIdx), arg.slice(eqIdx + 1));
      } else {
        const name = arg.slice(2);
        const next = argv[i + 1];
        // Peek: if next token exists and doesn't look like a flag, consume as value
        if (next !== undefined && !next.startsWith("-")) {
          flags.set(name, next);
          i++;
        } else {
          flags.set(name, true);
        }
      }
      i++;
      continue;
    }

    // Short flags (other than -q handled above)
    if (arg.startsWith("-") && arg.length > 1 && !arg.startsWith("--")) {
      flags.set(arg.slice(1), true);
      i++;
      continue;
    }

    // Positional argument
    positionals.push(arg);
    i++;
  }

  // Split positionals into command / subcommand / args
  const command = positionals[0] ?? null;
  let subcommand: string | null = null;
  let restStart = 1;

  if (command && subcommandNames && positionals.length > 1) {
    const candidate = positionals[1];
    if (candidate && subcommandNames.has(candidate)) {
      subcommand = candidate;
      restStart = 2;
    }
  }

  // Normalize the -f short alias to the canonical --follow flag (REQ-MON-03: one
  // flag name). The flags map is complete once the arg-parsing loop exits, so this
  // runs once here and handlers only ever read "follow".
  if (flags.has("f") && !flags.has("follow")) {
    flags.set("follow", flags.get("f")!);
    flags.delete("f");
  }

  return {
    command,
    subcommand,
    args: positionals.slice(restStart),
    flags,
    globalFlags,
  };
}

/**
 * Extract a boolean flag from a flags map, removing it if present.
 */
export function extractBoolFlag(flags: Map<string, string | true>, name: string): boolean {
  if (flags.has(name)) {
    flags.delete(name);
    return true;
  }
  return false;
}

/**
 * Extract a string-valued flag from a flags map, removing it if present.
 */
export function extractStringFlag(flags: Map<string, string | true>, name: string): string | null {
  const val = flags.get(name);
  if (val === undefined) return null;
  flags.delete(name);
  return val === true ? null : val;
}

/**
 * Extract a numeric flag from a flags map, removing it if present.
 * Returns null if not present or not a valid number.
 */
export function extractNumberFlag(flags: Map<string, string | true>, name: string): number | null {
  const val = extractStringFlag(flags, name);
  if (val === null) return null;
  const num = Number(val);
  return Number.isFinite(num) ? num : null;
}

/**
 * Extract repeatable string flags (e.g., --ac "criterion1" --ac "criterion2").
 * Returns all values in order. Removes from flags map.
 *
 * Note: the standard Map-based flag parser only stores the last value.
 * For repeatable flags, callers should use extractRepeatableFlag on the raw argv.
 */
export function extractRepeatableFlag(argv: string[], flagName: string): string[] {
  const values: string[] = [];
  const flag = flagName.startsWith("--") ? flagName : `--${flagName}`;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        values.push(next);
        i++; // skip value
      }
    }
  }
  return values;
}
