# Traceability Matrix — release-automation

Maps every PRD requirement to the implementation spec document(s) and primary section that cover it. Validated by `validate-traceability.py`: **40/40 requirements covered, 0 uncovered, 0 orphaned references.**

Spec docs: `00` core-definitions · `01` architecture-layout · `02` shared-lib · `03` prepare-helper · `04` ci-preflight-and-workflow · `05` install-scripts · `06` security-and-setup · `07` testing-strategy.

| REQ ID             | Pri | Requirement (abbrev.)                                   | Spec docs            | Primary section |
| ------------------ | --- | ------------------------------------------------------- | -------------------- | --------------- |
| REQ-TRIGGER-01     | P0  | `v*` tag push triggers release                          | 04                   | 04 §3 (trigger) |
| REQ-TRIGGER-02     | P0  | Drift guard: tag↔version.ts↔6 package.json              | 00, 04, 07           | 04 §2.2         |
| REQ-TRIGGER-03     | P2  | `workflow_dispatch` for existing tag                    | 04, 06               | 04 §3 (trigger) |
| REQ-VER-01         | P0  | Six lockstep package.json versions                      | 00, 02, 03, 07       | 00 §2.1         |
| REQ-VER-02         | P0  | Version chosen explicitly by maintainer                 | 03                   | 03 §1           |
| REQ-VER-03         | P0  | `version.ts` VERSION canonical                          | 00, 02, 03           | 02 §3.2         |
| REQ-VER-04         | P0  | Valid semver (optional prerelease)                      | 00, 02, 03           | 02 §4.1         |
| REQ-VER-05         | P0  | docs package.json in the set (corrects drift)           | 00, 02, 03           | 00 §2.1         |
| REQ-PREP-01        | P0  | One-shot bump+roll+commit+tag+push                      | 00, 03               | 03 §1, §3       |
| REQ-PREP-02        | P0  | Refuse unless main/clean/up-to-date                     | 03                   | 03 §2.2         |
| REQ-PREP-03        | P0  | Refuse if tag exists local/remote                       | 03                   | 03 §2.3         |
| REQ-PREP-04        | P0  | Refuse if version not strictly greater                  | 02, 03, 07           | 03 §2.4         |
| REQ-PREP-05        | P0  | Refuse if `## Unreleased` empty                         | 00, 02, 03, 06       | 03 §2.5         |
| REQ-PREP-06        | P0  | Tooling under `scripts/`, not in product                | 00, 01, 03           | 01 §4           |
| REQ-PREP-07        | P0  | Guard fails → no changes, clear message                 | 00, 03, 04           | 03 §2, §4       |
| REQ-NOTES-01       | P0  | Roll `## Unreleased` → `## X.Y.Z`                        | 00, 02, 03, 07       | 02 §5.2         |
| REQ-NOTES-02       | P0  | Notes = `## X.Y.Z` section verbatim                     | 02, 04, 06, 07       | 02 §5.3         |
| REQ-NOTES-03       | P1  | Append Full Changelog compare link                      | 00, 02, 04           | 04 §3 step 9    |
| REQ-BUILD-01       | P0  | Build all five platform binaries                        | 00, 04               | 00 §2.2         |
| REQ-BUILD-02       | P0  | Asset names match `install-binary.sh`                   | 00, 04               | 00 §2.2         |
| REQ-BUILD-03       | P0  | Release object with all assets + checksums              | 04                   | 04 §3 step 10   |
| REQ-BUILD-04       | P0  | Stable tag marked `latest`                              | 04, 07               | 04 §3 step 10   |
| REQ-BUILD-05       | P0  | Prerelease → GitHub prerelease, not latest              | 00, 02, 04, 07       | 04 §2.3         |
| REQ-BUILD-06       | P0  | Full quality gate on tagged commit                      | 01, 04               | 04 §5           |
| REQ-BUILD-07       | P0  | Bun cross-target compilation                            | 00                   | 00 §2.2         |
| REQ-INTEGRITY-01   | P0  | Generate + attach `SHA256SUMS`                          | 00, 04               | 04 §3 step 8    |
| REQ-INTEGRITY-02   | P1  | Install scripts verify checksum                         | 05, 07               | 05 §1.2, §2.3   |
| REQ-INTEGRITY-03   | P2  | Signing/SLSA deferred                                    | 05                   | 05 §3 (deferred)|
| REQ-RELIABILITY-01 | P0  | Atomic single-shot publish                              | 01, 04, 07           | 04 §3 step 10   |
| REQ-RELIABILITY-02 | P0  | Refuse if release already exists                        | 04                   | 04 §3 step 5    |
| REQ-RELIABILITY-03 | P1  | Failed run re-runnable, no orphan drafts                | 04                   | 04 §3 (notes)   |
| REQ-RELIABILITY-04 | P1  | Failure surfaced with diagnostics                       | 00, 04               | 04 §3 (notes)   |
| REQ-INSTALL-01     | P0  | `install-binary.sh` installs latest, no URL change      | 05                   | 05 §1           |
| REQ-INSTALL-02     | P0  | Windows PS installer + published `.exe`                 | 01, 05               | 05 §2           |
| REQ-PERF-01        | P1  | Full release within 15 min                              | 01, 04, 07           | 01 §4           |
| REQ-SEC-01         | P0  | `GITHUB_TOKEN`, `contents: write` only                  | 04, 06               | 06 §2           |
| REQ-SEC-02         | P0  | Two-layer authorization (ruleset + actor)               | 04, 06               | 06 §1           |
| REQ-SEC-03         | P0  | No secrets in binaries/notes                            | 06                   | 06 §3           |
| REQ-OBS-01         | P1  | Distinguishable steps in Actions UI                     | 04                   | 04 §3 (job design)|
| REQ-OBS-02         | P2  | Report release URL + version in summary                 | 04                   | 04 §3 step 11   |

## Notes on deferred / out-of-scope items

- **REQ-INTEGRITY-03** (signing/SLSA) is explicitly deferred to a future version (PRD §6); `05-install-scripts.md` §3 records the v1 stance (unsigned binaries + documented macOS quarantine workaround) without implementing signing.
- The tag-protection **ruleset** (REQ-SEC-02 primary layer) is manual GitHub config, not code; it is a **first-release blocker** documented in `06-security-and-setup.md` §1.1 / §4.
