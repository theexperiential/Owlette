/**
 * `transferSiteOwnership.server.ts` — the ONE atomic ownership transfer.
 *
 * Wave 2 task 2.2 of `dev/active/per-site-roles`.
 *
 * Replaces the transfer that was buried in `performUserDeleteCascade`, which
 * validated the successor with plain reads outside any transaction and rewrote each
 * owned site in a separate warn-and-continue `update`. The three live bugs that
 * produced, which this function exists to end:
 *
 *   - A transfer racing a demote hands ownership to a user whose global role just
 *     became `member`; ownership short-circuits the capability matrix, so they
 *     silently gain SITE_DELETE.
 *   - `?successorUid=<the uid being deleted>` passed every guard, leaving a site
 *     owned by a soft-deleted account — unreachable by its own owner, since both
 *     `resolveSiteAccess` and `firestore.rules` reject a deleted principal — while
 *     the operation reported success.
 *   - A failed transfer was permanent: the idempotency short-circuit replays the
 *     recorded response on retry instead of finishing the work.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import type { MemberDoc } from '@/lib/membership.server';

export type TransferFailure =
  | { kind: 'site_not_found' }
  | { kind: 'not_owner' }
  | { kind: 'successor_not_found' }
  | { kind: 'successor_inactive' }
  | { kind: 'successor_already_owner' }
  | { kind: 'site_has_no_owner' };

export type TransferResult =
  | { ok: true; previousOwnerUid: string; newOwnerUid: string }
  | { ok: false; failure: TransferFailure };

export interface TransferInput {
  siteId: string;
  successorUid: string;
  actorUid: string;
  /** True when the actor holds the global superadmin role. */
  actorIsSuperadmin: boolean;
  now?: () => Date;
  db?: FirebaseFirestore.Firestore;
}

/**
 * Move ownership of a site to `successorUid`.
 *
 * The actor must BE the current owner, or a superadmin — a site admin is not
 * enough, the same line `SITE_DELETE` draws.
 *
 * The successor need not already be a member; this transaction makes them one.
 * Requiring prior membership would force a two-step add-then-transfer whose window
 * is exactly the partial state this closes.
 *
 * The outgoing owner is demoted to `admin` and KEEPS their `sites[]` entry; callers
 * wanting them gone must remove them afterwards, through `membership.server.ts`.
 */
export async function transferSiteOwnership(input: TransferInput): Promise<TransferResult> {
  const db = input.db ?? getAdminDb();
  const now = (input.now ?? (() => new Date()))();

  const siteRef = db.collection('sites').doc(input.siteId);
  const successorUserRef = db.collection('users').doc(input.successorUid);
  const membersCol = siteRef.collection('members');

  return db.runTransaction(async (tx) => {
    // All reads first: Firestore forbids a read after a write in one transaction,
    // and these are the documents whose concurrent modification must abort this.
    const [siteSnap, successorSnap] = await Promise.all([
      tx.get(siteRef),
      tx.get(successorUserRef),
    ]);

    if (!siteSnap.exists) return { ok: false, failure: { kind: 'site_not_found' } };

    const siteData = (siteSnap.data() ?? {}) as { owner?: unknown };
    const currentOwnerUid = typeof siteData.owner === 'string' ? siteData.owner : null;
    if (!currentOwnerUid) {
      // An ownerless site is a repair job — never invent an owner from the caller.
      return { ok: false, failure: { kind: 'site_has_no_owner' } };
    }

    // THE authorization decision, from a document read inside this transaction.
    if (!input.actorIsSuperadmin && input.actorUid !== currentOwnerUid) {
      return { ok: false, failure: { kind: 'not_owner' } };
    }

    // Refused, not treated as a no-op success: silent success hides the caller's bug.
    if (input.successorUid === currentOwnerUid) {
      return { ok: false, failure: { kind: 'successor_already_owner' } };
    }

    if (!successorSnap.exists) return { ok: false, failure: { kind: 'successor_not_found' } };
    const successorData = (successorSnap.data() ?? {}) as { deletedAt?: unknown };
    if (typeof successorData.deletedAt === 'number') {
      // Read in-transaction so a soft-delete racing this transfer aborts it.
      return { ok: false, failure: { kind: 'successor_inactive' } };
    }

    const previousOwnerMemberRef = membersCol.doc(currentOwnerUid);
    const successorMemberRef = membersCol.doc(input.successorUid);
    const previousOwnerMemberSnap = await tx.get(previousOwnerMemberRef);

    tx.update(siteRef, { owner: input.successorUid });

    // `set`, not `update`: the outgoing owner may predate the members subcollection
    // and have no row at all, and update() on a missing document fails the whole tx.
    if (previousOwnerMemberSnap.exists) {
      tx.update(previousOwnerMemberRef, { role: 'admin' });
    } else {
      tx.set(previousOwnerMemberRef, {
        uid: currentOwnerUid,
        role: 'admin',
        status: 'active',
        addedAt: now,
        addedBy: input.actorUid,
      } satisfies MemberDoc);
    }

    tx.set(successorMemberRef, {
      uid: input.successorUid,
      role: 'owner',
      status: 'active',
      addedAt: now,
      addedBy: input.actorUid,
    } satisfies MemberDoc);

    // Legacy `users.sites[]` mirror, dual-written alongside the members subcollection.
    tx.update(successorUserRef, { sites: FieldValue.arrayUnion(input.siteId) });

    return { ok: true, previousOwnerUid: currentOwnerUid, newOwnerUid: input.successorUid };
  }) as Promise<TransferResult>;
}
