import { createHash } from 'node:crypto';
import { Type } from 'typebox';
import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { oneLine, type AskPort, type AskRecord } from '@qale/application';
import { MAINTENANCE_AGENTS } from '@qale/sessions';

/**
 * Asking the PM a question mid-turn — the same primitive Claude Code exposes as
 * AskUserQuestion, shaped for this app.
 *
 * The point is NOT "the agent can talk to you": it already can, by ending its
 * turn with a question in prose. The point is that ending the turn is expensive
 * here. A session that has read nine transcripts and is one decision away from
 * proposing cards would have to stop, hand the question back, and rebuild its
 * footing on the next message. So the question happens INSIDE the turn: the tool
 * parks on a promise, the renderer draws a card, and the answer comes back as a
 * tool result the model reads like any other.
 *
 * Two rules make it not-annoying, and they live in the tool description because
 * that is the only place the model reliably reads them:
 * 1. Ask only what is genuinely the PM's call — a decision you cannot resolve
 *    from the workspace, the request, or a sensible default.
 * 2. Every question carries concrete options. "What should I do?" is a worse
 *    version of ending the turn; "A or B, and here is what each means" is a
 *    decision the PM can make in one click.
 *
 * Same spine as the spawn card (`spawn.ts`): pure planning + validation here,
 * the parked promise in {@link AskParking}, an inline card in the chat. Never a
 * modal.
 *
 * The promise is not the whole story, because a promise dies with the process.
 * {@link AskParking} is also where the question is written down, so quitting the
 * app with one on screen loses neither the question nor the turn behind it. Park
 * and resume live in this one file on purpose: they have to stay symmetric, and
 * the failure mode when they drift is a question that reads back as something
 * nobody asked.
 */

export const ASK_TOOL_NAME = 'ask_user';

/** Claude Code's ceiling, and a good one: past four the card is a form. */
export const ASK_MAX_QUESTIONS = 4;

/** Options per question. Two is a decision; five is a menu nobody reads. */
export const ASK_MAX_OPTIONS = 4;

/** Headers are chips in the UI, not sentences. */
export const ASK_HEADER_MAX = 12;

/**
 * Ceilings on the text a question card carries, and the reason is OW9 rather
 * than layout.
 *
 * A parked question OUTLIVES the turn that asked it. It is written to `app.db`,
 * survives quitting the app, and when the PM finally answers it comes back
 * through {@link askReplayPrompt} as a USER message in a later run — the one
 * role in the conversation the model is meant to take instructions from. So the
 * model's own words move up a privilege level on their way through storage, and
 * a question written under the influence of something injected would arrive
 * looking like the PM asking for it.
 *
 * Nothing here can stop the model asking a leading question, and nothing should:
 * asking is the point. What these do is keep a question the SIZE of a question.
 * Flattened, capped and stripped of envelope markers, it can hold a sentence
 * somebody has to read and not a page of instructions dressed as one — and the
 * card renders the same text, so the PM sees exactly what will be replayed.
 */
export const ASK_QUESTION_MAX = 400;
export const ASK_LABEL_MAX = 100;
export const ASK_DESCRIPTION_MAX = 200;

/** One choice on the card. The description is where the trade-off goes. */
export interface AskOption {
  label: string;
  description?: string;
}

/** One question, after validation. */
export interface AskQuestion {
  /** Short chip label ("Scope", "Tone") — never a sentence. */
  header: string;
  question: string;
  options: AskOption[];
  /** Options are not mutually exclusive (checkboxes rather than radios). */
  multiSelect: boolean;
}

/** The whole card: one to four questions, answered in one submit. */
export interface AskPlan {
  questions: AskQuestion[];
}

/**
 * What the PM chose for one question. The two fields are independent because on
 * a multi-select question they genuinely are: "Åsa, the PAY channel, and also
 * Henrik in support" is one answer, not a choice between ticking and typing.
 * Both empty means the question was skipped.
 */
export interface AskAnswer {
  /** Chosen option labels — several only when the question was multi-select. */
  selected: string[];
  /** Free text the PM wrote, if any. Stands alone, or joins the ticks. */
  written?: string;
}

/**
 * The card settled. `answers: null` means it was dismissed — the PM skipped it,
 * or the run was stopped. Never a rejected promise: the model has to be told.
 */
export interface AskDecision {
  answers: AskAnswer[] | null;
  /**
   * The card was never shown, because a clock started this run and there is
   * nobody at the screen (QM ticket 9). Not a dismissal: a dismissal is a person
   * saying "decide it yourself", and this is the opposite instruction.
   */
  unattended?: boolean;
}

/**
 * A question card waiting on the PM, as the renderer draws it. The questions are
 * exactly what the tool validated — the card never re-derives them.
 */
export interface AskRequestInfo {
  id: string;
  sessionId: string;
  questions: AskQuestion[];
  /**
   * Offered rather than owed (see {@link isOffered}). The card carries the
   * answer rather than the facts behind it, so no surface downstream has to
   * work the rule out again and get a different result.
   */
  offered: boolean;
}

/**
 * What the tool knows at the moment it asks. Who asked, and whether the answer
 * is owed, are facts about the RUN, so {@link AskParking.park} stamps them.
 */
export type AskRequestDraft = Omit<AskRequestInfo, 'offered'>;

/**
 * Is what this run asks for offered rather than owed? Both halves have to hold.
 * A maintenance agent tidies the workspace on its own account, so a pass nobody
 * asked for can wait as long as the PM likes. The same agent started by hand is
 * a person sitting there waiting for an answer, and arrival runs with nobody
 * watching but was handed material somebody is coming back for, so neither of
 * those goes quiet.
 */
export function isOffered(skill: string | null | undefined, unattended: boolean): boolean {
  return unattended && MAINTENANCE_AGENTS.has(skill ?? '');
}

/**
 * Trim a header to the chip width rather than failing the turn over it. Cuts on
 * a word boundary when there is one: "Whose framing" reads as "Whose", never as
 * "Whose framin".
 */
function chip(header: string): string {
  const flat = oneLine(header, Number.MAX_SAFE_INTEGER);
  if (flat.length <= ASK_HEADER_MAX) return flat;
  const cut = flat.slice(0, ASK_HEADER_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  return lastSpace >= 3 ? cut.slice(0, lastSpace) : cut;
}

/**
 * Validate and normalise what the model asked for. Pure, and the card renders
 * exactly this — nothing is re-derived after the PM answers.
 *
 * Errors come back as tool text rather than thrown: a malformed question is
 * something the model can fix on the next call, and killing the turn over it
 * would lose the reading it already did.
 */
export function planAsk(input: unknown): { plan: AskPlan } | { error: string } {
  const questions = (input as { questions?: unknown })?.questions;
  if (!Array.isArray(questions) || questions.length === 0) {
    return { error: 'ask_user needs at least one entry in questions[].' };
  }
  if (questions.length > ASK_MAX_QUESTIONS) {
    return {
      error: `ask_user takes at most ${ASK_MAX_QUESTIONS} questions; you asked ${questions.length}. Ask the ones that actually change what you do next.`,
    };
  }
  const out: AskQuestion[] = [];
  for (const [i, raw] of questions.entries()) {
    const at = `questions[${i}]`;
    const q = raw as {
      header?: string;
      question?: string;
      options?: unknown;
      multiSelect?: boolean;
    };
    if (!q?.question?.trim()) return { error: `${at}: question is required.` };
    if (!q.header?.trim())
      return { error: `${at}: header is required (a short chip label like "Scope").` };
    if (!Array.isArray(q.options) || q.options.length < 2) {
      return {
        error: `${at}: give at least 2 concrete options. A question with no options is just a question — end your turn and ask it in prose instead.`,
      };
    }
    if (q.options.length > ASK_MAX_OPTIONS) {
      return {
        error: `${at}: at most ${ASK_MAX_OPTIONS} options (the PM can always write their own answer).`,
      };
    }
    const options: AskOption[] = [];
    const seen = new Set<string>();
    for (const [j, rawOpt] of q.options.entries()) {
      const opt = rawOpt as { label?: string; description?: string };
      const label = oneLine(opt?.label ?? '', ASK_LABEL_MAX);
      if (!label) return { error: `${at}.options[${j}]: label is required.` };
      if (seen.has(label.toLowerCase()))
        return { error: `${at}: two options are labelled "${label}".` };
      seen.add(label.toLowerCase());
      const description = oneLine(opt.description ?? '', ASK_DESCRIPTION_MAX);
      options.push({ label, ...(description ? { description } : {}) });
    }
    out.push({
      header: chip(q.header),
      // Flattened and capped on the way IN, so the card, the row in `app.db` and
      // the replayed message a later run reads are all the same bounded line.
      question: oneLine(q.question, ASK_QUESTION_MAX),
      options,
      multiSelect: q.multiSelect === true,
    });
  }
  return { plan: { questions: out } };
}

/**
 * Render the answer back to the model. Plain text, question by question, because
 * the model reads this as a tool result and has to be able to act on it without
 * re-asking. A skipped question is stated as skipped rather than omitted.
 */
export function formatAnswers(plan: AskPlan, answers: AskAnswer[]): string {
  const lines: string[] = ['The PM answered:'];
  plan.questions.forEach((q, i) => {
    const a = answers[i];
    const chosen = a?.selected.filter((s) => s.trim()) ?? [];
    const written = a?.written?.trim();
    lines.push('', `Q (${q.header}): ${q.question}`);
    if (chosen.length === 0 && !written) {
      lines.push('A: (skipped — decide this yourself and say what you assumed)');
    } else if (chosen.length === 0) {
      lines.push(`A: (wrote) ${written}`);
    } else if (written) {
      // A multi-select answer can be ticks AND their own addition; reporting
      // only one half would drop something the PM deliberately said.
      lines.push(`A: ${chosen.join(', ')} — and wrote: ${written}`);
    } else {
      lines.push(`A: ${chosen.join(', ')}`);
    }
  });
  lines.push(
    '',
    'Act on this now, in this same turn. Do not repeat the answers back or ask a follow-up card unless a new decision genuinely opened up.',
  );
  return lines.join('\n');
}

export interface AskDeps {
  /**
   * Show the card and wait. Resolves when the PM answers, skips, or the run is
   * stopped — never rejects, and never times out: the only ways out are the ones
   * the PM can see.
   */
  requestAnswer: (plan: AskPlan, signal?: AbortSignal) => Promise<AskDecision>;
}

function text(s: string) {
  return { content: [{ type: 'text' as const, text: s }], details: undefined };
}

export function createAskTool(deps: AskDeps): ToolDefinition {
  return defineTool({
    name: ASK_TOOL_NAME,
    label: 'Ask the PM',
    description:
      'Ask the PM a question and wait for their answer, without ending your turn. Use this ONLY when you are ' +
      'blocked on a decision that is genuinely theirs: one you cannot settle from the workspace, from what they ' +
      'asked for, or from a sensible default — and where different answers would lead to materially different ' +
      'work. Typical cases: which of two readings of an ambiguous request to follow, which scope to propose ' +
      'cards for, whose framing to use when two notes contradict each other. Do NOT use it to check whether you ' +
      'may proceed, to confirm a plan, to pick something with an obvious default, or to ask something the ' +
      'workspace already answers — read the note instead. Every question needs 2-4 concrete options with short ' +
      'descriptions of what each one means; the PM can always write their own answer instead. Ask everything ' +
      'you need in ONE call (up to 4 questions) rather than one card after another. If you can do useful work ' +
      'without the answer, do that work first and ask at the point it actually matters.',
    parameters: Type.Object({
      questions: Type.Array(
        Type.Object({
          header: Type.String({
            description: `Short chip label for this question, max ${ASK_HEADER_MAX} characters, e.g. "Scope" or "Which theme".`,
          }),
          question: Type.String({
            description:
              'The question, in full. State what is unclear and why it changes what you would do.',
          }),
          options: Type.Array(
            Type.Object({
              label: Type.String({ description: 'The choice, in a few words.' }),
              description: Type.Optional(
                Type.String({
                  description: 'What picking this means or leads to. One short sentence.',
                }),
              ),
            }),
            {
              description: `The choices. 2-${ASK_MAX_OPTIONS} of them, concrete and mutually distinct. Put your recommendation first.`,
            },
          ),
          multiSelect: Type.Optional(
            Type.Boolean({
              description:
                'True when the options are not mutually exclusive, so several answers can be right at once — who to include, which sections to write, which accounts to cover. Set it whenever "any of these" is a sensible answer; leave it off only when picking one genuinely rules out the others.',
            }),
          ),
        }),
        {
          description: `The questions, at most ${ASK_MAX_QUESTIONS}. One card, answered in one go.`,
        },
      ),
    }),
    // The PM is answering this card; nothing else in the turn should be running
    // underneath it, and a second card in parallel would be two things to answer
    // with one composer.
    executionMode: 'sequential',
    promptGuidelines: [
      "When a decision is genuinely the PM's and you cannot proceed sensibly without it, call ask_user with concrete options rather than guessing or ending your turn.",
      'Do everything that does not depend on the answer BEFORE asking.',
    ],
    async execute(_id, params, signal) {
      const planned = planAsk(params);
      if ('error' in planned) return text(`Rejected: ${planned.error}`);
      const { plan } = planned;

      const decision = await deps.requestAnswer(plan, signal);
      // Nobody is there. Failing closed beats parking a card that would sit
      // unread until the next scheduled run asked the same thing again.
      if (decision.unattended) {
        return text(
          'Nobody is here to answer. A clock started this run, not a person, so there is no PM at the screen ' +
            'and this question would sit unanswered. Stop now: do not guess your way past a decision that is ' +
            'theirs, and do not write a note about it. The run is recorded as stopped because it needed a ' +
            'decision, and it shows on your page when they next open it. End your turn without writing anything.',
        );
      }
      if (!decision.answers) {
        return text(
          'The PM dismissed the question without answering. Do not ask again. Pick the most reasonable ' +
            'option yourself, say plainly which way you went and why, and carry on.',
        );
      }
      return text(formatAnswers(plan, decision.answers));
    },
  });
}

/**
 * The id for one question card, derived from the session and the questions
 * rather than drawn at random (QM ticket 9, copied from QM). Two consequences,
 * both wanted: the same session asking the same thing twice addresses one row
 * rather than two, and an answer that arrives twice — a double click, a second
 * window, a retried IPC — settles the same id and the second one finds nothing
 * left to settle.
 */
export function askRequestId(sessionId: string, plan: AskPlan): string {
  const shape = plan.questions
    .map((q) => [q.header, q.question, q.multiSelect, ...q.options.map((o) => o.label)].join(' '))
    .join('');
  const digest = createHash('sha1').update(`${sessionId}${shape}`).digest('hex');
  return `ask_${digest.slice(0, 12)}`;
}

/**
 * What the turn is told when the answer arrives after a restart, instead of as
 * the tool result it was waiting for.
 *
 * The reading behind it is not lost: pi persists every assistant message and
 * tool result as it happens, so reopening the session hands the model back
 * everything it read before it asked, and the cards it had already proposed are
 * in the Inbox where it left them. What it cannot have back is the tool call it
 * was parked on, so the answer arrives as a message and this line says why it
 * looks that way.
 */
export function askReplayPrompt(plan: AskPlan, answers: AskAnswer[] | null): string {
  const opener =
    'You asked this in an earlier run and the answer is here now. It arrives as a message rather than as ' +
    'your tool result because the turn that asked has ended. Everything above is still your own work: ' +
    'pick up from it rather than starting again.';
  if (!answers) {
    return `${opener}\n\nThe PM dismissed the question without answering. Pick the most reasonable option yourself, say plainly which way you went and why, and carry on.`;
  }
  return `${opener}\n\n${formatAnswers(plan, answers)}`;
}

/** One parked question, read back off disk with its questions decoded. */
export interface StoredAsk {
  id: string;
  sessionId: string;
  questions: AskQuestion[];
  /** The skill in force when it asked — the footing a replayed turn resumes on. */
  skill: string | null;
  outbound: boolean;
  /** Whether anybody was at the screen when it asked. */
  unattended: boolean;
}

function decode(record: AskRecord): StoredAsk {
  return {
    id: record.id,
    sessionId: record.sessionId,
    questions: (record.questions ?? []) as AskQuestion[],
    skill: record.skill,
    outbound: record.outbound,
    unattended: record.unattended,
  };
}

/** The card, redrawn from the row a question was written to. */
function toRequest(asked: StoredAsk): AskRequestInfo {
  return {
    id: asked.id,
    sessionId: asked.sessionId,
    questions: asked.questions,
    offered: isOffered(asked.skill, asked.unattended),
  };
}

/** How a settled card is answered when the turn that asked it is gone. */
export type AskReplay = (asked: StoredAsk, decision: AskDecision) => Promise<void>;

export interface AskParkingDeps {
  /** A card arrived (`request`) or settled (`null`) — the renderer's push. */
  onChange: (sessionId: string, request: AskRequestInfo | null) => void;
}

/**
 * Where a question waits. Two layers, and the second is the point of this class:
 *
 * - The promise the running tool is parked on. Only ever exists while the
 *   process that asked is still up, and it is what makes an answer land as a
 *   tool result inside the same turn — the cheap path, and the usual one.
 * - The row in `app.db`. Written before the card is pushed and removed when it
 *   settles, so a question outlives the process the way a proposal card does.
 *
 * An answer takes the first layer if it is there and the second if it is not.
 * The second is a REPLAY: the session is reopened and the answer arrives as a
 * message rather than as the tool result nobody is holding any more.
 */
export class AskParking {
  /** requestId → the card in flight and the promise `ask_user` is parked on. */
  private readonly live = new Map<
    string,
    { request: AskRequestInfo; resolve: (d: AskDecision) => void }
  >();

  constructor(private readonly deps: AskParkingDeps) {}

  /**
   * Park a question: write it down, show it, and wait. No timeout, by design —
   * the exits are answer, skip and stopping the run, all three visible on
   * screen. A store-less context (no vault open) parks in memory only, which is
   * exactly the pre-ticket-9 behaviour rather than a refusal to ask.
   *
   * Except on a run a clock started, where none of that holds: there is no
   * screen and nobody to settle it, so the question is refused instead of
   * parked. Refused rather than merely unshown — nothing is written down and
   * nothing is pushed, because a card recovered later would be a card asking
   * about a turn that stopped days ago.
   */
  park(
    store: AskPort | undefined,
    request: AskRequestDraft,
    context: {
      scheduled?: boolean;
      unattended?: boolean;
      skill?: string | null;
      outbound?: boolean;
    },
    signal?: AbortSignal,
  ): Promise<AskDecision> {
    if (context.scheduled) return Promise.resolve({ answers: null, unattended: true });
    // The run's own facts, spent twice: the row is the footing a replayed turn
    // resumes on, and the card carries the one thing every surface downstream
    // wants out of them, which is whether this answer is owed.
    const unattended = !!context.unattended;
    const asked: AskRequestInfo = { ...request, offered: isOffered(context.skill, unattended) };
    store?.create(
      {
        id: asked.id,
        sessionId: asked.sessionId,
        questions: asked.questions,
        skill: context.skill ?? null,
        outbound: !!context.outbound,
        unattended,
      },
      Date.now(),
    );
    return new Promise<AskDecision>((resolve) => {
      // An abort that reaches the tool directly (pi cancelling the call) must
      // settle the card too, or it would sit there asking about a dead turn.
      const onAbort = () => void this.resolve(store, asked.id, { answers: null });
      if (signal?.aborted) {
        store?.remove(asked.id);
        resolve({ answers: null });
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      this.live.set(asked.id, {
        request: asked,
        resolve: (decision) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(decision);
        },
      });
      this.deps.onChange(asked.sessionId, asked);
    });
  }

  /** The card this session is parked on, for a tab that reopened — or an app that did. */
  pendingFor(store: AskPort | undefined, sessionId: string): AskRequestInfo | null {
    for (const p of this.live.values()) if (p.request.sessionId === sessionId) return p.request;
    const stored = store?.forSession(sessionId);
    if (!stored) return null;
    return toRequest(decode(stored));
  }

  /**
   * Every question still waiting, live or recovered. The store is authoritative
   * because a parked question is written to it first, so this is one list and
   * not a merge; without a store the live map is all there is.
   */
  all(store: AskPort | undefined): AskRequestInfo[] {
    if (!store) return [...this.live.values()].map((p) => p.request);
    return store.list().map((r) => toRequest(decode(r)));
  }

  /**
   * The PM answered (or skipped). A question that is already settled resolves
   * nothing and starts nothing: that is the whole of "answering twice is
   * harmless", and it holds across a restart because the row is gone either way.
   */
  async resolve(
    store: AskPort | undefined,
    requestId: string,
    decision: AskDecision,
    replay?: AskReplay,
  ): Promise<void> {
    const pending = this.live.get(requestId);
    const stored = store?.get(requestId) ?? null;
    if (!pending && !stored) return;
    // Cleared BEFORE anything is resumed, so a second answer arriving while the
    // replay is still starting up finds nothing and cannot run the turn twice.
    this.live.delete(requestId);
    store?.remove(requestId);
    if (pending) {
      this.deps.onChange(pending.request.sessionId, null);
      pending.resolve(decision);
      return;
    }
    if (!stored) return;
    const asked = decode(stored);
    this.deps.onChange(asked.sessionId, null);
    if (!replay) return;
    try {
      await replay(asked, decision);
    } catch (err) {
      // The turn could not be resumed (no key, a session already responding).
      // Put the question back rather than swallowing it: an answer that lands
      // nowhere is the failure this whole mechanism exists to prevent.
      console.error('[qale] replaying an answered question failed:', err);
      if (store) {
        store.create(
          {
            id: asked.id,
            sessionId: asked.sessionId,
            questions: asked.questions,
            skill: asked.skill,
            outbound: asked.outbound,
            unattended: asked.unattended,
          },
          stored.created,
        );
        this.deps.onChange(asked.sessionId, toRequest(asked));
      }
    }
  }

  /**
   * Drop every card on this session (abort, delete, reconfigure) — or all of
   * them. A cancelled question is gone for good: the PM stopped the run, so
   * there is nothing left for an answer to reach.
   */
  cancel(store: AskPort | undefined, sessionId?: string): void {
    for (const [id, pending] of [...this.live]) {
      if (sessionId && pending.request.sessionId !== sessionId) continue;
      this.live.delete(id);
      store?.remove(id);
      this.deps.onChange(pending.request.sessionId, null);
      pending.resolve({ answers: null });
    }
    // A row with no promise behind it belongs to a session this process never
    // resumed; dropping the session drops its question too.
    if (!sessionId || !store) return;
    const stored = store.forSession(sessionId);
    if (stored) {
      store.remove(stored.id);
      this.deps.onChange(sessionId, null);
    }
  }
}
