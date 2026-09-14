import {
  INFERRED_TODO_MARK,
  isFolderIndex,
  proposalHeadline,
  type OutboundCopyInput,
} from '@qale/domain';
import type {
  AskRequestDTO,
  CaptureNudgeStateDTO,
  NoteRefDTO,
  ProposalDTO,
  SessionLifecycle,
  VaultTreeDTO,
} from '@qale/ipc';
import { localDateStr } from './dates';
import {
  isLiveMeeting,
  isUpcomingMeeting,
  meetingStart,
  needsCapture,
  needsReview,
} from './note-status';

/**
 * The attention list — the ONE answer to "what is waiting on me".
 *
 * The sidebar badge, the ⌘K entry and Home each used to compute that answer
 * their own way, and the arithmetics disagreed (a parked question counted
 * nowhere, a card counted everywhere). The product's own arrival vision names
 * "two inboxes" as a failure signal, so there is now one ranked list and every
 * surface is a named filter over it.
 *
 * Build it once (`buildAttention`), rank it once (the push order below IS the
 * ranking), and count it with `waitingOnYou` or `countOf` — never with a fresh
 * arithmetic. If two surfaces can ever print different numbers again, one of
 * them stopped reading this file.
 */

/** What a piece of attention is. The order here is the ranking order. */
export type AttentionKind =
  /** A turn parked on a question the agent asked. It cannot finish on its own. */
  | 'question'
  /** A drafted change waiting for approval. */
  | 'card'
  /** A session that finished while the PO was elsewhere, unread. */
  | 'result'
  /** The next meeting, while it is still ahead, or the one happening now. */
  | 'meeting'
  /** A meeting that happened and was never filed. */
  | 'review'
  /** A meeting that happened and has nothing in it — offered, not owed. */
  | 'capture'
  /** The PO's own commitment, due today or already slipped. */
  | 'todo';

/** Where an item opens. Surfaces map this onto their own `open*` navigation. */
export type AttentionTarget =
  | { open: 'doc'; path: string }
  | { open: 'session'; sessionId: string; title: string }
  | { open: 'todos' }
  | { open: 'calendar' }
  | { open: 'folder'; dir: string }
  /** Add a source, attached to this meeting — the row IS the way to fill it. */
  | { open: 'capture'; path: string; title: string }
  /** Not a place: a group row that unfolds its own rows where it stands. */
  | { open: 'expand' };

/**
 * A label with one openable thing inside it. An empty-meeting row's sentence
 * names a meeting, and the name of a meeting should behave like one — a link to
 * the note, while the row around it keeps its own action. `label` is the same
 * sentence flattened, so a surface that only prints text needs none of this.
 */
export interface AttentionLink {
  before: string;
  /** The title: the part that reads, and behaves, as a link. */
  text: string;
  after: string;
  path: string;
}

/** How loud a row is allowed to be (DESIGN: amber is for "verify me"). */
export type AttentionTone = 'brand' | 'warning' | 'muted';

export interface AttentionItem {
  /** Stable across renders: the kind plus the thing's own id or path. */
  id: string;
  kind: AttentionKind;
  /** What it is, in the PO's words — never a path, never a prompt. */
  label: string;
  /** Why it needs the PO, or when: the short fact a row shows on the right. */
  meta: string;
  tone: AttentionTone;
  target: AttentionTarget;
  /** The one note this row's label names, when its label names one. */
  link?: AttentionLink;
  /**
   * A quiet second fact, printed after the label in the row's secondary voice.
   * One case today: a todo Qale worked out of a transcript rather than being
   * told, until the PM touches it (docs/fewer-approvals.md FA-7). Absent
   * everywhere else.
   */
  mark?: string;
  /** The instant the item is about, when it has one — a meeting's start, a due
   *  date, a card's creation. Surfaces that count down format this themselves. */
  when?: number;
  /**
   * Offered, not owed. A quiet item still shows in its session, but it never
   * counts toward a badge and never reaches Home: maintenance can wait as long
   * as the PO likes. This is the one property the old suggestion queue had that
   * had to survive it becoming ordinary cards and questions.
   */
  quiet?: boolean;
}

/** What the list needs from a merged session row — the structural subset of
 *  `SessionOverview`, kept local so the derivation never imports the store. */
export interface AttentionSession {
  id: string;
  title: string;
  updated: number;
  running: boolean;
  unread: boolean;
  pendingCards: number;
  lifecycle: SessionLifecycle;
}

export interface AttentionInput {
  /** Pending cards are read from here; resolved ones are ignored. */
  proposals: readonly ProposalDTO[];
  sessions: readonly AttentionSession[];
  /** Parked questions, keyed by session id. */
  askRequests: Readonly<Record<string, AskRequestDTO>>;
  tree: VaultTreeDTO | null;
  /** What the PO already waved off, so an empty meeting is asked about once
   *  (docs/capture-nudge.md). Null while it is still being read. */
  captureNudge: CaptureNudgeStateDTO | null;
}

/** How far ahead the next meeting has to be before it stops being "waiting". */
const NEXT_MEETING_MS = 12 * 3_600_000;

/**
 * The kinds that count as waiting on the PO: the one number the sidebar badge
 * and the ⌘K entry both print.
 *
 * These are the session items, minus whatever is `quiet`. Unfiled meetings, due
 * commitments and the next meeting are attention too (they are in the list and
 * Home shows them), but they are deliberately NOT in this count, because the
 * badge sits on the Sessions row and a meeting is not dealt with there. The
 * Todos row carries its own count, read from this same list.
 */
const WAITING_KINDS: ReadonlySet<AttentionKind> = new Set<AttentionKind>([
  'question',
  'card',
  'result',
]);

/** The named filter behind every "N waiting" badge. */
export function waitingOnYou(items: readonly AttentionItem[]): AttentionItem[] {
  return items.filter((i) => WAITING_KINDS.has(i.kind) && !i.quiet);
}

/** How many of one kind the list holds — the shape every "N of these" label
 *  uses, so no surface ever re-derives a count of its own. */
export function countOf(items: readonly AttentionItem[], kind: AttentionKind): number {
  return items.reduce((n, i) => n + (i.kind === kind ? 1 : 0), 0);
}

/** Every item of one kind, in list order. */
export function ofKind(items: readonly AttentionItem[], kind: AttentionKind): AttentionItem[] {
  return items.filter((i) => i.kind === kind);
}

/** Real notes of one type — a folder's index file is furniture, not work. */
function notesOfType(tree: VaultTreeDTO | null, type: NoteRefDTO['type']): NoteRefDTO[] {
  const group = tree?.groups.find((g) => g.type === type);
  return (group?.notes ?? []).filter((n) => !isFolderIndex(n.path));
}

/**
 * A pending card, in the words the card itself uses. Almost no card carries an
 * agent-written headline, so Home used to show the agent's reasoning while the
 * card rows showed the composed line, and one card read as two different jobs.
 * The rationale is the last resort: a payload too thin to compose from still has
 * to say something.
 */
function cardLabel(p: ProposalDTO): string {
  const payload = p.payload as {
    path?: string;
    frontmatter?: Record<string, unknown>;
    append?: string;
    body?: string;
    patch?: { search: string; replace: string }[];
  };
  const composed = proposalHeadline({
    kind: p.kind,
    targetPath: p.targetPath ?? payload.path,
    frontmatter: payload.frontmatter,
    append: payload.append,
    body: payload.body,
    patch: payload.patch,
    outbound: p.kind === 'outbound' ? (p.payload as OutboundCopyInput) : undefined,
  });
  return p.headline?.trim() || composed.trim() || p.rationale;
}

/**
 * The one derivation. Returns the whole attention list, ranked: parked
 * questions first (nothing else is permanently stuck without the PO), then
 * approvals, then answers waiting to be read, then the clock (the next meeting,
 * meetings never filed, commitments due).
 */
export function buildAttention(input: AttentionInput, now: number = Date.now()): AttentionItem[] {
  const items: AttentionItem[] = [];
  const { askRequests, captureNudge, proposals, sessions, tree } = input;

  // 1. Parked questions. A turn that asked something cannot move until it is
  //    answered, so nothing outranks it. Keyed by session rather than by request
  //    id: the PO is waiting on the session, and a re-asked question must not
  //    read as a brand new row.
  //
  //    An offered question is the exception: the librarian tidying up in the
  //    background is never something the PO owes an answer to, so its question
  //    goes quiet and waits in its session for as long as it takes. Main decides
  //    that (it knows who started the run); this only reads the answer.
  for (const [sessionId, request] of Object.entries(askRequests)) {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) continue;
    const quiet = request.offered;
    items.push({
      id: `question:${sessionId}`,
      kind: 'question',
      label: session.title,
      meta: 'question',
      tone: quiet ? 'muted' : 'brand',
      target: { open: 'session', sessionId, title: session.title },
      when: session.updated,
      quiet,
    });
  }

  // 2. Everything drafted and waiting for approval, newest first, librarian
  //    fixes included. A card is judged where it was written, so the row opens
  //    the session that put it up. A session row can be missing (a card from an
  //    outside client), and then the tab gets a plain name.
  const pending = [...proposals]
    .filter((p) => p.status === 'pending')
    .sort((a, b) => b.created - a.created);
  for (const p of pending) {
    const session = sessions.find((s) => s.id === p.sessionId);
    items.push({
      id: `card:${p.id}`,
      kind: 'card',
      label: cardLabel(p),
      meta: 'to approve',
      tone: 'brand',
      target: { open: 'session', sessionId: p.sessionId, title: session?.title ?? 'Session' },
      when: p.created,
    });
  }

  // 3. Sessions that finished while the PO was elsewhere. A session they
  //    unpinned is off the active surfaces, unread or not.
  const results = sessions
    .filter(
      (s) =>
        s.lifecycle === 'active' &&
        s.unread &&
        !s.running &&
        s.pendingCards === 0 &&
        !askRequests[s.id],
    )
    .sort((a, b) => b.updated - a.updated);
  for (const s of results) {
    items.push({
      id: `result:${s.id}`,
      kind: 'result',
      label: s.title,
      meta: 'answered',
      tone: 'brand',
      target: { open: 'session', sessionId: s.id, title: s.title },
      when: s.updated,
    });
  }

  // A cancelled meeting never happened: it needs no prep and no review.
  const meetings = notesOfType(tree, 'meeting').filter((n) => n.eventStatus !== 'cancelled');

  // 4. The next meeting, while it is still ahead and close enough to matter, or
  //    the one happening right now. The row used to stop at the start time,
  //    which is the minute it becomes useful: the PO is in the room, and the one
  //    place that would hand them the page has just dropped it.
  //
  //    An all-day entry never holds the row: `isLiveMeeting` leaves it out, so
  //    an offsite or a holiday cannot read as a call in progress all day.
  const next = meetings
    .filter(
      (n) =>
        isLiveMeeting(n, now) ||
        (isUpcomingMeeting(n, now) && meetingStart(n) - now < NEXT_MEETING_MS),
    )
    // A meeting in progress IS the row, so it beats one that has not started.
    .sort(
      (a, b) =>
        Number(isLiveMeeting(b, now)) - Number(isLiveMeeting(a, now)) ||
        meetingStart(a) - meetingStart(b),
    )[0];
  if (next) {
    const live = isLiveMeeting(next, now);
    items.push({
      id: `meeting:${next.path}`,
      kind: 'meeting',
      // While it runs the row is a door to the notes, not a clock: naming the
      // meeting again says nothing the PO does not already know.
      label: live ? `Take notes in ${next.title}` : next.title,
      meta: live ? 'now' : (next.time ?? 'today'),
      tone: 'muted',
      target: { open: 'doc', path: next.path },
      when: meetingStart(next),
    });
  }

  // 5. Meetings that happened and never got their review — the memory's own
  //    backlog, in the amber flag voice. Cancelled meetings never happened, so
  //    `needsReview` leaves them out.
  const unreviewed = meetings
    .filter((n) => needsReview(n, now))
    .sort((a, b) => meetingStart(b) - meetingStart(a));
  for (const n of unreviewed) {
    items.push({
      id: `review:${n.path}`,
      kind: 'review',
      label: `Review ${n.title}`,
      meta: 'not filed yet',
      tone: 'warning',
      target: { open: 'doc', path: n.path },
      when: meetingStart(n),
    });
  }

  // 6. Meetings the calendar says happened and that hold nothing at all. Not a
  //    backlog and not a scolding: the app made these notes, so it is the app
  //    that says they are still blank. Muted tone, dismissable, and gone by
  //    itself after four days (docs/capture-nudge.md).
  const dismissed = new Set(captureNudge?.dismissed ?? []);
  const muted = new Set(captureNudge?.mutedSeries ?? []);
  const uncaptured = meetings
    .filter(
      (n) => needsCapture(n, now) && !dismissed.has(n.path) && !(n.series && muted.has(n.series)),
    )
    .sort((a, b) => meetingStart(b) - meetingStart(a));
  for (const n of uncaptured) {
    // Built once, two ways: the flat sentence for surfaces that only print, and
    // the same sentence in parts so the title can be a link to the meeting.
    const before = `${dayPossessive(meetingStart(n), now)} `;
    const after = ' has nothing in it yet';
    items.push({
      id: `capture:${n.path}`,
      kind: 'capture',
      label: `${before}${n.title}${after}`,
      link: { before, text: n.title, after, path: n.path },
      meta: 'add a transcript',
      tone: 'muted',
      target: { open: 'capture', path: n.path, title: n.title },
      when: meetingStart(n),
    });
  }

  // 7. The PO's own commitments, due today or already slipped. Waiting-on items
  //    (those with an owner) are somebody else's move.
  const today = localDateStr(new Date(now));
  const due = notesOfType(tree, 'todo')
    .filter((n) => (n.lifecycle ?? 'open') === 'open' && !n.owner && !!n.due && n.due <= today)
    .sort((a, b) => (a.due! < b.due! ? -1 : a.due! > b.due! ? 1 : 0));
  for (const n of due) {
    items.push({
      id: `todo:${n.path}`,
      kind: 'todo',
      label: n.title,
      meta: n.due! < today ? 'overdue' : 'today',
      tone: 'warning',
      target: { open: 'doc', path: n.path },
      when: Date.parse(n.due!),
      // A commitment Qale heard reads the same as one the PM made, and the two
      // are not the same promise. The row says which (FA-7).
      ...(n.inference ? { mark: INFERRED_TODO_MARK } : {}),
    });
  }

  return items;
}

/** "Today's", "Yesterday's", "Monday's" — how a person names the day a meeting
 *  sat on. Only ever used inside a few days, so a weekday name is unambiguous. */
function dayPossessive(when: number, now: number): string {
  const midnight = (ts: number): number => new Date(ts).setHours(0, 0, 0, 0);
  const days = Math.round((midnight(now) - midnight(when)) / 86_400_000);
  if (days <= 0) return "Today's";
  if (days === 1) return "Yesterday's";
  return `${new Date(when).toLocaleDateString(undefined, { weekday: 'long' })}'s`;
}
