import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/**
 * POST /api/setup/generate-token
 *
 * Generates a secure token for agent authorization.
 * This token is used to authenticate the agent during the installer OAuth flow.
 *
 * Request body:
 * - siteId: string - The site ID the agent will be associated with
 * - userId: string - The user ID authorizing this agent
 *
 * Response:
 * - token: string - A secure token to pass to the agent
 */
export async function POST(request: NextRequest) {
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

    // Generate a secure random token
    // Using crypto API available in Node.js runtime
    const crypto = await import('crypto');
    const tokenBytes = crypto.randomBytes(32);
    const token = tokenBytes.toString('base64url'); // URL-safe base64

    // In a production environment, you might want to:
    // 1. Store this token in Firestore with an expiration time
    // 2. Associate it with the siteId and userId
    // 3. Validate it when the agent connects
    //
    // For now, we're using a simple token generation approach.
    // The agent will use this token as proof of authorization.
    //
    // Future enhancement: Create an agent_tokens collection in Firestore:
    // {
    //   token: string,
    //   siteId: string,
    //   userId: string,
    //   createdAt: timestamp,
    //   expiresAt: timestamp,
    //   used: boolean
    // }

    return NextResponse.json(
      {
        token,
        siteId,
        userId,
      },
      { status: 200 }
    );

  } catch (error: any) {
    console.error('Error generating token:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
