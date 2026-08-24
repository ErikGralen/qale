import { createHash } from 'node:crypto';
import { Type } from 'typebox';
import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { oneLine } from '@qale/application';
import type { AskDecision } from './ask.js';
import { parseSlots, type CommentAnswers, type CommentPlan } from './slots.js';

/**
 * Asking the PM to write IN a document, rather than to answer a card
 * (docs/brainstorm-skill.md).
 *
 * The question card settles one decision. This settles a draft: the session
 * writes a round file, marks the places it wants a reaction with slot fences,
 * and parks while the PM writes in them. It is the same primitive underneath
 * (park the turn, draw something, resolve) and it reuses `ask_user`'s parking
 * whole, so a round survives a quit for the same reason a question does.
 *
 * Two rules shape it, and both live in the tool description because that is the
 * only place the model reliably reads them:
 * 1. Write the file FIRST. This tool never authors anything; it hands over a
 *    path and waits.
 * 2. Never read a round file back. The model wrote it, so it is already in the
 *    transcript, and the PM's answers arrive here, compact, one line per slot.
 *    A `files_read` of your own round is the same bytes a second time.
 *
 * Same spine as {@link createAskTool}: pure planning + validation here, the
 * parked promise in `AskParking`, an inline card in the chat. Never a modal.
 */

export const COMMENTS_TOOL_NAME = 'request_comments';

/**
 * Slots in one round. Past this the document is a form, and a form is the shape
 * this was built to avoid: the PM reacts to a draft, they do not fill in fields.
 */
export const COMMENTS_MAX_SLOTS = 20;

/**
 * Ceiling on the prompt above one box, and the reason is OW9 rather than layout.
 * A parked request outlives the turn that made it and is read back off `app.db`
 * by a later run, so what may be parked is kept to the size of a prompt.
 */
export const SLOT_PROMPT_MAX = 200;

/**
 * Validate the round the model wants comments on. Pure: `body` is the file as
 * read, or null when it is missing or outside the session folder.
 *
 * Errors come back as tool text rather than thrown, exactly as `planAsk`'s do: a
 * round with a broken slot is something the model fixes with one `files_write`,
 * and killing the turn over it would lose the work behind the draft.
 */
export function planComments(
  input: unknown,
  body: string | null,
): { plan: CommentPlan } | { error: string } {
  const raw = (input as { path?: unknown })?.path;
  const path = typeof raw === 'string' ? raw.trim() : '';
  if (!path) {
    return {
      error:
        'request_comments needs the path of the round file you just wrote, relative to your session folder (e.g. "round-1.md").',
    };
  }
  if (!/\.md$/i.test(path)) {
    return {
      error: `${path} is not a markdown file. A round has to be one, because the PM reads it.`,
    };
  }
  if (body === null) {
    return {
      error: `There is no ${path} in your session folder. Write the round with files_write first, then ask for comments on it.`,
    };
  }
  const parsed = parseSlots(body);
  if ('error' in parsed) return { error: `${path}: ${parsed.error}` };
  if (parsed.slots.length === 0) {
    return {
      error: `${path} has no slots, so there is nothing for the PM to write in. Mark each place you want their take with a \`\`\`slot <id>\`\`\` fence, then call this again.`,
    };
  }
  if (parsed.slots.length > COMMENTS_MAX_SLOTS) {
    return {
      error: `${path} has ${parsed.slots.length} slots; at most ${COMMENTS_MAX_SLOTS}. Ask about the parts where their answer changes the next round, not about every line.`,
    };
  }
  const slots = parsed.slots.map((slot) => {
    // Flattened and capped on the way IN, so the box, the row in `app.db` and a
    // later run's replay all carry the same bounded line.
    const prompt = slot.prompt ? oneLine(slot.prompt, SLOT_PROMPT_MAX) : '';
    return { id: slot.id, ...(prompt ? { prompt } : {}) };
  });
  return { plan: { path, slots } };
}

/**
 * Render what the PM wrote back to the model. One line per slot, in the order
 * they appear in the document, because that is the order the model wrote them
 * in and can act on without going back to the file. A slot they left empty is
 * stated as skipped rather than omitted.
 */
export function formatComments(plan: CommentPlan, answers: CommentAnswers): string {
  const lines: string[] = [`The PM wrote in ${plan.path}:`, ''];
  for (const slot of plan.slots) {
    // Keyed by the plan, never by what came back: a stale box carrying an id
    // this round does not have is not something to report as an answer.
    const written = answers.answers[slot.id]?.trim();
    lines.push(
      written
        ? `${slot.id}: ${written}`
        : `${slot.id}: (skipped: decide this one yourself and say what you assumed)`,
    );
  }
  const general = answers.general?.trim();
  if (general) lines.push(`general: ${general}`);
  lines.push(
    '',
    'Act on this now, in this same turn. Everything they wrote is above, so do not read the round file back, and do not repeat their comments to them.',
  );
  return lines.join('\n');
}

export interface CommentsDeps {
  /** One file from the session folder, or null when it is missing or outside it. */
  read: (path: string) => Promise<string | null>;
  /**
   * Show the round and wait. Resolves when the PM sends, skips, or the run is
   * stopped. Never rejects, and never times out: the only ways out are the
   * ones the PM can see.
   */
  requestComments: (plan: CommentPlan, signal?: AbortSignal) => Promise<AskDecision>;
}

function text(s: string) {
  return { content: [{ type: 'text' as const, text: s }], details: undefined };
}

export function createCommentsTool(deps: CommentsDeps): ToolDefinition {
  return defineTool({
    name: COMMENTS_TOOL_NAME,
    label: 'Ask for comments',
    description:
      'Hand the PM a document you just wrote and wait while they write in it, without ending your turn. Use ' +
      'this ONLY inside a skill that tells you to. Write the round file first with files_write, and mark every ' +
      'place you want their take with a fenced slot: a line reading ```slot idea-3, one short prompt under it, ' +
      'then a closing fence. Ids must be different from each other. Then call this with that path. The PM sees ' +
      'the document with a box at each slot and one general box at the foot of it, and their answers come back ' +
      'as this tool result, one line per slot. So never files_read a round file you wrote (you wrote it, and ' +
      'the answers are here), and never call ask_user in the same flow: one card at a time, and this is the card.',
    parameters: Type.Object({
      path: Type.String({
        description:
          'The round file, relative to your session folder, e.g. "round-1.md". It must already exist and hold at least one slot.',
      }),
    }),
    // The PM is writing in this document; nothing else in the turn should be
    // running underneath it, and a question card beside it would be two things
    // to answer with one Send.
    executionMode: 'sequential',
    promptGuidelines: [
      'When a skill tells you to work in rounds, write the round with files_write and call request_comments on it rather than ending your turn.',
      'Never read your own round files back, and never ask_user in a round.',
    ],
    async execute(_id, params, signal) {
      const raw = (params as { path?: unknown })?.path;
      const path = typeof raw === 'string' ? raw.trim() : '';
      const body = path ? await deps.read(path) : null;
      const planned = planComments(params, body);
      if ('error' in planned) return text(`Rejected: ${planned.error}`);
      const { plan } = planned;

      const decision = await deps.requestComments(plan, signal);
      // Nobody is there. Failing closed beats parking a document that would sit
      // unread until the next scheduled run wrote another one beside it.
      if (decision.unattended) {
        return text(
          'Nobody is here to write in it. A clock started this run, not a person, so there is no PM at the ' +
            'screen and this round would sit unread. Stop now: do not answer your own slots, and do not write ' +
            'a note about it. The run is recorded as stopped because it needed the PM, and it shows on your ' +
            'page when they next open it. End your turn without writing anything.',
        );
      }
      if (!decision.comments) {
        return text(
          `The PM closed ${plan.path} without commenting. Do not ask for another round. Take the most ` +
            'reasonable reading of your own draft, say plainly which way you went and why, and finish the work.',
        );
      }
      return text(formatComments(plan, decision.comments));
    },
  });
}

/**
 * The id for one comment request, derived from the session and the round rather
 * than drawn at random, for the same two reasons `askRequestId` is: asking for
 * comments on the same round twice addresses one row, and a Send that arrives
 * twice (a double click, a second window, a retried IPC) settles the same id,
 * so the second one finds nothing left to settle.
 */
export function commentRequestId(sessionId: string, plan: CommentPlan): string {
  const shape = [plan.path, ...plan.slots.map((s) => s.id)].join(' ');
  const digest = createHash('sha1').update(`${sessionId}${shape}`).digest('hex');
  return `comments_${digest.slice(0, 12)}`;
}

/**
 * What the turn is told when the round comes back after a restart, instead of as
 * the tool result it was waiting for. Same shape and same reasoning as
 * `askReplayPrompt`: pi persisted the draft the model wrote, so reopening the
 * session hands it back its own document. What it cannot have back is the tool
 * call it was parked on, so the comments arrive as a message and this line says
 * why they look that way.
 */
export function commentsReplayPrompt(plan: CommentPlan, answers: CommentAnswers | null): string {
  const opener =
    'You asked for comments on this in an earlier run and they are here now. They arrive as a message rather ' +
    'than as your tool result because the turn that asked has ended. Everything above is still your own work: ' +
    'pick up from it rather than starting again.';
  if (!answers) {
    return `${opener}\n\nThe PM closed ${plan.path} without commenting. Take the most reasonable reading of your own draft, say plainly which way you went and why, and finish the work.`;
  }
  return `${opener}\n\n${formatComments(plan, answers)}`;
}
