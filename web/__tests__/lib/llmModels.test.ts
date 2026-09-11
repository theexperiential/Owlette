import {
  ADVISOR_MODEL,
  AVAILABLE_MODELS,
  DEFAULT_MODELS,
  advisorModelFor,
  preselectedModel,
  resolveModelId,
} from '@/lib/llmModels';

describe('model defaults', () => {
  it('gives Anthropic accounts Claude Sonnet 5 when they name no model', () => {
    expect(DEFAULT_MODELS.anthropic).toBe('claude-sonnet-5');
    expect(resolveModelId('anthropic')).toBe('claude-sonnet-5');
    expect(resolveModelId('anthropic', '')).toBe('claude-sonnet-5');
  });

  it('keeps a model the user chose', () => {
    expect(resolveModelId('anthropic', 'claude-haiku-4-5')).toBe('claude-haiku-4-5');
    expect(resolveModelId('openai')).toBe('gpt-4.1');
  });

  it('offers Sonnet 5 and Opus 5 in the settings fallback list', () => {
    expect(AVAILABLE_MODELS.anthropic.map((m) => m.id)).toEqual(
      expect.arrayContaining(['claude-sonnet-5', 'claude-opus-5']),
    );
    expect(preselectedModel('anthropic', AVAILABLE_MODELS.anthropic)).toBe('claude-sonnet-5');
  });
});

describe('preselectedModel', () => {
  it('picks Sonnet 5 from a live list that leads with a newer release', () => {
    const live = [{ id: 'claude-fable-5-1' }, { id: 'claude-opus-5' }, { id: 'claude-sonnet-5' }];
    expect(preselectedModel('anthropic', live)).toBe('claude-sonnet-5');
  });

  it('falls back to the first entry when the list lacks the default', () => {
    expect(preselectedModel('anthropic', [{ id: 'claude-opus-4-6' }, { id: 'claude-haiku-4-5' }])).toBe(
      'claude-opus-4-6',
    );
  });

  it('falls back to the default for an empty list', () => {
    expect(preselectedModel('openai', [])).toBe('gpt-4.1');
  });
});

describe('advisorModelFor', () => {
  it.each(['claude-sonnet-5', 'claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-8'])(
    '%s may consult Claude Opus 5',
    (model) => {
      expect(advisorModelFor('anthropic', model)).toBe(ADVISOR_MODEL);
      expect(ADVISOR_MODEL).toBe('claude-opus-5');
    },
  );

  it('pairs a dated snapshot as the model it snapshots', () => {
    expect(advisorModelFor('anthropic', 'claude-haiku-4-5-20251001')).toBe(ADVISOR_MODEL);
  });

  it('does not have Opus 5 consult itself', () => {
    expect(advisorModelFor('anthropic', 'claude-opus-5')).toBeNull();
  });

  it.each(['claude-sonnet-4-5', 'claude-sonnet-4-5-20250929', 'claude-opus-4-0'])(
    'leaves %s, outside the pairing table, without an advisor',
    (model) => {
      expect(advisorModelFor('anthropic', model)).toBeNull();
    },
  );

  it('never pairs an OpenAI model', () => {
    expect(advisorModelFor('openai', 'gpt-4.1')).toBeNull();
  });
});
