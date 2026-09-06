/**
 * `transferSiteOwnership.server.ts` — the ONE atomic ownership transfer.
 *
 * Wave 2 task 2.2 of `dev/active/per-site-roles`.
 *
 * Before this, ownership moved in exactly one place — `performUserDeleteCascade`
 * — and it moved badly: the successor's liveness and role were validated by plain
 * reads outside any transaction, then each owned site was rewritten by a separate
 * un-batched `update` inside a `try/catch` that warned and continued, and the
 * departing user was soft-deleted afterwards whether or not a single transfer had
 * succeeded. Three live consequences, all of which this function exists to end:
 *
 *   - A transfer racing a demote hands ownership to a user whose global role just
 *     became `member`. Ownership short-circuits the capability matrix for every
 *     site-scoped capability, so that user silently gains SITE_DELETE.
 *   - `?successorUid=<the uid being deleted>` passes every guard, so a site ends
 *     up owned by a soft-deleted account — unreachable by its own owner, since
 *     both `resolveSiteAccess` and `firestore.rules` reject a deleted principal —
 *     and the operation reports success.
 *   - A failed transfer is permanent: the idempotency short-circuit means a retry
 *     replays the recorded response instead of finishing the work.
 *
 * EVERYTHING HERE HAPPENS IN ONE TRANSACTION, and the authorization decision is
 * made from documents read INSIDE it. The wrapper's pre-handler membership read
 * is deliberately not trusted: it happened before this transaction opened, so
 * acting on it is the stale-snapshot bug one layer up. The read of the site
 * document is also what makes a concurrent second transfer abort rather than
 * interleave — that is the mechanism, not a side effect.
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
  /** The uid receiving ownership. */
  successorUid: string;
  /** The principal performing the transfer. */
  actorUid: string;
  /** True when the actor holds the global superadmin role. */
  actorIsSuperadmin: boolean;
  now?: () => Date;
  db?: FirebaseFirestore.Firestore;
}

/**
 * Move ownership of a site to `successorUid`.
 *
 * Authorization: the actor must BE the current owner, or be a superadmin. A site
 * admin is not enough — administering a site and owning it are different things,
 * which is the same line `SITE_DELETE` draws.
 *
 * The successor need not already be a member; they are made one by this
 * transaction. Requiring prior membership would force a two-step
 * add-then-transfer whose window is exactly the partial state this closes.
 *
 * The outgoing owner is demoted to `admin` and KEEPS their `sites[]` entry —
 * handing a site over should not evict you from it. Callers wanting them gone
 * must remove them afterwards, through `membership.server.ts`.
 */
export async function transferSiteOwnership(input: TransferInput): Promise<TransferResult> {
  const db = input.db ?? getAdminDb();
  const now = (input.now ?? (() => new Date()))();

  const siteRef = db.collection('sites').doc(input.siteId);
  const successorUserRef = db.collection('users').doc(input.successorUid);
  const membersCol = siteRef.collection('members');

  return db.runTransaction(async (tx) => {
    // ---- READS. All of them, before any write: Firestore forbids a read after
    // a write in the same transaction, and these are also the documents whose
    // concurrent modification must abort this attempt.
    const [siteSnap, successorSnap] = await Promise.all([
      tx.get(siteRef),
      tx.get(successorUserRef),
    ]);

    if (!siteSnap.exists) return { ok: false, failure: { kind: 'site_not_found' } };

    const siteData = (siteSnap.data() ?? {}) as { owner?: unknown };
    const currentOwnerUid = typeof siteData.owner === 'string' ? siteData.owner : null;
    if (!currentOwnerUid) {
      // An ownerless site cannot be transferred, only repaired. Failing loudly
      // beats inventing an owner from whoever happened to call.
      return { ok: false, failure: { kind: 'site_has_no_owner' } };
    }

    // THE authorization decision, from a document read inside this transaction.
    if (!input.actorIsSuperadmin && input.actorUid !== currentOwnerUid) {
      return { ok: false, failure: { kind: 'not_owner' } };
    }

    // Self-transfer is refused rather than treated as a no-op success. The
    // cascade's equivalent hole reports success while leaving a site owned by a
    // soft-deleted account, so silence here would be the same lie.
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

    // ---- WRITES. One transaction, both shapes.
    tx.update(siteRef, { owner: input.successorUid });

    // `set` with merge, not `update`: the outgoing owner may predate the members
    // subcollection and have no row at all, and update() on a missing document
    // fails the whole transaction.
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

    // Legacy half. arrayUnion is idempotent, so a successor who was already a
    // member is unaffected. The previous owner keeps theirs by design.
    tx.update(successorUserRef, { sites: FieldValue.arrayUnion(input.siteId) });

    return { ok: true, previousOwnerUid: currentOwnerUid, newOwnerUid: input.successorUid };
  }) as Promise<TransferResult>;
}
