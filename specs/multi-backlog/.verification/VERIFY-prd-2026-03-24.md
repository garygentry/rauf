# Verification Report: multi-backlog (prd)
Date: 2026-03-24
Pipeline Stage: forge-2-tech (pending)
Artifacts Reviewed: specs/multi-backlog/PRD.md, specs/multi-backlog/.pipeline-state.json
Checks Executed: 15 of 15 (11 pass, 4 fail, 0 not-applicable)

## Summary
- Total findings: 5
- Gaps: 2
- Inconsistencies: 1
- Improvements: 2
- Errors: 0

## Findings

### V-001: Implementation details leak into requirements
- **Severity:** improvement
- **Location:** PRD.md, sections 3.2, 3.3, 3.7
- **Issue:** Several requirements prescribe specific implementation approaches rather than stating what the system must do. REQ-STATE-02 specifies the detection mechanism ("auto-detected by checking if the backlog root directory name is `.ralph/`"). REQ-CLI-04 prescribes `path.resolve()` + `startsWith()` as the validation method. REQ-ARCH-01 names specific helper functions (`getBacklogPath()`, `getStatePath()`) to be refactored. While these provide useful context, they belong in the tech spec rather than the PRD.
- **Suggested fix:** Move implementation-specific notes to a "Notes:" or "Implementation guidance:" annotation on each requirement, clearly separated from the requirement statement itself. For example, REQ-CLI-04 should say "The resolved backlog root path must be validated as existing within the project root directory. Paths that resolve outside the project root must be rejected with a clear error." and move the `path.resolve()` + `startsWith()` detail to a Note. REQ-ARCH-01 should state the requirement as "Path resolution for all state files must be derived from a single backlog root parameter, not hardcoded to a fixed directory" and move the function names to Notes.
- **References:** CLAUDE.md (path sandboxing convention that REQ-CLI-04 references)
- **Checklist:** CHECK-P09

### V-002: Web API behavior for multi-backlog not addressed
- **Severity:** gap
- **Location:** PRD.md, section 3.3 (REQ-CLI-01) and section 6 (Out of Scope)
- **Issue:** REQ-CLI-01 lists `loop start`, `loop stop`, and `loop follow` as affected commands. Per CLAUDE.md and the project architecture, these commands route through the web server (Hono API) when the server is running. The PRD declares "Web app multi-root support" as out of scope in section 6, but does not clarify how the CLI-to-server path handles `--backlog`. If the web API endpoints do not accept a backlog root parameter, the CLI commands that proxy through the server will silently break or default to the wrong root. The PRD needs to either: (a) explicitly state that the web API must accept a backlog root parameter for loop management endpoints (making it minimally in-scope), or (b) clarify that `loop start`/`stop`/`follow` only work in direct mode (no server) when `--backlog` is used, with a clear error if the server is running.
- **Suggested fix:** Add a requirement REQ-CLI-05 (P0) or a note under REQ-CLI-01 addressing the server interaction: "When the web server is running and `--backlog` is specified, CLI commands that normally proxy through the server must either (a) pass the backlog root parameter to the API, or (b) bypass the server and operate in direct mode, with a clear message to the user." Alternatively, add this to the Out of Scope section with an explicit statement that `--backlog` flag is only supported in direct mode for MVP.
- **References:** CLAUDE.md ("CLI tool — commands call core directly or HTTP when server is running"), docs/ARCHITECTURE.md
- **Checklist:** CHECK-P14

### V-003: Status scanning contradicts out-of-scope auto-discovery
- **Severity:** inconsistency
- **Location:** PRD.md, section 3.4 (REQ-STATUS-01) vs section 6 (Out of Scope, bullet 7)
- **Issue:** REQ-STATUS-01 states: "Active roots are discovered by scanning for `state.json` files in known locations. For MVP, this means scanning the project for `**/backlog.json` files that have a sibling or child `.ralph/state.json` with non-idle status." Section 6, bullet 7 states: "Auto-discovery of backlog roots: Scanning the project for `**/backlog.json` to find all roots automatically. MVP uses explicit paths only (except for status display which scans for active roots)." The parenthetical exception technically reconciles these, but the wording is confusing — section 6 says "auto-discovery is out of scope" then immediately carves out an exception that IS auto-discovery. Additionally, OQ-02 asks whether this should be a filesystem scan or an index file, meaning the approach is still undecided, yet REQ-STATUS-01 describes a specific scanning approach as if decided.
- **Suggested fix:** Reword the out-of-scope bullet to remove ambiguity: "Auto-discovery of backlog roots for loop execution: Ralph will not automatically select which backlog root to operate on. Users must specify roots explicitly via `--backlog`. (Status display performs a limited scan for active roots per REQ-STATUS-01; this is not general-purpose discovery.)" Also, soften REQ-STATUS-01's implementation note to say "Active roots may be discovered via filesystem scan or a lightweight index (see OQ-02)" rather than prescribing the scan approach.
- **References:** PRD.md section 8 (OQ-02)
- **Checklist:** CHECK-P15

### V-004: RALPH.md fallback path semantics underspecified
- **Severity:** gap
- **Location:** PRD.md, section 3.6 (REQ-INST-01, REQ-INST-02)
- **Issue:** REQ-INST-01 specifies that RALPH.md is looked up in the backlog root's state directory first, falling back to project-level `.ralph/RALPH.md`. However, the project-level RALPH.md typically contains instructions that reference `.ralph/backlog.json` and `.ralph/state.json` by path. When the loop is running against a non-default root (e.g., `specs/auth/`), the project-level RALPH.md's file path references become incorrect — the loop should be reading `specs/auth/.ralph/state.json`, not `.ralph/state.json`. The PRD does not address whether the loop runner should rewrite or contextualize instruction file paths, or whether the project-level RALPH.md must be written to use relative references, or whether a per-root RALPH.md is effectively required for non-default roots.
- **Suggested fix:** Add a note to REQ-INST-01 clarifying the expected interaction: "Note: When falling back to the project-level RALPH.md, the loop runner must provide the active backlog root path as context to the agent (e.g., via system prompt). The RALPH.md content is not path-rewritten. This ensures the agent knows which state directory to operate on, even when using project-wide instructions. See REQ-ARCH-03."
- **References:** PRD.md REQ-OBS-01, REQ-ARCH-03; artifacts/variants/backlog-json/RALPH.md (template)
- **Checklist:** CHECK-P14

### V-005: Missing Accessibility and Scalability NFR subsections from template
- **Severity:** improvement
- **Location:** PRD.md, section 4
- **Issue:** The PRD template specifies subsections for Accessibility (4.4) and Scalability (4.5). The PRD omits both, replacing them with Reliability (4.4). For a CLI tool, Accessibility is not applicable. Scalability is partially addressed by REQ-PERF-01 (20 backlog roots), but there is no explicit discussion of what happens beyond that limit (e.g., monorepos with 50+ features, or deeply nested directory structures slowing down scans). The Reliability section (4.4) is a valuable addition not in the template.
- **Suggested fix:** Add a brief "4.5 Scalability" subsection with a single requirement: "REQ-SCALE-01: The multi-backlog model must not degrade core loop execution performance regardless of the number of backlog roots in the project. Status scanning performance targets are defined in REQ-PERF-01. Priority: P2." Add a one-line note under section 4 stating Accessibility is not applicable (CLI tool, no UI). Also add REQ-SCALE-01 to the Priority Summary table under P2.
- **References:** PRD template sections 4.4, 4.5
- **Checklist:** CHECK-P01, CHECK-P11

## Fix Execution Plan

### User Decisions Required
1. **V-002 (Web API behavior):** ✅ RESOLVED — User chose: pass `--backlog` to the web API. The server must accept and route the backlog root parameter for loop management and backlog CRUD operations.

### Execution Steps

Apply these steps in order. Each step is self-contained — a fresh agent can execute it without prior context beyond this document.

#### Step 1: Clarify implementation notes vs requirements
- **Files:** `specs/multi-backlog/PRD.md`
- **Addresses:** V-001
- **Checklist:** CHECK-P09
- **Action:** In REQ-STATE-02, REQ-CLI-04, and REQ-ARCH-01, move implementation-specific details (detection mechanism, `path.resolve()` + `startsWith()`, function names) from the requirement statement into clearly labeled "Notes:" annotations beneath each requirement. Keep the requirement text focused on observable behavior.
- **Depends on:** none
- **Rationale:** Separating requirements from implementation guidance prevents the tech spec from being over-constrained and keeps the PRD focused on "what" not "how."

#### Step 2: Add web API interaction requirement or scope clarification
- **Files:** `specs/multi-backlog/PRD.md`
- **Addresses:** V-002
- **Checklist:** CHECK-P14
- **Action:** After user decides: If web API should support `--backlog`, add REQ-CLI-05 under section 3.3: "When the web server is running and `--backlog` is specified, the CLI must pass the backlog root path to the server API. The server must route loop management operations to the specified root. Priority: P0." If direct-mode only: add a note to REQ-CLI-01 stating "--backlog flag is only supported in direct mode (no server). If the server is running and --backlog is specified, the CLI must display an error instructing the user to stop the server or use direct mode." Also add to Out of Scope: "Web API multi-root parameter support (CLI --backlog operates in direct mode only for MVP)."
- **Depends on:** User decision on V-002
- **Rationale:** This is a functional gap that could cause silent failures in server mode if not addressed before tech spec.

#### Step 3: Reconcile status scanning with out-of-scope auto-discovery
- **Files:** `specs/multi-backlog/PRD.md`
- **Addresses:** V-003
- **Checklist:** CHECK-P15
- **Action:** In section 6 (Out of Scope), reword bullet 7 from "Auto-discovery of backlog roots" to: "Auto-discovery of backlog roots for loop execution: Ralph will not automatically select which backlog root to operate on. Users must specify roots explicitly via `--backlog`. (Status display performs a limited scan for active roots per REQ-STATUS-01; this is not general-purpose discovery.)" In REQ-STATUS-01, soften the scan description to: "Active roots may be discovered via filesystem scan or a lightweight index (see OQ-02). The mechanism is determined at tech-spec time."
- **Depends on:** none
- **Rationale:** Removes contradictory language between the out-of-scope section and the requirements, and avoids prematurely committing to an implementation approach that OQ-02 is meant to resolve.

#### Step 4: Clarify RALPH.md fallback path semantics
- **Files:** `specs/multi-backlog/PRD.md`
- **Addresses:** V-004
- **Checklist:** CHECK-P14
- **Action:** Add a note to REQ-INST-01: "Note: When falling back to the project-level RALPH.md, the loop runner must provide the active backlog root path as context to the agent (e.g., via system prompt). The RALPH.md content is not path-rewritten. This ensures the agent knows which state directory to operate on, even when using project-wide instructions. See REQ-ARCH-03."
- **Depends on:** none
- **Rationale:** Without this clarification, the tech spec may not account for the mismatch between project-level instruction paths and non-default backlog roots, leading to agent confusion at runtime.

#### Step 5: Add Scalability subsection and Accessibility note
- **Files:** `specs/multi-backlog/PRD.md`
- **Addresses:** V-005
- **Checklist:** CHECK-P01, CHECK-P11
- **Action:** After section 4.4 Reliability, add: "### 4.5 Scalability\n\nREQ-SCALE-01: The multi-backlog model must not degrade core loop execution performance regardless of the number of backlog roots in the project. Status scanning is bounded by REQ-PERF-01. Priority: P2.\n\nNote: Accessibility requirements are not applicable (CLI tool with no graphical interface)." Also add REQ-SCALE-01 to the Priority Summary table under P2.
- **Depends on:** none
- **Rationale:** Completes template coverage and makes the scalability posture explicit for the tech spec author.

## Fix Progress

- Step 1: [APPLIED] 2026-03-24 — Moved implementation details in REQ-STATE-02, REQ-CLI-04, REQ-ARCH-01 into "Implementation guidance" notes, keeping requirement text focused on observable behavior.
- Step 2: [APPLIED] 2026-03-24 — Added REQ-CLI-05 (P0) requiring CLI to pass backlog root to web API when server is running. Updated priority summary table.
- Step 3: [APPLIED] 2026-03-24 — Reworded out-of-scope bullet 7 to clarify status scanning exception. Softened REQ-STATUS-01 to defer scan mechanism to tech spec.
- Step 4: [APPLIED] 2026-03-24 — Added note to REQ-INST-01 clarifying that loop runner provides backlog root path as context when falling back to project-level RALPH.md.
- Step 5: [APPLIED] 2026-03-24 — Added section 4.5 Scalability with REQ-SCALE-01 (P2), accessibility N/A note, and P2 row in priority summary table.
