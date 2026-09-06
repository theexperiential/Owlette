/** @jest-environment node */

/**
 * CHARACTERIZATION MATRIX — `dev/active/per-site-roles` Wave 1, Task 1.1.
 *
 * Owlette gates site-scoped routes through TWO independent authorization
 * paths that were written separately and have drifted:
 *
 *   A. `authorizedSiteHandler`  (web/lib/authorizedHandler.server.ts) — 46 routes
 *   B. `requireSiteAuthAndScope` (web/app/api/_shared.ts)             — 35 routes
 *
 * Wave 1 collapses both onto one decision core. This file pins what they do
 * TODAY, divergences included, so the refactor has a contract to answer to.
 * It is deliberately written against the REAL decision logic: only the
 * identity edge (`resolveAuth`) and side-effect sinks (audit, rate limit,
 * security config) are stubbed. `assertUserHasSiteAccess`, `assertUserDataActive`
 * and the siteId validation all run for real — mocking those would pin the
 * mock rather than the system, and they are exactly where the drift lives.
 *
 * The two divergences this must keep honest, both asserted below:
 *   1. DELETED USER   — path A answers 403 `user_inactive`; path B collapses
 *                       it into the generic 404 "site not found or no access".
 *   2. MALFORMED ID   — path B validates the siteId shape up front and answers
 *                       400; path A has no such check, so the lookup misses and
 *                       it answers 404.
 *
 * When Wave 1 Task 1.3 unifies these (400 everywhere for malformed, 403
 * everywhere for inactive), the DIVERGENCE tests below are expected to fail —
 * that is the signal to update them to the new single contract, in the same
 * commit, with the old expectation recorded in the task log. Do not delete a
 * divergence test to make a refactor green.
 */

import type { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Controllable data layer. Both paths read `users/{uid}` and `sites/{siteId}`.
// ---------------------------------------------------------------------------

const store = {
  users: new Map<string, Record<string, unknown> | null>(),
  sites: new Map<string, Record<string, unknown> | null>(),
};

/** Reads recorded per document path, so we can pin the read COST of each path. */
const reads: string[] = [];

function snapshot(id: string, data: Record<string, unknown> | null) {
  return { exists: data !== null, id, data: () => data ?? undefined };
}

function resolveDoc(path: string) {
  reads.push(path);
  const segments = path.split('/').filter(Boolean);
  // TOP-LEVEL DOCUMENTS ONLY — exactly two segments. Destructuring the first
  // two segments of ANY path would make `sites/{id}/members/{uid}` resolve to
  // the SITE document, so a Wave 4 membership-subcollection read would silently
  // answer with unrelated data and this matrix would pass while testing nothing.
  // Anything deeper is reported as non-existent, which fails loudly instead.
  if (segments.length !== 2) return snapshot(segments[segments.length - 1] ?? 'unknown', null);
  const [collection, id] = segments;
  if (collection === 'users') return snapshot(id, store.users.get(id) ?? null);
  if (collection === 'sites') return snapshot(id, store.sites.get(id) ?? null);
  return snapshot(id, null);
}

function buildDoc(path: string): Record<string, unknown> {
  return {
    get: () => Promise.resolve(resolveDoc(path)),
    set: () => Promise.resolve(),
    update: () => Promise.resolve(),
    delete: () => Promise.resolve(),
    collection: (sub: string) => buildCollection(`${path}/${sub}`),
  };
}

function buildCollection(name: string): Record<string, unknown> {
  return {
    doc: (id?: string) => buildDoc(`${name}/${id ?? 'auto'}`),
    where: function () { return this; },
    orderBy: function () { return this; },
    limit: function () { return this; },
    get: () => Promise.resolve({ docs: [], empty: true }),
  };
}

jest.mock('@/lib/firebase-admin', () => ({
  getAdminDb: () => ({
    collection: (name: string) => buildCollection(name),
    // Present so this matrix still passes after Task 1.2 collapses the
    // separate reads into one batched round trip.
    getAll: (...refs: Array<{ get: () => Promise<unknown> }>) =>
      Promise.all(refs.map((r) => r.get())),
    batch: () => ({
      set: () => {},
      update: () => {},
      delete: () => {},
      commit: () => Promise.resolve(),
    }),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        get: (ref: { get: () => Promise<unknown> }) => ref.get(),
        set: () => {},
        update: () => {},
        delete: () => {},
      }),
  }),
  getAdminAuth: () => ({}),
}));

// ---------------------------------------------------------------------------
// Identity edge. The ONLY part of apiAuth we stub — everything else is real.
// ---------------------------------------------------------------------------

type AuthShape = { userId: string; keyContext: unknown };

let resolveAuthResult: AuthShape = { userId: 'uid_alice', keyContext: null };
let resolveAuthThrows: { status: number; message: string; code?: string } | null = null;

jest.mock('@/lib/apiAuth.server', () => {
  const actual = jest.requireActual('@/lib/apiAuth.server');
  return {
    ...actual,
    resolveAuth: jest.fn(async () => {
      if (resolveAuthThrows) {
        throw new actual.ApiAuthError(resolveAuthThrows.status, resolveAuthThrows.message, {
          code: resolveAuthThrows.code,
        });
      }
      return resolveAuthResult;
    }),
  };
});

// ---------------------------------------------------------------------------
// Side-effect sinks. None of these participate in the allow/deny decision,
// except the allow-audit's 503-on-failure, which is pinned in
// authorizedHandler.test.ts rather than here.
// ---------------------------------------------------------------------------

jest.mock('@/lib/securityConfig.server', () => ({
  securityConfig: {
    read: async () => ({
      capability_enforcement: true,
      rate_limit_enforcement: true,
      lastUpdated: 0,
      expiresAt: 0,
    }),
  },
}));

jest.mock('@/lib/rateLimit.server', () => ({
  checkRateLimit: async () => ({ ok: true }),
  rateLimitHeaders: () => ({}),
  CAPABILITY_RATE_LIMITS: {},
  API_KEY_RATE_LIMITS: {},
}));

jest.mock('@/lib/auditLog.server', () => ({
  generateCorrelationId: () => 'corr_test',
  writeAuditEntry: async () => {},
  writeAuditEntryBlocking: async () => {},
  writeGlobalAuditEntryBlocking: async () => {},
}));

jest.mock('@/lib/auditLogClient', () => ({
  emitApiKeyUsed: () => {},
  emitMutation: () => {},
  scopeFingerprint: () => 'fp',
}));

jest.mock('@/lib/securityBoundaryMetrics.server', () => ({
  emitSecurityBoundaryMetric: () => {},
}));

jest.mock('@/lib/logger', () => ({
  __esModule: true,
  default: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));

// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';
import { authorizedSiteHandler } from '@/lib/authorizedHandler.server';
import { requireSiteAuthAndScope } from '@/app/api/_shared';
import { Capability } from '@/lib/capabilities';

const SITE = 'site-a';
const ALICE = 'uid_alice';

/** A NextRequest good enough for both paths: headers + nextUrl.pathname. */
function makeRequest(): NextRequest {
  return {
    headers: new Headers(),
    nextUrl: { pathname: `/api/sites/${SITE}/thing`, searchParams: new URLSearchParams() },
    url: `https://example.test/api/sites/${SITE}/thing`,
    method: 'GET',
  } as unknown as NextRequest;
}

/** Wildcard-scoped api-key context — scope never answers the request. */
function wildcardKey() {
  return {
    keyId: 'key_test',
    environment: 'live',
    expiresAt: Date.now() + 60_000,
    isLegacy: false,
    scopes: [
      { resource: 'site', id: '*', permissions: ['read', 'write', 'deploy', 'rollback', 'admin'] },
    ],
  };
}

/** An api-key context holding only `read`, for the without-scope leg. */
function readOnlyKey() {
  return {
    keyId: 'key_readonly',
    environment: 'live',
    expiresAt: Date.now() + 60_000,
    isLegacy: false,
    scopes: [{ resource: 'site', id: '*', permissions: ['read'] }],
  };
}

// --- path A driver ----------------------------------------------------------

async function runPathA(
  siteId: string,
  opts: { capability?: Capability; apiKeyPermission?: 'read' | 'write' } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const route = authorizedSiteHandler({
    // MACHINE_VIEW is the read-class site-scoped capability EVERY role holds
    // (capabilities.ts MEMBER_CAPABILITIES), so it isolates the access decision
    // from the capability decision — which is what this matrix is measuring.
    capability: opts.capability ?? Capability.MACHINE_VIEW,
    siteIdParam: 'path',
    apiKeyPermission: opts.apiKeyPermission ?? 'read',
  })(async () => NextResponse.json({ ok: true }));

  const res = await route(makeRequest(), { params: Promise.resolve({ siteId }) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** Problem bodies carry a per-response requestId; drop it to compare shapes. */
function withoutRequestId(body: Record<string, unknown>): Record<string, unknown> {
  const { requestId: _requestId, ...rest } = body;
  return rest;
}

// --- path B driver ----------------------------------------------------------

async function runPathB(
  siteId: string,
  permission: 'read' | 'write' = 'read',
): Promise<{ status: number; body: Record<string, unknown> }> {
  const result = await requireSiteAuthAndScope(makeRequest(), siteId, permission);
  if (!result.ok) {
    return { status: result.response.status, body: await result.response.json().catch(() => ({})) };
  }
  return { status: 200, body: { ok: true } };
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  store.users.clear();
  store.sites.clear();
  reads.length = 0;
  resolveAuthThrows = null;
  resolveAuthResult = { userId: ALICE, keyContext: null };

  store.sites.set(SITE, { owner: ALICE, name: 'Site A' });
  store.users.set(ALICE, { role: 'admin', sites: [SITE] });
});

describe('authorization parity — shared behaviour (both paths must agree)', () => {
  it('allows an authenticated member of the site', async () => {
    expect((await runPathA(SITE)).status).toBe(200);
    expect((await runPathB(SITE)).status).toBe(200);
  });

  it('allows a superadmin who is not a member', async () => {
    store.users.set(ALICE, { role: 'superadmin', sites: [] });
    store.sites.set(SITE, { owner: 'someone_else' });

    expect((await runPathA(SITE)).status).toBe(200);
    expect((await runPathB(SITE)).status).toBe(200);
  });

  it('allows the site owner even when sites[] omits the site', async () => {
    store.users.set(ALICE, { role: 'member', sites: [] });
    store.sites.set(SITE, { owner: ALICE });

    expect((await runPathA(SITE)).status).toBe(200);
    expect((await runPathB(SITE)).status).toBe(200);
  });

  it('rejects an unauthenticated caller with 401', async () => {
    resolveAuthThrows = { status: 401, message: 'no session' };

    expect((await runPathA(SITE)).status).toBe(401);
    expect((await runPathB(SITE)).status).toBe(401);
  });

  it('collapses "site does not exist" into 404 without leaking existence', async () => {
    store.sites.delete(SITE);

    const a = await runPathA(SITE);
    const b = await runPathB(SITE);

    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    // Neither may distinguish "missing" from "forbidden" in the body.
    expect(String(b.body.detail)).toBe('site not found or no access');
  });

  it('collapses "member of no such site" into the SAME 404 as a missing site', async () => {
    store.users.set(ALICE, { role: 'member', sites: ['other-site'] });
    store.sites.set(SITE, { owner: 'someone_else' });

    const denied = await runPathB(SITE);
    store.sites.delete(SITE);
    const missing = await runPathB(SITE);

    // The anti-enumeration property: identical status AND identical body,
    // modulo the per-response requestId.
    expect(denied.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(withoutRequestId(denied.body)).toEqual(withoutRequestId(missing.body));
  });
});

describe('authorization parity — api-key scope', () => {
  it('allows an api-key holding the required permission', async () => {
    resolveAuthResult = { userId: ALICE, keyContext: wildcardKey() };

    expect((await runPathA(SITE)).status).toBe(200);
    expect((await runPathB(SITE)).status).toBe(200);
  });

  it('refuses an api-key missing the required permission with 403', async () => {
    resolveAuthResult = { userId: ALICE, keyContext: readOnlyKey() };

    const a = await runPathA(SITE, {
      capability: Capability.SITE_MEMBER_MANAGE,
      apiKeyPermission: 'write',
    });
    const b = await runPathB(SITE, 'write');

    expect(a.status).toBe(403);
    expect(b.status).toBe(403);
  });
});

describe('DIVERGENCE 1 — deleted user', () => {
  beforeEach(() => {
    store.users.set(ALICE, { role: 'admin', sites: [SITE], deletedAt: Date.now() });
  });

  it('path A (authorizedSiteHandler) answers 403 user_inactive', async () => {
    const a = await runPathA(SITE);
    expect(a.status).toBe(403);
    expect(String(a.body.detail ?? a.body.title)).toMatch(/deleted or inactive|forbidden/i);
  });

  it('path B (_shared) collapses the same state into 404', async () => {
    const b = await runPathB(SITE);
    expect(b.status).toBe(404);
    expect(String(b.body.detail)).toBe('site not found or no access');
  });

  it('the two paths disagree — this is the drift Wave 1 Task 1.3 removes', async () => {
    const a = await runPathA(SITE);
    const b = await runPathB(SITE);
    expect(a.status).not.toBe(b.status);
  });
});

describe('DIVERGENCE 2 — malformed siteId', () => {
  const MALFORMED = 'not a valid site id!';

  it('path B (_shared) validates the shape up front and answers 400', async () => {
    const b = await runPathB(MALFORMED);
    expect(b.status).toBe(400);
    expect(String(b.body.detail)).toBe('invalid siteId format');
  });

  it('path A (authorizedSiteHandler) has no shape check, so it 404s on the miss', async () => {
    const a = await runPathA(MALFORMED);
    expect(a.status).toBe(404);
  });

  it('the two paths disagree — this is the drift Wave 1 Task 1.3 removes', async () => {
    const a = await runPathA(MALFORMED);
    const b = await runPathB(MALFORMED);
    expect(a.status).not.toBe(b.status);
  });
});

describe('read cost — the Task 1.2 improvement, now pinned against regression', () => {
  it('path A reads users/{uid} ONCE (was twice before the decision core)', async () => {
    reads.length = 0;
    await runPathA(SITE);

    const userReads = reads.filter((p) => p === `users/${ALICE}`);
    // BEFORE Task 1.2 this was 2: assertUserHasSiteAccess read the user doc to
    // decide access, then loadUserActor read it again to build the actor.
    // resolveSiteAccess returns both from one getAll. If this goes back to 2,
    // someone has reintroduced a second read on the hot authorization path.
    expect(userReads.length).toBe(1);
  });

  it('path A reads the site document exactly once', async () => {
    reads.length = 0;
    await runPathA(SITE);

    expect(reads.filter((p) => p === `sites/${SITE}`).length).toBe(1);
  });

  it('path B reads users/{uid} once', async () => {
    reads.length = 0;
    await runPathB(SITE);

    expect(reads.filter((p) => p === `users/${ALICE}`).length).toBe(1);
  });
});
