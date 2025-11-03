# Firestore Security Rules Deployment Guide

**Version:** 2.1.0 - OAuth Custom Token Authentication
**Last Updated:** 2025-11-03

## Overview

This document explains how to deploy the updated Firestore security rules that support OAuth custom token authentication for Owlette agents.

## What Changed

### Version 2.1.0 Updates

**New Features:**
- OAuth custom token authentication for agents (eliminates service accounts)
- Strict machine-level isolation (agents can only access their own machine)
- New helper functions: `isAgent()`, `agentCanAccessSite()`, `agentCanAccessMachine()`
- Protected OAuth token collections (`agent_tokens`, `agent_refresh_tokens`)

**Security Improvements:**
- Agents use custom tokens with claims: `{role: 'agent', site_id, machine_id}`
- Machine-scoped permissions (prevents cross-machine access)
- Token collections only accessible via Admin SDK (server-side)

**Backward Compatibility:**
- Old service account authentication still works (via `isServiceAccount()`)
- Gradual migration supported - both methods work simultaneously

---

## Deployment Methods

### Method 1: Firebase Console (Recommended for Testing)

**Step 1: Access Firebase Console**
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project (e.g., `owlette-dev-3838a`)
3. Navigate to **Firestore Database** → **Rules**

**Step 2: Copy Rules**
1. Open `firestore.rules` in your local repository
2. Copy the entire contents
3. Paste into the Firebase Console rules editor

**Step 3: Validate**
- Click **"Validate"** button (top right)
- Fix any syntax errors if shown
- Rules should show green checkmark if valid

**Step 4: Publish**
- Click **"Publish"** button
- Confirm deployment
- Rules are live immediately (takes ~30 seconds to propagate)

**Step 5: Test**
- Try accessing Firestore from web dashboard (should work)
- Try agent operations (should work if authenticated)
- Check Firebase Console → **Rules playground** to test specific scenarios

---

### Method 2: Firebase CLI (Recommended for Production)

**Prerequisites:**
- Firebase CLI installed: `npm install -g firebase-tools`
- Logged in: `firebase login`
- Firebase project initialized in repo

**Step 1: Initialize Firebase (if not done)**
```bash
cd Owlette
firebase init firestore
```

Select:
- Use existing project: `owlette-dev-3838a` (or your project)
- Firestore Rules file: `firestore.rules` (should already exist)
- Firestore Indexes file: `firestore.indexes.json` (optional)

**Step 2: Deploy Rules**
```bash
firebase deploy --only firestore:rules
```

**Expected Output:**
```
=== Deploying to 'owlette-dev-3838a'...

i  deploying firestore
i  firestore: checking firestore.rules for compilation errors...
✔  firestore: rules file firestore.rules compiled successfully
i  firestore: uploading rules firestore.rules...
✔  firestore: released rules firestore.rules to cloud.firestore

✔  Deploy complete!
```

**Step 3: Verify Deployment**
```bash
firebase firestore:rules
```

This shows the currently deployed rules.

---

## Testing the New Rules

### Test 1: Agent Authentication (OAuth Token)

**Expected Behavior:**
- Agent with custom token can read/write only its own machine
- Agent cannot access other machines (even in same site)
- Token must have correct claims: `{role: 'agent', site_id, machine_id}`

**Test via Rules Playground:**
1. Go to Firebase Console → Firestore → Rules → **Playground**
2. Set **Location**: `sites/site_abc/machines/DESKTOP-001`
3. Set **Auth**: Custom Claims
   ```json
   {
     "role": "agent",
     "site_id": "site_abc",
     "machine_id": "DESKTOP-001"
   }
   ```
4. Test **get** operation → Should be **✅ Allowed**
5. Change `machine_id` to `DESKTOP-002` → Should be **❌ Denied**

### Test 2: Service Account (Backward Compatibility)

**Expected Behavior:**
- Old service accounts still work (for gradual migration)
- Service account can access any machine (admin privileges)

**Test via Rules Playground:**
1. Set **Location**: `sites/site_abc/machines/DESKTOP-001`
2. Set **Auth**: Custom Claims
   ```json
   {
     "admin": true
   }
   ```
3. Test **get** and **set** operations → Both should be **✅ Allowed**

### Test 3: Web Dashboard User

**Expected Behavior:**
- Authenticated users can access all sites (current trust model)
- Users can read machine data
- Users can write commands

**Test via Rules Playground:**
1. Set **Location**: `sites/site_abc/machines/DESKTOP-001`
2. Set **Auth**: Authenticated (no custom claims)
3. Test **get** operation → Should be **✅ Allowed**

### Test 4: Token Collection Security

**Expected Behavior:**
- `agent_tokens` and `agent_refresh_tokens` are server-side only
- No client (web or agent) can access these collections

**Test via Rules Playground:**
1. Set **Location**: `agent_tokens/test_code_123`
2. Set **Auth**: Any (authenticated or admin)
3. Test **get** operation → Should be **❌ Denied**

---

## Rollback Plan

If issues arise after deployment, you can quickly rollback:

### Via Firebase Console
1. Go to Firestore → Rules
2. Click **"History"** (clock icon, top right)
3. Find previous version (before 2.1.0)
4. Click **"Restore"**
5. Confirm restoration

### Via Git + Firebase CLI
```bash
# Revert to previous rules version
git checkout HEAD~1 firestore.rules

# Deploy old rules
firebase deploy --only firestore:rules

# Or restore from backup
cp firestore.rules.backup firestore.rules
firebase deploy --only firestore:rules
```

---

## Migration Strategy

### Phase 1: Deploy New Rules (Day 1)
- Deploy rules to development environment first
- Test with both OAuth agents and old service account agents
- Verify no breaking changes

### Phase 2: Test OAuth Agents (Day 1-3)
- Install new agent with OAuth on test machine
- Verify it can authenticate and sync data
- Confirm strict machine isolation works

### Phase 3: Gradual Agent Migration (Week 1-2)
- Keep both auth methods active (backward compatible)
- Migrate agents one-by-one via reinstallation
- Monitor logs for authentication issues

### Phase 4: Deprecate Service Accounts (Week 3+)
- Once all agents migrated, remove `isServiceAccount()` from rules
- Delete service account JSON files
- Update documentation to OAuth-only

---

## Monitoring & Debugging

### Check Rule Enforcement

**Firebase Console → Firestore → Usage:**
- Monitor "Denied Reads" and "Denied Writes"
- Spike in denials = potential rule issue

**Firebase Console → Firestore → Logs:**
- Shows rejected requests with reasons
- Useful for debugging permission errors

### Agent Logs

**Check agent logs for authentication errors:**
```
C:\Owlette\agent\logs\owlette_service.log
```

Look for:
- "Agent not authenticated - no refresh token found"
- "HTTP error 403" or "Permission denied"
- "Token expired" or "Invalid token"

### Web Dashboard Logs

**Check browser console for Firestore errors:**
- Press F12 → Console tab
- Look for: "Missing or insufficient permissions"
- Error shows which document path was denied

---

## Common Issues

### Issue 1: Agent Can't Write to Machine Document

**Symptom:**
- Agent logs show "Permission denied" when writing heartbeat
- Dashboard shows machine as offline

**Cause:**
- Token claims don't match document path
- Token has wrong `site_id` or `machine_id`

**Fix:**
1. Check token claims: `console.log(auth_manager.get_token_info())`
2. Verify `site_id` in token matches Firestore path
3. Verify `machine_id` in token matches hostname
4. Re-authenticate agent if claims are wrong

### Issue 2: Web Dashboard Can't Read Machine Data

**Symptom:**
- Dashboard loads but shows no machines
- Console shows "Permission denied"

**Cause:**
- User not authenticated
- `canAccessSite()` function rejecting user

**Fix:**
1. Verify user is logged in
2. Check `request.auth != null` in rules
3. Temporarily add logging to rules (in test environment)

### Issue 3: Old Agents Stop Working After Rule Update

**Symptom:**
- Agents using service accounts suddenly fail
- Logs show "Permission denied"

**Cause:**
- `isServiceAccount()` removed too early
- Service account token not recognized

**Fix:**
1. Verify `isServiceAccount()` still in rules
2. Check token has `admin: true` claim
3. Rollback rules if needed

---

## Security Best Practices

### ✅ DO

- Deploy rules to dev environment first
- Test thoroughly before production deployment
- Monitor denied requests after deployment
- Keep `isServiceAccount()` for backward compatibility during migration
- Use Firebase CLI for production deployments (version control)
- Backup current rules before deploying

### ❌ DON'T

- Deploy directly to production without testing
- Remove `isServiceAccount()` before all agents migrated
- Allow client-side access to `agent_tokens` or `agent_refresh_tokens`
- Ignore spikes in denied requests
- Skip validation step in Firebase Console

---

## Additional Resources

- [Firebase Security Rules Documentation](https://firebase.google.com/docs/firestore/security/get-started)
- [Firestore Rules Playground](https://firebase.google.com/docs/firestore/security/test-rules-emulator)
- [Firebase CLI Documentation](https://firebase.google.com/docs/cli)
- [Custom Token Authentication](https://firebase.google.com/docs/auth/admin/create-custom-tokens)

---

## Support

**For issues or questions:**
1. Check agent logs: `C:\Owlette\agent\logs\owlette_service.log`
2. Check Firebase Console → Firestore → Logs
3. Test rules in Playground
4. Review this document for common issues
5. Open GitHub issue if problem persists

---

**Document Version:** 1.0
**Compatible with:** Owlette 2.1.0+
**Author:** Claude (Owlette Development Team)
