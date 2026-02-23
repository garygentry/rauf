# Plan: Web Application Tech Stack & Design Reference Document

## Context

The `packages/web` directory implements a full-stack web application using a specific set of modern tools and patterns. The user wants a standalone reference document that captures the **tech stack, architecture, and design patterns** used — stripped of all application-specific logic — so that another team can adopt the same approach for a completely different system.

## What We're Creating

A single markdown document (`docs/WEB-TECH-STACK.md`) that serves as a portable reference for the web application's technical foundation.

## Document Outline

### 1. Stack Overview
Summary table of every technology and its role (runtime, framework, styling, routing, state, validation, build tooling, testing).

### 2. Project Structure
Generic directory layout showing the client/server split and how files are organized.

### 3. Build & Dev Tooling
- **Vite** — dev server with HMR + production build
- **Bun** — runtime for the API server and build scripts
- **TypeScript** — strict config, JSX transform, workspace references
- **Dev mode** — dual-process launcher (API server on 5173 + Vite on 5174 with `/api` proxy)
- **Production build pipeline** — Vite build → asset embedding → tsc compilation
- **Embedded assets** — how the built SPA is bundled into the server binary as a `Map<string, Buffer>`

### 4. Server Layer (Hono)
- App factory pattern (`createApp()` exported for testing)
- CSRF middleware (custom header on mutations)
- Route mounting and modular router files
- Standardized response envelope (`{ data: T }` / `{ error: { code, message } }`)
- Global error and 404 handlers
- SPA fallback for client-side routing
- localhost-only binding via `Bun.serve()`

### 5. Client Entry & Provider Stack
- React 19 with StrictMode
- Provider nesting order: ThemeProvider → QueryClientProvider → RouterProvider
- The entry point pattern (`main.tsx` mounts to `#root`)

### 6. Routing (TanStack Router)
- `createRootRoute` / `createRoute` / `createRouter` pattern
- Root layout wrapping all routes via `<Outlet />`
- Redirect routes using `beforeLoad` + `throw redirect()`
- Dynamic params (`$id`)
- Type-safe router registration via module augmentation

### 7. Data Fetching (TanStack Query)
- QueryClient defaults (staleTime, retry)
- `useQuery` for reads, `useMutation` for writes
- Query key naming conventions
- Cache invalidation on mutation success
- Adaptive refetch intervals (faster when active state detected)
- Typed fetch wrapper that adds required headers and unwraps `{ data: T }`

### 8. Server-Sent Events (SSE)
- How the server creates a ReadableStream with event types
- Client-side EventSource consumption in React (useEffect cleanup)
- Event types pattern (data, status, heartbeat)

### 9. Theming & Styling
- **Tailwind CSS v4** via Vite plugin (no config file — uses `@theme` in CSS)
- CSS custom properties as design tokens (`--color-surface`, `--color-text`, etc.)
- Light/dark theme via `[data-theme]` attribute on `<html>`
- ThemeProvider context with `useTheme()` hook
- localStorage persistence for theme preference
- System preference detection via `matchMedia`
- Inline `style` props for dynamic/state-driven colors
- Prose styles for rendered markdown (`.ralph-prose` pattern)

### 10. Component Patterns
- No external component library — all built with native HTML + Tailwind
- Badge pattern (config object → inline style colors)
- Card pattern (surface-raised bg, border from CSS vars)
- Layout: sidebar + scrollable main via flexbox
- Form handling: controlled React state (no form library)
- Loading skeletons, empty states, error states
- Emoji characters as icons (no icon library)

### 11. API Client Pattern
- `fetchWrapper()` function that always injects required headers
- `fetchJson<T>()` generic that unwraps the response envelope
- Error extraction from `{ error: { message } }` responses

### 12. Security Patterns
- CSRF: custom header required on all POST/PUT/DELETE
- Path sandboxing: validate all user-supplied paths on server
- localhost-only binding: no external network access
- No CORS headers set (browser blocks cross-origin by default)

### 13. Testing
- Vitest with colocated test files (`*.test.ts` next to source)
- App factory enables isolated integration tests (pass test-specific options)

## Files to Create

| File | Description |
|------|-------------|
| `docs/WEB-TECH-STACK.md` | The complete reference document |

## Verification

- Read through the document to ensure no application-specific references leak in
- Confirm all code examples are generic and reusable
- Ensure version numbers match `package.json`
