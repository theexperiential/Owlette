import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { adminDb } from '@/lib/firebase-admin';

/**
 * POST /api/admin/tokens/revoke
 *
 * Revoke agent refresh tokens. Supports revoking:
 * - A single machine's token (by machineId + siteId)
 * - All tokens for a site (by siteId + all: true)
 *
 * Request body:
 * - siteId: string - The site ID (required)
 * - machineId?: string - The machine ID to revoke (optional)
 * - all?: boolean - If true, revoke all tokens for the site (optional)
 *
 * Response:
 * - success: boolean
 * - revokedCount: number - Number of tokens revoked
 * - message: string
 *
 * Errors:
 * - 400: Missing required fields
 * - 401: Unauthorized
 * - 500: Server error
 */
export async function POST(request: NextRequest) {
  try {
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

    // Parse request body
    const body = await request.json();
    const { siteId, machineId, all } = body;

    if (!siteId) {
      return NextResponse.json(
        { error: 'Missing required field: siteId' },
        { status: 400 }
      );
    }

    if (!machineId && !all) {
      return NextResponse.json(
        { error: 'Must specify either machineId or all: true' },
        { status: 400 }
      );
    }

    const db = adminDb.value;
    let revokedCount = 0;

    if (all) {
      // Revoke all tokens for the site
      const tokensSnapshot = await db.collection('agent_refresh_tokens')
        .where('siteId', '==', siteId)
        .get();

      const batch = db.batch();
      tokensSnapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
        revokedCount++;
      });

      if (revokedCount > 0) {
        await batch.commit();
      }

      console.log(`Revoked ${revokedCount} tokens for site ${siteId}`);

      return NextResponse.json({
        success: true,
        revokedCount,
        message: `Revoked all ${revokedCount} tokens for site ${siteId}`,
      });
    } else {
      // Revoke specific machine's token
      const tokensSnapshot = await db.collection('agent_refresh_tokens')
        .where('siteId', '==', siteId)
        .where('machineId', '==', machineId)
        .get();

      const batch = db.batch();
      tokensSnapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
        revokedCount++;
      });

      if (revokedCount > 0) {
        await batch.commit();
      }

      console.log(`Revoked ${revokedCount} tokens for machine ${machineId} in site ${siteId}`);

      return NextResponse.json({
        success: true,
        revokedCount,
        message: revokedCount > 0
          ? `Revoked token for machine ${machineId}`
          : `No tokens found for machine ${machineId}`,
      });
    }

  } catch (error: any) {
    console.error('Error revoking tokens:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
