# Skill Spec-Purity

The `feature-forge` skill suite was authored exclusively for Claude Code. Its
`SKILL.md` files carried Claude-specific frontmatter (`argument-hint`), located bundled
scripts through the Claude-only `${CLAUDE_PLUGIN_ROOT}` environment variable, and several
skill bodies exceeded the Agent Skills size recommendation. This feature makes the suite a
**vendor-neutral, spec-pure canonical source of truth** — the read-only input every
downstream `agent-agnostic` epic feature consumes.

It is a mechanical, behavior-preserving refactor plus two new tools:

1. **A portable root resolver** (`scripts/forge-root.sh`) that finds bundled scripts
   without depending on `${CLAUDE_PLUGIN_ROOT}`.
2. **A spec-purity checker** (`scripts/check-spec-purity.py`) that hard-gates the canon
   against five rules and is wired into `scripts/validate.sh`.

> **Where the code lives.** All implementation is in the **`feature-forge`** repo
> (`/home/gary/workspace/feature-forge`). These specs, this backlog, and the loop that
> built it run from the **`rauf`** repo. Nothing in `rauf`'s own skills changed.

> **Two exposed artifacts** (consumed downstream, per the epic manifest):
> `spec-pure-skills` (the 11 conforming `SKILL.md` files + their `references/`) and
> `portable-skill-root-resolver` (`forge-root.sh`, copied verbatim into per-agent mirrors
> by `forge-agent-adapters-build`).

## Quick Start

Run the gate from the `feature-forge` repo root:

```bash
# The spec-purity checker alone (exit 0 = clean, 1 = violations, 2 = usage error)
python3 scripts/check-spec-purity.py

# The full validation gate, which now includes the checker as an unconditional step
bash scripts/validate.sh

# The checker's unit + resolver tests
python3 -m pytest tests
```

Resolve the plugin root portably (what every bundled invocation now does):

```bash
R="$(for d in "$HOME"/.claude/skills/feature-forge "$HOME"/.claude/plugins/*/feature-forge; do [ -x "$d/scripts/forge-root.sh" ] && exec "$d/scripts/forge-root.sh"; done)"
[ -n "$R" ] || { echo "feature-forge: cannot locate plugin root" >&2; exit 1; }
python3 "$R/scripts/epic-manifest.py" --json
```

## Key Concepts

- **Canonical surface.** The shipped, vendor-neutral skill files the checker polices:
  every `skills/*/SKILL.md`, all files under any `references/` tree, and `agents/*.md`.
  Non-canonical Claude artifacts (`hooks/hooks.json`) are deliberately **out of scope** —
  left in place but documented.
- **The five rules** (all hard-fail): frontmatter keys ⊆ allowed set, `name == directory`,
  no residual `${CLAUDE_PLUGIN_ROOT}` in canonical surfaces, body size ≤ 300 lines AND
  ≤ 5000 words, and bootstrap-prelude byte-identity. See [architecture](./architecture.md).
- **The bootstrap prelude.** A canonical two-line Bash snippet that calls `forge-root.sh`
  and binds the result to `$R`. Every former `${CLAUDE_PLUGIN_ROOT}` invocation now carries
  this prelude verbatim; rule 5 enforces that every copy is byte-identical to the canon in
  `references/portable-root.md`.
- **Sanctioned residual.** Exactly one `${CLAUDE_PLUGIN_ROOT}` survives in canon: the
  documented env fallback inside `forge-root.sh` itself (Claude stays first-class, C-4).

## Package Exports

This feature ships scripts and Markdown, not a code package. The "exports" are:

| Entry point                                | Description                                                             |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| `scripts/forge-root.sh`                    | Portable plugin-root resolver. Prints the root; never sources/executes. |
| `scripts/check-spec-purity.py`             | Stdlib-only spec-purity checker (CLI + 5 rules).                        |
| `references/portable-root.md`              | Canonical home of the bootstrap prelude + resolver usage.               |
| `references/vendor-construct-inventory.md` | The REQ-VND-03 vendor-construct audit + dispositions.                   |
| `skills/*/SKILL.md` (×11) + `references/`  | The `spec-pure-skills` canon itself.                                    |

## When to use / When NOT to use

- **Use the checker** as the objective "is the canon spec-pure?" gate — locally before a
  commit, and (later) wired into CI by `packaging-docs-ci`.
- **Use the resolver** from any bundled script or skill body that needs a sibling script's
  path, on any agent.
- **Do NOT** use this feature to generate per-agent output (Codex/Copilot/Cursor/Gemini
  mirrors, `AGENTS.md`) — that is strictly `forge-agent-adapters-build`. This feature only
  produces the neutral canon those adapters are derived from.

## Further Reading

- [Architecture](./architecture.md) — canonical-surface model, the five rules, resolver design, gate wiring, decisions
- [API Reference](./api-reference.md) — checker CLI + exit codes + reason tokens, resolver contract, constants
- [Integration Guide](./guides/integration.md) — how downstream epic features consume the canon + resolver
