import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';

// Lazy initialization to avoid build-time errors when env var is missing
let resend: Resend | null = null;
function getResend() {
  if (!resend && process.env.RESEND_API_KEY) {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

// Environment detection
const isProduction = process.env.NODE_ENV === 'production' &&
                     !process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.includes('dev');

const ADMIN_EMAIL = isProduction
  ? process.env.ADMIN_EMAIL_PROD
  : process.env.ADMIN_EMAIL_DEV;

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

interface UserCreatedPayload {
  email: string;
  displayName: string;
  authMethod: 'email' | 'google';
  createdAt: string;
}

export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const payload: UserCreatedPayload = await request.json();

    // Validate required fields
    if (!payload.email || !payload.displayName || !payload.authMethod) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Check if Resend is configured
    if (!process.env.RESEND_API_KEY) {
      console.error('RESEND_API_KEY not configured');
      return NextResponse.json(
        { error: 'Email service not configured' },
        { status: 500 }
      );
    }

    if (!ADMIN_EMAIL) {
      console.error('ADMIN_EMAIL not configured for current environment');
      return NextResponse.json(
        { error: 'Admin email not configured' },
        { status: 500 }
      );
    }

    const envLabel = isProduction ? 'PRODUCTION' : 'DEVELOPMENT';

    const resendClient = getResend();
    if (!resendClient) {
      console.error('Resend client not available');
      return NextResponse.json(
        { error: 'Email service not available' },
        { status: 500 }
      );
    }

    // Send admin notification email
    const adminEmailResult = await resendClient.emails.send({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject: `[${envLabel}] New Owlette User Signup`,
      html: `
        <h2>New User Registration</h2>
        <p>A new user has signed up on Owlette ${envLabel}.</p>
        <ul>
          <li><strong>Name:</strong> ${payload.displayName}</li>
          <li><strong>Email:</strong> ${payload.email}</li>
          <li><strong>Sign-in Method:</strong> ${payload.authMethod === 'google' ? 'Google OAuth' : 'Email/Password'}</li>
          <li><strong>Registered At:</strong> ${new Date(payload.createdAt).toLocaleString()}</li>
          <li><strong>Environment:</strong> ${envLabel}</li>
        </ul>
        <hr>
        <p style="color: #666; font-size: 12px;">
          This is an automated notification from Owlette.
        </p>
      `,
    });

    // Optionally send welcome email to user
    let welcomeEmailResult = null;
    if (process.env.SEND_WELCOME_EMAIL === 'true') {
      welcomeEmailResult = await resendClient.emails.send({
        from: FROM_EMAIL,
        to: payload.email,
        subject: 'Welcome to Owlette',
        html: `
          <h2>Welcome to Owlette!</h2>
          <p>Hi ${payload.displayName},</p>
          <p>Thank you for signing up for Owlette. We're excited to have you on board!</p>
          <p>Owlette is your cloud-connected process management system for managing Windows machines remotely.</p>
          <h3>Getting Started</h3>
          <ol>
            <li>Create your first site in the dashboard</li>
            <li>Download and install the Owlette agent on your Windows machines</li>
            <li>Configure processes to monitor</li>
            <li>Start managing your machines remotely!</li>
          </ol>
          <p>If you have any questions, feel free to reach out to our support team.</p>
          <p>Happy monitoring!</p>
          <hr>
          <p style="color: #666; font-size: 12px;">
            Owlette - Always Watching
          </p>
        `,
      });
    }

    return NextResponse.json({
      success: true,
      adminEmailSent: !!adminEmailResult.data,
      welcomeEmailSent: !!welcomeEmailResult?.data,
      environment: envLabel,
    });

  } catch (error) {
    console.error('Error sending user creation notification:', error);
    return NextResponse.json(
      {
        error: 'Failed to send notification',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
