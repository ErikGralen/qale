import { isFolderIndex } from '@pm/domain';
import type {
  AgentPingDTO,
  AskRequestDTO,
  NoteRefDTO,
  ProposalDTO,
  SessionLifecycle,
  VaultTreeDTO,
} from '@pm/ipc';
import { localDateStr } from './dates';
import { isUpcomingMeeting, meetingStart, needsReview } from './note-status';

/**
 * The attention list — the ONE answer to "what is waiting on me".
 *
 * Home's waiting list, the sidebar's Inbox badge, the ⌘K entry and the Inbox
 * header each used to compute that answer their own way, and the three
 * arithmetics disagreed (a parked question counted nowhere, a card counted
 * everywhere, a dismissed-but-unread session counted only on Home). The
 * product's own arrival vision names "two inboxes" as a failure signal, so
 * there is now one ranked list and every surface is a named filter over it.
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
  /** The next meeting, while it is still ahead. */
  | 'meeting'
  /** A meeting that happened and was never filed. */
  | 'review'
  /** The PO's own commitment, due today or already slipped. */
  | 'todo'
  /** A librarian suggestion — offered, not owed. */
  | 'ping';

/** Where an item opens. Surfaces map this onto their own `open*` navigation. */
export type AttentionTarget =
  | { open: 'doc'; path: string }
  | { open: 'session'; sessionId: string; title: string }
  | { open: 'inbox' }
  | { open: 'todos' }
  | { open: 'folder'; dir: string };

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
  /** The instant the item is about, when it has one — a meeting's start, a due
   *  date, a card's creation. Surfaces that count down format this themselves. */
  when?: number;
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
  pings: readonly AgentPingDTO[];
  tree: VaultTreeDTO | null;
}

/** How far ahead the next meeting has to be before it stops being "waiting". */
const NEXT_MEETING_MS = 12 * 3_600_000;

/**
 * The kinds that count as waiting on the PO — the one number the sidebar badge,
 * the ⌘K entry and the Inbox header all print.
 *
 * These are the Inbox's items minus the librarian's suggestions: a suggestion
 * is offered, not owed, and it can always wait. Unfiled meetings, due
 * commitments and the next meeting are attention too — they are in the list and
 * Home shows them — but they are deliberately NOT in this count, because the
 * badge sits on the Inbox row and the Inbox is not where they get dealt with.
 * The Todos row carries its own count, read from this same list.
 */
const WAITING_KINDS: ReadonlySet<AttentionKind> = new Set<AttentionKind>([
  'question',
  'card',
  'result',
]);

/** The named filter behind every "N waiting" badge. */
export function waitingOnYou(items: readonly AttentionItem[]): AttentionItem[] {
  return items.filter((i) => WAITING_KINDS.has(i.kind));
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
 * The one derivation. Returns the whole attention list, ranked: parked
 * questions first (nothing else is permanently stuck without the PO), then
 * approvals, then answers waiting to be read, then the clock (the next meeting,
 * meetings never filed, commitments due), and the librarian last.
 */
export function buildAttention(input: AttentionInput, now: number = Date.now()): AttentionItem[] {
  const items: AttentionItem[] = [];
  const { askRequests, pings, proposals, sessions, tree } = input;

  // 1. Parked questions. A turn that asked something cannot move until it is
  //    answered, so nothing outranks it. Keyed by session rather than by request
  //    id: the PO is waiting on the session, and a re-asked question must not
  //    read as a brand new row.
  for (const sessionId of Object.keys(askRequests)) {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) continue;
    items.push({
      id: `question:${sessionId}`,
      kind: 'question',
      label: session.title,
      meta: 'question',
      tone: 'brand',
      target: { open: 'session', sessionId, title: session.title },
      when: session.updated,
    });
  }

  // 2. Everything drafted and waiting for approval, newest first — the same set
  //    the Inbox renders, librarian fixes included.
  const pending = [...proposals]
    .filter((p) => p.status === 'pending')
    .sort((a, b) => b.created - a.created);
  for (const p of pending) {
    items.push({
      id: `card:${p.id}`,
      kind: 'card',
      label: p.headline ?? p.rationale,
      meta: 'to approve',
      tone: 'brand',
      target: { open: 'inbox' },
      when: p.created,
    });
  }

  // 3. Sessions that finished while the PO was elsewhere. A session they shelved
  //    (done/dismissed) is off the active surfaces, unread or not.
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

  // 4. The next meeting, while it is still ahead and close enough to matter.
  const next = meetings
    .filter((n) => isUpcomingMeeting(n, now) && meetingStart(n) - now < NEXT_MEETING_MS)
    .sort((a, b) => meetingStart(a) - meetingStart(b))[0];
  if (next) {
    items.push({
      id: `meeting:${next.path}`,
      kind: 'meeting',
      label: next.title,
      meta: next.time ?? 'today',
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

  // 6. The PO's own commitments, due today or already slipped. Waiting-on items
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
    });
  }

  // 7. The librarian's suggestions. Visible in the Inbox, never owed.
  for (const p of pings) {
    items.push({
      id: `ping:${p.id}`,
      kind: 'ping',
      label: p.title,
      meta: 'suggestion',
      tone: 'muted',
      target: { open: 'inbox' },
      when: p.created,
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// Home's view: the top few, with the repetitive kinds behind one door
// ---------------------------------------------------------------------------

/** One row of Home's waiting list — an item, or a door standing for several. */
export interface AttentionRow {
  id: string;
  kind: AttentionKind;
  label: string;
  meta: string;
  tone: AttentionTone;
  target: AttentionTarget;
  /** How many list items this row stands for. 1 unless the row is a door. */
  count: number;
}

/**
 * Kinds Home never lists one by one: four cards would fill the page and say
 * nothing four times. They collapse into a single door to the view that holds
 * them — the count on that door is `countOf(items, kind)`, not a second sum.
 */
const COLLAPSED: ReadonlySet<AttentionKind> = new Set<AttentionKind>(['card', 'review', 'todo']);

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;

/** "in 20m" while the meeting is nearly on top of the PO, else its own clock. */
function startsIn(when: number, fallback: string, now: number): string {
  const mins = Math.round((when - now) / 60_000);
  if (mins > 90) return fallback;
  return mins <= 1 ? 'now' : `in ${mins}m`;
}

/**
 * Home's named view over the list: the top `max` rows, pings dropped (Home is
 * the ninety-second read and a suggestion can always wait), and the collapsible
 * kinds behind one door each. A door takes the rank of its first item, so the
 * ordering is still the list's.
 */
export function homeRows(
  items: readonly AttentionItem[],
  max: number,
  now: number = Date.now(),
): AttentionRow[] {
  const rows: AttentionRow[] = [];
  const doorsDone = new Set<AttentionKind>();
  for (const item of items) {
    if (item.kind === 'ping') continue;
    if (COLLAPSED.has(item.kind)) {
      if (doorsDone.has(item.kind)) continue;
      doorsDone.add(item.kind);
      rows.push(door(item, items, now));
      continue;
    }
    rows.push({
      ...item,
      count: 1,
      meta: item.kind === 'meeting' && item.when ? startsIn(item.when, item.meta, now) : item.meta,
    });
  }
  return rows.slice(0, max);
}

/** The one row standing for every item of a collapsible kind. */
function door(first: AttentionItem, items: readonly AttentionItem[], now: number): AttentionRow {
  const n = countOf(items, first.kind);
  switch (first.kind) {
    case 'card':
      return {
        id: 'cards',
        kind: 'card',
        label: `${plural(n, 'card')} waiting for your approval`,
        meta: 'Inbox',
        tone: 'brand',
        target: { open: 'inbox' },
        count: n,
      };
    case 'todo': {
      const todayMs = Date.parse(localDateStr(new Date(now)));
      const slipped = items.filter(
        (i) => i.kind === 'todo' && i.when !== undefined && i.when < todayMs,
      ).length;
      return {
        id: 'todos',
        kind: 'todo',
        label: `${plural(n, 'commitment')} due`,
        meta: slipped > 0 ? `${slipped} overdue` : 'today',
        tone: 'warning',
        target: { open: 'todos' },
        count: n,
      };
    }
    default:
      // One unfiled meeting is worth naming; several are a backlog, and the
      // meetings folder is the place to work through them.
      return n === 1
        ? { ...first, count: 1 }
        : {
            id: 'reviews',
            kind: 'review',
            label: `${n} meetings still to review`,
            meta: 'meetings',
            tone: 'warning',
            target: { open: 'folder', dir: 'meetings' },
            count: n,
          };
  }
}
