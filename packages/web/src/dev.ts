// @ralph/web — Concurrent dev launcher
//
// Starts both the Hono API server and Vite dev server
// with color-coded output prefixes. Handles clean shutdown on Ctrl+C.

import ports from "../../../config/ports.json";

const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

const API_PREFIX = `${CYAN}[api]${RESET}  `;
const VITE_PREFIX = `${MAGENTA}[vite]${RESET} `;

/**
 * Read lines from a ReadableStream and write them to stdout with a prefix.
 */
async function pipeWithPrefix(stream: ReadableStream<Uint8Array>, prefix: string): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // Keep the last incomplete line in the buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        process.stdout.write(`${prefix}${line}\n`);
      }
    }
    // Flush any remaining content
    if (buffer.length > 0) {
      process.stdout.write(`${prefix}${buffer}\n`);
    }
  } catch {
    // Stream closed — expected during shutdown
  }
}

function killProc(proc: ReturnType<typeof Bun.spawn>): void {
  try {
    proc.kill();
  } catch {
    // Already exited
  }
}

// --- Spawn both processes ---

const apiProc = Bun.spawn(["bun", "run", "src/server/index.ts"], {
  cwd: import.meta.dir + "/..",
  stdout: "pipe",
  stderr: "pipe",
  env: { ...process.env },
});

const viteProc = Bun.spawn(["./node_modules/.bin/vite"], {
  cwd: import.meta.dir + "/..",
  stdout: "pipe",
  stderr: "pipe",
  env: { ...process.env },
});

// --- Pipe output with prefixes ---

pipeWithPrefix(apiProc.stdout, API_PREFIX);
pipeWithPrefix(apiProc.stderr, API_PREFIX);
pipeWithPrefix(viteProc.stdout, VITE_PREFIX);
pipeWithPrefix(viteProc.stderr, VITE_PREFIX);

// --- Startup banner ---

console.log();
console.log(`${BOLD}  Ralph Dev Server${RESET}`);
console.log(`${DIM}  ─────────────────────────────${RESET}`);
console.log(`  ${CYAN}API${RESET}      http://${ports.serverHost}:${ports.serverPort}`);
console.log(`  ${MAGENTA}Frontend${RESET} http://localhost:${ports.vitePort}`);
console.log(`${DIM}  ─────────────────────────────${RESET}`);
console.log();

// --- Clean shutdown ---

let exiting = false;

function shutdown(code: number = 0): void {
  if (exiting) return;
  exiting = true;
  killProc(apiProc);
  killProc(viteProc);
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

// --- Watch for unexpected exits ---

apiProc.exited.then((code) => {
  if (!exiting) {
    console.error(`\n${API_PREFIX}Process exited unexpectedly (code ${code})`);
    shutdown(1);
  }
});

viteProc.exited.then((code) => {
  if (!exiting) {
    console.error(`\n${VITE_PREFIX}Process exited unexpectedly (code ${code})`);
    shutdown(1);
  }
});
