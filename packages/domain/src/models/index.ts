/**
 * Which model answers, and whose API it belongs to.
 *
 * The workspace talks to ONE provider at a time. Both are bring-your-own-key,
 * so the choice is really a choice of which key you hold: an Anthropic key
 * reaches Claude, a Gemini key reaches Google. Nothing in the product mixes
 * them, and nothing falls back from one to the other. A run that cannot reach
 * the chosen provider stops and says so.
 *
 * The list below is short on purpose. pi carries dozens of models per provider,
 * most of them dated snapshots, retired families and preview builds for jobs
 * this product never does (images, speech, robotics). Offering all of them made
 * the picker a catalogue and the choice a research task. What is here is the
 * current flagship and the models a PM has a real reason to move a session to.
 *
 * The ids have to exist in pi's own catalogue or a session cannot be routed at
 * all, so this table follows pi rather than the provider's release notes. The
 * agent checks the two against each other at startup and says which id went
 * missing.
 */

/** The providers a workspace can be pointed at, in the order the UI offers them. */
export const LLM_PROVIDERS = ['anthropic', 'google'] as const;

export type LlmProvider = (typeof LLM_PROVIDERS)[number];

/** What a workspace uses until anyone says otherwise. */
export const DEFAULT_PROVIDER: LlmProvider = 'anthropic';

/** One row of the picker. */
export interface LlmModel {
  /** The id pi routes on. */
  id: string;
  /** What it is called wherever a person reads it. */
  label: string;
  /** One line on when to reach for it. Shown under the label in Settings. */
  note: string;
}

export interface LlmProviderInfo {
  id: LlmProvider;
  /** The company, as the copy names it ("your notes go to Anthropic"). */
  name: string;
  /** The models as a family, for the places that name the thing not the seller. */
  family: string;
  /** Where the key comes from, said so somebody can go and get one. */
  keyUrl: string;
  /** What a key from there looks like, as the field's placeholder. */
  keyPlaceholder: string;
  /**
   * What the picker offers, best first. The first entry is the default for the
   * provider: what new sessions open on until somebody changes it.
   */
  models: LlmModel[];
}

export const LLM_PROVIDER_INFO: Record<LlmProvider, LlmProviderInfo> = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    family: 'Claude',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyPlaceholder: 'sk-ant-…',
    models: [
      {
        id: 'claude-opus-5',
        label: 'Claude Opus 5',
        note: 'The best at long agentic work. What this product is built around.',
      },
      {
        id: 'claude-sonnet-5',
        label: 'Claude Sonnet 5',
        note: 'Faster and cheaper. Good for tidying, filing and short questions.',
      },
      {
        id: 'claude-fable-5',
        label: 'Claude Fable 5',
        note: 'Tuned for writing. Worth it when the session drafts prose someone reads.',
      },
    ],
  },
  google: {
    id: 'google',
    name: 'Google',
    family: 'Gemini',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyPlaceholder: 'AIza…',
    models: [
      {
        id: 'gemini-3.1-pro-preview',
        label: 'Gemini 3.1 Pro',
        note: 'Google’s strongest reasoning model. A preview build, so it can change.',
      },
      {
        id: 'gemini-3.6-flash',
        label: 'Gemini 3.6 Flash',
        note: 'Faster and much cheaper. Good for tidying, filing and short questions.',
      },
    ],
  },
};

/** The provider record, for a tag that may have come off disk. */
export function llmProvider(id: string | null | undefined): LlmProvider {
  return LLM_PROVIDERS.includes(id as LlmProvider) ? (id as LlmProvider) : DEFAULT_PROVIDER;
}

/** What a provider is called where a person reads it ("Anthropic", "Google"). */
export function providerName(id: string | null | undefined): string {
  return LLM_PROVIDER_INFO[llmProvider(id)].name;
}

/** What new sessions open on for this provider. */
export function defaultModelId(id: string | null | undefined): string {
  return LLM_PROVIDER_INFO[llmProvider(id)].models[0]!.id;
}

/** The models this provider offers, best first. */
export function providerModels(id: string | null | undefined): LlmModel[] {
  return LLM_PROVIDER_INFO[llmProvider(id)].models;
}

/**
 * Which provider a model id belongs to, or null for an id we do not offer. A
 * settings file carried over from an older build names a model that may now be
 * gone, and "gone" has to be tellable from "the other provider's".
 */
export function providerOfModel(modelId: string | null | undefined): LlmProvider | null {
  if (!modelId) return null;
  for (const provider of LLM_PROVIDERS) {
    if (LLM_PROVIDER_INFO[provider].models.some((m) => m.id === modelId)) return provider;
  }
  return null;
}

/**
 * The model this provider should run: the wanted one when it is theirs, their
 * default otherwise. This is what keeps a provider switch from leaving a Claude
 * id in force on a Gemini key.
 */
export function modelForProvider(provider: LlmProvider, wanted: string | null | undefined): string {
  return providerOfModel(wanted) === provider ? wanted! : defaultModelId(provider);
}
