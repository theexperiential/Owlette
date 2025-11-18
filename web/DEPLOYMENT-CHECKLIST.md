# Railway Deployment Checklist - Owlette Web Dashboard

Use this checklist to deploy the Owlette web dashboard to Railway. Check off each item as you complete it.

**Quick Links:**
- Detailed Guide: [docs/railway-deployment.md](../docs/railway-deployment.md)
- Railway Dashboard: https://railway.app/dashboard
- Firebase Console: https://console.firebase.google.com

---

## Phase 1: Pre-Deployment Verification

### Local Build Test
- [ ] Navigate to web directory: `cd web`
- [ ] Install dependencies: `npm install`
- [ ] Run production build: `npm run build`
- [ ] Verify build succeeds with no errors
- [ ] Test production server locally: `npm start`
- [ ] Open http://localhost:3000 and verify it loads

**If build fails:** Fix TypeScript errors before proceeding

---

## Phase 2: Gather Firebase Configuration

### Firebase Console Access
- [ ] Log into [Firebase Console](https://console.firebase.google.com)
- [ ] Select your Owlette project
- [ ] Click Settings (⚙️) → Project Settings
- [ ] Scroll to "Your apps" section
- [ ] Select your web app (or create one if none exists)

### Copy Environment Variables
Copy these 6 values from Firebase SDK config snippet:

- [ ] `NEXT_PUBLIC_FIREBASE_API_KEY` = `_____________________`
- [ ] `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` = `_____________________`
- [ ] `NEXT_PUBLIC_FIREBASE_PROJECT_ID` = `_____________________`
- [ ] `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` = `_____________________`
- [ ] `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` = `_____________________`
- [ ] `NEXT_PUBLIC_FIREBASE_APP_ID` = `_____________________`

**Tip:** Keep this information in a secure note for the next steps

---

## Phase 3: Railway Project Setup

### Create Railway Account
- [ ] Go to https://railway.app
- [ ] Sign up with GitHub (recommended)
- [ ] Verify your email address
- [ ] Complete Railway onboarding

### Create New Project
- [ ] Click "New Project" in Railway dashboard
- [ ] Select "Deploy from GitHub repo"
- [ ] Authorize Railway to access your GitHub
- [ ] Search for and select the `Owlette` repository
- [ ] Railway creates a new service automatically

### Configure Service Settings
- [ ] Click on the service card
- [ ] Go to "Settings" tab
- [ ] **Service Name:** Change to `owlette-web-dashboard`
- [ ] **Root Directory:** Set to `web` (important for monorepo!)
- [ ] **Source Branch:** Select `main` (or your production branch)
- [ ] **Auto-deploy:** Enable "Deploy on push" ✓
- [ ] Click "Save" if required

---

## Phase 4: Configure Environment Variables

### Add Required Variables to Railway
- [ ] In your service, click "Variables" tab
- [ ] Click "Raw Editor" or "Bulk Import"
- [ ] Copy and paste these variables (fill in your actual values):

  **Firebase Client-Side (6 variables):**
  ```env
  NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key_here
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
  NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
  NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
  ```

  **Firebase Server-Side Admin SDK (3 variables):**
  ```env
  FIREBASE_PROJECT_ID=your-project-id
  FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
  FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYourPrivateKeyHere\n-----END PRIVATE KEY-----"
  ```

  > Note: Get Admin SDK credentials from Firebase Console → Project Settings → Service Accounts → Generate new private key

  **Session Secret (1 variable - REQUIRED):**
  ```env
  SESSION_SECRET=<generate with: openssl rand -base64 32>
  ```

  > **IMPORTANT:** Generate a NEW secret for production (different from development!)

  **Upstash Redis (2 variables - REQUIRED for rate limiting):**
  ```env
  UPSTASH_REDIS_REST_URL=https://your-instance.upstash.io
  UPSTASH_REDIS_REST_TOKEN=your-token-here
  ```

  > Note: Create free account at https://upstash.com and create Redis database

  **Resend Email (4 variables - OPTIONAL):**
  ```env
  RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxx
  RESEND_FROM_EMAIL=notifications@yourdomain.com
  ADMIN_EMAIL_PROD=admin@example.com
  SEND_WELCOME_EMAIL=false
  ```

  > Note: Only needed if you want email notifications

### Verify Configuration
- [ ] Click "Show All" to view all variables
- [ ] Confirm all **9 REQUIRED** variables are present (6 Firebase client + 3 Firebase server)
- [ ] Confirm `SESSION_SECRET` is set (new requirement)
- [ ] Confirm Upstash Redis variables are set (new requirement)
- [ ] Confirm `NODE_ENV=production` exists (auto-set by railway.toml)

**Important:**
- Do NOT include quotes around values (except `FIREBASE_PRIVATE_KEY`)
- Use a **different** `SESSION_SECRET` for production vs development
- Rate limiting will be disabled without Upstash Redis (app works but vulnerable to brute force)

---

## Phase 5: First Deployment

### Trigger Deployment
- [ ] Railway should auto-deploy after variables are set
- [ ] If not, click "Deployments" tab
- [ ] Click "Deploy" button
- [ ] Select branch to deploy

### Monitor Build Process
- [ ] Click on the in-progress deployment
- [ ] Watch build logs in real-time
- [ ] Wait for these milestones:
  - [ ] ✓ Dependencies installed (`npm install`)
  - [ ] ✓ Application built (`npm run build`)
  - [ ] ✓ Server started (`npm start`)
  - [ ] ✓ Service deployed successfully

**Expected time:** 2-5 minutes

### Handle Build Errors (if any)
If deployment fails:
- [ ] Read error message in build logs (scroll to bottom)
- [ ] Common issues:
  - Missing environment variables → Verify all 6 are set
  - TypeScript errors → Run `npm run build` locally and fix
  - Dependency errors → Check `package-lock.json` is committed
- [ ] Fix errors and redeploy

---

## Phase 6: Verify Deployment

### Get Deployment URL
- [ ] Go to "Settings" tab
- [ ] Find "Domains" section
- [ ] Copy the Railway-provided URL (e.g., `owlette-web-dashboard-production.up.railway.app`)

### Test Deployed Application
- [ ] Open deployment URL in browser
- [ ] Verify login page loads
- [ ] Check browser console (F12) for errors
- [ ] Verify no "Missing environment variable" errors

**If you see errors:** Review the troubleshooting section in [docs/railway-deployment.md](../docs/railway-deployment.md)

---

## Phase 7: Configure Firebase for Production

### Add Railway Domain to Firebase
- [ ] Go to [Firebase Console](https://console.firebase.google.com)
- [ ] Select your Owlette project
- [ ] Navigate to **Authentication** → **Settings** → **Authorized Domains**
- [ ] Click "Add domain"
- [ ] Paste your Railway domain (without `https://`)
- [ ] Click "Add"

**Example:** `owlette-web-dashboard-production.up.railway.app`

**Critical:** Authentication will NOT work without this step!

---

## Phase 8: Test Authentication & Features

### Test User Registration
- [ ] Go to your deployment URL
- [ ] Click "Register" or "Sign Up"
- [ ] Create a test account with email/password
- [ ] Verify registration succeeds
- [ ] Verify you're redirected to dashboard

### Test User Login
- [ ] Log out if logged in
- [ ] Go to login page
- [ ] Enter test account credentials
- [ ] Verify login succeeds
- [ ] Verify redirect to dashboard

### Test Dashboard Features
- [ ] Verify dashboard loads without errors
- [ ] Check if machines are listed (if any configured)
- [ ] Test navigation to "Deployments" page
- [ ] Test navigation to "Projects" page
- [ ] Verify real-time updates work (if agents connected)

**If issues occur:** Check browser console and Railway logs

---

## Phase 9: Custom Domain (Optional)

### Configure Custom Domain in Railway
- [ ] Go to service "Settings" → "Networking"
- [ ] Click "Add Custom Domain"
- [ ] Enter your domain (e.g., `owlette.yourdomain.com`)
- [ ] Railway provides DNS configuration instructions

### Update DNS Records
- [ ] Log into your domain registrar (GoDaddy, Namecheap, etc.)
- [ ] Add CNAME or A record as instructed by Railway:
  - **CNAME:** `owlette` → `your-service.up.railway.app`
  - **OR A Record:** `owlette` → `[IP from Railway]`
- [ ] Save DNS changes
- [ ] Wait 5-60 minutes for DNS propagation

### Verify SSL Certificate
- [ ] Railway auto-provisions SSL certificate
- [ ] Wait 5-10 minutes after DNS propagation
- [ ] Visit `https://owlette.yourdomain.com`
- [ ] Verify SSL padlock shows in browser
- [ ] Verify no certificate warnings

### Update Firebase Authorized Domains
- [ ] Go to Firebase Console → Authentication → Settings
- [ ] Add your custom domain to Authorized Domains
- [ ] Test authentication on custom domain

---

## Phase 10: Post-Deployment Configuration

### Set Up Monitoring & Notifications
- [ ] In Railway, go to "Settings" → "Notifications"
- [ ] Enable deployment success/failure notifications
- [ ] Enable service crash notifications
- [ ] Choose notification method (Email, Discord, Slack)

### Review Metrics
- [ ] Go to "Metrics" tab in Railway
- [ ] Review CPU usage
- [ ] Review memory usage
- [ ] Review network traffic

### Configure Auto-Scaling (Pro Plan)
If you have Railway Pro:
- [ ] Go to "Settings" → "Auto-scaling"
- [ ] Configure resource limits
- [ ] Set up horizontal scaling rules

---

## Phase 11: Continuous Deployment Setup

### Verify Git Integration
- [ ] Make a small change in `web/` directory (e.g., update a comment)
- [ ] Commit change: `git commit -am "Test Railway auto-deploy"`
- [ ] Push to main: `git push origin main`
- [ ] Go to Railway "Deployments" tab
- [ ] Verify new deployment triggered automatically
- [ ] Verify deployment succeeds

### Set Up Branch Deployments (Optional)
For preview deployments:
- [ ] Create a staging branch: `git checkout -b staging`
- [ ] In Railway, create new service
- [ ] Link to same repo but `staging` branch
- [ ] Configure separate environment variables (test Firebase project)
- [ ] Use staging deployment for testing before production

---

## Phase 12: Security & Optimization

### Security Review
- [ ] Verify Firebase security rules are configured
- [ ] Verify Firestore rules restrict access by user/site
- [ ] Review Firebase API key restrictions in Google Cloud Console
- [ ] Enable Firebase App Check (optional but recommended)
- [ ] Review Next.js security headers in `next.config.ts`

### Performance Optimization
- [ ] Check bundle size: `.next/static` folder size
- [ ] Enable Next.js Image Optimization (already configured)
- [ ] Configure CDN for static assets (optional: Cloudflare)
- [ ] Review Firestore query performance
- [ ] Add Firestore indexes as needed

---

## Phase 13: Documentation & Handoff

### Update Project Documentation
- [ ] Update `README.md` with production URL
- [ ] Document environment variables in `.env.example`
- [ ] Update `docs/deployment.md` if process changed
- [ ] Document custom domain configuration (if used)

### Team Handoff (if applicable)
- [ ] Share Railway account access with team
- [ ] Share Firebase Console access
- [ ] Document rollback procedure
- [ ] Document how to view logs and metrics
- [ ] Share emergency contact procedures

---

## Troubleshooting

### Deployment Failed
**Issue:** Build fails or service crashes
- [ ] Check Railway build logs: Deployments → [Latest] → View Logs
- [ ] Look for error messages (scroll to bottom)
- [ ] Verify all environment variables are set
- [ ] Run `npm run build` locally to reproduce
- [ ] Check TypeScript errors: `npx tsc --noEmit`

### Authentication Not Working
**Issue:** Users can't log in or see "unauthorized-domain" error
- [ ] Verify Railway domain is in Firebase Authorized Domains
- [ ] Clear browser cache and cookies
- [ ] Check browser console for Firebase errors
- [ ] Verify Firebase config variables are correct in Railway

### Environment Variables Not Updating
**Issue:** Changed variables but app still uses old values
- [ ] Update variables in Railway dashboard
- [ ] Manually trigger redeploy (variables only update on new deployment)
- [ ] Go to Deployments → Deploy button
- [ ] Wait for deployment to complete

### Service Unavailable (502 Error)
**Issue:** Deployment succeeds but site shows 502 error
- [ ] Check runtime logs: Deployments → [Latest] → View Logs
- [ ] Look for crash messages or startup errors
- [ ] Verify `npm start` works locally
- [ ] Check if service is restarting repeatedly
- [ ] Verify `PORT` environment variable not conflicting

---

## Rollback Procedure

If deployment causes critical issues:

### Quick Rollback
- [ ] Go to Railway "Deployments" tab
- [ ] Find last working deployment
- [ ] Click "⋮" menu → "Redeploy"
- [ ] Railway restores previous version
- [ ] Monitor logs to ensure rollback succeeded

### Git-Based Rollback
- [ ] Identify last working commit: `git log`
- [ ] Revert to that commit: `git revert HEAD` (or use commit hash)
- [ ] Push revert: `git push origin main`
- [ ] Railway auto-deploys reverted version

---

## Success Checklist

Deployment is complete when:

- [x] Build succeeds without errors
- [x] Deployment URL is accessible
- [x] Login page loads correctly
- [x] User registration works
- [x] User login works
- [x] Dashboard loads and shows data
- [x] Real-time updates work (if agents connected)
- [x] No console errors in browser
- [x] Firebase authentication works
- [x] Custom domain configured (if applicable)
- [x] SSL certificate active (HTTPS)
- [x] Auto-deployment on git push works
- [x] Monitoring and notifications configured

**Congratulations! Your Owlette web dashboard is deployed to Railway! 🎉**

---

## Next Steps After Deployment

1. **Deploy Windows Agents**: Follow [docs/deployment.md](../docs/deployment.md) to install agents on target machines
2. **Configure Sites**: Create sites in the web dashboard
3. **Add Machines**: Register machines to sites
4. **Monitor Status**: Watch machine status and metrics in real-time
5. **Deploy Software**: Use the deployment feature to install software remotely

---

**For detailed explanations and troubleshooting, see:**
- [Railway Deployment Guide](../docs/railway-deployment.md) - Complete documentation
- [Firebase Setup Guide](../docs/firebase-setup.md) - Firebase configuration
- [Web README](README.md) - Local development guide

**Support:**
- Railway Docs: https://docs.railway.app
- Firebase Docs: https://firebase.google.com/docs
- Railway Discord: https://discord.gg/railway

---

**Last Updated:** 2025-11-02
**Tested With:** Railway v2 (Nixpacks), Next.js 16.0.1
