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

/**
 * Get shortened user display name for compact UI elements
 * @param user Firebase user object
 * @returns First name + last initial (e.g., "Dylan R.") or just first name
 */
export function getUserShortName(user: User | null): string {
  if (!user) return '';

  if (user.displayName) {
    const names = user.displayName.trim().split(/\s+/);
    if (names.length >= 2) {
      // First name + last initial with period
      return `${names[0]} ${names[names.length - 1][0]}.`;
    }
    // Single name - return as-is
    return names[0];
  }

  // Fallback to email username
  if (user.email) {
    return user.email.split('@')[0];
  }

  return 'User';
}

/**
 * Get just the first name from display name
 * @param user Firebase user object
 * @returns First name only (e.g., "Dylan")
 */
export function getUserFirstName(user: User | null): string {
  if (!user) return '';

  if (user.displayName) {
    const names = user.displayName.trim().split(/\s+/);
    return names[0];
  }

  // Fallback to email username
  if (user.email) {
    return user.email.split('@')[0];
  }

  return 'User';
}
