/**
 * `owlette.members(siteId)` — site-scoped membership management.
 *
 *   GET    /api/sites/{siteId}/members
 *   POST   /api/sites/{siteId}/members            — body `{ uid | email, role }`
 *   PATCH  /api/sites/{siteId}/members/{uid}      — body `{ role }`
 *   DELETE /api/sites/{siteId}/members/{uid}
 *   POST   /api/sites/{siteId}/transfer-ownership — body `{ successorUid }`
 *
 * The constructor binds to a `siteId`. Exposed as a factory on the root
 * `Owlette` instance so callers do `owlette.members(siteId).list()`.
 *
 * PER-SITE ROLES. `setRole` changes someone's role on THIS site only, leaving
 * their global role untouched. Before it existed the per-site role was derived
 * from the global one, so "make them an admin here" meant promoting them
 * everywhere they belonged — the leak per-site roles close.
 */
import { randomUUID } from 'crypto';
import type { OwletteClient } from '../lib/client';

// types

/**
 * Role as REPORTED by the API. `owner` and `superadmin` are derived standings,
 * not settings — see `AssignableSiteRole` for what can actually be written.
 */
export type SiteMemberRole = 'owner' | 'superadmin' | 'admin' | 'member';

/**
 * Roles that can be ASSIGNED. `owner` is deliberately absent: ownership moves
 * only through `transferOwnership`, which is transactional and re-reads the
 * owner inside it, so an admin can neither promote themselves into ownership
 * nor demote the owner out of it.
 */
export type AssignableSiteRole = 'admin' | 'member';

export interface SiteMember {
  uid: string;
  email: string | null;
  role: SiteMemberRole;
  globalRole: string;
  displayName: string | null;
}

/**
 * Identify the target by EXACTLY ONE of `uid` or `email` — supplying both, or
 * neither, is a 400. `email` is trimmed and lowercased, then resolved through
 * Firebase Auth to the same uid path.
 */
export type AddMemberOptions = { role: AssignableSiteRole; idempotencyKey?: string } & (
  | { uid: string; email?: never }
  | { email: string; uid?: never }
);

export interface AddMemberResult {
  uid: string;
  siteId: string;
  requestedRole: AssignableSiteRole;
  /**
   * Always `true`. Roles are per-site: the requested role is written into the
   * membership document, which is what grants, so the request is always honoured.
   *
   * @deprecated Retained only so the response shape stays stable. It used to
   * report whether the target's GLOBAL role would make an `admin` request stick,
   * back when per-site roles were derived at read time. It reported `false` while
   * a real site-admin row was written.
   */
  roleHonored: boolean;
  globalRole: string;
}

export interface SetMemberRoleResult {
  siteId: string;
  uid: string;
  role: AssignableSiteRole;
}

export interface RemoveMemberResult {
  siteId: string;
  uid: string;
  wasMember: boolean;
}

export interface TransferOwnershipResult {
  siteId: string;
  previousOwnerUid: string;
  newOwnerUid: string;
}

// resource

export class Members {
  constructor(
    private readonly client: OwletteClient,
    private readonly siteId: string,
  ) {}

  private get base(): string {
    return `/api/sites/${encodeURIComponent(this.siteId)}/members`;
  }

  /**
   * Members of this site, each with their derived per-site role.
   *
   * A member's OTHER site memberships are deliberately not returned — that
   * would hand a site admin the site ids of every other organisation the person
   * belongs to. (This type previously declared a required `sites` field the API
   * has never sent.)
   */
  async list(): Promise<SiteMember[]> {
    const res = await this.client.request<{ members: SiteMember[] }>(this.base);
    return res.data.members;
  }

  async add(opts: AddMemberOptions): Promise<AddMemberResult> {
    const res = await this.client.request<AddMemberResult>(this.base, {
      method: 'POST',
      body: opts.uid !== undefined
        ? { uid: opts.uid, role: opts.role }
        : { email: opts.email, role: opts.role },
      idempotencyKey: opts.idempotencyKey ?? `sdk-members-add-${randomUUID()}`,
    });
    return res.data;
  }

  /**
   * Change a member's role on THIS site. Their global role is untouched.
   *
   * Refuses the site owner with 409 `cannot_change_owner_role` — the owner's
   * role is set by ownership, so use {@link transferOwnership} instead.
   */
  async setRole(
    uid: string,
    role: AssignableSiteRole,
    opts: { idempotencyKey?: string } = {},
  ): Promise<SetMemberRoleResult> {
    const res = await this.client.request<SetMemberRoleResult>(
      `${this.base}/${encodeURIComponent(uid)}`,
      {
        method: 'PATCH',
        body: { role },
        idempotencyKey: opts.idempotencyKey ?? `sdk-members-setrole-${randomUUID()}`,
      },
    );
    return res.data;
  }

  async remove(uid: string): Promise<RemoveMemberResult> {
    const res = await this.client.request<RemoveMemberResult>(
      `${this.base}/${encodeURIComponent(uid)}`,
      { method: 'DELETE' },
    );
    return res.data;
  }

  /**
   * Hand this site to another user, atomically.
   *
   * Only the current owner or a superadmin may do this — a site admin is
   * refused with 403 `not_owner`. The successor need not already be a member;
   * they are made one by the same transaction. The outgoing owner is demoted to
   * `admin` and KEEPS their membership: handing a site over is not eviction.
   */
  async transferOwnership(
    successorUid: string,
    opts: { idempotencyKey?: string } = {},
  ): Promise<TransferOwnershipResult> {
    const res = await this.client.request<TransferOwnershipResult>(
      `/api/sites/${encodeURIComponent(this.siteId)}/transfer-ownership`,
      {
        method: 'POST',
        body: { successorUid },
        idempotencyKey: opts.idempotencyKey ?? `sdk-transfer-owner-${randomUUID()}`,
      },
    );
    return res.data;
  }
}
