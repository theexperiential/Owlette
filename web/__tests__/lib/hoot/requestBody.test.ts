/**
 * @jest-environment node
 *
 * The hoot transport's two pure pieces.
 *
 * Context pinning (OWL-48): a request is addressed by the ISSUING chat instance
 * — the pinned site/target plus the transport's own id — never by the live UI
 * selectors; an orphaned instance (id no longer active) throws instead of
 * retargeting the new conversation.
 *
 * Targeting: the body carries the chat's machines plus a NARROWING legacy
 * `machineId`, and an unreadable target refuses to build a body at all. The
 * pre-task behavior (negative control) fell back to the live context, so a chat
 * whose stored target the client couldn't parse sent to the whole site.
 *
 * Error codes: `turn_active` is auto-retried with supersede; `approval_stale`
 * must never reach that path.
 */

import {
  buildHootRequestBody,
  readTurnErrorCode,
  InvalidChatTargetError,
  StaleChatInstanceError,
  type HootChatContext,
} from '@/lib/hoot/requestBody';

const SITE_MACHINES = ['kiosk-01', 'kiosk-02', 'kiosk-03'];

/** A chat pinned to one machine in site A. */
const pinned: HootChatContext = {
  siteId: 'site-A',
  target: { machineIds: ['kiosk-01'] },
  siteMachineIds: SITE_MACHINES,
};

/** The header's current state — a different site, and every machine ticked. */
const live: HootChatContext = {
  siteId: 'site-B',
  target: { machineIds: null },
  siteMachineIds: ['other-1'],
};

const userMessage = (text: string) => ({
  id: 'u1',
  role: 'user',
  parts: [{ type: 'text', text }],
});

const messages = [userMessage('status?')];

describe('buildHootRequestBody', () => {
  it('addresses the body with the pinned context, ignoring live selectors', () => {
    const { body } = buildHootRequestBody({
      transportChatId: 'chat_1',
      activeChatId: 'chat_1',
      pinnedContext: pinned,
      liveContext: live,
      messages,
      supersede: false,
    });

    expect(body).toEqual({
      messages,
      siteId: 'site-A',
      target: { machineIds: ['kiosk-01'], mentions: [] },
      machineId: 'kiosk-01',
      chatId: 'chat_1',
    });
    // `machineName` is gone: every label is built server-side from validated ids.
    expect('machineName' in body).toBe(false);
  });

  it('sends the site sentinel as the legacy field for "all machines"', () => {
    const { body } = buildHootRequestBody({
      transportChatId: 'chat_1',
      activeChatId: 'chat_1',
      pinnedContext: { ...pinned, target: { machineIds: null } },
      liveContext: live,
      messages,
      supersede: false,
    });

    expect(body.target).toEqual({ machineIds: null, mentions: [] });
    expect(body.machineId).toBe('__site__');
  });

  it('narrows the legacy field to the first id of a subset, never the sentinel', () => {
    // Deploy skew: an instance still on the old route reads `machineId` alone.
    // Widening a subset to the whole site there is the failure this prevents.
    const { body } = buildHootRequestBody({
      transportChatId: 'chat_1',
      activeChatId: 'chat_1',
      pinnedContext: { ...pinned, target: { machineIds: ['kiosk-02', 'kiosk-03'] } },
      liveContext: live,
      messages,
      supersede: false,
    });

    expect(body.target).toEqual({ machineIds: ['kiosk-02', 'kiosk-03'], mentions: [] });
    expect(body.machineId).toBe('kiosk-02');
  });

  it('carries the @mentions in the final user message, against the pinned site', () => {
    const { body } = buildHootRequestBody({
      transportChatId: 'chat_1',
      activeChatId: 'chat_1',
      pinnedContext: { ...pinned, target: { machineIds: null } },
      liveContext: live,
      messages: [userMessage('is @kiosk-03 up?')],
      supersede: false,
    });

    // The chat's own selection is untouched — a mention narrows one turn.
    expect(body.target).toEqual({ machineIds: null, mentions: ['kiosk-03'] });
  });

  it('ignores an @id the chat’s site does not have', () => {
    const { body } = buildHootRequestBody({
      transportChatId: 'chat_1',
      activeChatId: 'chat_1',
      pinnedContext: pinned,
      liveContext: live,
      // `other-1` belongs to the live context's site, not this chat's.
      messages: [userMessage('check @other-1')],
      supersede: false,
    });

    expect(body.target).toEqual({ machineIds: ['kiosk-01'], mentions: [] });
  });

  it('carries the pinned target and no mentions on an approval auto-resend', () => {
    // The SDK re-sends with the assistant message last once every approval is
    // answered. Nobody typed that text, so it can never narrow the turn.
    const resume = [
      userMessage('restart @kiosk-03'),
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'tool-restart_machine', state: 'approval-responded', toolCallId: 't1' },
        ],
      },
    ];

    const { body } = buildHootRequestBody({
      transportChatId: 'chat_1',
      activeChatId: 'chat_1',
      pinnedContext: { ...pinned, target: { machineIds: ['kiosk-01', 'kiosk-02'] } },
      liveContext: live,
      messages: resume,
      supersede: false,
    });

    expect(body.target).toEqual({ machineIds: ['kiosk-01', 'kiosk-02'], mentions: [] });
    expect(body.siteId).toBe('site-A');
  });

  it('throws StaleChatInstanceError for an orphaned instance instead of retargeting', () => {
    // Negative control for the pre-fix bug: the old code would have produced a
    // body with chatId 'chat_NEW' + site-B here — the cross-chat delivery.
    expect(() =>
      buildHootRequestBody({
        transportChatId: 'chat_OLD',
        activeChatId: 'chat_NEW',
        pinnedContext: pinned,
        liveContext: live,
        messages,
        supersede: false,
      }),
    ).toThrow(StaleChatInstanceError);
  });

  it('builds NO body for a chat whose stored target was unreadable', () => {
    // Fail closed. Before this task an unreadable target fell through to the
    // live context and this send went out addressed to every machine in site-B.
    expect(() =>
      buildHootRequestBody({
        transportChatId: 'chat_1',
        activeChatId: 'chat_1',
        pinnedContext: { ...pinned, target: 'invalid' },
        liveContext: live,
        messages,
        supersede: false,
      }),
    ).toThrow(InvalidChatTargetError);
  });

  it('builds no body for an unpinned chat with no live target either', () => {
    expect(() =>
      buildHootRequestBody({
        transportChatId: 'chat_1',
        activeChatId: 'chat_1',
        pinnedContext: null,
        liveContext: { ...live, target: 'invalid' },
        messages,
        supersede: false,
      }),
    ).toThrow(InvalidChatTargetError);
  });

  it('builds no body for an empty selection', () => {
    // `[]` reads as "all machines" downstream (target.ts), so it never ships.
    expect(() =>
      buildHootRequestBody({
        transportChatId: 'chat_1',
        activeChatId: 'chat_1',
        pinnedContext: { ...pinned, target: { machineIds: [] } },
        liveContext: live,
        messages,
        supersede: false,
      }),
    ).toThrow(InvalidChatTargetError);
  });

  it('falls back to the live context only when no pin exists (initial mount chat)', () => {
    const { body } = buildHootRequestBody({
      transportChatId: 'chat_1',
      activeChatId: 'chat_1',
      pinnedContext: null,
      liveContext: live,
      messages,
      supersede: false,
    });

    expect(body).toMatchObject({
      siteId: 'site-B',
      target: { machineIds: null, mentions: [] },
      machineId: '__site__',
      chatId: 'chat_1',
    });
  });

  it('includes supersede only when set', () => {
    const withFlag = buildHootRequestBody({
      transportChatId: 'c',
      activeChatId: 'c',
      pinnedContext: pinned,
      liveContext: live,
      messages,
      supersede: true,
    });
    expect(withFlag.body.supersede).toBe(true);

    const withoutFlag = buildHootRequestBody({
      transportChatId: 'c',
      activeChatId: 'c',
      pinnedContext: pinned,
      liveContext: live,
      messages,
      supersede: false,
    });
    expect('supersede' in withoutFlag.body).toBe(false);
  });

  it('tolerates a transport with no id (uses the active chat)', () => {
    const { body } = buildHootRequestBody({
      transportChatId: undefined,
      activeChatId: 'chat_active',
      pinnedContext: pinned,
      liveContext: live,
      messages,
      supersede: false,
    });
    expect(body.chatId).toBe('chat_active');
  });

  it('tolerates messages that are not the shape it expects', () => {
    for (const messages of [undefined, [], [null], [{ role: 'user' }]]) {
      const { body } = buildHootRequestBody({
        transportChatId: 'c',
        activeChatId: 'c',
        pinnedContext: pinned,
        liveContext: live,
        messages,
        supersede: false,
      });
      expect(body.target).toEqual({ machineIds: ['kiosk-01'], mentions: [] });
    }
  });
});

describe('readTurnErrorCode', () => {
  it('reads the code out of a JSON refusal body', () => {
    expect(readTurnErrorCode('{"error":"a turn is already running","code":"turn_active"}')).toBe(
      'turn_active',
    );
    expect(readTurnErrorCode('{"error":"that approval expired","code":"approval_stale"}')).toBe(
      'approval_stale',
    );
  });

  it('never reads a stale approval as the auto-supersede retry', () => {
    // The whole point of the split: retrying this one would re-send an approval
    // the server refused, as a fresh turn, on whatever it resolves to now.
    expect(readTurnErrorCode('{"code":"approval_stale"}')).not.toBe('turn_active');
  });

  it('falls back to the text for non-JSON bodies', () => {
    expect(readTurnErrorCode('502 Bad Gateway: turn_active')).toBe('turn_active');
    expect(readTurnErrorCode('<html>approval_stale</html>')).toBe('approval_stale');
  });

  it('is null for anything else', () => {
    expect(readTurnErrorCode('')).toBeNull();
    expect(readTurnErrorCode('{"error":"boom"}')).toBeNull();
    expect(readTurnErrorCode('Failed to fetch')).toBeNull();
  });
});
