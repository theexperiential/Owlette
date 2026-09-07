import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { ApiAuthError, assertUserHasSiteCapability, requireSession } from '@/lib/apiAuth.server';
import { Capability } from '@/lib/capabilities';
import { apiError } from '@/lib/apiErrorResponse';
import { emitMutation } from '@/lib/auditLogClient';
import logger from '@/lib/logger';

/**
 * POST /api/agent/generate-installer
 *
 * Mint a single-use registration code to embed in an installer, for an authenticated
 * dashboard user adding a machine to their site.
 *
 * Body: { siteId, userId (deprecated — derived from session) }
 * 200:  { registrationCode, expiresAt (ISO 8601, +24h), siteId }
 * Errors: 400 missing fields / 401 no session / 403 no site access / 500.
 *
 * Audits `site_mutated` / `agent_token.issue`. The `agent_tokens` doc id IS the
 * registration code, so the row targets the site and records only the expiry —
 * never the code itself (same rule as `agent-tokens/revoke`).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { siteId } = body;

    if (!siteId) {
      return NextResponse.json(
        { error: 'Missing required field: siteId' },
        { status: 400 }
      );
    }

    const userId = await requireSession(request);

    // Verify user has access to the site
    // MACHINE_ENROLL, not bare membership: issuing a pre-seeded installer mints an agent
    // identity plus a refresh token that never expires, and revoking one is
    // site-admin (AGENT_TOKEN_REVOKE). Issue and revoke have to sit at the same
    // bar, or a read-only member can create credentials it cannot take back.
    await assertUserHasSiteCapability(userId, siteId, Capability.MACHINE_ENROLL);

    // Generate cryptographically secure registration code
    const crypto = await import('crypto');
    const registrationCode = crypto.randomBytes(32).toString('base64url');

    const now = Date.now();
    const expiresAt = new Date(now + 24 * 60 * 60 * 1000);

    const adminDb = getAdminDb();
    await adminDb.collection('agent_tokens').doc(registrationCode).set({
      siteId,
      createdBy: userId,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt,
      used: false,
      status: 'pending',
    });

    logger.info(`Registration code generated: site=${siteId}, user=${userId}, expires=${expiresAt.toISOString()}`);

    emitMutation({
      kind: 'site_mutated',
      siteId,
      actor: `user:${userId}`,
      targetId: siteId,
      attributes: {
        verb: 'agent_token.issue',
        endpoint: '/api/agent/generate-installer',
        method: 'POST',
        siteId,
        expiresAt: expiresAt.toISOString(),
      },
    });

    return NextResponse.json(
      {
        registrationCode,
        expiresAt: expiresAt.toISOString(),
        siteId,
      },
      { status: 200 }
    );

  } catch (error: unknown) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return apiError(error, 'agent/generate-installer');
  }
}
