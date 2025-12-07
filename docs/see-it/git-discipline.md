# Git Discipline – See It App

Operational rules for working on See It. These are process constraints you should follow around spec-first changes, branches, and pull requests.

## One change, one PR, spec first

- Any **structural** change (routes, DB schema, auth behavior, core flows) must:
  - First update `/docs/see-it/spec.md` (and contracts if needed) in a small, focused commit.
  - Then implement the corresponding code changes in a separate commit.
- Never accept or merge a change that:
  - Alters the DB schema without touching `/docs/see-it/spec.md` and `/docs/see-it/contracts/db.md`.
  - Changes routes or auth behavior without updating `/docs/see-it/spec.md` and `/docs/see-it/contracts/backend.md`.

## Branching and scope

- Use a dedicated branch per logical change, for example:
  - `feature/gdpr-webhooks`
  - `fix/render-timeout`
  - `chore/spec-sync-0-4`
- Avoid branches or PRs that mix unrelated concerns (e.g., schema changes + billing + frontend polish).
- If a Cursor plan touches more than ~3 logical areas in a single task, treat it as drift risk and split the work into smaller branches/PRs.

## Review habits

- Turn on “show diff” for all Cursor edits and actually review them before accepting.
- Confirm that every change that affects behavior:
  - Has a corresponding spec/contract reference.
  - Is covered by the current “Non negotiables” in `/docs/see-it/spec.md` (or explicitly updates them).
- Use the drift-audit prompt from `/docs/see-it/drift-audit-checklist.md` periodically (e.g., daily) to ensure there is no silent drift between code and spec.

