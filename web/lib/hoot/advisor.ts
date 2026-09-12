/**
 * Escalation for hard problems. Anthropic's advisor tool lets the working model
 * (Claude Sonnet 5 by default) consult Claude Opus 5 mid-turn when it judges a
 * problem needs it. The working model decides when; hoot allows one consultation per
 * model call and two per reply, each billed at Opus 5 rates to the user's own key.
 * Server-side only.
 *
 * Opus 5 advice comes back encrypted (`advisor_redacted_result`): hoot never reads it,
 * only replays it. Once a conversation holds advisor results, every later request must
 * still offer the tool or the API rejects it — so a turn that can't offer it (another
 * provider, or a model outside the pairing table) sends its history without them.
 */

import { anthropic } from '@ai-sdk/anthropic';
import type { ModelMessage, PrepareStepFunction, StepResult, ToolSet, UIMessage } from 'ai';
import type { LlmConfig } from '@/lib/llm';
import { ADVISOR_TOOL_NAME, advisorModelFor, resolveModelId } from '@/lib/llmModels';

/** Consultations per model call; a run makes several — see capAdvisorPerTurn. */
const ADVISOR_MAX_USES_PER_CALL = 1;

/**
 * Consultations per reply, across all of its model calls — and across a pause for a
 * tier-3 approval, which resumes the same reply in a new run.
 */
const ADVISOR_MAX_USES_PER_TURN = 2;

const ADVISOR_PART_TYPE = `tool-${ADVISOR_TOOL_NAME}`;

/** Provider-executed tools for this config: the advisor, when the model may consult one. */
export function hootProviderTools(config: LlmConfig): ToolSet {
  const advisorModel = advisorModelFor(
    config.provider,
    resolveModelId(config.provider, config.model),
  );
  if (!advisorModel) return {};
  return {
    [ADVISOR_TOOL_NAME]: anthropic.tools.advisor_20260301({
      model: advisorModel,
      maxUses: ADVISOR_MAX_USES_PER_CALL,
      caching: { type: 'ephemeral', ttl: '5m' },
    }),
  };
}

/**
 * A hoot run's tools plus the advisor when its model may consult one, with the
 * `prepareStep` that caps it — together, so no call site offers the advisor uncapped.
 * `usedBefore` is what the reply spent before a tier-3 approval paused it.
 */
export function withAdvisor(
  config: LlmConfig,
  tools: ToolSet,
  usedBefore = 0,
): { tools: ToolSet; prepareStep: PrepareStepFunction<ToolSet> | undefined } {
  const all: ToolSet = { ...tools, ...hootProviderTools(config) };
  return { tools: all, prepareStep: capAdvisorPerTurn(all, usedBefore) };
}

type UIMessagePart = UIMessage['parts'][number];

function isAdvisorPart(part: UIMessagePart): boolean {
  return part.type === ADVISOR_PART_TYPE;
}

/** A consultation that failed — the advisor overloaded, or over the per-call cap. */
function isFailedAdvisorPart(part: UIMessagePart): boolean {
  return isAdvisorPart(part) && (part as { state?: string }).state === 'output-error';
}

/**
 * Advisor calls a stored message already holds. A run resuming a reply after a tier-3
 * approval continues that assistant message, so its calls count toward the reply's two.
 */
export function advisorCallsIn(message: UIMessage | undefined): number {
  return message?.role === 'assistant' ? message.parts.filter(isAdvisorPart).length : 0;
}

/**
 * A turn's stored history as its model sees it. A request that can't offer the advisor
 * gets every advisor part removed — the API rejects advice without the tool. One that
 * can still loses failed consultations: they carry no advice, and a stored error can't
 * be replayed (the provider checks it against the advice schema and throws). A message
 * left with no parts is dropped; the input comes back unchanged when nothing matches.
 */
export function modelHistoryFor(messages: UIMessage[], offersAdvisor: boolean): UIMessage[] {
  const drop = offersAdvisor ? isFailedAdvisorPart : isAdvisorPart;
  if (!messages.some((m) => m.parts.some(drop))) return messages;
  const kept: UIMessage[] = [];
  for (const message of messages) {
    const parts = message.parts.filter((part) => !drop(part));
    if (parts.length === message.parts.length) kept.push(message);
    else if (parts.length > 0) kept.push({ ...message, parts });
  }
  return kept;
}

/** Every advisor part removed from model messages: a step's prompt, partway through a turn. */
function withoutAdvisorContent(messages: ModelMessage[]): ModelMessage[] {
  return messages.flatMap((message): ModelMessage[] => {
    if (message.role !== 'assistant' && message.role !== 'tool') return [message];
    if (typeof message.content === 'string') return [message];
    const parts: ReadonlyArray<object> = message.content;
    const kept = parts.filter(
      (part) => (part as { toolName?: unknown }).toolName !== ADVISOR_TOOL_NAME,
    );
    if (kept.length === parts.length) return [message];
    return kept.length > 0 ? [{ ...message, content: kept } as ModelMessage] : [];
  });
}

/** A step that ended on an advisor call with no result yet — a consultation the API paused. */
function hasOpenAdvisorCall<TOOLS extends ToolSet>(step: StepResult<TOOLS>): boolean {
  const settled = new Set<string>();
  for (const part of step.content) {
    if (part.type === 'tool-result' || part.type === 'tool-error') settled.add(part.toolCallId);
  }
  return step.toolCalls.some(
    (call) => call.toolName === ADVISOR_TOOL_NAME && !settled.has(call.toolCallId),
  );
}

/**
 * `prepareStep` holding a reply to ADVISOR_MAX_USES_PER_TURN consultations: `maxUses`
 * caps a single model call, and a run makes several (up to its stopWhen limit).
 * `usedBefore` is what the reply spent before a tier-3 approval paused it
 * (advisorCallsIn). Attempts count, failed ones included. Once they are used, later
 * steps run without the tool — and without the advice blocks, which the API rejects
 * once the tool is gone — except straight after a step that ended on a consultation
 * still awaiting its result: the SDK resumes that call in the next step, which needs
 * the tool. Undefined when the tools hold no advisor.
 */
export function capAdvisorPerTurn<TOOLS extends ToolSet>(
  tools: TOOLS,
  usedBefore = 0,
): PrepareStepFunction<TOOLS> | undefined {
  if (!(ADVISOR_TOOL_NAME in tools)) return undefined;
  const otherTools = Object.keys(tools).filter((name) => name !== ADVISOR_TOOL_NAME);
  return ({ steps, messages }) => {
    const last = steps[steps.length - 1];
    if (last && hasOpenAdvisorCall(last)) return undefined;
    const used = steps.reduce(
      (count, step) =>
        count + step.toolCalls.filter((call) => call.toolName === ADVISOR_TOOL_NAME).length,
      usedBefore,
    );
    if (used < ADVISOR_MAX_USES_PER_TURN) return undefined;
    return { activeTools: otherTools, messages: withoutAdvisorContent(messages) };
  };
}
