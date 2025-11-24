# AI Agent Rules - MUST READ BEFORE STARTING

## 🔴 MANDATORY FIRST STEPS (Before ANY Code Changes)

### For Deployment/Configuration Issues:
1. **ALWAYS search relevant documentation FIRST**:
   - Error message → Search official docs
   - Platform issues → Check platform's latest guides
   - Integration problems → Review both platforms' docs
   
2. **Check these sources in order**:
   - Official documentation (current year)
   - GitHub issues with the EXACT error
   - Platform-specific deployment guides
   - Recent changelog/breaking changes

3. **Document findings BEFORE proposing solutions**:
   - What does the documentation say?
   - Are there known issues?
   - What's the recommended approach?

### For Feature Development:
1. **Review existing code patterns** in the codebase
2. **Check the project's spec files** in `/spec`
3. **Understand the architecture** before adding code

## 🚫 NEVER DO THIS:
- Jump straight into "fixing" without research
- Edit configuration files without understanding precedence
- Make assumptions about deployment platforms
- Try multiple solutions without understanding root cause
- Delete files without confirming their purpose

## ✅ ALWAYS DO THIS:
1. **When user reports an error:**
   - Search for the EXACT error message
   - Check if it's a known issue
   - Review official troubleshooting guides
   - THEN propose solutions

2. **When deployment fails:**
   - Understand the deployment platform first
   - Check configuration file hierarchy
   - Review platform-specific requirements
   - Verify environment variables needed

3. **Before changing configuration:**
   - Document which file takes precedence
   - Understand the deployment pipeline
   - Check for cascading effects

## 📋 Pre-Change Checklist:
- [ ] Have I searched the official documentation?
- [ ] Do I understand the platform/tool being used?
- [ ] Have I checked for recent similar issues?
- [ ] Do I know which config file takes precedence?
- [ ] Have I explained my research to the user?
- [ ] Is my solution based on documentation, not assumptions?

## 🎯 Problem-Solving Order:
1. **Research** (documentation, known issues)
2. **Understand** (root cause, not symptoms)
3. **Plan** (based on official guidance)
4. **Implement** (with confidence)
5. **Verify** (check it actually worked)

## 💡 Key Reminders:
- **Railway**: Uses railway.json > railway.toml > nixpacks.toml
- **Prisma**: Needs binary engines for serverless/containers
- **Docker**: Not used by Railway, Vercel, or most modern platforms
- **Environment Variables**: Often the missing piece

## User Should Never Have To Say:
- "Check the docs first"
- "Why didn't you research this?"
- "We're going in circles"
- "This seems like a basic issue"

## If User Mentions These Platforms:
- **Railway**: Check railway.app/docs first
- **Vercel**: Check vercel.com/docs first  
- **Prisma**: Check prisma.io/docs first
- **Shopify**: Check shopify.dev first
- **Any error**: Search the EXACT error message first

---

**REMEMBER**: You're not being helpful by guessing. You're being helpful by researching, understanding, and then solving based on documented best practices.
