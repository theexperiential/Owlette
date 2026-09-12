/** @jest-environment node */

import {
  jsonSchema,
  tool,
  type ModelMessage,
  type StepResult,
  type ToolSet,
  type UIMessage,
} from 'ai';
import {
  advisorCallsIn,
  capAdvisorPerTurn,
  hootProviderTools,
  modelHistoryFor,
  withAdvisor,
} from '@/lib/hoot/advisor';

describe('hootProviderTools', () => {
  it('offers the default Anthropic model the Opus 5 advisor, capped and cached', () => {
    const tools = hootProviderTools({ provider: 'anthropic', apiKey: 'test-key' });

    expect(Object.keys(tools)).toEqual(['advisor']);
    expect(tools.advisor).toMatchObject({
      id: 'anthropic.advisor_20260301',
      args: { model: 'claude-opus-5', maxUses: 1, caching: { type: 'ephemeral', ttl: '5m' } },
    });
  });

  it('offers nothing to an account already on Opus 5', () => {
    expect(hootProviderTools({ provider: 'anthropic', apiKey: 'k', model: 'claude-opus-5' })).toEqual({});
  });

  it('offers nothing to a model outside the pairing table', () => {
    expect(
      hootProviderTools({ provider: 'anthropic', apiKey: 'k', model: 'claude-sonnet-4-5' }),
    ).toEqual({});
  });

  it('offers nothing to OpenAI accounts', () => {
    expect(hootProviderTools({ provider: 'openai', apiKey: 'k' })).toEqual({});
  });
});

describe('modelHistoryFor', () => {
  const advisorPart = {
    type: 'tool-advisor',
    toolCallId: 'adv-1',
    state: 'output-available',
    input: {},
    output: { type: 'advisor_redacted_result', encryptedContent: 'opaque' },
    providerExecuted: true,
  };

  // As the UI stream stores a failed consultation: the provider's error as a string.
  const failedAdvisorPart = {
    type: 'tool-advisor',
    toolCallId: 'adv-2',
    state: 'output-error',
    input: {},
    errorText: JSON.stringify({ type: 'advisor_tool_result_error', errorCode: 'max_uses_exceeded' }),
    providerExecuted: true,
  };

  const history = (): UIMessage[] =>
    [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'why is the wall black?' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [advisorPart, { type: 'text', text: 'The display process crashed.' }],
      },
      { id: 'a2', role: 'assistant', parts: [advisorPart] },
      {
        id: 'a3',
        role: 'assistant',
        parts: [failedAdvisorPart, { type: 'text', text: 'Restarting it.' }],
      },
    ] as unknown as UIMessage[];

  it('removes every advisor part for a request without the advisor', () => {
    const out = modelHistoryFor(history(), false);

    // a2 held nothing else, so it goes too.
    expect(out.map((m) => m.id)).toEqual(['u1', 'a1', 'a3']);
    expect(out[1].parts).toEqual([{ type: 'text', text: 'The display process crashed.' }]);
    expect(out[2].parts).toEqual([{ type: 'text', text: 'Restarting it.' }]);
  });

  it('keeps advice and drops only failed consultations for a request with the advisor', () => {
    const input = history();
    const out = modelHistoryFor(input, true);

    expect(out.map((m) => m.id)).toEqual(['u1', 'a1', 'a2', 'a3']);
    expect(out[1]).toBe(input[1]);
    expect(out[3].parts).toEqual([{ type: 'text', text: 'Restarting it.' }]);
  });

  it('returns the same array when there is nothing to strip', () => {
    const clean = history().slice(0, 1);
    expect(modelHistoryFor(clean, false)).toBe(clean);
    expect(modelHistoryFor(clean, true)).toBe(clean);
  });

  it('counts the advisor calls a stored reply holds, failed ones included', () => {
    const [ask, withAdvice, onlyAdvice, withFailure] = history();

    expect(advisorCallsIn(withAdvice)).toBe(1);
    expect(advisorCallsIn(onlyAdvice)).toBe(1);
    expect(advisorCallsIn(withFailure)).toBe(1);
    expect(advisorCallsIn(ask)).toBe(0);
    expect(advisorCallsIn(undefined)).toBe(0);
  });
});

const agentTools = {
  get_metrics: tool({
    description: 'read machine metrics',
    inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {} }),
  }),
};

describe('withAdvisor', () => {
  it('adds the advisor, with its cap, for a model that may consult it', () => {
    const { tools, prepareStep } = withAdvisor({ provider: 'anthropic', apiKey: 'k' }, agentTools);

    expect(Object.keys(tools)).toEqual(['get_metrics', 'advisor']);
    expect(prepareStep).toEqual(expect.any(Function));
  });

  it('leaves the tools alone, with nothing to cap, for a model without one', () => {
    const { tools, prepareStep } = withAdvisor({ provider: 'openai', apiKey: 'k' }, agentTools);

    expect(Object.keys(tools)).toEqual(['get_metrics']);
    expect(prepareStep).toBeUndefined();
  });
});

describe('capAdvisorPerTurn', () => {
  const { tools } = withAdvisor({ provider: 'anthropic', apiKey: 'k' }, agentTools);
  const call = (id: string) => ({
    type: 'tool-call',
    toolCallId: id,
    toolName: 'advisor',
    input: {},
    providerExecuted: true,
  });
  const result = (id: string) => ({
    type: 'tool-result',
    toolCallId: id,
    toolName: 'advisor',
    input: {},
    output: { type: 'advisor_redacted_result', encryptedContent: 'opaque' },
    providerExecuted: true,
  });
  const step = (...content: Array<{ type: string }>) =>
    ({ content, toolCalls: content.filter((part) => part.type === 'tool-call') }) as unknown as StepResult<ToolSet>;
  const messages = [
    { role: 'user', content: 'why is the wall black?' },
    { role: 'assistant', content: [call('a1'), result('a1'), { type: 'text', text: 'checking.' }] },
  ] as ModelMessage[];
  const prepare = (usedBefore: number, steps: StepResult<ToolSet>[]) =>
    capAdvisorPerTurn(tools, usedBefore)?.({
      steps,
      stepNumber: steps.length,
      model: 'claude-sonnet-5',
      messages,
      experimental_context: undefined,
    });

  it('leaves a reply with a consultation to spare alone', () => {
    expect(prepare(0, [step(call('a1'), result('a1'))])).toBeUndefined();
  });

  it('drops the tool and the advice once the reply has used two', () => {
    expect(prepare(1, [step(call('a1'), result('a1'))])).toEqual({
      activeTools: ['get_metrics'],
      messages: [messages[0], { role: 'assistant', content: [{ type: 'text', text: 'checking.' }] }],
    });
  });

  it('waits out a consultation the API paused, which resumes with the tool', () => {
    expect(prepare(1, [step(call('a1'))])).toBeUndefined();
  });

  it('has nothing to cap when the tools hold no advisor', () => {
    expect(capAdvisorPerTurn(hootProviderTools({ provider: 'openai', apiKey: 'k' }))).toBeUndefined();
  });
});
