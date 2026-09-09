/**
 * Which scripted turn answers this request (docs/plan-demo-replay.md,
 * section 4.4). Replaces the matcher that compared recorded text.
 *
 * A request is either a cheap single-turn call, answered by rule, or a
 * session turn. A session turn is classified by its first user message and
 * its system prompt (a kickoff names a skill, a child preamble names a child,
 * anything else was typed under whichever skill was in force), bound to the
 * first free conversation whose trigger matches, and served the turn at
 * index = the number of assistant messages the request already carries.
 *
 * The presenter picks a scenario by what he does, never by a button: a drop
 * is S1, a bare weekly-update pick is S5, a paste under Handle a commitment
 * is S3. So a typed opening is matched on the skill in force and, where two
 * scenarios share one, on a few words the `do` line makes him type. Beyond
 * that a typo or a paraphrase changes nothing, because the text is only
 * fingerprinted so the same session returns to the same binding.
 *
 * The per-run state is the bindings, plus a pin the lint uses to run one
 * scenario alone. Reset clears both. Nothing in the app pins.
 */
import { randomBytes } from 'node:crypto';
import { CHILD_PREAMBLE, stripCardState } from '@qale/agent';
import { BASE_SKILL_NAME, parseKickoff } from '@qale/sessions';
import { cheapAnswer, cheapKind, type CheapContext } from './cheap-answers.js';
import type { ContentBlock, WireMessage, WireResponse } from './replay-recordings.js';
import { summaryOf, type Conversation, type Scenario, type ScenarioSummary, type TriggerKind } from './scenario.js';
import { expandTable, expandText, renderTurn } from './script-templates.js';

/** What a request looks like once the server has read the body. */
export interface EngineRequest {
  system: string;
  messages: WireMessage[];
  model?: string;
}

/** What the server streams: the answer, and how long to wait before its first byte. */
export interface Served {
  response: WireResponse;
  pauseMs: number;
  /** Where the answer came from, for the console and the tests. */
  source: 'cheap' | 'script' | 'off-script';
}

export interface Binding {
  scenarioId: string;
  conversationId: string;
}

export interface ScriptEngineOptions {
  /** Today's distance from the anchor, the same number the vault was slid by. */
  offsetDays: number;
  /** What answers when no scenario says otherwise (`_fallback.json`). */
  fallbackText: string;
}

/**
 * Before the first byte of a turn, when the script does not say. Turn 0 waits
 * the way a real first answer does; a turn that only calls tools is quick; a
 * turn with text reads as thinking first.
 */
export const DEFAULT_PAUSE = { firstTurn: 1500, toolsOnly: 700, withText: 1200 } as const;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const TIMESTAMP = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g;
const DATE = /\d{4}-\d{2}-\d{2}/g;
const LONG_NUMBER = /\d{4,}/g;

/**
 * The text with everything that moves between runs replaced by a placeholder.
 * Order matters: a UUID holds digit runs, and a timestamp holds a date. This
 * is the fingerprint a binding is keyed on.
 */
export function normalise(text: string): string {
  return text
    .replace(UUID, '<uuid>')
    .replace(TIMESTAMP, '<ts>')
    .replace(DATE, '<date>')
    .replace(LONG_NUMBER, '<n>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The system prompt as one string, whether it came as text or as blocks. */
export function flattenSystem(system: unknown): string {
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) return system.map((b) => textOf(b)).join('\n');
  return '';
}

/** How many assistant messages the request carries. That is the turn to serve. */
export function assistantCount(messages: readonly WireMessage[]): number {
  return messages.filter((m) => m.role === 'assistant').length;
}

/**
 * The first user message, as a person or the app wrote it: the card-state
 * envelope the runtime prepends from the second turn on is taken off, so the
 * fingerprint is the same on every turn of a session.
 */
export function firstUserText(messages: readonly WireMessage[]): string {
  const first = messages.find((m) => m.role === 'user');
  if (!first) return '';
  return stripCardState(typedText(first)).trim();
}

/** The line `buildSkillBrief` opens with when a skill arrives in a session. */
const SKILL_IN_FORCE = /^## Skill now in force: (\S+)/gm;

/**
 * The skill a typed message was sent under. Every skill that arrived in the
 * session is appended to the system prompt as a brief with this heading, so
 * the last heading is the one in force. No heading means nothing was picked,
 * which is the base skill: the runtime never appends that one.
 */
export function skillInForce(system: string): string {
  let last: string | undefined;
  for (const m of system.matchAll(SKILL_IN_FORCE)) last = m[1];
  return last ?? BASE_SKILL_NAME;
}

/** What starts this session, read off its first message and its system prompt. */
export function classify(first: string, system: string): { kind: TriggerKind; skill?: string } {
  const kickoff = parseKickoff(first);
  if (kickoff) return { kind: 'skill', skill: kickoff.skill };
  if (system.startsWith(firstLine(CHILD_PREAMBLE))) return { kind: 'child' };
  return { kind: 'typed', skill: skillInForce(system) };
}

export class ScriptEngine {
  private all: Scenario[] = [];
  private pinnedId: string | null = null;
  private readonly bindings = new Map<string, Binding>();
  private served = 0;

  constructor(private readonly opts: ScriptEngineOptions) {}

  /** Replace the scenarios. Bindings into scenarios that are gone are dropped. */
  load(scenarios: Scenario[]): void {
    this.all = [...scenarios].sort((a, b) => a.id.localeCompare(b.id));
    for (const [key, binding] of this.bindings) {
      if (!this.scenario(binding.scenarioId)) this.bindings.delete(key);
    }
    if (this.pinnedId && !this.scenario(this.pinnedId)) this.pinnedId = null;
  }

  scenarios(): ScenarioSummary[] {
    return this.all.map(summaryOf);
  }

  /**
   * Pin one scenario, or null to search them all in id order. Unknown ids are
   * ignored. The lint uses this to run one scenario alone; the app never pins,
   * because the presenter picks the scenario by what he does.
   */
  pin(id: string | null): void {
    if (id !== null && !this.scenario(id)) {
      console.error(`[qale] demo: no scenario "${id}" to pin`);
      return;
    }
    this.pinnedId = id;
  }

  pinned(): string | null {
    return this.pinnedId;
  }

  /** Forget the pin and every binding. The scenarios stay loaded. */
  reset(): void {
    this.pinnedId = null;
    this.bindings.clear();
  }

  /** Exported for the tests: which conversation each first message is bound to. */
  boundTo(first: string): Binding | undefined {
    return this.bindings.get(normalise(first));
  }

  answer(request: EngineRequest): Served {
    const model = request.model ?? 'claude-opus-5';
    const kind = cheapKind(request.system);
    if (kind && assistantCount(request.messages) === 0) {
      const user = request.messages.find((m) => m.role === 'user');
      const text = cheapAnswer(kind, user ? typedText(user) : '', this.cheapContext());
      return { response: this.message(model, text, []), pauseMs: 0, source: 'cheap' };
    }

    const first = firstUserText(request.messages);
    const key = normalise(first);
    const binding = this.bindings.get(key) ?? this.bind(key, first, request.system);
    if (!binding) return this.offScript(model, this.scenario(this.pinnedId));

    const scenario = this.scenario(binding.scenarioId);
    const conversation = scenario?.conversations.find((c) => c.id === binding.conversationId);
    const index = assistantCount(request.messages);
    const turn = conversation?.turns[index];
    if (!scenario || !turn) return this.offScript(model, scenario);

    const rendered = renderTurn(turn, this.opts.offsetDays);
    const blocks: ContentBlock[] = rendered.tools.map((tool) => ({
      type: 'tool_use',
      id: `toolu_demo_${randomBytes(8).toString('hex')}`,
      name: tool.name,
      input: tool.input,
    }));
    const pauseMs =
      rendered.pause ??
      (index === 0
        ? DEFAULT_PAUSE.firstTurn
        : rendered.text
          ? DEFAULT_PAUSE.withText
          : DEFAULT_PAUSE.toolsOnly);
    return { response: this.message(model, rendered.text, blocks), pauseMs, source: 'script' };
  }

  /**
   * The first free conversation whose trigger matches, in the pinned scenario
   * or, with nothing pinned, in every scenario in id order. Null when there is
   * none, which binds nothing: the next request with the same opening asks
   * again.
   */
  private bind(key: string, first: string, system: string): Binding | null {
    const trigger = classify(first, system);
    const pool = this.pinnedId ? [this.scenario(this.pinnedId)].filter(isScenario) : this.all;
    const taken = new Set([...this.bindings.values()].map((b) => `${b.scenarioId}/${b.conversationId}`));
    for (const scenario of pool) {
      const free = scenario.conversations.find(
        (c) => !taken.has(`${scenario.id}/${c.id}`) && matches(c, trigger, first),
      );
      if (!free) continue;
      const binding = { scenarioId: scenario.id, conversationId: free.id };
      this.bindings.set(key, binding);
      return binding;
    }
    return null;
  }

  /** The scenario's own line, else the fallback, as one text block. Binds and advances nothing. */
  private offScript(model: string, scenario: Scenario | undefined): Served {
    const text = scenario?.offScript?.trim()
      ? expandText(scenario.offScript, this.opts.offsetDays)
      : this.opts.fallbackText;
    return {
      response: this.message(model, text, []),
      pauseMs: DEFAULT_PAUSE.withText,
      source: 'off-script',
    };
  }

  /**
   * What the cheap answers read: the lookups of every scenario in play (the
   * pinned one first, so its entry wins a duplicate key), and the titles of
   * the bound conversations.
   */
  private cheapContext(): CheapContext {
    const pinned = this.scenario(this.pinnedId);
    const pool = pinned ? [pinned, ...this.all.filter((s) => s !== pinned)] : this.all;
    const claims: Record<string, string> = {};
    const summaries: Record<string, string> = {};
    for (const scenario of pool) {
      for (const [k, v] of Object.entries(expandTable(scenario.lookups?.claims, this.opts.offsetDays)))
        claims[k] ??= v;
      for (const [k, v] of Object.entries(
        expandTable(scenario.lookups?.summaries, this.opts.offsetDays),
      ))
        summaries[k] ??= v;
    }
    return {
      lookups: { claims, summaries },
      titleFor: (first) => {
        const binding = this.bindings.get(normalise(first));
        if (!binding) return undefined;
        return this.scenario(binding.scenarioId)?.conversations.find(
          (c) => c.id === binding.conversationId,
        )?.title;
      },
    };
  }

  private message(model: string, text: string, tools: ContentBlock[]): WireResponse {
    this.served += 1;
    const content: ContentBlock[] = text ? [{ type: 'text', text }, ...tools] : tools;
    return {
      id: `msg_demo_${this.served}`,
      type: 'message',
      role: 'assistant',
      model,
      content,
      stop_reason: tools.length > 0 ? 'tool_use' : 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  }

  private scenario(id: string | null): Scenario | undefined {
    if (id === null) return undefined;
    return this.all.find((s) => s.id === id);
  }
}

/**
 * Does this conversation take this opening? A kickoff by skill name. A typed
 * message by the skill in force, when the script names one, and by the words
 * it lists, when it lists any. A child by kind alone.
 */
function matches(
  c: Conversation,
  trigger: { kind: TriggerKind; skill?: string },
  first: string,
): boolean {
  if (c.trigger.kind !== trigger.kind) return false;
  if (trigger.kind === 'skill') return c.trigger.skill === trigger.skill;
  if (trigger.kind === 'typed') {
    if (c.trigger.skill !== undefined && c.trigger.skill !== trigger.skill) return false;
    if (c.trigger.any) {
      const text = first.toLowerCase();
      if (!c.trigger.any.some((word) => text.includes(word.toLowerCase()))) return false;
    }
  }
  return true;
}

function isScenario(s: Scenario | undefined): s is Scenario {
  return s !== undefined;
}

/** What a person (or the app) typed into one message: the text blocks, never the tool results. */
function typedText(message: WireMessage): string {
  if (typeof message.content === 'string') return message.content;
  return message.content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n');
}

function textOf(block: unknown): string {
  if (typeof block === 'string') return block;
  if (Array.isArray(block)) return block.map((b) => textOf(b)).join('\n');
  if (!block || typeof block !== 'object') return '';
  const b = block as ContentBlock;
  if (typeof b.text === 'string') return b.text;
  if (b.content !== undefined) return textOf(b.content);
  return '';
}

function firstLine(text: string): string {
  return text.split('\n')[0] ?? '';
}
