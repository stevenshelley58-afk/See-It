# Railway Environment Variables

## See-It Service Variables

These must be set in the Railway dashboard for the `See-It` service:

### Shopify Configuration

```
SHOPIFY_API_KEY=404b1dcd8562143be56b2dd81dec2270
SHOPIFY_API_SECRET=<from Shopify Partner Dashboard>
SHOPIFY_APP_URL=https://see-it-production.up.railway.app
SCOPES=write_products,read_products
```

### Database

Railway automatically provides `DATABASE_URL` when you link the Postgres service.

```
DATABASE_URL=postgresql://postgres:xxx@postgres.railway.internal:5432/railway
```

### Image Service

```
IMAGE_SERVICE_BASE_URL=https://see-it-image-service-433767365876.us-central1.run.app
IMAGE_SERVICE_TOKEN=8x9cseqow0tv5hgnz4d16ily3fum2bak
```

### Google Cloud Storage

```
GCS_BUCKET=see-it-room
GOOGLE_CREDENTIALS_JSON=<base64-encoded-service-account-json>
```

To encode your service account JSON:

```bash
# PowerShell
[Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes((Get-Content -Raw gcs-key.json)))

# Bash
base64 -w 0 gcs-key.json
```

## Postgres Service Variables

Railway auto-sets these. No manual configuration needed:

- `DATABASE_URL`
- `PGHOST`
- `PGPORT`
- `PGUSER`
- `PGPASSWORD`
- `PGDATABASE`

## Variable References

Railway supports variable references. The See-It service should reference Postgres:

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

## Verifying Variables

Check that all variables are set:

```bash
railway variables --service See-It
```
