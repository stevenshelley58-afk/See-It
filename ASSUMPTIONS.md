# Assumptions

- Local and CI verification use deterministic local provider adapters unless real provider credentials are present.
- Production prompt behavior is backed by database records. Seed prompt text exists only for local bootstrap and tests.
- Supabase migrations are the schema authority; in-memory repository exists only to make local tests and smoke scripts deterministic.
- Shopify App Pricing is the default billing route until an ADR says otherwise.
