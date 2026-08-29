<!-- GENERATED — DO NOT EDIT. Regenerate: bun run scripts/build-copilot-bundle.ts -->

# Copilot Bundle Report

This Agent Plugins 1.0 bundle is generated from rauf's canonical operator sources.
Unsupported canonical fields fail generation unless an explicit mapping or drop record is added.

<!-- prettier-ignore -->
| Kind | Canonical source | Generated output | Mappings | Dropped fields |
| ---- | ---------------- | ---------------- | -------- | -------------- |
| Skill | `skills/author-backlog/SKILL.md` | `skills/author-backlog/SKILL.md` | name, description, body, 1 bundled file(s) | none |
| Skill | `skills/drive-rauf-loop/SKILL.md` | `skills/drive-rauf-loop/SKILL.md` | name, description, body, 0 bundled file(s) | none |
| Skill | `skills/review-backlog/SKILL.md` | `skills/review-backlog/SKILL.md` | name, description, body, 0 bundled file(s) | none |
| Skill | `skills/review-rauf-guidance/SKILL.md` | `skills/review-rauf-guidance/SKILL.md` | name, description, body, 0 bundled file(s) | none |
| Agent | `agents/rauf-backlog-reviewer.md` + `skills/review-backlog/SKILL.md` | `agents/rauf-backlog-reviewer.agent.md` | name, description, body; composed-skill=review-backlog; tools=read,search,execute; agents=[]; user-invocable=false | none |
| Agent | `agents/rauf-loop-driver.md` + `skills/drive-rauf-loop/SKILL.md` | `agents/rauf-loop-driver.agent.md` | name, description, body; composed-skill=drive-rauf-loop; tools=read,search,execute; agents=[]; user-invocable=false | none |
