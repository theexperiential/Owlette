/**
 * DELETE /api/hoot/chats/{chatId}/shares/{token}?siteId=…  → 200 { revoked: true }
 *
 * Revoke one share link. Idempotent: revoking an already-revoked link answers
 * 200 again, because "the link is dead" is the state the caller asked for.
 *
 * Authorization is the same gate the create path used (`authorizeChatOwner`):
 * requireSession (401) → site access (403) → the chat exists in that site (404)
 * and the caller owns it (403). Only then is the token looked at, and
 * `revokeChatShare` reports a token belonging to another chat as `not_found` —
 * so this route can never be used to probe which tokens exist.
 *
 * Audit: one `chat_mutated` row, targeting the chat. The token is a bearer
 * credential for the published conversation and never appears in the audit
 * attributes — hence the redacted `endpoint`, since the live pathname carries it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiAuthError, requireSession } from '@/lib/apiAuth.server';
import { apiError } from '@/lib/apiErrorResponse';
import { emitMutation } from '@/lib/auditLogClient';
import { revokeChatShare } from '@/lib/hoot/shareStore.server';
import { getUserIdFromSession, withRateLimit } from '@/lib/withRateLimit';
import { authErrorResponse, authorizeChatOwner, isNonEmptyString } from '../_shared';

interface RouteContext {
  params: Promise<{ chatId: string; token: string }>;
}

async function handleRevokeShare(
  request: NextRequest,
  { params }: RouteContext,
): Promise<NextResponse> {
  try {
    const uid = await requireSession(request);
    const { chatId, token } = await params;
    if (!isNonEmptyString(chatId)) {
      return NextResponse.json({ error: 'chatId is required' }, { status: 400 });
    }

    const siteId = request.nextUrl.searchParams.get('siteId');
    if (!isNonEmptyString(siteId)) {
      return NextResponse.json({ error: 'siteId is required' }, { status: 400 });
    }

    const authorized = await authorizeChatOwner(chatId, siteId, uid);
    if (!authorized.ok) return authorized.response;

    // Malformed and other-chat tokens both land here as `not_found`.
    const outcome = await revokeChatShare(token, chatId);
    if (outcome === 'not_found') {
      return NextResponse.json({ error: 'share not found' }, { status: 404 });
    }

    emitMutation({
      kind: 'chat_mutated',
      siteId,
      actor: `user:${uid}`,
      targetId: chatId,
      attributes: {
        // Redacted on purpose: `request.nextUrl.pathname` ends with the token.
        endpoint: `/api/hoot/chats/${chatId}/shares/{token}`,
        method: 'DELETE',
        action: 'unshare',
      },
    });

    return NextResponse.json({ revoked: true });
  } catch (error) {
    if (error instanceof ApiAuthError) return authErrorResponse(error);
    return apiError(error, 'hoot/chats/shares:revoke');
  }
}

export const DELETE = withRateLimit(handleRevokeShare, {
  strategy: 'user',
  identifier: 'user',
  getUserId: getUserIdFromSession,
});
