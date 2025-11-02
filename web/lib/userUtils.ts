import { User } from 'firebase/auth';

/**
 * Get user initials from display name or email
 * @param user Firebase user object
 * @returns Initials (e.g., "JD" for "John Doe") or first letter of email
 */
export function getUserInitials(user: User | null): string {
  if (!user) return '?';

  // If display name exists, extract initials
  if (user.displayName) {
    const names = user.displayName.trim().split(/\s+/);
    if (names.length >= 2) {
      // First letter of first name + first letter of last name
      return (names[0][0] + names[names.length - 1][0]).toUpperCase();
    }
    // Single name - use first two letters
    return user.displayName.substring(0, 2).toUpperCase();
  }

  // Fallback to first two letters of email
  if (user.email) {
    return user.email.substring(0, 2).toUpperCase();
  }

  return '?';
}

/**
 * Get user display text for UI
 * @param user Firebase user object
 * @returns Display name if available, otherwise email
 */
export function getUserDisplayText(user: User | null): string {
  if (!user) return '';
  return user.displayName || user.email || 'User';
}
