import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { cookies } from 'next/headers';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * POST /api/agent/generate-installer
 *
 * Generate a registration code for creating a new installer.
 * This endpoint is called by authenticated users from the web dashboard
 * when they want to add a new machine to their site.
 *
 * Request body:
 * - siteId: string - Site ID to associate the agent with
 * - userId: string - User ID requesting the installer
 *
 * Response (200 OK):
 * - registrationCode: string - Single-use code to embed in installer
 * - expiresAt: string - ISO 8601 timestamp when code expires (24 hours)
 * - siteId: string - Site ID this code is for
 *
 * Errors:
 * - 400: Missing required fields
 * - 401: Unauthorized (no valid session)
 * - 403: Forbidden (user doesn't have access to site)
 * - 500: Server error
 */
export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const body = await request.json();
    const { siteId, userId } = body;

    if (!siteId || !userId) {
      return NextResponse.json(
        { error: 'Missing required fields: siteId, userId' },
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

    // Verify user has access to the site
    // Check if user is listed as owner/member of the site
    const adminDb = getAdminDb();
    const siteRef = adminDb.collection('sites').doc(siteId);
    const siteDoc = await siteRef.get();

    if (!siteDoc.exists) {
      return NextResponse.json(
        { error: 'Site not found' },
        { status: 404 }
      );
    }

    const siteData = siteDoc.data();
    const isOwner = siteData?.owners?.[userId] === true;
    const isMember = siteData?.members?.includes(userId);

    if (!isOwner && !isMember) {
      console.warn(
        `User ${userId} attempted to generate installer for site ${siteId} without permission`
      );

      return NextResponse.json(
        { error: 'Forbidden: You do not have access to this site' },
        { status: 403 }
      );
    }

    // Generate cryptographically secure registration code
    const crypto = await import('crypto');
    const registrationCode = crypto.randomBytes(32).toString('base64url');

    // Calculate expiration (24 hours from now)
    const now = Date.now();
    const expiresAt = new Date(now + 24 * 60 * 60 * 1000);

    // Store registration code in Firestore
    await adminDb.collection('agent_tokens').doc(registrationCode).set({
      siteId,
      createdBy: userId,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt,
      used: false,
      status: 'pending',
    });

    // Log registration code generation (for auditing)
    console.log(
      `Registration code generated: site=${siteId}, user=${userId}, ` +
      `expires=${expiresAt.toISOString()}`
    );

    return NextResponse.json(
      {
        registrationCode,
        expiresAt: expiresAt.toISOString(),
        siteId,
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
}
