# Claude Code (Project Config)

This repo uses **project-level Claude Code rules** to keep agent output consistent and “Shopify-app-review safe”.

## What’s committed vs local-only

- ✅ Committed: `.claude/rules/*.md` (ECC + repo-specific rules), `.claude/package-manager.json`
- ❌ Local-only (ignored): `.claude/settings.local.json`, `.claude/skills/`, `.claude-skills/`

## Everything-Claude-Code (ECC)

ECC provides reusable rules/agents/commands/hooks/skills for Claude Code.

- Rules are vendored into this repo at `.claude/rules/` (because Claude Code plugins can’t ship rules).
- To update to a newer ECC version, use the sync script:
  - `node scripts/ecc-sync.mjs`
  - `node scripts/ecc-verify.mjs`

### Installing the ECC plugin (optional, user-level)

Install ECC’s plugin globally so Claude Code has access to its agents/commands/hooks/skills.
Follow ECC’s README “Option 1” (marketplace install) or clone-based install.

## Pre-PR checklist (required)

- `cd app && npm run check:consistency`
- `cd app && npm run lint && npm run typecheck && npm test`
- `cd see-it-monitor && npm run lint`

