/** @jest-environment node */

/**
 * The advisor is a provider-executed tool: Anthropic runs it, hoot never dispatches
 * it to an agent, and its result is the provider's own block. History repair must
 * not fake a result for it, and shared pages must not show it.
 */

import type { UIMessage } from 'ai';
import { repairDanglingToolParts } from '@/lib/hoot/repairMessages';
import { buildShareSnapshot } from '@/lib/hoot/shareSnapshot';

const danglingAdvisor = {
  type: 'tool-advisor',
  toolCallId: 'adv-1',
  state: 'input-available',
  input: {},
  providerExecuted: true,
};

const completedAdvisor = {
  ...danglingAdvisor,
  state: 'output-available',
  output: { type: 'advisor_redacted_result', encryptedContent: 'opaque' },
};

function supersededTurn(advisorPart: object): UIMessage[] {
  return [
    { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'why is the wall black?' }] },
    {
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Let me think this through.' }, advisorPart],
    },
    { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'still there?' }] },
  ] as unknown as UIMessage[];
}

describe('advisor parts in history repair', () => {
  it('drops a dangling advisor call instead of faking a result for it', () => {
    const { messages, repairedToolCallIds } = repairDanglingToolParts(supersededTurn(danglingAdvisor));

    expect(repairedToolCallIds).toEqual(['adv-1']);
    expect(messages[1].parts).toEqual([{ type: 'text', text: 'Let me think this through.' }]);
  });

  it('never asks the agent-result resolver about an advisor call', async () => {
    const resolveLostResult = jest.fn().mockResolvedValue(null);

    await repairDanglingToolParts(supersededTurn(danglingAdvisor), { resolveLostResult });

    expect(resolveLostResult).not.toHaveBeenCalled();
  });

  it('keeps a completed advisor call so the next request replays it', () => {
    const history = supersededTurn(completedAdvisor);
    const { messages, repairedToolCallIds } = repairDanglingToolParts(history);

    expect(repairedToolCallIds).toEqual([]);
    expect(messages).toEqual(history);
    expect(messages[1]).toBe(history[1]);
  });
});

describe('advisor parts in a shared snapshot', () => {
  it('leaves the advisor out of what a reader sees', () => {
    const snapshot = buildShareSnapshot({
      title: 'Black wall',
      targetLabel: 'MEDIA-01',
      messages: supersededTurn(completedAdvisor),
    });

    const tools = snapshot.messages.flatMap((m) => m.parts.filter((p) => p.type === 'tool'));
    expect(tools).toEqual([]);
  });
});
