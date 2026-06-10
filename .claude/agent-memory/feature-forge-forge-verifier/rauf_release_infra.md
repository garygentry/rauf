---
name: rauf-release-infra
description: Existing release/distribution infrastructure facts for rauf — install script asset naming, CI gate, distribution model
metadata:
  type: project
---

**Distribution model:** GitHub Releases only. No npm publish (all packages `private: true`). `install-binary.sh` downloads `rauf-{os}-{arch}` from `releases/latest/download/...` or `releases/download/<tag>/...`.

**install-binary.sh detect_asset:** os ∈ {linux, darwin}; arch ∈ {x64, arm64}. NO Windows branch, NO `.exe` extension handling as of 2026-06. So `rauf-windows-x64.exe` cannot be installed by the existing Unix script — Windows needs its own script (PRD acknowledges this).

**CI gate (`ci.yml`) order:** pnpm install --frozen-lockfile → pnpm build → schema:check → typecheck → lint → format:check → test. The release-automation PRD's REQ-BUILD-06 says the release workflow mirrors these. Note: `pnpm build` must precede typecheck/test because downstream packages import @rauf/core from built dist.

**Binary build:** `pnpm compile` = `pnpm build && bun build --compile scripts/binary-entry.ts --outfile rauf-bin`. Builds ONE binary for the CURRENT platform only. Cross-compiling all 5 targets via `bun build --compile --target=...` is the PRD's load-bearing assumption.

**ci.yml setup-bun (as of 2026-06):** `oven-sh/setup-bun@v2` is used with NO explicit `bun-version` input — it picks latest. Adding `.bun-version` (1.3.10) changes what CI resolves, so introducing the pin is a behavior change to ci.yml's effective Bun, not a no-op. Root `pnpm test` = `pnpm -r test` only (no root vitest project yet); each package's `test` = `vitest run`. vitest ^3.0.0 is a devDep in core/cli/loop/web but NOT at the root.

**How to apply:** Use these as ground truth when checking release specs against "existing infrastructure" claims.
