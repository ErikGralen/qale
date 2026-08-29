import { parse as parseYaml } from 'yaml';

/**
 * A **runnable** — one file the workspace configures the model with, whether it
 * sits in `skills/` (you reach for it) or `agents/` (it reaches for itself).
 * One parser for both: the folder is filing, not a type.
 *
 * A runnable is two things, and only one of them is prose:
 *
 * - **instructions** — the whole body, verbatim. No heading vocabulary, no
 *   sections the parser blesses, nothing dropped. What you write is what the
 *   model gets.
 * - **`can`** — what it is allowed to do.
 *
 * What puts a file in force is NOT in the file. Where it sits says it: a skill
 * is work you hand over and the model may pick up, a moment fires from the
 * app's own clockwork, an agent runs on a clock in code. A `starts:` key only
 * ever restated one of those, in a second vocabulary that could disagree with
 * the first, so it is gone (SK-2) and so is `audience:` with it.
 *
 * This replaced a file that forced its structure into the writing: four
 * required headings (`## When/Read/Produce/Then`, and anything outside them
 * never reached the model at all), a `## When` that hand-copied the app's
 * clockwork into the prompt where it drifted, and guardrails split between YAML
 * keys and paragraphs saying the same thing. Configuration is config now, and
 * prose is just prose.
 */

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
 *   - {@link Runnable.enabled}, the switch on the Agents view. It is enforced by
 *     `runnableEnabled` (@qale/application), asked by the single function that
 *     fires a session by name (main's `fireSession`) and again by each sweep
 *     that does judgment work before firing anything. Off means the agent does
 *     not run, whatever its `can` list says.
 *   - The workspace's outbound connectors. `draft-outbound` and `draft-calendar`
 *     say a session may draft; the connectors say whether a draft can reach
 *     anything. Enforced in the runtime's `toolNamesFor`, the one place a
 *     capability becomes a tool.
 *   - The workspace's connections. `track-external` says a session may
 *     put an item into the local mirror; without the connection there is nothing
 *     to mirror from. Enforced in `toolNamesFor` beside the one above.
 *
 * A capability is as narrow as the work that needs it. Several files draft
 * outbound and one of them books a meeting, so the calendar drafts are their own
 * capability rather than three tool schemas the others carry and never call.
 */
export type Capability =
  /** Draft things that leave the workspace: ticket comments and wiki pages. */
  | 'draft-outbound'
  /**
   * Draft calendar work: a new event, a move, an RSVP. Apart from
   * `draft-outbound` because a calendar write is a different act. A comment
   * answers somebody; an event puts a time in other people's days, and the
   * guests see it. One skill in the workspace books meetings, so the rest do
   * not carry the tools for it.
   */
  | 'draft-calendar'
  /** Keep working files under `sessions/.files/<id>/`, and fan out into them. */
  | 'keep-working-files'
  /**
   * Put material that has already arrived where it belongs, and correct that
   * later. The one write that is not a card, because it is not a claim: the PM
   * handed the file over, so filing it is carrying out an instruction rather
   * than proposing one, and a wrong shelf is fixed by moving it. Everything
   * DERIVED from the material is still a card.
   */
  | 'file-material'
  /**
   * Start watching a ticket or a wiki page, and record what the PM said about a
   * whole project or space. Nothing is written upstream, so this takes no
   * approval card. What it does write is SYNC STATE the workspace then keeps up
   * forever: a mirrored note, a container the app reads from now on, a "no"
   * remembered for good. Reading a connected system is not that, so its read
   * tools stay on the connection alone and every session keeps them.
   */
  | 'track-external';

const CAPABILITIES: Capability[] = [
  'draft-outbound',
  'draft-calendar',
  'keep-working-files',
  'file-material',
  'track-external',
];

/**
 * The plain words for each capability — the same ones the permission chip
 * shows (`CanChips` in the desktop app's `RunnableConfig.tsx`). Kept here,
 * not in the renderer, because the error path below needs them too: a person
 * fixing a broken file should read the same label whichever side of the app
 * told them about it.
 */
export const CAPABILITY_LABEL: Record<Capability, string> = {
  'draft-outbound': 'Drafts outgoing updates',
  'draft-calendar': 'Drafts calendar changes',
  'keep-working-files': 'Keeps working files',
  'file-material': 'Files what you hand over',
  'track-external': 'Watches your tracker and wiki',
};

/** "plain label (key)", the shape every capability list in an error uses. */
function labeled(capability: Capability): string {
  return `${CAPABILITY_LABEL[capability]} (${capability})`;
}

/**
 * How many single-character edits turn `a` into `b`. Used only to tell a typo
 * ("draft-outbund") from a value that is not a capability at all ("rm-rf"),
 * so the error can offer one close match instead of the whole list.
 */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) d[i]![0] = i;
  for (let j = 0; j < cols; j++) d[0]![j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
    }
  }
  return d[rows - 1]![cols - 1]!;
}

/** The one capability closest to `value`, if it is close enough to be a typo. */
function nearestCapability(value: string): Capability | null {
  let best: Capability | null = null;
  let bestDistance = Infinity;
  for (const c of CAPABILITIES) {
    const distance = editDistance(value, c);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = c;
    }
  }
  // A third of the key's length is a spelling mistake; more than that is a
  // different word, and offering it as "the one you meant" would mislead.
  return best && bestDistance <= Math.ceil(best.length / 3) ? best : null;
}

/**
 * The error for a `can` value that is not a capability. Leads with the plain
 * words a person recognises from the permission chip, and gives the key
 * second — the key is what fixes the file, but it should not be the whole
 * sentence.
 */
function unknownCapabilityMessage(value: string): string {
  const near = nearestCapability(value);
  if (near) {
    return `This skill asks for a permission that does not exist: "${value}". Did you mean "${CAPABILITY_LABEL[near]}" (can: [${near}])?`;
  }
  return `This skill asks for a permission that does not exist: "${value}". Choose one of: ${CAPABILITIES.map(labeled).join(', ')}.`;
}

/**
 * Tools that a broader capability used to bring, and now do not.
 *
 * This is the one kind of change `readList` cannot catch. An unknown value is a
 * typo and gets flagged; a value that stayed valid and quietly got NARROWER
 * leaves a file that parses clean and has lost tools it was written to call. A
 * skill from before the split still says `can: [draft-outbound]`, still reads as
 * configured, and its calendar step simply never happens.
 *
 * So the instructions are checked. A file that names one of these tools without
 * the capability that now gates it says so on its own page, in the same list as
 * every other frontmatter problem. Nothing else reads the body for meaning, and
 * this is the one thing worth reading it for: the PM cannot see a tool that was
 * never offered.
 */
const NARROWED: { tools: string[]; capability: Capability; came: string }[] = [
  {
    tools: ['draft_calendar_event', 'draft_calendar_reschedule', 'draft_calendar_rsvp'],
    capability: 'draft-calendar',
    came: 'with `draft-outbound`',
  },
  {
    tools: ['track_external', 'follow_container'],
    capability: 'track-external',
    came: 'with the workspace connection',
  },
];

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
  /**
   * What this file is for, written so the MODEL can match against it. The
   * summary is picker copy: "Reads a stack of interviews and says what they add
   * up to" tells a person what they are choosing and tells the model almost
   * nothing about when the conversation has turned into that work. A skill the
   * model never reaches for fails silently, because the session just carries on
   * freehand and nobody finds out.
   *
   * So each entry is one short "use when" clause plus the verbatim sentence a
   * PM would actually type, in brackets after it. The clause is what makes the
   * match generalize (the model matches the shape of the task); the sentence is
   * what makes it concrete. Write two or three, and write them so the siblings
   * cannot both claim them: "file this transcript" is arrival's, not
   * synthesis's.
   *
   * Empty is fine and is not an error: a file the PM only ever runs by name
   * needs no trigger. The agent runtime's `skillIndex()` renders these under the
   * summary in the on-demand index, which is the only place they are read.
   */
  scenarios: string[];
  /** What it may do. Empty is the floor: read, and propose cards. */
  can: Capability[];
  /**
   * The off switch, written into frontmatter by the Agents view. AGENTS ONLY:
   * an agent runs itself, so it needs a way to be told not to. A skill runs
   * when you ask for it, and deleting it is how you stop asking, so nothing
   * reads this on a skill file (`runnableEnabled` in @qale/application asks the
   * agent roster and nothing else).
   */
  enabled: boolean;
  /** Frontmatter problems, surfaced on the file's page (validation, not fatal). */
  errors: string[];
  /** The instructions — the body with frontmatter stripped, untouched. */
  body: string;
  raw: string;
}

/**
 * The whole vocabulary: four keys the PM writes, plus `type` (the vault's own,
 * on every note) and `enabled` (the Agents view's switch). Anything else is
 * flagged, because a key nothing reads still looks like configuration to
 * whoever wrote it.
 */
const KNOWN_KEYS = ['type', 'title', 'summary', 'scenarios', 'can', 'enabled'];

/**
 * Keys that are gone: the machinery behind them was deleted, so there is
 * nothing left to honour. A key that quietly stopped being read is worse than
 * one that errors — the file still looks configured — so each names what to do
 * instead.
 */
const RETIRED_KEYS: Record<string, string> = {
  starts:
    '`starts` is gone. Where the file sits says what puts it in force: a skill is work you run or the agent picks up, and a clock lives in the app',
  audience:
    '`audience` is gone. A voice is applied when something is drafted, not scoped in frontmatter',
  use: '`use` is gone. A file declares `can`, and where it sits says the rest',
  outbound: `\`outbound: true\` is gone. Give it "${CAPABILITY_LABEL['draft-outbound']}" instead: \`can: [draft-outbound]\``,
  session_files: `\`session_files: true\` is gone. Give it "${CAPABILITY_LABEL['keep-working-files']}" instead: \`can: [keep-working-files]\``,
  checkpoints: '`checkpoints` is gone. Ask for the order you want in the instructions',
  gate_output: '`gate_output` is gone. Ask for the order you want in the instructions',
  completion_bar: '`completion_bar` is gone. Say the bar in the instructions',
  stopping_conditions: '`stopping_conditions` is gone. Say when to stop in the instructions',
  red_flags: '`red_flags` is gone. Say what to push back on in the instructions',
  on: '`on` is not read. What starts an agent is the app’s clockwork, shown on its page',
  skill_kind: '`skill_kind` is gone. A file declares `can`',
  bindings: '`bindings` is gone. A file declares `can`',
  tier: '`tier` is gone. A file declares `can`',
};

const FRONTMATTER_RE = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Split a file into its YAML frontmatter and markdown body. */
function split(raw: string): { fm: Record<string, unknown>; body: string; error: string | null } {
  const m = raw.match(FRONTMATTER_RE);
  if (!m) return { fm: {}, body: raw, error: null };
  let fm: Record<string, unknown> = {};
  let error: string | null = null;
  try {
    const parsed = parseYaml(m[1] ?? '');
    if (parsed && typeof parsed === 'object') fm = parsed as Record<string, unknown>;
  } catch (err) {
    // Falling back to an empty frontmatter is silent by design elsewhere (an
    // unset `can` just means no capabilities), but here it drops every setting
    // the file actually has — `title`, `can`, all of it — with nothing to show
    // for it. Say so, so the file's page names the real cause instead of just
    // looking unconfigured.
    error = `The frontmatter is not valid YAML, so it is being read as empty (${err instanceof Error ? err.message : String(err)})`;
  }
  return { fm, body: raw.slice(m[0].length), error };
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
 * capability. `message` builds the error sentence for one bad value; the
 * default is a plain fallback, and `can` passes {@link unknownCapabilityMessage}
 * so the error can speak the same words as the permission chip.
 */
function readList<T extends string>(
  raw: unknown,
  allowed: T[],
  key: string,
  errors: string[],
  message: (value: string) => string = (v) => `unknown ${key} "${v}". Use one of: ${allowed.join(', ')}`,
): T[] {
  const out: T[] = [];
  for (const v of asStringArray(raw)) {
    if (allowed.includes(v as T)) {
      if (!out.includes(v as T)) out.push(v as T);
    } else {
      errors.push(message(v));
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
  const { fm, body, error } = split(raw);
  const errors: string[] = [];
  if (error) errors.push(error);

  for (const key of Object.keys(fm)) {
    if (KNOWN_KEYS.includes(key)) continue;
    // A retired key gets its own sentence; anything else gets the vocabulary.
    errors.push(
      RETIRED_KEYS[key] ??
        `\`${key}\` is not a setting. A file declares \`title\`, \`summary\`, \`scenarios\` and \`can\``,
    );
  }

  const can = readList(fm['can'], CAPABILITIES, 'can', errors, unknownCapabilityMessage);

  // A tool the instructions name but the frontmatter no longer buys. Checked
  // after `can` is read, and only against the tools that changed hands.
  for (const { tools, capability, came } of NARROWED) {
    if (can.includes(capability)) continue;
    const named = tools.filter((t) => new RegExp(`\\b${t}\\b`).test(body));
    if (named.length === 0) continue;
    errors.push(
      `This file uses ${named.map((t) => `\`${t}\``).join(', ')} but does not have the ` +
        `"${CAPABILITY_LABEL[capability]}" permission (can: [${capability}]). ` +
        `It used to come ${came}, so the tool is not offered any more`,
    );
  }

  return {
    name,
    title:
      typeof fm['title'] === 'string' && fm['title'].trim()
        ? fm['title'].trim()
        : titleFromName(name),
    summary:
      typeof fm['summary'] === 'string' && fm['summary'].trim() ? fm['summary'].trim() : name,
    // Prose, so there is no allowed list to check it against and nothing to
    // flag: a sentence is either there or it is not. Absent reads as empty.
    scenarios: asStringArray(fm['scenarios']),
    can,
    enabled: fm['enabled'] !== false,
    errors,
    body,
    raw,
  };
}

/** Whether a capability is granted. */
export function can(r: Runnable, capability: Capability): boolean {
  return r.can.includes(capability);
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
 * model must not read an arriving skill as reference material it may weigh
 * against the session it is already in.
 *
 * Every skill arrives this way. Reference material was a category once, and it
 * died with `starts` (SK-2): a file the model reads without following it is a
 * note, and notes live in the memory where retrieval can find them.
 */
export function buildSkillBrief(r: Runnable): string {
  const head = `## Skill now in force: ${r.name} — ${r.summary}\nThese instructions govern the rest of this conversation. Follow them as you would your own; where they conflict with what you were told before, the more restrictive rule wins.`;
  const body = r.body.trim();
  return body ? `${head}\n\n${body}` : `${head}\n\n_(This file has no instructions.)_`;
}
