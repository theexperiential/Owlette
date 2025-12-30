import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { adminDb } from '@/lib/firebase-admin';

/**
 * GET /api/admin/tokens/list
 *
 * List all agent refresh tokens for a site.
 *
 * Query params:
 * - siteId: string - The site ID (required)
 *
 * Response:
 * - tokens: Array of token info (machineId, createdAt, lastUsed, version)
 *
 * Errors:
 * - 400: Missing required fields
 * - 401: Unauthorized
 * - 500: Server error
 */
export async function GET(request: NextRequest) {
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

    // Get siteId from query params
    const { searchParams } = new URL(request.url);
    const siteId = searchParams.get('siteId');

    if (!siteId) {
      return NextResponse.json(
        { error: 'Missing required parameter: siteId' },
        { status: 400 }
      );
    }

    const db = adminDb.value;

    // Get all tokens for the site
    // Note: We avoid using orderBy to prevent needing a composite index
    const tokensSnapshot = await db.collection('agent_refresh_tokens')
      .where('siteId', '==', siteId)
      .get();

    const tokens = tokensSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id, // hashed token (for revocation reference)
        machineId: data.machineId,
        version: data.version,
        createdBy: data.createdBy,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
        lastUsed: data.lastUsed?.toDate?.()?.toISOString() || null,
        expiresAt: data.expiresAt?.toDate?.()?.toISOString() || null, // null = never expires
        agentUid: data.agentUid,
      };
    });

    // Sort by createdAt descending (newest first) in memory
    tokens.sort((a, b) => {
      if (!a.createdAt) return 1;
      if (!b.createdAt) return -1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return NextResponse.json({
      tokens,
      count: tokens.length,
    });

  } catch (error: any) {
    console.error('Error listing tokens:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
