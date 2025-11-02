/**
 * Session Management Utility
 * Handles setting and clearing session cookies for authentication
 */

/**
 * Sets a session cookie when user logs in
 * This cookie is checked by middleware for route protection
 *
 * @param userId - The authenticated user's ID
 * @param expirationDays - Number of days until session expires (default: 7)
 */
export const setSessionCookie = (userId: string, expirationDays: number = 7): void => {
  // Only run in browser (not during SSR)
  if (typeof window === 'undefined') return;

  const expirationDate = new Date();
  expirationDate.setDate(expirationDate.getDate() + expirationDays);

  // Determine if we should use Secure flag (only on HTTPS)
  const isSecure = window.location.protocol === 'https:';
  const secureFlag = isSecure ? '; Secure' : '';

  // Set a simple session cookie
  // In production, this should be an encrypted token
  document.cookie = `__session=${userId}; expires=${expirationDate.toUTCString()}; path=/; SameSite=Lax${secureFlag}`;

  // Also set a shorter-lived auth indicator for middleware
  document.cookie = `auth=true; expires=${expirationDate.toUTCString()}; path=/; SameSite=Lax${secureFlag}`;
};

/**
 * Clears the session cookie when user logs out
 */
export const clearSessionCookie = (): void => {
  // Only run in browser (not during SSR)
  if (typeof window === 'undefined') return;

  // Set expiration to past date to delete cookie
  document.cookie = '__session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax';
  document.cookie = 'auth=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax';
};

/**
 * Checks if a valid session cookie exists (client-side check)
 * @returns True if session cookie exists
 */
export const hasSessionCookie = (): boolean => {
  if (typeof document === 'undefined') return false;

  return document.cookie.split(';').some(cookie =>
    cookie.trim().startsWith('auth=true')
  );
};
