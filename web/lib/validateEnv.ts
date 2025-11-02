/**
 * Environment Variable Validation Utility
 *
 * Validates that all required Firebase configuration is present and properly set.
 * Provides clear error messages for misconfiguration.
 *
 * Modes:
 * - Development: Logs warnings to console, allows app to continue
 * - Production: Throws errors and blocks app startup if misconfigured
 */

export interface EnvValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * List of required Firebase environment variables
 */
const REQUIRED_FIREBASE_ENV_VARS = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
] as const;

/**
 * Invalid placeholder values that indicate misconfiguration
 */
const INVALID_VALUES = [
  'placeholder',
  'your-',
  'example-',
  'undefined',
  'null',
  '',
];

/**
 * Check if a value is invalid (missing or placeholder)
 */
function isInvalidValue(value: string | undefined): boolean {
  if (!value) return true;

  return INVALID_VALUES.some((invalid) =>
    value.toLowerCase().includes(invalid.toLowerCase())
  );
}

/**
 * Validate all required environment variables
 */
export function validateEnvironment(): EnvValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check each required environment variable
  REQUIRED_FIREBASE_ENV_VARS.forEach((envVar) => {
    const value = process.env[envVar];

    if (!value) {
      errors.push(`Missing required environment variable: ${envVar}`);
    } else if (isInvalidValue(value)) {
      errors.push(
        `Invalid value for ${envVar}: "${value}" (appears to be a placeholder)`
      );
    }
  });

  // Add helpful context if errors found
  if (errors.length > 0) {
    errors.push('');
    errors.push('To fix this:');
    errors.push('1. Copy web/.env.example to web/.env.local');
    errors.push('2. Fill in your Firebase project credentials from Firebase Console');
    errors.push('3. Restart the development server');
    errors.push('');
    errors.push(
      'Get credentials from: https://console.firebase.google.com/ → Project Settings → General'
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate environment and handle based on mode (dev vs production)
 *
 * In development: Logs warnings but allows app to continue
 * In production: Throws error and blocks app startup
 */
export function validateEnvironmentOrThrow(): void {
  const result = validateEnvironment();

  if (!result.isValid) {
    const errorMessage = [
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '⚠️  FIREBASE CONFIGURATION ERROR',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      ...result.errors,
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    ].join('\n');

    // In development, log warning and continue
    if (process.env.NODE_ENV === 'development') {
      console.warn(errorMessage);
      console.warn('⚠️  Running with invalid Firebase configuration');
      console.warn('⚠️  Some features may not work correctly');
      return;
    }

    // In production, throw error and block startup
    throw new Error(errorMessage);
  }

  // Log success in development
  if (process.env.NODE_ENV === 'development') {
    console.log('✅ Firebase environment variables validated successfully');
  }
}

/**
 * Get a user-friendly error message for display in UI
 */
export function getFirebaseConfigErrorMessage(): string {
  const result = validateEnvironment();

  if (result.isValid) {
    return '';
  }

  return `Firebase is not configured properly. Please check your environment variables and restart the application.`;
}

/**
 * Check if Firebase is properly configured (for conditional rendering)
 */
export function isFirebaseConfigured(): boolean {
  const result = validateEnvironment();
  return result.isValid;
}

/**
 * Get detailed error information for debugging
 */
export function getFirebaseConfigErrors(): string[] {
  const result = validateEnvironment();
  return result.errors;
}

/**
 * Validate a specific Firebase config value
 */
export function validateFirebaseConfigValue(
  key: string,
  value: string | undefined
): { isValid: boolean; error?: string } {
  if (!value) {
    return {
      isValid: false,
      error: `${key} is missing`,
    };
  }

  if (isInvalidValue(value)) {
    return {
      isValid: false,
      error: `${key} appears to be a placeholder: "${value}"`,
    };
  }

  return { isValid: true };
}
