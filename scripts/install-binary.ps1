#Requires -Version 5
#
# install-binary.ps1 — install the rauf CLI as a self-contained Windows binary.
#
# PowerShell mirror of scripts/install-binary.sh. Downloads the published
# rauf-windows-x64.exe release asset (only windows-x64 is built; Windows arm64
# is out of scope), verifies it against the release's SHA256SUMS, and installs
# it to $HOME\.local\bin\rauf.exe (symmetric with the Unix ~/.local/bin).
#
# Verification is MANDATORY — Get-FileHash ships with Windows, so unlike the
# Unix script there is no missing-tool soft-fail path. Any mismatch or
# unlisted asset removes the download and throws.
#
# Env overrides:
#   RAUF_REPO     GitHub owner/repo to fetch releases from (default garygentry/rauf)
#   RAUF_VERSION  Release tag to install (default: latest)
#
# Usage:
#   irm https://raw.githubusercontent.com/garygentry/rauf/main/scripts/install-binary.ps1 | iex
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

Write-Host "Downloading $Asset from $Repo ($Version)..."
$Tmp     = New-TemporaryFile
$SumsTmp = New-TemporaryFile
Invoke-WebRequest "$Base/$Asset"     -OutFile $Tmp     -UseBasicParsing
Invoke-WebRequest "$Base/SHA256SUMS" -OutFile $SumsTmp -UseBasicParsing

# Verify (mandatory on Windows — Get-FileHash is built in). An unlisted asset
# must hit the throw below with the download removed, so guard the match
# before dereferencing it (.Line.Split() on a no-match null would throw a
# null-method error first and leave $Tmp behind).
$SumsMatch = Select-String -Path $SumsTmp -Pattern " $([regex]::Escape($Asset))$" | Select-Object -First 1
$expected  = if ($SumsMatch) { $SumsMatch.Line.Split(" ")[0] } else { $null }
$actual    = (Get-FileHash -Algorithm SHA256 -Path $Tmp).Hash.ToLower()
Remove-Item $SumsTmp -Force
if (-not $expected) { Remove-Item $Tmp -Force; throw "$Asset not listed in SHA256SUMS" }
if ($actual -ne $expected.ToLower()) {
  Remove-Item $Tmp -Force
  throw "Checksum MISMATCH for ${Asset}: expected $expected, actual $actual"
}
Write-Host "Checksum OK ($Asset)."

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
