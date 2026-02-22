# Plan: Documentation Site with Starlight

## Context

Ralph has ~1,700 lines of specification docs across 7 markdown files in `docs/`, plus `CONTRIBUTING.md` and `README.md`. These are well-written but only viewable on GitHub or in an editor — no search, no navigation sidebar, no polished reading experience. The goal is to add a professional documentation site that serves these existing docs through a proper framework, without duplicating or restructuring the source files.

## Framework Choice: Starlight (Astro)

**Evaluated Docusaurus vs Starlight on simplicity, manageability, and aesthetics.**

| Criterion | Winner | Why |
|-----------|--------|-----|
| Simplicity | **Starlight** | Minimal config, file-based routing, no webpack |
| pnpm workspace compat | **Starlight** | Docusaurus has known pnpm symlink issues (#10751, #11321) |
| Aesthetics | **Starlight** | Expressive-code out of the box, modern defaults, better dark mode |
| Build speed | **Starlight** | Go-based Astro compiler; dev server starts ~50% faster |
| Search | **Starlight** | Pagefind built-in (offline, zero-config) vs Algolia dependency |
| Code highlighting | **Starlight** | expressive-code: line highlighting, filename tabs, WCAG contrast |

Docusaurus's maturity advantage (2017 vs 2023) is irrelevant at this scale. Starlight's symlink support via Vite's `preserveSymlinks` is a documented, working pattern — critical for our "single source of truth" requirement.

## Approach

### Step 1: Add frontmatter to existing docs

Add minimal `title` + `description` frontmatter to each doc file. This is non-breaking — the files remain readable as plain markdown. Also remove the H1 line from each (Starlight renders the title from frontmatter, so keeping the H1 would duplicate it).

Files to modify:
- `docs/ARCHITECTURE.md` — title: "System Architecture"
- `docs/SCHEMAS.md` — title: "Schemas Reference"
- `docs/SPEC-CORE.md` — title: "Core Package"
- `docs/SPEC-CLI.md` — title: "CLI Reference"
- `docs/SPEC-WEB.md` — title: "Web API Reference"
- `docs/SPEC-ARTIFACTS.md` — title: "Artifact Templates"
- `CONTRIBUTING.md` — title: "Contributing"

**Not included:** `CLAUDE.md` and `docs/CLAUDE-CODE-TASKS.md` are agent-facing, not for the public doc site.

### Step 2: Create `packages/docs` package

Directory structure:
```
packages/docs/
├── package.json               @ralph/docs
├── astro.config.mjs           Starlight config + sidebar + Vite symlink support
├── tsconfig.json              Extends astro/tsconfigs/strict
├── public/
│   └── favicon.svg
├── src/
│   ├── content/docs/          Symlinks to source docs (created in Step 3)
│   │   └── introduction/
│   │       └── index.md       Homepage (new content)
│   ├── assets/
│   │   └── ralph-loop.png     Symlink → docs/images/ralph-loop.png
│   └── styles/
│       └── custom.css         Accent color overrides (blue-500 to match web app)
```

Dependencies: `astro` ^5.0.0, `@astrojs/starlight` ^0.37.0

### Step 3: Create symlinks + setup script

Create `scripts/setup-docs.sh` that creates symlinks from `packages/docs/src/content/docs/` to source files. Uses absolute paths with `ln -sf` (idempotent).

| Symlink | Target |
|---------|--------|
| `packages/docs/src/content/docs/architecture.md` | `docs/ARCHITECTURE.md` |
| `packages/docs/src/content/docs/schemas.md` | `docs/SCHEMAS.md` |
| `packages/docs/src/content/docs/spec-core.md` | `docs/SPEC-CORE.md` |
| `packages/docs/src/content/docs/spec-cli.md` | `docs/SPEC-CLI.md` |
| `packages/docs/src/content/docs/spec-web.md` | `docs/SPEC-WEB.md` |
| `packages/docs/src/content/docs/spec-artifacts.md` | `docs/SPEC-ARTIFACTS.md` |
| `packages/docs/src/content/docs/contributing.md` | `CONTRIBUTING.md` |
| `packages/docs/src/assets/ralph-loop.png` | `docs/images/ralph-loop.png` |

The key Vite config that makes symlinks work:
```javascript
vite: { resolve: { preserveSymlinks: true } }
```

### Step 4: Write homepage and config

**`astro.config.mjs`** — Starlight with manual sidebar:
```
Getting Started
  ├── What is Ralph?        (introduction/index)
  └── Contributing          (contributing)
Architecture
  ├── System Architecture   (architecture)
  └── Schemas Reference     (schemas)
Reference
  ├── CLI Reference         (spec-cli)
  ├── Web API Reference     (spec-web)
  ├── Core Package          (spec-core)
  └── Artifact Templates    (spec-artifacts)
```

**Homepage** (`introduction/index.md`) — uses Starlight's `template: splash` hero layout with the loop diagram, tagline, quick-start code block, and CTA buttons. Content mirrors README's value prop but structured for web.

**Custom CSS** — override accent color to blue-500 (`#3b82f6`) for visual continuity with the web dashboard.

### Step 5: Build integration

Add to root `package.json`:
```json
"dev:docs": "pnpm --filter @ralph/docs dev",
"build:docs": "pnpm --filter @ralph/docs build"
```

The default `pnpm -r build` will include docs. This is fine for CI. For local binary compilation, `compile` already uses `pnpm build && bun build --compile` which includes it but Astro builds fast enough that it's not a problem.

### Step 6: Verify

- `pnpm install` picks up new package
- `pnpm dev:docs` starts Astro dev server
- All 7 symlinked pages render with correct titles
- Sidebar navigation matches the planned structure
- Pagefind search indexes all pages
- Code blocks have syntax highlighting (TypeScript, bash, JSON)
- Dark/light mode toggle works
- `pnpm build:docs` produces `packages/docs/dist/`

## Files Summary

| File | Action |
|------|--------|
| `docs/ARCHITECTURE.md` | Add frontmatter, remove H1 |
| `docs/SCHEMAS.md` | Add frontmatter, remove H1 |
| `docs/SPEC-CORE.md` | Add frontmatter, remove H1 |
| `docs/SPEC-CLI.md` | Add frontmatter, remove H1 |
| `docs/SPEC-WEB.md` | Add frontmatter, remove H1 |
| `docs/SPEC-ARTIFACTS.md` | Add frontmatter, remove H1 |
| `CONTRIBUTING.md` | Add frontmatter, remove H1 |
| `packages/docs/package.json` | Create |
| `packages/docs/astro.config.mjs` | Create |
| `packages/docs/tsconfig.json` | Create |
| `packages/docs/src/content/docs/introduction/index.md` | Create (homepage) |
| `packages/docs/src/styles/custom.css` | Create |
| `packages/docs/public/favicon.svg` | Create |
| `scripts/setup-docs.sh` | Create (symlink setup) |
| `package.json` (root) | Add `dev:docs`, `build:docs` scripts |
