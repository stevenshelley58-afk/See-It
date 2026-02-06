# Deployment Checklist for Data Flow Fixes

## Pre-Deployment
- [ ] Run all tests locally: `npm test`
- [ ] Verify no TypeScript errors in modified files
- [ ] Run template validation: `npx ts-node scripts/validate-templates.ts`

## Deployment
- [ ] Deploy to staging environment
- [ ] Verify `/api/monitor/verify/:runId` endpoint works
- [ ] Test with sample product

## Post-Deployment
- [ ] Monitor logs for validation warnings
- [ ] Check that image hashes are 64 characters in DB
- [ ] Verify no unreplaced template variable warnings
- [ ] Monitor error rates

## Rollback Criteria
Rollback if:
- Error rate increases > 10%
- Image rendering fails
- Monitor shows inconsistent data
