/**
 * rauf-loop-supervisor — run a rauf loop from Pi without blocking the session,
 * and supervise it (rauf #154).
 *
 * `rauf_loop_launch` starts the loop detached (it runs in rauf's server and
 * outlives the session). A rotation-aware tail of `events.ndjson` then posts a
 * card per completed item — a custom message with `triggerTurn: false`, so it
 * is saved, visible and in the model's context next turn, at no model cost —
 * and wakes the session (`triggerTurn: true`) only on needs-human, blocked,
 * stuck, review failure, loop errors and completion. A footer status and a
 * widget show live progress. A `tool_call` guard turns foreground / nohup /
 * subagent loop runs into a pointer at `rauf_loop_launch`. Task identity is
 * persisted (session entry + `<stateDir>/supervisors/pi.json`) so a restarted
 * session reattaches without duplicate reports; shutdown closes watchers only.
 *
 * All logic is in wiring.ts behind injected deps; this file supplies the real
 * ones. `typebox` and `@earendil-works/pi-tui` are provided by pi at runtime.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { watch as fsWatch } from "node:fs";
import { basename, dirname } from "node:path";
import { Type } from "typebox";

import {
  CARD_MESSAGE_TYPE,
  WAKE_MESSAGE_TYPE,
  createExtension,
  type Deps,
  type PiLike,
  type SchemaBuilder,
  type WatchHandle,
} from "./wiring.js";

/** Backstop poll (ms): fs.watch can miss or drop events on some platforms. */
const BACKSTOP_MS = 2000;
/** Debounce (ms) coalescing a burst of fs.watch events into one poll. */
const DEBOUNCE_MS = 120;

const productionDeps: Deps = {
  watch(filePath, onChange): WatchHandle {
    const dir = dirname(filePath);
    const base = basename(filePath);
    let debounce: NodeJS.Timeout | null = null;
    const fire = () => {
      if (debounce) return;
      debounce = setTimeout(() => {
        debounce = null;
        onChange();
      }, DEBOUNCE_MS);
    };
    let fsw: ReturnType<typeof fsWatch> | null = null;
    try {
      // Watch the DIRECTORY so rotation-by-rename (rauf moves events.ndjson to
      // archive/ at each run start) keeps firing.
      fsw = fsWatch(dir, (_evt, name) => {
        if (!name || name === base) fire();
      });
      fsw.on?.("error", () => {
        /* directory vanished; the backstop keeps polling */
      });
    } catch {
      fsw = null;
    }
    const interval = setInterval(onChange, BACKSTOP_MS);
    return {
      close() {
        try {
          fsw?.close();
        } catch {
          /* ignore */
        }
        if (debounce) clearTimeout(debounce);
        clearInterval(interval);
      },
    };
  },
  now: () => new Date().toISOString(),
  Type: Type as unknown as SchemaBuilder,
};

export default function (pi: ExtensionAPI) {
  // Adapt the real API to the structural PiLike the wiring uses. Members are
  // read by name off `pi`, so a renamed/removed method is a compile error here.
  const piLike: PiLike = {
    registerTool: (def) => (pi.registerTool as (d: unknown) => void)(def),
    on: (event, handler) =>
      (pi.on as unknown as (e: string, h: typeof handler) => void)(event, handler),
    sendMessage: (message, options) =>
      pi.sendMessage(message as Parameters<typeof pi.sendMessage>[0], options),
    appendEntry: (customType, data) => pi.appendEntry(customType, data),
    exec:
      typeof pi.exec === "function"
        ? (command, args, opts) => pi.exec(command, args, opts)
        : undefined,
  };

  // One-line rendering for cards (dim) and wakes (warning tone).
  try {
    pi.registerMessageRenderer(
      CARD_MESSAGE_TYPE,
      (message, _opts, theme) => new Text(theme.fg("dim", String(message.content)), 0, 0),
    );
    pi.registerMessageRenderer(
      WAKE_MESSAGE_TYPE,
      (message, _opts, theme) => new Text(theme.fg("warning", String(message.content)), 0, 0),
    );
  } catch {
    /* renderer API unavailable: pi's default rendering applies */
  }

  createExtension(piLike, productionDeps);
}
