/**
 * MFA Setup API
 *
 * Generates TOTP secret and QR code for 2FA setup
 * The secret is temporarily stored server-side until verification
 *
 * POST /api/mfa/setup
 * Request: { userId: string, email: string }
 * Response: { secret: string, qrCodeUrl: string }
 *
 * SECURITY: The secret returned here is for display only.
 * The actual storage happens in /api/mfa/verify-setup after verification.
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateTOTPSecret, generateQRCode } from '@/lib/totp';
import { getAdminDb } from '@/lib/firebase-admin';
import { withRateLimit } from '@/lib/withRateLimit';

export const POST = withRateLimit(async (request: NextRequest) => {
  try {
    const body = await request.json();
    const { userId, email } = body;

    // Validate inputs
    if (!userId || typeof userId !== 'string') {
      return NextResponse.json(
        { error: 'Invalid user ID' },
        { status: 400 }
      );
    }

    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { error: 'Invalid email' },
        { status: 400 }
      );
    }

    // Generate TOTP secret
    const secret = generateTOTPSecret();

    // Generate QR code
    const qrCodeUrl = await generateQRCode(email, secret);

    // Store pending setup in Firestore (temporary, expires in 10 minutes)
    const db = getAdminDb();
    await db.collection('mfa_pending').doc(userId).set({
      secret,
      email,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    });

    return NextResponse.json({
      secret,
      qrCodeUrl,
    });
  } catch (error) {
    console.error('[MFA Setup] Error:', error);
    return NextResponse.json(
      { error: 'Failed to generate MFA setup' },
      { status: 500 }
    );
  }
}, {
  strategy: 'auth',
  identifier: 'ip',
});
