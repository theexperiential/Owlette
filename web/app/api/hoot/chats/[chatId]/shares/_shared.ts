/**
 * The authorization gate both share routes pass through.
 *
 * It lives here rather than in each route file because the create, list and
 * revoke verbs must answer "may this caller touch this chat's links?" the same
 * way — a drift between them is how a revoke path ends up laxer than the create
 * path that produced the link.
 */

import { NextResponse } from 'next/server';
import { ApiAuthError, assertUserHasSiteAccess } from '@/lib/apiAuth.server';
import { loadShareableChat, type ShareableChat } from '@/lib/hoot/shareStore.server';

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export type AuthorizeChatOwnerResult =
  | { ok: true; chat: ShareableChat }
  | { ok: false; response: NextResponse };

/**
 * Site access (throws `ApiAuthError`), then the chat's existence and ownership.
 *
 * A chat that is missing or lives in another site answers 404 — never confirm
 * that a chat id exists outside the caller's site. A chat the caller does not
 * own answers 403; autonomous chats have no owner and land here too.
 */
export async function authorizeChatOwner(
  chatId: string,
  siteId: string,
  uid: string,
): Promise<AuthorizeChatOwnerResult> {
  await assertUserHasSiteAccess(uid, siteId);

  const loaded = await loadShareableChat(chatId, siteId, uid);
  if (loaded.ok) return { ok: true, chat: loaded.chat };

  return {
    ok: false,
    response:
      loaded.reason === 'not_found'
        ? NextResponse.json({ error: 'chat not found' }, { status: 404 })
        : NextResponse.json({ error: 'you do not own this chat' }, { status: 403 }),
  };
}

/** `ApiAuthError` → its own status, in the shape the dashboard reads. */
export function authErrorResponse(error: ApiAuthError): NextResponse {
  return NextResponse.json(
    { error: error.message, ...(error.code ? { code: error.code } : {}) },
    { status: error.status },
  );
}
