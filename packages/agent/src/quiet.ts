import { Type } from 'typebox';
import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';

/**
 * Ending a run without saying anything (QM ticket 2).
 *
 * A session the PM started is cheap to end loudly: they are looking at it, and
 * a short "nothing changed" is the answer they asked for. A run a clock started
 * is not. It files a receipt into `sessions/`, adds a row to the Sessions list
 * and increments the badge on the Inbox, and it does all three whether or not
 * it found anything. A weekly synthesis with nothing to cluster costs the PM
 * three of those a month, and after the second one the badge has stopped
 * meaning "something needs you".
 *
 * So a scheduled run gets a way out. Three parts, because one is never enough:
 *
 * 1. {@link SCHEDULED_PREAMBLE} (in ./prompts.ts) tells a scheduled run that
 *    silence is the expected outcome.
 * 2. {@link createEndQuietlyTool} lets it take that outcome. The SAME tool is
 *    registered on interactive sessions, where it is a deliberate no-op that
 *    says a person is waiting. That asymmetry is the design: the model does not
 *    have to work out which kind of turn it is in, and a tool that vanished
 *    between session kinds would only teach it to guess.
 * 3. {@link readsAsNothingToReport} is the backstop, because models forget to
 *    call tools. It reads the LAST line of the final reply and nothing else.
 *
 * None of the three decides on its own. The runtime asks whether the run
 * actually PRODUCED anything first (a card, a draft, a question put to the PM),
 * and a run that produced something is never silent however it phrased itself.
 * A run that FAILED is never silent either: a scheduled run that broke is
 * exactly the one the PM needs to see.
 */

export const END_QUIETLY_TOOL_NAME = 'end_quietly';

/**
 * The backstop's vocabulary. Deliberately small: every entry here is a phrase
 * that means "I have nothing", and nothing here means "here is a short result".
 * Growing this list is how a real answer gets swallowed, so it grows only with
 * a phrase we have watched a model actually end a silent run on.
 */
const NOTHING_MARKERS = [
  'nothing to report',
  'nothing new',
  'nothing changed',
  'nothing to add',
  'no changes',
];

/**
 * A closing line long enough to carry a fact is a report, not a shrug. "Nothing
 * new on pricing, but the Nordkap renewal moved to Q4" opens with a marker and
 * still has to reach the PM.
 */
const MARKER_LINE_MAX = 80;

/**
 * Whether the model's final reply reads as "I found nothing" — the backstop for
 * a scheduled run that never called the tool.
 *
 * Only the LAST non-empty line is looked at, and the marker has to START it.
 * Both narrowings exist for the same reason: a genuine report that mentions
 * having nothing on one thread ("Nothing to report on pricing, but three
 * interviews landed") must still be delivered, and the PM cannot be expected to
 * notice which of their agents went quiet because of a substring match.
 */
export function readsAsNothingToReport(reply: string): boolean {
  const lines = reply.split('\n').map((l) => l.trim());
  const last = lines.filter(Boolean).pop();
  if (!last) return false;
  const line = last
    // Markdown decoration is formatting, not words: "**Nothing to report.**"
    // and "- nothing new" are the same sentence as the bare one.
    .replace(/[*_`#>]/g, '')
    .replace(/^[-•\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[.!…]+$/, '');
  if (!line || line.length > MARKER_LINE_MAX) return false;
  return NOTHING_MARKERS.some((m) => line.startsWith(m));
}

/** Everything deciding "did this run leave nothing" is allowed to look at. */
export interface RunOutcome {
  /** A clock started this turn, not a person. Nothing else can be silent. */
  scheduled: boolean;
  /** The turn threw. */
  failed: boolean;
  /**
   * The run put something in front of the PM: a proposed or drafted card, or a
   * question. Read off the ledger the tools write, never off the model's account
   * of itself.
   */
  produced: boolean;
  /** The model called `end_quietly`. */
  ended: boolean;
  /**
   * The run hit a decision only the PM could make and nobody was there to make
   * it (QM ticket 9). It leaves the same nothing a quiet run leaves, and for a
   * better reason: it stopped early, so there is even less to show. What it does
   * leave is a line on the agent's own page saying why.
   */
  blocked: boolean;
  /** The last assistant message of the turn, for the backstop. */
  finalText: string;
}

/**
 * Whether a run genuinely left nothing behind.
 *
 * The order of the checks is the design. What the run PRODUCED is asked before
 * anything the model said, because a card or a question is work the PM now has
 * to do and no closing line can take that back. A run that FAILED never
 * qualifies either, whatever it managed to say on the way down: "ran and had
 * nothing to report" and "ran and broke" are different outcomes, and the second
 * one keeps its row, its receipt and its notification.
 *
 * A run that stopped for want of a decision counts as silent without being asked
 * how it phrased itself: it was told to stop and say nothing, so waiting for a
 * "nothing to report" line it was never going to write would hand the PM a row
 * and a receipt for a run that did not happen.
 */
export function ranSilent(o: RunOutcome): boolean {
  if (!o.scheduled || o.failed || o.produced) return false;
  return o.blocked || o.ended || readsAsNothingToReport(o.finalText);
}

export interface QuietDeps {
  /**
   * Whether the turn running RIGHT NOW was started by a clock rather than by a
   * person. Asked per turn, not per session: the PM can open a scheduled run
   * that did produce something and write to it, and from that message on
   * somebody is waiting.
   */
  scheduled: () => boolean;
  /** The model asked for silence. Only ever called on a scheduled turn. */
  endQuietly: () => void;
}

function text(s: string) {
  return { content: [{ type: 'text' as const, text: s }], details: undefined };
}

export function createEndQuietlyTool(deps: QuietDeps): ToolDefinition {
  return defineTool({
    name: END_QUIETLY_TOOL_NAME,
    label: 'End quietly',
    description:
      'End this run without producing anything, because there is nothing worth telling the PM. Use it only on a ' +
      'run a schedule started: you checked what you were asked to check, nothing has changed since the last pass, ' +
      'and any message you wrote now would be a "nothing to report" the PM has to open to read. Call it instead ' +
      'of writing that message, and stop there. Do NOT use it to get out of work you have not done, and do NOT ' +
      'use it when you found something and decided it was small: propose the card. On a session a person started ' +
      'this does nothing, because they are waiting for an answer and silence is not one.',
    parameters: Type.Object({}),
    async execute() {
      if (!deps.scheduled()) {
        return text(
          'Nothing to end: a person started this session and is waiting on this turn, so silence is not an ' +
            'outcome here. Answer them directly, even if the answer is that nothing changed.',
        );
      }
      deps.endQuietly();
      return text(
        'Noted. This run will leave no receipt, no row and no badge, only a line on your page saying you ran ' +
          'and had nothing to report. Stop here and write nothing further.',
      );
    },
  });
}
