import { parse as parseYaml } from 'yaml';

/**
 * A **runnable** — one file the workspace configures the model with, whether it
 * sits in `skills/` (you reach for it) or `agents/` (it reaches for itself).
 * One parser for both: the folder is filing, not a type.
 *
 * A runnable is three things, and only one of them is prose:
 *
 * - **instructions** — the whole body, verbatim. No heading vocabulary, no
 *   sections the parser blesses, nothing dropped. What you write is what the
 *   model gets.
 * - **`starts`** — what puts it in force.
 * - **`can`** — what it is allowed to do.
 *
 * This replaced a file that forced its structure into the writing: four
 * required headings (`## When/Read/Produce/Then`, and anything outside them
 * never reached the model at all), a `## When` that hand-copied the app's
 * clockwork into the prompt where it drifted, and guardrails split between YAML
 * keys and paragraphs saying the same thing. Configuration is config now, and
 * prose is just prose.
 */

/**
 * What puts a runnable in force.
 *
 * A file declares only the doors a person or the model can open. Self-starting
 * clocks (every 5 minutes, before a meeting, when a decision is replaced) are
 * the app's and are declared in code beside the sweep that fires them — a
 * frontmatter trigger with no dispatch site behind it is a promise the file
 * cannot keep, which is exactly what the retired `on:` key was.
 */
export type Start =
  /** The PM picks it — the composer's skill picker. */
  | 'you-run-it'
  /** The model pulls it in mid-session (`use_skill`); it governs from there on. */
  | 'model-picks-it-up'
  /** In force in every session — voice registers, filing rules. */
  | 'always'
  /** Never in force: material the model may load and read when it's relevant. */
  | 'read-when-relevant';

const STARTS: Start[] = ['you-run-it', 'model-picks-it-up', 'always', 'read-when-relevant'];

/** A file that says nothing is one you run, or the model picks up. */
const DEFAULT_STARTS: Start[] = ['you-run-it', 'model-picks-it-up'];

/**
 * What a runnable may do beyond the two things every session can do — read the
 * memory, and propose cards the PM approves.
 *
 * Capabilities are PERMISSIONS, and the app layers permissions by the opposite
 * rule to the one it layers instructions by. Confusing the two is how a switch
 * quietly stops meaning anything, so both rules live here, once:
 *
 * - **Instructions widen as they narrow.** Preamble, always-on house rules, the
 *   file's own body, a skill that arrives mid-session: each is appended, and the
 *   narrower one wins where they disagree ({@link buildSkillBrief} says exactly
 *   that to the model).
 * - **Permissions only tighten as they narrow.** Between FILES a capability
 *   composes by OR (`SessionHarness.grants`): arrival adds, never subtracts,
 *   because pulling a quieter skill into an outbound session must not strip
 *   tools the session already had. That OR composes what files ASK for. What
 *   they get is bounded by floors no file can climb over, and each floor is
 *   enforced at ONE place so nothing downstream has to remember it:
 *
 *   - {@link Runnable.enabled}, the switch in the Skills and Agents views. It is
 *     enforced by `runnableEnabled` (@pm/application), asked by the single
 *     function that fires a session by name (main's `fireSession`) and again by
 *     each sweep that does judgment work before firing anything. Off means the
 *     file does not run, whatever its `can` list says.
 *   - The workspace's outbound connectors. `draft-outbound` says a session may
 *     draft; the connectors say whether a draft can reach anything. Enforced in
 *     the runtime's `toolNamesFor`, the one place a capability becomes a tool.
 */
export type Capability =
  /** Draft things that leave the workspace: Jira comments, pages, events. */
  | 'draft-outbound'
  /** Keep working files under `sessions/.files/<id>/`, and fan out into them. */
  | 'keep-working-files';

const CAPABILITIES: Capability[] = ['draft-outbound', 'keep-working-files'];

export interface Runnable {
  /** The invocation name — its filename slug. Not in frontmatter: nothing to drift. */
  name: string;
  /**
   * What a human calls it ("Prep a meeting"). Frontmatter `title`, else the
   * filename made readable. Kept apart from {@link name} because the name is an
   * address the runtime resolves and the title is copy the PM reads — a picker
   * showing the address is showing plumbing.
   */
  title: string;
  summary: string;
  /** What puts it in force. Never empty — a file with no `starts` is one you run. */
  starts: Start[];
  /** What it may do. Empty is the floor: read, and propose cards. */
  can: Capability[];
  /** `always` only — scope the rule to a named audience ("executives"). */
  audience?: string;
  /**
   * The off switch, written into frontmatter by the views. The file is the
   * config, so switching something off is an edit anyone can read and git
   * records.
   */
  enabled: boolean;
  /** Frontmatter problems, surfaced on the file's page (validation, not fatal). */
  errors: string[];
  /** The instructions — the body with frontmatter stripped, untouched. */
  body: string;
  raw: string;
}

/**
 * Keys that MOVED. Still honoured, and still flagged: a workspace is only
 * seeded once, so files written against the old vocabulary are sitting on disk
 * everywhere, and dropping their config would quietly turn a house rule into a
 * playbook nobody runs. The file's page says what to write instead; until
 * someone does, it keeps working.
 */
const MOVED_KEYS: Record<string, string> = {
  use: '`use` moved — write `starts: [you-run-it, model-picks-it-up]`, `[always]`, or `[read-when-relevant]`. Read as before until you do.',
  outbound: '`outbound: true` moved — write `can: [draft-outbound]`. Read as before until you do.',
  session_files: '`session_files: true` moved — write `can: [keep-working-files]`. Read as before until you do.',
};

/**
 * Keys that are simply gone: the machinery behind them was deleted, so there is
 * nothing left to honour. A key that quietly stopped being read is worse than
 * one that errors — the file still looks configured — so each names what to do
 * instead.
 */
const RETIRED_KEYS: Record<string, string> = {
  checkpoints: '`checkpoints` is gone — ask for the order you want in the instructions',
  gate_output: '`gate_output` is gone — ask for the order you want in the instructions',
  completion_bar: '`completion_bar` is gone — say the bar in the instructions',
  stopping_conditions: '`stopping_conditions` is gone — say when to stop in the instructions',
  red_flags: '`red_flags` is gone — say what to push back on in the instructions',
  on: '`on` is not read — what starts an agent is the app’s clockwork, shown on its page',
  skill_kind: '`skill_kind` is gone — a file declares `starts` and `can`',
  bindings: '`bindings` is gone — a file declares `starts` and `can`',
  tier: '`tier` is gone — a file declares `starts` and `can`',
};

const FRONTMATTER_RE = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Split a file into its YAML frontmatter and markdown body. */
function split(raw: string): { fm: Record<string, unknown>; body: string } {
  const m = raw.match(FRONTMATTER_RE);
  if (!m) return { fm: {}, body: raw };
  let fm: Record<string, unknown> = {};
  try {
    const parsed = parseYaml(m[1] ?? '');
    if (parsed && typeof parsed === 'object') fm = parsed as Record<string, unknown>;
  } catch {
    fm = {};
  }
  return { fm, body: raw.slice(m[0].length) };
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === 'string' && v.trim()) return [v.trim()];
  return [];
}

/**
 * Read one config list, keeping only values the app knows how to honour and
 * flagging the rest. An unknown value is dropped rather than passed through:
 * the runtime asks these lists what is allowed, and a typo must not read as a
 * capability.
 */
function readList<T extends string>(
  raw: unknown,
  allowed: T[],
  key: string,
  errors: string[],
): T[] {
  const out: T[] = [];
  for (const v of asStringArray(raw)) {
    if (allowed.includes(v as T)) {
      if (!out.includes(v as T)) out.push(v as T);
    } else {
      errors.push(`unknown ${key} "${v}" — one of: ${allowed.join(', ')}`);
    }
  }
  return out;
}

/**
 * The fallback display title: "before-meeting" → "Before meeting". Tolerates a
 * folder-qualified name ("skills/before-meeting") so a caller that hands over a
 * vault slug still gets a readable title rather than a path.
 */
function titleFromName(name: string): string {
  const last = name.split('/').pop() ?? name;
  const words = last.replace(/^_/, '').replace(/[-_]/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : name;
}

/**
 * Parse a runnable. Named by its FILENAME — `name` is the slug the caller read
 * it under, so there is no frontmatter name to keep in sync and nothing to
 * disagree about when they drift.
 */
export function parseRunnable(raw: string, name: string): Runnable {
  const { fm, body } = split(raw);
  const errors: string[] = [];

  for (const [key, message] of Object.entries({ ...MOVED_KEYS, ...RETIRED_KEYS })) {
    if (fm[key] !== undefined) errors.push(message);
  }

  const declared = readList(fm['starts'], STARTS, 'starts', errors);
  const starts =
    fm['starts'] !== undefined ? declared : (legacyStarts(fm['use']) ?? [...DEFAULT_STARTS]);
  // A `starts` that was written but parsed to nothing (every value a typo) must
  // not silently become a file nothing can reach. The errors are already
  // flagged; fall back to reachable rather than inert.
  if (starts.length === 0) starts.push(...DEFAULT_STARTS);

  const audience = typeof fm['audience'] === 'string' ? fm['audience'].trim() : '';
  if (audience && !starts.includes('always'))
    errors.push('`audience` scopes an always-on rule — this file does not declare `starts: [always]`');

  return {
    name,
    title: typeof fm['title'] === 'string' && fm['title'].trim() ? fm['title'].trim() : titleFromName(name),
    summary: typeof fm['summary'] === 'string' && fm['summary'].trim() ? fm['summary'].trim() : name,
    starts,
    can: [...readList(fm['can'], CAPABILITIES, 'can', errors), ...legacyCan(fm)].filter(
      (c, i, all) => all.indexOf(c) === i,
    ),
    ...(audience ? { audience } : {}),
    enabled: fm['enabled'] !== false,
    errors,
    body,
    raw,
  };
}

/** The old `use` axis read as starts. Null when the file doesn't carry one. */
function legacyStarts(use: unknown): Start[] | null {
  if (use === 'always') return ['always'];
  if (use === 'reference') return ['read-when-relevant'];
  if (use === 'playbook') return [...DEFAULT_STARTS];
  return null;
}

/** The old capability booleans, read as capabilities. */
function legacyCan(fm: Record<string, unknown>): Capability[] {
  const out: Capability[] = [];
  if (fm['outbound'] === true) out.push('draft-outbound');
  if (fm['session_files'] === true) out.push('keep-working-files');
  return out;
}

/** Whether this file governs a session, as opposed to being material it reads. */
export function governs(r: Runnable): boolean {
  return r.starts.some((s) => s !== 'read-when-relevant');
}

/** Whether a capability is granted. */
export function can(r: Runnable, capability: Capability): boolean {
  return r.can.includes(capability);
}

/**
 * A plain-language sentence for how a runnable applies, shown wherever one is
 * listed. Derived from `starts` so the words and the wiring cannot disagree.
 */
export function describeStarts(r: Runnable): string {
  if (r.starts.includes('always')) {
    return r.audience ? `Always applied when drafting for ${r.audience}.` : 'Always in effect.';
  }
  if (!governs(r)) return 'The agent reads it when it becomes relevant.';
  const doors: string[] = [];
  if (r.starts.includes('you-run-it')) doors.push('You run it from the composer');
  if (r.starts.includes('model-picks-it-up'))
    doors.push('the agent picks it up when the conversation becomes this work');
  return `${doors.join(', or ')}.`;
}

/**
 * The session system prompt: a shared preamble the caller owns (it belongs to
 * the agent runtime, keeping this package infra-free) and then the file's
 * instructions, whole and unedited.
 */
export function buildSystemPrompt(preamble: string, r: Runnable): string {
  const body = r.body.trim();
  return body ? `${preamble}\n\n${body}` : preamble;
}

/**
 * The text a runnable hands the model when it ARRIVES mid-session (via
 * `use_skill` or an explicit pick) rather than being baked in at creation. Same
 * instructions, wrapped in a line that says the rules are now in force — the
 * model must not read an arriving playbook as reference material it may weigh
 * against the session it is already in.
 */
export function buildSkillBrief(r: Runnable): string {
  const head = governs(r)
    ? `## Skill now in force: ${r.name} — ${r.summary}\nThese instructions govern the rest of this conversation. Follow them as you would your own; where they conflict with what you were told before, the more restrictive rule wins.`
    : `## Reference: ${r.summary}`;
  const body = r.body.trim();
  return body ? `${head}\n\n${body}` : `${head}\n\n_(This file has no instructions.)_`;
}
