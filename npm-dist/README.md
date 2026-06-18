# rauf

Management tool for **rauf** autonomous coding loops — install, run, and monitor
rauf loops across your local software projects.

## Install

```bash
# one-off, no install
npx rauf@latest status .

# or install globally
npm install -g rauf
rauf --version
```

## How it works

This npm package is a thin **launcher**. The real `rauf` CLI is a single
self-contained binary compiled with [Bun](https://bun.sh) and published per-OS to
[GitHub Releases](https://github.com/garygentry/rauf/releases). On first run the
launcher:

1. detects your platform/arch and picks the matching release asset
   (`rauf-{linux,darwin}-{x64,arm64}`, `rauf-windows-x64.exe`),
2. downloads the binary for **this package's version** and verifies it against
   the release `SHA256SUMS`,
3. caches it under `~/.cache/rauf/bin/<version>/` and execs it.

So `npx rauf@0.7.0` always runs the `v0.7.0` binary — **no Bun or repo checkout
required**, just Node ≥ 18. Subsequent runs use the cached binary.

### Environment overrides

| Variable         | Purpose                                                               |
| ---------------- | --------------------------------------------------------------------- |
| `RAUF_VERSION`   | Fetch a different release tag than the package version.               |
| `RAUF_REPO`      | `owner/repo` to fetch release assets from (forks/mirrors).            |
| `RAUF_CACHE_DIR` | Override the cache base dir (default `$XDG_CACHE_HOME` / `~/.cache`). |

## Alternatives

Prefer a direct binary install (no Node)? Use the install script:

```bash
curl -fsSL https://raw.githubusercontent.com/garygentry/rauf/main/scripts/install-binary.sh | bash
```

## Links

- **Repository & docs:** https://github.com/garygentry/rauf
- **Issues:** https://github.com/garygentry/rauf/issues

MIT © rauf contributors
