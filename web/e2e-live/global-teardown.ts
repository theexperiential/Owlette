/**
 * Live smoke global teardown (playwright.live.config.ts): remove everything the run created on
 * dev — lib/seed.mjs teardown(), which prints a count per path — then the signed-in role states,
 * then revoke the persistent users' Firebase refresh tokens. Playwright runs it even when global
 * setup failed. The site and the three persistent users stay, so their uids are stable across runs.
 *
 * Every step runs even when an earlier one fails; the failures are reported together.
 */
import type { FullConfig } from '@playwright/test';
import { rmSync } from 'node:fs';
import { closeDevAdmin } from './lib/devAdmin.mjs';
import { AUTH_DIR } from './lib/harness';
import { revokeRefreshTokens, teardown } from './lib/seed.mjs';

export default async function globalTeardown(_config: FullConfig): Promise<void> {
  const failures: unknown[] = [];
  const attempt = async (step: () => unknown): Promise<void> => {
    try {
      await step();
    } catch (err) {
      failures.push(err);
    }
  };
  try {
    await attempt(() => teardown());
    // The saved role states hold each role's session cookie and Firebase refresh token. The
    // refresh tokens are revoked below; the __session cookie cannot be (no revocation check in
    // web/lib/sessionManager.server.ts) and outlives the run, in any failure trace too (README).
    await attempt(() => rmSync(AUTH_DIR, { recursive: true, force: true }));
    await attempt(() => revokeRefreshTokens());
  } finally {
    await closeDevAdmin();
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, `live smoke global teardown: ${failures.length} steps failed`);
}
