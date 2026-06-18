---
name: cross-agent-installer-facts
description: Verified ground truth for cross-agent-installer (agent-agnostic epic member 4) — installer is feature-forge's first Node package; PRD/tech-spec source claims + the featureForgeVersion gotcha
metadata:
  type: project
---

Verified facts for `cross-agent-installer` (epic agent-agnostic, member 4/6), cross-checked against feature-forge tree (`/home/gary/workspace/feature-forge`) on 2026-06-16 while verifying its tech-spec. Implementation lands in feature-forge; specs/backlog/loop driven from rauf.

**Why:** Spec makes load-bearing claims about another repo's tree + a published-rauf coordinate that doesn't exist yet; record ground truth so specs/impl verify don't re-derive it.
**How to apply:** Trust unless the tree changed; re-verify before asserting in a fix.

## Source claims — all verified ACCURATE
- `scripts/validate.sh` = **204 lines**, `set -euo pipefail`. Last numbered step = **"7. Compile-check and test epic-manifest helper"** (line 167). So tech-spec's "new hard step 8 appended after step 7" is correct. Step **6a (spec-purity)** and **6b (adapters regen-diff venv)** are TOP-LEVEL HARD gates (ERRORS++); step 7 (epic-manifest) + pytest are soft/non-fatal (WARNINGS++). Spec correctly makes step 8 HARD. `REPO_ROOT` is the var name (spec §3.9 snippet uses `$REPO_ROOT/installer` — matches).
- `scripts/forge-root.sh:19` `is_root()` requires BOTH `scripts/epic-manifest.py` AND `.claude-plugin/plugin.json`. (IR-1 accurate.)
- adapters bundles: 11 skills each, `scripts/forge-root.sh` ONLY (no epic-manifest.py), NO plugin.json, NO .claude-plugin anywhere. gemini adds `gemini-extension.json` (4631 B). codex adds agents/openai.yaml. cursor=.mdc. (IR-1 + §6 ground-truth claims accurate.)
- rauf VERSION = **0.6.0** (packages/core/src/version.ts) — so RAUF_PIN="rauf@0.6.0" is the current version. rauf still private/Bun-shebang/GitHub-Release-binaries (IR-2 accurate; npx rauf 404s today).
- feature-forge is Python+bash, ZERO package.json/JS/TS (verified) — installer is genuinely the first Node package.
- `.gitignore` is **16 lines** (NOT 17 as tech-spec §6 line 234 says). Already has `.venv-adapters/` + `adapters.tmp-*/` (forge-agent-adapters-build added them). Spec's adds (installer/node_modules,dist,adapters) are genuinely new.
- PRD has **40 unique REQs** (validator agrees). tech-spec cites all via ranges/slashes (REQ-RAUF-02 hides in "REQ-RAUF-01/02/03" slash token; REQ-RAUF-04 NOT cited anywhere — see gotcha).

## GOTCHAS / findings issued (tech-verify 2026-06-16)
- **featureForgeVersion source does not exist (gap, same root cause as IR-1).** Data model §4 says `featureForgeVersion // from the bundle (plugin.json / version header)`. But plugin.json is NOT in any bundle and bundled SKILL.md carry no version header. Field cannot be populated from the consumed adapters/ as written. (V-002.)
- **REQ-RAUF-04 (idempotent+reversible rauf bundling, uninstall accounts for it) is the ONLY REQ with no explicit reconciliation.** D1's lazy-npx model means rauf is never written into the install dest (resolved on demand), so there is nothing for uninstall to "account for" beyond `raufPin` in the manifest. Spec never says this. Genuine traceability gap. (V-003.)
- `.gitignore` "17 lines" → actually 16. Minor error. (V-004.)
- V-001 (epic-manifest consumes agent-cli-registry → should be published rauf bin) is PRE-FLAGGED in both PRD C-3 and tech-spec §6 line 230; intentionally deferred to an epic-manifest update, NOT done in this spec. Do NOT re-flag as new — it's a carried-forward, acknowledged item. EPIC.md line 140 ALSO carries the stale `agent-cli-registry` consume (the drift is in both manifest AND EPIC.md).
- Decision map D1-D9, 5 alternatives-considered blocks (D1 eager-install/global-install rejected with reasons; CHECK-T09 satisfied). Error handling §7 complete (exit 0/1/2, Result-style, per-agent partial). Testing §8 maps every REQ cluster. OQ-A..OQ-D capture deferrals well (TQ-1 per-agent paths, IR-1 self-location, rauf coordinate, installer coordinate).
- tech-verify result: 13 pass / 4 fail / 0 n-a of 17. T17 scalability is N/A-ish but PASSES (REQ-SCALE-01/02 addressed: add-agent=table row, add-skill=no change).

## tech-verify CONFIRMATION RE-RUN (2026-06-16, commit 012a9ca) — CLEAN
- All 4 prior findings RESOLVED. §4 featureForgeVersion now `string | null` (line 173) w/ deferral note + OQ-A extended (line 281). §3.1 has explicit "Idempotent + reversible (REQ-RAUF-04)" para (line 74) + header range REQ-RAUF-01..05 (line 66). §6 .gitignore "(16 lines)" (re-verified: file IS 16 lines). §6 reconciliation note names BOTH epic-manifest.json AND EPIC.md in lockstep (line 232).
- Re-verified all 40 REQs traced (REQ-RAUF-02 hides in slash token line 17 + range line 66; only one with literal-string count 0 but covered). validate.sh still 204ln, last step=7, REPO_ROOT var, ERRORS summary lines ~194-204 — all §6/§3.9 anchors accurate. EPIC.md stale consume at line 140, epic-manifest at line 55 — both still present (deferred fix, do NOT re-flag).
- 17/17 pass, ZERO new findings. Spec is clean. Did NOT manufacture findings.

## specs-verify CONFIRMATION RE-RUN (2026-06-16, commit bcc7621) — 1 minor new finding
- All 13 prior findings (V-001..V-013) RESOLVED. Key anchors after fix: 04 §2/§5/§9 `manifestPath(agent,scope,{home,cwd})` (no `manifestPathFor`); 07 §3.2 builds full 10-field ApplyContext incl `agentRoot` + consumes `apply`→AgentReport directly; 07 uses `locateSource`+`plan(subcommand,PlanContext)` (no bundleDir) + `readManifest(manifestPath(...))`; 06 `RegistryQuery=(coordinate)=>Result<string>` SYNC + `preflightRauf({skip,query})`, 07 calls it no-await, 08 imports real type w/ sync ok/err mocks; 05 §4 imports `ResolveOpts` from `./types.js`; 03 §3.7 LocatedSource all readonly/ReadonlyArray; 01 §4 barrel authoritative (+destinationFor,+formatZeroDetection) & tech-spec §5.2 note defers to it; 00 §7 constructors `src/types.ts` only; 08 §6 coverage list re-derived (resolveWithin/plan*/buildManifest/renderReport); 08 §5 has SCALE-01(§5.14)/SCALE-02(§5.4)/SEC-01(§5.2)/RAUF-04(§5.10)/SAFE-03(§5.4+§5.13) areas; 08 §6 WRITE_DENIED deterministic throwing-seam; [D2]/[D4]/[D5] tags present (00,01,04,08).
- ApplyContext (04 §5, 10 fields) & PlanContext (04 §4) both match 07's two construction sites exactly — no field drift. All 07 sibling imports resolve to real exports. 40 REQs still traced; TRACEABILITY.md accurate.
- **NEW minor finding (inconsistency, low):** 08 §6 coverage list names `validateManifest` under "every public function **exported** by 05," but 05 §5.1 declares it `function validateManifest` (INTERNAL, not exported) and 05's Verification export list (line 636) omits it. Introduced by the V-010 fix (its suggestion text said to add `validateManifest`). A `coverage.test.ts` importing it from dist/manifest.js would fail. Fix: drop `validateManifest` from the 08 §6 list (it's internal; readManifest's test exercises it indirectly).
- Non-finding observation: 04 §9 example uses `await readManifest(...)` though readManifest is sync (fs.readFileSync) — harmless (awaiting a non-promise), pre-existing, example is "Abbreviated"; not flagged.
