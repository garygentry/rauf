# Traceability Matrix — Loop Observability

> Maps every `REQ-*` requirement in [`PRD.md`](./PRD.md) to the implementation
> spec document(s) that cover it. Each doc's own `## Requirement Coverage` table
> carries the section-level granularity; this matrix is the suite-wide index used
> to prove **no requirement is orphaned** and **no spec detail lacks a
> requirement**. Generated during forge-3-specs Step 5 cross-reference validation.

**Result: 36/36 PRD requirements covered.** No gaps.

Spec-doc legend: `00` core-definitions · `01` architecture-layout ·
`02` health-status-contract · `03` target-resolution ·
`04` event-altitude-follow · `05` supervision-recipe · `06` testing-strategy.

| REQ ID | Priority | Covered by | Primary owner |
|--------|----------|------------|---------------|
| REQ-CONTRACT-01 | P0 | 02 | 02 |
| REQ-CONTRACT-02 | P0 | 02 | 02 |
| REQ-CONTRACT-03 | P0 | 00, 02, 06 | 02 |
| REQ-CONTRACT-04 | P0 | 00, 02, 05 | 02 |
| REQ-CONTRACT-05 | P0 | 00, 01, 02, 06 | 02 |
| REQ-CONTRACT-06 | P0 | 00, 01, 05 | 00 |
| REQ-PRESCRIBE-01 | P0 | 05 | 05 |
| REQ-PRESCRIBE-02 | P0 | 05 | 05 |
| REQ-PRESCRIBE-03 | P1 | 00, 05 | 05 |
| REQ-PRESCRIBE-04 | P0 | 05 | 05 |
| REQ-PRESCRIBE-05 | P0 | 05 | 05 |
| REQ-PRESCRIBE-06 | P1 | 05 | 05 |
| REQ-CMD-01 | P0 | 04 | 04 |
| REQ-CMD-02 | P1 | 00, 04, 06 | 04 |
| REQ-CMD-03 | P0 | 00, 04, 05, 06 | 04 |
| REQ-CMD-04 | P2 | 05 | 05 |
| REQ-CMD-05 | P1 | 01, 03, 04, 06 | 04 |
| REQ-SCOPE-01 | P0 | 00, 03, 05, 06 | 03 |
| REQ-SCOPE-02 | P1 | 03, 06 | 03 |
| REQ-SCOPE-03 | P1 | 03 | 03 |
| REQ-SCOPE-04 | P1 | 03 | 03 |
| REQ-SCOPE-05 | P1 | 03 | 03 |
| REQ-SKILL-01 | P0 | 05 | 05 |
| REQ-SKILL-02 | P2 | 05 | 05 |
| REQ-PERF-01 | P0 | 00, 01, 02, 06 | 02 |
| REQ-SAFE-01 | P0 | 00, 01, 03, 06 | 03 |
| REQ-SAFE-02 | P0 | 00, 03, 06 | 03 |
| REQ-COMPAT-01 | P0 | 00, 01, 02, 04, 05, 06 | 02 / 04 |
| REQ-COMPAT-02 | P1 | 00, 02, 05 | 02 |
| REQ-A11Y-01 | P2 | 04, 06 | 04 |
| REQ-GATE-01 | P0 | 01, 04, 05, 06 | 06 |
| REQ-SUCCESS-01 *(keystone)* | P0 | 00, 02, 05, 06 | 02 / 05 |
| REQ-SUCCESS-02 | P0 | 05 | 05 |
| REQ-SUCCESS-03 | P0 | 03, 04 | 03 / 04 |
| REQ-SUCCESS-04 | P0 | 03 | 03 |
| REQ-SUCCESS-05 | P0 | 00, 02, 06 | 02 |
| REQ-SUCCESS-06 | P0 | 04, 05 | 04 / 05 |

## Notes

- **REQ-A11Y-01** is owned by `04` (§4.3, header degradation) with the no-color
  test path in `06`; the grep index folds it under `04`/`06`.
- **REQ-SUCCESS-03** ("in one command … follow at item level, and … see every
  live loop") is split by design: the item-level `follow` half is `04`; the
  machine-wide `--all` front door is `03` (§6).
- **REQ-SUCCESS-06** (the negative "no wading through token/tool events; no
  inventing a poll interval / reading a second file") is a synthesis criterion
  satisfied jointly by the item feed (`04` §3–4) and the prescribed single-poll
  recipe (`05` §3.3–3.4); tagged in both after Step-5 validation.
- **Cross-repo (out of scope, noted for provenance only):** the feature-forge
  `forge-5-loop` / `runner-contract.md` edit (PRD Q3, REQ-PRESCRIBE-06) lives in
  the feature-forge repo; the rauf-side deliverable is that `drive-rauf-loop`
  *is* the authoritative contract (`05` §6).

## Reverse check — every spec doc traces to ≥1 requirement

| Doc | Requirements it owns/covers |
|-----|------------------------------|
| 00-core-definitions.md | shared types for CONTRACT-03/04/05/06, COMPAT-02, CMD-02/03, SCOPE-01…05, SAFE-02, PERF-01 |
| 01-architecture-layout.md | C-01, COMPAT-01, GATE-01, CONTRACT-05, CMD-05, SAFE-01, PERF-01 |
| 02-health-status-contract.md | CONTRACT-01/02/03/04/05, COMPAT-01/02, PERF-01, SUCCESS-01/05 |
| 03-target-resolution.md | SCOPE-01…05, SAFE-01/02, SUCCESS-03/04, CMD-05 |
| 04-event-altitude-follow.md | CMD-01/02/03/05, A11Y-01, COMPAT-01, SUCCESS-03/06 |
| 05-supervision-recipe.md | PRESCRIBE-01…06, SKILL-01/02, SUCCESS-01/02/06, CMD-04, COMPAT-01 |
| 06-testing-strategy.md | GATE-01, PERF-01, CONTRACT-05, CMD-03, A11Y-01, SCOPE-01, SAFE-01, SUCCESS-01/05 |

No orphaned document; no requirement without a home.
