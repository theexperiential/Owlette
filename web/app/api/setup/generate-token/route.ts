import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { adminDb } from '@/lib/firebase-admin';
import { withRateLimit } from '@/lib/withRateLimit';

/**
 * POST /api/setup/generate-token
 *
 * Generates a registration code for agent OAuth authentication.
 * Saves the code to Firestore for validation during token exchange.
 *
 * Request body:
 * - siteId: string - The site ID the agent will be associated with
 * - userId: string - The user ID authorizing this agent
 *
 * Response:
 * - token: string - Registration code to pass to the agent (24h expiry)
 */
export const POST = withRateLimit(async (request: NextRequest) => {
  try {
    // Parse request body
    const body = await request.json();
    const { siteId, userId } = body;

    if (!siteId || !userId) {
      return NextResponse.json(
        { error: 'Missing required fields: siteId and userId' },
        { status: 400 }
      );
    }

    // Verify user is authenticated by checking session cookie
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('__session');
    const authCookie = cookieStore.get('auth');

    if (!sessionCookie && !authCookie) {
      return NextResponse.json(
        { error: 'Unauthorized: No session found' },
        { status: 401 }
      );
    }

    // Generate a secure registration code (URL-safe)
    const crypto = await import('crypto');
    const codeBytes = crypto.randomBytes(32);
    const registrationCode = codeBytes.toString('base64url');

    // Save registration code to Firestore
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // 24 hour expiry

    await adminDb.value.collection('agent_tokens').doc(registrationCode).set({
      siteId,
      createdBy: userId,
      createdAt: new Date(),
      expiresAt,
      used: false,
    });

    console.log(`Generated registration code for site ${siteId} by user ${userId}`);

    return NextResponse.json(
      {
        token: registrationCode, // "token" field for backward compatibility with setup page
        siteId,
        userId,
      },
      { status: 200 }
    );

  } catch (error: any) {
    console.error('Error generating registration code:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}, {
  strategy: 'user',
  identifier: 'ip',
});
