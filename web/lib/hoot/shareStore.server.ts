/**
 * Persistence for public conversation shares — `chat_shares/{token}`.
 *
 * Server-only (Admin SDK). The collection has no client rules on purpose:
 * every read and write goes through these functions, so the public page can
 * serve a share by token without any Firestore rule ever exposing the
 * collection, and nothing can list tokens.
 *
 * A doc is "active" while `revokedAt` is null and `expiresAt` is null or in
 * the future. The public read treats missing, expired and revoked identically
 * (null) so a URL never reveals which of the three it is.
 */

import crypto from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';
import type { UIMessage } from 'ai';
import { getAdminDb } from '@/lib/firebase-admin';
import { UNTITLED_CHAT_TITLE } from '@/lib/hoot/untitledChat';
import { snapshotByteLength } from './shareSnapshot';
import {
  MAX_SHARE_SNAPSHOT_BYTES,
  SHARE_TOKEN_PREFIX,
  isShareToken,
  type ChatShareSummary,
  type ChatShareView,
  type ShareExpiry,
  type ShareSnapshot,
} from './shareTypes';

export const CHAT_SHARES_COLLECTION = 'chat_shares';

/** Upper bound on the owner-side list; a chat with more active links than this is misuse. */
const MAX_LISTED_SHARES = 50;

const DAY_MS = 86_400_000;

export class ShareSnapshotTooLargeError extends Error {
  constructor(public readonly bytes: number) {
    super(`share snapshot is ${bytes} bytes; the limit is ${MAX_SHARE_SNAPSHOT_BYTES}`);
    this.name = 'ShareSnapshotTooLargeError';
  }
}

export class ShareNothingToShareError extends Error {
  constructor() {
    super('the conversation has no shareable messages');
    this.name = 'ShareNothingToShareError';
  }
}

export interface ChatShareDoc {
  token: string;
  chatId: string;
  siteId: string;
  createdBy: string;
  createdAt: Timestamp;
  expiresAt: Timestamp | null;
  revokedAt: Timestamp | null;
  title: string;
  targetLabel: string | null;
  messageCount: number;
  snapshot: ShareSnapshot;
}

/** `shr_` + 24 url-safe chars (18 random bytes). */
export function generateShareToken(): string {
  return `${SHARE_TOKEN_PREFIX}${crypto.randomBytes(18).toString('base64url')}`;
}

function isActive(doc: ChatShareDoc, nowMs: number): boolean {
  if (doc.revokedAt) return false;
  if (doc.expiresAt && doc.expiresAt.toMillis() <= nowMs) return false;
  return true;
}

function toSummary(doc: ChatShareDoc): ChatShareSummary {
  return {
    token: doc.token,
    createdAt: doc.createdAt.toMillis(),
    expiresAt: doc.expiresAt ? doc.expiresAt.toMillis() : null,
    messageCount: doc.messageCount,
  };
}

/** The persisted chat, reduced to what a share needs. */
export interface ShareableChat {
  title: string;
  targetLabel: string | null;
  messages: UIMessage[];
}

export type LoadShareableChatResult =
  | { ok: true; chat: ShareableChat }
  | { ok: false; reason: 'not_found' | 'not_owner' };

/**
 * Load `chats/{chatId}` for sharing and decide whether `uid` may share it.
 *
 * The decision lives next to the data it needs so every route answers the same
 * way: a chat in another site is `not_found` (never confirm it exists); a chat
 * the caller does not own — including autonomous chats, which have no owner —
 * is `not_owner`.
 */
export async function loadShareableChat(
  chatId: string,
  siteId: string,
  uid: string,
): Promise<LoadShareableChatResult> {
  const snap = await getAdminDb().collection('chats').doc(chatId).get();
  if (!snap.exists) return { ok: false, reason: 'not_found' };
  const data = snap.data() ?? {};
  if (data.siteId !== siteId) return { ok: false, reason: 'not_found' };
  if (typeof data.userId !== 'string' || data.userId !== uid) {
    return { ok: false, reason: 'not_owner' };
  }
  return {
    ok: true,
    chat: {
      title: typeof data.title === 'string' && data.title.trim() ? data.title : UNTITLED_CHAT_TITLE,
      targetLabel: typeof data.machineName === 'string' && data.machineName ? data.machineName : null,
      messages: Array.isArray(data.messages) ? (data.messages as UIMessage[]) : [],
    },
  };
}

export interface CreateChatShareInput {
  chatId: string;
  siteId: string;
  createdBy: string;
  snapshot: ShareSnapshot;
  expiresInDays: ShareExpiry;
  /** Injectable clock for tests. */
  now?: Date;
}

export async function createChatShare(input: CreateChatShareInput): Promise<ChatShareSummary> {
  if (input.snapshot.messages.length === 0) throw new ShareNothingToShareError();
  const bytes = snapshotByteLength(input.snapshot);
  if (bytes > MAX_SHARE_SNAPSHOT_BYTES) throw new ShareSnapshotTooLargeError(bytes);

  const now = input.now ?? new Date();
  const token = generateShareToken();
  const createdAt = Timestamp.fromDate(now);
  const expiresAt =
    input.expiresInDays === null
      ? null
      : Timestamp.fromMillis(now.getTime() + input.expiresInDays * DAY_MS);

  const doc: ChatShareDoc = {
    token,
    chatId: input.chatId,
    siteId: input.siteId,
    createdBy: input.createdBy,
    createdAt,
    expiresAt,
    revokedAt: null,
    title: input.snapshot.title,
    targetLabel: input.snapshot.targetLabel,
    messageCount: input.snapshot.messages.length,
    snapshot: input.snapshot,
  };

  // create(), not set(): a token collision (18 random bytes — it will not happen)
  // must fail loudly rather than overwrite someone's share.
  await getAdminDb().collection(CHAT_SHARES_COLLECTION).doc(token).create(doc);

  return toSummary(doc);
}

/** Active shares for a chat, newest first. Expiry is filtered in memory (no composite index). */
export async function listActiveChatShares(
  chatId: string,
  now: Date = new Date(),
): Promise<ChatShareSummary[]> {
  const snap = await getAdminDb()
    .collection(CHAT_SHARES_COLLECTION)
    .where('chatId', '==', chatId)
    .where('revokedAt', '==', null)
    .limit(MAX_LISTED_SHARES)
    .get();

  const nowMs = now.getTime();
  return snap.docs
    .map((d) => d.data() as ChatShareDoc)
    .filter((d) => isActive(d, nowMs))
    .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis())
    .map(toSummary);
}

/**
 * Revoke a share. Idempotent. A token that belongs to another chat is reported
 * as `not_found`, never as "belongs elsewhere".
 */
export async function revokeChatShare(
  token: string,
  chatId: string,
  now: Date = new Date(),
): Promise<'revoked' | 'not_found'> {
  if (!isShareToken(token)) return 'not_found';
  const ref = getAdminDb().collection(CHAT_SHARES_COLLECTION).doc(token);
  const snap = await ref.get();
  if (!snap.exists) return 'not_found';
  const data = snap.data() as ChatShareDoc;
  if (data.chatId !== chatId) return 'not_found';
  if (!data.revokedAt) await ref.update({ revokedAt: Timestamp.fromDate(now) });
  return 'revoked';
}

/** The public read. Null for missing, expired and revoked alike. */
export async function getPublicChatShare(
  token: string,
  now: Date = new Date(),
): Promise<ChatShareView | null> {
  if (!isShareToken(token)) return null;
  const snap = await getAdminDb().collection(CHAT_SHARES_COLLECTION).doc(token).get();
  if (!snap.exists) return null;
  const data = snap.data() as ChatShareDoc;
  if (!isActive(data, now.getTime())) return null;
  return {
    token: data.token,
    title: data.title,
    targetLabel: data.targetLabel,
    messages: data.snapshot.messages,
    createdAt: data.createdAt.toMillis(),
    expiresAt: data.expiresAt ? data.expiresAt.toMillis() : null,
  };
}
