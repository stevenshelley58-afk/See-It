# Risk Register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Provider response shape changes | Render failures | Adapter contract tests, redacted raw response storage, fallback routes |
| Prompt changes degrade quality | Bad shopper output | Draft/review/approved/active workflow, benchmark gate, rollback deployments |
| Shopper room privacy | Compliance exposure | Short retention, private storage, signed reads, metadata preserved after purge |
| App proxy abuse | Cost and quota leakage | Shopify HMAC, rate limits, product readiness, quota guard |
| Vercel runtime duration | Dropped render jobs | Durable job leases, retry policy, dead job dashboard |
