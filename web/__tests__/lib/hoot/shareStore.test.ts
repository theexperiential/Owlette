/** @jest-environment node */

/**
 * Unit tests for `web/lib/hoot/shareStore.server.ts` against a fake Firestore.
 *
 * The store is the only thing standing between a share token and the
 * conversation behind it, so the contracts pinned here are the ones the routes
 * and the public page both lean on: `create()` (never `set()`), so a token
 * collision fails loudly instead of overwriting someone's share; expiry
 * computed from an injected clock; "active" filtered on read rather than
 * trusted from the query; revoke idempotent and blind to other chats' tokens;
 * and `getPublicChatShare` answering null identically for missing, expired,
 * revoked and malformed — no oracle between them.
 *
 * `Timestamp` is the real firebase-admin class: expiry is arithmetic on it, and
 * a stub would prove nothing about the comparison the public read performs.
 */

import { Timestamp } from 'firebase-admin/firestore';
import type { UIMessage } from 'ai';
import { buildShareSnapshot } from '@/lib/hoot/shareSnapshot';
import {
  CHAT_SHARES_COLLECTION,
  createChatShare,
  generateShareToken,
  getPublicChatShare,
  listActiveChatShares,
  revokeChatShare,
  ShareNothingToShareError,
  ShareSnapshotTooLargeError,
  type ChatShareDoc,
} from '@/lib/hoot/shareStore.server';
import {
  MAX_SHARE_SNAPSHOT_BYTES,
  SHARE_TOKEN_PATTERN,
  type ShareSnapshot,
} from '@/lib/hoot/shareTypes';

// fake firestore — the chat_shares collection only

/** Stored docs by token id. */
let docs: Map<string, ChatShareDoc>;
let createCalls: Array<{ id: string; data: ChatShareDoc }>;
let setCalls: Array<{ id: string; data: unknown }>;
let updateCalls: Array<{ id: string; patch: Record<string, unknown> }>;
/** Doc ids the store performed a point read on. */
let getCalls: string[];
/** `where` triples and `limit` values observed on the most recent query. */
let whereCalls: Array<[string, string, unknown]>;
let limitCalls: number[];

function docRef(id: string) {
  return {
    id,
    get: async () => {
      getCalls.push(id);
      return { exists: docs.has(id), data: () => docs.get(id) };
    },
    create: async (data: ChatShareDoc) => {
      if (docs.has(id)) throw new Error(`ALREADY_EXISTS: ${id}`);
      createCalls.push({ id, data });
      docs.set(id, data);
    },
    set: async (data: unknown) => {
      setCalls.push({ id, data });
      docs.set(id, data as ChatShareDoc);
    },
    update: async (patch: Record<string, unknown>) => {
      updateCalls.push({ id, patch });
      docs.set(id, { ...(docs.get(id) as ChatShareDoc), ...patch } as ChatShareDoc);
    },
  };
}

function collectionRef(name: string) {
  if (name !== CHAT_SHARES_COLLECTION) throw new Error(`unexpected collection: ${name}`);

  const filters: Array<[string, string, unknown]> = [];
  let cap: number | null = null;

  const query = {
    where(field: string, op: string, value: unknown) {
      whereCalls.push([field, op, value]);
      filters.push([field, op, value]);
      return query;
    },
    limit(n: number) {
      limitCalls.push(n);
      cap = n;
      return query;
    },
    get: async () => {
      let matched = [...docs.values()];
      for (const [field, op, value] of filters) {
        if (op !== '==') throw new Error(`unsupported operator: ${op}`);
        matched = matched.filter(
          (doc) => (doc as unknown as Record<string, unknown>)[field] === value,
        );
      }
      if (cap !== null) matched = matched.slice(0, cap);
      return { docs: matched.map((doc) => ({ data: () => doc })) };
    },
  };

  return { ...query, doc: docRef };
}

jest.mock('@/lib/firebase-admin', () => ({
  getAdminDb: () => ({ collection: (name: string) => collectionRef(name) }),
}));

// fixtures

const CHAT = 'chat-1';
const OTHER_CHAT = 'chat-2';
const SITE = 'site-a';
const UID = 'user-1';
const NOW = new Date('2026-09-09T12:00:00.000Z');
const DAY_MS = 86_400_000;

const TOOL_INPUT_SECRET = 'C:\\shows\\secret-client-project.toe';
const TOOL_OUTPUT_SECRET = 'STUDIO-01 10.0.4.17 Access violation at 0x7ffd';

type Part = UIMessage['parts'][number];

function msg(id: string, role: UIMessage['role'], parts: unknown[]): UIMessage {
  return { id, role, parts: parts as Part[] } as UIMessage;
}

/** A conversation whose tool call carries exactly the details a share must drop. */
const conversation: UIMessage[] = [
  msg('u1', 'user', [{ type: 'text', text: 'why did the deploy fail?' }]),
  msg('a1', 'assistant', [
    {
      type: 'tool-checkLogs',
      toolCallId: 'tool-1',
      state: 'output-available',
      input: { path: TOOL_INPUT_SECRET },
      output: { status: 'warning', detail: TOOL_OUTPUT_SECRET },
    },
    { type: 'text', text: 'the installer exited with a retryable warning.' },
  ]),
];

function snapshot(): ShareSnapshot {
  return buildShareSnapshot({
    title: 'deployment triage',
    targetLabel: 'STUDIO-01',
    messages: conversation,
  });
}

/** A stored doc, straight into the fake — the listing/revoke/read paths read these. */
function storedDoc(overrides: Partial<ChatShareDoc> = {}): ChatShareDoc {
  const token = generateShareToken();
  return {
    token,
    chatId: CHAT,
    siteId: SITE,
    createdBy: UID,
    createdAt: Timestamp.fromDate(NOW),
    expiresAt: null,
    revokedAt: null,
    title: 'deployment triage',
    targetLabel: 'STUDIO-01',
    messageCount: 2,
    snapshot: snapshot(),
    ...overrides,
  };
}

function seed(doc: ChatShareDoc): ChatShareDoc {
  docs.set(doc.token, doc);
  return doc;
}

beforeEach(() => {
  docs = new Map();
  createCalls = [];
  setCalls = [];
  updateCalls = [];
  getCalls = [];
  whereCalls = [];
  limitCalls = [];
});

describe('createChatShare', () => {
  it('creates the doc under its own token with create(), never set()', async () => {
    const share = await createChatShare({
      chatId: CHAT,
      siteId: SITE,
      createdBy: UID,
      snapshot: snapshot(),
      expiresInDays: 30,
      now: NOW,
    });

    expect(share.token).toMatch(SHARE_TOKEN_PATTERN);
    expect(setCalls).toHaveLength(0);
    expect(createCalls).toHaveLength(1);
    // The doc id IS the token — that is what makes the public read a point get.
    expect(createCalls[0].id).toBe(share.token);
    expect(createCalls[0].data).toMatchObject({
      token: share.token,
      chatId: CHAT,
      siteId: SITE,
      createdBy: UID,
      revokedAt: null,
      title: 'deployment triage',
      targetLabel: 'STUDIO-01',
      messageCount: 2,
    });
  });

  it('computes expiresAt from the injected clock, and null never expires', async () => {
    const thirty = await createChatShare({
      chatId: CHAT,
      siteId: SITE,
      createdBy: UID,
      snapshot: snapshot(),
      expiresInDays: 30,
      now: NOW,
    });
    expect(thirty.createdAt).toBe(NOW.getTime());
    expect(thirty.expiresAt).toBe(NOW.getTime() + 30 * DAY_MS);

    const seven = await createChatShare({
      chatId: CHAT,
      siteId: SITE,
      createdBy: UID,
      snapshot: snapshot(),
      expiresInDays: 7,
      now: NOW,
    });
    expect(seven.expiresAt).toBe(NOW.getTime() + 7 * DAY_MS);

    const forever = await createChatShare({
      chatId: CHAT,
      siteId: SITE,
      createdBy: UID,
      snapshot: snapshot(),
      expiresInDays: null,
      now: NOW,
    });
    expect(forever.expiresAt).toBeNull();
    expect(createCalls[2].data.expiresAt).toBeNull();
  });

  it('never stores tool inputs or outputs (negative control)', async () => {
    await createChatShare({
      chatId: CHAT,
      siteId: SITE,
      createdBy: UID,
      snapshot: snapshot(),
      expiresInDays: 30,
      now: NOW,
    });

    // The whole persisted doc, not just the snapshot: a store that stashed the
    // raw messages alongside would still pass a snapshot-only assertion.
    const serialized = JSON.stringify(createCalls[0].data);
    expect(serialized).not.toContain('secret-client-project');
    expect(serialized).not.toContain('10.0.4.17');
    expect(serialized).not.toContain('Access violation');
    expect(serialized).not.toContain('"input"');
    expect(serialized).not.toContain('"output"');
    expect(serialized).not.toContain('toolCallId');
    // What survives is the collapsed call.
    expect(serialized).toContain('checkLogs');
  });

  it('refuses a snapshot with no messages, writing nothing', async () => {
    const empty: ShareSnapshot = { ...snapshot(), messages: [] };
    await expect(
      createChatShare({
        chatId: CHAT,
        siteId: SITE,
        createdBy: UID,
        snapshot: empty,
        expiresInDays: 30,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ShareNothingToShareError);
    expect(createCalls).toHaveLength(0);
  });

  it('refuses a snapshot past the document cap, writing nothing', async () => {
    const huge: ShareSnapshot = {
      ...snapshot(),
      messages: [
        {
          id: 'u1',
          role: 'user',
          parts: [{ type: 'text', text: 'x'.repeat(MAX_SHARE_SNAPSHOT_BYTES + 1_000) }],
        },
      ],
    };
    await expect(
      createChatShare({
        chatId: CHAT,
        siteId: SITE,
        createdBy: UID,
        snapshot: huge,
        expiresInDays: 30,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ShareSnapshotTooLargeError);
    expect(createCalls).toHaveLength(0);
  });
});

describe('listActiveChatShares', () => {
  it('queries one chat\'s unrevoked links, capped', async () => {
    await listActiveChatShares(CHAT, NOW);

    expect(whereCalls).toEqual([
      ['chatId', '==', CHAT],
      ['revokedAt', '==', null],
    ]);
    expect(limitCalls).toEqual([50]);
  });

  it('returns active links newest first, dropping revoked and expired ones', async () => {
    const oldest = seed(
      storedDoc({ createdAt: Timestamp.fromMillis(NOW.getTime() - 3 * DAY_MS) }),
    );
    const newest = seed(
      storedDoc({ createdAt: Timestamp.fromMillis(NOW.getTime() - 1 * DAY_MS) }),
    );
    const middle = seed(
      storedDoc({ createdAt: Timestamp.fromMillis(NOW.getTime() - 2 * DAY_MS) }),
    );
    // Excluded by the query.
    seed(storedDoc({ revokedAt: Timestamp.fromMillis(NOW.getTime() - DAY_MS) }));
    // Excluded in memory — the query cannot filter expiry without a composite index.
    seed(storedDoc({ expiresAt: Timestamp.fromMillis(NOW.getTime() - 60_000) }));
    // Another chat's link.
    seed(storedDoc({ chatId: OTHER_CHAT }));

    const listed = await listActiveChatShares(CHAT, NOW);

    expect(listed.map((s) => s.token)).toEqual([newest.token, middle.token, oldest.token]);
    expect(listed[0]).toEqual({
      token: newest.token,
      createdAt: newest.createdAt.toMillis(),
      expiresAt: null,
      messageCount: 2,
    });
  });

  it('treats a link expiring exactly now as expired', async () => {
    seed(storedDoc({ expiresAt: Timestamp.fromDate(NOW) }));
    expect(await listActiveChatShares(CHAT, NOW)).toEqual([]);
  });
});

describe('revokeChatShare', () => {
  it('revokes a live link and stamps revokedAt', async () => {
    const doc = seed(storedDoc());

    expect(await revokeChatShare(doc.token, CHAT, NOW)).toBe('revoked');
    expect(updateCalls).toHaveLength(1);
    expect(docs.get(doc.token)?.revokedAt?.toMillis()).toBe(NOW.getTime());
  });

  it('is idempotent: a second revoke reports revoked without writing again', async () => {
    const doc = seed(storedDoc());
    const firstRevokedAt = new Date(NOW.getTime() - DAY_MS);

    expect(await revokeChatShare(doc.token, CHAT, firstRevokedAt)).toBe('revoked');
    expect(await revokeChatShare(doc.token, CHAT, NOW)).toBe('revoked');

    expect(updateCalls).toHaveLength(1);
    // The original instant survives — a re-revoke must not move the timestamp.
    expect(docs.get(doc.token)?.revokedAt?.toMillis()).toBe(firstRevokedAt.getTime());
  });

  it('reports another chat\'s token as not_found, leaving it live', async () => {
    const doc = seed(storedDoc({ chatId: OTHER_CHAT }));

    expect(await revokeChatShare(doc.token, CHAT, NOW)).toBe('not_found');
    expect(updateCalls).toHaveLength(0);
    expect(docs.get(doc.token)?.revokedAt).toBeNull();
  });

  it('reports a missing or malformed token as not_found', async () => {
    expect(await revokeChatShare(generateShareToken(), CHAT, NOW)).toBe('not_found');
    expect(await revokeChatShare('not-a-share-token', CHAT, NOW)).toBe('not_found');
    expect(await revokeChatShare('shr_short', CHAT, NOW)).toBe('not_found');
    expect(updateCalls).toHaveLength(0);
  });
});

describe('getPublicChatShare', () => {
  it('serves an active share as the public view', async () => {
    const doc = seed(storedDoc({ expiresAt: Timestamp.fromMillis(NOW.getTime() + DAY_MS) }));

    const view = await getPublicChatShare(doc.token, NOW);

    expect(view).toEqual({
      token: doc.token,
      title: 'deployment triage',
      targetLabel: 'STUDIO-01',
      messages: doc.snapshot.messages,
      createdAt: NOW.getTime(),
      expiresAt: NOW.getTime() + DAY_MS,
    });
    // The view carries the snapshot's messages, so the privacy boundary holds
    // all the way to the page.
    expect(JSON.stringify(view)).not.toContain('Access violation');
  });

  it('answers null identically for missing, expired, revoked and malformed', async () => {
    const expired = seed(storedDoc({ expiresAt: Timestamp.fromMillis(NOW.getTime() - 1) }));
    const revoked = seed(storedDoc({ revokedAt: Timestamp.fromMillis(NOW.getTime() - 1) }));

    expect(await getPublicChatShare(generateShareToken(), NOW)).toBeNull();
    expect(await getPublicChatShare(expired.token, NOW)).toBeNull();
    expect(await getPublicChatShare(revoked.token, NOW)).toBeNull();
    expect(await getPublicChatShare('shr_not_valid', NOW)).toBeNull();
    expect(await getPublicChatShare('', NOW)).toBeNull();
  });

  it('does not read Firestore for a malformed token', async () => {
    // Negative control: a well-formed token DOES produce a read, so the absence
    // of one below is the pattern check rejecting the input, not a dead fake.
    const live = seed(storedDoc());
    expect(await getPublicChatShare(live.token, NOW)).not.toBeNull();
    expect(getCalls).toEqual([live.token]);

    getCalls = [];
    expect(await getPublicChatShare('../../chats/chat-1', NOW)).toBeNull();
    expect(await getPublicChatShare('shr_' + 'a'.repeat(23), NOW)).toBeNull();
    expect(getCalls).toEqual([]);
  });
});
