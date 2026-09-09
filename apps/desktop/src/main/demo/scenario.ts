/**
 * A demo scenario, as the script files under `demo/scenarios/` describe it
 * (docs/plan-demo-replay.md, section 4.1).
 *
 * One file per scenario. A scenario holds conversations; a conversation holds
 * turns; a turn says what the assistant says and which tools it calls. The
 * script engine serves the turns by index and the real tool runtime runs every
 * call, so every card on screen is real.
 *
 * Every date in a script is written in anchor time (`vault-dev/` frame), and
 * `script-templates.ts` slides it to the demo day at serve time.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** One tool call the assistant makes. The input is whatever the tool's schema takes. */
export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

/** One assistant turn: the text, the tool calls, and how long to wait first. */
export interface Turn {
  /** Milliseconds before the first byte. Defaults are in the script engine. */
  pause?: number;
  /** An array is joined with newlines, so a paragraph is one line per entry. */
  text?: string | string[];
  tools?: ToolCall[];
}

/**
 * What starts a conversation. `skill` is a kickoff the app composed (matched
 * by the skill name), `typed` is anything a person typed, `child` is a spawned
 * subagent.
 *
 * A typed opening is told apart by the skill in force when it was sent: the
 * skill picked with `/` before typing is in the system prompt, and nothing
 * picked means the base skill, `ask`. That is how S3 (pick Handle a
 * commitment, paste) and S4 (pick Iterate on something, type) bind to their
 * own scripts without a pin, in any order. `any` narrows it further, on a few
 * words the first message has to carry.
 */
export type TriggerKind = 'skill' | 'typed' | 'child';

export interface Trigger {
  kind: TriggerKind;
  /**
   * For `kind: skill`, the skill NAME `parseKickoff` returns (`arrival`). For
   * `kind: typed`, the skill in force when the message was typed: the folder
   * name of the picked skill (`commitment-check`), or `ask` for none.
   */
  skill?: string;
  /**
   * For `kind: typed` only. The first message must contain at least one of
   * these, compared case-insensitively, for the conversation to bind. A short
   * list of words the `do` line makes the presenter type.
   */
  any?: string[];
}

export interface Conversation {
  id: string;
  trigger: Trigger;
  /** What the naming call answers for this conversation. */
  title: string;
  turns: Turn[];
}

export interface ScenarioLookups {
  /** Keyed by a prefix of the claim text; the value is the one verdict line. */
  claims?: Record<string, string>;
  /** Keyed by the `origin=` path of the summary material; the value is the summary. */
  summaries?: Record<string, string>;
}

export interface Scenario {
  version: 1;
  id: string;
  title: string;
  /** What the presenter does to start it, shown on the Settings row. */
  do: string;
  /** What a request the script has no turn for is answered with. */
  offScript?: string;
  /**
   * True while the file is what `script-from-recording.ts` wrote and nobody
   * has edited it yet (docs/plan-demo-replay.md, section 4.7, step 2). Not
   * read by the engine; the lint and the author use it to tell a draft from a
   * finished script.
   */
  draft?: boolean;
  lookups?: ScenarioLookups;
  conversations: Conversation[];
}

/** The part of a scenario the Settings page draws. */
export interface ScenarioSummary {
  id: string;
  title: string;
  do: string;
}

export function summaryOf(scenario: Scenario): ScenarioSummary {
  return { id: scenario.id, title: scenario.title, do: scenario.do };
}

/** A turn's text as one string, whichever way the file wrote it. */
export function turnText(turn: Turn): string {
  if (turn.text === undefined) return '';
  return Array.isArray(turn.text) ? turn.text.join('\n') : turn.text;
}

const TRIGGER_KINDS: readonly TriggerKind[] = ['skill', 'typed', 'child'];

/**
 * Shape only: every field is there and has the right type. Whether a tool
 * exists or a template resolves is the lint's job, not the loader's.
 */
export function validateScenario(value: unknown): { errors: string[] } {
  const errors: string[] = [];
  const bad = (msg: string): void => {
    errors.push(msg);
  };
  if (!isRecord(value)) return { errors: ['the file is not a JSON object'] };
  if (value['version'] !== 1) bad('version must be 1');
  for (const key of ['id', 'title', 'do'] as const) {
    if (!nonEmptyString(value[key])) bad(`${key} must be a non-empty string`);
  }
  if (value['offScript'] !== undefined && typeof value['offScript'] !== 'string')
    bad('offScript must be a string');
  if (value['draft'] !== undefined && typeof value['draft'] !== 'boolean') bad('draft must be a boolean');
  if (value['lookups'] !== undefined) {
    if (!isRecord(value['lookups'])) bad('lookups must be an object');
    else {
      for (const key of ['claims', 'summaries'] as const) {
        const table = value['lookups'][key];
        if (table === undefined) continue;
        if (!isRecord(table) || !Object.values(table).every((v) => typeof v === 'string'))
          bad(`lookups.${key} must map strings to strings`);
      }
    }
  }
  const conversations = value['conversations'];
  if (!Array.isArray(conversations)) {
    bad('conversations must be an array');
    return { errors };
  }
  const ids = new Set<string>();
  conversations.forEach((c, i) => {
    const at = `conversations[${i}]`;
    if (!isRecord(c)) {
      bad(`${at} is not an object`);
      return;
    }
    if (!nonEmptyString(c['id'])) bad(`${at}.id must be a non-empty string`);
    else if (ids.has(c['id'])) bad(`${at}.id "${c['id']}" is used twice`);
    else ids.add(c['id']);
    if (!nonEmptyString(c['title'])) bad(`${at}.title must be a non-empty string`);
    const trigger = c['trigger'];
    if (!isRecord(trigger) || !TRIGGER_KINDS.includes(trigger['kind'] as TriggerKind))
      bad(`${at}.trigger.kind must be one of ${TRIGGER_KINDS.join(', ')}`);
    else {
      if (trigger['kind'] === 'skill' && !nonEmptyString(trigger['skill']))
        bad(`${at}.trigger.skill must name the skill`);
      else if (trigger['skill'] !== undefined && !nonEmptyString(trigger['skill']))
        bad(`${at}.trigger.skill must be a non-empty string`);
      const any = trigger['any'];
      if (any !== undefined) {
        if (trigger['kind'] !== 'typed') bad(`${at}.trigger.any is only for a typed trigger`);
        else if (!Array.isArray(any) || any.length === 0 || !any.every(nonEmptyString))
          bad(`${at}.trigger.any must be a non-empty array of non-empty strings`);
      }
    }
    const turns = c['turns'];
    if (!Array.isArray(turns) || turns.length === 0) {
      bad(`${at}.turns must be a non-empty array`);
      return;
    }
    turns.forEach((t, j) => validateTurn(t, `${at}.turns[${j}]`, bad));
  });
  return { errors };
}

function validateTurn(turn: unknown, at: string, bad: (msg: string) => void): void {
  if (!isRecord(turn)) {
    bad(`${at} is not an object`);
    return;
  }
  if (turn['pause'] !== undefined && !(typeof turn['pause'] === 'number' && turn['pause'] >= 0))
    bad(`${at}.pause must be a number of milliseconds`);
  const text = turn['text'];
  if (
    text !== undefined &&
    typeof text !== 'string' &&
    !(Array.isArray(text) && text.every((l) => typeof l === 'string'))
  )
    bad(`${at}.text must be a string or an array of strings`);
  const tools = turn['tools'];
  if (tools !== undefined) {
    if (!Array.isArray(tools)) bad(`${at}.tools must be an array`);
    else
      tools.forEach((tool, k) => {
        if (!isRecord(tool) || !nonEmptyString(tool['name']) || !isRecord(tool['input']))
          bad(`${at}.tools[${k}] needs a name and an input object`);
      });
  }
  if (text === undefined && (tools === undefined || (Array.isArray(tools) && tools.length === 0)))
    bad(`${at} has neither text nor tools`);
}

/**
 * Every scenario in the folder, sorted by id. A file whose name starts with
 * `_` is not a scenario. A file that will not parse or fails validation is
 * named on the console and skipped: one bad edit must not take the whole demo
 * down. A missing folder is an empty list.
 */
export function loadScenarios(dir: string): Scenario[] {
  if (!existsSync(dir)) return [];
  const out: Scenario[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json') || name.startsWith('_')) continue;
    const file = join(dir, name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      console.error(`[qale] skipped a scenario that will not parse: ${file}`, err);
      continue;
    }
    const { errors } = validateScenario(parsed);
    if (errors.length > 0) {
      console.error(`[qale] skipped a scenario with a bad shape: ${file}\n  ${errors.join('\n  ')}`);
      continue;
    }
    out.push(parsed as Scenario);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
