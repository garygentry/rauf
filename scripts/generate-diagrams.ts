#!/usr/bin/env bun
/**
 * generate-diagrams.ts
 *
 * Generates SVG diagram files from structured data definitions.
 * Produces docs/images/architecture.svg with embedded CSS for
 * automatic dark/light theme switching via prefers-color-scheme.
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

interface Box {
  id: string;
  label: string;
  sublabel?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  style: "primary" | "secondary" | "container" | "nested";
  /** Position labels at top of box instead of center (for boxes with nested children) */
  labelTop?: boolean;
}

interface Arrow {
  from: { x: number; y: number };
  to: { x: number; y: number };
  label?: string;
  dashed?: boolean;
}

// ---------------------------------------------------------------------------
// Architecture diagram definition
// ---------------------------------------------------------------------------

const WIDTH = 720;
const HEIGHT = 480;

const boxes: Box[] = [
  // Outer container
  {
    id: "machine",
    label: "Developer Machine",
    sublabel: "",
    x: 16,
    y: 16,
    w: WIDTH - 32,
    h: HEIGHT - 32,
    style: "container",
  },

  // CLI
  {
    id: "cli",
    label: "ralph CLI",
    sublabel: "(global binary)",
    x: 40,
    y: 60,
    w: 150,
    h: 64,
    style: "primary",
  },

  // Web server
  {
    id: "web",
    label: "ralph web server",
    sublabel: "Hono + Bun @ 127.0.0.1:5173",
    x: 370,
    y: 60,
    w: 296,
    h: 108,
    style: "primary",
    labelTop: true,
  },

  // React SPA (nested inside web)
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

  // Core
  {
    id: "core",
    label: "packages/core",
    sublabel: "discovery \u00b7 installer \u00b7 backlog \u00b7 status \u00b7 config \u00b7 profile \u00b7 template",
    x: 40,
    y: 210,
    w: 560,
    h: 64,
    style: "primary",
  },

  // Filesystem
  {
    id: "fs",
    label: "ROOT_DIRECTORY filesystem",
    sublabel:
      "~/workspace/ \u2014 project-a/.ralph.json, .ralph/ \u2026  project-b/.ralph.json, .ralph/ \u2026",
    x: 40,
    y: 310,
    w: 560,
    h: 64,
    style: "secondary",
  },

  // ~/.ralph/
  {
    id: "dotralph",
    label: "~/.ralph/",
    sublabel: "Tool config, server PID, logs",
    x: 40,
    y: 404,
    w: 296,
    h: 48,
    style: "secondary",
  },
];

const arrows: Arrow[] = [
  // CLI <--HTTP--> Web
  {
    from: { x: 190, y: 92 },
    to: { x: 370, y: 92 },
    label: "HTTP",
    dashed: true,
  },

  // CLI --> Core
  {
    from: { x: 115, y: 124 },
    to: { x: 115, y: 210 },
    label: "direct calls (headless)",
  },

  // Web --> Core
  {
    from: { x: 518, y: 168 },
    to: { x: 518, y: 210 },
  },

  // Core --> Filesystem
  {
    from: { x: 320, y: 274 },
    to: { x: 320, y: 310 },
  },
];

// ---------------------------------------------------------------------------
// SVG rendering
// ---------------------------------------------------------------------------

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
          --text: hsl(224, 10%, 20%);
          --text-muted: hsl(224, 7%, 40%);
          --arrow: hsl(224, 7%, 45%);
        }
      }

      .box-container { fill: var(--container-fill); stroke: var(--container-stroke); }
      .box-primary { fill: var(--primary-fill); stroke: var(--primary-stroke); }
      .box-secondary { fill: var(--secondary-fill); stroke: var(--secondary-stroke); }
      .box-nested { fill: var(--nested-fill); stroke: var(--nested-stroke); }
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
  const strokeWidth = box.style === "container" ? 1 : 1;
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

function renderArrow(arrow: Arrow): string {
  const { from, to } = arrow;
  const lines: string[] = [];
  const lineClass = arrow.dashed ? "arrow-line-dashed" : "arrow-line";

  // Determine if horizontal or vertical
  const isHorizontal = Math.abs(to.y - from.y) < Math.abs(to.x - from.x);

  if (arrow.dashed && isHorizontal) {
    // Bidirectional horizontal arrow (HTTP)
    const headSize = 6;
    // Left arrowhead (pointing left)
    lines.push(
      `  <polygon class="arrow-head" points="${from.x},${from.y} ${from.x + headSize},${from.y - headSize / 2} ${from.x + headSize},${from.y + headSize / 2}" />`,
    );
    // Right arrowhead (pointing right)
    lines.push(
      `  <polygon class="arrow-head" points="${to.x},${to.y} ${to.x - headSize},${to.y - headSize / 2} ${to.x - headSize},${to.y + headSize / 2}" />`,
    );
    // Line between arrowheads
    lines.push(
      `  <line class="${lineClass}" x1="${from.x + headSize}" y1="${from.y}" x2="${to.x - headSize}" y2="${to.y}" />`,
    );
  } else {
    // Single-direction arrow (downward)
    const headSize = 6;
    // Arrowhead at destination
    lines.push(
      `  <polygon class="arrow-head" points="${to.x},${to.y} ${to.x - headSize / 2},${to.y - headSize} ${to.x + headSize / 2},${to.y - headSize}" />`,
    );
    // Line
    lines.push(
      `  <line class="${lineClass}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y - headSize}" />`,
    );
  }

  // Label at midpoint
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

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function generateArchitectureSVG(): string {
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}">`,
  );
  parts.push(renderCSS());

  // Background
  parts.push(`  <rect width="${WIDTH}" height="${HEIGHT}" fill="var(--bg)" rx="4" />`);

  // Render boxes (order matters for z-index — containers first)
  for (const box of boxes) {
    parts.push(renderBox(box));
  }

  // Render arrows
  for (const arrow of arrows) {
    parts.push(renderArrow(arrow));
  }

  parts.push("</svg>");
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const svgContent = generateArchitectureSVG();
  const outputPath = path.join(OUTPUT_DIR, "architecture.svg");
  fs.writeFileSync(outputPath, svgContent, "utf-8");

  // eslint-disable-next-line no-console
  console.log(`Generated ${outputPath} (${svgContent.length} bytes)`);
}

main();
