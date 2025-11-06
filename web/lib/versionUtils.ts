/**
 * Version Utilities
 *
 * Provides version comparison and parsing utilities for Owlette agent updates.
 * Supports semantic versioning (e.g., "2.0.0", "2.1.0", "2.1.0-beta")
 */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
  original: string;
}

/**
 * Parse a semantic version string into components
 *
 * @param version - Version string (e.g., "2.0.0" or "2.1.0-beta")
 * @returns Parsed version object or null if invalid
 *
 * @example
 * parseVersion("2.1.0") // { major: 2, minor: 1, patch: 0, original: "2.1.0" }
 * parseVersion("2.1.0-beta") // { major: 2, minor: 1, patch: 0, prerelease: "beta", original: "2.1.0-beta" }
 */
export function parseVersion(version: string | undefined | null): ParsedVersion | null {
  if (!version || typeof version !== 'string') {
    return null;
  }

  // Handle version strings with 'v' prefix (e.g., "v2.0.0")
  const cleanVersion = version.trim().replace(/^v/i, '');

  // Match semantic versioning: major.minor.patch[-prerelease]
  const match = cleanVersion.match(/^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.-]+))?$/);

  if (!match) {
    return null;
  }

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4],
    original: cleanVersion
  };
}

/**
 * Compare two version strings
 *
 * @param v1 - First version string
 * @param v2 - Second version string
 * @returns -1 if v1 < v2, 0 if v1 === v2, 1 if v1 > v2, null if either version is invalid
 *
 * @example
 * compareVersions("2.0.0", "2.1.0") // -1 (v1 is older)
 * compareVersions("2.1.0", "2.1.0") // 0 (equal)
 * compareVersions("2.2.0", "2.1.0") // 1 (v1 is newer)
 */
export function compareVersions(
  v1: string | undefined | null,
  v2: string | undefined | null
): number | null {
  const parsed1 = parseVersion(v1);
  const parsed2 = parseVersion(v2);

  // If either version is invalid, return null
  if (!parsed1 || !parsed2) {
    return null;
  }

  // Compare major version
  if (parsed1.major !== parsed2.major) {
    return parsed1.major < parsed2.major ? -1 : 1;
  }

  // Compare minor version
  if (parsed1.minor !== parsed2.minor) {
    return parsed1.minor < parsed2.minor ? -1 : 1;
  }

  // Compare patch version
  if (parsed1.patch !== parsed2.patch) {
    return parsed1.patch < parsed2.patch ? -1 : 1;
  }

  // Compare prerelease versions
  // Versions without prerelease are considered newer than with prerelease
  // e.g., "2.1.0" > "2.1.0-beta"
  if (parsed1.prerelease && !parsed2.prerelease) {
    return -1;
  }
  if (!parsed1.prerelease && parsed2.prerelease) {
    return 1;
  }
  if (parsed1.prerelease && parsed2.prerelease) {
    // Alphabetical comparison of prerelease tags
    if (parsed1.prerelease < parsed2.prerelease) return -1;
    if (parsed1.prerelease > parsed2.prerelease) return 1;
  }

  // Versions are equal
  return 0;
}

/**
 * Check if a machine version is outdated compared to the latest version
 *
 * @param machineVersion - Current version on the machine
 * @param latestVersion - Latest available version
 * @returns true if machine version is older than latest, false otherwise
 *
 * @example
 * isOutdated("2.0.0", "2.1.0") // true
 * isOutdated("2.1.0", "2.1.0") // false
 * isOutdated("2.2.0", "2.1.0") // false
 * isOutdated(undefined, "2.1.0") // true (unknown version considered outdated)
 */
export function isOutdated(
  machineVersion: string | undefined | null,
  latestVersion: string | undefined | null
): boolean {
  // If machine version is unknown, consider it outdated
  if (!machineVersion) {
    return true;
  }

  // If latest version is unknown, can't determine if outdated
  if (!latestVersion) {
    return false;
  }

  const comparison = compareVersions(machineVersion, latestVersion);

  // If comparison failed (invalid versions), consider not outdated
  if (comparison === null) {
    return false;
  }

  // Machine is outdated if its version is less than latest
  return comparison < 0;
}

/**
 * Format a version string for display
 *
 * @param version - Version string
 * @param includePrefix - Whether to include 'v' prefix
 * @returns Formatted version string or "Unknown" if invalid
 *
 * @example
 * formatVersion("2.1.0") // "2.1.0"
 * formatVersion("2.1.0", true) // "v2.1.0"
 * formatVersion(undefined) // "Unknown"
 */
export function formatVersion(
  version: string | undefined | null,
  includePrefix: boolean = false
): string {
  if (!version) {
    return 'Unknown';
  }

  const parsed = parseVersion(version);
  if (!parsed) {
    return 'Unknown';
  }

  const prefix = includePrefix ? 'v' : '';
  return `${prefix}${parsed.original}`;
}

/**
 * Get version difference description
 *
 * @param fromVersion - Current version
 * @param toVersion - Target version
 * @returns Human-readable description of version difference
 *
 * @example
 * getVersionDifference("2.0.0", "2.1.0") // "minor update"
 * getVersionDifference("2.0.0", "3.0.0") // "major update"
 * getVersionDifference("2.1.0", "2.1.1") // "patch update"
 */
export function getVersionDifference(
  fromVersion: string | undefined | null,
  toVersion: string | undefined | null
): string {
  const from = parseVersion(fromVersion);
  const to = parseVersion(toVersion);

  if (!from || !to) {
    return 'version update';
  }

  if (from.major !== to.major) {
    return 'major update';
  }
  if (from.minor !== to.minor) {
    return 'minor update';
  }
  if (from.patch !== to.patch) {
    return 'patch update';
  }
  if (from.prerelease !== to.prerelease) {
    return 'prerelease update';
  }

  return 'no update';
}

/**
 * Validate if a string is a valid semantic version
 *
 * @param version - Version string to validate
 * @returns true if valid, false otherwise
 *
 * @example
 * isValidVersion("2.1.0") // true
 * isValidVersion("2.1") // false
 * isValidVersion("v2.1.0") // true
 */
export function isValidVersion(version: string | undefined | null): boolean {
  return parseVersion(version) !== null;
}
