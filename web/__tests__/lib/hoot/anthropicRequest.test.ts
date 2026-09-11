/** @jest-environment node */

/**
 * What a hoot turn on Claude Sonnet 5 puts on the wire, through the real Anthropic
 * provider with fetch stubbed: the Opus 5 advisor under its beta header, no sampling
 * parameters, and — on the next turn — the persisted thinking signature and the
 * earlier advice replayed as Anthropic's own blocks, with a failed consultation left
 * out. A tier-3 approval resume replays history the same way, so a lost signature
 * would fail it.
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { convertToModelMessages, generateText, type UIMessage } from 'ai';
import { hootProviderTools, modelHistoryFor } from '@/lib/hoot/advisor';

type RequestBody = Record<string, unknown> & {
  messages: Array<{ role: string; content: Array<Record<string, unknown>> }>;
};

const ASK = {
  id: 'u0',
  role: 'user',
  parts: [{ type: 'text', text: 'why is the render node slow?' }],
} as UIMessage;

// As persisted after a Sonnet 5 turn: thinking text omitted (signature only), one
// advisor call whose Opus 5 advice came back encrypted, then the answer.
const HISTORY = [
  ASK,
  {
    id: 'a0',
    role: 'assistant',
    parts: [
      { type: 'step-start' },
      {
        type: 'reasoning',
        text: '',
        state: 'done',
        providerMetadata: { anthropic: { signature: 'sig-abc123' } },
      },
      {
        type: 'tool-advisor',
        toolCallId: 'srvtoolu_adv1',
        state: 'output-available',
        input: {},
        output: { type: 'advisor_redacted_result', encryptedContent: 'opaque-advice' },
        providerExecuted: true,
      },
      { type: 'text', text: 'the gpu is pinned.', state: 'done' },
    ],
  },
  { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'and the cpu?' }] },
] as unknown as UIMessage[];

async function send(messages: UIMessage[]): Promise<{ headers: Headers; body: RequestBody }> {
  let captured: { headers: Headers; body: RequestBody } | undefined;
  const provider = createAnthropic({
    apiKey: 'test-key',
    fetch: async (_input, init) => {
      captured = {
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)) as RequestBody,
      };
      return new Response(
        JSON.stringify({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-5',
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  });
  const tools = hootProviderTools({ provider: 'anthropic', apiKey: 'test-key' });

  await generateText({
    model: provider('claude-sonnet-5'),
    messages: await convertToModelMessages(messages, { tools }),
    tools,
  });

  if (!captured) throw new Error('no request reached the provider');
  return captured;
}

describe('a hoot turn on Claude Sonnet 5, on the wire', () => {
  it('offers the Opus 5 advisor under its beta and sends no sampling parameters', async () => {
    const { headers, body } = await send([ASK]);

    expect(headers.get('anthropic-beta')).toContain('advisor-tool-2026-03-01');
    expect(body.tools).toEqual([
      {
        type: 'advisor_20260301',
        name: 'advisor',
        model: 'claude-opus-5',
        max_uses: 1,
        caching: { type: 'ephemeral', ttl: '5m' },
      },
    ]);
    // Sonnet 5 rejects sampling parameters; thinking is left to its adaptive default.
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('top_p');
    expect(body).not.toHaveProperty('top_k');
    expect(body).not.toHaveProperty('thinking');
  });

  it('replays the thinking signature and the encrypted advice on the next turn', async () => {
    const { body } = await send(HISTORY);

    const assistant = body.messages.find((message) => message.role === 'assistant');
    expect(assistant?.content).toEqual([
      expect.objectContaining({ type: 'thinking', thinking: '', signature: 'sig-abc123' }),
      expect.objectContaining({ type: 'server_tool_use', id: 'srvtoolu_adv1', name: 'advisor' }),
      expect.objectContaining({
        type: 'advisor_tool_result',
        tool_use_id: 'srvtoolu_adv1',
        content: { type: 'advisor_redacted_result', encrypted_content: 'opaque-advice' },
      }),
      expect.objectContaining({ type: 'text', text: 'the gpu is pinned.' }),
    ]);
  });

  it('sends the next turn after a failed consultation, without it', async () => {
    // As the UI stream stores a failed consultation: the provider's error as a string.
    const failed = {
      type: 'tool-advisor',
      toolCallId: 'srvtoolu_adv2',
      state: 'output-error',
      input: {},
      errorText: JSON.stringify({ type: 'advisor_tool_result_error', errorCode: 'max_uses_exceeded' }),
      providerExecuted: true,
    };
    const history = HISTORY.map((message) =>
      message.id === 'a0'
        ? { ...message, parts: [...message.parts, failed] as UIMessage['parts'] }
        : message,
    );

    const { body } = await send(modelHistoryFor(history, true));

    const assistant = body.messages.find((message) => message.role === 'assistant');
    expect(assistant?.content.map((block) => block.type)).toEqual([
      'thinking',
      'server_tool_use',
      'advisor_tool_result',
      'text',
    ]);
  });
});
