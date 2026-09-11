/**
 * Model ids, defaults and advisor pairing for hoot's LLM providers. Plain data with
 * no provider SDK imports, so the server (web/lib/llm.ts, the hoot runtime) and
 * client components (the settings dialog) share one list.
 */

export type LlmProvider = 'anthropic' | 'openai';

/** The model a user gets when their stored LLM settings name none. */
export const DEFAULT_MODELS: Record<LlmProvider, string> = {
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-4.1',
};

/** Fallback model list for the settings UI when the provider's live list can't be fetched. */
export const AVAILABLE_MODELS: Record<LlmProvider, { id: string; name: string }[]> = {
  anthropic: [
    { id: 'claude-sonnet-5', name: 'Claude Sonnet 5' },
    { id: 'claude-opus-5', name: 'Claude Opus 5' },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
    { id: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
    { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
    { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
    { id: 'claude-opus-4-5', name: 'Claude Opus 4.5' },
    { id: 'claude-sonnet-4-0', name: 'Claude Sonnet 4' },
    { id: 'claude-opus-4-0', name: 'Claude Opus 4' },
  ],
  openai: [
    { id: 'gpt-4.1', name: 'GPT-4.1' },
    { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
    { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano' },
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    { id: 'o3', name: 'o3' },
    { id: 'o4-mini', name: 'o4 Mini' },
  ],
};

/** The model hoot consults on hard problems through Anthropic's advisor tool. */
export const ADVISOR_MODEL = 'claude-opus-5';

/** How the chat names the advisor model. */
export const ADVISOR_MODEL_NAME = 'Claude Opus 5';

/** Tool key the advisor is registered under; its UI message parts are `tool-advisor`. */
export const ADVISOR_TOOL_NAME = 'advisor';

/**
 * Executors that consult claude-opus-5: the models below it in the advisor tool's
 * pairing table. Its peers there — Opus 5 itself, Fable 5, Fable 5.1 and the Mythos
 * models — are left out on purpose: consulting a peer costs more for no gain. Older
 * models fall outside the table, so they get no advisor.
 */
const ADVISOR_EXECUTORS: ReadonlySet<string> = new Set([
  'claude-haiku-4-5',
  'claude-sonnet-4-6',
  'claude-sonnet-5',
  'claude-opus-4-6',
  'claude-opus-4-7',
  'claude-opus-4-8',
]);

/** A dated snapshot id (`claude-haiku-4-5-20251001`) names the same model as its alias. */
const SNAPSHOT_DATE_SUFFIX = /-\d{8}$/;

/** The model id a request will actually use. */
export function resolveModelId(provider: LlmProvider, model?: string): string {
  return model || DEFAULT_MODELS[provider];
}

/**
 * The model the settings dialog pre-selects from a provider's list: the default when
 * the list offers it, else the list's first entry. Anthropic's live list runs newest
 * release first, which is not necessarily the model hoot defaults to.
 */
export function preselectedModel(provider: LlmProvider, models: readonly { id: string }[]): string {
  const preferred = DEFAULT_MODELS[provider];
  return models.some((m) => m.id === preferred) ? preferred : (models[0]?.id ?? preferred);
}

/** The advisor model this executor may consult, or null when hoot offers none. */
export function advisorModelFor(provider: LlmProvider, modelId: string): string | null {
  if (provider !== 'anthropic') return null;
  return ADVISOR_EXECUTORS.has(modelId.replace(SNAPSHOT_DATE_SUFFIX, '')) ? ADVISOR_MODEL : null;
}
