# Claude Code Project Setup

This repository uses a project-local Everything Claude Code (ECC) setup.

## What Is Committed

- `.claude/rules/*.md` and `.claude/rules/.ecc-version.json`
- `.claude/agents/*.md`
- `.claude/commands/*.md`
- `.claude/hooks/hooks.json`
- `.claude/scripts/hooks/*.js` and `.claude/scripts/lib/*.js`
- `.claude/contexts/dev.md`

## What Stays Local

- `.claude/settings.local.json`
- `.claude/skills/` (installed locally, ignored by git)
- `.claude-skills/`

## ECC Reference

- Source: `affaan-m/everything-claude-code`
- Pinned ref: `90ad2f3885033c981ae1ab72120cef252296aa6c`

## Refresh ECC Rules

```bash
node scripts/ecc-sync.mjs
node scripts/ecc-verify.mjs
```

## Optional Local Skills Install

If skills are missing locally, copy from the ECC clone:

```bash
cp -r <ecc-clone>/skills/* .claude/skills/
```

## Pre-PR Checks

```bash
cd app && npm run check:consistency
cd app && npm run lint && npm run typecheck && npm test
cd see-it-monitor && npm run lint
```
