#!/usr/bin/env node
// Windows Phase 0 baseline summary (#197). Reads the JUnit XML files the
// `windows` CI job writes and prints a Markdown report: per-step outcome,
// per-suite pass/fail counts, and failures grouped by a normalized error
// signature, so the baseline reads as "N failures, grouped by cause".
//
// Usage: node windows-baseline-summary.mjs <logs-dir>
// Step outcomes come from env vars named OUTCOME_<STEP> (set by the workflow).
// No dependencies: the JUnit is parsed with regexes, which is enough for the
// flat files vitest writes. This script only reports; it never fails the job.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "win-logs";

const decode = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? decode(m[1]) : "";
};

// Collapse the parts of an error message that differ between otherwise
// identical failures (paths, temp names, numbers, quoted values), so the
// same root cause lands in one bucket.
const signature = (msg) =>
  msg
    .split("\n")[0]
    .replace(/[A-Za-z]:\\[^\s'"`)]*/g, "<path>")
    .replace(/\/[^\s'"`)]*\/[^\s'"`)]*/g, "<path>")
    .replace(/'[^']*'/g, "'…'")
    .replace(/"[^"]*"/g, '"…"')
    .replace(/\b\d+(\.\d+)?\b/g, "N")
    .trim()
    .slice(0, 160);

const steps = Object.entries(process.env)
  .filter(([k]) => k.startsWith("OUTCOME_"))
  .map(([k, v]) => [k.slice("OUTCOME_".length).toLowerCase(), v || "skipped"]);

let files = [];
try {
  files = readdirSync(dir).filter((f) => /^junit-.*\.xml$/.test(f));
} catch {
  // No logs dir: report the step outcomes only.
}

const suites = [];
const failures = [];
for (const file of files.sort()) {
  const xml = readFileSync(join(dir, file), "utf8");
  const pkg = file.replace(/^junit-|\.xml$/g, "");
  for (const s of xml.matchAll(/<testsuite\b[^>]*>/g)) {
    const tag = s[0];
    suites.push({
      pkg,
      name: attr(tag, "name"),
      tests: Number(attr(tag, "tests")) || 0,
      failures: Number(attr(tag, "failures")) || 0,
      errors: Number(attr(tag, "errors")) || 0,
      skipped: Number(attr(tag, "skipped")) || 0,
    });
  }
  const caseRe = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  for (const c of xml.matchAll(caseRe)) {
    const body = c[2] ?? "";
    const f = body.match(/<(failure|error)\b([^>]*)>([\s\S]*?)<\/\1>|<(failure|error)\b([^>]*)\/>/);
    if (!f) continue;
    const head = f[2] ?? f[5] ?? "";
    const message = attr(head, "message") || decode(f[3] ?? "").trim();
    failures.push({
      pkg,
      suite: attr(c[1], "classname"),
      name: attr(c[1], "name"),
      sig: signature(message || "(no message)"),
    });
  }
}

const out = [];
out.push("# Windows baseline (Phase 0, non-blocking)", "");
out.push("| step | outcome |", "|---|---|");
for (const [k, v] of steps) out.push(`| ${k} | ${v} |`);
out.push("");

const total = suites.reduce(
  (a, s) => ({
    tests: a.tests + s.tests,
    failed: a.failed + s.failures + s.errors,
    skipped: a.skipped + s.skipped,
  }),
  { tests: 0, failed: 0, skipped: 0 },
);
out.push(
  `**Tests:** ${total.tests} total, ${total.failed} failed, ${total.skipped} skipped, ` +
    `across ${suites.length} suite files in ${files.length} JUnit reports.`,
  "",
);

if (failures.length) {
  const groups = new Map();
  for (const f of failures) {
    const g = groups.get(f.sig) ?? [];
    g.push(f);
    groups.set(f.sig, g);
  }
  out.push("## Failures grouped by error signature", "");
  out.push("| count | signature | example |", "|---:|---|---|");
  const esc = (s) => s.replace(/\|/g, "\\|").replace(/`/g, "'");
  for (const [sig, g] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    out.push(
      `| ${g.length} | \`${esc(sig)}\` | ${esc(`${g[0].pkg}: ${g[0].suite} > ${g[0].name}`)} |`,
    );
  }
  out.push("");

  // Keyed on each failing case's classname (the test file for vitest, the
  // module for pytest, whose JUnit has one <testsuite> for the whole run).
  const byFile = new Map();
  for (const f of failures) {
    const key = `${f.pkg} | ${f.suite}`;
    byFile.set(key, (byFile.get(key) ?? 0) + 1);
  }
  out.push("## Failing files", "");
  out.push("| report | file | failed |", "|---|---|---:|");
  for (const [key, n] of [...byFile].sort((a, b) => b[1] - a[1])) {
    out.push(`| ${key} | ${n} |`);
  }
  out.push("");
}

process.stdout.write(out.join("\n") + "\n");
