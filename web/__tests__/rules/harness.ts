/**
 * @jest-environment node
 *
 * Firestore rules test harness — boots `@firebase/rules-unit-testing` against
 * the running emulator and exposes role-shaped auth contexts so rule specs
 * skip the boilerplate.
 *
 * Lifecycle: `initRulesHarness()` in `beforeAll`, `clearFirestoreData()`
 * between tests, `seedAsAdmin()` to write fixtures with rules disabled,
 * `cleanupRulesHarness()` in `afterAll` to close emulator sockets.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import type { Firestore } from 'firebase/firestore';

/** Roles recognised by `firestore.rules` users/{uid}.role. */
export type UserRole = 'member' | 'admin' | 'superadmin';

/** Per-site roles held on `sites/{siteId}/members/{uid}`. */
export type SiteRole = 'owner' | 'admin' | 'member';

/**
 * Global role -> the per-site role a fixture receives on each of its sites.
 *
 * Site access is a membership DOCUMENT now, so seeding `users/{uid}.sites[]`
 * alone grants nothing at all. `asUser` writes both, and this mapping is what
 * keeps an existing spec meaning what it meant before the cut: an `admin`
 * fixture was a site admin on its sites, a `member` fixture a plain member.
 *
 * Superadmins get NO member rows — they reach every site by global role and the
 * rules short-circuit before the membership term. Seeding rows for them would
 * exercise a shape production never writes.
 */
const MIRRORED_SITE_ROLE: Record<UserRole, SiteRole | null> = {
  superadmin: null,
  admin: 'admin',
  member: 'member',
};

const PROJECT_ID = 'demo-rules-harness';

// Emulator host/port comes from firebase.json — keep in sync.
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8080;

let env: RulesTestEnvironment | null = null;

/**
 * Load `firestore.rules` from the repo root and point the SDK at the local
 * emulator. Throws if the emulator isn't up — `npm run test:rules` boots it.
 */
export async function initRulesHarness(): Promise<RulesTestEnvironment> {
  if (env) return env;

  // firestore.rules lives at the repo root, two directories up from web/.
  const rulesPath = join(__dirname, '..', '..', '..', 'firestore.rules');
  const rules = readFileSync(rulesPath, 'utf8');

  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules,
      host: FIRESTORE_HOST,
      port: FIRESTORE_PORT,
    },
  });

  return env;
}

/** Tear down the rules-test environment. Call from `afterAll`. */
export async function cleanupRulesHarness(): Promise<void> {
  if (!env) return;
  await env.cleanup();
  env = null;
}

/** Wipe harness Firestore data. Leaves rules and auth contexts alone. */
export async function clearFirestoreData(): Promise<void> {
  if (!env) {
    throw new Error('clearFirestoreData() called before initRulesHarness()');
  }
  await env.clearFirestore();
}

/**
 * Run `fn` with a privileged Firestore instance (rules disabled), for fixtures
 * no client may write: site owner, `users/{uid}.role`, agent_refresh_tokens.
 */
export async function seedAsAdmin(
  fn: (db: Firestore) => Promise<void>,
): Promise<void> {
  if (!env) {
    throw new Error('seedAsAdmin() called before initRulesHarness()');
  }
  await env.withSecurityRulesDisabled(async (ctx: RulesTestContext) => {
    await fn(ctx.firestore() as unknown as Firestore);
  });
}

/**
 * Authenticated user context, with `users/{uid}` seeded so `isSuperadmin` and
 * `isNotDeletedUser` resolve, and a membership document per site so
 * `canAccessSite` / `isSiteAdmin` / `isSiteOwner` resolve.
 *
 * Membership is THE grant. `sites` alone no longer confers access — it is still
 * written because write-validation rules reference the field until it is
 * stripped, but nothing in the auth path reads it.
 *
 * `siteRoles` overrides the mirrored role for specific sites, which is how a
 * spec seeds an owner or a plain member of a site it would otherwise administer.
 */
export async function asUser(
  uid: string,
  role: UserRole,
  sites: string[],
  siteRoles: Record<string, SiteRole> = {},
): Promise<Firestore> {
  if (!env) {
    throw new Error('asUser() called before initRulesHarness()');
  }

  // Rules disabled: no client may write users/{uid}.role or a member document.
  await seedAsAdmin(async (db) => {
    const { doc, setDoc } = await import('firebase/firestore');
    await setDoc(doc(db, 'users', uid), {
      uid,
      email: `${uid}@harness.test`,
      role,
      sites,
    });

    const mirrored = MIRRORED_SITE_ROLE[role];
    for (const siteId of sites) {
      const siteRole = siteRoles[siteId] ?? mirrored;
      if (!siteRole) continue;
      await setDoc(doc(db, 'sites', siteId, 'members', uid), {
        uid,
        role: siteRole,
        status: 'active',
        addedAt: new Date(),
        addedBy: 'system:rules-harness',
      });
    }
  });

  const ctx = env.authenticatedContext(uid);
  return ctx.firestore() as unknown as Firestore;
}

/**
 * OAuth agent context. `isAgent()` reads three snake_case custom claims:
 * `role: 'agent'`, `site_id`, `machine_id`. The uid is irrelevant to the
 * rules; `agent-{machineId}` just makes failure logs identifiable.
 */
export function asAgent(siteId: string, machineId: string): Firestore {
  if (!env) {
    throw new Error('asAgent() called before initRulesHarness()');
  }

  const ctx = env.authenticatedContext(`agent-${machineId}`, {
    role: 'agent',
    site_id: siteId,
    machine_id: machineId,
  });
  return ctx.firestore() as unknown as Firestore;
}

/** No Auth token — for public-read paths and the global deny-all fallthrough. */
export function asUnauthenticated(): Firestore {
  if (!env) {
    throw new Error('asUnauthenticated() called before initRulesHarness()');
  }
  return env.unauthenticatedContext().firestore() as unknown as Firestore;
}
