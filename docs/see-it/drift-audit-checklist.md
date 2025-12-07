# Drift Audit Checklist – See It App

Use this outside Plan mode (e.g., at the end of a work day or a chunk of work) to detect drift between the code and the spec/contracts.

## How to run a drift audit

1. Open:
   - `/docs/see-it/spec.md`
   - `/docs/see-it/contracts/backend.md`
   - `/docs/see-it/contracts/frontend.md`
   - `/docs/see-it/contracts/db.md`
2. Get the git diff for the period you care about (e.g., today’s work or a feature branch).
3. Ask Cursor (regular chat, not Plan mode) to run the following prompt.

## Drift-audit prompt (copy-paste into Cursor)

```text
You are reviewing the See It Shopify app for drift between the code and the spec/contracts.

1) Read `/docs/see-it/spec.md` and the contract files under `/docs/see-it/contracts` (frontend, backend, db).
2) Read the git diff I provide (for today’s work or the current branch).

From this, produce three lists:
- “Changes that align with spec” — code changes that clearly implement or refine behavior already described in the spec/contracts.
- “Behavior changes not described in spec” — anything that alters behavior, routes, payloads, or flows that is not documented in `/docs/see-it/spec.md`.
- “New magic strings/env vars/routes/models without documentation” — any new environment variables, magic constants, Prisma models/fields, or HTTP routes that are not mentioned in the spec/contracts.

For each item in the last two lists, propose one of:
- “Update spec/contracts” — if the change is desired and should be made official.
- “Revert or refactor code” — if the change is accidental or should not ship.

Do not propose code edits yet; focus on identifying drift and recommending whether to update the spec/contracts or the code.
```

## What to do with findings

- For each documented behavior change that should stay:
  - Update `/docs/see-it/spec.md` and the relevant contract file(s).
  - Bump the spec version and add a changelog entry.
- For each out-of-spec change that should not stay:
  - Revert or refactor the code to bring it back in line with the current spec/contracts.

