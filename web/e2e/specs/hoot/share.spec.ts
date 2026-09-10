/**
 * hoot share — the owner dialog, the public page, expiry, revocation, and the
 * create route's authorization.
 *
 * Runs on `chromium` only, by config construction rather than by a skip:
 * `playwright.config.ts` scopes the `mobile-chromium` project to
 * `specs/mobile/**`, so a spec outside that folder is matched by exactly one
 * project. If the dialog's 390px layout ever needs coverage it belongs in a
 * spec under `specs/mobile/`, next to the other viewport work.
 *
 * Two assertions this file deliberately does NOT make:
 *
 * - Nothing keys off the word "warning". The seeded tool's output is
 *   `{ status: 'warning' }`, but the assistant's TEXT also says "retryable
 *   warning" — a match would prove nothing about the output being stripped.
 * - Nothing asserts `e2e-cortex-machine` is absent from the whole page. That
 *   string is the chat's machine name, and `shareTypes.ShareSnapshot.targetLabel`
 *   publishes it on purpose ("Shown on the page"). The leak that matters is the
 *   tool ARGUMENT of the same value reaching a reader, so every negative
 *   assertion is scoped to `[data-testid="shared-conversation"]` — the only
 *   place a message part is ever rendered (`components/hoot/SharedConversation.tsx`),
 *   and therefore the only place a surviving arg could surface.
 *
 * Session-authenticated API calls run as `page.evaluate(fetch(...))`, not through
 * Playwright's `request` fixture: the `__session` cookie is HttpOnly + Secure
 * (`lib/sessionManager.server.ts`) and Playwright's APIRequestContext drops a
 * Secure cookie on an http loopback origin, so `request` returns 401 for every
 * role and the 403 contract could not be observed. Same reasoning as
 * `specs/access-control/admin-api-403.spec.ts`.
 */

import crypto from 'crypto';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { roleState } from '../../helpers/roles';
import { TEST_USERS } from '../../helpers/seed';
import { E2E_BASE_URL } from '../../helpers/emulator';
import { clearChatShares, seedChatShare, seedHootFixture } from '../../helpers/coverageSeed';

const SITE_ID = 'site-A';
const OWNED_CHAT_ID = `e2e-cortex-user-${TEST_USERS.admin.uid}`;
const AUTONOMOUS_CHAT_ID = `e2e-cortex-auto-${SITE_ID}`;

/** The seeded `tool-checkLogs` argument. It must never reach a rendered message. */
const TOOL_ARG_VALUE = 'e2e-cortex-machine';

/** `shareUrl()` output: origin + `/share/` + `SHARE_TOKEN_PATTERN`. */
const PERMALINK_PATTERN = /\/share\/shr_[A-Za-z0-9_-]{24}$/;

/**
 * The public 404 copy. Matched loosely across the apostrophe so a typographic
 * `’` and an ASCII `'` both pass — the assertion is about the message, not the
 * glyph the copy happens to use.
 */
const NOT_FOUND_COPY = /this shared conversation isn.t available/i;

/** `shr_` + 24 base64url chars = 18 random bytes, matching `SHARE_TOKEN_PATTERN`. */
function shareToken(): string {
  return `shr_${crypto.randomBytes(18).toString('base64url')}`;
}

async function openShareDialog(page: Page): Promise<Locator> {
  await page.goto('/hoot');
  await page.getByText('Deployment triage').click();
  await page.getByRole('button', { name: 'share conversation' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Click "create link" and return the permalink the dialog reports. */
async function createShareLink(dialog: Locator): Promise<string> {
  await dialog.getByRole('button', { name: 'create link' }).click();
  const linkInput = dialog.getByLabel('share link');
  // toHaveValue first: the input can mount before the token lands, and
  // inputValue() would then read an empty string without retrying.
  await expect(linkInput).toHaveValue(PERMALINK_PATTERN);
  return linkInput.inputValue();
}

/**
 * POST the create-share route from inside the page, so the browser's cookie jar
 * supplies `__session`. Returns the status only — the authorization contract is
 * the status code.
 */
async function postShareStatus(page: Page, chatId: string): Promise<number> {
  await page.goto('/login');
  return page.evaluate(
    async ({ id, siteId }) => {
      const res = await fetch(`/api/hoot/chats/${encodeURIComponent(id)}/shares`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId, expiresInDays: 30 }),
      });
      return res.status;
    },
    { id: chatId, siteId: SITE_ID },
  );
}

test.describe('hoot share — dialog and public page', () => {
  test.use(roleState('admin'));

  test.beforeEach(async () => {
    await seedHootFixture({ userId: TEST_USERS.admin.uid });
    await clearChatShares(OWNED_CHAT_ID);
  });

  test.afterEach(async () => {
    await clearChatShares(OWNED_CHAT_ID);
  });

  test('previews the snapshot with the tool call collapsed to its name', async ({ page }) => {
    const dialog = await openShareDialog(page);
    await expect(dialog.getByRole('heading', { name: 'share this conversation' })).toBeVisible();
    await expect(dialog.getByLabel('link expires in')).toBeVisible();

    const preview = page.getByRole('region', { name: 'share preview' });
    await expect(preview.getByTestId('shared-message')).toHaveCount(2);
    await expect(preview).toContainText('Why did deployment fail?');
    await expect(preview).toContainText('The installer exited with a retryable warning.');
    await expect(preview.getByTestId('shared-tool')).toContainText('checkLogs');

    // The owner sees what a reader will see, so the strip must already have
    // happened here — not only on the published page.
    await expect(preview.getByTestId('shared-conversation')).not.toContainText(TOOL_ARG_VALUE);
  });

  test('the created link reads publicly, is noindexed, and has an opengraph image', async ({
    page,
    browser,
  }) => {
    const dialog = await openShareDialog(page);
    const link = await createShareLink(dialog);

    // A raw browser context inherits none of the test's storageState, so this
    // reader is genuinely signed out.
    const anonymous = await browser.newContext({ baseURL: E2E_BASE_URL });
    try {
      const reader = await anonymous.newPage();
      const response = await reader.goto(link);
      expect(response?.status()).toBe(200);

      await expect(reader.getByRole('heading', { level: 1, name: 'Deployment triage' })).toBeVisible();
      const conversation = reader.getByTestId('shared-conversation');
      await expect(conversation).toBeVisible();
      await expect(conversation).toContainText('Why did deployment fail?');
      await expect(conversation).toContainText('The installer exited with a retryable warning.');
      await expect(conversation).not.toContainText(TOOL_ARG_VALUE);

      await expect(reader.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

      const ogImage = await anonymous.request.get(`${link}/opengraph-image`);
      expect(ogImage.status()).toBe(200);
      expect(ogImage.headers()['content-type']).toMatch(/^image\//);
    } finally {
      await anonymous.close();
    }
  });

  test('revoking the link from the dialog 404s the public page', async ({ page, browser }) => {
    const dialog = await openShareDialog(page);
    const link = await createShareLink(dialog);

    const anonymous = await browser.newContext({ baseURL: E2E_BASE_URL });
    try {
      const reader = await anonymous.newPage();
      // Positive control: without this, the 404 below would also be produced by
      // a link that never worked.
      const before = await reader.goto(link);
      expect(before?.status()).toBe(200);
      await expect(reader.getByTestId('shared-conversation')).toBeVisible();

      const revoke = dialog.getByRole('button', { name: /^revoke link created/i });
      await revoke.click();
      await expect(revoke).toHaveCount(0);

      const after = await reader.reload();
      expect(after?.status()).toBe(404);
      await expect(reader.getByText(NOT_FOUND_COPY)).toBeVisible();
      await expect(reader.getByTestId('shared-conversation')).toHaveCount(0);
    } finally {
      await anonymous.close();
    }
  });
});

test.describe('hoot share — public page expiry', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  const EXPIRED_TOKEN = shareToken();
  const LIVE_TOKEN = shareToken();

  test.beforeEach(async () => {
    await clearChatShares(OWNED_CHAT_ID);
    await seedChatShare({
      token: EXPIRED_TOKEN,
      chatId: OWNED_CHAT_ID,
      createdBy: TEST_USERS.admin.uid,
      title: 'Expired triage',
      expiresAt: new Date(Date.now() - 60_000),
      messages: [
        {
          id: 'expired-1',
          role: 'user',
          parts: [{ type: 'text', text: 'this snapshot must never be served.' }],
        },
      ],
    });
    await seedChatShare({
      token: LIVE_TOKEN,
      chatId: OWNED_CHAT_ID,
      createdBy: TEST_USERS.admin.uid,
      title: 'Live triage',
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
      messages: [
        {
          id: 'live-1',
          role: 'user',
          parts: [{ type: 'text', text: 'this snapshot is still live.' }],
        },
      ],
    });
  });

  test.afterEach(async () => {
    await clearChatShares(OWNED_CHAT_ID);
  });

  // Both halves in one test on purpose: the live link is the control that makes
  // the expired link's 404 mean "expired" rather than "seeding never worked".
  test('an expired link 404s while a live one serves its snapshot', async ({ page }) => {
    const expired = await page.goto(`/share/${EXPIRED_TOKEN}`);
    expect(expired?.status()).toBe(404);
    await expect(page.getByText(NOT_FOUND_COPY)).toBeVisible();
    await expect(page.getByText('this snapshot must never be served.')).toHaveCount(0);

    const live = await page.goto(`/share/${LIVE_TOKEN}`);
    expect(live?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: 'Live triage' })).toBeVisible();
    await expect(page.getByTestId('shared-conversation')).toContainText(
      'this snapshot is still live.',
    );
  });
});

test.describe('hoot share — create route authorization', () => {
  test.beforeEach(async () => {
    await seedHootFixture({ userId: TEST_USERS.admin.uid });
    await clearChatShares(OWNED_CHAT_ID);
  });

  test.afterEach(async () => {
    await clearChatShares(OWNED_CHAT_ID);
  });

  test.describe('a member of the site who does not own the chat', () => {
    test.use(roleState('member'));

    test('POST /api/hoot/chats/{id}/shares returns 403', async ({ page }) => {
      expect(await postShareStatus(page, OWNED_CHAT_ID)).toBe(403);
    });
  });

  test.describe('the chat owner', () => {
    test.use(roleState('admin'));

    // Control for the two denials: the same call, same body, same mechanism.
    test('POST on their own chat returns 201', async ({ page }) => {
      expect(await postShareStatus(page, OWNED_CHAT_ID)).toBe(201);
    });

    // An autonomous chat carries no `userId`, so nobody is its owner — not even
    // the site admin who can read it.
    test('POST on an autonomous chat returns 403', async ({ page }) => {
      expect(await postShareStatus(page, AUTONOMOUS_CHAT_ID)).toBe(403);
    });
  });

  test.describe('signed out', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('POST /api/hoot/chats/{id}/shares returns 401', async ({ page }) => {
      expect(await postShareStatus(page, OWNED_CHAT_ID)).toBe(401);
    });
  });
});
