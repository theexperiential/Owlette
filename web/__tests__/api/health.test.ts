/** @jest-environment node */

const mockGet = jest.fn();
const mockGetAdminDb = jest.fn();

const mockDb = {
  collection: jest.fn(() => ({
    doc: jest.fn(() => ({ get: mockGet })),
  })),
};

jest.mock('@/lib/firebase-admin', () => ({
  getAdminDb: (...args: unknown[]) => mockGetAdminDb(...args),
}));

import { GET } from '@/app/api/health/route';

describe('GET /api/health', () => {
  const ENV_KEYS = [
    'RAILWAY_PUBLIC_DOMAIN',
    'RAILWAY_GIT_COMMIT_SHA',
    'VERCEL',
    'VERCEL_REGION',
    'VERCEL_GIT_COMMIT_SHA',
  ] as const;
  const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAdminDb.mockReturnValue(mockDb);
    mockGet.mockResolvedValue({ exists: true });
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterAll(() => {
    // Assigning undefined to process.env stores the string "undefined" — delete instead.
    for (const key of ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('returns 200 and ok:true when firestore is reachable', async () => {
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.latency_ms).toBe('number');
    expect(typeof body.checked_at).toBe('string');
    expect(res.headers.get('Cache-Control')).toBe('no-store, max-age=0');
  });

  it('returns 200 even when the heartbeat doc does not exist (read still succeeds)', async () => {
    mockGet.mockResolvedValueOnce({ exists: false });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('returns 503 and ok:false when the firestore read rejects', async () => {
    mockGet.mockRejectedValueOnce(new Error('permission denied'));

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.ok).toBe(false);
  });

  it('returns 503 when the admin sdk is not initialized', async () => {
    mockGetAdminDb.mockImplementationOnce(() => {
      throw new Error('Firebase Admin SDK not initialized. Check environment variables.');
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.ok).toBe(false);
  });

  it('returns 503 when the firestore read exceeds the timeout', async () => {
    jest.useFakeTimers();
    mockGet.mockReturnValueOnce(new Promise(() => {})); // never resolves

    const resPromise = GET();
    await jest.advanceTimersByTimeAsync(2_500);
    const res = await resPromise;
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.ok).toBe(false);
    jest.useRealTimers();
  });

  it('labels the origin as railway when RAILWAY_PUBLIC_DOMAIN is set', async () => {
    process.env.RAILWAY_PUBLIC_DOMAIN = 'owlette.up.railway.app';

    const res = await GET();
    const body = await res.json();

    expect(body.origin).toBe('railway');
  });

  it('labels the origin as vercel with region when running on vercel', async () => {
    process.env.VERCEL = '1';
    process.env.VERCEL_REGION = 'iad1';

    const res = await GET();
    const body = await res.json();

    expect(body.origin).toBe('vercel:iad1');
  });

  it('labels the origin as unknown when neither provider env is present', async () => {
    const res = await GET();
    const body = await res.json();

    expect(body.origin).toBe('unknown');
  });

  it('reports the deployed commit from RAILWAY_GIT_COMMIT_SHA on railway', async () => {
    process.env.RAILWAY_PUBLIC_DOMAIN = 'owlette.up.railway.app';
    process.env.RAILWAY_GIT_COMMIT_SHA = '5335ca477c0c83376e55fe752e702c3508578f61';

    const res = await GET();
    const body = await res.json();

    expect(body.commit).toBe('5335ca477c0c83376e55fe752e702c3508578f61');
  });

  it('reports the deployed commit from VERCEL_GIT_COMMIT_SHA on vercel', async () => {
    process.env.VERCEL = '1';
    process.env.VERCEL_GIT_COMMIT_SHA = '0c684d67a1b2c3d4e5f60718293a4b5c6d7e8f90';

    const res = await GET();
    const body = await res.json();

    expect(body.commit).toBe('0c684d67a1b2c3d4e5f60718293a4b5c6d7e8f90');
  });

  it('reports commit: null when no platform injected a commit sha', async () => {
    const res = await GET();
    const body = await res.json();

    expect(body).toHaveProperty('commit', null);
  });

  it('treats an empty commit sha as absent rather than reporting ""', async () => {
    process.env.RAILWAY_GIT_COMMIT_SHA = '';
    process.env.VERCEL_GIT_COMMIT_SHA = '';

    const res = await GET();
    const body = await res.json();

    expect(body).toHaveProperty('commit', null);
  });
});
