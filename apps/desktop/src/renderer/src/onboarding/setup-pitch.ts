import { isFolderIndex } from '@qale/domain';
import type { AgentDTO, NoteRefDTO, SkillDTO, VaultTreeDTO } from '@qale/ipc';

/**
 * The pitch (docs/easier-tickets.md E-24): what the agent found, and what it
 * has set itself up to do about it.
 *
 * The whole point of this card is that it is not a paragraph we wrote. Every
 * clause is read off the workspace at render time, and a clause whose fact is
 * missing is dropped rather than softened. If the calendar shows no rhythm
 * there is no pitch at all; if the meeting-prep agent is off, nothing here
 * promises a brief. That rule is the reason this file is plain data with no
 * window around it: the sentences are testable, and a promise the product
 * cannot keep fails a test rather than reaching a person.
 *
 * The plan lines are the readable half. Each one names the file that carries
 * it, so "read and change" means opening the instructions the agent actually
 * runs on, not a settings page describing them.
 */

const DAY = 86_400_000;
const WEEK = 7 * DAY;
/** How far back, and forward, the rhythm is read. Four weeks is a month of work. */
const WINDOW_WEEKS = 4;
const WINDOW = WINDOW_WEEKS * WEEK;
/**
 * Meetings in the window before there is a rhythm worth stating. Under four,
 * "most weeks" is a guess dressed as a finding, so the card stays away.
 */
export const ENOUGH_MEETINGS = 4;
/** How many repeating series the sentence will name. Beyond three it is a list. */
const MAX_SERIES = 3;

/** One thing the agent has set itself up to do, and the file that says so. */
export interface PitchPlan {
  /** The runnable's own name, which is also the row's key. */
  id: string;
  /** What it will do, in the PM's words. Never our filing vocabulary. */
  line: string;
  /** The file behind the promise. The row opens it. */
  path: string;
}

export interface SetupPitch {
  /** What it found, one sentence, entirely from the workspace. */
  found: string;
  /** What it will do about it. Never empty: no plans, no pitch. */
  plans: PitchPlan[];
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** Small counts read as words; big ones as digits, the way a person writes them. */
function word(n: number): string {
  return WORDS[n] ?? String(n);
}

/** Join names the way somebody would say them out loud. */
function listed(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

// ---------------------------------------------------------------------------
// What it found
// ---------------------------------------------------------------------------

/** Meetings that stand for something real: not an index file, not cancelled,
 *  and dated, because an undated meeting says nothing about a week. */
function datedMeetings(tree: VaultTreeDTO | null): NoteRefDTO[] {
  const group = tree?.groups.find((g) => g.type === 'meeting');
  return (group?.notes ?? []).filter(
    (n) => !isFolderIndex(n.path) && n.eventStatus !== 'cancelled' && !!n.date,
  );
}

/** Epoch ms of a note's day. Frontmatter dates are days, so the clock is cut off. */
function dayMs(note: NoteRefDTO): number {
  return Date.parse(`${note.date!.slice(0, 10)}T00:00:00Z`);
}

/**
 * The month the rhythm is read from: the last four weeks if they hold enough,
 * otherwise the next four.
 *
 * Both windows matter, and in that order. Somebody who dropped a backlog of
 * transcripts has a past and no future; somebody who connected a calendar on
 * day one has a future and, usually, a past as well. Reading the past first
 * means the finding is about meetings that happened wherever there are any.
 */
function readWindow(all: NoteRefDTO[], now: number): { start: number; notes: NoteRefDTO[] } | null {
  const within = (start: number) =>
    all.filter((n) => {
      const t = dayMs(n);
      return Number.isFinite(t) && t >= start && t < start + WINDOW;
    });
  const past = within(now - WINDOW);
  if (past.length >= ENOUGH_MEETINGS) return { start: now - WINDOW, notes: past };
  const ahead = within(now);
  if (ahead.length >= ENOUGH_MEETINGS) return { start: now, notes: ahead };
  return null;
}

/** How many meetings fell in each week of the window. */
function perWeek(notes: NoteRefDTO[], start: number): number[] {
  const weeks = new Array<number>(WINDOW_WEEKS).fill(0);
  for (const n of notes) {
    const at = Math.floor((dayMs(n) - start) / WEEK);
    const i = Math.min(Math.max(at, 0), WINDOW_WEEKS - 1);
    weeks[i]! += 1;
  }
  return weeks;
}

/**
 * The rate, in the words the PM would use.
 *
 * The two middle weeks decide it, so one dead week off sick and one conference
 * week do not both get a vote. Where they disagree the sentence says both
 * numbers, because "four or five" is what a person answers when asked how many
 * meetings they have. A quiet middle means the average is a lie about the
 * typical week, so the sentence falls back to the plain total.
 */
function rate(notes: NoteRefDTO[], start: number): string {
  const weeks = [...perWeek(notes, start)].sort((a, b) => a - b);
  const lo = weeks[1]!;
  const hi = weeks[2]!;
  if (lo === 0) return `${word(notes.length)} meetings in a month`;
  if (lo === hi) return `about ${word(lo)} meeting${lo === 1 ? '' : 's'} most weeks`;
  return `${word(lo)} or ${word(hi)} meetings most weeks`;
}

/**
 * The meetings that come round again, newest instance first, by how often they
 * repeat. A series seen once in the window is not a rhythm, so it is dropped.
 * The name is the latest instance's title, because that is what the PM sees on
 * their own calendar.
 */
function repeats(notes: NoteRefDTO[]): string[] {
  const bySeries = new Map<string, NoteRefDTO[]>();
  for (const n of notes) {
    if (!n.series) continue;
    const held = bySeries.get(n.series);
    if (held) held.push(n);
    else bySeries.set(n.series, [n]);
  }
  return [...bySeries.values()]
    .filter((group) => group.length > 1)
    .sort((a, b) => b.length - a.length || latest(b) - latest(a))
    .slice(0, MAX_SERIES)
    .map((group) => [...group].sort((a, b) => dayMs(b) - dayMs(a))[0]!.title);
}

function latest(group: NoteRefDTO[]): number {
  return Math.max(...group.map(dayMs));
}

/** What it found, or null when there is not enough to say anything true. */
export function pitchFinding(tree: VaultTreeDTO | null, now: number): string | null {
  const found = readWindow(datedMeetings(tree), now);
  if (!found) return null;
  const opening = `You have ${rate(found.notes, found.start)}`;
  const series = repeats(found.notes);
  if (series.length === 0) return `${opening}.`;
  if (series.length === 1) return `${opening}, and ${series[0]} comes round again and again.`;
  return `${opening}, and the same ${word(series.length)} keep coming round: ${listed(series)}.`;
}

// ---------------------------------------------------------------------------
// What it plans to do
// ---------------------------------------------------------------------------

/**
 * The four promises, each tied to the file that keeps it, in the order they
 * happen to a person: before the meeting, after it, underneath it, and the
 * question that comes out of all three.
 *
 * The wording is what the file does, said the way the PM would say it. Nothing
 * here says "propose", "note type" or "shelf": a promise the reader has to
 * learn our words to check is not a promise they can check.
 */
interface PlanSource {
  id: string;
  line: string;
  /** Whether this one is really on, given what the workspace holds. */
  live: (roster: Roster) => string | null;
}

interface Roster {
  skill: (name: string) => SkillDTO | undefined;
  agent: (id: string) => AgentDTO | undefined;
}

/** An agent keeps its promise only while its switch is on and it can run. */
function runningAgent(roster: Roster, id: string): string | null {
  const agent = roster.agent(id);
  return agent && agent.status === 'on' ? agent.path : null;
}

/** A skill keeps its promise as long as the file is there and parses. */
function readableSkill(roster: Roster, name: string): string | null {
  const skill = roster.skill(name);
  return skill && skill.errors.length === 0 ? skill.path : null;
}

const PLANS: PlanSource[] = [
  {
    id: 'meeting-prep',
    line: 'Write you a brief before each meeting, from what I already know about the people and the work.',
    live: (r) => runningAgent(r, 'meeting-prep'),
  },
  {
    id: 'commitment-check',
    line: 'Write down what people promise you, and put it back in front of you when it comes due.',
    live: (r) => readableSkill(r, 'commitment-check'),
  },
  {
    id: 'librarian',
    line: 'Keep the notes behind all that in order, so the filing never lands on you.',
    live: (r) => runningAgent(r, 'librarian'),
  },
  {
    id: 'arrival',
    line: "Ask you a short question when two things I have read don't line up.",
    live: (r) => readableSkill(r, 'arrival'),
  },
];

/** What it has set itself up to do, dropping anything that is off or missing. */
export function pitchPlans(skills: SkillDTO[], agents: AgentDTO[]): PitchPlan[] {
  const roster: Roster = {
    skill: (name) => skills.find((s) => s.kind === 'skill' && s.name === name),
    agent: (id) => agents.find((a) => a.id === id),
  };
  const plans: PitchPlan[] = [];
  for (const plan of PLANS) {
    const path = plan.live(roster);
    if (path) plans.push({ id: plan.id, line: plan.line, path });
  }
  return plans;
}

/**
 * The pitch, or null when there is nothing honest to say.
 *
 * Null on either half: seeing no rhythm means it has not seen enough yet, and
 * having no live plan means it would be promising work nothing is set up to do.
 */
export function setupPitch(
  tree: VaultTreeDTO | null,
  skills: SkillDTO[],
  agents: AgentDTO[],
  now: number,
): SetupPitch | null {
  const found = pitchFinding(tree, now);
  if (!found) return null;
  const plans = pitchPlans(skills, agents);
  if (plans.length === 0) return null;
  return { found, plans };
}
