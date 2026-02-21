// ─── Output Formatter ────────────────────────────────────────────
//
// Color helpers (via picocolors), table renderer, JSON output,
// and quiet-mode-aware printing for the ralph CLI.

import pc from "picocolors";

// ─── Color Control ───────────────────────────────────────────────

let colorEnabled = true;
let quietMode = false;
let jsonMode = false;

export function configureOutput(opts: {
  noColor?: boolean;
  quiet?: boolean;
  json?: boolean;
}): void {
  if (opts.noColor !== undefined) colorEnabled = !opts.noColor;
  if (opts.quiet !== undefined) quietMode = opts.quiet;
  if (opts.json !== undefined) jsonMode = opts.json;

  // Also set NO_COLOR env for any child processes or libraries that check it
  if (!colorEnabled) {
    process.env["NO_COLOR"] = "1";
  }
}

/**
 * Auto-detect color support from environment.
 * Called once at startup before configureOutput overrides.
 */
export function detectColorSupport(): boolean {
  // NO_COLOR env convention (https://no-color.org/)
  if (process.env["NO_COLOR"] !== undefined) return false;
  // Non-TTY stdout
  if (!process.stdout.isTTY) return false;
  return true;
}

export function isQuiet(): boolean {
  return quietMode;
}

export function isJsonMode(): boolean {
  return jsonMode;
}

// ─── Color Helpers ───────────────────────────────────────────────
//
// Thin wrappers over picocolors that respect --no-color at runtime.
// picocolors checks NO_COLOR at import time, but we may set it later
// based on CLI flags, so we need runtime gating.

function wrap(fn: (s: string) => string): (s: string) => string {
  return (s: string) => (colorEnabled ? fn(s) : s);
}

export const c = {
  red: wrap(pc.red),
  green: wrap(pc.green),
  yellow: wrap(pc.yellow),
  blue: wrap(pc.blue),
  cyan: wrap(pc.cyan),
  magenta: wrap(pc.magenta),
  gray: wrap(pc.gray),
  dim: wrap(pc.dim),
  bold: wrap(pc.bold),
  underline: wrap(pc.underline),
};

// ─── Unicode Indicators ──────────────────────────────────────────

export const symbols = {
  success: "\u2713", // ✓
  warning: "\u26A0", // ⚠
  error: "\u2717", // ✗
  bullet: "\u25CF", // ●
  arrow: "\u2192", // →
};

// ─── Output Functions ────────────────────────────────────────────

/** Print to stdout (always — not suppressed by --quiet) */
export function print(message: string): void {
  process.stdout.write(message + "\n");
}

/** Print informational message (suppressed by --quiet, skipped in --json mode) */
export function info(message: string): void {
  if (quietMode || jsonMode) return;
  process.stdout.write(message + "\n");
}

/** Print error to stderr (never suppressed) */
export function error(message: string): void {
  process.stderr.write(c.red(`${symbols.error} ${message}`) + "\n");
}

/** Print warning to stderr (suppressed by --quiet) */
export function warn(message: string): void {
  if (quietMode) return;
  process.stderr.write(c.yellow(`${symbols.warning} ${message}`) + "\n");
}

/** Print success message (suppressed by --quiet and --json) */
export function success(message: string): void {
  if (quietMode || jsonMode) return;
  process.stdout.write(c.green(`${symbols.success} ${message}`) + "\n");
}

/** Output JSON to stdout */
export function outputJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

// ─── Table Renderer ──────────────────────────────────────────────

export interface TableColumn {
  header: string;
  key: string;
  width?: number; // max width (truncate with ellipsis)
  align?: "left" | "right";
  color?: (value: string) => string;
}

/**
 * Render a table with aligned columns.
 *
 * @param columns - Column definitions
 * @param rows - Array of objects with keys matching column.key
 * @returns Formatted string with header + separator + data rows
 */
export function renderTable(
  columns: TableColumn[],
  rows: Record<string, string>[],
): string {
  if (columns.length === 0) return "";

  // Compute effective widths: max of header length and all data values
  const widths = columns.map((col) => {
    const dataMax = rows.reduce((max, row) => {
      const val = row[col.key] ?? "";
      return Math.max(max, stripAnsi(val).length);
    }, 0);
    const natural = Math.max(stripAnsi(col.header).length, dataMax);
    return col.width ? Math.min(natural, col.width) : natural;
  });

  const lines: string[] = [];

  // Header
  const headerCells = columns.map((col, i) =>
    padCell(c.bold(col.header), stripAnsi(col.header).length, widths[i]!, col.align),
  );
  lines.push(headerCells.join("  "));

  // Separator
  const sep = widths.map((w) => "\u2500".repeat(w));
  lines.push(sep.join("  "));

  // Data rows
  for (const row of rows) {
    const cells = columns.map((col, i) => {
      let val = row[col.key] ?? "";
      const plainLen = stripAnsi(val).length;
      const maxW = widths[i]!;

      // Truncate if needed
      if (plainLen > maxW && maxW > 1) {
        val = truncateStr(val, maxW);
      }

      // Apply column color
      if (col.color) {
        val = col.color(val);
      }

      return padCell(val, Math.min(plainLen, maxW), maxW, col.align);
    });
    lines.push(cells.join("  "));
  }

  return lines.join("\n");
}

// ─── Helpers ─────────────────────────────────────────────────────

// Simple ANSI escape stripping for width calculations
const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

function padCell(
  content: string,
  visibleLen: number,
  width: number,
  align?: "left" | "right",
): string {
  const padding = Math.max(0, width - visibleLen);
  if (align === "right") {
    return " ".repeat(padding) + content;
  }
  return content + " ".repeat(padding);
}

function truncateStr(s: string, maxWidth: number): string {
  // Strip ANSI for counting, then truncate the plain text
  const plain = stripAnsi(s);
  if (plain.length <= maxWidth) return s;
  return plain.slice(0, maxWidth - 1) + "\u2026"; // ellipsis
}
