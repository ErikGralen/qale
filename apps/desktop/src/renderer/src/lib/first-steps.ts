import type { VaultTreeDTO } from '@qale/ipc';

/**
 * The words and the numbers behind the First steps card (docs/critical-mass.md
 * CM-1, CM-6, CM-7). The card itself draws them; everything here is plain data
 * so it can be read and tested without a window.
 */

/**
 * The order of the rows, which is the arc (CM-6): connect the calendar so the
 * shelf fills, drop the backlog into those shells, connect the trackers, tell
 * it about the product, decide on what it drafted, then let it prep a meeting
 * from all of it.
 *
 * The key comes first because nothing runs without it, and it is only ever
 * visible to someone who skipped it in the opening. A row not named here sorts
 * to the end, which is what a connector we have not met yet should do.
 */
export const FIRST_STEP_ORDER: readonly string[] = [
  'key',
  'connect:google-calendar',
  'transcript',
  'connect:atlassian',
  'understanding',
  'proposal',
  'ask',
  'prep',
];

/** Where a row sits in the arc. Unknown rows go last, in the order they came. */
export function stepRank(id: string): number {
  const at = FIRST_STEP_ORDER.indexOf(id);
  return at === -1 ? FIRST_STEP_ORDER.length : at;
}

/**
 * Where last month's meetings live, per tool (CM-1).
 *
 * The ask is for a folder of transcripts, and most people do not have one
 * ready. They do have a tool that made them. So the row folds open into the
 * short version of "go here, export, drop it in", written per tool and without
 * invented menu paths: the exact wording of a button moves between releases,
 * and a wrong instruction is worse than a general one.
 */
export interface MeetingTool {
  /** The word telemetry reports, and the key of the guide. */
  id: string;
  label: string;
  /** How to get the transcripts out, as files. */
  guide: string;
}

export const MEETING_TOOLS: readonly MeetingTool[] = [
  {
    id: 'granola',
    label: 'Granola',
    guide:
      'Granola keeps every meeting in its history. Open one, export or copy the notes, and save them as a text file. You can also paste the text straight in.',
  },
  {
    id: 'zoom',
    label: 'Zoom',
    guide:
      'A cloud recording keeps a transcript you can download from the Zoom website, under Recordings. A local recording saves to a Zoom folder in your Documents.',
  },
  {
    id: 'google-meet',
    label: 'Google Meet',
    guide:
      'If your workspace takes transcripts, they land in Google Drive after the meeting, and the calendar event links to them. Download them and drop them in.',
  },
  {
    id: 'otter',
    label: 'Otter',
    guide:
      'Otter keeps your conversations in its history. Open one and export it as text. Last month is usually a handful of exports.',
  },
  {
    id: 'teams',
    label: 'Microsoft Teams',
    guide:
      'Open the meeting in Teams and look at its recap or its chat. If a transcript was taken, you can download it as a file from there.',
  },
  {
    id: 'other',
    label: 'Somewhere else, or nowhere',
    guide:
      'No transcripts anywhere? Your own notes count. Drop in the notes you wrote, in whatever shape they are in, or paste the text.',
  },
];

/** The tool ids, for the telemetry allowlist to agree with. */
export const MEETING_TOOL_IDS: readonly string[] = MEETING_TOOLS.map((t) => t.id);

/** One segment of the tally: a count and what it counts. */
function segment(n: number, one: string, many: string): string | null {
  if (n <= 0) return null;
  return `${n} ${n === 1 ? one : many}`;
}

/** Join segments the way a person would say them. */
function sentence(parts: string[]): string {
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * What the workspace holds, in one sentence (CM-7).
 *
 * This is what the card says instead of a row of ticks on its last showing:
 * the steps are done, so the interesting fact is no longer the steps, it is the
 * memory they built. Every number is read off the tree at render time, so the
 * sentence is true when it is shown and is never stored, and a count of zero
 * loses its segment rather than printing "0 themes".
 *
 * Null means there is nothing to say, and the card falls back to the ticks.
 */
export function firstStepsTally(tree: VaultTreeDTO | null): string | null {
  if (!tree) return null;
  const of = (type: string) => tree.groups.find((g) => g.type === type)?.notes ?? [];
  const meetings = of('meeting');
  // A meeting the workspace can actually read from: a transcript came in, or
  // somebody wrote in it. An empty shell off the calendar is not memory.
  const written = meetings.filter((n) => n.captured).length;

  const parts = [
    segment(meetings.length, 'meeting', 'meetings'),
    segment(written, 'with notes', 'with notes'),
    segment(of('person').length, 'person', 'people'),
    segment(of('theme').length, 'theme', 'themes'),
    segment(of('decision').length, 'decision', 'decisions'),
  ].filter((p): p is string => p !== null);

  if (parts.length === 0) return null;
  return `Your memory now holds ${sentence(parts)}.`;
}
