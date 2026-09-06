/**
 * `sitePolicy.server.ts` — the single site-authorization decision core.
 *
 * Owlette gated site-scoped routes through two independently written paths
 * (`authorizedSiteHandler` and `_shared`'s `require*AuthAndScope` family) plus
 * two more partial derivations (`hoot-utils`' `verifyUserSiteAccess`, and
 * `assertUserHasSiteAccess` itself). They agreed on the happy path and drifted
 * everywhere else. This module owns the DECISION; callers own the RESPONSE.
 *
 * That split is deliberate and load-bearing. This file answers "what is true
 * about this principal and this site" and nothing else — it never builds a
 * NextResponse, never picks a status code, and never decides whether a
 * capability is required. Wave 1 Task 1.2 moves both wrappers onto it while
 * PRESERVING their divergent response mappings; Task 1.3 then unifies those
 * mappings in one place. Keeping the two steps separate is what lets the
 * characterization matrix in `__tests__/lib/authorizationParity.test.ts` stay
 * green across the extraction and go red, deliberately, at the unification.
 *
 * Read cost: one `getAll([sites/{siteId}, users/{uid}])` round trip. The path
 * it replaces read the site once and `users/{uid}` TWICE — once in
 * `assertUserHasSiteAccess` and again in `loadUserActor`.
 *
 * MEMBERSHIP SEAM: `deriveMembership()` below is the one place that knows
 * membership is stored as `sites/{siteId}.owner` + `users/{uid}.sites[]`.
 * Wave 4 swaps it for `sites/{siteId}/members/{uid}`. Nothing else in the
 * codebase should read those two fields to make an access decision.
 */

import type { NextRequest } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin';
import type { Role } from '@/lib/capabilities';

/** Per-site standing, derived today, stored from Wave 4 on. */
export type MembershipRole = 'owner' | 'member' | null;

/** Why a principal was refused. Callers map these to status codes. */
export type SiteAccessDenial = 'site_not_found' | 'user_inactive' | 'no_access';

/**
 * Everything both wrappers need, from one round trip. `siteData` is returned
 * so callers that need the site document (the SITE_DELETE ownership
 * short-circuit reads `owner`) do not read it a second time.
 */
export interface SiteAccessFacts {
  siteId: string;
  siteExists: boolean;
  siteData: Record<string, unknown> | null;
  /** Global role, normalised. Any unrecognised value reads as 'member'. */
  globalRole: Role;
  /** Per-site standing. `null` when the principal is neither owner nor assigned. */
  membershipRole: MembershipRole;
  /** `users/{uid}.sites[]`, filtered to strings. Needed to build a UserActor. */
  sites: string[];
  /** Millisecond timestamp when the user was soft-deleted, else null. */
  deletedAt: number | null;
  userExists: boolean;
}

export type SiteAccessOutcome =
  | { ok: true; facts: SiteAccessFacts }
  | { ok: false; reason: SiteAccessDenial; facts: SiteAccessFacts };

/** An agent ID token's claims, validated against the route it is calling. */
export interface AgentPrincipal {
  kind: 'agent';
  userId: string;
  siteId: string;
  machineId: string;
}

function normaliseRole(raw: unknown): Role {
  return raw === 'superadmin' || raw === 'admin' ? raw : 'member';
}

function toStringArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string') : [];
}

/**
 * THE MEMBERSHIP SEAM. Today per-site standing is implied by two legacy
 * fields; from Wave 4 it is a document. Superadmin is deliberately NOT folded
 * in here — it is a global override resolved by the caller, not a per-site
 * role, and conflating them is what made global `admin` leak across sites.
 */
function deriveMembership(
  userId: string,
  siteId: string,
  siteData: Record<string, unknown> | null,
  sites: string[],
): MembershipRole {
  if (siteData?.owner === userId) return 'owner';
  if (sites.includes(siteId)) return 'member';
  return null;
}

/**
 * Resolve a user principal against a site in ONE batched read.
 *
 * Decision order is load-bearing and matches the behaviour pinned by the
 * parity matrix: a missing SITE outranks an inactive user, which outranks the
 * access check. Reordering these changes observable status codes.
 *
 * Superadmin short-circuits the membership check — it does not consult
 * `membershipRole` at all — so that when Wave 4 moves membership into a
 * subcollection, a superadmin request costs no extra read.
 */
export async function resolveSiteAccess(
  userId: string,
  siteId: string,
  /**
   * Firestore handle. Defaults to `getAdminDb()`; callers that already hold one
   * pass it so they neither reopen it nor lose the ability to inject a fake.
   * `hoot-utils`' `verifyUserSiteAccess` takes a `db` in its public signature
   * and its tests inject one, so this parameter is what lets that function be
   * re-implemented over this core without changing its contract.
   */
  db: FirebaseFirestore.Firestore = getAdminDb(),
): Promise<SiteAccessOutcome> {
  const [siteDoc, userDoc] = await db.getAll(
    db.collection('sites').doc(siteId),
    db.collection('users').doc(userId),
  );

  const siteExists = Boolean(siteDoc?.exists);
  const siteData = (siteExists ? (siteDoc.data() as Record<string, unknown>) ?? null : null);
  const userData = userDoc?.exists ? (userDoc.data() as Record<string, unknown>) ?? null : null;

  const globalRole = normaliseRole(userData?.role);
  const sites = toStringArray(userData?.sites);
  const deletedAt = typeof userData?.deletedAt === 'number' ? userData.deletedAt : null;
  const membershipRole = deriveMembership(userId, siteId, siteData, sites);

  const facts: SiteAccessFacts = {
    siteId,
    siteExists,
    siteData,
    globalRole,
    membershipRole,
    sites,
    deletedAt,
    userExists: Boolean(userData),
  };

  if (!siteExists) return { ok: false, reason: 'site_not_found', facts };
  if (!userData || deletedAt !== null) return { ok: false, reason: 'user_inactive', facts };
  if (globalRole === 'superadmin') return { ok: true, facts };
  if (membershipRole !== null) return { ok: true, facts };

  return { ok: false, reason: 'no_access', facts };
}

/**
 * Resolve an AGENT principal from its ID token claims alone.
 *
 * Agents have no `users/{uid}` document, so running them through
 * `resolveSiteAccess` would deny every agent screenshot and command call. The
 * token's `site_id` / `machine_id` claims ARE the authorization: an agent may
 * only ever act on the machine it was issued for.
 *
 * Returns `null` when the request is not an agent ID token, so callers fall
 * through to normal user resolution. API keys (`owk_` prefix) are excluded up
 * front — they are user credentials and must take the user path.
 */
export async function resolveAgentPrincipal(
  req: NextRequest,
  siteId: string,
  machineId: string,
): Promise<{ matched: true; principal: AgentPrincipal } | { matched: 'mismatch' } | null> {
  const authHeader = req.headers.get('authorization') || '';
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!bearer || bearer[1].startsWith('owk_')) return null;

  try {
    const decoded = await getAdminAuth().verifyIdToken(bearer[1]);
    if (decoded.role !== 'agent') return null;
    if (decoded.site_id !== siteId || decoded.machine_id !== machineId) {
      return { matched: 'mismatch' };
    }
    return {
      matched: true,
      principal: {
        kind: 'agent',
        userId: decoded.uid,
        siteId,
        machineId,
      },
    };
  } catch {
    // Not a verifiable agent ID token — the caller falls through to user auth.
    return null;
  }
}
