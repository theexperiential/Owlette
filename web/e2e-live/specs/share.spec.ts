/**
 * Live smoke: hoot share on dev (dev/active/live-smoke, Task 3.2).
 *
 * One check, as smoke-siteadmin, on a finished conversation seeded straight into Firestore, so no
 * LLM turn runs: share conversation → create link → a signed-out reader gets the page (200, the
 * shared-conversation renderer, noindex, uncacheable, an unfurl card of its own) → revoke from the
 * same dialog → the same URL 404s and its card turns generic, while the conversation itself stays.
 * The 200 before the revoke is the positive control for the 404 after it: without it, a link that
 * never worked would pass too.
 *
 * The unfurl card answers 200 for every token and falls back to one generic card for a dead one
 * (app/share/[token]/opengraph-image.tsx), so its status proves nothing. Its bytes do: the generic
 * card, fetched for a well-formed token no share holds, renders the same image every time, the live
 * link's card must differ from it, and the revoked link's must equal it.
 *
 * Selectors and flow follow the emulator spec, web/e2e/specs/hoot/share.spec.ts, with two departures:
 *
 *   - The conversation opens at its own permalink, /hoot/{chatId}, not by clicking its sidebar
 *     row: the sidebar and its category groups collapse per user (useHootSidebarPrefs), and that
 *     state outlives a run.
 *   - The leak check reads the HTML dev serves the reader, not only the rendered text. The page
 *     hands the snapshot to a client component, so anything left in it would ride along in the
 *     React payload even where nothing renders it.
 *
 * The seeded tool call carries one marker in its input and one in its output; a share publishes
 * neither (buildShareSnapshot, web/lib/hoot/shareSnapshot.ts). The token in a share link is a
 * bearer credential for the conversation, so no message or annotation here quotes the link. It
 * lives for the length of this test; if the test fails before its revoke, global teardown deletes
 * the share along with the chat (lib/seed.mjs).
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Page, Response as PageResponse } from '@playwright/test';
import type { Firestore } from 'firebase-admin/firestore';
import { isShareToken } from '../../lib/hoot/shareTypes';
import { expect, test } from '../fixtures';
import { DEV_ORIGIN, assertDevUrl, getDb } from '../lib/devAdmin.mjs';
import { PERSISTENT_USERS, SITE_ID, STUB_MACHINE_ID, hasLlmKey } from '../lib/seed.mjs';

const SITE_ADMIN_UID = PERSISTENT_USERS.siteadmin.uid;

/**
 * CHAT_SHARES_COLLECTION in web/lib/hoot/shareStore.server.ts. Copied, not imported: that module
 * is server code that pulls in the app's own admin SDK setup (lib/firebase-admin).
 */
const CHAT_SHARES = 'chat_shares';

/** Tier 1 in web/lib/mcp-tools.ts, with a free-form input the seeded call can mark. */
const SEEDED_TOOL = 'get_service_status';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** shareUrl(DEV_ORIGIN, token): the origin, /share/, then SHARE_TOKEN_PATTERN (web/lib/hoot/shareTypes.ts). */
const PERMALINK_PATTERN = new RegExp(`^${escapeRegExp(DEV_ORIGIN)}/share/shr_[A-Za-z0-9_-]{24}$`);

/** The heading of app/share/[token]/not-found.tsx, loose across the apostrophe as in the emulator spec. */
const NOT_FOUND_COPY = /this shared conversation isn.t available/i;

/** First paint of /hoot on dev: the app boots, then reads the user's sites and the chat. */
const PAGE_READY_TIMEOUT_MS = 30_000;

function firestore(): Firestore {
  return getDb();
}

interface SeededChat {
  chatId: string;
  title: string;
  question: string;
  answer: string;
  /** Strings that live only in the tool call's input and output; a share publishes neither. */
  toolMarkers: string[];
}

/**
 * A finished two-message conversation for smoke-siteadmin in smoke-live. Every string carries a
 * fresh tag, so nothing an earlier run left behind can satisfy an assertion.
 */
async function seedChat(): Promise<SeededChat> {
  const tag = randomBytes(4).toString('hex');
  // The page's own id shape, chat_<ms>_<suffix>; nothing validates it server-side.
  const chatId = `chat_${Date.now()}_${tag}`;
  const inputMarker = `smoke-share-input-${tag}`;
  const outputMarker = `smoke-share-output-${tag}`;
  const chat: SeededChat = {
    chatId,
    title: `smoke share ${tag}`,
    question: `why did smoke deployment ${tag} fail?`,
    answer: `the installer for smoke deployment ${tag} exited with a retryable warning.`,
    toolMarkers: [inputMarker, outputMarker],
  };
  const now = new Date();
  // The fields the turn runner persists (web/lib/hoot/turnRunner.server.ts), plus the source and
  // category the sidebar reads. create(): an id collision must fail, not overwrite.
  await firestore()
    .collection('chats')
    .doc(chatId)
    .create({
      userId: SITE_ADMIN_UID,
      siteId: SITE_ID,
      source: 'user',
      targetType: 'machine',
      targetMachineId: STUB_MACHINE_ID,
      machineName: STUB_MACHINE_ID,
      title: chat.title,
      category: 'smoke',
      messages: [
        { id: `${chatId}-user`, role: 'user', parts: [{ type: 'text', text: chat.question }] },
        {
          id: `${chatId}-assistant`,
          role: 'assistant',
          // AI SDK v6 parts: a completed static tool call, then the answer.
          parts: [
            {
              type: `tool-${SEEDED_TOOL}`,
              toolCallId: `call_${tag}`,
              state: 'output-available',
              input: { service_name: inputMarker },
              output: {
                service_name: inputMarker,
                display_name: outputMarker,
                status: 'running',
                start_type: 'automatic',
              },
            },
            { type: 'text', text: chat.answer },
          ],
        },
      ],
      createdAt: now,
      updatedAt: now,
    });
  return chat;
}

/** What the check reads back from chat_shares/{token} (ChatShareDoc, web/lib/hoot/shareStore.server.ts). */
interface StoredShare {
  chatId: unknown;
  siteId: unknown;
  createdBy: unknown;
  /** revokedAt is null until a revoke stamps it. */
  revoked: boolean;
}

async function readShare(token: string): Promise<StoredShare | null> {
  const data = (await firestore().collection(CHAT_SHARES).doc(token).get()).data();
  if (!data) return null;
  return {
    chatId: data.chatId,
    siteId: data.siteId,
    createdBy: data.createdBy,
    revoked: typeof data.revokedAt?.toMillis === 'function',
  };
}

/** The share routes of one chat: list (GET) and create (POST) here, revoke (DELETE) at /{token}. */
function sharesPath(chatId: string): string {
  return `/api/hoot/chats/${encodeURIComponent(chatId)}/shares`;
}

/**
 * The page's next response to a `method` request whose path `matches` accepts. A check that fails
 * before awaiting it leaves it pending; the no-op catch keeps its eventual rejection from surfacing
 * unhandled.
 */
function nextResponse(page: Page, method: string, matches: (pathname: string) => boolean): Promise<PageResponse> {
  const response = page.waitForResponse(
    (candidate) => candidate.request().method() === method && matches(new URL(candidate.url()).pathname),
  );
  response.catch(() => undefined);
  return response;
}

/** A well-formed share token that no share holds: its page 404s and its card is the generic one. */
function deadShareUrl(): string {
  const token = `shr_${randomBytes(18).toString('base64url')}`;
  if (!isShareToken(token)) throw new Error('the dead token does not have a share token shape');
  return `${DEV_ORIGIN}/share/${token}`;
}

interface CardRead {
  /** sha256 of the image, so two cards compare without printing either. */
  digest: string;
  cacheControl: string;
}

/** GET the unfurl card of the share page at `pageUrl` as `reader`; it must answer 200 with an image. */
async function readCard(reader: Page, pageUrl: string, what: string): Promise<CardRead> {
  const response = await reader.request.get(`${pageUrl}/opengraph-image`);
  expect(response.status(), what).toBe(200);
  expect(response.headers()['content-type'], `the type of ${what}`).toMatch(/^image\//);
  return {
    digest: createHash('sha256').update(await response.body()).digest('hex'),
    cacheControl: response.headers()['cache-control'] ?? '',
  };
}

/**
 * Fails unless `response` has status `want`, quoting the body of a refusal: the share routes
 * answer one with a fixed { error } string (app/api/hoot/chats/[chatId]/shares), never a token.
 */
async function expectStatus(response: PageResponse, want: number, what: string): Promise<void> {
  if (response.status() === want) return;
  const detail = (await response.text().catch(() => '')).slice(0, 300);
  throw new Error(`${what} answered ${response.status()}, expected ${want}: ${detail}`);
}

test.describe('hoot share on dev', () => {
  test.beforeAll(async () => {
    if (!(await hasLlmKey(SITE_ADMIN_UID))) {
      throw new Error(
        `${SITE_ADMIN_UID} has no hoot LLM key (users/${SITE_ADMIN_UID}/settings/llm is missing). This check ` +
          'makes no LLM call, but until a key is stored /hoot lays its "requires an LLM API key" overlay ' +
          'over the conversation and its share control. Set SMOKE_LLM_API_KEY (plus SMOKE_LLM_PROVIDER=openai ' +
          'for an OpenAI key) and re-run: global setup stores it once, through POST /api/settings/llm-key.',
      );
    }
  });

  test('a shared conversation reads signed out until its link is revoked, then 404s', async ({
    siteAdminPage: owner,
    page: reader,
  }) => {
    const chat = await seedChat();
    test.info().annotations.push({ type: 'hoot chat', description: chat.chatId });
    const shares = sharesPath(chat.chatId);

    // The owner opens the conversation, then its share dialog.
    await owner.goto(`/hoot/${encodeURIComponent(chat.chatId)}`);
    const main = owner.getByRole('main');
    await expect(main.getByText(chat.question).first(), 'the seeded conversation, open in /hoot').toBeVisible({
      timeout: PAGE_READY_TIMEOUT_MS,
    });
    const listed = nextResponse(owner, 'GET', (pathname) => pathname === shares);
    await main.getByRole('button', { name: 'share conversation' }).click();
    const dialog = owner.getByRole('dialog', { name: 'share this conversation' });
    await expect(dialog).toBeVisible();
    await expectStatus(await listed, 200, `GET ${shares}`);
    // The dialog lists the chat's links as it opens, and a list that lands after a create
    // replaces the rows, the new link's included (useChatShares). A fresh chat has none.
    await expect(dialog.getByText('no active links')).toBeVisible();

    const created = nextResponse(owner, 'POST', (pathname) => pathname === shares);
    await dialog.getByRole('button', { name: 'create link' }).click();
    await expectStatus(await created, 201, `POST ${shares}`);
    const linkInput = dialog.getByLabel('share link', { exact: true });
    // toHaveValue retries; inputValue() alone can read the box before the link lands.
    await expect(linkInput, 'the permalink the dialog shows').toHaveValue(PERMALINK_PATTERN);
    const link = await linkInput.inputValue();
    const token = assertDevUrl(link).pathname.slice('/share/'.length);
    expect(isShareToken(token), 'the permalink ends in a share token').toBe(true);
    expect(await readShare(token), 'the chat_shares doc behind the new link').toEqual({
      chatId: chat.chatId,
      siteId: SITE_ID,
      createdBy: SITE_ADMIN_UID,
      revoked: false,
    });

    // A reader with no session.
    const served = await reader.goto(link);
    expect(served?.status(), 'a signed-out read of the link').toBe(200);
    const html = (await served?.text()) ?? '';
    for (const marker of chat.toolMarkers) {
      // A boolean, so a failure does not print the page.
      expect(html.includes(marker), 'a seeded tool input or output in the HTML the reader got').toBe(false);
    }
    await expect(reader.getByRole('heading', { level: 1, name: chat.title })).toBeVisible();
    const conversation = reader.getByTestId('shared-conversation');
    await expect(conversation).toBeVisible();
    await expect(conversation).toContainText(chat.question);
    await expect(conversation).toContainText(chat.answer);
    // The tool call survives as its name and outcome only.
    const toolRow = conversation.getByTestId('shared-tool');
    await expect(toolRow).toContainText(SEEDED_TOOL);
    await expect(toolRow).toContainText('completed');
    await expect(reader.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    // A revoke must bite on the next request (force-dynamic, app/share/[token]/page.tsx), so no
    // cache may keep the page.
    expect(served?.headers()['cache-control'], 'the cache-control of the shared page').toContain('no-store');

    const deadUrl = deadShareUrl();
    const deadCard = await readCard(reader, deadUrl, 'the card of a token no share holds');
    expect(
      (await readCard(reader, deadUrl, 'that card fetched again')).digest,
      'the generic card renders the same image every time',
    ).toBe(deadCard.digest);
    const liveCard = await readCard(reader, link, 'the card of the link');
    expect(liveCard.digest, 'the card of the link is its own, not the generic one').not.toBe(deadCard.digest);
    // Next marks the force-dynamic card `max-age=0, must-revalidate` (seen on dev 2026-09-11) where
    // the page gets no-store; either way no cache may serve it without asking dev again.
    expect(liveCard.cacheControl, 'the cache-control of the card').toMatch(/no-store|max-age=0/);

    // The owner revokes from the same dialog; the reader's next request for the same URL 404s.
    const revoke = dialog.getByRole('button', { name: /^revoke link created/i });
    await expect(revoke, 'the new link among the active links in the dialog').toHaveCount(1);
    const revoked = nextResponse(owner, 'DELETE', (pathname) => pathname.startsWith(`${shares}/`));
    await revoke.click();
    await expectStatus(await revoked, 200, `DELETE ${shares}/{token}`);
    await expect(revoke).toHaveCount(0);
    expect((await readShare(token))?.revoked, 'the chat_shares doc after the revoke').toBe(true);

    const gone = await reader.reload();
    expect(gone?.status(), 'the same link after the revoke').toBe(404);
    await expect(reader.getByRole('heading', { level: 1, name: NOT_FOUND_COPY })).toBeVisible();
    await expect(reader.getByTestId('shared-conversation')).toHaveCount(0);
    expect(
      (await readCard(reader, link, 'the card of the link after the revoke')).digest,
      'the card of the revoked link is the generic one: it no longer renders the conversation',
    ).toBe(deadCard.digest);
    // A revoke withdraws the link, never the conversation; a delete would 404 the page as well.
    expect((await firestore().collection('chats').doc(chat.chatId).get()).exists, 'the conversation after the revoke').toBe(
      true,
    );
  });
});
