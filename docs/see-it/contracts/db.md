# DB Contracts

This file locks the relational schema that backs the See It app. Prisma (`app/prisma/schema.prisma`) and migrations MUST reflect this contract.

Any change to these tables, columns, or relationships is a **material change** and requires:

- Updating `/docs/see-it/spec.md` (Database schema + Non negotiables).
- Adding migration notes to the spec changelog.
- Coordinated changes to application code and migrations.

If a proposed change conflicts with this file, STOP and ask for explicit approval to update the contract and spec.

## Canonical tables

The following tables MUST exist with these names and roles:

- `shops` — one row per installed Shopify shop.
- `product_assets` — prepared product imagery and metadata per shop/product/source image.
- `room_sessions` — shopper room upload sessions.
- `render_jobs` — individual composite render attempts.
- `usage_daily` — aggregated per-day usage per shop.

These tables and their key columns are described in detail in `/docs/see-it/spec.md` (Database schema).

## Contract rules

- Do not rename or drop these tables without a spec update that includes clear migration guidance.
- Do not change primary keys, foreign keys, or core column types without:
  - Updating `/docs/see-it/spec.md` (including migration notes).
  - Updating this file to reflect the new contract.
- No new Prisma models or tables are allowed without a documented purpose and schema in `/docs/see-it/spec.md`.
- Tracked columns include:
  - `room_sessions.gemini_file_uri` (text, nullable) for optional Gemini file uploads.
  - `product_assets.error_message` (text, nullable) for failure context.
- Image binaries MUST NOT be stored in the database; only URLs and metadata are allowed.

## Prisma & migrations

- `app/prisma/schema.prisma` is the implementation of this contract; it must not diverge from `/docs/see-it/spec.md`.
- Every schema change must be accompanied by a migration and a changelog entry in the spec.
- If drift is detected between the live database, Prisma schema, and this contract/spec, either:
  - Update the spec + contracts first, then realign Prisma and code, or
  - Remove or refactor the out-of-spec code/schema to match the current documented contract.

