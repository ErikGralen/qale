/**
 * Seed prompts for agent nudges that live inside their owning views (the
 * meeting page's prep brief, a todo's "help me handle this"). These used to
 * arrive as inbox pings; the prompt contracts moved here with them.
 *
 * Everything that invokes a skill on a page goes through `buildKickoff` so the
 * chat renders the turn as a run row rather than the instruction prose.
 */
import { buildKickoff, MEETING_PREP_INSTRUCTION } from '@pm/sessions';

/** Ground a passage the PO selected in a note against the memory (bubble toolbar → Ask). */
export function askSelectionSeed(path: string, selection: string): string {
  const quoted = selection
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  return `While reading ${path} I selected this passage:\n\n${quoted}\n\nWhat does the memory know about this? Give me the relevant context — related decisions (and whether any were superseded), evidence, open questions, who's involved — citing sources with dates. If the memory contradicts or can't back the passage, say so plainly.`;
}

/** Kick off the meeting-prep session for one meeting page ("Brief me") — the
 *  same skill and instruction the before-meeting sweep fires on its own. */
export function beforeMeetingSeed(path: string): string {
  return buildKickoff({
    skill: 'meeting-prep',
    target: path,
    instruction: MEETING_PREP_INSTRUCTION,
  });
}

/** Kick off the Process-Note session over one rough dump (note page → Process). */
export function processNoteSeed(path: string): string {
  return buildKickoff({
    skill: 'process-note',
    target: path,
    instruction: `read it, then propose the full ripple as approval cards — one update cleaning the note itself (typos, structure, wikilinks into the memory, and a title on the card if the note needs one), updates to the other notes it impacts (hubs it adds signal to, open questions it answers, last_told it advances, claims it contradicts), and new notes it implies (commitments heard as todos, insights worth keeping, a real decision with a decider as a decision card). Parts already processed and wikilinked by an earlier run stay untouched — only handle what's new or still raw.`,
  });
}

export interface TodoRef {
  path: string;
  title: string;
  /** Due date, if the commitment has one. */
  due?: string | null;
  /** The person a waiting-on commitment is owed by; absent for the PO's own. */
  owner?: string | null;
}

/** Kick off the commitment-check session on ONE todo the PO wants help handling. */
export function handleTodoSeed(todo: TodoRef, today: string): string {
  const meta = [todo.due ? `due ${todo.due}` : null, todo.owner ? `waiting on ${todo.owner}` : null]
    .filter(Boolean)
    .join(', ');
  return buildKickoff({
    skill: 'commitment-check',
    target: todo.path,
    instruction: `help me handle this commitment — “${todo.title}”${
      meta ? ` (${meta})` : ''
    }, today is ${today}. Read it, its source meeting, and the related memory, and check whether it has already happened. Also check the calendar: if it involves a person, look for an upcoming meeting with them (a meeting note dated today or later listing them in participants) — a conversation on the horizon may be the place to handle it. Then propose how to handle it as approval cards: a short concrete plan on the todo if it's still live, close it if the memory shows it's done or moot, reschedule only if there's a real reason to move the date, raise it on the upcoming meeting's page if you're seeing them soon, or draft a nudge if someone else is blocking and there's no meeting coming. Don't just push the due date to clear the flag.`,
  });
}
