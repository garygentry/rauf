// Hermetic test environment for every workspace package (#146).
//
// The runner's usage-limit paths read the Claude OAuth token from
// ~/.claude/.credentials.json and query the live Anthropic usage API. Against a
// developer's real HOME that made runner tests reach the live API (and fail
// locally while passing in token-less CI). Every test file therefore runs with:
//   1. HOME pointed at a fresh, empty temp dir — no real credentials, and no
//      writes to the developer's real ~/.rauf (resolved at module load, which is
//      why this must run as a setup file, before any test module is imported);
//   2. a fetch guard that refuses any request to api.anthropic.com. Tests that
//      exercise the usage API stub `globalThis.fetch` themselves.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const hermeticHome = fs.mkdtempSync(path.join(os.tmpdir(), "rauf-loop-test-home-"));
process.env.HOME = hermeticHome;
process.env.USERPROFILE = hermeticHome;

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url.startsWith("https://api.anthropic.com")) {
    throw new Error(`hermetic test: live Anthropic API call blocked (${url})`);
  }
  return realFetch(input, init);
}) as typeof fetch;
