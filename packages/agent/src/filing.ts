import { Type } from 'typebox';
import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { readableAs } from '@qale/domain';
import {
  fileSource,
  refileSource,
  type ArrivalPart,
  type UseCaseContext,
} from '@qale/application';
import type { SessionHarness } from '@qale/sessions';
import { readSessionBinary, readSessionFile } from './session-files.js';

/**
 * The filing tools (docs/arrival-agentic.md) — the one pair of tools that write
 * to the memory without an approval card.
 *
 * That exception is narrow and it is not a shortcut. A source the PM dropped is
 * already theirs; putting it on a shelf carries out their instruction rather
 * than proposing anything, and the two failure modes of a filing (wrong shelf,
 * wrong meeting) are both fixed by moving it, which is what the second tool is
 * for. Nothing DERIVED from the source comes through here: a commitment, a
 * decision, and the meeting page itself are all cards. Filing a transcript used
 * to mint that page as a side effect, which is exactly the line this comment
 * claims it does not cross; `propose_meeting` took the job back.
 *
 * Both are gated on `can: [file-source]`, so only a skill that says it files
 * sources gets them. An ordinary chat cannot write a note by asking nicely.
 */

export const FILING_TOOL_NAMES = ['file_source', 'refile_source'];

function text(s: string) {
  return { content: [{ type: 'text' as const, text: s }], details: undefined };
}

/**
 * Read the session files named by the model into a source's parts. An image
 * comes back as bytes, everything else as text; a name that escapes the
 * session folder or points at nothing is refused by name, because "file_source
 * failed" tells the model nothing it can act on.
 */
async function readParts(root: string, files: string[]): Promise<ArrivalPart[]> {
  const parts: ArrivalPart[] = [];
  for (const [i, file] of files.entries()) {
    const name = file.split('/').pop() ?? file;
    const label = files.length > 1 ? `part ${i + 1}` : undefined;
    if (readableAs(name) === 'image') {
      const image = await readSessionBinary(root, file);
      if (!image) throw new Error(`no session file called “${file}” — check files_list`);
      parts.push({ name, image, ...(label ? { label } : {}) });
      continue;
    }
    const content = await readSessionFile(root, file);
    if (content === null) throw new Error(`no session file called “${file}” — check files_list`);
    if (!content.trim()) throw new Error(`“${file}” is empty, so there is nothing to file`);
    parts.push({ name, text: content, ...(label ? { label } : {}) });
  }
  return parts;
}

/**
 * One filing that happened, for whoever is counting a batch down
 * (docs/critical-mass.md CM-2). It fires after the write, so a count built from
 * it says what is on the shelf rather than what was attempted.
 */
export interface SourceFiled {
  /** How many pieces of the source this call filed. */
  pieces: number;
  /** They joined a meeting page that already existed. */
  matched: boolean;
}

export function createFilingTools(
  ctx: UseCaseContext,
  harness: SessionHarness,
  /** The session's own folder — the only place a source can be filed FROM. */
  root: string,
  /** Told after every successful filing, so a pile can be counted down live. */
  onFiled?: (filed: SourceFiled) => void,
): ToolDefinition[] {
  const file = defineTool({
    name: 'file_source',
    label: 'File source',
    description:
      'Put one thing from your session folder into the memory, where it will stay. Use it once per THING, ' +
      'not once per file: a recording delivered as two files is one meeting, so name both files in one call. ' +
      '`as: "meeting"` is a recording of a meeting the PM was in: each file is kept as an immutable transcript ' +
      'under sources/. It does NOT create a meeting page — propose that with propose_meeting, summary and all, ' +
      'unless the calendar already holds the meeting, in which case pass `attach_to` with its path and the ' +
      'transcript is linked onto the page that exists. `as: "source"` is everything else (a colleague\'s call, ' +
      'an article, a spec, a pasted thread, a screenshot) and lands under sources/. Set `origin` to say whose ' +
      "source this is: whose meeting a transcript was when the PM was not in it, or the PM's own name on " +
      'writing of theirs. Filing the source is not a proposal and needs no approval — ' +
      "it is the PM's own source going on a shelf. Every page you WRITE about it, " +
      'the meeting page included, is a proposal.',
    parameters: Type.Object({
      files: Type.Array(Type.String(), {
        description:
          'Session-folder paths, e.g. ["source/nordkap-qbr.vtt"]. More than one only where they are pieces of ONE recording, in order.',
        minItems: 1,
      }),
      as: Type.Union([Type.Literal('meeting'), Type.Literal('source')], {
        description: 'meeting = the PM was in it. source = everything else.',
      }),
      title: Type.String({
        description: 'What to call the page, in the words a person would use.',
      }),
      date: Type.Optional(
        Type.String({
          description: 'YYYY-MM-DD, the day the source is about, when it says so itself.',
        }),
      ),
      attach_to: Type.Optional(
        Type.String({
          description: 'Path of a meeting page that already exists, to attach this recording to.',
        }),
      ),
      origin: Type.Optional(
        Type.String({
          description:
            'Whose source this is: whose meeting a transcript was when the PM was not in it ' +
            '("Jonas Palm"), or the PM\'s own name on a note or draft they wrote themselves.',
        }),
      ),
      caption: Type.Optional(
        Type.String({
          description: 'A screenshot only: what the picture shows and why it matters.',
        }),
      ),
    }),
    async execute(
      _id,
      params: {
        files: string[];
        as: 'meeting' | 'source';
        title: string;
        date?: string;
        attach_to?: string;
        origin?: string;
        caption?: string;
      },
    ) {
      if (!harness.fileSource) {
        return text('Refused: this session may not file a source. Nothing was written.');
      }
      const parts = await readParts(root, params.files);
      const result = await fileSource(ctx, {
        parts,
        as: params.as,
        title: params.title,
        ...(params.date ? { date: params.date } : {}),
        ...(params.attach_to ? { attachTo: params.attach_to } : {}),
        ...(params.origin ? { origin: params.origin } : {}),
        ...(params.caption ? { caption: params.caption } : {}),
      });
      for (const path of result.wrote) harness.recordRead(path);
      // The pieces this call took off the pile, and whether they went to a
      // meeting that was already on the calendar.
      onFiled?.({ pieces: parts.length, matched: !!params.attach_to });
      // A recording with no page to belong to: say what is missing and what
      // makes it, or the next call is an update card against a note that was
      // never written.
      if (result.needsMeeting) {
        return text(
          `Filed the recording to ${result.wrote.join(', ')}. There is no meeting page for it: propose one with ` +
            `propose_meeting, naming ${result.wrote.length > 1 ? 'these transcripts' : 'this transcript'} and ` +
            `writing the summary into the same card. Do that BEFORE the todos and decisions from this meeting, ` +
            `so they can cite the meeting page — a card may cite one that is still waiting for approval.`,
        );
      }
      return text(
        `Filed to ${result.path}${
          result.wrote.length > 1 ? ` (also wrote ${result.wrote.slice(1).join(', ')})` : ''
        }. Cite it as a wikilink from here on.`,
      );
    },
  });

  const refile = defineTool({
    name: 'refile_source',
    label: 'Refile source',
    description:
      'Correct a filing you (or an earlier run) got wrong. Three moves: point a transcript at the meeting it ' +
      "really belongs to (`meeting` = that page's path), say it was never the PM's meeting at all " +
      '(`meeting: "none"`, with `origin` naming whose it was), or rename the page (`title`). A meeting page ' +
      'left holding nothing is removed with it. A page somebody has written notes or a summary on is never ' +
      'emptied out from under them: refile its transcripts one at a time instead.',
    parameters: Type.Object({
      path: Type.String({
        description: 'The page that was filed wrong, e.g. "meetings/2026-08-04-qbr.md".',
      }),
      meeting: Type.Optional(
        Type.String({
          description:
            'Path of the meeting it really belongs to, or the literal "none" when it belongs to no meeting of the PM\'s.',
        }),
      ),
      origin: Type.Optional(
        Type.String({ description: 'Whose meeting it was, used with meeting: "none".' }),
      ),
      title: Type.Optional(Type.String({ description: 'A better name for the page.' })),
    }),
    async execute(
      _id,
      params: { path: string; meeting?: string; origin?: string; title?: string },
    ) {
      if (!harness.fileSource) {
        return text('Refused: this session may not refile a source. Nothing was changed.');
      }
      const result = await refileSource(ctx, {
        path: params.path,
        ...(params.meeting ? { meeting: params.meeting } : {}),
        ...(params.origin ? { origin: params.origin } : {}),
        ...(params.title ? { title: params.title } : {}),
      });
      harness.recordRead(result.path);
      const removed = result.removed ? ` The empty page ${result.removed} was removed.` : '';
      return text(
        `Refiled: it now lives at ${result.path}${
          result.moved.length ? `, moving ${result.moved.join(', ')}` : ''
        }.${removed} Say so in your reply, so the PM can see the correction.`,
      );
    },
  });

  return [file, refile] as ToolDefinition[];
}
