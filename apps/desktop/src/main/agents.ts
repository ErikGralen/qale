/**
 * Every agent IS a file (`agents/<name>/AGENT.md`): the file holds its identity, its
 * free-text instructions, its `starts`/`can` config and its `enabled` switch.
 * What lives here is the remainder — the facts only the main process knows,
 * because a SELF-STARTING clock (the maintenance tick, the calendar sweep) is
 * the app's clockwork, not frontmatter. A file can say the PM may run it; only
 * code knows when a sweep fires. The Agents view merges these onto the row.
 *
 * Adding a code-clocked agent: seed its file (sessions/defaults.ts DEFAULT_AGENTS),
 * gate whatever it does BEFORE firing a session on `runnableEnabled(ctx, name)`
 * (the session itself is already gated, in fireSession), stamp `agentLastRun`
 * when it fires (handlers.ts), and declare its clock here.
 */

import type { StartDTO } from '@qale/ipc';

/**
 * The maintenance clock: how often the tick fires (scheduler-service) and
 * therefore how often the librarian's scan runs. The scan reads the graph and
 * tells nobody anything; what the PM ever sees is a session, and those are
 * paced by the interval below.
 */
export const MAINTENANCE_TICK_MS = 5 * 60 * 1000;

/**
 * How long a finding has to hold still before the agent is told about it. One
 * full tick, so a link somebody is halfway through typing is never repaired out
 * from under them.
 */
export const LIBRARIAN_SETTLE_MS = MAINTENANCE_TICK_MS;

/**
 * The librarian gets a session at most this often, however busy the workspace.
 * This is also the interval the Agents view shows for it: a session is the only
 * thing about the librarian anyone can see, so it is the only honest number to
 * put in front of them.
 */
export const LIBRARIAN_SESSION_INTERVAL_MS = 30 * 60 * 1000;

/**
 * How far ahead of a meeting the prep agent fires, and the words for that span.
 * The trigger below, the sweep in handlers.ts, and the provenance line on the
 * card it produces all have to name the same hour, so they read it from here
 * rather than each spelling it out.
 */
export const MEETING_PREP_LEAD_MS = 60 * 60 * 1000;
export const MEETING_PREP_LEAD_PHRASE = 'an hour';

export interface CodeRunFacts {
  /**
   * The app's own clocks for this agent, as mechanism — never a sentence. The
   * renderer turns these into words, so a clock can't be described in one place
   * and run in another. These are ADDED to whatever the file declares.
   */
  starts: StartDTO[];
  /** Judges with the model — without a key it is blocked, not quietly "on". */
  needsApiKey: boolean;
  /**
   * Why it can't run without that key. The renderer appends the door (an Open
   * Settings action), so the sentence names the gap, not the path to the fix.
   */
  blockedReason: string;
}

export const CODE_RUN_FACTS: Record<string, CodeRunFacts> = {
  librarian: {
    starts: [
      { kind: 'interval', everyMs: LIBRARIAN_SESSION_INTERVAL_MS },
      // Precisely: accepting a decision card that carries `supersedes`
      // (fireSupersedeReactions). Editing a decision's frontmatter by hand
      // doesn't reach it — the trigger watches the card, not the note.
      { kind: 'event', event: 'decision-superseded' },
    ],
    needsApiKey: true,
    blockedReason: 'No Anthropic API key yet — it can’t tidy and file pages until one is set.',
  },
  'meeting-prep': {
    // Only meetings the calendar connector promoted to a note are visible to
    // it (syncService.agenda) — "before a synced meeting", not "each meeting".
    starts: [{ kind: 'before-meeting', leadMs: MEETING_PREP_LEAD_MS }],
    needsApiKey: true,
    blockedReason: 'No Anthropic API key yet — it can’t write meeting briefs until one is set.',
  },
};
