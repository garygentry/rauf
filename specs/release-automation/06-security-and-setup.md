# 06 — Security & One-Time Setup

The authorization model, token scoping, secret-hygiene guarantees, and the manual GitHub configuration that gates the first release. REQ-SEC-02's primary control (the tag-protection ruleset) is a **first-release blocker**, not a deferral (decision recorded in tech-spec §10 OTQ-1 / verification V-007).

## Requirement Coverage

| REQ ID      | Requirement                                              | Section |
| ----------- | ------------------------------------------------------- | ------- |
| REQ-SEC-01  | Publish via `GITHUB_TOKEN`, `contents: write` only      | 2       |
| REQ-SEC-02  | Two-layer authorization (ruleset primary + actor check) | 1       |
| REQ-SEC-03  | No secrets in published binaries or notes               | 3       |
| (tech §10)  | Ruleset is a first-release blocker (OTQ-1)              | 1.1, 4  |

## 1. Authorization (REQ-SEC-02)

Two layers. The PRD names the ruleset **primary** and the workflow actor-check **defense-in-depth** — both are specified concretely below.

### 1.1 Primary — GitHub tag ruleset (manual, one-time, first-release blocker)

A repository **tag ruleset** that prevents non-owners from creating `v*` tags at all, so the workflow never starts for an unauthorized actor. Configure once, in repo Settings:

- **Path:** Settings → Rules → Rulesets → **New ruleset → New tag ruleset**.
- **Name:** `release-tags`.
- **Enforcement status:** **Active**.
- **Target tags:** tag name pattern `v*` (fnmatch).
- **Rule:** enable **Restrict creations** — only actors on the bypass list may create matching tags.
- **Bypass list:** **Repository admin** (the owner, `garygentry`) only.

> **First-release blocker (tech-spec §10 OTQ-1).** Because REQ-SEC-02 (P0) designates the ruleset as the *primary* layer, the first `vX.Y.Z` release MUST NOT proceed until this ruleset exists. Shipping with only the workflow actor-check active is explicitly disallowed. This is a tracked item on the pre-release checklist (§4), documented in the release/install docs.

### 1.2 Defense-in-depth — workflow actor check

Implemented as step 2 of `release.yml` (`04-ci-preflight-and-workflow.md` §3):

```yaml
- name: Authorize actor
  if: github.actor != github.repository_owner
  run: |
    echo "::error::actor ${{ github.actor }} is not the repository owner" >&2
    exit 1
```

- `github.repository_owner` resolves to `garygentry` without hardcoding a literal login (OQ-4 resolved: repository-owner association, not a hardcoded string).
- This is the **second** line of defense — e.g. it guards the `workflow_dispatch` re-run path (REQ-TRIGGER-03), where a tag already exists and the ruleset's creation restriction no longer applies. It fails the job before any build or publish.

**Acceptance test (REQ-SEC-02 note):** a `v*` tag push by a non-owner is rejected by the ruleset; a workflow run whose actor is not the owner fails at step 2 before the publish step.

## 2. Token scoping (REQ-SEC-01, C-5)

- The release job declares `permissions: { contents: write }` at the workflow level — the minimum needed to create a release and upload assets.
- Publishing uses the workflow's built-in `GITHUB_TOKEN` (exposed to `gh` as `GH_TOKEN: ${{ github.token }}`). **No** personal access tokens and **no** additional publish secrets are introduced.
- `gh` is pre-installed on `ubuntu-latest` and authenticates via that token.

## 3. Secret hygiene (REQ-SEC-03)

- **Binaries:** compiled from `scripts/binary-entry.ts`, which imports only `packages/web` + `packages/cli`. No `.env`, secret, or credential file is bundled (the compile is a static import graph; nothing reads runtime secrets at build time).
- **Release notes:** sourced verbatim from the human-curated `## X.Y.Z` CHANGELOG section (REQ-NOTES-02). No environment values, tokens, or CI variables are interpolated into `NOTES.md` — `build-notes.ts` only reads the changelog and a `git describe` tag name.
- **Verification aid:** the repo's existing GitHub secret-scanning remains enabled; a release introduces no new secret material to scan.

## 4. Pre-release setup checklist

A one-time checklist documented in the release docs; items 1–2 gate the **first** release:

1. **[blocker]** Create the `release-tags` tag ruleset (§1.1).
2. **[blocker]** Confirm `packages/core/src/version.ts` and all six `package.json` files agree (the first `release:prepare` run corrects the historical `packages/docs` `0.1.0` drift — `03-prepare-helper.md` §3.2).
3. Confirm `.bun-version` exists and CI is green on the pinned Bun (`04-ci-preflight-and-workflow.md` §4).
4. Confirm `CHANGELOG.md` `## Unreleased` has real notes (the REQ-PREP-05 guard enforces this at prep time).

## Dependencies

- `04-ci-preflight-and-workflow.md` — the workflow that enforces the actor check and token scoping.
- `03-prepare-helper.md` — the drift correction referenced by checklist item 2.

## Verification

- Settings → Rules shows an **Active** `release-tags` ruleset restricting `v*` creation to the owner (Success Criteria #9; REQ-SEC-02).
- A non-owner `v*` push is rejected by GitHub before any workflow run.
- `release.yml` declares `permissions: { contents: write }` and references only `${{ github.token }}` — no other secrets (REQ-SEC-01).
- A published release's notes contain no environment/token values (REQ-SEC-03).
