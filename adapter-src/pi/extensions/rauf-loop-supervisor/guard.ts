/**
 * Launch guard — classify an agent's bash command or subagent call that would
 * run or babysit a rauf loop in a way that blocks the Pi session (rauf #154).
 *
 * Seen in the field: a foreground `rauf loop run` under a 7200s bash timeout,
 * then `nohup … &`, then a subagent told to run the loop plus `subagent_wait`
 * for 120 minutes. Each one either blocks the session for hours or leaves the
 * loop unsupervised. The supervisor's `rauf_loop_launch` tool is the right path:
 * a detached loop, per-item cards, and a wake on exceptions.
 *
 * Only real invocations are flagged. Quoted text is masked first (so
 * `grep "rauf loop run" README.md` or an echo is fine), the command is split on
 * shell separators, and the first word of each segment must be rauf itself
 * (optionally behind env assignments or nohup/setsid/timeout/env/exec/time,
 * or as `npx|bunx @garygentry/rauf`). `--help`/`-h` is always allowed. A
 * `--detached`/`-d` launch is allowed and reported so the supervisor attaches.
 */

export type GuardVerdict =
  | { kind: "allow" }
  | { kind: "block"; reason: string }
  | { kind: "detached-launch"; root?: string; backlog?: string };

const RAUF_BINS = new Set(["rauf", "rauf-dev", "rauf-stable"]);
const RUNNERS = new Set(["npx", "bunx", "pnpx"]);
const WRAPPERS = new Set(["nohup", "setsid", "env", "exec", "time", "command", "stdbuf", "nice"]);

const BLOCK_REASON =
  "Blocked: this runs the rauf loop so that it ties up (or escapes) this session — a foreground " +
  "run (or `--detached --follow`) blocks for hours, and nohup/setsid/`&` leave it unsupervised. Use the rauf_loop_launch tool " +
  "instead: it starts the loop detached, posts a card per completed item, and wakes this session " +
  "on needs-human, blocked, stuck, errors and completion. (From bash, `rauf loop run <root> " +
  "--backlog <dir> --detached` is also allowed; the supervisor attaches to it.)";

const SUBAGENT_REASON =
  "Blocked: don't hand a rauf loop to a subagent to run or watch — waiting on it ties up this " +
  "session for hours and its progress never reaches you. Use rauf_loop_launch (detached loop, " +
  "per-item cards, wake on exceptions) and rauf_loop_status / rauf_loop_wait for checks.";

/**
 * Replace each quoted span with a placeholder token (its text kept aside), so
 * quoted contents never match as commands but can still be read back as values.
 */
function maskQuotes(cmd: string): { masked: string; quoted: string[] } {
  const quoted: string[] = [];
  let out = "";
  let quote: string | null = null;
  let buf = "";
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]!;
    if (quote) {
      if (ch === "\\" && quote === '"' && i + 1 < cmd.length) {
        buf += cmd[++i];
        continue;
      }
      if (ch === quote) {
        quoted.push(buf);
        out += `\u0001${quoted.length - 1}\u0001`;
        quote = null;
        buf = "";
        continue;
      }
      buf += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    out += ch;
  }
  return { masked: out, quoted };
}

/** Restore placeholder tokens in a word to their quoted text. */
function unmask(word: string | undefined, quoted: string[]): string | undefined {
  if (word === undefined) return undefined;
  // eslint-disable-next-line no-control-regex -- \u0001 is our own placeholder delimiter
  return word.replace(/\u0001(\d+)\u0001/g, (_m, n: string) => quoted[Number(n)] ?? "");
}

function basename(word: string): string {
  const i = word.lastIndexOf("/");
  return i === -1 ? word : word.slice(i + 1);
}

interface Segment {
  words: string[];
  background: boolean;
}

/** Split on ; && || | newlines and a trailing single & (background). */
function segments(masked: string): Segment[] {
  const out: Segment[] = [];
  const re = /(\|\||&&|;|\||\n|&)/;
  const parts = masked.split(re);
  for (let i = 0; i < parts.length; i += 2) {
    const text = parts[i] ?? "";
    const sep = parts[i + 1];
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length > 0) out.push({ words, background: sep === "&" });
  }
  return out;
}

/** Strip env assignments and wrapper commands; return the rauf args, or null. */
function raufArgs(words: string[]): { args: string[]; wrapped: boolean } | null {
  let i = 0;
  let wrapped = false;
  while (i < words.length) {
    const w = words[i]!;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) {
      i++;
      continue;
    }
    const b = basename(w);
    if (WRAPPERS.has(b)) {
      wrapped = wrapped || b === "nohup" || b === "setsid";
      i++;
      // skip wrapper options (and `timeout`'s duration)
      while (i < words.length && words[i]!.startsWith("-")) i++;
      continue;
    }
    if (b === "timeout") {
      i++;
      while (i < words.length && words[i]!.startsWith("-")) i++;
      i++; // duration
      continue;
    }
    if (RUNNERS.has(b)) {
      i++;
      while (i < words.length && words[i]!.startsWith("-")) i++;
      const pkg = words[i];
      if (pkg && /^(@garygentry\/)?rauf(@[^\s]*)?$/.test(pkg)) {
        return { args: words.slice(i + 1), wrapped };
      }
      return null;
    }
    if (RAUF_BINS.has(b)) return { args: words.slice(i + 1), wrapped };
    return null;
  }
  return null;
}

/** rauf flags that take a value (`--answer` takes two). */
const VALUE_FLAGS: Record<string, number> = {
  "--backlog": 1,
  "--iterations": 1,
  "--retries": 1,
  "--timeout": 1,
  "--model": 1,
  "--agent": 1,
  "--create-branch": 1,
  "--interval": 1,
  "--answer": 2,
  "--root": 1,
};

/** Positional args, skipping flags and their values. */
function positionals(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("-")) {
      if (!a.includes("=")) i += VALUE_FLAGS[a] ?? 0;
      continue;
    }
    out.push(a);
  }
  return out;
}

function flagValue(args: string[], name: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === name) return args[i + 1];
    if (a.startsWith(`${name}=`)) return a.slice(name.length + 1);
  }
  return undefined;
}

/** Classify one bash command line. */
export function classifyBashCommand(command: string | undefined): GuardVerdict {
  if (!command || !/rauf/.test(command)) return { kind: "allow" };
  const { masked, quoted } = maskQuotes(command);
  // Check EVERY segment: one detached launch must not wave through a foreground
  // run later in the same command line. A block anywhere wins.
  let launch: GuardVerdict | null = null;
  for (const seg of segments(masked)) {
    const r = raufArgs(seg.words);
    if (!r) continue;
    const positional = positionals(r.args);
    const isRun = positional[0] === "loop" && positional[1] === "run";
    const isResume = positional[0] === "resume";
    if (!isRun && !isResume) continue;
    if (r.args.includes("--help") || r.args.includes("-h")) continue;
    const detached = r.args.includes("--detached") || r.args.includes("-d");
    // `--detached --follow` attaches the never-ending follow view: it blocks.
    const follows = r.args.includes("--follow") || r.args.includes("-f");
    if (!detached || follows) return { kind: "block", reason: BLOCK_REASON };
    // `--detached` returns immediately; nohup/& around it is harmless.
    launch ??= {
      kind: "detached-launch",
      root: unmask(positional[isRun ? 2 : 1], quoted),
      backlog: unmask(flagValue(r.args, "--backlog"), quoted),
    };
  }
  return launch ?? { kind: "allow" };
}

/** Tool names that delegate work to another agent. */
export function isSubagentTool(toolName: string): boolean {
  return /subagent|delegate|spawn_agent|^task$|^agent$/i.test(toolName);
}

const BABYSIT_RE =
  /\brauf\b[^\n]{0,60}\b(loop\s+run|loop\s+wait|follow|resume)\b|\brauf_loop_(launch|wait)\b|events\.ndjson|\bforge-5-loop\b/i;

/** Classify a subagent tool call whose instructions run or watch the loop. */
export function classifySubagentCall(toolName: string, input: unknown): GuardVerdict {
  if (!isSubagentTool(toolName)) return { kind: "allow" };
  let text: string;
  try {
    text = typeof input === "string" ? input : JSON.stringify(input ?? "");
  } catch {
    return { kind: "allow" };
  }
  return BABYSIT_RE.test(text) ? { kind: "block", reason: SUBAGENT_REASON } : { kind: "allow" };
}
