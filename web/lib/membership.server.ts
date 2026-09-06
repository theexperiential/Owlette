/**
 * `membership.server.ts` — THE single writer for site membership.
 *
 * Wave 2 of `dev/active/per-site-roles`. Membership is currently implied by two
 * legacy fields — `sites/{siteId}.owner` and `users/{uid}.sites[]` — written from
 * eleven different places, each with its own guards, ordering and atomicity. This
 * module is the one place allowed to change membership from here on; the other
 * writers move onto it wave by wave until only migrations and test seeds remain.
 *
 * DUAL-WRITE. Every mutation writes BOTH the new `sites/{siteId}/members/{uid}`
 * document and the legacy pair, in ONE batch or transaction. The new document is
 * authoritative from Wave 5; until then it is a shadow, and any write that lands
 * in one shape but not the other is the exact divergence this wave exists to end.
 * `createSite` already proves the pattern works (it dual-writes owner + sites[] in
 * a single batch, which is why that particular divergence has never been seen).
 *
 * THREE INVARIANTS, each of which was a live escalation path before this module:
 *
 *   1. `addMember` uses `create()`, NEVER `set()`. `POST /members` today is an
 *      unconditioned `arrayUnion` with no owner check at all, so once a member
 *      document exists a plain `set()` would let any site admin overwrite the
 *      OWNER's row and take the site. `create()` fails closed on an existing
 *      document instead.
 *   2. `changeRole` accepts only 'admin' | 'member'. `'owner'` is unreachable
 *      through it at the type level — ownership moves only through
 *      `transferOwnership` (task 2.2), which is transactional and re-reads the
 *      owner row. Without this an admin promotes themselves to owner.
 *   3. `removeMember` refuses the owner. The existing route guard reads a stale
 *      snapshot taken before talon reassignment, so a removal racing a transfer
 *      can strip the sites[] entry of the user who just became owner. Here the
 *      owner check happens inside the transaction that performs the write.
 *
 * SUPERADMINS ARE DELIBERATELY NOT MEMBERS. A superadmin reaches every site by
 * global role (`resolveSiteAccess` short-circuits before the membership term), and
 * writing them member rows would make the roster lie in the other direction — a
 * superadmin who is later demoted would keep a membership nobody granted. The
 * roster's existing blind spot (a superadmin appears in no member list) is real,
 * but it is a reporting problem for the members endpoint to solve, not a reason
 * to manufacture membership records here.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';

/** Stored per-site role. `owner` is written only by ownership transfer. */
export type MemberRole = 'owner' | 'admin' | 'member';

/** Roles a membership mutation may assign. `owner` is deliberately absent. */
export type AssignableRole = 'admin' | 'member';

export const ASSIGNABLE_ROLES: readonly AssignableRole[] = ['admin', 'member'];

export interface MemberDoc {
  /** Duplicated as a FIELD, not just the document id, so the client can run
   *  `collectionGroup('members').where('uid','==',me)` — the Wave 4 read path. */
  uid: string;
  role: MemberRole;
  /** Present from day one so invitations can be added later with no migration.
   *  v1 only ever writes 'active'. */
  status: 'active';
  addedAt: Date;
  addedBy: string;
}

/** Typed failures. Callers map these to status codes; this module picks none. */
export type MembershipFailure =
  | { kind: 'already_member' }
  | { kind: 'not_member' }
  | { kind: 'is_owner' }
  | { kind: 'site_not_found' }
  | { kind: 'user_not_found' }
  | { kind: 'user_inactive' }
  | { kind: 'invalid_role' };

export type MembershipResult<T = void> =
  | ({ ok: true } & (T extends void ? Record<string, never> : { value: T }))
  | { ok: false; failure: MembershipFailure };

function memberRef(db: FirebaseFirestore.Firestore, siteId: string, uid: string) {
  return db.collection('sites').doc(siteId).collection('members').doc(uid);
}

/**
 * Add a member to a site.
 *
 * `create()` on the member document is the concurrency control: two racing adds
 * mean exactly one succeeds and the other fails with ALREADY_EXISTS, and an add
 * aimed at an existing owner row cannot overwrite it. The legacy `arrayUnion` is
 * idempotent and rides the same batch.
 *
 * The caller is responsible for authorization and for having resolved `uid` from
 * an email; this module trusts the uid and re-checks only the invariants above.
 */
export async function addMember(input: {
  siteId: string;
  uid: string;
  role: AssignableRole;
  addedBy: string;
  now?: () => Date;
  db?: FirebaseFirestore.Firestore;
}): Promise<MembershipResult> {
  if (!ASSIGNABLE_ROLES.includes(input.role)) {
    return { ok: false, failure: { kind: 'invalid_role' } };
  }

  const db = input.db ?? getAdminDb();
  const now = (input.now ?? (() => new Date()))();
  const userRef = db.collection('users').doc(input.uid);

  const batch = db.batch();
  // create(), never set(): fails closed if a row (owner included) already exists.
  batch.create(memberRef(db, input.siteId, input.uid), {
    uid: input.uid,
    role: input.role,
    status: 'active',
    addedAt: now,
    addedBy: input.addedBy,
  } satisfies MemberDoc);
  batch.update(userRef, { sites: FieldValue.arrayUnion(input.siteId) });

  try {
    await batch.commit();
  } catch (err) {
    if (isAlreadyExists(err)) return { ok: false, failure: { kind: 'already_member' } };
    throw err;
  }

  return { ok: true } as MembershipResult;
}

/**
 * Change a member's per-site role.
 *
 * Transactional because two guards depend on state read in the same breath as the
 * write: the target must already be a member, and the target must NOT be the
 * owner. `AssignableRole` makes `'owner'` untypeable as a destination, and the
 * owner check makes it unreachable as a source — together they close the
 * admin-promotes-self-to-owner path.
 */
export async function changeRole(input: {
  siteId: string;
  uid: string;
  role: AssignableRole;
  db?: FirebaseFirestore.Firestore;
}): Promise<MembershipResult> {
  if (!ASSIGNABLE_ROLES.includes(input.role)) {
    return { ok: false, failure: { kind: 'invalid_role' } };
  }

  const db = input.db ?? getAdminDb();
  const ref = memberRef(db, input.siteId, input.uid);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, failure: { kind: 'not_member' } };
    // Read INSIDE the transaction: a concurrent transferOwnership that makes this
    // uid the owner must abort this write rather than demote the new owner.
    if ((snap.data() as MemberDoc | undefined)?.role === 'owner') {
      return { ok: false, failure: { kind: 'is_owner' } };
    }
    tx.update(ref, { role: input.role });
    return { ok: true };
  }) as Promise<MembershipResult>;
}

/**
 * Remove a member from a site.
 *
 * Refuses the owner — a site must never be left ownerless, and ownership is moved
 * by transfer, not by removal. The owner check runs inside the transaction that
 * performs the write, which is the fix for the stale-snapshot race in the existing
 * DELETE route: there the guard is evaluated against a snapshot taken before talon
 * reassignment, so a concurrent ownership transfer can slip in between and the
 * removal strips the new owner's `sites[]` entry.
 *
 * Talon reassignment stays the CALLER's business and must still happen before this
 * runs — the route's ordering contract (a refused successor leaves membership
 * intact) is pinned by tests and is not this module's to change.
 */
export async function removeMember(input: {
  siteId: string;
  uid: string;
  db?: FirebaseFirestore.Firestore;
}): Promise<MembershipResult> {
  const db = input.db ?? getAdminDb();
  const ref = memberRef(db, input.siteId, input.uid);
  const siteRef = db.collection('sites').doc(input.siteId);
  const userRef = db.collection('users').doc(input.uid);

  return db.runTransaction(async (tx) => {
    const [memberSnap, siteSnap] = await Promise.all([tx.get(ref), tx.get(siteRef)]);

    // A MISSING SITE IS NOT A REFUSAL. The guard below exists to protect the
    // OWNER; a site that no longer exists has no owner to protect, and the
    // membership left pointing at it is precisely the dangling entry that makes
    // a re-registered slug inherit the previous tenant's members. Refusing here
    // would break the orphan-cleanup path in ManageUserSitesDialog, which
    // depends on being able to strip membership for sites that are gone.
    //
    // The members DELETE endpoint still 404s on a missing site — it checks that
    // itself, before calling this — so nothing is weakened by allowing it here.
    if (!siteSnap.exists) {
      if (memberSnap.exists) tx.delete(ref);
      tx.update(userRef, { sites: FieldValue.arrayRemove(input.siteId) });
      return { ok: true };
    }

    // BOTH shapes are consulted while the legacy field is still authoritative:
    // the member row may not exist yet for a site whose owner predates this
    // module, so the legacy `owner` field is the one that must not be removed.
    const ownerUid = (siteSnap.data() as { owner?: unknown } | undefined)?.owner;
    const isOwnerByLegacyField = typeof ownerUid === 'string' && ownerUid === input.uid;
    const isOwnerByMemberDoc = (memberSnap.data() as MemberDoc | undefined)?.role === 'owner';
    if (isOwnerByLegacyField || isOwnerByMemberDoc) {
      return { ok: false, failure: { kind: 'is_owner' } };
    }

    // Absent member row is NOT an error while the subcollection is still a
    // shadow: membership predating this module lives only in `sites[]`, and
    // refusing here would make the endpoint unusable for every existing member.
    if (memberSnap.exists) tx.delete(ref);
    tx.update(userRef, { sites: FieldValue.arrayRemove(input.siteId) });
    return { ok: true };
  }) as Promise<MembershipResult>;
}

/**
 * Write the owner's member row for a site being created.
 *
 * Split out so `createSite` can add it to the batch it ALREADY commits, keeping
 * site document, owner field and member row in one atomic write. Takes the batch
 * rather than committing, because a second commit would reintroduce exactly the
 * partial-write window this module exists to close.
 */
export function addOwnerToBatch(
  batch: FirebaseFirestore.WriteBatch,
  input: { siteId: string; ownerUid: string; now: Date; db?: FirebaseFirestore.Firestore },
): void {
  const db = input.db ?? getAdminDb();
  batch.set(memberRef(db, input.siteId, input.ownerUid), {
    uid: input.ownerUid,
    role: 'owner',
    status: 'active',
    addedAt: input.now,
    addedBy: input.ownerUid,
  } satisfies MemberDoc);
}

/**
 * Firestore signals a failed `create()` on an existing document as gRPC code 6
 * (ALREADY_EXISTS). The emulator and the production client differ in which of
 * `code`/`message` they populate, so both are checked.
 */
function isAlreadyExists(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  if (code === 6 || code === 'already-exists' || code === 'ALREADY_EXISTS') return true;
  const message = (err as { message?: unknown }).message;
  return typeof message === 'string' && /already exists/i.test(message);
}
