/**
 * Canonical shared reads that belong to no single route wrapper. Privileged
 * authorization lives in `authorizedSiteHandler` / `authorizedPlatformHandler`.
 */

import { getAdminDb } from '@/lib/firebase-admin';

/**
 * LEGACY read of `users/{uid}.sites[]`. This is NOT the membership seam.
 *
 * Site access resolves from `sites/{siteId}/members/{uid}` through
 * `lib/sitePolicy.server.ts`, and firestore.rules no longer consults this field
 * at all. The previous version of this comment claimed the opposite on both
 * counts, which is exactly the kind of stale rationale that gets acted on.
 *
 * Retained only for the two hoot/chat scoping callers. Nothing new may gate on
 * it, and wave 6.1 strips the field — at which point those callers must already
 * have moved to `resolveSiteAccess` or they will silently scope to nothing.
 *
 * `[]` when the user has no `sites` field or no doc at all.
 */
export async function getUserSiteIds(userId: string): Promise<string[]> {
  const db = getAdminDb();
  const userDoc = await db.collection('users').doc(userId).get();
  if (!userDoc.exists) return [];
  const data = userDoc.data();
  const sites = data?.sites;
  return Array.isArray(sites) ? sites.filter((s): s is string => typeof s === 'string') : [];
}
