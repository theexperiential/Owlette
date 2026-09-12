/** @jest-environment node */

/**
 * Claude Sonnet 5 and Opus 5 think by default. hoot persists each turn's parts as a
 * JSON copy (turnRunner `persistChatMessages`), and a tier-3 approval resume replays
 * that persisted history to finish the paused tool call. The API rejects a resumed
 * tool call whose thinking block lost its signature, so the signature has to survive
 * persist → convertToModelMessages and reach the provider options.
 */

import { convertToModelMessages, type UIMessage } from 'ai';

const SIGNATURE = 'sig-abc123';

function persisted(messages: UIMessage[]): UIMessage[] {
  // The same round-trip persistChatMessages applies to every part — and now to
  // the per-turn `metadata.hoot` beside them, which must not disturb the parts.
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    parts: m.parts.map((p) => JSON.parse(JSON.stringify(p))),
    ...(m.metadata === undefined ? {} : { metadata: JSON.parse(JSON.stringify(m.metadata)) }),
  })) as UIMessage[];
}

function reasoningOf(content: unknown): Array<Record<string, unknown>> {
  return (Array.isArray(content) ? content : []).filter(
    (c: { type?: string }) => c.type === 'reasoning',
  );
}

describe('thinking replay', () => {
  it('hands a persisted thinking signature back to the provider', async () => {
    const history = persisted([
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'check the cpu' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          // display "omitted" (the default): empty text, signature only.
          { type: 'reasoning', text: '', providerMetadata: { anthropic: { signature: SIGNATURE } } },
          { type: 'text', text: 'CPU is at 12%.' },
        ],
      },
    ] as UIMessage[]);

    const model = await convertToModelMessages(history);
    const assistant = model.find((m) => m.role === 'assistant');

    expect(reasoningOf(assistant?.content)).toEqual([
      expect.objectContaining({ providerOptions: { anthropic: { signature: SIGNATURE } } }),
    ]);
  });

  it('keeps the signature ahead of the tool call it preceded', async () => {
    const history = persisted([
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'what is running?' }] },
      {
        id: 'a1',
        role: 'assistant',
        // The per-turn target stamp rides along on the persisted message.
        metadata: {
          hoot: {
            turnId: 'turn_1',
            machineIds: ['kiosk-01'],
            via: 'chat',
            skipped: { offline: [], disabled: [] },
          },
        },
        parts: [
          { type: 'reasoning', text: '', providerMetadata: { anthropic: { signature: SIGNATURE } } },
          {
            type: 'tool-get_running_processes',
            toolCallId: 'call-1',
            state: 'output-available',
            input: {},
            output: { processes: [] },
          },
        ],
      },
    ] as UIMessage[]);

    const model = await convertToModelMessages(history);
    const assistant = model.find((m) => m.role === 'assistant');
    const content = (assistant?.content ?? []) as Array<{ type: string }>;

    expect(content.map((c) => c.type)).toEqual(['reasoning', 'tool-call']);
    expect(reasoningOf(content)[0]).toMatchObject({
      providerOptions: { anthropic: { signature: SIGNATURE } },
    });
  });
});
