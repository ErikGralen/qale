import { ARRIVAL_AGENT_NAME, buildKickoff } from '@qale/sessions';

/**
 * What a drop says to the session that reads it.
 *
 * Two sentences, both pure, both minted here rather than inline in
 * `handlers.ts`: the manifest the agent starts from, and the first message it is
 * sent. They are the contract between a person dropping a file and the skill
 * that files it, so they are worth checking without launching Electron and
 * dragging something onto the window.
 */

/** One source that landed in the session folder. */
export interface LandedSource {
  /** Where it sits in the session folder, e.g. `source/notes.md`. */
  file: string;
  /** What it was called when it was handed over. */
  original: string;
  bytes: number;
}

/** One source that could not be read, and why. */
export interface RefusedSource {
  name: string;
  error: string;
}

/**
 * `input.md` is the list the agent starts from, and what the person opening the
 * session folder next week sees.
 *
 * It names every file, so the run never has to work out what arrived from a
 * directory walk, and it carries what the person said, so the words survive in
 * the folder as well as in the first message.
 */
export function arrivalManifest({
  written,
  refused,
  instruction,
  candidates,
  at,
}: {
  written: readonly LandedSource[];
  refused: readonly RefusedSource[];
  /** What the person typed when they handed the files over, if anything. */
  instruction?: string;
  /** Meetings the calendar holds around now, one line each, as a hint. */
  candidates: readonly string[];
  /** When the batch was handed over, in the workspace's own words. */
  at: string;
}): string {
  const said = instruction?.trim();
  return [
    `# What arrived`,
    ``,
    `${written.length} source${written.length === 1 ? '' : 's'}, handed over ${at}.`,
    ``,
    ...written.map((w) => `- \`${w.file}\` — dropped as "${w.original}", ${w.bytes} bytes`),
    ...(refused.length
      ? [
          '',
          'Could not be read, so they are not here:',
          ...refused.map((r) => `- ${r.name}: ${r.error}`),
        ]
      : []),
    ...(said ? ['', '## What the PM asked for', '', said] : []),
    ...(candidates.length
      ? [
          '',
          '## Meetings on the calendar near now',
          '',
          'A hint and nothing more. Match a transcript on its own date, title and who speaks in it;',
          'if the clock and the transcript disagree, the transcript is right.',
          '',
          ...candidates,
        ]
      : []),
  ].join('\n');
}

/**
 * The first message of a drop's session: run the arrival skill, and whatever the
 * person typed beside the files, verbatim.
 *
 * It used to be a paragraph of composed prose repeating what the skill already
 * says ("read `input.md`, work out what each thing is, file it"). The skill's own
 * first line says that, so the sentence is now only the two things the skill
 * cannot know: which skill to run, and what this person wants. They typed
 * nothing? Then the instruction is empty and the message is "Run the arrival
 * skill." Silence is an answer, not a gap to fill.
 */
export function arrivalKickoff(instruction?: string): string {
  return buildKickoff({ skill: ARRIVAL_AGENT_NAME, instruction: instruction?.trim() ?? '' });
}
