/**
 * What leaves the machine, as data (docs/onboarding.md ONB-6,
 * docs/telemetry-posthog.md).
 *
 * This list is the ONE source of truth: the consent screen renders it, and the
 * sender may only send events named here, with properties named here. That is
 * the whole point of putting it in the leaf package both sides import. A screen
 * that promises less than the sender sends is the kind of lie nobody sets out
 * to tell; it happens when the promise and the code live in two files.
 *
 * The sink is PostHog Cloud EU (TEL-1). The sender lives in the main process
 * only, in `apps/desktop/src/main/telemetry.ts`.
 */

import { OPENING_STEPS } from './dtos.js';

/**
 * What a property may hold. The point of the closed set is that none of these
 * shapes can carry the PM's material: a count, a flag, one of a handful of
 * words we wrote ourselves, or an id from our own registry.
 *
 * `id` is the one shape checked by form rather than by list, because the set it
 * comes from grows: a connector's id is a name we write in code, never anything
 * the PM types, so a new connector reports itself with no edit here. The form
 * check ({@link TELEMETRY_ID_RE}) is what keeps a stray string out.
 *
 * `scrubbedText` is the one exception, and it exists for exactly one event: a
 * crash's name, message and stack. The caller must have run it through the log
 * scrubber first (`redactLogLine` in the main process, which is where the
 * scrubber lives); this end only truncates.
 */
export type TelemetryPropSpec =
  | { kind: 'count' }
  | { kind: 'flag' }
  | { kind: 'word'; values: readonly string[] }
  | { kind: 'id' }
  | { kind: 'scrubbedText'; max: number };

/** One event we would send, in the words the consent screen shows. */
export interface TelemetryEventSpec {
  /** Wire name. */
  id: string;
  /** What it says, in plain language — this text IS the screen's line. */
  says: string;
  /** Every property it may carry. Anything else is dropped before sending. */
  props: Readonly<Record<string, TelemetryPropSpec>>;
}

/** Which build sent it. Every event carries one, so a missing stamp cannot read as real. */
export const TELEMETRY_ENVS = ['beta', 'dev'] as const;
export type TelemetryEnv = (typeof TELEMETRY_ENVS)[number];

/**
 * How many, in bands. A raw count of anything the PM owns is a fingerprint;
 * a band answers "a few or hundreds", which is the only question we have.
 */
export const COUNT_BANDS = ['0', '1', '2-5', '6-20', '21-100', '100+'] as const;

/** How long something took. Same reasoning as the count bands. */
export const DURATION_BANDS = ['<5s', '5-30s', '30s-2m', '2-10m', '10m+'] as const;

/** How old something was when it was decided on. */
export const AGE_BANDS = ['<1m', '<1h', '<1d', '<1w', '1w+'] as const;

/** Put a count in its band. */
export function countBand(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n === 1) return '1';
  if (n <= 5) return '2-5';
  if (n <= 20) return '6-20';
  if (n <= 100) return '21-100';
  return '100+';
}

/** Put a duration in milliseconds in its band. */
export function durationBand(ms: number): string {
  if (!Number.isFinite(ms) || ms < 5_000) return '<5s';
  if (ms < 30_000) return '5-30s';
  if (ms < 120_000) return '30s-2m';
  if (ms < 600_000) return '2-10m';
  return '10m+';
}

/** Put an age in milliseconds in its band. */
export function ageBand(ms: number): string {
  if (!Number.isFinite(ms) || ms < 60_000) return '<1m';
  if (ms < 3_600_000) return '<1h';
  if (ms < 86_400_000) return '<1d';
  if (ms < 604_800_000) return '<1w';
  return '1w+';
}

/**
 * Skills we shipped, plus `custom` for everything else.
 *
 * A PM's own skill is named in their own words — "nordkap-weekly", "acme-qbr" —
 * so the name is their material and must not leave. {@link skillWord} folds
 * anything unrecognised into `custom`, which still answers the question worth
 * asking: are people writing their own, and do those sessions work.
 */
export const KNOWN_SKILLS = [
  'chat',
  'ask',
  'arrival',
  'process-note',
  'weekly-update',
  'synthesis',
  'commitment-check',
  'incoming-request',
  'spec',
  'iterate',
  'tell-qale',
  'house-rules',
  'librarian',
  'meeting-prep',
  'custom',
] as const;

/**
 * A skill name, folded to something we wrote.
 *
 * Takes a name or a slug: a skill is a folder, so the caller often holds
 * `skills/arrival` where the name is `arrival`. Reading the last segment keeps
 * a shipped skill from being counted as somebody's own.
 */
export function skillWord(name: string | null | undefined): string {
  const bare = name?.split('/').pop()?.trim();
  if (!bare) return 'custom';
  return (KNOWN_SKILLS as readonly string[]).includes(bare) ? bare : 'custom';
}

/** What started a session. */
export const SESSION_TRIGGERS = ['manual', 'scheduled', 'arrival'] as const;

/** The parts of the app a tab can be showing (the renderer's `ViewBody.kind`). */
export const VIEW_KINDS = [
  'home',
  'doc',
  'session',
  'sessionFile',
  'chats',
  'inbox',
  'todos',
  'memory',
  'folder',
  'context',
  'settings',
  'skills',
] as const;

/** Where a crash came from. */
export const CRASH_ORIGINS = ['main', 'promise', 'renderer', 'child'] as const;

/** How a proposal was decided. */
export const CARD_DECISIONS = ['accepted', 'rejected'] as const;

/** The kinds a card can be (`ProposalKind` in dtos, repeated as words we send). */
export const CARD_KINDS = ['note', 'update', 'decision', 'outbound'] as const;

/**
 * How material reached the tray, which is all we know at that point. What it
 * turns out to BE (a transcript, a spec, a colleague's call) is the agent's
 * judgment now and is never reported: it would be a fact about the PM's work.
 */
export const MATERIAL_KINDS = ['file', 'text', 'image'] as const;

/**
 * The shape an id must have to be sent: lower-case letters, digits and dashes,
 * short. Our own registry ids all look like this; a title, a path or an address
 * does not.
 */
export const TELEMETRY_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * What a provider reports itself as. The id in the connector registry is the
 * value, so a new connector needs no edit here. The exceptions are the words
 * that already ship: `google-calendar` has always gone out as `google`, and a
 * rename now would fork the dashboards it feeds.
 */
export const TELEMETRY_PROVIDER_WORDS: Readonly<Record<string, string>> = {
  'google-calendar': 'google',
};

/** The word telemetry reports one provider id by. */
export function providerWord(providerId: string): string {
  return TELEMETRY_PROVIDER_WORDS[providerId] ?? providerId;
}

/** What happened to an opening screen. */
export const ONBOARDING_ACTIONS = ['done', 'skipped', 'finished'] as const;

/**
 * What a codebase question would run on (docs/claude-code-tickets.md CC-10).
 *
 * These are the aliases the `claude` command line tool accepts, not the
 * workspace's own model list: two accounts, two catalogues. The words are
 * repeated here rather than imported because this package is the leaf both
 * sides read, and the consent screen renders them. `CODEBASE_MODELS` in
 * `@qale/agent` is the source, and a desktop test holds the two lists together.
 */
export const CODEBASE_MODEL_WORDS = ['sonnet', 'opus', 'fable'] as const;

/**
 * Every event, spelled out, with every property it may carry.
 *
 * Nothing here is a title, a path, a note's text, a prompt, an address, a
 * workspace name or anyone's name, and nothing may be added that is. The one
 * free-text property in the whole scheme is the crash text, which arrives
 * already scrubbed.
 */
export const TELEMETRY_EVENTS: readonly TelemetryEventSpec[] = [
  {
    id: 'app.launched',
    says: 'The app started, which version it is, and roughly how big the workspace is',
    props: {
      firstRun: { kind: 'flag' },
      onboardingFinished: { kind: 'flag' },
      hasKey: { kind: 'flag' },
      // One flag per connector, under the word it reports itself by
      // ({@link providerWord}). The producer builds these from the registry, so
      // adding a connector needs no edit there; the list stays closed HERE
      // because the consent screen renders these names, and a screen that says
      // "and whatever else we add later" promises nothing. A new connector is
      // still reported by `connection.added` from its first day.
      google: { kind: 'flag' },
      atlassian: { kind: 'flag' },
      notes: { kind: 'word', values: COUNT_BANDS },
      // The shape of the workspace, in bands: enough to answer "is this thing
      // being lived in", never enough to say what is in it.
      meetings: { kind: 'word', values: COUNT_BANDS },
      people: { kind: 'word', values: COUNT_BANDS },
      todos: { kind: 'word', values: COUNT_BANDS },
      // Skills the PM wrote themselves, counted, never named. The count is the
      // one fact worth having: are people building on this or only using ours.
      customSkills: { kind: 'word', values: COUNT_BANDS },
    },
  },
  {
    id: 'app.crashed',
    says: 'It crashed, and where in the code',
    props: {
      origin: { kind: 'word', values: CRASH_ORIGINS },
      name: { kind: 'scrubbedText', max: 100 },
      message: { kind: 'scrubbedText', max: 300 },
      stack: { kind: 'scrubbedText', max: 2000 },
    },
  },
  {
    id: 'session.finished',
    says: 'A session finished, how long it took, and whether it failed',
    props: {
      skill: { kind: 'word', values: KNOWN_SKILLS },
      trigger: { kind: 'word', values: SESSION_TRIGGERS },
      duration: { kind: 'word', values: DURATION_BANDS },
      failed: { kind: 'flag' },
      cards: { kind: 'word', values: COUNT_BANDS },
      // Whether the run parked a question for the PM. The flag only; the
      // question itself is the agent talking about their work and never leaves.
      asked: { kind: 'flag' },
    },
  },
  {
    id: 'round.sent',
    says: 'You sent your comments on a working document back to a session, and how many boxes you filled in',
    props: {
      skill: { kind: 'word', values: KNOWN_SKILLS },
      // How much of the round the PM answered, in bands. The question the two
      // together answer is whether the shape works: a round where one box in
      // ten gets a reply is asking about the wrong things. Neither the prompts
      // nor a word of what was typed goes anywhere near this.
      slots: { kind: 'word', values: COUNT_BANDS },
      answered: { kind: 'word', values: COUNT_BANDS },
      // Whether the general box at the foot of the document was used at all.
      general: { kind: 'flag' },
    },
  },
  {
    id: 'card.decided',
    says: 'A card was approved or passed on, never what was in it',
    props: {
      decision: { kind: 'word', values: CARD_DECISIONS },
      kind: { kind: 'word', values: CARD_KINDS },
      edited: { kind: 'flag' },
      age: { kind: 'word', values: AGE_BANDS },
    },
  },
  {
    id: 'material.added',
    says: 'Material was added, and how many pieces',
    props: {
      kind: { kind: 'word', values: MATERIAL_KINDS },
      count: { kind: 'word', values: COUNT_BANDS },
      startedSession: { kind: 'flag' },
    },
  },
  {
    id: 'connection.added',
    says: 'A service was connected, which service it was, and how much of it you follow, never which site',
    props: {
      provider: { kind: 'id' },
      following: { kind: 'word', values: COUNT_BANDS },
    },
  },
  {
    id: 'onboarding.step',
    says: 'How far through this setup you got',
    props: {
      step: { kind: 'word', values: OPENING_STEPS },
      action: { kind: 'word', values: ONBOARDING_ACTIONS },
    },
  },
  {
    id: 'codebase.asked',
    says: 'The agent asked to read your code, which model it would use and whether you said yes, never which repo or what it asked',
    props: {
      model: { kind: 'word', values: CODEBASE_MODEL_WORDS },
      // Whether the question continued an earlier Claude Code session. A resume
      // keeps the model that session started with, so the card shows no picker.
      resumed: { kind: 'flag' },
      approved: { kind: 'flag' },
    },
  },
  {
    id: 'view.opened',
    says: 'Which parts of the app you open and roughly how many tabs sit open, never what is in them',
    props: {
      view: { kind: 'word', values: VIEW_KINDS },
      tabs: { kind: 'word', values: COUNT_BANDS },
    },
  },
] as const;

/**
 * Who we know you are, said plainly (TEL-4). This is a hand-picked beta: when
 * something breaks we want to be able to write to the person it broke for.
 * That is a real cost to them, so it is stated rather than buried.
 */
export const TELEMETRY_IDENTITY =
  'Your name and work email, so we know which beta user hit which bug';

/** Where it goes. "Anonymous, to somebody" is a weaker promise than it looks. */
export const TELEMETRY_PROCESSOR =
  'It goes to PostHog, an analytics service, on servers in Europe, and nowhere else.';

/**
 * The context every report carries besides its own properties: the build facts,
 * which part of the app was open at the time (a word from {@link VIEW_KINDS},
 * the same closed set `view.opened` uses), and a random id minted fresh each
 * time the app starts. The screen renders this line so the promise covers the
 * stamps as well as the events. None of it can carry the PM's material: the
 * view is a word we wrote, the run id is random.
 */
export const TELEMETRY_CONTEXT =
  'Every report also says which part of the app was open at the time, and which sitting it belongs to, so one session of use reads together.';

/**
 * What this switch does NOT cover (OW10). A heading reading "What leaves your
 * machine" over a switch reads like the complete answer, and it is only the
 * usage reports. So the two channels it does not close are named in the open,
 * never behind the fold: a limit nobody sees is a limit nobody was told.
 */
export const TELEMETRY_LIMIT =
  'This covers these reports only. When the agent works, the notes it reads still go to the model provider you chose, and anything you connect keeps talking to its own service.';

/** The other half of the promise, said as plainly as the list above. */
export const TELEMETRY_NEVER: readonly string[] = [
  'Anything you or the agent wrote',
  'Note titles, file names or folder paths',
  'What you type into the app, and what the model types back',
  'Anyone else’s name or address, including everyone in your notes and meetings',
  'Your keys',
] as const;

/** Names in the allowlist, for the sender to check itself against. */
export const TELEMETRY_EVENT_IDS: readonly string[] = TELEMETRY_EVENTS.map((e) => e.id);

/** The spec for one event, or undefined if it is not one of ours. */
export function telemetryEvent(event: string): TelemetryEventSpec | undefined {
  return TELEMETRY_EVENTS.find((e) => e.id === event);
}

/**
 * Would this event be sent? The consent switch and the allowlist, in one call.
 *
 * An event not on the list above is refused here, so the screen's promise holds
 * no matter who writes a caller later.
 */
export function telemetryAllows(consented: boolean, event: string): boolean {
  return consented && TELEMETRY_EVENT_IDS.includes(event);
}

/** What survives the filter: the shapes PostHog gets, and nothing else. */
export type TelemetryValue = string | number | boolean;

/**
 * Keep only the properties this event declares, in the shape it declares them.
 *
 * This is the rule that makes "a future caller cannot leak a note title" true
 * in code rather than in a comment: a property nobody named is dropped, a word
 * outside its list is dropped, an id that is not id-shaped is dropped, and the
 * one free-text shape is truncated. It never throws: a bad property loses
 * itself, it does not lose the event.
 */
export function filterTelemetryProps(
  event: string,
  props: Readonly<Record<string, unknown>> | undefined,
): Record<string, TelemetryValue> {
  const spec = telemetryEvent(event);
  const out: Record<string, TelemetryValue> = {};
  if (!spec || !props) return out;

  for (const [key, value] of Object.entries(props)) {
    const shape = spec.props[key];
    if (!shape || value === undefined || value === null) continue;
    switch (shape.kind) {
      case 'count':
        if (typeof value === 'number' && Number.isFinite(value)) out[key] = Math.round(value);
        break;
      case 'flag':
        if (typeof value === 'boolean') out[key] = value;
        break;
      case 'word':
        if (typeof value === 'string' && shape.values.includes(value)) out[key] = value;
        break;
      case 'id':
        if (typeof value === 'string' && TELEMETRY_ID_RE.test(value)) out[key] = value;
        break;
      case 'scrubbedText':
        if (typeof value === 'string') out[key] = value.slice(0, shape.max);
        break;
    }
  }
  return out;
}
