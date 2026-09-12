/**
 * The pure `computeIsSuperadmin` / `computeIsSiteAdmin` / `shouldListenerBootstrap`
 * helpers, extracted from AuthContext so they test without mounting the provider
 * and its Firebase deps.
 *
 * Role matrix (compute*): {null, member, admin, superadmin} global tier x the
 * caller's PER-SITE role on the site being asked about.
 *
 * `computeIsSiteAdmin` takes a role map now, not a `sites[]` array: site standing
 * is a membership document, and the global role no longer participates beyond
 * superadmin. The `admin` blocks below are where that shows — a global admin with
 * no membership is denied, which is the point of the migration.
 */

import {
  computeIsSuperadmin,
  computeIsSiteAdmin,
  computeAdministersAnySite,
  computeIsSiteOwner,
  shouldListenerBootstrap,
} from '@/contexts/AuthContext';
import type { SiteRole } from '@/hooks/useFirestore';

const SITE_IN = 'site-A';
const SITE_OUT = 'site-B';

const roles = (entries: Record<string, SiteRole>) =>
  new Map<string, SiteRole>(Object.entries(entries));

/** The caller administers site A and has no standing on site B. */
const ADMIN_ON_A = roles({ [SITE_IN]: 'admin' });
/** The caller is a plain member of site A. */
const MEMBER_ON_A = roles({ [SITE_IN]: 'member' });
/** The caller owns site A. */
const OWNER_ON_A = roles({ [SITE_IN]: 'owner' });
/** No memberships at all. */
const NO_SITES = roles({});

describe('computeIsSuperadmin', () => {
  it('is false for null role (pre-auth / missing user doc / listener error)', () => {
    expect(computeIsSuperadmin(null)).toBe(false);
  });

  it('is false for member role', () => {
    expect(computeIsSuperadmin('member')).toBe(false);
  });

  it('is false for site-scoped admin role', () => {
    // The middle tier must NOT be confused with platform god-mode.
    expect(computeIsSuperadmin('admin')).toBe(false);
  });

  it('is true for superadmin role', () => {
    expect(computeIsSuperadmin('superadmin')).toBe(true);
  });
});

describe('computeIsSiteAdmin', () => {
  describe('null global role', () => {
    it('is false even holding an admin membership', () => {
      // Role null means the user document has not resolved. Nothing is granted
      // off a half-loaded session.
      expect(computeIsSiteAdmin(null, ADMIN_ON_A, SITE_IN)).toBe(false);
    });

    it('is false for a site with no membership', () => {
      expect(computeIsSiteAdmin(null, ADMIN_ON_A, SITE_OUT)).toBe(false);
    });
  });

  describe('per-site role decides, not the global tier', () => {
    it('is false for a plain member of the site', () => {
      expect(computeIsSiteAdmin('member', MEMBER_ON_A, SITE_IN)).toBe(false);
    });

    it('is true for a per-site admin', () => {
      expect(computeIsSiteAdmin('member', ADMIN_ON_A, SITE_IN)).toBe(true);
    });

    it('is true for the site owner (owner outranks admin)', () => {
      expect(computeIsSiteAdmin('member', OWNER_ON_A, SITE_IN)).toBe(true);
    });

    it('is false for a site the caller holds no membership on', () => {
      expect(computeIsSiteAdmin('member', ADMIN_ON_A, SITE_OUT)).toBe(false);
    });
  });

  describe('global admin - the headline change', () => {
    it('is FALSE without a membership on the site', () => {
      // Before per-site roles this was true for every site in `sites[]`. A global
      // admin now carries no site privilege it was not explicitly granted.
      expect(computeIsSiteAdmin('admin', NO_SITES, SITE_IN)).toBe(false);
    });

    it('is false on a site where it is only a member', () => {
      expect(computeIsSiteAdmin('admin', MEMBER_ON_A, SITE_IN)).toBe(false);
    });

    it('is true only where it holds an admin membership', () => {
      expect(computeIsSiteAdmin('admin', ADMIN_ON_A, SITE_IN)).toBe(true);
      expect(computeIsSiteAdmin('admin', ADMIN_ON_A, SITE_OUT)).toBe(false);
    });
  });

  describe('superadmin role (god-mode)', () => {
    it('is true for a site it holds a membership on', () => {
      expect(computeIsSiteAdmin('superadmin', ADMIN_ON_A, SITE_IN)).toBe(true);
    });

    it('is true for a site it holds no membership on', () => {
      // Mirrors firestore.rules canAccessSite: superadmins short-circuit before
      // the membership term and deliberately hold no member rows.
      expect(computeIsSiteAdmin('superadmin', ADMIN_ON_A, SITE_OUT)).toBe(true);
    });

    it('is true with no memberships at all', () => {
      expect(computeIsSiteAdmin('superadmin', NO_SITES, SITE_OUT)).toBe(true);
    });
  });
});

describe('computeAdministersAnySite', () => {
  const roles = (entries: Record<string, SiteRole>) =>
    new Map<string, SiteRole>(Object.entries(entries));

  it('is true for an owner of any site', () => {
    expect(computeAdministersAnySite('member', roles({ 'site-a': 'owner' }))).toBe(true);
  });

  it('is true for an admin of any site', () => {
    expect(computeAdministersAnySite('member', roles({ 'site-a': 'admin' }))).toBe(true);
  });

  it('is false for someone who is only ever a member', () => {
    expect(
      computeAdministersAnySite('member', roles({ 'site-a': 'member', 'site-b': 'member' }))
    ).toBe(false);
  });

  it('is true for a superadmin holding no memberships', () => {
    expect(computeAdministersAnySite('superadmin', roles({}))).toBe(true);
  });

  it('is FALSE for a global admin holding no memberships', () => {
    // Before wave 5.1 this user reached every site-scoped admin page, saw an
    // empty list on each, and had every write refused server-side.
    expect(computeAdministersAnySite('admin', roles({}))).toBe(false);
  });

  it('is false while the session is unresolved', () => {
    expect(computeAdministersAnySite(null, roles({ 'site-a': 'owner' }))).toBe(false);
  });
});

describe('computeIsSiteOwner', () => {
  const roles = (entries: Record<string, SiteRole>) =>
    new Map<string, SiteRole>(Object.entries(entries));

  it('is true only for the owner row', () => {
    expect(computeIsSiteOwner('member', roles({ 'site-a': 'owner' }), 'site-a')).toBe(true);
  });

  it('is FALSE for a site admin — SITE_DELETE is the one thing they lack', () => {
    expect(computeIsSiteOwner('member', roles({ 'site-a': 'admin' }), 'site-a')).toBe(false);
  });

  it('is false for a plain member', () => {
    expect(computeIsSiteOwner('member', roles({ 'site-a': 'member' }), 'site-a')).toBe(false);
  });

  it('does not leak ownership across sites', () => {
    expect(computeIsSiteOwner('member', roles({ 'site-a': 'owner' }), 'site-b')).toBe(false);
  });

  it('is true for a superadmin holding no membership', () => {
    expect(computeIsSiteOwner('superadmin', roles({}), 'site-a')).toBe(true);
  });

  it('is false while the session is unresolved', () => {
    expect(computeIsSiteOwner(null, roles({ 'site-a': 'owner' }), 'site-a')).toBe(false);
  });
});

describe('shouldListenerBootstrap', () => {
  it('bootstraps when nothing is in flight (google sign-in / cold recovery)', async () => {
    await expect(shouldListenerBootstrap(null)).resolves.toBe(true);
  });

  it('stands down while the tokened signUp bootstrap is still in flight', async () => {
    // The listener has no Turnstile token; racing signUp spent a rejected
    // challenge on every email/password signup (drift-audit item 9).
    let resolve!: (value: { alreadyExists: boolean }) => void;
    const pending = new Promise<{ alreadyExists: boolean }>(r => { resolve = r; });

    const decision = shouldListenerBootstrap(pending);
    resolve({ alreadyExists: false });

    await expect(decision).resolves.toBe(false);
  });

  it('still bootstraps when the signUp attempt actually failed — the recovery path', async () => {
    // Standing down must not cost us the reason this path exists.
    const failed = Promise.reject(new Error('siteverify blip'));
    await expect(shouldListenerBootstrap(failed)).resolves.toBe(true);
  });
});
