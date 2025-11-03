import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import admin from '@/lib/firebase-admin';

/**
 * POST /api/agent/auth/exchange
 *
 * Exchange a registration code for authentication tokens.
 * This is the first step in the agent OAuth flow - the registration code
 * is embedded in the installer and exchanged for a custom token + refresh token.
 *
 * Request body:
 * - registrationCode: string - One-time registration code from installer
 * - machineId: string - Unique machine identifier (hostname)
 * - version: string - Agent version (e.g., "2.0.0")
 *
 * Response (200 OK):
 * - accessToken: string - OAuth 2.0 access token for Firestore API (1 hour expiry)
 * - refreshToken: string - Long-lived refresh token (30 days expiry)
 * - expiresIn: number - Access token expiry in seconds (3600)
 * - siteId: string - Site ID this agent is authorized for
 *
 * Errors:
 * - 400: Missing required fields
 * - 401: Invalid or expired registration code
 * - 500: Server error
 */
export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const body = await request.json();
    const { registrationCode, machineId, version } = body;

    if (!registrationCode || !machineId || !version) {
      return NextResponse.json(
        { error: 'Missing required fields: registrationCode, machineId, version' },
        { status: 400 }
      );
    }

    // Validate registration code in Firestore
    const adminDb = getAdminDb();
    const tokenRef = adminDb.collection('agent_tokens').doc(registrationCode);
    const tokenDoc = await tokenRef.get();

    if (!tokenDoc.exists) {
      return NextResponse.json(
        { error: 'Invalid registration code' },
        { status: 401 }
      );
    }

    const tokenData = tokenDoc.data();

    // Check if code has already been used
    if (tokenData?.used) {
      return NextResponse.json(
        { error: 'Registration code already used' },
        { status: 401 }
      );
    }

    // Check if code has expired (24 hours from creation)
    const now = Date.now();
    const expiresAt = tokenData?.expiresAt?.toMillis();

    if (!expiresAt || expiresAt < now) {
      return NextResponse.json(
        { error: 'Registration code expired' },
        { status: 401 }
      );
    }

    const siteId = tokenData?.siteId as string;
    const createdBy = tokenData?.createdBy as string;

    if (!siteId || !createdBy) {
      return NextResponse.json(
        { error: 'Invalid registration code data' },
        { status: 401 }
      );
    }

    // Generate unique agent user ID
    const agentUid = `agent_${siteId}_${machineId}`.replace(/[^a-zA-Z0-9_]/g, '_');

    // Generate OAuth 2.0 access token for Firestore REST API
    // This uses the service account credentials to create a valid access token
    const credential = admin.app().options.credential;
    if (!credential) {
      throw new Error('No service account credential available');
    }

    const accessTokenData = await credential.getAccessToken();
    const accessToken = accessTokenData.access_token;

    // Generate refresh token (cryptographically secure random)
    const crypto = await import('crypto');
    const refreshToken = crypto.randomBytes(64).toString('base64url');

    // Hash refresh token for storage (prevent theft if DB compromised)
    const refreshTokenHash = crypto.createHash('sha256')
      .update(refreshToken)
      .digest('hex');

    // Store refresh token in Firestore
    await adminDb.collection('agent_refresh_tokens').doc(refreshTokenHash).set({
      siteId,
      machineId,
      version,
      createdBy,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      lastUsed: FieldValue.serverTimestamp(),
      agentUid,
    });

    // Mark registration code as used
    await tokenRef.update({
      used: true,
      usedAt: FieldValue.serverTimestamp(),
      machineId,
      agentUid,
    });

    // Log successful token exchange (for auditing)
    console.log(`Agent token exchanged: site=${siteId}, machine=${machineId}, uid=${agentUid}`);

    return NextResponse.json(
      {
        accessToken,
        refreshToken,
        expiresIn: 3600, // 1 hour in seconds
        siteId,
      },
      { status: 200 }
    );

  } catch (error: any) {
    console.error('Error exchanging registration code:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
