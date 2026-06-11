# 05 — Install Scripts

The end-user install path: a checksum-verifying modification to the existing Unix `install-binary.sh`, a new Windows `install-binary.ps1`, and a documented macOS quarantine note. These consume the assets published by `04-ci-preflight-and-workflow.md`.

## Requirement Coverage

| REQ ID            | Requirement                                                  | Section |
| ----------------- | ----------------------------------------------------------- | ------- |
| REQ-INSTALL-01    | `install-binary.sh` installs `latest` with no URL changes   | 1       |
| REQ-INSTALL-02    | Windows PowerShell installer + published `.exe`             | 2       |
| REQ-INTEGRITY-02  | Verify downloaded binary against published checksums        | 1.2, 2.3|
| (tech §3.12)      | macOS Gatekeeper/quarantine note (OQ-3, RISK-2)             | 3       |

## 1. `install-binary.sh` (MODIFIED)

The script's download URL scheme and `detect_asset()` are **unchanged** — they already match the published asset names and `releases/{latest|<tag>}/download/` layout (REQ-INSTALL-01, verified at `scripts/install-binary.sh:48-61,77-81`). The only change is adding SHA256 verification after download.

### 1.1 What stays the same

- `detect_asset()` → `rauf-${os}-${arch}` (linux/darwin × x64/arm64). Unix-only; no `.exe`.
- `RAUF_REPO` default `garygentry/rauf`; `INSTALL_DIR` default `$HOME/.local/bin`.
- `--local` and `--name` modes.

### 1.2 New: checksum verification (REQ-INTEGRITY-02, OQ-2 resolved → on by default)

After the existing successful download into `$TMP` (currently `scripts/install-binary.sh:84-90`), and **before** `install -m 0755 "$TMP" "$TARGET"`, insert verification. Verification is **on by default**; `--local` mode skips it (no release to verify against).

```bash
# (download mode only, after $TMP is fetched)
# Fetch the checksums file from the same release.
if [[ "$TAG" == "latest" ]]; then
  SUMS_URL="https://github.com/$RAUF_REPO/releases/latest/download/SHA256SUMS"
else
  SUMS_URL="https://github.com/$RAUF_REPO/releases/download/$TAG/SHA256SUMS"
fi

# Pick a checksum tool; a MISSING tool is a soft-fail (warn + continue).
SUM_TOOL=""
if command -v sha256sum >/dev/null 2>&1; then
  SUM_TOOL="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
  SUM_TOOL="shasum -a 256"
fi

if [[ -z "$SUM_TOOL" ]]; then
  echo "Warning: no sha256 tool found; skipping checksum verification." >&2
else
  SUMS_TMP="$(mktemp)"
  if ! curl -fsSL "$SUMS_URL" -o "$SUMS_TMP"; then
    echo "Warning: could not fetch SHA256SUMS; skipping verification." >&2
    rm -f "$SUMS_TMP"
  else
    EXPECTED="$(grep " ${ASSET}\$" "$SUMS_TMP" | awk '{print $1}')"
    rm -f "$SUMS_TMP"
    if [[ -z "$EXPECTED" ]]; then
      echo "Warning: $ASSET not listed in SHA256SUMS; skipping verification." >&2
    else
      ACTUAL="$($SUM_TOOL "$TMP" | awk '{print $1}')"
      if [[ "$ACTUAL" != "$EXPECTED" ]]; then
        echo "Checksum MISMATCH for $ASSET:" >&2
        echo "  expected $EXPECTED" >&2
        echo "  actual   $ACTUAL" >&2
        rm -f "$TMP"                 # hard-fail: delete the unverified download
        exit 1
      fi
      echo "Checksum OK ($ASSET)."
    fi
  fi
fi
```

**Failure semantics (REQ-INTEGRITY-02):**
- **Mismatch** → hard-fail: print expected vs actual, delete `$TMP`, exit 1. The bad binary is never installed.
- **Missing checksum tool** → warn and continue (the script is often piped from `curl | bash`; a missing tool must not brick install).
- **Checksums file unreachable / asset not listed** → warn and continue.
- **`--local` mode** → verification skipped entirely (nothing published to verify against).

## 2. `install-binary.ps1` (NEW — REQ-INSTALL-02)

A PowerShell mirror of `install-binary.sh` for Windows, hosted under the same `raw.githubusercontent.com/garygentry/rauf/main/scripts/` pattern (OQ-1 resolved). One-line invocation:

```powershell
irm https://raw.githubusercontent.com/garygentry/rauf/main/scripts/install-binary.ps1 | iex
```

### 2.1 Behavior

- **Asset:** always `rauf-windows-x64.exe` (only `windows-x64` is built; Windows arm64 is out of scope).
- **Install dir:** `$HOME\.local\bin` (symmetric with the Unix `~/.local/bin`); created if missing.
- **Version:** env `RAUF_VERSION` (default `latest`); URL scheme mirrors the Unix script:
  - latest → `https://github.com/garygentry/rauf/releases/latest/download/rauf-windows-x64.exe`
  - tagged → `https://github.com/garygentry/rauf/releases/download/<tag>/rauf-windows-x64.exe`
- **PATH:** if the install dir is not on the user `PATH`, append it to the **user** environment variable and warn that a new shell is needed.
- **Checksum:** always verify via `Get-FileHash -Algorithm SHA256` against `SHA256SUMS` (the tool is built into Windows, so unlike Unix there is no "missing tool" path — verification is unconditional; mismatch is a hard-fail).

### 2.2 Reference implementation

```powershell
#Requires -Version 5
$ErrorActionPreference = "Stop"

$Repo    = if ($env:RAUF_REPO) { $env:RAUF_REPO } else { "garygentry/rauf" }
$Version = if ($env:RAUF_VERSION) { $env:RAUF_VERSION } else { "latest" }
$Asset   = "rauf-windows-x64.exe"
$InstallDir = Join-Path $HOME ".local\bin"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

if ($Version -eq "latest") {
  $Base = "https://github.com/$Repo/releases/latest/download"
} else {
  $Base = "https://github.com/$Repo/releases/download/$Version"
}

$Tmp     = New-TemporaryFile
$SumsTmp = New-TemporaryFile
Invoke-WebRequest "$Base/$Asset"      -OutFile $Tmp     -UseBasicParsing
Invoke-WebRequest "$Base/SHA256SUMS"  -OutFile $SumsTmp -UseBasicParsing

# Verify (mandatory on Windows — Get-FileHash is built in).
$expected = (Select-String -Path $SumsTmp -Pattern " $([regex]::Escape($Asset))$").Line.Split(" ")[0]
$actual   = (Get-FileHash -Algorithm SHA256 -Path $Tmp).Hash.ToLower()
Remove-Item $SumsTmp -Force
if (-not $expected) { Remove-Item $Tmp -Force; throw "$Asset not listed in SHA256SUMS" }
if ($actual -ne $expected.ToLower()) {
  Remove-Item $Tmp -Force
  throw "Checksum MISMATCH for ${Asset}: expected $expected, actual $actual"
}

$Target = Join-Path $InstallDir "rauf.exe"
Move-Item -Force $Tmp $Target
Write-Host "Installed: $Target"

# PATH check (user scope).
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$InstallDir*") {
  [Environment]::SetEnvironmentVariable("Path", "$userPath;$InstallDir", "User")
  Write-Host "Added $InstallDir to your user PATH — open a new terminal to pick it up."
}

& $Target version
```

## 3. macOS Gatekeeper / quarantine (tech-spec §3.12, OQ-3, RISK-2)

**Documentation only — no code.** The install/release docs note:
- The darwin binaries are unsigned in v1 (signing deferred, REQ-INTEGRITY-03).
- Workaround if Gatekeeper blocks the binary: `xattr -d com.apple.quarantine ./rauf` (or right-click → Open once).
- Caveat: binaries fetched via `curl`/`install-binary.sh` are typically **not** quarantined (the attribute is applied by browsers/Finder, not `curl`), so terminal installs are usually unaffected.

## Dependencies

- `04-ci-preflight-and-workflow.md` — publishes the assets (`rauf-*`, `rauf-windows-x64.exe`) and `SHA256SUMS` these scripts download.
- `00-core-definitions.md` — `RELEASE_TARGETS` (asset names) and `CHECKSUMS_FILE` define the contract these scripts rely on.

## Verification

- After a real release, on a fresh Unix machine: `curl -fsSL …/install-binary.sh | bash` downloads, verifies checksum (`Checksum OK`), installs, and `rauf version` prints the released version (REQ-INSTALL-01, Success Criteria #4).
- Tamper test: corrupt a local copy and point the script at it → `Checksum MISMATCH` hard-fail, nothing installed.
- On Windows: the `irm … | iex` one-liner installs `rauf.exe`, verifies via `Get-FileHash`, adds `~\.local\bin` to user PATH, and `rauf version` prints the released version (REQ-INSTALL-02).
- Prerelease-by-tag: `RAUF_VERSION=v0.3.0-rc.1` installs the prerelease asset by explicit tag on both platforms (tech-spec §8).
