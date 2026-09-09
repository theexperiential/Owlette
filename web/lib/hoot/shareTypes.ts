/**
 * Public-share contract for hoot conversations — the one file both sides import.
 *
 * A share is a frozen, text-only snapshot of a conversation, published at
 * `/share/{token}` for anyone holding the link until it expires or is revoked.
 * Later messages never leak into an existing share: re-share to publish more.
 *
 * Client-safe: nothing here touches the server. Persistence lives in
 * `shareStore.server.ts`, the snapshot builder in `shareSnapshot.ts`, the one
 * renderer both the dialog preview and the public page use in
 * `components/hoot/SharedConversation.tsx`.
 *
 * Routes (session auth; the chat's owner only — autonomous chats have no owner
 * and are not shareable in this version):
 *
 *   POST   /api/hoot/chats/{chatId}/shares
 *            body { siteId: string; expiresInDays: ShareExpiry }
 *            → 201 { share: ChatShareSummary }
 *            400 invalid body · 401 · 403 not the owner · 404 chat missing or not
 *            in that site · 409 nothing to share · 413 snapshot too large
 *   GET    /api/hoot/chats/{chatId}/shares?siteId=…
 *            → 200 { shares: ChatShareSummary[] }   active only, newest first
 *   DELETE /api/hoot/chats/{chatId}/shares/{token}?siteId=…
 *            → 200 { revoked: true }   idempotent; 404 when the token is not this chat's
 *   GET    /share/{token}                    public page; 404 for missing, expired AND
 *                                            revoked alike (no oracle between them)
 *   GET    /share/{token}/opengraph-image    public OG card (title + "shared from owlette")
 */

export const SHARE_TOKEN_PREFIX = 'shr_';

/** `shr_` + 24 base64url chars = 18 random bytes, 144 bits. Unguessable, never listed. */
export const SHARE_TOKEN_PATTERN = /^shr_[A-Za-z0-9_-]{24}$/;

export function isShareToken(value: unknown): value is string {
  return typeof value === 'string' && SHARE_TOKEN_PATTERN.test(value);
}

export const SHARE_EXPIRY_OPTIONS_DAYS = [7, 30, 90] as const;
export type ShareExpiryDays = (typeof SHARE_EXPIRY_OPTIONS_DAYS)[number];
export const DEFAULT_SHARE_EXPIRY_DAYS: ShareExpiryDays = 30;

/** `null` means the link never expires — an explicit choice, never the default. */
export type ShareExpiry = ShareExpiryDays | null;

export function isShareExpiry(value: unknown): value is ShareExpiry {
  return (
    value === null ||
    (typeof value === 'number' && (SHARE_EXPIRY_OPTIONS_DAYS as readonly number[]).includes(value))
  );
}

/** Firestore caps a document at 1 MiB; this leaves room for the metadata fields. */
export const MAX_SHARE_SNAPSHOT_BYTES = 900_000;

/** How a collapsed tool call ended. The snapshot never carries inputs or outputs. */
export type SharedToolOutcome = 'completed' | 'failed' | 'denied' | 'incomplete';

export type SharedPart =
  | { type: 'text'; text: string }
  | { type: 'tool'; toolName: string; outcome: SharedToolOutcome };

export interface SharedMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: SharedPart[];
}

/** What gets published — built by `buildShareSnapshot`, stored verbatim. */
export interface ShareSnapshot {
  version: 1;
  title: string;
  /** Machine name, or "All Machines" for a site-wide chat. Shown on the page. */
  targetLabel: string | null;
  messages: SharedMessage[];
  /** Left out entirely, counted so the dialog can say so: attachments, system messages. */
  omitted: { images: number; systemMessages: number };
  /** Tool calls kept as name + outcome only. */
  collapsedToolCalls: number;
}

/** Owner-side row. The permalink is `shareUrl(origin, token)`. */
export interface ChatShareSummary {
  token: string;
  /** ms since epoch */
  createdAt: number;
  /** ms since epoch, or null for a link that never expires */
  expiresAt: number | null;
  messageCount: number;
}

/** What the public page renders. */
export interface ChatShareView {
  token: string;
  title: string;
  targetLabel: string | null;
  messages: SharedMessage[];
  createdAt: number;
  expiresAt: number | null;
}

export function shareUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/share/${token}`;
}
