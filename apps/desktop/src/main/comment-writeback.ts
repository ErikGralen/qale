import { parseSlots } from '@qale/agent/slots';
import type { AskCommentAnswersDTO } from '@qale/ipc';

/**
 * Writing the PM's comments back into the round they were written on
 * (docs/brainstorm-skill.md, IT-4).
 *
 * This is for the human record and nothing else. The model never sees this
 * rewrite: its copy of the round is the file it wrote, already in its
 * transcript, and the answers reach it as the `request_comments` tool result.
 * What the rewrite buys is that a round reread next week reads as a
 * conversation, with each answer where the question was, instead of as a
 * document full of empty boxes.
 *
 * Pure on purpose. The Send path has to survive a file that moved, was deleted
 * or no longer parses, and the way it survives is that the rewrite is a
 * separate step that can return nothing.
 */

/** How an answer is marked in the file. One voice, so a reread scans. */
const YOU = '**You:**';

/** What a box nobody wrote in becomes. Silence is an answer worth recording. */
const NO_COMMENT = `${YOU} (no comment)`;

/** The heading the general box lands under, in the words the box carries. */
const GENERAL_HEADING = '## Anything else';

/**
 * The round with every slot fence replaced by what the PM wrote there, and the
 * general comment appended. Null when there is nothing to write: a document
 * that no longer parses is left exactly as it is, because a half-rewritten
 * round is worse than an un-rewritten one.
 *
 * Slots are replaced from the end backwards, so each span still points at the
 * characters it was parsed from.
 */
export function applyComments(text: string, comments: AskCommentAnswersDTO): string | null {
  const parsed = parseSlots(text);
  if ('error' in parsed) return null;

  let out = text;
  for (const slot of [...parsed.slots].reverse()) {
    const written = comments.answers[slot.id]?.trim();
    out =
      out.slice(0, slot.start) + (written ? `${YOU} ${written}` : NO_COMMENT) + out.slice(slot.end);
  }

  const general = comments.general?.trim();
  if (general) {
    out = `${out.replace(/\s+$/, '')}\n\n${GENERAL_HEADING}\n\n${YOU} ${general}\n`;
  }
  return out;
}
