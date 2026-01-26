# See It - Project Changelog

## [Unreleased]

### Removed
- `ManualSegmentModal.deprecated.jsx` (800 lines - orphaned component)
- `extract-metadata.server.ts` (99 lines - unused service)
- `image-removal.server.ts` (180 lines - unused service)
- `DEBUG_INGEST_URL` blocks from `app.products.jsx` (168 lines)
- `CLEANUP_TODO.md` (obsolete - referenced files already deleted)

### Added
- `app/utils/cors.server.ts` - Consolidated CORS headers utility
- `app/utils/image-download.server.ts` - Consolidated image download utilities
- `app/utils/cron-auth.server.ts` - Consolidated cron authentication
- Placeholder validation warning in `gemini.server.ts`
- Gemini cache logging in `gemini-files.server.ts`
- Settings refresh behavior documentation in `CLAUDE.md`
- Utility Files section in `CLAUDE.md`

### Changed
- Updated 7 files to use consolidated CORS utility
- Updated 4 files to use consolidated image download utility
- Updated 2 cron files to use consolidated auth utility
- Updated `CLAUDE.md` Critical Files table with `gemini-files.server.ts`
