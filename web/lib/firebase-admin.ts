/**
 * Firebase Admin SDK Configuration
 *
 * This is the server-side Firebase Admin SDK configuration for token generation
 * and other privileged operations. NEVER exposed to client-side code.
 *
 * SECURITY: This file should ONLY be imported in API routes (server-side).
 * The service account credentials are stored as environment variables and
 * are never sent to the client.
 *
 * Environment variables required:
 * - FIREBASE_PROJECT_ID: Firebase project ID
 * - FIREBASE_CLIENT_EMAIL: Service account email
 * - FIREBASE_PRIVATE_KEY: Service account private key (with \n escape sequences)
 */

import admin from 'firebase-admin';

/**
 * Initialize Firebase Admin SDK (singleton pattern)
 *
 * The Admin SDK provides elevated privileges for:
 * - Creating custom tokens for agent authentication
 * - Server-side Firestore operations
 * - User management
 *
 * Credentials are pulled from environment variables to avoid hardcoding secrets.
 */
if (!admin.apps.length) {
  try {
    // Parse service account credentials from environment variables
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    // Validate required credentials
    if (!projectId || !clientEmail || !privateKey) {
      console.error('Firebase Admin SDK: Missing required environment variables');
      console.error('Required: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY');
      // Don't throw - allow app to start but admin features won't work
    } else {
      // Initialize Admin SDK
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey,
        }),
      });

      console.log('Firebase Admin SDK initialized successfully');
    }
  } catch (error) {
    console.error('Failed to initialize Firebase Admin SDK:', error);
    // Don't throw - allow app to start but admin features won't work
  }
}

// Export Admin SDK services
export const adminAuth = admin.auth();
export const adminDb = admin.firestore();
export const adminStorage = admin.storage();

// Export admin instance for advanced use cases
export default admin;
