# Privacy Retention

See It processes shopper room photos only to produce a requested render. The app does not create shopper accounts, does not collect shopper email, and does not provide a saved room gallery.

## Data Classes

- Room uploads: private Supabase Storage, short operational retention.
- Generated shopper renders: private Supabase Storage, short operational retention.
- Merchant product metadata: retained while the Shopify app is installed or until deletion.
- AI invocation metadata: retained for debugging, replay, cost, and compliance with secrets redacted.
- Prompt/model/provider records: retained as founder operational control data.
- Event/audit logs: retained for launch operations and incident review.

## Privacy Webhooks

Required Shopify webhook routes:

- `POST /api/webhooks/privacy/customers-data-request`
- `POST /api/webhooks/privacy/customers-redact`
- `POST /api/webhooks/privacy/shop-redact`

All webhook routes must verify Shopify HMAC before work is accepted. For customer-level requests, See It returns success even when no shopper account exists, because shopper identity is not stored.

## Uninstall

`app/uninstalled` must:

1. Verify HMAC.
2. Mark `shop.uninstalled_at`.
3. Clear encrypted offline token.
4. Disable the widget.
5. Cancel active jobs for the shop.
6. Purge active room sessions and retention-controlled assets.
7. Update local billing status.
8. Write an event log.

## Secrets

Secrets live only in env/secret manager. Database records store secret references such as `OPENAI_API_KEY`, not raw values. Provider requests and responses must be redacted before storage, including auth headers and signed URLs.

## Verification

Run:

```powershell
pnpm.cmd run test
pnpm.cmd run test:integration
pnpm.cmd run db:verify:write
pnpm.cmd run storage:verify
```

Manual launch review must also confirm the public privacy policy describes temporary room-photo processing and retention.
