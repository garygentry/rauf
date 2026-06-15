---
title: Backlog Schema
description: The shape of a backlog.json item — fields, enums, and acceptance criteria.
---

`backlog.json` is rauf's persistent task queue: an ordered list of work items the loop picks
from, one per iteration. This page is a focused, field-by-field reference for a single backlog
**item**. For the complete generated types (the full file, archives, and every related shape) see
the [Schemas Reference](../../schemas/); for how the backlog and loop runner exchange data, see
[Machine Surfaces & Contract](../../spec-backlog-tool-contract/).

You rarely hand-edit this file — `rauf backlog add/edit` and the web dashboard write it for you,
and the loop runner owns `status`/`completedAt`. The schema is documented here so you can read it,
script against it, and write a seed file.

## Item fields

| Field                 | Type                                                                | Required | Notes                                                                                                                        |
| --------------------- | ------------------------------------------------------------------- | :------: | ---------------------------------------------------------------------------------------------------------------------------- |
| `id`                  | `string`                                                            |    ✓     | Zero-padded sequential — `"001"`, `"002"`, … Assigned by rauf; never renumbered (gaps are fine).                             |
| `type`                | `"bug" \| "bugfix" \| "refactor" \| "feature" \| "chore" \| "test"` |    ✓     | Work category. Drives nothing mechanical — it's for humans triaging the backlog.                                             |
| `priority`            | `1 \| 2 \| 3 \| 4`                                                  |    ✓     | `1` = highest. The runner selects the highest-priority eligible `pending` item next.                                         |
| `title`               | `string`                                                            |    ✓     | Non-empty, one-line summary.                                                                                                 |
| `description`         | `string`                                                            |    ✓     | What to build and why. The agent reads this verbatim each iteration.                                                         |
| `acceptanceCriteria`  | `string[]`                                                          |    ✓     | At least one. Each is a checkable "done" condition — see [below](#acceptance-criteria).                                      |
| `status`              | `"pending" \| "in_progress" \| "done" \| "blocked"`                 |    ✓     | Loop-runner-owned. Do not edit by hand — see [transitions](#status--lifecycle).                                              |
| `completedAt`         | `string \| null`                                                    |    ✓     | ISO 8601 datetime when marked `done`, else `null`. Runner-owned.                                                             |
| `blockedReason`       | `string`                                                            |          | Present when `status` is `"blocked"`; the reason captured from `RAUF_BLOCKED:<reason>`.                                      |
| `needsHuman`          | `boolean`                                                           |          | Blocked awaiting a human decision (`RAUF_NEEDS_HUMAN`). `reset`/`resume` leave these blocked.                                |
| `deferred`            | `boolean`                                                           |          | A "false block" — the runner gave up after `maxRetries` with no signal. Requeued by `reset`/`resume`.                        |
| `humanAnswer`         | `string`                                                            |          | A human answer injected via `rauf resume --answer <id> "<text>"`. Threaded into the next prompt; auto-cleared on completion. |
| `dependsOn`           | `string[]`                                                          |          | Item IDs that must be `done` before this item is eligible.                                                                   |
| `notes`               | `string`                                                            |          | Free-text context, links, hints for the agent.                                                                               |
| `estimatedIterations` | `number`                                                            |          | Expected iterations to complete (advisory).                                                                                  |
| `model`               | `string`                                                            |          | Per-item model override (e.g. `"sonnet"`, `"opus[1m]"`). Overrides the CLI `--model` and project default.                    |
| `specReferences`      | `string[]`                                                          |          | Paths to spec docs the agent should read for this item.                                                                      |
| `provider`            | `string`                                                            |          | Per-item LLM provider override.                                                                                              |
| `source`              | `"human" \| "review"`                                               |          | Origin — manually created, or generated by a review pass.                                                                    |
| `reviewBatch`         | `string`                                                            |          | ISO timestamp grouping items created together by one review pass.                                                            |
| `agentDelegation`     | `object`                                                            |          | Optional concurrency hint: `{ recommendedConcurrency?, strategy?, subtasks? }`.                                              |

## Acceptance criteria

`acceptanceCriteria` is the contract for "done" — the agent must satisfy **every** entry before
signalling `RAUF_DONE`, and they should be machine-checkable wherever possible (a command that
passes, a file that exists, an endpoint that returns the right shape).

When you add an item with **no** explicit criteria, rauf injects a smart default of
`"{{verifyCommand}} passes"` resolved from the project profile (e.g. `"pnpm test passes"`); the
UI marks it with an "auto" badge. Writing good criteria is the single biggest lever on loop
quality — the `author-backlog` skill exists to help, and `review-backlog` audits an existing set.

## Status & lifecycle

`status` is **owned by the loop runner**, not by you. The valid transitions are:

```
pending     → in_progress | blocked
in_progress → done | blocked | pending
blocked     → pending
done        → pending
```

Any other transition is rejected. The three blocked sub-states are distinguished by flags:

- **plain blocked** (`blockedReason` set) — a real `RAUF_BLOCKED`; stays blocked until you act.
- **needs-human** (`needsHuman: true`) — paused for a decision; answer it with
  `rauf resume --answer`, or unblock with `rauf backlog unblock`.
- **deferred** (`deferred: true`) — a false block the runner couldn't finish; `rauf reset` /
  `rauf resume` automatically requeue these to `pending`.

See [Recovery & Troubleshooting](../../guides/recovery/) for the full decision table.

## Example item

```json
{
  "id": "007",
  "type": "feature",
  "priority": 1,
  "title": "Add JWT auth to the login endpoint",
  "description": "Issue a signed JWT on successful POST /login and reject bad credentials with 401.",
  "acceptanceCriteria": [
    "POST /login with valid credentials returns a 200 with a `token` field",
    "POST /login with bad credentials returns 401",
    "pnpm test passes"
  ],
  "status": "pending",
  "completedAt": null,
  "dependsOn": ["004"]
}
```

## Authoring & QA

Use the `author-backlog` skill to create a well-scoped backlog and `review-backlog` to audit one;
both write/validate against this schema. `rauf backlog validate` checks a backlog file against the
schema plus semantic rules (dependency sanity, enum correctness) from the command line.
