/**
 * Session Management API
 *
 * Handles server-side session creation and destruction with HTTPOnly cookies
 *
 * Routes:
 * - POST /api/auth/session - Create new session (called after Firebase auth)
 * - DELETE /api/auth/session - Destroy session (sign out)
 * - GET /api/auth/session - Get session status (debugging/validation)
 *
 * SECURITY: Rate limited to prevent session creation spam (10 requests/min per IP)
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  createSession,
  destroySession,
  getSessionData,
} from '@/lib/sessionManager.server';
import { withRateLimit } from '@/lib/withRateLimit';

/**
 * POST /api/auth/session
 * Create a new session after successful Firebase authentication
 *
 * Request Body:
 * {
 *   "userId": "firebase-user-id",
 *   "durationDays": 7 (optional)
 * }
 *
 * Rate Limited: 10 requests per minute per IP
 */
export const POST = withRateLimit(async (request: NextRequest) => {
  try {
    const body = await request.json();
    const { userId, durationDays = 7 } = body;

    // Validate userId
    if (!userId || typeof userId !== 'string') {
      return NextResponse.json(
        { error: 'Invalid user ID' },
        { status: 400 }
      );
    }

    // Validate durationDays
    if (durationDays && (typeof durationDays !== 'number' || durationDays < 1 || durationDays > 30)) {
      return NextResponse.json(
        { error: 'Invalid duration (must be 1-30 days)' },
        { status: 400 }
      );
    }

    // Create session
    await createSession(userId, durationDays);

    return NextResponse.json({
      success: true,
      message: 'Session created',
      expiresIn: durationDays * 24 * 60 * 60, // seconds
    });
  } catch (error) {
    console.error('[Session API] Failed to create session:', error);
    return NextResponse.json(
      { error: 'Failed to create session' },
      { status: 500 }
    );
  }
}, {
  strategy: 'auth',
  identifier: 'ip',
});

/**
 * DELETE /api/auth/session
 * Destroy the current session (sign out)
 */
export async function DELETE() {
  try {
    await destroySession();

    return NextResponse.json({
      success: true,
      message: 'Session destroyed',
    });
  } catch (error) {
    console.error('[Session API] Failed to destroy session:', error);
    return NextResponse.json(
      { error: 'Failed to destroy session' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/auth/session
 * Get current session status (for debugging/validation)
 *
 * Returns:
 * {
 *   "authenticated": boolean,
 *   "userId": string | null,
 *   "expiresAt": number | null
 * }
 */
export async function GET() {
  try {
    const sessionData = await getSessionData();

    if (!sessionData) {
      return NextResponse.json({
        authenticated: false,
        userId: null,
        expiresAt: null,
      });
    }

    return NextResponse.json({
      authenticated: true,
      userId: sessionData.userId,
      expiresAt: sessionData.expiresAt,
      expiresIn: Math.max(0, Math.floor((sessionData.expiresAt - Date.now()) / 1000)), // seconds
    });
  } catch (error) {
    console.error('[Session API] Failed to get session:', error);
    return NextResponse.json(
      { error: 'Failed to get session' },
      { status: 500 }
    );
  }
}
