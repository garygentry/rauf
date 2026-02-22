# Plan: Replace ASCII Diagrams with Generated SVGs

## Context

The Starlight docs site renders ASCII box-drawing diagrams with proportional fonts, causing misaligned lines (see `screenshots/docs-ascii.png`). The main offender is the 34-line system architecture diagram in `docs/ARCHITECTURE.md`. The user wants generated images that match the Starlight site aesthetic — clean, modern, not blocky. Mermaid is explicitly rejected as overkill.

## Approach: Bun Script → SVG

Write a TypeScript generator script (`scripts/generate-diagrams.ts`) that produces SVG files from structured diagram definitions. This follows the project's existing pattern (`scripts/generate-embedded-artifacts.ts`).

**Why SVG over PNG:**
- Vector — crisp at any zoom/DPI
- Tiny file size (~4KB vs ~50KB+ for PNG)
- Git-diffable (it's just XML)
- Can embed CSS `@media (prefers-color-scheme)` for automatic dark/light theming

**Why a script over hand-drawn or libraries:**
- Reproducible: change data, re-run, get updated diagram
- No external dependencies (just Bun + string templates)
- Full control over every pixel of styling

## Which diagrams to replace

| Diagram | File | Action |
|---------|------|--------|
| System Architecture (34 lines) | `docs/ARCHITECTURE.md:8-41` | **Replace with SVG** — the main problem |
| Package dependency (3 lines) | `docs/ARCHITECTURE.md:45-49` | **Leave as-is** — plain text, no box-drawing |
| File inventory tree | `docs/SPEC-ARTIFACTS.md:12-24` | **Leave as-is** — simple tree, fine in code block |
| Repo layout tree | `CONTRIBUTING.md:56-66` | **Leave as-is** — simple tree, fine in code block |

Only the architecture diagram needs replacement. The rest are simple enough that monospace code blocks handle them fine.

## Step 1: Create `scripts/generate-diagrams.ts`

A Bun script that:

1. Defines the architecture diagram as typed data (boxes, arrows, labels)
2. Renders to SVG with embedded CSS for dark/light theme switching
3. Writes to `docs/images/architecture.svg`

### Visual design

- **Rounded rectangles** (8px radius) with 1px borders — matching Starlight card style
- **Color palette** derived from the site's accent tokens:
  - Primary components (CLI, Web Server, Core): blue-tinted fill + blue border
  - Infrastructure (Filesystem, ~/.ralph/): subtle gray fill + gray border
  - Outer container ("Developer Machine"): very subtle frame, not a heavy box
- **Typography**: system font stack (`ui-sans-serif, system-ui, ...`), 14px labels, 11px sublabels
- **Arrows**: clean SVG paths with small filled arrowheads, labels at midpoints
- **Theming**: CSS custom properties with `@media (prefers-color-scheme)` for dark/light

### Layout (720×480)

```
┌─ Developer Machine (subtle container) ─────────────────────┐
│                                                             │
│  ┌─ ralph CLI ─┐   ◄─ HTTP ─►   ┌─ ralph web server ────┐ │
│  │  (global)   │                 │ Hono+Bun@127.0.0.1    │ │
│  └──────┬──────┘                 │  ┌─ React SPA ──────┐ │ │
│         │                        │  │ TanStack Router   │ │ │
│         │ direct calls           │  └──────────────────┘ │ │
│         │ when headless          └──────────┬────────────┘ │
│         │                                   │              │
│         ▼                                   ▼              │
│  ┌─ packages/core ─────────────────────────────────┐       │
│  │ discovery · installer · backlog · status         │       │
│  │ config · profile · template                      │       │
│  └──────────────────────┬──────────────────────────┘       │
│                         ▼                                   │
│  ┌─ ROOT_DIRECTORY filesystem ─────────────────────┐       │
│  │ ~/workspace/                                     │       │
│  │ ├── project-a/.ralph.json, .ralph/, ...          │       │
│  │ └── project-b/.ralph.json, .ralph/, ...          │       │
│  └─────────────────────────────────────────────────┘       │
│                                                             │
│  ┌─ ~/.ralph/ ──────────────────────┐                      │
│  │ Tool config, server PID, logs    │                      │
│  └──────────────────────────────────┘                      │
└─────────────────────────────────────────────────────────────┘
```

### Color tokens (embedded in SVG CSS)

```
Dark mode (default):
  page bg:          hsl(224, 10%, 10%)
  container fill:   hsl(224, 14%, 14%)    container border: hsl(224, 10%, 25%)
  primary fill:     hsl(217, 50%, 18%)    primary border:   #3b82f6
  secondary fill:   hsl(224, 14%, 16%)    secondary border: hsl(224, 6%, 40%)
  text:             hsl(224, 6%, 82%)     text muted:       hsl(224, 6%, 56%)
  arrow:            hsl(224, 6%, 50%)

Light mode (@media prefers-color-scheme: light):
  page bg:          #ffffff
  container fill:   hsl(224, 20%, 97%)    container border: hsl(224, 6%, 82%)
  primary fill:     #dbeafe               primary border:   #2563eb
  secondary fill:   hsl(224, 20%, 96%)    secondary border: hsl(224, 7%, 60%)
  text:             hsl(224, 10%, 20%)    text muted:       hsl(224, 7%, 40%)
  arrow:            hsl(224, 7%, 45%)
```

## Step 2: Update `docs/ARCHITECTURE.md`

Replace the ASCII code block (lines 8-41) with a markdown image:

```markdown
## System Diagram

![System Architecture](images/architecture.svg)
```

The relative path `images/architecture.svg` resolves correctly from both:
- GitHub (relative to `docs/ARCHITECTURE.md` → `docs/images/architecture.svg`)
- Starlight (the image is served from `public/images/`)

## Step 3: Update `scripts/setup-docs.sh`

Add a symlink for the diagram image so Starlight can serve it:

```bash
mkdir -p "$REPO_ROOT/packages/docs/public/images"
ln -sf "$REL/docs/images/architecture.svg" \
  "$REPO_ROOT/packages/docs/public/images/architecture.svg"
```

## Step 4: Add `generate:diagrams` script

Add to root `package.json`:

```json
"generate:diagrams": "bun run scripts/generate-diagrams.ts"
```

## Verification

1. `bun run scripts/generate-diagrams.ts` — generates `docs/images/architecture.svg`
2. `bash scripts/setup-docs.sh` — creates symlink to public/images/
3. `pnpm build:docs` — builds successfully, architecture page shows the SVG
4. Open in browser — verify dark mode looks correct
5. Toggle to light mode — verify light variant looks correct
6. Check `docs/images/architecture.svg` renders on GitHub

## Files Summary

| File | Action |
|------|--------|
| `scripts/generate-diagrams.ts` | Create — SVG generator script |
| `docs/ARCHITECTURE.md` | Replace ASCII block with `![](images/architecture.svg)` |
| `scripts/setup-docs.sh` | Add image symlink to packages/docs/public/images/ |
| `package.json` (root) | Add `generate:diagrams` script |
| `docs/images/architecture.svg` | Generated output |
