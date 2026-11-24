#!/usr/bin/env node
// Windows Phase 0 baseline summary (#197). Reads what the `windows` CI job
// writes into <logs-dir> and prints a Markdown report: step outcomes, test
// totals, failures grouped by a normalized error signature (so the baseline
// reads as "N failures, grouped by cause"), failing files, and the raw probe
// files. Shared with feature-forge's copy (#395); keep the bodies identical.
//
// Usage: OUTCOMES="install=success build=failure ..." node windows-baseline-summary.mjs <logs-dir>
//   OUTCOMES  space-separated step=outcome pairs, in workflow order.
//   junit-*.xml   JUnit reports (vitest or pytest); one per report.
//   probe-*       probe outputs, printed verbatim (truncated) at the end.
// No dependencies: the JUnit is parsed with regexes, which is enough for the
// flat files vitest and pytest write. It only reports: an unreadable report is
// noted in the output, and the script always exits 0.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "win-logs";

const decode = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? decode(m[1]) : "";
};

const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/`/g, "'");

// A quoted value is "variable" (collapsed) when it looks like a path, a temp
// name or a long blob; short plain words (a module name, an identifier) stay,
// because they usually ARE the cause.
const variable = (v) => /[\\/]|\d/.test(v) || v.length > 40;

// Collapse what differs between otherwise identical failures (paths, temp
// names, numbers), so one root cause lands in one bucket.
const signature = (raw) => {
  let msg = raw.split("\n")[0];
  // pytest wraps fixture errors as: failed on setup with "<real error>".
  const wrapped = msg.match(/^failed on (setup|teardown) with "(.*)"$/);
  if (wrapped) msg = `${wrapped[1]}: ${wrapped[2]}`;
  return msg
    .replace(/'([^']*)'/g, (m, v) => (variable(v) ? "'…'" : m))
    .replace(/"([^"]*)"/g, (m, v) => (variable(v) ? '"…"' : m))
    .replace(/[A-Za-z]:\\[^\s'"`)]*/g, "<path>")
    .replace(/(?:[\w.-]+)?(?:\\[\w.-]+){2,}/g, "<path>")
    .replace(/(?:[\w.-]+)?(?:\/[\w.-]+){2,}/g, "<path>")
    .replace(/\d+(\.\d+)?/g, "N")
    .trim()
    .slice(0, 160);
};

const steps = (process.env.OUTCOMES ?? "")
  .split(/\s+/)
  .filter(Boolean)
  .map((pair) => {
    const [k, v] = pair.split("=");
    return [k, v || "skipped"];
  });

let entries = [];
try {
  entries = readdirSync(dir).sort();
} catch {
  // No logs dir: report the step outcomes only.
}
const junitFiles = entries.filter((f) => /^junit-.*\.xml$/.test(f));
const probeFiles = entries.filter((f) => /^probe-/.test(f));

const suites = [];
const failures = []; // one entry per <failure>/<error> element
const unreadable = [];
for (const file of junitFiles) {
  try {
    const xml = readFileSync(join(dir, file), "utf8");
    const pkg = file.replace(/^junit-|\.xml$/g, "");
    for (const s of xml.matchAll(/<testsuite\b[^>]*>/g)) {
      const tag = s[0];
      suites.push({
        tests: Number(attr(tag, "tests")) || 0,
        skipped: Number(attr(tag, "skipped")) || 0,
      });
    }
    const caseRe = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
    const failRe = /<(failure|error)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g;
    for (const c of xml.matchAll(caseRe)) {
      for (const f of (c[2] ?? "").matchAll(failRe)) {
        const message = attr(f[2], "message") || decode(f[3] ?? "").trim();
        failures.push({
          pkg,
          suite: attr(c[1], "classname"),
          name: attr(c[1], "name"),
          sig: signature(message || "(no message)"),
        });
      }
    }
  } catch (e) {
    unreadable.push(`${file}: ${e.message}`);
  }
}

const out = [];
out.push("# Windows baseline (Phase 0, non-blocking)", "");
out.push("| step | outcome |", "|---|---|");
for (const [k, v] of steps) out.push(`| ${esc(k)} | ${esc(v)} |`);
out.push("");

const tests = suites.reduce((a, s) => a + s.tests, 0);
const skipped = suites.reduce((a, s) => a + s.skipped, 0);
const failingCases = new Set(failures.map((f) => `${f.pkg}\0${f.suite}\0${f.name}`)).size;
out.push(
  `**Tests:** ${tests} total, ${failingCases} failing (${failures.length} failure/error records), ` +
    `${skipped} skipped, from ${junitFiles.length} JUnit reports.`,
  "",
);
for (const u of unreadable) out.push(`- unreadable report: ${esc(u)}`);
if (unreadable.length) out.push("");

if (failures.length) {
  const groups = new Map();
  for (const f of failures) {
    const g = groups.get(f.sig) ?? [];
    g.push(f);
    groups.set(f.sig, g);
  }
  out.push("## Failures grouped by error signature", "");
  out.push("| count | signature | example |", "|---:|---|---|");
  for (const [sig, g] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    out.push(
      `| ${g.length} | \`${esc(sig)}\` | ${esc(`${g[0].pkg}: ${g[0].suite} > ${g[0].name}`)} |`,
    );
  }
  out.push("");

  // Keyed on each failing case's classname: the test file for vitest, the
  // module for pytest (whose JUnit has a single <testsuite> for the run).
  const byFile = new Map();
  for (const f of failures) {
    const key = `${esc(f.pkg)} | ${esc(f.suite)}`;
    byFile.set(key, (byFile.get(key) ?? 0) + 1);
  }
  out.push("## Failing files", "");
  out.push("| report | file | records |", "|---|---|---:|");
  for (const [key, n] of [...byFile].sort((a, b) => b[1] - a[1])) {
    out.push(`| ${key} | ${n} |`);
  }
  out.push("");
}

if (probeFiles.length) {
  out.push("## Probes", "");
  for (const file of probeFiles) {
    let text;
    try {
      text = readFileSync(join(dir, file), "utf8").trimEnd();
    } catch (e) {
      text = `(unreadable: ${e.message})`;
    }
    if (text.length > 3000) text = `${text.slice(0, 3000)}\n… (truncated; see the artifact)`;
    out.push(`**${file}**`, "", "```text", text.replace(/```/g, "'''"), "```", "");
  }
}

process.stdout.write(out.join("\n") + "\n");
