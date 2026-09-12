/**
 * Paths and helpers shared by the live smoke suite's global setup, global teardown and fixtures
 * (playwright.live.config.ts). Nothing here reads credentials or talks to dev.
 */
import path from 'node:path';

/** Signed-in browser state per role: written by global setup, read by fixtures, deleted by global teardown. */
export const AUTH_DIR = path.join(__dirname, '..', '.auth');

/**
 * The roles global setup signs in through /login, one UI login each — two of the run's four
 * (the passkey check signs its own per-run account in). `smoke-target` never signs in: it is
 * only the subject of the roles check.
 */
export const LOGIN_ROLES = ['siteadmin', 'member'] as const;
export type LoginRole = (typeof LOGIN_ROLES)[number];

export function authStatePath(role: LoginRole): string {
  return path.join(AUTH_DIR, `${role}.json`);
}

/**
 * A URL fit to print: origin and path only. Query and fragment are dropped because Firebase
 * Auth requests carry the web API key as `?key=`; an opaque URL (data:, about:) prints as its
 * scheme.
 */
export function describeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return '(unparseable URL)';
  }
  return url.origin === 'null' ? `${url.protocol} URL` : `${url.origin}${url.pathname}`;
}
