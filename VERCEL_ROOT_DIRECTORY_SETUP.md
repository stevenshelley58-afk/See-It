# Vercel Root Directory Configuration

## Problem
Vercel is looking for `package.json` in the repository root, but the Next.js app is in the `see-it-monitor/` subdirectory.

## Solution: Set Root Directory in Vercel Dashboard

**You must manually set the Root Directory in the Vercel dashboard:**

1. Go to https://vercel.com/dashboard
2. Select the **see-it-monitor** project
3. Click **Settings** (gear icon)
4. Click **General** in the left sidebar
5. Scroll down to **Root Directory**
6. Click **Edit** next to Root Directory
7. Enter: `see-it-monitor`
8. Click **Save**

## Alternative: Use Vercel CLI

If you have the Vercel CLI installed and linked:

```bash
cd see-it-monitor
vercel link
# When prompted, select your project
# This will create a .vercel directory with project settings
```

Then in the Vercel dashboard, the root directory should be automatically detected.

## After Setting Root Directory

Once the Root Directory is set, Vercel will:
- Find the `package.json` in `see-it-monitor/`
- Run `npm install` in that directory
- Run `npm run build` in that directory
- Deploy the Next.js app correctly

## Current Status

- ✅ Code pushed to GitHub
- ✅ Health and resync API endpoints added
- ⚠️ **Root Directory needs to be set in Vercel dashboard**

After setting the Root Directory, trigger a new deployment or push a new commit to test.
