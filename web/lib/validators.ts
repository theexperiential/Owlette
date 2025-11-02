/**
 * Password validation utility
 * Enforces 8+ character minimum with complexity requirements
 */

export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Validates password strength
 * Requires:
 * - At least 8 characters
 * - At least 2 of: lowercase, uppercase, numbers, special characters
 */
export const validatePassword = (password: string): ValidationResult => {
  // Check minimum length
  if (password.length < 8) {
    return {
      isValid: false,
      error: 'Password must be at least 8 characters',
    };
  }

  // Check complexity - at least 2 of these categories
  let complexity = 0;

  if (/[a-z]/.test(password)) complexity++; // Has lowercase
  if (/[A-Z]/.test(password)) complexity++; // Has uppercase
  if (/[0-9]/.test(password)) complexity++; // Has numbers
  if (/[^a-zA-Z0-9]/.test(password)) complexity++; // Has special characters

  if (complexity < 2) {
    return {
      isValid: false,
      error: 'Password must include at least 2 of: lowercase, uppercase, numbers, or special characters',
    };
  }

  return { isValid: true };
};

/**
 * Validates email format
 */
export const validateEmail = (email: string): ValidationResult => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!email || email.trim() === '') {
    return {
      isValid: false,
      error: 'Email is required',
    };
  }

  if (!emailRegex.test(email)) {
    return {
      isValid: false,
      error: 'Please enter a valid email address',
    };
  }

  return { isValid: true };
};

/**
 * Validates process name
 * - Max 255 characters
 * - Only alphanumeric, spaces, hyphens, underscores, and periods
 */
export const validateProcessName = (name: string): ValidationResult => {
  if (!name || name.trim() === '') {
    return {
      isValid: false,
      error: 'Process name is required',
    };
  }

  if (name.length > 255) {
    return {
      isValid: false,
      error: 'Process name too long (max 255 characters)',
    };
  }

  if (!/^[a-zA-Z0-9\s\-_.]+$/.test(name)) {
    return {
      isValid: false,
      error: 'Process name contains invalid characters. Use only letters, numbers, spaces, hyphens, underscores, and periods.',
    };
  }

  return { isValid: true };
};

/**
 * Validates Windows executable path
 * - Must be valid Windows path format
 * - No path traversal (..)
 * - Must have file extension
 */
export const validateExecutablePath = (path: string): ValidationResult => {
  if (!path || path.trim() === '') {
    return {
      isValid: false,
      error: 'Executable path is required',
    };
  }

  // Check for path traversal
  if (path.includes('..')) {
    return {
      isValid: false,
      error: 'Path traversal is not allowed',
    };
  }

  // Basic Windows path validation
  // Accepts: C:\path\to\file.exe or C:/path/to/file.exe
  const windowsPathRegex = /^[A-Za-z]:[\\\/][\w\s\-_.\\\/()]+\.\w+$/;

  if (!windowsPathRegex.test(path)) {
    return {
      isValid: false,
      error: 'Invalid executable path format. Use format: C:/Program Files/app.exe',
    };
  }

  return { isValid: true };
};

/**
 * Validates numeric string within range
 */
export const validateNumericString = (
  value: string,
  min: number,
  max: number,
  fieldName: string
): ValidationResult => {
  const num = parseInt(value, 10);

  if (isNaN(num)) {
    return {
      isValid: false,
      error: `${fieldName} must be a number`,
    };
  }

  if (num < min || num > max) {
    return {
      isValid: false,
      error: `${fieldName} must be between ${min} and ${max}`,
    };
  }

  return { isValid: true };
};

/**
 * Validates enum value
 */
export const validateEnum = <T extends string>(
  value: string,
  allowedValues: readonly T[],
  fieldName: string
): ValidationResult => {
  if (!allowedValues.includes(value as T)) {
    return {
      isValid: false,
      error: `Invalid ${fieldName}. Allowed values: ${allowedValues.join(', ')}`,
    };
  }

  return { isValid: true };
};
