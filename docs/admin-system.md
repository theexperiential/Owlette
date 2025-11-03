# Owlette Admin System Documentation

## Overview

The admin system provides role-based access control for managing users and agent installer versions. This guide covers setup, configuration, and usage.

**Last Updated**: 2025-11-02
**Version**: 2.0.0

---

## Table of Contents

1. [Features](#features)
2. [Architecture](#architecture)
3. [Firebase Setup](#firebase-setup)
4. [Initial Admin User Setup](#initial-admin-user-setup)
5. [Using the Admin Panel](#using-the-admin-panel)
6. [Security Model](#security-model)
7. [Troubleshooting](#troubleshooting)

---

## Features

### User Management
- View all registered users
- Promote users to admin role
- Demote admins to regular user role
- View user statistics (total users, admins, regular users)
- Real-time updates when users register or roles change

### Installer Version Management
- Upload new agent installer versions
- Set any version as "latest" for public download
- Delete old versions
- View version history with metadata
- Track file sizes, release dates, and release notes
- Download any version directly
- Real-time updates when new versions are uploaded

### Public Download
- Download button in dashboard header for all users
- Always points to latest version
- Shows version number on hover
- Direct download from Firebase Storage CDN

---

## Architecture

### Components

```
web/
├── app/admin/                     # Admin pages
│   ├── layout.tsx                 # Admin layout with navigation
│   ├── users/page.tsx             # User management page
│   └── installers/page.tsx        # Installer versions page
├── components/
│   ├── RequireAdmin.tsx           # Admin route protection
│   ├── DownloadButton.tsx         # Public download button
│   └── admin/
│       └── UploadInstallerDialog.tsx  # Upload installer UI
├── hooks/
│   ├── useUserManagement.ts       # User CRUD operations
│   ├── useInstallerManagement.ts  # Installer CRUD operations
│   └── useInstallerVersion.ts     # Public version fetching
├── lib/
│   └── storageUtils.ts            # Firebase Storage utilities
└── contexts/
    └── AuthContext.tsx            # Enhanced with role support
```

### Data Flow

```
User Login → Firestore (fetch role) → AuthContext (isAdmin)
                                            ↓
                              Admin Panel (if isAdmin = true)
                                            ↓
                              Upload Installer → Firebase Storage
                                            ↓
                              Create Metadata → Firestore
                                            ↓
                              Public Download Button (real-time update)
```

---

## Firebase Setup

**IMPORTANT**: Complete Firestore and Storage security rules are maintained in the repository root:
- `/firestore.rules` - Complete Firestore security rules
- `/storage.rules` - Complete Storage security rules

For detailed setup instructions, see **[firebase-setup.md](firebase-setup.md)**.

### Quick Deploy (Recommended)

Deploy rules using Firebase CLI:

```bash
# From repository root
firebase deploy --only firestore:rules,storage:rules
```

### Manual Deploy

1. **Firestore**: Firebase Console → Firestore Database → Rules → Copy `/firestore.rules` → Publish
2. **Storage**: Firebase Console → Storage → Rules → Copy `/storage.rules` → Publish

---

### Firestore Data Structure (Admin System)

The system creates the following collections:

```
firestore/
├── users/{userId}
│   ├── email: string
│   ├── role: "user" | "admin"
│   ├── sites: string[]
│   ├── createdAt: Timestamp
│   └── displayName?: string
│
├── installer_metadata/
│   ├── latest                        # Current latest version
│   │   ├── version: "2.0.0"
│   │   ├── download_url: string
│   │   ├── file_size: number
│   │   ├── release_date: Timestamp
│   │   ├── checksum_sha256: string
│   │   ├── release_notes?: string
│   │   └── uploaded_by: string
│   │
│   └── data/versions/{version}       # All versions
│       ├── version: "2.0.0"
│       ├── download_url: string
│       ├── file_size: number
│       ├── release_date: Timestamp
│       ├── checksum_sha256: string
│       ├── release_notes?: string
│       └── uploaded_by: string
│
└── sites/, config/, deployments/     # Existing collections
```

---

## Initial Admin User Setup

**IMPORTANT**: You must manually create the first admin user in Firestore Console.

### Step 1: Register a User Account

1. Open your web app (dev.owlette.app or owlette.app)
2. Click "Register" and create an account
3. Complete the registration process
4. Log in with your new account
5. Note your user ID (check browser console or AuthContext)

### Step 2: Promote User to Admin

1. Go to Firebase Console → Your Project
2. Navigate to Firestore Database → Data tab
3. Find the `users` collection
4. Locate your user document (by email or UID)
5. Click on the document
6. Find the `role` field
7. Change value from `"user"` to `"admin"`
8. Save changes

### Step 3: Verify Admin Access

1. Refresh your web app (hard refresh: Ctrl+Shift+R)
2. Log out and log back in
3. Click on your profile menu in the top-right
4. You should now see "Admin Panel" option
5. Click it to access admin features

**Alternatively**, if the user document doesn't exist:

1. In Firestore Console, navigate to `users` collection
2. Click "Add Document"
3. Document ID: `<your-user-uid>`
4. Add fields:
   - `email` (string): your-email@example.com
   - `role` (string): admin
   - `sites` (array): []
   - `createdAt` (timestamp): (current date/time)
5. Save document

---

## Using the Admin Panel

### Accessing the Admin Panel

**As an admin user**:
1. Log in to the web dashboard
2. Click your profile menu (top-right corner)
3. Click "Admin Panel"
4. You'll be redirected to `/admin/installers`

**Direct URLs**:
- Installer Versions: `/admin/installers`
- User Management: `/admin/users`

---

### Managing Users

**Location**: Admin Panel → User Management

#### View All Users
- See list of all registered users
- View email, role, sites count, join date
- See total counts (Total Users, Admins, Regular Users)

#### Promote User to Admin
1. Find the user in the table
2. Click "Promote to Admin" button
3. Confirm the action
4. User immediately gains admin privileges

#### Demote Admin to User
1. Find the admin user in the table
2. Click "Demote to User" button
3. Confirm the action
4. User loses admin privileges immediately

**Restrictions**:
- Cannot demote yourself (prevents lockout)
- Changes apply immediately
- User must log out and back in to see role change

---

### Managing Installer Versions

**Location**: Admin Panel → Installer Versions

#### Upload New Version

1. Click "Upload New Version" button
2. Upload installer file:
   - Drag & drop .exe file
   - Or click "Choose File" to browse
   - Only .exe files accepted
3. Enter version number (format: X.Y.Z, e.g., 2.1.0)
4. Add release notes (optional)
5. Check "Set as latest version" (recommended)
6. Click "Upload Installer"
7. Watch progress bar
8. Version appears in table immediately

**Version Requirements**:
- Must be .exe file
- Version format: `X.Y.Z` (e.g., 2.0.0, 2.1.5)
- File size: No limit (but large files take longer)
- Filename: Will be renamed to `Owlette-Installer-v{version}.exe`

#### Set Version as Latest

1. Find the version in the table
2. Click "Set as Latest" button
3. Confirm the action
4. Download button updates immediately for all users

**Use Case**: Rollback to a previous stable version if latest has issues.

#### Delete Version

1. Find the version in the table
2. Click the trash icon
3. Confirm deletion
4. Version is removed from storage and Firestore

**Restrictions**:
- Cannot delete the current "latest" version
- Set a different version as latest first, then delete

#### Download Any Version

- Click the download icon next to any version
- Direct download from Firebase Storage
- Useful for testing older versions

---

### Public Download Button

**Location**: Dashboard header (all users)

**For Regular Users**:
1. Log in to the dashboard
2. Look for download icon in top-right (before profile menu)
3. Hover to see version: "Download Owlette v2.0.0"
4. Click to download latest installer
5. Opens in new tab

**Auto-Updates**:
- Download button automatically updates when admins upload new versions
- No page refresh needed (real-time)
- Always points to latest version

---

## Security Model

### Role-Based Access Control (RBAC)

**Two Roles**:
1. **user** (default)
   - Access to dashboard
   - View own sites and machines
   - Download latest installer
   - No admin panel access

2. **admin**
   - All user permissions
   - Access to admin panel
   - Manage user roles
   - Upload/delete installer versions
   - Set version as latest

### Authentication Flow

```
User Login → Firebase Auth
     ↓
Fetch user document from Firestore
     ↓
Extract role field
     ↓
Set in AuthContext (isAdmin boolean)
     ↓
UI conditionally shows admin features
```

### Route Protection

**Middleware Level** (server-side):
- `/admin/*` routes require authentication
- Non-logged-in users redirected to login

**Component Level** (client-side):
- `RequireAdmin` component checks `isAdmin`
- Non-admin users redirected to dashboard with error

**Firestore Level**:
- Security rules verify admin role for writes
- Prevents bypassing client-side checks

**Storage Level**:
- Security rules verify admin role for uploads/deletes
- Public read for downloads

---

## Troubleshooting

### "Access Denied" Error

**Symptoms**: Admin user sees "You do not have permission to access this page"

**Causes**:
1. Role not set in Firestore
2. User needs to log out and back in
3. Security rules not published

**Solutions**:
1. Check Firestore → users/{uid} → role field
2. Ensure value is exactly `"admin"` (lowercase, no spaces)
3. Log out and log back in
4. Hard refresh (Ctrl+Shift+R)
5. Verify security rules are published

---

### "Admin Panel" Link Not Showing

**Symptoms**: Profile menu doesn't show admin panel link

**Causes**:
1. Role not set correctly
2. AuthContext not refreshed
3. Browser cache issue

**Solutions**:
1. Check Firestore role field
2. Log out and log back in
3. Clear browser cache
4. Check browser console for errors

---

### Upload Fails

**Symptoms**: Installer upload fails or shows error

**Causes**:
1. Storage security rules not configured
2. Not logged in as admin
3. File too large
4. Network issue

**Solutions**:
1. Verify Storage rules allow admin writes
2. Check role in Firestore
3. Try smaller file or better internet
4. Check browser console for error details
5. Verify Firebase Storage quota not exceeded

---

### Download Button Not Showing

**Symptoms**: Download button missing from dashboard

**Causes**:
1. No installer versions uploaded yet
2. Firestore security rules blocking read
3. Component error

**Solutions**:
1. Upload at least one installer version
2. Verify Firestore rules allow public read for `installer_metadata`
3. Check browser console for errors
4. Verify `NEXT_PUBLIC_FIREBASE_*` env vars are set

---

### Version Not Updating

**Symptoms**: Download button shows old version after upload

**Causes**:
1. "Set as latest" not checked during upload
2. Firestore listener not active
3. Browser cache issue

**Solutions**:
1. Manually set version as latest in admin panel
2. Refresh page
3. Check browser console for Firestore errors
4. Verify real-time listeners are working

---

## Best Practices

### User Management
- Limit number of admin users (principle of least privilege)
- Regularly audit admin users
- Document who has admin access and why
- Use dedicated admin accounts (not shared)

### Installer Management
- Always add release notes for versions
- Test installers before setting as latest
- Keep at least 2-3 versions for rollback
- Use semantic versioning (major.minor.patch)
- Delete very old versions to save storage costs

### Security
- Never commit Firebase credentials
- Rotate admin users periodically
- Monitor Firestore usage for unusual activity
- Enable Firebase App Check for additional security
- Review security rules after any changes

---

## Environment-Specific Setup

### Development (dev.owlette.app)

**Firebase Project**: `owlette-dev-xxxxx`

1. Set up security rules in dev project
2. Create admin user in dev Firestore
3. Upload test installer versions
4. Test all admin features

### Production (owlette.app)

**Firebase Project**: `owlette-prod-xxxxx`

1. Set up security rules in prod project
2. Create admin user in prod Firestore
3. Upload production installer versions
4. Verify download button works for public users
5. Monitor usage and errors

---

## Support

### Common Issues
- See [Troubleshooting](#troubleshooting) section above

### Reporting Bugs
- Check browser console for error messages
- Check Firestore and Storage rules
- Verify environment variables
- Create issue on GitHub with details

---

**End of Documentation**
