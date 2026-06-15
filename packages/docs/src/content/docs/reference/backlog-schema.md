---
title: Backlog Schema
description: The shape of a backlog.json item — fields, enums, and acceptance criteria.
---

`backlog.json` is rauf's persistent task queue. This page is a focused reference for the item
shape; the complete, generated schema lives in the Schemas Reference.

:::note[Expanding in the content pass]
This is the scaffold for a focused Backlog Schema reference. The field-by-field table lands in the
content/reference phase. Until then, the canonical source below is complete and current.
:::

## Canonical sources

- [Schemas Reference](../../schemas/) — the full, generated TypeScript types and JSON schemas,
  including the backlog item shape and enums.
- [Machine Surfaces & Contract](../../spec-backlog-tool-contract/) — how the backlog and loop
  runner interact, and the `schemaVersion` discipline.

## Authoring & QA

Use the `author-backlog` skill to create a well-scoped backlog and `review-backlog` to audit one.
