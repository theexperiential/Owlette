import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { adminDb } from '@/lib/firebase-admin';

/**
 * POST /api/admin/tokens/revoke
 *
 * Revoke agent refresh tokens. Supports revoking:
 * - A single token (by tokenId - the document hash)
 * - All tokens for a machine (by machineId + siteId)
 * - All tokens for a site (by siteId + all: true)
 *
 * Request body:
 * - siteId: string - The site ID (required)
 * - tokenId?: string - The specific token document ID to revoke (preferred for single token)
 * - machineId?: string - The machine ID to revoke all tokens for (optional)
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
    const { siteId, tokenId, machineId, all } = body;

    if (!siteId) {
      return NextResponse.json(
        { error: 'Missing required field: siteId' },
        { status: 400 }
      );
    }

    if (!tokenId && !machineId && !all) {
      return NextResponse.json(
        { error: 'Must specify tokenId, machineId, or all: true' },
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
    } else if (tokenId) {
      // Revoke specific token by document ID (most precise)
      const tokenRef = db.collection('agent_refresh_tokens').doc(tokenId);
      const tokenDoc = await tokenRef.get();

      if (!tokenDoc.exists) {
        return NextResponse.json({
          success: false,
          revokedCount: 0,
          message: 'Token not found',
        });
      }

      // Verify token belongs to the specified site
      const tokenData = tokenDoc.data();
      if (tokenData?.siteId !== siteId) {
        return NextResponse.json(
          { error: 'Token does not belong to this site' },
          { status: 403 }
        );
      }

      await tokenRef.delete();
      revokedCount = 1;

      console.log(`Revoked token ${tokenId} for site ${siteId}`);

      return NextResponse.json({
        success: true,
        revokedCount,
        message: `Revoked token for machine ${tokenData?.machineId || 'unknown'}`,
      });
    } else {
      // Revoke all tokens for a specific machine
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
          ? `Revoked ${revokedCount} token(s) for machine ${machineId}`
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
