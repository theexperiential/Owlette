/**
 * Share links for one hoot conversation.
 *
 *   POST /api/hoot/chats/{chatId}/shares  body { siteId, expiresInDays }
 *          → 201 { share: ChatShareSummary }
 *   GET  /api/hoot/chats/{chatId}/shares?siteId=…
 *          → 200 { shares: ChatShareSummary[] }   active only, newest first
 *
 * Dashboard routes: session auth only, no api-key path. A share publishes a
 * conversation to anyone holding the link, so creating one is not something a
 * scoped machine key should be able to do on a user's behalf.
 *
 * Authorization, in order and identical for both verbs: requireSession (401) →
 * `authorizeChatOwner` in `_shared.ts` — site access (403, or 404 for a site
 * that does not exist) then the chat's own existence and ownership (404 / 403).
 * GET runs the same gate before listing, so a link inventory is no easier to
 * obtain than the conversation it points at.
 *
 * `expiresInDays` is required and validated with `isShareExpiry`; a missing or
 * unrecognised value is a 400, never a server-side default — the default a user
 * saw belongs to the dialog that showed it to them.
 *
 * The snapshot is built here, from the persisted chat, by the same
 * `buildShareSnapshot` the dialog previews with: the preview IS the page, and
 * tool inputs and outputs survive neither.
 *
 * Audit: one `chat_mutated` row per created share. The share token is a bearer
 * credential for the published conversation, so it stays out of the audit
 * attributes and out of every log line — the chat id is the target.
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiAuthError, requireSession } from '@/lib/apiAuth.server';
import { apiError } from '@/lib/apiErrorResponse';
import { emitMutation } from '@/lib/auditLogClient';
import { buildShareSnapshot } from '@/lib/hoot/shareSnapshot';
import {
  ShareNothingToShareError,
  ShareSnapshotTooLargeError,
  createChatShare,
  listActiveChatShares,
} from '@/lib/hoot/shareStore.server';
import { isShareExpiry } from '@/lib/hoot/shareTypes';
import { sanitizeForLog } from '@/lib/logSanitize';
import { getUserIdFromSession, withRateLimit } from '@/lib/withRateLimit';
import { authErrorResponse, authorizeChatOwner, isNonEmptyString } from './_shared';

interface RouteContext {
  params: Promise<{ chatId: string }>;
}

interface CreateShareBody {
  siteId?: unknown;
  expiresInDays?: unknown;
}

async function handleCreateShare(
  request: NextRequest,
  { params }: RouteContext,
): Promise<NextResponse> {
  try {
    const uid = await requireSession(request);
    const { chatId } = await params;
    if (!isNonEmptyString(chatId)) {
      return NextResponse.json({ error: 'chatId is required' }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as CreateShareBody | null;
    const siteId = body?.siteId;
    if (!isNonEmptyString(siteId)) {
      return NextResponse.json({ error: 'siteId is required' }, { status: 400 });
    }
    const expiresInDays = body?.expiresInDays;
    if (!isShareExpiry(expiresInDays)) {
      return NextResponse.json(
        { error: 'expiresInDays must be 7, 30, 90, or null' },
        { status: 400 },
      );
    }

    const authorized = await authorizeChatOwner(chatId, siteId, uid);
    if (!authorized.ok) return authorized.response;

    const { title, targetLabel, messages } = authorized.chat;
    const snapshot = buildShareSnapshot({ title, targetLabel, messages });

    let share;
    try {
      share = await createChatShare({
        chatId,
        siteId,
        createdBy: uid,
        snapshot,
        expiresInDays,
      });
    } catch (error) {
      if (error instanceof ShareNothingToShareError) {
        return NextResponse.json(
          { error: 'this conversation has nothing that can be shared' },
          { status: 409 },
        );
      }
      if (error instanceof ShareSnapshotTooLargeError) {
        // Operationally interesting: the conversation cannot be published at
        // all until it is split, and the dialog can only report the failure.
        console.warn(
          `[hoot/shares] snapshot for chat ${sanitizeForLog(chatId)} is ${error.bytes} bytes; too large to publish`,
        );
        return NextResponse.json(
          { error: 'this conversation is too large to share' },
          { status: 413 },
        );
      }
      throw error;
    }

    emitMutation({
      kind: 'chat_mutated',
      siteId,
      actor: `user:${uid}`,
      targetId: chatId,
      attributes: {
        endpoint: request.nextUrl.pathname,
        method: 'POST',
        verb: 'share',
        expiresAt: share.expiresAt,
        messageCount: share.messageCount,
      },
    });

    return NextResponse.json({ share }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiAuthError) return authErrorResponse(error);
    return apiError(error, 'hoot/chats/shares:create');
  }
}

async function handleListShares(
  request: NextRequest,
  { params }: RouteContext,
): Promise<NextResponse> {
  try {
    const uid = await requireSession(request);
    const { chatId } = await params;
    if (!isNonEmptyString(chatId)) {
      return NextResponse.json({ error: 'chatId is required' }, { status: 400 });
    }

    const siteId = request.nextUrl.searchParams.get('siteId');
    if (!isNonEmptyString(siteId)) {
      return NextResponse.json({ error: 'siteId is required' }, { status: 400 });
    }

    const authorized = await authorizeChatOwner(chatId, siteId, uid);
    if (!authorized.ok) return authorized.response;

    const shares = await listActiveChatShares(chatId);
    return NextResponse.json({ shares });
  } catch (error) {
    if (error instanceof ApiAuthError) return authErrorResponse(error);
    return apiError(error, 'hoot/chats/shares:list');
  }
}

export const POST = withRateLimit(handleCreateShare, {
  strategy: 'user',
  identifier: 'user',
  getUserId: getUserIdFromSession,
});

export const GET = withRateLimit(handleListShares, {
  strategy: 'user',
  identifier: 'user',
  getUserId: getUserIdFromSession,
});
