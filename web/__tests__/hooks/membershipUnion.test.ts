/**
 * `unionMembership` and the `membership_fallback` counter — wave 4.4 of
 * dev/active/per-site-roles.
 *
 * The union is what lets membership become the source of access without a
 * flag-day: a user whose backfill has not landed keeps working off the legacy
 * array. `fallbacks` is the measurement that says when that crutch can go, and
 * wave 6.1 strips `users/{uid}.sites[]` only once the counter has held at zero.
 * So the counter under-reporting is the failure that matters here, not the union
 * itself.
 */

import { unionMembership, type SiteRole } from '@/hooks/useFirestore';
import {
  emitMembershipFallback,
  emitMembershipListenerError,
  __resetMembershipFallbackDedupe,
} from '@/lib/membershipMetrics';

const captureMessage = jest.fn();
jest.mock('@sentry/nextjs', () => ({
  captureMessage: (...args: unknown[]) => captureMessage(...args),
}));

const roles = (entries: Record<string, SiteRole>) =>
  new Map<string, SiteRole>(Object.entries(entries));

describe('unionMembership', () => {
  it('publishes membership sites when there is no legacy array', () => {
    const { sites, fallbacks } = unionMembership(
      roles({ 'site-b': 'owner', 'site-a': 'member' }),
      [],
    );

    expect(sites).toEqual(['site-a', 'site-b']);
    expect(fallbacks).toEqual([]);
  });

  it('publishes legacy sites membership does not cover, and counts them', () => {
    // The un-backfilled user. They keep working, and they are counted.
    const { sites, fallbacks } = unionMembership(roles({}), ['site-a']);

    expect(sites).toEqual(['site-a']);
    expect(fallbacks).toEqual(['site-a']);
  });

  it('counts no fallback when membership already covers the legacy entry', () => {
    const { sites, fallbacks } = unionMembership(roles({ 'site-a': 'owner' }), ['site-a']);

    expect(sites).toEqual(['site-a']);
    expect(fallbacks).toEqual([]);
  });

  it('does not count a membership the legacy array lacks', () => {
    // The backfill runs ahead of the legacy field, not behind it. A site granted
    // by membership alone is the migration working, not a fallback.
    const { sites, fallbacks } = unionMembership(roles({ 'site-a': 'admin' }), []);

    expect(sites).toEqual(['site-a']);
    expect(fallbacks).toEqual([]);
  });

  it('deduplicates and sorts so the projection has a stable identity', () => {
    // AuthContext memoizes on this value; an unstable order would churn every
    // consumer of `userSites` on each snapshot.
    const { sites } = unionMembership(roles({ 'site-c': 'member', 'site-a': 'owner' }), [
      'site-a',
      'site-b',
    ]);

    expect(sites).toEqual(['site-a', 'site-b', 'site-c']);
  });

  it('handles a superadmin, who holds no member rows at all', () => {
    const { sites, fallbacks } = unionMembership(roles({}), []);

    expect(sites).toEqual([]);
    expect(fallbacks).toEqual([]);
  });
});

describe('emitMembershipFallback', () => {
  beforeEach(() => {
    __resetMembershipFallbackDedupe();
    captureMessage.mockClear();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reports one event per site, tagged with the site and user', () => {
    emitMembershipFallback('uid-1', ['site-a', 'site-b']);

    expect(captureMessage).toHaveBeenCalledTimes(2);
    expect(captureMessage).toHaveBeenCalledWith(
      'membership_fallback',
      expect.objectContaining({
        level: 'warning',
        tags: expect.objectContaining({ siteId: 'site-a', uid: 'uid-1' }),
      }),
    );
  });

  it('reports each site only once however often the listener re-fires', () => {
    // The listener re-emits on every snapshot. Without dedupe a single
    // un-backfilled user would swamp the counter that gates wave 6.1.
    emitMembershipFallback('uid-1', ['site-a']);
    emitMembershipFallback('uid-1', ['site-a']);
    emitMembershipFallback('uid-1', ['site-a']);

    expect(captureMessage).toHaveBeenCalledTimes(1);
  });

  it('reports the same site separately for a different user', () => {
    // Dedupe is per site AND user — two affected users on one site is two
    // findings, not one.
    emitMembershipFallback('uid-1', ['site-a']);
    emitMembershipFallback('uid-2', ['site-a']);

    expect(captureMessage).toHaveBeenCalledTimes(2);
  });

  it('emits nothing when there is nothing to report', () => {
    emitMembershipFallback('uid-1', []);

    expect(captureMessage).not.toHaveBeenCalled();
  });
});

describe('emitMembershipListenerError', () => {
  beforeEach(() => {
    __resetMembershipFallbackDedupe();
    captureMessage.mockClear();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reports at error level, above a fallback', () => {
    // A fallback is one user's backfill lagging. This is the listener not running
    // at all, which degrades everyone — the severities must not be equal.
    emitMembershipListenerError('uid-1', 'Missing or insufficient permissions.');

    expect(captureMessage).toHaveBeenCalledWith(
      'membership_listener_error',
      expect.objectContaining({
        level: 'error',
        tags: expect.objectContaining({ uid: 'uid-1' }),
        extra: { message: 'Missing or insufficient permissions.' },
      }),
    );
  });

  it('reports a repeated error once', () => {
    emitMembershipListenerError('uid-1', 'permission-denied');
    emitMembershipListenerError('uid-1', 'permission-denied');

    expect(captureMessage).toHaveBeenCalledTimes(1);
  });

  it('reports a different failure separately', () => {
    emitMembershipListenerError('uid-1', 'permission-denied');
    emitMembershipListenerError('uid-1', 'index required');

    expect(captureMessage).toHaveBeenCalledTimes(2);
  });
});
