import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import admin from '@/lib/firebase-admin';

/**
 * POST /api/agent/auth/refresh
 *
 * Refresh an expired access token using a refresh token.
 * Custom tokens expire after 1 hour, so agents must refresh periodically.
 *
 * Request body:
 * - refreshToken: string - Long-lived refresh token from initial exchange
 * - machineId: string - Machine identifier (for validation)
 *
 * Response (200 OK):
 * - accessToken: string - New OAuth 2.0 access token for Firestore API (1 hour expiry)
 * - expiresIn: number - Access token expiry in seconds (3600)
 *
 * Errors:
 * - 400: Missing required fields
 * - 401: Invalid or expired refresh token
 * - 403: Machine ID mismatch (security check)
 * - 500: Server error
 */
export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const body = await request.json();
    const { refreshToken, machineId } = body;

    if (!refreshToken || !machineId) {
      return NextResponse.json(
        { error: 'Missing required fields: refreshToken, machineId' },
        { status: 400 }
      );
    }

    // Hash the refresh token (stored hashed for security)
    const crypto = await import('crypto');
    const refreshTokenHash = crypto.createHash('sha256')
      .update(refreshToken)
      .digest('hex');

    // Validate refresh token in Firestore
    const adminDb = getAdminDb();
    const tokenRef = adminDb.collection('agent_refresh_tokens').doc(refreshTokenHash);
    const tokenDoc = await tokenRef.get();

    if (!tokenDoc.exists) {
      return NextResponse.json(
        { error: 'Invalid refresh token' },
        { status: 401 }
      );
    }

    const tokenData = tokenDoc.data();

    // Check if refresh token has expired (30 days)
    const now = Date.now();
    const expiresAt = tokenData?.expiresAt?.toMillis();

    if (!expiresAt || expiresAt < now) {
      // Clean up expired token
      await tokenRef.delete();

      return NextResponse.json(
        { error: 'Refresh token expired. Please re-authenticate.' },
        { status: 401 }
      );
    }

    // Verify machine ID matches (prevent token theft)
    if (tokenData?.machineId !== machineId) {
      // Log potential security issue
      console.warn(
        `Machine ID mismatch for refresh token: ` +
        `expected=${tokenData?.machineId}, got=${machineId}`
      );

      return NextResponse.json(
        { error: 'Machine ID mismatch. Token may be compromised.' },
        { status: 403 }
      );
    }

    const siteId = tokenData?.siteId as string;
    const version = tokenData?.version as string;
    const agentUid = tokenData?.agentUid as string;

    if (!siteId || !version || !agentUid) {
      return NextResponse.json(
        { error: 'Invalid refresh token data' },
        { status: 401 }
      );
    }

    // Generate new Firebase Custom Token for agent
    const adminAuth = getAdminAuth();
    const customToken = await adminAuth.createCustomToken(agentUid, {
      role: 'agent',
      site_id: siteId,
      machine_id: machineId,
      version,
    });

    // Exchange custom token for ID token (required for Firestore REST API)
    // This uses Firebase Auth REST API to convert the custom token
    const firebaseApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    if (!firebaseApiKey) {
      throw new Error('Firebase API key not configured');
    }

    const authResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${firebaseApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: customToken, returnSecureToken: true }),
      }
    );

    if (!authResponse.ok) {
      const errorData = await authResponse.json();
      throw new Error(`Failed to exchange custom token: ${errorData.error?.message || 'Unknown error'}`);
    }

    const authData = await authResponse.json();
    const idToken = authData.idToken;

    // Update last used timestamp (for monitoring)
    await tokenRef.update({
      lastUsed: FieldValue.serverTimestamp(),
    });

    // Log successful refresh (for monitoring)
    console.log(`Token refreshed: site=${siteId}, machine=${machineId}`);

    return NextResponse.json(
      {
        accessToken: idToken,
        expiresIn: 3600, // 1 hour in seconds
      },
      { status: 200 }
    );

  } catch (error: any) {
    console.error('Error refreshing token:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
