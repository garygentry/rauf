# Web Package Specification

Reference: `packages/web/`

## Server (Hono on Bun)

### Binding
```typescript
Bun.serve({ hostname: "127.0.0.1", port: config.port, fetch: app.fetch });
```
NEVER bind to 0.0.0.0.

### CSRF Middleware
All POST/PUT/DELETE routes require header: `X-Ralph-Request: true`.
Requests without it get 403 Forbidden.
No `Access-Control-Allow-Origin` headers set (blocks cross-origin).

### Static Serving
Built React frontend served from `/` as static files.
API routes under `/api/`.

## API Routes

### Health
`GET /api/health` → `{ version, uptime, rootDirectory, projectCount }`

### Projects
```
GET    /api/projects                    → { data: DiscoveredProject[] }
GET    /api/projects/:id                → { data: ProjectDetail }
POST   /api/projects/:id/install        → { data: InstallationReport }
POST   /api/projects/init               → { data: InstallationReport }
POST   /api/projects/:id/update         → { data: InstallationReport }
POST   /api/projects/:id/uninstall      → { data: void }
```

`:id` = directory name (URL-encoded). Resolved to `ROOT_DIRECTORY/<id>`.

### Backlog
```
GET    /api/projects/:id/backlog              → { data: BacklogItem[] }
       Query params: ?status=pending&type=bug&sort=priority
POST   /api/projects/:id/backlog              → { data: BacklogItem }
       Body: CreateItemInput
GET    /api/projects/:id/backlog/:itemId      → { data: BacklogItem }
PUT    /api/projects/:id/backlog/:itemId      → { data: BacklogItem }
       Body: UpdateItemInput
DELETE /api/projects/:id/backlog/:itemId      → { data: void }
POST   /api/projects/:id/backlog/restore      → { data: void }
```

### Status
```
GET    /api/projects/:id/status               → { data: DerivedStatus }
GET    /api/projects/:id/log?tail=50          → { data: string[] }
GET    /api/projects/:id/log/stream           → SSE stream
GET    /api/projects/:id/progress             → { data: string }  (raw markdown)
```

### Profile
```
GET    /api/projects/:id/profile              → { data: ProjectProfile }
PUT    /api/projects/:id/profile              → { data: ProjectProfile }
POST   /api/projects/:id/profile/detect       → { data: ProjectProfile }
```

### Config
```
GET    /api/config                            → { data: ToolConfig }
PUT    /api/config                            → { data: ToolConfig }
```

### Error Response Format
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Priority must be between 1 and 4",
    "details": { "field": "priority", "value": 5 }
  }
}
```

## SSE Log Stream

`GET /api/projects/:id/log/stream`

Event types:
- `log` — new log line(s) (data: JSON array of strings)
- `status` — loop state change detected (data: DerivedStatus JSON)
- `heartbeat` — sent every 30s (data: timestamp)

Implementation:
- Watch `.ralph/ralph.log` with fs.watch
- Poll for new lines every 1s
- Watch `.ralph/state.json` for state changes
- Client auto-reconnects (standard SSE behavior)

## Frontend (React SPA)

### Router Structure (TanStack Router)
```
/                          → Redirect to /projects
/projects                  → Projects Dashboard
/projects/:id              → Redirect to /projects/:id/backlog
/projects/:id/backlog      → Backlog View
/projects/:id/status       → Status View
/projects/:id/settings     → Project Settings
/install                   → Installation Wizard
/init                      → Greenfield Wizard
/settings                  → Global Settings
```

### Shared Fetch Wrapper
```typescript
async function ralphFetch(url: string, options?: RequestInit) {
  return fetch(url, {
    ...options,
    headers: {
      ...options?.headers,
      'X-Ralph-Request': 'true',
      'Content-Type': 'application/json',
    },
  });
}
```

All API calls go through this wrapper.

### TanStack Query Keys
```
['projects']                        → project list
['projects', id]                    → project detail
['projects', id, 'backlog']         → backlog items
['projects', id, 'backlog', itemId] → single item
['projects', id, 'status']          → derived status
['projects', id, 'profile']         → project profile
['config']                          → tool config
```

### UI Views

#### Projects Dashboard
- Card grid of discovered projects
- Each card: name, stack badge, loop state badge, backlog summary, last activity
- "Install Ralph" and "Initialize New Project" buttons
- Auto-refresh every 30s + manual refresh button

#### Backlog View
- Filter bar: type, status, priority
- Sort: priority (default), id, status
- Summary counts row
- Item cards: ID, type badge, priority, title, status badge, criteria count, dependencies
- "Add Item" → side panel/modal
- Click item → edit side panel
- Active loop warning banner if running

#### Status View
- Two-column layout (wide screens)
- Left: loop state badge, iteration info, backlog summary, current/blocked/recent items
- Right: live log tail panel (monospaced, SSE-fed, auto-scroll)
- Below: progress.md rendered as markdown

#### Installation Wizard (6 steps)
1. Select Target (path input, validation)
2. Preflight (checklist of checks)
3. Tech Stack & Profile (auto-detected, editable)
4. Configure (project name, gitignore toggle, options preview)
5. Review (file list preview, RALPH.md verification section)
6. Result (installation report, quick links)

#### Greenfield Wizard (5 steps)
1. Project Info (name, path, description)
2. Tech Stack (preset selection, command fields)
3. Initial Backlog (empty / import file / enter inline)
4. Review (file preview, CLAUDE.md preview, backlog preview)
5. Result (creation report, next steps)

#### Settings
- ROOT_DIRECTORY path input (triggers re-discovery on change)
- Server port
- Theme toggle (light/dark/system)
- Project visibility toggles

### Styling
- Tailwind CSS (utility-first)
- No component library dependency — custom components
- Responsive: works at 1024px+ width
- Light/dark theme support

### Key UX Requirements
- All destructive actions require confirmation dialog
- Toast notifications for async results
- Error boundaries: malformed project files show recovery UI
- No external network requests (all assets served locally)
- Markdown rendering via react-markdown + remark-gfm
