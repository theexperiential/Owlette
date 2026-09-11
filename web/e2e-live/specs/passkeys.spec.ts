/**
 * Live smoke: passkeys on dev (dev/active/live-smoke, Task 3.3).
 *
 * One check, on an account created for this attempt: smoke-passkey-<runId>, MFA-free and holding
 * the persistent smoke users' user-doc fields (ensureTestUser, lib/seed.mjs). It gets no site
 * membership because the dashboard needs none: a zero-site account lands on its getting-started card.
 *
 *   1. sign in through /login with the password;
 *   2. account settings → security → add passkey, answered by a CDP virtual authenticator. The
 *      credential must be scoped to RP ID owlette.app, which production builds use on
 *      dev.owlette.app too (getRpId, web/lib/webauthn.server.ts), and must be the one dev stored;
 *   3. sign out, and prove the server session is gone;
 *   4. "continue with passkey" on /login, straight to /dashboard with no MFA page on the way.
 *
 * The first passkey needs no MFA step-up: the enrollment gate stays open while an account holds no
 * factor (checkMfaEnrollmentGate, web/lib/mfaEnrollmentGate.server.ts). A 403
 * mfa_challenge_required from register/options would mean that changed.
 *
 * Why the last session proves the passkey signed in: step 3 leaves no session, and once the account
 * holds a factor a password sign-in is born unverified and stops at /verify-2fa. Only the passkey's
 * user-verified ceremony makes an enrolled account's session verified at birth
 * (resolveMfaOnSessionCreate, web/lib/sessionManager.server.ts). The authenticator's sign count,
 * which dev stores as the passkey's counter, ties the verified assertion to this authenticator.
 *
 * Every attempt gets a fresh account. Registering makes it MFA-enrolled, so a second passkey would
 * need a step-up, and removing the only one re-arms mandatory 2FA setup. Global teardown sweeps
 * every smoke-passkey- account with its passkeys, trusted devices, pending MFA setup and
 * registration challenge (lib/seed.mjs). The sign-in challenge is stored with no user, so this spec
 * removes its own.
 *
 * The page signs in with the web API key dev's build carries, which global setup pinned to
 * owlette-dev-3838a this run.
 */
import { randomBytes } from 'node:crypto';
import type { Page, Request, Response as PageResponse } from '@playwright/test';
import type { Firestore } from 'firebase-admin/firestore';
import { addVirtualAuthenticator, expectCredentialCreated, type VirtualCredential } from '../../e2e/helpers/webauthn';
import { expect, test } from '../fixtures';
import { DEV_ORIGIN, getDb } from '../lib/devAdmin.mjs';
import { PASSKEY_EMAIL_PREFIX, TEST_EMAIL_DOMAIN, ensureTestUser } from '../lib/seed.mjs';

/** The RP ID production builds register and verify against, on dev.owlette.app too. */
const RP_ID = 'owlette.app';

/** Where a password sign-in can land: the dashboard, or one of the proxy's two MFA redirects. */
const POST_LOGIN_PATHS = ['/dashboard', '/setup-2fa', '/verify-2fa'];
/** The MFA pages a passkey sign-in must never pass through. */
const MFA_PATHS = ['/setup-2fa', '/verify-2fa'];
const SIGN_IN_TIMEOUT_MS = 30_000;
/** Blur/focus cycles to wait for hydration to mount the password field; see signInWithPassword(). */
const REVEAL_ATTEMPTS = 15;

/** authenticate/options' challengeId: 32 random bytes as hex (app/api/passkeys/authenticate/options). */
const SIGN_IN_CHALLENGE_ID = /^[0-9a-f]{64}$/;
/** A credential id as dev stores it, as its passkey doc id: base64url. */
const CREDENTIAL_ID = /^[A-Za-z0-9_-]{16,}$/;

/**
 * The routes wrapped in withRateLimit({ strategy: 'auth' }). They share one bucket per public IP
 * (authRateLimit, web/lib/rateLimit.ts). GET and DELETE /api/auth/session are not limited.
 */
const AUTH_BUCKET_PREFIXES = [
  '/api/passkeys/',
  '/api/mfa/',
  '/api/settings/llm-key',
  '/api/settings/llm-models',
  '/api/auth/forgot-password',
];
/** authRateLimit is slidingWindow(10, '1 m'). */
const AUTH_BUCKET_WINDOW_MS = 60_000;
/**
 * Step 2's auth-bucket requests: GET llm-key as account settings opens; GET mfa/factors and
 * passkeys/list as security renders; register options and verify; then passkeys/list, mfa/factors
 * and passkeys/list again as the panel refreshes and remounts.
 */
const ADD_PASSKEY_SPENDS = 8;
/** Step 4's: authenticate options and verify, then AuthContext's session POST for the new Firebase user. */
const PASSKEY_SIGN_IN_SPENDS = 3;
/** No auth-bucket request in flight and none for this long: a burst is over and its readings are in. */
const BUCKET_QUIET_MS = 1_000;
const BUCKET_SETTLE_TIMEOUT_MS = 15_000;
const PACING_MARGIN_MS = 2_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function firestore(): Firestore {
  return getDb();
}

function headerInt(value: string | undefined): number | null {
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : null;
}

function drawsOnAuthBucket(request: Request): boolean {
  const url = new URL(request.url());
  if (url.origin !== DEV_ORIGIN) return false;
  if (url.pathname === '/api/auth/session') return request.method() === 'POST';
  return AUTH_BUCKET_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

/** What dev last reported about the bucket, from a successful response's rate-limit headers. */
interface BucketReading {
  limit: number;
  remaining: number;
  /** X-RateLimit-Reset: the window's end on dev's clock (epoch ms), used only to tell windows apart. */
  windowEnd: number;
  /** The same moment on this machine's clock, from RateLimit-Reset's delta seconds, which dev rounds up. */
  resetAt: number;
}

/**
 * The auth rate-limit bucket as dev reports it to this page. This check draws 12 requests from a
 * bucket of 10 a minute per public IP: 1 for the password sign-in, 8 to add the passkey, 3 for the
 * passkey sign-in. Every successful response says what is left, so before each burst the check
 * waits until the burst fits, and no longer.
 */
class AuthBucket {
  private inFlight = 0;
  private lastActivity = 0;
  private reading: BucketReading | null = null;
  private readonly refused: string[] = [];

  constructor(page: Page) {
    const started = (request: Request) => {
      if (!drawsOnAuthBucket(request)) return;
      this.inFlight += 1;
      this.lastActivity = Date.now();
    };
    const ended = (request: Request) => {
      if (!drawsOnAuthBucket(request)) return;
      this.inFlight -= 1;
      this.lastActivity = Date.now();
    };
    page.on('request', started);
    page.on('requestfinished', ended);
    page.on('requestfailed', ended);
    page.on('response', (response) => {
      if (drawsOnAuthBucket(response.request())) this.record(response);
    });
  }

  /**
   * Wait until the next `spends` auth-bucket requests fit. Upstash's sliding window
   * (@upstash/ratelimit) counts a request in full through its own one-minute window, then
   * linearly less across the next one. The latest reading counts at most `used` requests from the
   * window ending at `resetAt`. Once the following window is `1 - (limit - spends) / used` of the
   * way through, at most `limit - spends` of those still count, and the burst fits.
   */
  async reserve(spends: number, before: string): Promise<void> {
    await this.settle();
    this.assertNoneRefused();
    const reading = this.reading;
    if (!reading) {
      test.info().annotations.push({ type: 'auth rate limit', description: `no reading before ${before}, so not paced` });
      return;
    }
    if (spends > reading.limit) {
      throw new Error(`${before} needs ${spends} auth-bucket requests, more than the bucket's ${reading.limit}`);
    }
    if (reading.remaining >= spends) return;
    const used = reading.limit - reading.remaining;
    const fitsAt =
      reading.resetAt + AUTH_BUCKET_WINDOW_MS * (1 - (reading.limit - spends) / used) + PACING_MARGIN_MS;
    const waitMs = Math.max(0, Math.ceil(fitsAt - Date.now()));
    test.info().annotations.push({
      type: 'auth rate limit',
      description: `${reading.remaining} of ${reading.limit} left before ${before}, which needs ${spends}: waited ${Math.ceil(waitMs / 1000)} s`,
    });
    // Time spent waiting on the limiter is not the check's to spend. Zero means no timeout.
    const timeout = test.info().timeout;
    if (timeout > 0) test.setTimeout(timeout + waitMs);
    await sleep(waitMs);
  }

  /** `err`, or, when dev refused one of this check's requests, an error that leads with that. */
  explain(err: unknown): unknown {
    if (this.refused.length === 0) return err;
    const first = err instanceof Error ? err.message.split('\n', 1)[0] : String(err);
    return new Error(`${this.refusalMessage()} The check then failed: ${first}`, { cause: err });
  }

  /** One annotation per refused request, so a run that passed anyway still shows it hit the limit. */
  annotateRefusals(): void {
    for (const route of this.refused) {
      test.info().annotations.push({ type: 'auth rate limit', description: `refused ${route}` });
    }
  }

  private assertNoneRefused(): void {
    if (this.refused.length > 0) throw new Error(this.refusalMessage());
  }

  private refusalMessage(): string {
    return (
      `dev's auth rate limit (10 a minute per public IP, authRateLimit in web/lib/rateLimit.ts) refused ` +
      `${this.refused.join(', ')}. Something else on this IP spent the budget, such as a browser signed in ` +
      'to dev or another run; wait two minutes and re-run.'
    );
  }

  private async settle(): Promise<void> {
    await expect
      .poll(() => this.inFlight === 0 && Date.now() - this.lastActivity >= BUCKET_QUIET_MS, {
        message: 'auth-bucket requests still in flight',
        timeout: BUCKET_SETTLE_TIMEOUT_MS,
        intervals: [250],
      })
      .toBe(true);
  }

  private record(response: PageResponse): void {
    if (response.status() === 429) {
      this.refused.push(`${response.request().method()} ${new URL(response.url()).pathname}`);
      return;
    }
    const headers = response.headers();
    const limit = headerInt(headers['x-ratelimit-limit']);
    const remaining = headerInt(headers['x-ratelimit-remaining']);
    const windowEnd = headerInt(headers['x-ratelimit-reset']);
    const resetInS = headerInt(headers['ratelimit-reset']);
    if (limit === null || remaining === null || windowEnd === null || resetInS === null) return;
    const next: BucketReading = { limit, remaining, windowEnd, resetAt: Date.now() + resetInS * 1000 };
    const current = this.reading;
    if (!current || next.windowEnd > current.windowEnd) {
      this.reading = next;
    } else if (next.windowEnd === current.windowEnd) {
      // Responses to concurrent requests can arrive out of order: keep the fullest count seen.
      this.reading = {
        ...current,
        remaining: Math.min(current.remaining, next.remaining),
        resetAt: Math.min(current.resetAt, next.resetAt),
      };
    }
  }
}

/**
 * authenticate/options stores its challenge with no user, so teardown's per-user sweep cannot find
 * it, and nothing in the repo deletes an unused one. verify consumes it; if the check stops in
 * between, discard() does.
 */
class SignInChallenge {
  private id: string | null = null;

  remember(id: unknown): void {
    if (typeof id === 'string' && SIGN_IN_CHALLENGE_ID.test(id)) this.id = id;
  }

  async discard(): Promise<void> {
    if (this.id === null) return;
    await firestore().collection('webauthn_challenges').doc(this.id).delete();
    this.id = null;
  }
}

interface PasskeyAccount {
  runId: string;
  uid: string;
  email: string;
  password: string;
}

/** A new MFA-free account. Its uid and email share the smoke-passkey- prefix teardown sweeps. */
async function createPasskeyAccount(): Promise<PasskeyAccount> {
  // Base-36 time, then a random tail: a retry in the same millisecond still gets its own account.
  const runId = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
  const uid = `${PASSKEY_EMAIL_PREFIX}${runId}`;
  const email = `${uid}${TEST_EMAIL_DOMAIN}`;
  const created = await ensureTestUser({ uid, email, displayName: `smoke passkey ${runId}` });
  if (typeof created.password !== 'string' || created.password === '') {
    throw new Error(`ensureTestUser returned no password for ${uid}`);
  }
  return { runId, uid, email, password: created.password };
}

/**
 * /login opens a conditional-UI (autofill) passkey ceremony on mount when the browser offers it,
 * and headless Chromium does. With a virtual authenticator attached, that ceremony would answer
 * itself and sign in before "continue with passkey" is clicked. Reporting no autofill support turns
 * it off and leaves the explicit button's ceremony alone. Same stub as e2e-live/global-setup.ts and
 * web/e2e/specs/mfa/passkey-factor.spec.ts.
 */
function disableConditionalPasskeyUi(): void {
  const pkc = (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential as
    | { isConditionalMediationAvailable?: () => Promise<boolean> }
    | undefined;
  if (pkc) pkc.isConditionalMediationAvailable = () => Promise.resolve(false);
}

/**
 * The page's next response to a POST to `pathname` on dev. A check that fails before awaiting it
 * leaves it pending; the no-op catch keeps its eventual rejection from surfacing as an unhandled one.
 */
function nextPostResponse(page: Page, pathname: string): Promise<PageResponse> {
  const response = page.waitForResponse((candidate) => {
    const url = new URL(candidate.url());
    return candidate.request().method() === 'POST' && url.origin === DEV_ORIGIN && url.pathname === pathname;
  });
  response.catch(() => undefined);
  return response;
}

/**
 * Fails unless `response` has status `want`, quoting a refusal's body. These routes refuse with a
 * short { error } body; a success can carry a custom token, so success bodies are never quoted.
 */
async function expectStatus(response: PageResponse, want: number, what: string): Promise<void> {
  if (response.status() === want) return;
  const detail = (await response.text().catch(() => '')).slice(0, 300);
  throw new Error(`${what} answered ${response.status()}, expected ${want}: ${detail}`);
}

interface SessionState {
  authenticated: unknown;
  userId: unknown;
  mfaRequired: unknown;
  mfaVerified: unknown;
}

/** The server session of the page's context: GET /api/auth/session, which is not rate limited. */
async function readSession(page: Page): Promise<SessionState> {
  const response = await page.request.get('/api/auth/session');
  expect(response.status(), 'GET /api/auth/session').toBe(200);
  const { authenticated, userId, mfaRequired, mfaVerified } = (await response.json()) as Record<string, unknown>;
  return { authenticated, userId, mfaRequired, mfaVerified };
}

async function readFactorInventory(uid: string): Promise<Record<string, unknown>> {
  const data = (await firestore().collection('users').doc(uid).get()).data();
  return { mfaEnrolled: data?.mfaEnrolled, requiresMfaSetup: data?.requiresMfaSetup, passkeys: data?.mfaFactors?.passkeys };
}

async function readStoredPasskey(uid: string, credentialId: string): Promise<Record<string, unknown> | null> {
  const data = (await firestore().collection('users').doc(uid).collection('passkeys').doc(credentialId).get()).data();
  return data ? { friendlyName: data.friendlyName, counter: data.counter } : null;
}

/** Every MFA page the main frame shows from now on, in order. */
function trackMfaDetours(page: Page): () => string[] {
  const seen: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return;
    const { pathname } = new URL(frame.url());
    if (MFA_PATHS.some((path) => pathname.startsWith(path))) seen.push(pathname);
  });
  return () => [...seen];
}

/** Sign in through /login with the password, as e2e-live/global-setup.ts signs the seeded roles in. */
async function signInWithPassword(page: Page, account: PasskeyAccount): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  const emailField = page.getByLabel(/email/i);
  await emailField.fill(account.email);
  // The password field mounts on the email field's React onFocus. A fill that lands before
  // hydration focuses an input with no handler attached, so cycle blur → focus until it appears.
  const passwordField = page.getByLabel(/password/i).first();
  for (let attempt = 0; attempt < REVEAL_ATTEMPTS && !(await passwordField.isVisible()); attempt++) {
    await emailField.blur();
    await page.waitForTimeout(1_000);
    await emailField.focus();
  }
  // Hydration re-rendered the controlled input from its own empty state, wiping an early fill.
  await emailField.fill(account.email);
  await passwordField.fill(account.password);
  await page.getByRole('button', { name: 'sign in with email' }).click();
  await page.waitForURL(
    (url) => url.origin === DEV_ORIGIN && POST_LOGIN_PATHS.some((path) => url.pathname.startsWith(path)),
    { timeout: SIGN_IN_TIMEOUT_MS },
  );
  expect(new URL(page.url()).pathname, `where users/${account.uid}, MFA-free, landed`).toBe('/dashboard');
}

interface AddedPasskey {
  /** base64url, as dev stores it. */
  credentialId: string;
  credential: VirtualCredential;
}

/** Account settings → security → add passkey, then close the dialog. */
async function addPasskeyInSettings(page: Page, passkeyName: string): Promise<string> {
  await page.getByTestId('user-menu-trigger').click();
  await page.getByRole('menuitem', { name: 'account settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'account settings' });
  await expect(dialog).toBeVisible();
  // The mobile section tabs are display:none at this width, so only the sidebar's button matches.
  await dialog.getByRole('button', { name: 'security', exact: true }).click();
  // No factor yet, so the enrollment gate is open.
  await expect(dialog.getByText('0 second factors on this account')).toBeVisible();
  await expect(dialog.getByText('no passkeys registered yet.')).toBeVisible();

  // One button: "add passkey" opens the name field and becomes "register passkey".
  await dialog.getByRole('button', { name: 'add passkey', exact: true }).click();
  await dialog.getByPlaceholder('passkey name (e.g. MacBook, iPhone)').fill(passkeyName);
  const options = nextPostResponse(page, '/api/passkeys/register/options');
  const verified = nextPostResponse(page, '/api/passkeys/register/verify');
  await dialog.getByRole('button', { name: 'register passkey', exact: true }).click();
  await expectStatus(
    await options,
    200,
    'POST /api/passkeys/register/options (403 mfa_challenge_required: the first passkey now needs an MFA step-up)',
  );
  const verify = await verified;
  await expectStatus(verify, 200, 'POST /api/passkeys/register/verify');
  const { credentialId } = (await verify.json()) as { credentialId?: unknown };
  if (typeof credentialId !== 'string' || !CREDENTIAL_ID.test(credentialId)) {
    throw new Error('POST /api/passkeys/register/verify returned no usable credentialId');
  }

  // The panel re-reads the inventory after a register: this is dev's view, not the click's.
  await expect(dialog.getByText('1 second factor on this account')).toBeVisible();
  await expect(dialog.getByText(passkeyName, { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  return credentialId;
}

async function signOut(page: Page): Promise<void> {
  await page.getByTestId('user-menu-trigger').click();
  await page.getByRole('menuitem', { name: 'sign out' }).click();
  // PageHeader sends a signed-out user to the landing page; /login counts too.
  await page.waitForURL((url) => url.origin === DEV_ORIGIN && (url.pathname === '/' || url.pathname === '/login'), {
    timeout: SIGN_IN_TIMEOUT_MS,
  });
}

test.describe('passkeys on dev', () => {
  test('a fresh account adds a passkey, signs out, and signs back in with the passkey alone', async ({ page }) => {
    await page.addInitScript(disableConditionalPasskeyUi);
    const bucket = new AuthBucket(page);
    const challenge = new SignInChallenge();
    const account = await createPasskeyAccount();
    test.info().annotations.push({ type: 'passkey account', description: account.uid });
    const passkeyName = `smoke ${account.runId}`;
    // Attached before the first navigation: it survives navigations and holds nothing until step 2.
    const virtual = await addVirtualAuthenticator(page);

    try {
      await test.step('sign in with the password', async () => {
        await signInWithPassword(page, account);
        expect(await readSession(page), 'the session the password sign-in minted').toEqual({
          authenticated: true,
          userId: account.uid,
          mfaRequired: false,
          mfaVerified: true,
        });
      });

      const added = await test.step('add a passkey in account settings', async (): Promise<AddedPasskey> => {
        await bucket.reserve(ADD_PASSKEY_SPENDS, 'adding the passkey');
        const credentialId = await addPasskeyInSettings(page, passkeyName);
        const [credential] = await expectCredentialCreated(virtual, { rpId: RP_ID });
        expect(
          Buffer.from(credential.credentialId, 'base64').toString('base64url'),
          'the credential dev stored is the one the authenticator holds',
        ).toBe(credentialId);
        expect(Buffer.from(credential.userHandle ?? '', 'base64').toString('utf8'), "the credential's user handle").toBe(
          account.uid,
        );
        expect(await readFactorInventory(account.uid), `users/${account.uid} after its first passkey`).toEqual({
          mfaEnrolled: true,
          requiresMfaSetup: false,
          passkeys: 1,
        });
        return { credentialId, credential };
      });

      await test.step('sign out', async () => {
        await signOut(page);
        // Nothing left for the next sign-in to ride on.
        expect(await readSession(page), 'the session after signing out').toMatchObject({ authenticated: false });
      });

      await test.step('sign in with the passkey', async () => {
        await bucket.reserve(PASSKEY_SIGN_IN_SPENDS, 'the passkey sign-in');
        const mfaDetours = trackMfaDetours(page);
        await page.goto('/login', { waitUntil: 'domcontentloaded' });
        const options = nextPostResponse(page, '/api/passkeys/authenticate/options');
        const verified = nextPostResponse(page, '/api/passkeys/authenticate/verify');
        await page.getByRole('button', { name: 'continue with passkey' }).click();

        const optionsResponse = await options;
        await expectStatus(optionsResponse, 200, 'POST /api/passkeys/authenticate/options');
        challenge.remember(((await optionsResponse.json()) as { challengeId?: unknown }).challengeId);
        const verify = await verified;
        await expectStatus(verify, 200, 'POST /api/passkeys/authenticate/verify');
        // The body also carries a Firebase custom token for the account: read the uid only.
        const { userId } = (await verify.json()) as { userId?: unknown };
        expect(userId, 'the account the passkey signed in').toBe(account.uid);

        await page.waitForURL((url) => url.origin === DEV_ORIGIN && url.pathname === '/dashboard', {
          timeout: SIGN_IN_TIMEOUT_MS,
        });
        expect(mfaDetours(), 'MFA pages on the way to /dashboard').toEqual([]);
        await expect(page.getByTestId('user-menu-trigger'), 'the signed-in dashboard').toBeVisible();
        expect(await readSession(page), 'the session the passkey minted').toEqual({
          authenticated: true,
          userId: account.uid,
          mfaRequired: true,
          mfaVerified: true,
        });

        const held = await virtual.credentials();
        expect(held, 'credentials the authenticator holds').toHaveLength(1);
        expect(held[0].signCount, "the authenticator's sign count after the sign-in").toBeGreaterThan(
          added.credential.signCount,
        );
        expect(
          await readStoredPasskey(account.uid, added.credentialId),
          `users/${account.uid}/passkeys/${added.credentialId}: the name given in settings, and the count dev verified`,
        ).toEqual({ friendlyName: passkeyName, counter: held[0].signCount });
      });
    } catch (err) {
      throw bucket.explain(err);
    } finally {
      bucket.annotateRefusals();
      await virtual.remove().catch(() => undefined);
      await challenge.discard().catch((err: unknown) => {
        test.info().annotations.push({
          type: 'cleanup',
          description: `could not delete the sign-in challenge: ${err instanceof Error ? err.message : String(err)}`,
        });
      });
    }
  });
});
