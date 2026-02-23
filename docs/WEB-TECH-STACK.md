# Web Application Tech Stack & Design Reference

A portable reference for building a full-stack web application using this architecture. All examples are generic and stripped of application-specific logic so another team can adopt the same approach for a completely different system.

---

## 1. Stack Overview

| Layer | Technology | Version | Role |
|-------|-----------|---------|------|
| Runtime | **Bun** | ^1.2.0 | Server runtime, build scripts, single-binary compilation |
| Package manager | **pnpm** | workspace | Monorepo workspace management |
| Server framework | **Hono** | ^4.7.0 | Lightweight HTTP server with middleware and routing |
| Frontend framework | **React** | ^19.0.0 | UI rendering (with `react-dom`) |
| Routing | **TanStack Router** | ^1.100.0 | Type-safe client-side routing |
| Data fetching | **TanStack Query** | ^5.65.0 | Server state management, caching, mutations |
| Styling | **Tailwind CSS** | ^4.0.0 | Utility-first CSS (v4, Vite plugin, `@theme` blocks) |
| Validation | **Zod** | ^3.24.0 | Runtime schema validation for API inputs |
| Markdown | **react-markdown** + **remark-gfm** | ^9.0.0 / ^4.0.0 | Render markdown content with GFM support |
| Build tool | **Vite** | ^6.1.0 | Dev server with HMR + production SPA bundler |
| TypeScript | **typescript** | ^5.7.0 | Strict type checking, JSX transform |
| Testing | **Vitest** | ^3.0.0 | Test runner, colocated test files |
| Linting | **ESLint** | ^9.0.0 | Code quality |
| Formatting | **Prettier** | (workspace root) | Consistent code formatting |

---

## 2. Project Structure

```
packages/web/
├── src/
│   ├── server/                    # API server (Hono)
│   │   ├── app.ts                 # App factory, CSRF middleware, error handling
│   │   ├── start.ts               # Server startup, embedded asset serving, SPA fallback
│   │   ├── index.ts               # Entry point (calls startServer())
│   │   ├── embedded-assets.ts     # Auto-generated: SPA assets as Map<string, string>
│   │   └── routes/
│   │       ├── projects.ts        # CRUD routes
│   │       ├── status.ts          # Status + SSE streaming
│   │       └── profile-config.ts  # Config endpoints
│   ├── client/                    # React SPA
│   │   ├── main.tsx               # Entry point, provider stack, mounts to #root
│   │   ├── index.css              # Tailwind v4 import, @theme tokens, prose styles
│   │   ├── router.tsx             # TanStack Router route tree
│   │   ├── lib/
│   │   │   ├── fetch.ts           # Typed fetch wrapper with header injection
│   │   │   └── query-client.ts    # QueryClient singleton with defaults
│   │   ├── components/
│   │   │   ├── Layout.tsx         # Shell: sidebar + scrollable main
│   │   │   ├── Sidebar.tsx        # Navigation links + theme toggle
│   │   │   └── ThemeProvider.tsx   # Dark/light/system theme context
│   │   └── routes/                # Route components (one file per view)
│   │       ├── settings.tsx
│   │       └── projects/
│   │           ├── index.tsx      # Dashboard
│   │           ├── items.tsx       # Item management
│   │           ├── status.tsx     # Live status + SSE log viewer
│   │           └── settings.tsx   # Project config
│   └── dev.ts                     # Dual-process dev launcher (API + Vite)
├── build/                         # Vite output (gitignored)
├── dist/                          # tsc output (gitignored)
├── index.html                     # Vite HTML entry
├── vite.config.ts
├── vitest.config.ts
├── tsconfig.json
└── package.json
```

---

## 3. Build & Dev Tooling

### TypeScript Configuration

The web package extends a base `tsconfig.json` and adds DOM + JSX support:

```jsonc
// packages/web/tsconfig.json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"],
  "exclude": ["src/**/*.test.ts", "src/**/*.test.tsx", "node_modules", "dist", "build"],
  "references": [{ "path": "../core" }]
}
```

The base config enforces strict TypeScript:

```jsonc
// tsconfig.json (root)
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "types": ["bun-types"]
  }
}
```

### Vite Configuration

```ts
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: ".",
  build: {
    outDir: "build",
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5173",
        changeOrigin: false,
      },
    },
  },
});
```

### Dev Mode — Dual-Process Launcher

A single `bun run src/dev.ts` starts both processes:

- **API server** on port `5173` — Hono serving API routes
- **Vite dev server** on port `5174` — React SPA with HMR, proxying `/api/*` to 5173

The launcher uses `Bun.spawn` for both processes, pipes their stdout/stderr with color-coded prefixes (`[api]` in cyan, `[vite]` in magenta), and handles clean shutdown on SIGINT/SIGTERM. If either process exits unexpectedly, the other is killed.

```ts
// src/dev.ts — simplified structure
const apiProc = Bun.spawn(["bun", "run", "src/server/index.ts"], {
  cwd: import.meta.dir + "/..",
  stdout: "pipe",
  stderr: "pipe",
});

const viteProc = Bun.spawn(["./node_modules/.bin/vite"], {
  cwd: import.meta.dir + "/..",
  stdout: "pipe",
  stderr: "pipe",
});

// Pipe output with color-coded prefixes
pipeWithPrefix(apiProc.stdout, "[api]  ");
pipeWithPrefix(viteProc.stdout, "[vite] ");

// Clean shutdown
process.on("SIGINT", () => { apiProc.kill(); viteProc.kill(); process.exit(0); });
```

### Production Build Pipeline

The build script chains four steps:

```bash
vite build && bun run scripts/generate-embedded-assets.ts && prettier --write src/server/embedded-assets.ts && tsc
```

| Step | Command | Output |
|------|---------|--------|
| 1. Bundle SPA | `vite build` | `build/` — `index.html` + `assets/*.js` + `assets/*.css` |
| 2. Embed assets | `bun run scripts/generate-embedded-assets.ts` | `src/server/embedded-assets.ts` |
| 3. Format | `prettier --write` | Clean up generated file |
| 4. Compile server | `tsc` | `dist/` — compiled server + type declarations |

### Embedded Assets Pattern

The generated `embedded-assets.ts` reads every file from `build/` and emits them as a `Map<string, string>`:

```ts
// Auto-generated — do not edit manually
export const EMBEDDED_ASSETS: ReadonlyMap<string, string> = new Map([
  ["index.html", `<!doctype html>...`],
  ["assets/index-abc123.js", `(function(){...})()`],
  ["assets/index-abc123.css", `.btn{color:red}`],
]);

export function getAssetMimeType(assetPath: string): string {
  const ext = "." + assetPath.split(".").pop();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}
```

This makes the server binary fully self-contained — it serves the SPA from memory without needing the `build/` directory at runtime.

---

## 4. Server Layer (Hono)

### App Factory Pattern

The server exports a `createApp()` factory function. The default instance is used in production; tests call `createApp()` with overrides:

```ts
// src/server/app.ts
export interface AppOptions {
  rootDirectory?: string; // Override for tests
}

export function createApp(startedAt: number = Date.now(), appOptions: AppOptions = {}) {
  const app = new Hono();

  // Middleware, routes, error handlers...

  return app;
}

// Default instance for the server entry point
export const app = createApp();
```

### CSRF Middleware

All mutation requests (POST, PUT, DELETE) require a custom header. This runs at the app level before any route matching:

```ts
app.use("*", async (c, next) => {
  const method = c.req.method;
  if (method === "POST" || method === "PUT" || method === "DELETE") {
    const header = c.req.header("X-Request");
    if (header !== "true") {
      return c.json(
        errorResponse("FORBIDDEN", "X-Request: true header is required for mutation requests"),
        403,
      );
    }
  }
  await next();
});
```

### Response Envelope

All API responses use a consistent envelope:

```ts
// Success
{ "data": T }

// Error
{ "error": { "code": "NOT_FOUND", "message": "...", "details?": unknown } }
```

Helper function:

```ts
export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export function errorResponse(code: string, message: string, details?: unknown) {
  const error: ApiError = { code, message };
  if (details !== undefined) error.details = details;
  return { error };
}
```

### Route Mounting

Modular routers are mounted under a shared prefix:

```ts
app.route("/api/projects", createProjectsRouter(appOptions.rootDirectory));
app.route("/api/projects", createStatusRouter(appOptions.rootDirectory));
app.route("/api/config", createConfigRouter());
```

Each router is a function that returns a `Hono` instance, accepting optional dependency overrides.

### Global Error & 404 Handlers

```ts
app.onError((err, c) => {
  return c.json(errorResponse("INTERNAL_ERROR", err.message), 500);
});

app.notFound((c) => {
  return c.json(errorResponse("NOT_FOUND", `Route not found: ${c.req.method} ${c.req.path}`), 404);
});
```

### SPA Fallback & Static Asset Serving

In production, non-API routes serve embedded assets. Unknown paths fall back to `index.html` for client-side routing:

```ts
app.get("/*", (c) => {
  let assetPath = c.req.path.slice(1);
  if (!assetPath || assetPath === "") assetPath = "index.html";

  const content = EMBEDDED_ASSETS.get(assetPath);
  if (content !== undefined) {
    return c.body(content, 200, {
      "Content-Type": getAssetMimeType(assetPath),
      "Cache-Control": assetPath.startsWith("assets/")
        ? "public, max-age=31536000, immutable"  // Hashed filenames → immutable cache
        : "no-cache",
    });
  }

  // SPA fallback: serve index.html for client-side routing
  const indexHtml = EMBEDDED_ASSETS.get("index.html");
  if (indexHtml !== undefined) {
    return c.body(indexHtml, 200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    });
  }

  return c.notFound();
});
```

### Server Binding

```ts
Bun.serve({
  hostname: "127.0.0.1",  // Localhost only — no external network access
  port: 5173,
  fetch: app.fetch,
});
```

---

## 5. Client Entry & Provider Stack

```tsx
// src/client/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "./components/ThemeProvider";
import { queryClient } from "./lib/query-client";
import { router } from "./router";
import "./index.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </ThemeProvider>
    </StrictMode>,
  );
}
```

**Provider nesting order** (outermost → innermost):

1. `StrictMode` — React 19 development checks
2. `ThemeProvider` — dark/light/system theme context
3. `QueryClientProvider` — TanStack Query cache
4. `RouterProvider` — TanStack Router

The theme provider wraps everything so any component (including router-rendered views) can access theme state. The query provider wraps the router so route components can use `useQuery`/`useMutation`.

---

## 6. Routing (TanStack Router)

### Route Definitions

```tsx
// src/client/router.tsx
import {
  createRootRoute, createRoute, createRouter,
  redirect, Outlet,
} from "@tanstack/react-router";

// Root route wraps all pages in the shell layout
const rootRoute = createRootRoute({
  component: () => (
    <Layout>
      <Outlet />
    </Layout>
  ),
});

// Index redirect
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/items" });
  },
  component: () => null,
});

// Standard route
const itemsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/items",
  component: ItemsList,
});

// Dynamic parameter route ($id becomes params.id)
const itemDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/items/$id/detail",
  component: ItemDetail,
});

// Build the tree and create the router
const routeTree = rootRoute.addChildren([indexRoute, itemsRoute, itemDetailRoute]);
export const router = createRouter({ routeTree });
```

### Type-Safe Router Registration

Module augmentation gives type safety to `useParams`, `useNavigate`, `<Link>`, etc.:

```tsx
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
```

### Key Patterns

- **Root layout**: `createRootRoute` renders a shell (sidebar + main) with `<Outlet />` for child routes
- **Redirects**: `beforeLoad` + `throw redirect(...)` — no component rendered
- **Dynamic params**: `$id` in the path string, accessed via `params.id`
- **Flat route tree**: all routes are children of the root (no deep nesting)

---

## 7. Data Fetching (TanStack Query)

### QueryClient Defaults

```ts
// src/client/lib/query-client.ts
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,  // Data considered fresh for 30 seconds
      retry: 1,            // Retry failed requests once
    },
  },
});
```

### Typed Fetch Wrapper

```ts
// src/client/lib/fetch.ts
export async function apiFetch(url: string, options?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
      "X-Request": "true",   // CSRF header — always injected
    },
  });
}

export async function apiFetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await apiFetch(url, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message =
      (body as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`;
    throw new Error(message);
  }
  const body = (await res.json()) as { data: T };
  return body.data;  // Unwrap the envelope
}
```

### Query Pattern (reads)

```tsx
const { data: items, isLoading, error } = useQuery({
  queryKey: ["items", projectId],
  queryFn: () => apiFetchJson<Item[]>(`/api/projects/${encodeURIComponent(projectId)}/items`),
});
```

### Mutation Pattern (writes)

```tsx
const createItem = useMutation({
  mutationFn: (newItem: CreateItemInput) =>
    apiFetchJson<Item>(`/api/projects/${encodeURIComponent(projectId)}/items`, {
      method: "POST",
      body: JSON.stringify(newItem),
    }),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["items", projectId] });
  },
});
```

### Adaptive Refetch Intervals

For views that need faster updates when something is active (e.g., a running process):

```tsx
const { data: status } = useQuery({
  queryKey: ["status", projectId],
  queryFn: () => apiFetchJson<Status>(`/api/projects/${id}/status`),
  refetchInterval: status?.state === "RUNNING" ? 5_000 : 30_000,
});
```

### Query Key Conventions

- Resource list: `["items", parentId]`
- Single resource: `["item", parentId, itemId]`
- Status/derived: `["status", parentId]`
- Config/global: `["config"]`

---

## 8. Server-Sent Events (SSE)

### Server Side (Hono `streamSSE`)

```ts
import { streamSSE } from "hono/streaming";

router.get("/:id/log/stream", (c) => {
  return streamSSE(c, async (stream) => {
    // Set up abort detection
    let abortResolve: (() => void) | undefined;
    const abortPromise = new Promise<void>((r) => { abortResolve = r; });
    stream.onAbort(() => abortResolve?.());

    const cleanups: Array<() => void> = [];

    // 1. Send initial data on connect
    const initialData = getInitialData();
    await stream.writeSSE({ data: JSON.stringify(initialData), event: "data" }).catch(() => {});

    // 2. Send initial status
    const status = getStatus();
    let lastStatusJson = JSON.stringify(status);
    await stream.writeSSE({ data: lastStatusJson, event: "status" }).catch(() => {});

    // 3. Live file watching (fs.watch)
    const stopWatching = watchFile(path, (newLines) => {
      if (stream.aborted || stream.closed) return;
      stream.writeSSE({ data: JSON.stringify(newLines), event: "data" }).catch(() => {});
    });
    cleanups.push(stopWatching);

    // 4. Status change detection (poll, emit only on change)
    const statusPoll = setInterval(() => {
      if (stream.aborted || stream.closed) return;
      const newStatus = getStatus();
      const json = JSON.stringify(newStatus);
      if (json !== lastStatusJson) {
        lastStatusJson = json;
        stream.writeSSE({ data: json, event: "status" }).catch(() => {});
      }
    }, 5_000);
    cleanups.push(() => clearInterval(statusPoll));

    // 5. Heartbeat (keeps connection alive)
    const heartbeat = setInterval(() => {
      if (stream.aborted || stream.closed) return;
      stream.writeSSE({ data: new Date().toISOString(), event: "heartbeat" }).catch(() => {});
    }, 30_000);
    cleanups.push(() => clearInterval(heartbeat));

    // Block until client disconnects
    await abortPromise;

    // Cleanup all watchers and timers
    cleanups.forEach((fn) => fn());
  });
});
```

**Event types:**

| Event | Payload | Frequency |
|-------|---------|-----------|
| `data` | JSON array of new entries | On connect (initial batch) + on file change |
| `status` | JSON status object | On connect + when changed (polled every 5s) |
| `heartbeat` | ISO timestamp | Every 30s |

### Client Side (React + EventSource)

```tsx
useEffect(() => {
  if (!id) return;
  const url = `/api/resources/${encodeURIComponent(id)}/stream`;
  const es = new EventSource(url);

  es.onopen = () => setConnected(true);
  es.onerror = () => setConnected(false);

  es.addEventListener("data", (e) => {
    try {
      const newEntries = JSON.parse((e as MessageEvent<string>).data) as string[];
      if (!Array.isArray(newEntries)) return;
      setEntries((prev) => [...prev, ...newEntries].slice(-50));  // Keep last 50
    } catch {
      // Ignore parse errors
    }
  });

  es.addEventListener("status", (e) => {
    try {
      const status = JSON.parse((e as MessageEvent<string>).data);
      setStatus(status);
    } catch { /* ignore */ }
  });

  return () => {
    es.close();
    setConnected(false);
  };
}, [id]);
```

---

## 9. Theming & Styling

### Tailwind CSS v4 Setup

Tailwind v4 uses the Vite plugin — **no `tailwind.config.js` file**. Design tokens are declared with `@theme` directly in CSS:

```css
/* src/client/index.css */
@import "tailwindcss";

@theme {
  --color-sidebar: #1a1f2e;
  --color-sidebar-fg: #e2e8f0;
  --color-sidebar-accent: #2d3748;
  --color-sidebar-border: #2d3748;
  --color-surface: #ffffff;
  --color-surface-raised: #f8fafc;
  --color-border: #e2e8f0;
  --color-text: #1a202c;
  --color-text-muted: #718096;
  --color-accent: #6366f1;
  --color-accent-hover: #4f46e5;
}
```

These tokens are available in Tailwind utility classes (e.g., `bg-surface`, `text-text-muted`, `border-border`) and in `var()` references.

### Dark Mode via `[data-theme]`

Dark mode overrides CSS custom properties. The `data-theme` attribute on `<html>` controls the active palette:

```css
:root {
  color-scheme: light;
}

[data-theme="dark"] {
  color-scheme: dark;
  --color-surface: #0f1117;
  --color-surface-raised: #1a1f2e;
  --color-border: #2d3748;
  --color-text: #e2e8f0;
  --color-text-muted: #718096;
}

body {
  background-color: var(--color-surface);
  color: var(--color-text);
  font-family: system-ui, -apple-system, sans-serif;
  -webkit-font-smoothing: antialiased;
}
```

### ThemeProvider (React Context)

```tsx
type Theme = "light" | "dark" | "system";

interface ThemeContextValue {
  theme: Theme;                        // User's explicit choice
  resolvedTheme: "light" | "dark";     // Actual applied theme
  setTheme: (theme: Theme) => void;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem("app-theme");
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
    return "system";
  });

  const resolvedTheme = theme === "system" ? getSystemTheme() : theme;

  // Apply data-theme attribute
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolvedTheme);
  }, [resolvedTheme]);

  // React to OS theme changes when "system" is selected
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      document.documentElement.setAttribute("data-theme", getSystemTheme());
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  function setTheme(next: Theme) {
    localStorage.setItem("app-theme", next);
    setThemeState(next);
  }

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
```

### Dynamic Styling with CSS Variables

Components use inline `style` props with CSS custom properties for state-driven colors (not Tailwind classes). This is the pattern for badges, cards, and anything that changes color based on data:

```tsx
<span
  className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
  style={{
    backgroundColor: config.bgColor,    // e.g., "rgba(22, 163, 74, 0.15)"
    color: config.textColor,             // e.g., "#16a34a"
  }}
>
  {config.label}
</span>
```

### Prose Styles for Rendered Markdown

A custom `.prose` class styles `react-markdown` output using CSS custom properties (so it respects dark mode):

```css
.prose {
  color: var(--color-text);
  font-size: 0.875rem;
  line-height: 1.7;
}
.prose h1 { font-size: 1.25rem; font-weight: 700; margin: 1rem 0 0.5rem; }
.prose h2 { font-size: 1.1rem; font-weight: 600; border-bottom: 1px solid var(--color-border); }
.prose code {
  font-family: ui-monospace, "Cascadia Code", "Source Code Pro", monospace;
  background-color: var(--color-surface);
  padding: 0.1em 0.35em;
  border: 1px solid var(--color-border);
  border-radius: 3px;
}
.prose pre { /* block code */ }
.prose a { color: #2563eb; text-decoration: underline; }
.prose table { border-collapse: collapse; width: 100%; }
.prose th, .prose td { border: 1px solid var(--color-border); padding: 0.3rem 0.65rem; }
```

---

## 10. Component Patterns

### No External Component Library

All UI is built with native HTML elements + Tailwind utility classes. No Shadcn, Radix, Headless UI, or similar. This keeps the bundle small and gives full control.

### Layout: Sidebar + Scrollable Main

```tsx
export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main
        className="flex-1 overflow-y-auto"
        style={{ backgroundColor: "var(--color-surface)" }}
      >
        {children}
      </main>
    </div>
  );
}
```

### Badge Pattern (Config Object + Inline Styles)

Badges are driven by a config record that maps a status/type string to display properties:

```tsx
interface BadgeConfig {
  label: string;
  bgColor: string;   // rgba for subtle backgrounds
  textColor: string;  // hex for readable text
}

const STATUS_BADGE: Record<string, BadgeConfig> = {
  idle:    { label: "Idle",    bgColor: "rgba(107, 114, 128, 0.12)", textColor: "#6b7280" },
  running: { label: "Running", bgColor: "rgba(22, 163, 74, 0.15)",  textColor: "#16a34a" },
  error:   { label: "Error",   bgColor: "rgba(220, 38, 38, 0.12)",  textColor: "#dc2626" },
};

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_BADGE[status] ?? STATUS_BADGE.idle;
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: config.bgColor, color: config.textColor }}
    >
      {config.label}
    </span>
  );
}
```

### Card Pattern

```tsx
<div
  className="rounded-lg border p-4"
  style={{
    backgroundColor: "var(--color-surface-raised)",
    borderColor: "var(--color-border)",
  }}
>
  {/* Card content */}
</div>
```

### Form Handling (Controlled State, No Form Library)

Forms use plain React `useState` — no form libraries (React Hook Form, Formik, etc.):

```tsx
function FilterSelect({
  value, onChange, options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border px-2 py-1.5 text-xs"
      style={{
        borderColor: "var(--color-border)",
        backgroundColor: "var(--color-surface)",
        color: "var(--color-text)",
      }}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}
```

### Loading Skeletons

```tsx
<div className="animate-pulse rounded" style={{ backgroundColor: "var(--color-surface-raised)" }}>
  <div className="h-4 w-3/4 rounded" />
</div>
```

### Emoji Characters as Icons

No icon library (Lucide, Heroicons, etc.). Emoji characters are used directly:

```tsx
// Navigation items
{ emoji: "⬡", label: "Dashboard" }
{ emoji: "⚙", label: "Settings" }

// Theme toggle cycles through:
// ☀ (light) → ☾ (dark) → ◑ (system)
```

---

## 11. API Client Pattern

The full client-side API layer is two functions:

```ts
// 1. Low-level fetch with automatic header injection
export async function apiFetch(url: string, options?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
      "X-Request": "true",
    },
  });
}

// 2. Typed JSON fetch that unwraps the response envelope
export async function apiFetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await apiFetch(url, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message =
      (body as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`;
    throw new Error(message);
  }
  const body = (await res.json()) as { data: T };
  return body.data;
}
```

**Design decisions:**

- The CSRF header (`X-Request: true`) is injected on **every** request (including GETs). This is harmless for reads and avoids needing to track which calls are mutations.
- `apiFetchJson<T>` returns the unwrapped `data` field directly, so consumers see `T` — not `{ data: T }`.
- Error messages are extracted from the envelope's `error.message` field, falling back to the HTTP status code.

---

## 12. Security Patterns

### CSRF Protection

- All POST/PUT/DELETE requests require the `X-Request: true` header
- Enforced by app-level Hono middleware (not per-route)
- No CORS headers are set — the browser blocks cross-origin requests by default
- The custom header adds defense-in-depth: browsers won't send custom headers from `<form>` submissions or simple cross-origin requests

### Path Sandboxing

All user-supplied identifiers are validated before filesystem access:

```ts
function resolveProjectPath(id: string): string | null {
  const decoded = decodeURIComponent(id);
  // Reject traversal: must not contain "/" or ".."
  if (decoded.includes("/") || decoded.includes("\\") || decoded === "." || decoded === "..") {
    return null;
  }
  return path.join(getRootDirectory(), decoded);
}

function validateProjectPath(projectPath: string): string | null {
  const pathResult = validatePath(projectPath, [allowedRootDir]);
  return pathResult.ok ? null : pathResult.error.code;
}
```

### Localhost-Only Binding

```ts
Bun.serve({
  hostname: "127.0.0.1",  // NOT 0.0.0.0
  port,
  fetch: app.fetch,
});
```

The server is only accessible from the local machine. No network exposure, no need for authentication.

---

## 13. Testing

### Vitest Configuration

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    passWithNoTests: true,
  },
});
```

### Colocated Test Files

Tests live next to the source files they test:

```
src/server/app.ts
src/server/app.test.ts
src/server/routes/status.ts
src/server/routes/status.test.ts
```

### Integration Tests via App Factory

The `createApp()` factory enables isolated integration tests without starting a real server:

```ts
import { createApp } from "../app.js";

describe("GET /api/items", () => {
  it("returns items for a valid project", async () => {
    const app = createApp(Date.now(), { rootDirectory: tempDir });
    const res = await app.request("/api/projects/my-project/items");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toBeInstanceOf(Array);
  });
});
```

Hono's `app.request()` method lets you send requests directly without HTTP — fast, deterministic, no port conflicts.

### NPM Scripts

```bash
pnpm test          # vitest run (single pass)
pnpm test:watch    # vitest (watch mode)
pnpm typecheck     # tsc --noEmit
pnpm lint          # eslint src/
```
