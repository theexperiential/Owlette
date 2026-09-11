/**
 * GET /api/health — cloudflare LB readiness probe. Unauthenticated; 200 only
 * if this origin can also reach firestore, else 503 so the LB drops it.
 *
 * Readiness, not liveness: an origin that's up but has lost egress to google
 * cloud passes a process ping. One shallow read with a hard timeout — the full
 * status-page suite (`/api/cron/status-ping`) is too slow and would flap the LB.
 */
import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

const FIRESTORE_TIMEOUT_MS = 2_500;

/** Which origin answered — debugging aid behind the LB. */
function originLabel(): string {
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return 'railway';
  if (process.env.VERCEL) return `vercel${process.env.VERCEL_REGION ? `:${process.env.VERCEL_REGION}` : ''}`;
  return 'unknown';
}

/**
 * Git SHA this origin was deployed from, or null when the platform injected
 * none — Railway sets RAILWAY_GIT_COMMIT_SHA only for GitHub-triggered
 * deploys; Vercel sets VERCEL_GIT_COMMIT_SHA when system env vars are exposed.
 * Not secret (public repo). The live dev smoke runner polls this to confirm
 * dev is serving the commit it is about to test. An empty value counts as
 * absent so callers only ever see a SHA or null.
 */
function deployedCommit(): string | null {
  return process.env.RAILWAY_GIT_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || null;
}

async function firestoreReachable(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('firestore read timed out')), FIRESTORE_TIMEOUT_MS);
  });

  try {
    // Success proves connectivity + credentials; doc existence is irrelevant.
    await Promise.race([
      getAdminDb().collection('system_status').doc('heartbeat').get(),
      timeout,
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function GET() {
  const started = Date.now();
  const ok = await firestoreReachable();

  return NextResponse.json(
    {
      ok,
      origin: originLabel(),
      commit: deployedCommit(),
      checked_at: new Date().toISOString(),
      latency_ms: Date.now() - started,
    },
    {
      status: ok ? 200 : 503,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    },
  );
}
