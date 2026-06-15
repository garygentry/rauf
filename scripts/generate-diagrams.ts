#!/usr/bin/env bun
/**
 * generate-diagrams.ts
 *
 * Generates the documentation SVG diagrams from structured data definitions.
 * Every diagram embeds CSS that switches palette via `prefers-color-scheme`, so a
 * single file renders correctly in both Starlight's dark and light themes.
 *
 * Outputs (into docs/images/, symlinked into packages/docs/src/content/docs/images/):
 *   - architecture.svg        System architecture (machine / CLI / web / core / fs).
 *   - loop-lifecycle.svg      One iteration: select → prompt → spawn → signal → verify/commit → advance.
 *   - observation-model.svg   The file substrate every observer reconstructs from (CANON §4.2).
 *   - execution-modes.svg     In-process `loop run` vs `--detached`, observed identically (P2).
 *   - status-states.svg       The derived status vocabulary as a state machine (CANON §4.3).
 *   - package-graph.svg       core ← loop ← cli/web dependency graph.
 *
 * This script is wired into the docs prebuild (packages/docs `prebuild`) so the
 * committed SVGs can never drift from these definitions.
 *
 * Usage: bun run scripts/generate-diagrams.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const OUTPUT_DIR = path.join(REPO_ROOT, "docs", "images");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BoxStyle =
  | "primary"
  | "secondary"
  | "container"
  | "nested"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "neutral";

interface Box {
  id: string;
  label: string;
  sublabel?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  style: BoxStyle;
  /** Position labels at top of box instead of center (for boxes with nested children) */
  labelTop?: boolean;
}

interface Arrow {
  from: { x: number; y: number };
  to: { x: number; y: number };
  label?: string;
  dashed?: boolean;
}

interface Point {
  x: number;
  y: number;
}

/** Generic connector used by the newer diagrams (any angle, optional elbows). */
interface Connector {
  /** Straight connector endpoints (ignored when `path` is given). */
  from?: Point;
  to?: Point;
  /** Multi-segment elbow path; arrowhead sits on the final segment. */
  path?: Point[];
  label?: string;
  dashed?: boolean;
  /** Draw an arrowhead at both ends. */
  bidir?: boolean;
  /** Nudge the label off the segment midpoint. */
  labelOffset?: { dx?: number; dy?: number };
  /** Override the default `middle` label anchor. */
  labelAnchor?: "start" | "middle" | "end";
}

interface Diagram {
  name: string;
  width: number;
  height: number;
  boxes: Box[];
  connectors?: Connector[];
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Round to one decimal place to keep generated coordinates tidy. */
function r(n: number): number {
  return Math.round(n * 10) / 10;
}

function renderCSS(): string {
  return `
    <style>
      /* Dark mode (default — matches Starlight's default) */
      :root {
        --bg: hsl(224, 10%, 10%);
        --container-fill: hsl(224, 14%, 14%);
        --container-stroke: hsl(224, 10%, 25%);
        --primary-fill: hsl(217, 50%, 18%);
        --primary-stroke: #3b82f6;
        --secondary-fill: hsl(224, 14%, 16%);
        --secondary-stroke: hsl(224, 6%, 40%);
        --nested-fill: hsl(217, 50%, 14%);
        --nested-stroke: hsl(217, 40%, 30%);
        --info-fill: hsl(217, 50%, 18%);
        --info-stroke: #3b82f6;
        --success-fill: hsl(145, 38%, 16%);
        --success-stroke: #22c55e;
        --warning-fill: hsl(38, 48%, 18%);
        --warning-stroke: #f59e0b;
        --danger-fill: hsl(0, 45%, 18%);
        --danger-stroke: #ef4444;
        --neutral-fill: hsl(224, 14%, 16%);
        --neutral-stroke: hsl(224, 6%, 42%);
        --text: hsl(224, 6%, 82%);
        --text-muted: hsl(224, 6%, 56%);
        --arrow: hsl(224, 6%, 50%);
      }

      @media (prefers-color-scheme: light) {
        :root {
          --bg: #ffffff;
          --container-fill: hsl(224, 20%, 97%);
          --container-stroke: hsl(224, 6%, 82%);
          --primary-fill: #dbeafe;
          --primary-stroke: #2563eb;
          --secondary-fill: hsl(224, 20%, 96%);
          --secondary-stroke: hsl(224, 7%, 60%);
          --nested-fill: hsl(217, 60%, 94%);
          --nested-stroke: hsl(217, 40%, 70%);
          --info-fill: #dbeafe;
          --info-stroke: #2563eb;
          --success-fill: #dcfce7;
          --success-stroke: #16a34a;
          --warning-fill: #fef3c7;
          --warning-stroke: #d97706;
          --danger-fill: #fee2e2;
          --danger-stroke: #dc2626;
          --neutral-fill: hsl(224, 20%, 96%);
          --neutral-stroke: hsl(224, 7%, 60%);
          --text: hsl(224, 10%, 20%);
          --text-muted: hsl(224, 7%, 40%);
          --arrow: hsl(224, 7%, 45%);
        }
      }

      .box-container { fill: var(--container-fill); stroke: var(--container-stroke); }
      .box-primary { fill: var(--primary-fill); stroke: var(--primary-stroke); }
      .box-secondary { fill: var(--secondary-fill); stroke: var(--secondary-stroke); }
      .box-nested { fill: var(--nested-fill); stroke: var(--nested-stroke); }
      .box-info { fill: var(--info-fill); stroke: var(--info-stroke); }
      .box-success { fill: var(--success-fill); stroke: var(--success-stroke); }
      .box-warning { fill: var(--warning-fill); stroke: var(--warning-stroke); }
      .box-danger { fill: var(--danger-fill); stroke: var(--danger-stroke); }
      .box-neutral { fill: var(--neutral-fill); stroke: var(--neutral-stroke); }
      .label { fill: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
      .sublabel { fill: var(--text-muted); font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
      .arrow-line { stroke: var(--arrow); fill: none; stroke-width: 1.5; }
      .arrow-line-dashed { stroke: var(--arrow); fill: none; stroke-width: 1.5; stroke-dasharray: 6,4; }
      .arrow-head { fill: var(--arrow); }
      .arrow-label { fill: var(--text-muted); font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; font-size: 11px; }
    </style>`;
}

function renderBox(box: Box): string {
  const styleClass = `box-${box.style}`;
  const rx = box.style === "container" ? 12 : 8;
  const strokeWidth = 1;
  const strokeDash = box.style === "container" ? ' stroke-dasharray="4,3"' : "";

  const lines: string[] = [];
  lines.push(
    `  <rect class="${styleClass}" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${rx}" stroke-width="${strokeWidth}"${strokeDash} />`,
  );

  // Label positioning
  if (box.style === "container") {
    // Container label at top-left inside
    lines.push(
      `  <text class="sublabel" x="${box.x + 20}" y="${box.y + 20}" font-size="11" font-weight="500">${escapeXml(box.label)}</text>`,
    );
  } else if (box.labelTop && box.sublabel) {
    // Labels pinned to top (for boxes containing nested children)
    const labelY = box.y + 22;
    const sublabelY = box.y + 36;
    lines.push(
      `  <text class="label" x="${box.x + box.w / 2}" y="${labelY}" font-size="14" font-weight="600" text-anchor="middle">${escapeXml(box.label)}</text>`,
    );
    lines.push(
      `  <text class="sublabel" x="${box.x + box.w / 2}" y="${sublabelY}" font-size="11" text-anchor="middle">${escapeXml(box.sublabel)}</text>`,
    );
  } else if (box.sublabel) {
    // Two-line: label + sublabel, vertically centered
    const labelY = box.y + box.h / 2 - 4;
    const sublabelY = box.y + box.h / 2 + 12;
    lines.push(
      `  <text class="label" x="${box.x + box.w / 2}" y="${labelY}" font-size="14" font-weight="600" text-anchor="middle">${escapeXml(box.label)}</text>`,
    );
    lines.push(
      `  <text class="sublabel" x="${box.x + box.w / 2}" y="${sublabelY}" font-size="11" text-anchor="middle">${escapeXml(box.sublabel)}</text>`,
    );
  } else {
    // Single label, centered
    const labelY = box.y + box.h / 2 + 5;
    lines.push(
      `  <text class="label" x="${box.x + box.w / 2}" y="${labelY}" font-size="14" font-weight="600" text-anchor="middle">${escapeXml(box.label)}</text>`,
    );
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Architecture diagram (unchanged shape — preserved exactly)
// ---------------------------------------------------------------------------

const ARCH_WIDTH = 720;
const ARCH_HEIGHT = 480;

const archBoxes: Box[] = [
  {
    id: "machine",
    label: "Developer Machine",
    sublabel: "",
    x: 16,
    y: 16,
    w: ARCH_WIDTH - 32,
    h: ARCH_HEIGHT - 32,
    style: "container",
  },
  {
    id: "cli",
    label: "rauf CLI",
    sublabel: "(global binary)",
    x: 40,
    y: 60,
    w: 150,
    h: 64,
    style: "primary",
  },
  {
    id: "web",
    label: "rauf web server",
    sublabel: "Hono + Bun @ 127.0.0.1:5173",
    x: 370,
    y: 60,
    w: 296,
    h: 108,
    style: "primary",
    labelTop: true,
  },
  {
    id: "spa",
    label: "React SPA",
    sublabel: "TanStack Router + Query",
    x: 384,
    y: 108,
    w: 268,
    h: 48,
    style: "nested",
  },
  {
    id: "core",
    label: "packages/core",
    sublabel: "discovery · installer · backlog · status · config · profile · template",
    x: 40,
    y: 210,
    w: 560,
    h: 64,
    style: "primary",
  },
  {
    id: "fs",
    label: "ROOT_DIRECTORY filesystem",
    sublabel: "~/workspace/ — project-a/.rauf.json, .rauf/ …  project-b/.rauf.json, .rauf/ …",
    x: 40,
    y: 310,
    w: 560,
    h: 64,
    style: "secondary",
  },
  {
    id: "dotrauf",
    label: "~/.rauf/",
    sublabel: "Tool config, server PID, logs",
    x: 40,
    y: 404,
    w: 296,
    h: 48,
    style: "secondary",
  },
];

const archArrows: Arrow[] = [
  { from: { x: 190, y: 92 }, to: { x: 370, y: 92 }, label: "HTTP", dashed: true },
  { from: { x: 115, y: 124 }, to: { x: 115, y: 210 }, label: "direct calls (headless)" },
  { from: { x: 518, y: 168 }, to: { x: 518, y: 210 } },
  { from: { x: 320, y: 274 }, to: { x: 320, y: 310 } },
];

function renderArchArrow(arrow: Arrow): string {
  const { from, to } = arrow;
  const lines: string[] = [];
  const lineClass = arrow.dashed ? "arrow-line-dashed" : "arrow-line";
  const isHorizontal = Math.abs(to.y - from.y) < Math.abs(to.x - from.x);

  if (arrow.dashed && isHorizontal) {
    const headSize = 6;
    lines.push(
      `  <polygon class="arrow-head" points="${from.x},${from.y} ${from.x + headSize},${from.y - headSize / 2} ${from.x + headSize},${from.y + headSize / 2}" />`,
    );
    lines.push(
      `  <polygon class="arrow-head" points="${to.x},${to.y} ${to.x - headSize},${to.y - headSize / 2} ${to.x - headSize},${to.y + headSize / 2}" />`,
    );
    lines.push(
      `  <line class="${lineClass}" x1="${from.x + headSize}" y1="${from.y}" x2="${to.x - headSize}" y2="${to.y}" />`,
    );
  } else {
    const headSize = 6;
    lines.push(
      `  <polygon class="arrow-head" points="${to.x},${to.y} ${to.x - headSize / 2},${to.y - headSize} ${to.x + headSize / 2},${to.y - headSize}" />`,
    );
    lines.push(
      `  <line class="${lineClass}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y - headSize}" />`,
    );
  }

  if (arrow.label) {
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    const offset = isHorizontal ? -10 : 0;
    const textAnchor = isHorizontal ? "middle" : "start";
    const labelX = isHorizontal ? midX : midX + 8;
    lines.push(
      `  <text class="arrow-label" x="${labelX}" y="${midY + offset}" text-anchor="${textAnchor}">${escapeXml(arrow.label)}</text>`,
    );
  }

  return lines.join("\n");
}

function generateArchitectureSVG(): string {
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ARCH_WIDTH} ${ARCH_HEIGHT}" width="${ARCH_WIDTH}" height="${ARCH_HEIGHT}">`,
  );
  parts.push(renderCSS());
  parts.push(`  <rect width="${ARCH_WIDTH}" height="${ARCH_HEIGHT}" fill="var(--bg)" rx="4" />`);
  for (const box of archBoxes) parts.push(renderBox(box));
  for (const arrow of archArrows) parts.push(renderArchArrow(arrow));
  parts.push("</svg>");
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Generic connector renderer (any angle, optional elbows, bidirectional)
// ---------------------------------------------------------------------------

const HEAD = 7;

function arrowHead(tip: Point, angle: number): string {
  const a1 = angle + Math.PI - 0.42;
  const a2 = angle + Math.PI + 0.42;
  const p1 = { x: tip.x + HEAD * Math.cos(a1), y: tip.y + HEAD * Math.sin(a1) };
  const p2 = { x: tip.x + HEAD * Math.cos(a2), y: tip.y + HEAD * Math.sin(a2) };
  return `  <polygon class="arrow-head" points="${r(tip.x)},${r(tip.y)} ${r(p1.x)},${r(p1.y)} ${r(p2.x)},${r(p2.y)}" />`;
}

function renderConnector(c: Connector): string {
  const pts: Point[] = c.path ?? [c.from!, c.to!];
  const lines: string[] = [];
  const lineClass = c.dashed ? "arrow-line-dashed" : "arrow-line";

  // Direction of the final segment (line enters the destination here).
  const pen = pts[pts.length - 1]!;
  const prev = pts[pts.length - 2]!;
  const endAngle = Math.atan2(pen.y - prev.y, pen.x - prev.x);

  // Trim the polyline back from each arrowhead tip so the stroke meets the base.
  const drawn = pts.map((p) => ({ x: p.x, y: p.y }));
  const lastDrawn = drawn[drawn.length - 1]!;
  lastDrawn.x = pen.x - HEAD * Math.cos(endAngle);
  lastDrawn.y = pen.y - HEAD * Math.sin(endAngle);

  if (c.bidir) {
    const head = pts[0]!;
    const next = pts[1]!;
    const startAngle = Math.atan2(head.y - next.y, head.x - next.x);
    const firstDrawn = drawn[0]!;
    firstDrawn.x = head.x - HEAD * Math.cos(startAngle);
    firstDrawn.y = head.y - HEAD * Math.sin(startAngle);
    lines.push(arrowHead(head, startAngle));
  }

  lines.push(arrowHead(pen, endAngle));
  const polyPoints = drawn.map((p) => `${r(p.x)},${r(p.y)}`).join(" ");
  lines.push(`  <polyline class="${lineClass}" points="${polyPoints}" />`);

  if (c.label) {
    // Anchor the label on the middle segment of the path.
    const midIdx = Math.floor((pts.length - 1) / 2);
    const a = pts[midIdx]!;
    const b = pts[midIdx + 1] ?? a;
    const mx = (a.x + b.x) / 2 + (c.labelOffset?.dx ?? 0);
    const my = (a.y + b.y) / 2 + (c.labelOffset?.dy ?? -6);
    const anchor = c.labelAnchor ?? "middle";
    lines.push(
      `  <text class="arrow-label" x="${r(mx)}" y="${r(my)}" text-anchor="${anchor}">${escapeXml(c.label)}</text>`,
    );
  }

  return lines.join("\n");
}

function renderDiagram(d: Diagram): string {
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${d.width} ${d.height}" width="${d.width}" height="${d.height}">`,
  );
  parts.push(renderCSS());
  parts.push(`  <rect width="${d.width}" height="${d.height}" fill="var(--bg)" rx="4" />`);
  for (const box of d.boxes) parts.push(renderBox(box));
  for (const c of d.connectors ?? []) parts.push(renderConnector(c));
  parts.push("</svg>");
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Diagram: loop lifecycle (one iteration, as a closed cycle)
// ---------------------------------------------------------------------------

const loopLifecycle: Diagram = {
  name: "loop-lifecycle",
  width: 760,
  height: 360,
  boxes: [
    // Top row (forward path), left → right
    {
      id: "select",
      label: "Select item",
      sublabel: "next pending → in_progress",
      x: 40,
      y: 40,
      w: 160,
      h: 58,
      style: "primary",
    },
    {
      id: "prompt",
      label: "Build prompt",
      sublabel: "RAUF.md + item + criteria",
      x: 300,
      y: 40,
      w: 160,
      h: 58,
      style: "primary",
    },
    {
      id: "spawn",
      label: "Spawn agent",
      sublabel: "Claude Code session",
      x: 560,
      y: 40,
      w: 160,
      h: 58,
      style: "primary",
    },
    // Bottom row (continues the cycle), right → left
    {
      id: "signal",
      label: "Parse signal",
      sublabel: "DONE · BLOCKED · NEEDS_HUMAN · REVIEW",
      x: 540,
      y: 180,
      w: 180,
      h: 58,
      style: "primary",
    },
    {
      id: "commit",
      label: "Verify & commit",
      sublabel: "runner commits [rauf] <id>",
      x: 300,
      y: 180,
      w: 160,
      h: 58,
      style: "primary",
    },
    {
      id: "advance",
      label: "Advance",
      sublabel: "mark done → next item",
      x: 40,
      y: 180,
      w: 160,
      h: 58,
      style: "primary",
    },
    // Terminal outcomes
    {
      id: "complete",
      label: "Complete",
      sublabel: "backlog empty",
      x: 40,
      y: 290,
      w: 160,
      h: 48,
      style: "success",
    },
    {
      id: "pause",
      label: "Loop pauses",
      sublabel: "Blocked · Needs Human · Limit",
      x: 500,
      y: 290,
      w: 220,
      h: 48,
      style: "warning",
    },
  ],
  connectors: [
    // Forward path
    { from: { x: 200, y: 69 }, to: { x: 300, y: 69 } },
    { from: { x: 460, y: 69 }, to: { x: 560, y: 69 } },
    // Right side down (spawn → signal)
    {
      from: { x: 640, y: 98 },
      to: { x: 640, y: 180 },
      label: "exits",
      labelOffset: { dx: 6, dy: 4 },
      labelAnchor: "start",
    },
    // Bottom row right → left
    { from: { x: 540, y: 209 }, to: { x: 460, y: 209 } },
    { from: { x: 300, y: 209 }, to: { x: 200, y: 209 } },
    // Left side up (advance → select): closes the cycle
    {
      from: { x: 120, y: 180 },
      to: { x: 120, y: 98 },
      label: "next pending",
      labelOffset: { dx: 6, dy: 4 },
      labelAnchor: "start",
    },
    // Terminal branches
    {
      from: { x: 120, y: 238 },
      to: { x: 120, y: 290 },
      label: "empty",
      labelOffset: { dx: 6, dy: 2 },
      labelAnchor: "start",
    },
    {
      from: { x: 630, y: 238 },
      to: { x: 630, y: 290 },
      label: "stop signal",
      labelOffset: { dx: 6, dy: 2 },
      labelAnchor: "start",
    },
  ],
};

// ---------------------------------------------------------------------------
// Diagram: observation model (the file substrate; CANON §4.2)
// ---------------------------------------------------------------------------

const observationModel: Diagram = {
  name: "observation-model",
  width: 760,
  height: 420,
  boxes: [
    {
      id: "runner",
      label: "Loop runner",
      sublabel: "loop run  ·  loop run --detached",
      x: 280,
      y: 24,
      w: 200,
      h: 54,
      style: "primary",
    },
    {
      id: "substrate",
      label: "<backlog>/.rauf/ — observation substrate (files on disk)",
      x: 40,
      y: 120,
      w: 680,
      h: 112,
      style: "container",
      labelTop: false,
    },
    {
      id: "state",
      label: "state.json",
      sublabel: "loop state + iteration",
      x: 60,
      y: 156,
      w: 150,
      h: 56,
      style: "secondary",
    },
    {
      id: "events",
      label: "events.ndjson",
      sublabel: "versioned event log",
      x: 225,
      y: 156,
      w: 150,
      h: 56,
      style: "info",
    },
    {
      id: "iterstatus",
      label: "iteration-status.json",
      sublabel: "tokens · tools · stuck",
      x: 390,
      y: 156,
      w: 160,
      h: 56,
      style: "secondary",
    },
    {
      id: "log",
      label: "rauf.log",
      sublabel: "human log",
      x: 565,
      y: 156,
      w: 135,
      h: 56,
      style: "secondary",
    },
    {
      id: "cli",
      label: "CLI",
      sublabel: "status · follow · log · progress",
      x: 40,
      y: 300,
      w: 200,
      h: 60,
      style: "primary",
    },
    {
      id: "web",
      label: "Web dashboard",
      sublabel: "live status + recovery",
      x: 280,
      y: 300,
      w: 200,
      h: 60,
      style: "primary",
    },
    {
      id: "pipeline",
      label: "External pipeline",
      sublabel: "--json · --ndjson",
      x: 520,
      y: 300,
      w: 200,
      h: 60,
      style: "primary",
    },
  ],
  connectors: [
    {
      from: { x: 380, y: 78 },
      to: { x: 380, y: 120 },
      label: "appends / writes",
      labelOffset: { dx: 8, dy: 2 },
      labelAnchor: "start",
    },
    {
      from: { x: 140, y: 232 },
      to: { x: 140, y: 300 },
      label: "reads",
      labelOffset: { dx: 8, dy: 0 },
      labelAnchor: "start",
    },
    {
      from: { x: 380, y: 232 },
      to: { x: 380, y: 300 },
      label: "reconstruct view from files",
      labelOffset: { dx: 8, dy: 0 },
      labelAnchor: "start",
    },
    {
      from: { x: 620, y: 232 },
      to: { x: 620, y: 300 },
      label: "reads",
      labelOffset: { dx: 8, dy: 0 },
      labelAnchor: "start",
    },
  ],
};

// ---------------------------------------------------------------------------
// Diagram: execution modes (in-process vs detached; same files, same observers)
// ---------------------------------------------------------------------------

const executionModes: Diagram = {
  name: "execution-modes",
  width: 760,
  height: 400,
  boxes: [
    {
      id: "cmd-fg",
      label: "rauf loop run <path>",
      x: 70,
      y: 30,
      w: 280,
      h: 46,
      style: "neutral",
    },
    {
      id: "cmd-bg",
      label: "rauf loop run <path> --detached",
      x: 410,
      y: 30,
      w: 280,
      h: 46,
      style: "neutral",
    },
    {
      id: "fg",
      label: "In-process (foreground)",
      sublabel: "blocks terminal · unattended-safe",
      x: 100,
      y: 110,
      w: 220,
      h: 64,
      style: "primary",
    },
    {
      id: "daemon",
      label: "Server daemon",
      sublabel: "auto-starts",
      x: 440,
      y: 102,
      w: 220,
      h: 40,
      style: "secondary",
    },
    {
      id: "bg",
      label: "Runner (server-owned)",
      sublabel: "returns immediately · loop stop",
      x: 440,
      y: 162,
      w: 220,
      h: 52,
      style: "primary",
    },
    {
      id: "substrate",
      label: "Same files",
      sublabel: "events.ndjson · state.json · iteration-status.json · rauf.log",
      x: 120,
      y: 256,
      w: 520,
      h: 56,
      style: "info",
    },
    {
      id: "observers",
      label: "status · follow · log · web",
      sublabel: "observationally identical (the mode is hidden)",
      x: 120,
      y: 340,
      w: 520,
      h: 50,
      style: "container",
      labelTop: true,
    },
  ],
  connectors: [
    { from: { x: 210, y: 76 }, to: { x: 210, y: 110 } },
    { from: { x: 550, y: 76 }, to: { x: 550, y: 102 } },
    { from: { x: 550, y: 142 }, to: { x: 550, y: 162 } },
    {
      from: { x: 210, y: 174 },
      to: { x: 300, y: 256 },
      label: "writes",
      labelOffset: { dx: -6, dy: 0 },
      labelAnchor: "end",
    },
    {
      from: { x: 550, y: 214 },
      to: { x: 460, y: 256 },
      label: "writes",
      labelOffset: { dx: 6, dy: 0 },
      labelAnchor: "start",
    },
    {
      from: { x: 380, y: 312 },
      to: { x: 380, y: 340 },
      label: "read from files",
      labelOffset: { dx: 8, dy: 0 },
      labelAnchor: "start",
    },
  ],
};

// ---------------------------------------------------------------------------
// Diagram: status state machine (CANON §4.3 derived vocabulary)
// ---------------------------------------------------------------------------

const statusStates: Diagram = {
  name: "status-states",
  width: 880,
  height: 360,
  boxes: [
    {
      id: "running",
      label: "Running",
      sublabel: "RUNNING",
      x: 350,
      y: 150,
      w: 160,
      h: 56,
      style: "info",
    },
    { id: "idle", label: "Idle", sublabel: "IDLE", x: 40, y: 150, w: 150, h: 56, style: "neutral" },
    {
      id: "complete",
      label: "Complete",
      sublabel: "COMPLETE",
      x: 700,
      y: 150,
      w: 150,
      h: 56,
      style: "success",
    },
    {
      id: "reviewing",
      label: "Reviewing",
      sublabel: "REVIEWING",
      x: 355,
      y: 40,
      w: 150,
      h: 50,
      style: "info",
    },
    {
      id: "error",
      label: "Error",
      sublabel: "ERROR",
      x: 690,
      y: 40,
      w: 160,
      h: 50,
      style: "danger",
    },
    {
      id: "paused",
      label: "Paused",
      sublabel: "PAUSED",
      x: 60,
      y: 274,
      w: 150,
      h: 54,
      style: "info",
    },
    {
      id: "needshuman",
      label: "Needs Human",
      sublabel: "PAUSED_HUMAN",
      x: 345,
      y: 274,
      w: 170,
      h: 54,
      style: "warning",
    },
    {
      id: "limits",
      label: "Limit / Sleeping",
      sublabel: "LIMIT_REACHED · SLEEPING · WEEKLY · USAGE",
      x: 620,
      y: 274,
      w: 230,
      h: 54,
      style: "warning",
    },
  ],
  connectors: [
    { from: { x: 190, y: 178 }, to: { x: 350, y: 178 }, label: "loop run" },
    { from: { x: 510, y: 178 }, to: { x: 700, y: 178 }, label: "complete" },
    {
      from: { x: 425, y: 150 },
      to: { x: 425, y: 90 },
      bidir: true,
      label: "--review / done",
      labelOffset: { dx: 8, dy: 4 },
      labelAnchor: "start",
    },
    {
      from: { x: 505, y: 158 },
      to: { x: 710, y: 88 },
      bidir: true,
      label: "crash / reset",
      labelOffset: { dx: 0, dy: -4 },
    },
    {
      from: { x: 430, y: 206 },
      to: { x: 430, y: 274 },
      bidir: true,
      label: "needs-human / resume --answer",
      labelOffset: { dx: 8, dy: -10 },
      labelAnchor: "start",
    },
    {
      from: { x: 380, y: 206 },
      to: { x: 220, y: 274 },
      bidir: true,
      label: "stop / resume",
      labelOffset: { dx: -6, dy: 0 },
      labelAnchor: "end",
    },
    {
      from: { x: 490, y: 206 },
      to: { x: 700, y: 274 },
      bidir: true,
      label: "limit / resume",
      labelOffset: { dx: 10, dy: 14 },
      labelAnchor: "start",
    },
  ],
};

// ---------------------------------------------------------------------------
// Diagram: package dependency graph (core ← loop ← cli/web)
// ---------------------------------------------------------------------------

const packageGraph: Diagram = {
  name: "package-graph",
  width: 760,
  height: 400,
  boxes: [
    {
      id: "cli",
      label: "packages/cli",
      sublabel: "commands · CLI binary",
      x: 90,
      y: 60,
      w: 180,
      h: 60,
      style: "primary",
    },
    {
      id: "web",
      label: "packages/web",
      sublabel: "Hono API + React SPA",
      x: 490,
      y: 60,
      w: 180,
      h: 60,
      style: "primary",
    },
    {
      id: "loop",
      label: "packages/loop",
      sublabel: "LoopRunner · events · signal parser",
      x: 270,
      y: 190,
      w: 220,
      h: 60,
      style: "primary",
    },
    {
      id: "core",
      label: "packages/core",
      sublabel: "discovery · installer · backlog · status · config",
      x: 250,
      y: 310,
      w: 260,
      h: 60,
      style: "secondary",
    },
  ],
  connectors: [
    {
      from: { x: 240, y: 120 },
      to: { x: 330, y: 190 },
      label: "imports",
      labelOffset: { dx: -6, dy: 0 },
      labelAnchor: "end",
    },
    {
      from: { x: 520, y: 120 },
      to: { x: 430, y: 190 },
      label: "imports",
      labelOffset: { dx: 6, dy: 0 },
      labelAnchor: "start",
    },
    {
      from: { x: 380, y: 250 },
      to: { x: 380, y: 310 },
      label: "imports",
      labelOffset: { dx: 8, dy: 0 },
      labelAnchor: "start",
    },
    // cli/web also depend on core directly (routed down the outer edges)
    {
      path: [
        { x: 130, y: 120 },
        { x: 130, y: 340 },
        { x: 250, y: 340 },
      ],
      dashed: true,
      label: "+ core",
      labelOffset: { dx: 0, dy: -6 },
    },
    {
      path: [
        { x: 630, y: 120 },
        { x: 630, y: 340 },
        { x: 510, y: 340 },
      ],
      dashed: true,
      label: "+ core",
      labelOffset: { dx: 0, dy: -6 },
    },
  ],
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function writeSvg(filename: string, svg: string): void {
  const outputPath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(outputPath, svg + "\n", "utf-8");
  // eslint-disable-next-line no-console
  console.log(`Generated ${outputPath} (${svg.length} bytes)`);
}

function main(): void {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  writeSvg("architecture.svg", generateArchitectureSVG());
  writeSvg("loop-lifecycle.svg", renderDiagram(loopLifecycle));
  writeSvg("observation-model.svg", renderDiagram(observationModel));
  writeSvg("execution-modes.svg", renderDiagram(executionModes));
  writeSvg("status-states.svg", renderDiagram(statusStates));
  writeSvg("package-graph.svg", renderDiagram(packageGraph));
}

main();
