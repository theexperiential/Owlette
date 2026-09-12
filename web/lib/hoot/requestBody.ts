/**
 * Pure transport helpers for the hoot chat client: the request body a send is
 * addressed with, and the error codes a refused send comes back as.
 *
 * A send must be addressed by the chat instance that issued it, not by
 * whatever the UI currently shows: `@ai-sdk/react` recreates its Chat when the
 * id changes WITHOUT aborting the old instance's request, and an orphaned
 * instance still auto-resumes (`sendAutomaticallyWhen`) when its response
 * finishes. Built from live refs, such a follow-up would POST the OLD
 * conversation's messages under the NEW chatId — retargeting (and on a full
 * replace, overwriting) a different conversation.
 *
 * So: the transport's `id` (the issuing Chat instance's chatId) is
 * authoritative. A request whose `id` no longer matches the active chat
 * throws — the orphan's send dies in the browser instead of reaching the
 * server. Site/target context is the value pinned when that chat was started
 * or loaded, falling back to the live context only when no pin exists (the
 * initial mount's chat, pinned lazily on first use).
 *
 * The target half FAILS CLOSED. A chat whose stored selection could not be read
 * is pinned `'invalid'` and builds no body at all, because the alternative —
 * what this file used to do — was to fall back to the live context and send the
 * turn to whatever the header happened to show, which for the old default was
 * every machine in the site.
 *
 * Kept pure and separate from useHoot for direct unit testing.
 */

import { parseMentions } from '@/lib/hoot/mentions';
import { neverWidenLegacyMachineId, type HootTarget } from '@/lib/hoot/target';

export interface HootChatContext {
  siteId: string;
  /** The chat's machines, or `'invalid'` when its stored target was unreadable. */
  target: HootTarget | 'invalid';
  /** Every machine id in the chat's site — the vocabulary `@mentions` resolve against. */
  siteMachineIds: string[];
}

export class StaleChatInstanceError extends Error {
  constructor(transportChatId: string, activeChatId: string) {
    super(
      `stale chat instance: request addressed to conversation ${transportChatId} ` +
        `but the active conversation is ${activeChatId} — dropped to prevent ` +
        `cross-chat delivery`,
    );
    this.name = 'StaleChatInstanceError';
  }
}

/**
 * No usable target, so no body. The message is user-facing: the transport's
 * throw surfaces as the chat's error banner.
 */
export class InvalidChatTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidChatTargetError';
  }
}

/**
 * Text of the FINAL message when a person typed it — the only text that can
 * narrow a turn (D-I). The server re-parses the same message and keeps only the
 * ids both agree on, so a body claiming mentions the text doesn't carry narrows
 * nothing; parsing anything else here would just be ignored. An approval resume
 * ends on an assistant message, which is why it never carries mentions.
 */
function finalUserText(messages: unknown): string {
  if (!Array.isArray(messages) || messages.length === 0) return '';
  const last: unknown = messages[messages.length - 1];
  if (typeof last !== 'object' || last === null) return '';
  const { role, parts } = last as { role?: unknown; parts?: unknown };
  if (role !== 'user' || !Array.isArray(parts)) return '';

  const text: string[] = [];
  for (const part of parts) {
    if (typeof part !== 'object' || part === null) continue;
    const { type, text: value } = part as { type?: unknown; text?: unknown };
    if (type === 'text' && typeof value === 'string') text.push(value);
  }
  return text.join('\n');
}

export function buildHootRequestBody(args: {
  /** The id the SDK transport hands over — the issuing Chat instance's chatId. */
  transportChatId: string | undefined;
  /** The chat the UI currently considers active (chatIdRef). */
  activeChatId: string;
  /** Context pinned when the chat was started/loaded; null when never pinned. */
  pinnedContext: HootChatContext | null;
  /** Live UI context — fallback for the never-pinned initial chat only. */
  liveContext: HootChatContext;
  messages: unknown;
  supersede: boolean;
}): { body: Record<string, unknown> } {
  const { transportChatId, activeChatId, pinnedContext, liveContext, messages, supersede } = args;

  if (transportChatId !== undefined && transportChatId !== activeChatId) {
    throw new StaleChatInstanceError(transportChatId, activeChatId);
  }

  const context = pinnedContext ?? liveContext;
  if (context.target === 'invalid') {
    throw new InvalidChatTargetError(
      'pick machines for this chat — its saved target could not be read.',
    );
  }
  const machineIds = context.target.machineIds;
  if (machineIds !== null && machineIds.length === 0) {
    // `[]` has no legacy encoding and reads as "all machines" downstream
    // (target.ts). The picker allows it transiently with send disabled; this is
    // the backstop for a send that got through anyway.
    throw new InvalidChatTargetError('pick at least one machine before sending.');
  }

  return {
    body: {
      messages,
      siteId: context.siteId,
      target: {
        machineIds,
        mentions: parseMentions(finalUserText(messages), context.siteMachineIds),
      },
      // Deploy skew: an instance still running the old route reads this field
      // only. `neverWidenLegacyMachineId` hands it the FIRST id of a subset, so
      // old code narrows to one machine instead of firing site-wide.
      machineId: neverWidenLegacyMachineId(context.target),
      chatId: transportChatId ?? activeChatId,
      ...(supersede ? { supersede: true } : {}),
    },
  };
}

/** The refusals `/api/hoot` returns as 409, which the client handles differently. */
export type HootTurnErrorCode = 'turn_active' | 'approval_stale';

/**
 * The turn-refusal code carried by an SDK error message (the response body).
 *
 * `turn_active` is retried with `supersede`; `approval_stale` must NEVER be —
 * that would re-send an approval the server already refused into a brand-new
 * turn, on whatever machines the new turn resolves to. Hence one reader, and
 * `approval_stale` first in the text fallback: an ambiguous body loses the
 * retry rather than gaining one.
 */
export function readTurnErrorCode(message: string): HootTurnErrorCode | null {
  let code: unknown;
  try {
    code = (JSON.parse(message) as { code?: unknown }).code;
  } catch {
    code = undefined;
  }
  if (code === 'approval_stale' || code === 'turn_active') return code;

  // Non-JSON bodies (a proxy's error page) still carry the code as text.
  if (message.includes('approval_stale')) return 'approval_stale';
  if (message.includes('turn_active')) return 'turn_active';
  return null;
}
