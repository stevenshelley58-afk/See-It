# Cursor Plan Prompt – See It App

Use this as a **Plan mode preset** in Cursor for all See It work. The goal is to force plans to anchor on the spec and contracts, surface drift, and express edits as minimal diffs.

## Plan-mode instruction (copy-paste into Cursor)

```text
You are working on the See It Shopify app. Follow these rules strictly.

1) Start from the spec

Before proposing any steps, open `/docs/see-it/spec.md`, summarise it in 5 bullets, and restate the target change in that context. If the requested change conflicts with the spec, STOP and ask for a spec update first.

If any proposed step conflicts with the “Non negotiables” section in `/docs/see-it/spec.md`, STOP and ask for explicit override before proceeding.

2) Respect backend contracts

Before editing any backend route, open `/docs/see-it/contracts/backend.md`. If the change violates a contract, STOP and ask me to explicitly approve a contract update.

Treat the contract files under `/docs/see-it/contracts` (frontend, backend, db) as rigid: they should almost never change. If you believe a contract must change, propose the spec/contract update first, then the code change.

3) Detect stale specs before planning work

After reading `/docs/see-it/spec.md`, scan the repo for:
- New routes under `app/app/routes/`
- New Prisma models or fields in `app/prisma/schema.prisma`
- New environment variables used in code

If you find anything not mentioned in the spec, list them in a “Spec probably stale” section and STOP. Do not proceed with code changes until I have resolved that section by updating the spec or aligning the code.

4) Plan structure and checklists

For every plan you generate:
- Include a “Spec compliance checklist” section that maps each planned step to specific sections in `/docs/see-it/spec.md` or the contract files in `/docs/see-it/contracts`.
- Include a “Risk of drift” section that lists anything that might diverge from existing behavior, schema, or contracts.
- Do NOT run any edits until you output that checklist and I have confirmed it looks correct.

Call out explicitly if any step is “unanchored” (i.e., you cannot map it to a spec or contract section). Unanchored steps are red flags and should usually be removed or rewritten.

5) Editing philosophy: minimal diffs only

When editing files, always:
- Read the full existing file content that you plan to modify.
- Describe the change as a minimal diff, preserving all unrelated behavior.
- Prefer small, targeted patches over full-file rewrites.
- Do not rewrite files wholesale if a targeted patch is possible.

If a full-file rewrite is truly necessary (e.g., the file is fundamentally wrong relative to the spec), explain why, reference the relevant spec sections, and call this out in the plan and the “Risk of drift” section.

6) Contracts and non-negotiables

- Never change route shapes, HTTP methods, or auth behavior that are locked in `/docs/see-it/spec.md` and `/docs/see-it/contracts/backend.md` without an explicit contract + spec update step.
- Never change the DB schema (new models, new columns, type changes, or renames) without an explicit step to update `/docs/see-it/spec.md` (Database schema + Non negotiables) and `/docs/see-it/contracts/db.md` first.
- If any proposed step conflicts with the “Non negotiables” section in `/docs/see-it/spec.md`, STOP and ask for explicit override.

7) Scope and git hygiene (for planning)

While planning, keep scope tight:
- Prefer plans that touch a single logical area (e.g., “render timeout handling” or “admin product list UI”) at a time.
- If a plan touches more than ~3 logical areas (e.g., DB schema, billing, and frontend) for a single task, call this out as high drift risk and propose splitting the work into multiple smaller changes/branches.
- Explicitly note when a change will require two commits: one for spec/contract updates, one for code changes.
```

