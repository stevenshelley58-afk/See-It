# Production Deployment Guide - See It App

## Current Setup vs Production Ready

### ✅ What We Have Now (Working)
- **Automatic Shop Creation**: The app creates shop records on-the-fly when missing
- **Error Handling**: Gracefully handles missing shop records
- **Basic Functionality**: App loads and works for test stores

### 🎯 Production Requirements for App Store

## 1. Webhook Handlers ✅ 
**Status: READY** - We've implemented proper webhook handlers:

### APP_INSTALLED Webhook (`webhooks.app.installed.jsx`)
- Automatically creates shop record when app is installed
- Stores shop ID, access token, and default quotas
- Handles reinstallations gracefully

### APP_UNINSTALLED Webhook (`webhooks.app.uninstalled.jsx`)
- Marks shop as uninstalled (soft delete)
- Preserves data for potential reinstallation
- Cleans up sessions

## 2. Required Webhooks for Production
Shopify automatically registers webhooks based on your route files:
- `webhooks.app.installed.jsx` → APP_INSTALLED
- `webhooks.app.uninstalled.jsx` → APP_UNINSTALLED  
- `webhooks.app.scopes_update.jsx` → APP_SCOPES_UPDATE
- `webhooks.products.update.jsx` → PRODUCTS_UPDATE

## 3. Environment Variables Required
Ensure these are set in your production environment:
```
SHOPIFY_API_KEY=<your_api_key>
SHOPIFY_API_SECRET=<your_api_secret>
SHOPIFY_APP_URL=<your_production_url>
DATABASE_URL=<postgresql_connection_string>
SCOPES=write_products,read_products
IMAGE_SERVICE_BASE_URL=<cloud_run_service_url>
IMAGE_SERVICE_TOKEN=<secure_token>
```

## 4. Database Considerations
- **PostgreSQL**: Required for production (not SQLite)
- **Migrations**: Run `prisma migrate deploy` before deploying
- **Backups**: Set up automatic backups in Railway/production

## 5. App Store Submission Checklist

### Before Submission:
- [ ] Test complete installation flow on multiple test stores
- [ ] Verify all webhooks are working (check logs)
- [ ] Test billing flow (upgrade/downgrade)
- [ ] Ensure GDPR compliance webhooks are implemented
- [ ] Add proper error pages and user feedback
- [ ] Implement rate limiting
- [ ] Add monitoring and logging (e.g., Sentry)

### GDPR Webhooks (Required for App Store):
You'll need to implement these three GDPR webhooks:
1. `customers/data_request` - Export customer data
2. `customers/redact` - Delete customer data  
3. `shop/redact` - Delete shop data after 48 hours

### Billing:
- Current setup uses Shopify's billing API
- FREE and PRO plans configured
- Test the full upgrade/downgrade flow

## 6. Security Checklist
- [ ] All secrets in environment variables (never in code)
- [ ] HTTPS enforced everywhere
- [ ] Webhook verification implemented
- [ ] Session validation on all routes
- [ ] Rate limiting on API endpoints
- [ ] Input validation and sanitization

## 7. Deployment Steps

### For Railway:
```bash
# 1. Push code to GitHub
git push origin main

# 2. Railway auto-deploys from GitHub

# 3. Run migrations (if needed)
railway run npx prisma migrate deploy

# 4. Verify deployment
railway logs
```

### For Other Platforms:
Follow similar steps but ensure:
1. Node.js 20+ is available
2. PostgreSQL database is provisioned
3. Environment variables are configured
4. Build command: `cd app && npm ci && npx prisma generate && npm run build`
5. Start command: `cd app && npm run start`

## 8. Testing Production Deployment

### Installation Flow:
1. Install app on test store
2. Check logs for "Created shop record" message
3. Verify shop record in database
4. Test all app features

### Uninstallation Flow:
1. Uninstall app from test store
2. Check logs for "Marked shop as uninstalled" message
3. Verify shop record has `uninstalledAt` timestamp
4. Reinstall and verify it works

## 9. Monitoring & Maintenance

### Set Up Monitoring For:
- Error rates (500 errors, failed webhooks)
- Response times
- Database connection issues
- Image service availability
- Quota usage trends

### Regular Maintenance:
- Review and clean up old render jobs (>30 days)
- Monitor database size
- Update dependencies monthly
- Review error logs weekly

## 10. Scaling Considerations

As your app grows:
- Consider caching frequently accessed data
- Implement job queues for heavy processing
- Use CDN for static assets
- Optimize database queries
- Consider horizontal scaling for the image service

## Summary

**Your app is now production-ready for basic operations!** The webhook handlers ensure that shop records are created properly when merchants install your app, and the fallback logic in the routes provides redundancy.

### Next Priority Actions:
1. ✅ Implement GDPR webhooks (required for App Store)
2. ✅ Set up error monitoring (Sentry or similar)
3. ✅ Test complete billing flow
4. ✅ Add user onboarding/tutorial
5. ✅ Create support documentation

Once these are complete, your app will be ready for Shopify App Store submission!
