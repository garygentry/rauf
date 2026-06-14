# Traceability Matrix — ux-overhaul-web

Maps every PRD requirement to the implementation spec document(s) and section(s) that cover it. Every
requirement has at least one covering spec; no orphan specs. (28 requirements total.)

| Requirement | Priority | Covered in |
|---|---|---|
| REQ-WEB-01 (web reset) | P0 | `04` §3, §8.1–8.2 · `00` §5, §7 |
| REQ-WEB-02 (web resume) | P0 | `04` §4, §8.3 · `03` §2, §4 · `00` §4, §6 |
| REQ-WEB-03 (web review) | P0 | `04` §5, §6, §8.4 |
| REQ-WEB-04 (web unblock) | P0 | `04` §7.1, §8.5 · `00` §5 |
| REQ-WEB-05 (web validate) | P0 | `04` §7.2, §8.6 · `00` §5 |
| REQ-WEB-06 (results visible) | P0 | `04` §8, §8.1 |
| REQ-WEB-07 (applicability) | P1 | `04` §8.7, §8.2 |
| REQ-WEB-08 (no logic in web) | P0 | `03` §2, §3, §5 · `00` §4 · `01` §3 |
| REQ-WEB-09 (concurrency safe) | P1 | `04` §2.3, §2.5, §3, §4, §7.1 · `03` §4 |
| REQ-VOCAB-01 (single label map) | P0 | `02` §2, §5 · `00` §3 |
| REQ-VOCAB-02 (total coverage) | P0 | `02` §3.2 · `00` §2 |
| REQ-VOCAB-03 (add REVIEWING) | P0 | `02` §2, §3 · `00` §2 |
| REQ-VOCAB-04 (add PAUSED_USAGE_LIMIT) | P0 | `02` §2, §3 · `00` §2 |
| REQ-VOCAB-05 (Needs Human label) | P0 | `02` §2.1 |
| REQ-VOCAB-06 (human vs machine casing) | P0 | `02` §4.3, §5.3 · `00` §2 |
| REQ-VOCAB-07 (badges for full enum) | P0 | `02` §4, §5, §6 |
| REQ-EXIT-01 (status exit codes 6/4) | P0 | `02` §7 · `00` §8.2 |
| REQ-AGENT-01 (signal spec) | P0 | `05` §3.1, §4, §5, §6, §7.1 |
| REQ-AGENT-02 (model cascade) | P0 | `05` §3.2, §4.2, §5.2, §7.2 |
| REQ-AGENT-03 (progress.md stub) | P1 | `05` §8 |
| REQ-SEC-01 (mutation auth) | P0 | `04` §2.4 · `00` §8.1 |
| REQ-SEC-02 (path sandboxing) | P0 | `04` §2.1 |
| REQ-OBS-01 (structured findings) | P1 | `04` §7.2, §8.6 |
| REQ-ARCH-01 (core zero cli/web imports) | P0 | `00` §3 · `01` §2, §4 |
| REQ-ARCH-02 (file-based status) | P0 | `01` §4 (deriveStatus unchanged, no subprocess) |
| REQ-TEST-01 (backend route tests) | P0 | `06` §3 |
| REQ-TEST-02 (label-map unit tests) | P0 | `06` §4, §5 |
| REQ-TEST-03 (no React harness) | P1 | `06` §6 |

## Decisions / open-question resolutions threaded into the specs

| Item | Resolved in |
|---|---|
| OQ-1 (resume/review logic location) | `03` (recovery → `@rauf/loop`); `04` (review via `LoopManager.startReviewLoop`) |
| OQ-2 (badge styling ownership) | `02` §5 (core = label+tone; web/CLI own palettes) |
| OQ-T1 (concrete tone→palette tables) | `02` §4.1 (terminal), §5.2 (CSS) |
| OQ-T2 (resume `answers` field name) | `00` §7, `04` §4 (`{ itemId, text }` → `humanAnswer`) |
| D3.1 resume relocation (recovery → `@rauf/loop`) | `03` §2/§3, `01` §3 |
| D3.4 acquire-and-hold lock model | `03` §4 (core), `04` §2.3/§3/§4 (web wiring) |

## Implementer notes surfaced by the spec writers (carry into impl/verify)

1. `deriveFromStateJson`'s staleness branch (`status.ts`) must continue to key on the **raw** status,
   not the derived value, so `REVIEWING` is not swept into a stale-downgrade path (`02` §3.2).
2. **RESOLVED → exported.** `mapLoopStateStatus` was module-private in `status.ts`; it is now specified
   to be **exported** (`02` §3.2, from `packages/core/src/index.ts`) so the all-12-raw totality test
   targets the mapping boundary directly (`06` §4.2).

## Verification

- Every PRD `REQ-*` ID appears in the table above with a covering doc (28/28).
- Cross-references between `00`–`06` resolve (all seven files + this matrix exist in
  `specs/ux-overhaul-web/`).
- Run `feature-forge`'s deterministic check in the specs-verify pass:
  `validate-traceability.py specs/ux-overhaul-web/PRD.md specs/ux-overhaul-web/ --json`.
