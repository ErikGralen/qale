/**
 * One card per intent (docs/easier-tickets.md E-6).
 *
 * After the write policy (policy.ts) a transcript still leaves a handful of
 * cards that need a person: patches over text somebody wrote, and decisions.
 * They used to arrive as one card each, so a single meeting could put six
 * near-identical boxes in the queue and the PM read the same sentence six
 * times.
 *
 * A group is what the PM would say out loud about the work: "edit six insights,
 * from your Nordkap check-in". So the key is the shape of the change and where
 * it came from, never the card's position or the skill that wrote it.
 *
 * Two rules hold this together:
 *
 * 1. A group must be nameable in one plain sentence, because that sentence IS
 *    the row. Anything that cannot be said in one sentence is not one intent.
 * 2. A group must survive being taken apart. Approve six of ten and the four
 *    left over still key the same way, so they read as a real group of four
 *    rather than as four orphans — the count in the sentence is read off the
 *    cards each time, never stored.
 */

import { titleForRef } from './card-copy.js';
import { refToSlug } from '../notes/decisions.js';
import { writePolicy, type WriteDisposition, type WriteFacts } from './policy.js';

/** What one card in the queue carries. The renderer's DTO and the stored record
 *  both satisfy it, so this needs no dependency on @qale/ipc. */
export interface IntentCard {
  id: string;
  kind: string;
  /** The file it writes: `targetPath`, or the path inside the payload. */
  targetPath?: string | null;
  /** The refs it was written from, as wikilinks or bare slugs. */
  evidence?: readonly string[];
  /** The PM asked for this in the chat. */
  asked?: boolean;
  /** The levers an update carries, so the change can be read without a lookup. */
  payload?: {
    path?: string;
    patch?: readonly unknown[];
    append?: string;
    frontmatter?: Record<string, unknown>;
    title?: string;
  } | null;
}

/** The folder a card writes into: `insights/nordkap.md` → `insights`. */
function dirOf(path?: string | null): string {
  return path ? (path.split('/')[0] ?? '') : '';
}

/** The file a card writes to, wherever it keeps it. */
function targetOf(card: IntentCard): string {
  return card.targetPath ?? card.payload?.path ?? '';
}

/**
 * The note type the queue can read off a card, since the card does not carry
 * one. Only the two the policy branches on matter: a to-do is the PM's word, a
 * skill or agent file is a standing rule. Everything else reads as an ordinary
 * note, which is what the policy already does with an unknown type.
 */
function noteTypeOf(card: IntentCard): string | undefined {
  const dir = dirOf(targetOf(card));
  if (dir === 'todos') return 'todo';
  if (dir === 'skills' || dir === 'agents') return 'skill';
  return undefined;
}

/** An update that only adds text at the end, in the tool's own words. */
function isAppendOnly(card: IntentCard): boolean {
  const p = card.payload;
  if (!p) return false;
  return !!p.append?.trim() && !p.patch?.length && !p.frontmatter && !p.title?.trim();
}

/** What the policy would say about this card, read back off the card itself.
 *  The ruling is not stored: the row holds every fact it rests on, so reading
 *  it again cannot drift from what the write path decided. */
export function cardFacts(card: IntentCard): WriteFacts {
  return {
    kind: card.kind,
    noteType: noteTypeOf(card),
    asked: card.asked,
    appendOnly: isAppendOnly(card),
  };
}

/** Silent, grouped or ask, for a card already sitting in the queue. */
export function cardDisposition(card: IntentCard): WriteDisposition {
  return writePolicy(cardFacts(card)).disposition;
}

/**
 * The source a group is "from": the meeting or the material it was read out
 * of. One per card at most, and the first is the right one — a card cites its
 * material before it cites what it looked up.
 */
function sourceRef(card: IntentCard): string {
  for (const ref of card.evidence ?? []) {
    const bare = refToSlug(ref) ?? '';
    if (bare.startsWith('meetings/') || bare.startsWith('sources/')) return bare;
  }
  // The note being written is not what the change came from, even when it is a
  // meeting page. "Edit 1 meeting page, from that meeting page" says nothing.
  return '';
}

/**
 * The shape of the change, so two cards only group when approving them is the
 * same act. An update that sets one frontmatter field carries the field and the
 * value: "set status to done" and "set status to blocked" are two intents, and
 * a PM who wants one of them must not have to take the other with it.
 */
function shapeOf(card: IntentCard): string {
  if (card.kind !== 'update') return 'new';
  const p = card.payload;
  const fm = p?.frontmatter;
  const keys = fm ? Object.keys(fm) : [];
  if (keys.length === 1 && !p?.patch?.length && !p?.append?.trim() && !p?.title?.trim()) {
    const key = keys[0]!;
    return `set:${key}=${fmValue(fm![key])}`;
  }
  return 'text';
}

/** A frontmatter value as one comparable word. */
function fmValue(v: unknown): string {
  if (v === undefined || v === null || v === '') return 'nothing';
  if (Array.isArray(v)) return v.map((x) => String(x)).join(', ');
  return String(v);
}

/**
 * The intent a card belongs to, or null when the card is its own decision.
 * Only a `grouped` ruling ever joins a group: a send, a delete and a to-do all
 * stay one card each, by the policy rather than by a second rule here (E-7).
 */
export function intentKey(card: IntentCard): string | null {
  if (cardDisposition(card) !== 'grouped') return null;
  return [card.kind, shapeOf(card), sourceRef(card)].join('|');
}

/** A set of cards the PM would judge as one thing. */
export interface Intent {
  key: string;
  /** In the order they were given, so the queue's narrative order holds. */
  cards: IntentCard[];
  /** The row: one plain sentence naming what approving all of it does. */
  sentence: string;
}

/**
 * Group a section's cards by intent, keeping the order they arrived in. Every
 * card comes back in exactly one group, so a caller can render the list without
 * checking for a card twice. A group of one is a card, not a row: it says
 * nothing a card does not already say, and it costs a click to open.
 */
export function groupIntents(cards: readonly IntentCard[]): Intent[] {
  const byKey = new Map<string, IntentCard[]>();
  const order: string[] = [];
  cards.forEach((card, i) => {
    // A card with no intent is its own group, keyed so nothing can join it.
    const key = intentKey(card) ?? `alone:${i}`;
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = [];
      byKey.set(key, bucket);
      order.push(key);
    }
    bucket.push(card);
  });
  return order.map((key) => {
    const group = byKey.get(key)!;
    return { key, cards: group, sentence: intentSentence(group) };
  });
}

/** dir segment → what several of them are called. Singular lives in card-copy;
 *  a row counts things, so it needs the plural. */
const PLURAL_FOR_DIR: Record<string, string> = {
  meetings: 'meeting pages',
  decisions: 'decisions',
  insights: 'insights',
  themes: 'themes',
  customers: 'customers',
  people: 'people',
  sources: 'sources',
  notes: 'documents',
  todos: 'to-dos',
  tickets: 'tickets',
  wikipages: 'wiki pages',
};

/** What this group touches, in the PM's nouns. One folder ⇒ its own word;
 *  several ⇒ the word that covers them all. */
function nounFor(cards: readonly IntentCard[], n: number): string {
  const dirs = new Set(cards.map((c) => dirOf(targetOf(c))));
  const noun = dirs.size === 1 ? (PLURAL_FOR_DIR[[...dirs][0]!] ?? 'pages') : 'pages';
  if (n !== 1) return noun;
  // "1 insights" reads as a bug. The singular is the plural minus its s for
  // every word above except one, and "people" never appears with a count of
  // one anyway, so the two exceptions are named rather than guessed.
  if (noun === 'people') return 'person';
  return noun.replace(/s$/, '');
}

/**
 * The row's one sentence: what approving the whole group does, and where it
 * came from. Verb first, count second, source last, and every part read off
 * the cards — nothing here is authored by the agent.
 */
export function intentSentence(cards: readonly IntentCard[]): string {
  const n = cards.length;
  const noun = nounFor(cards, n);
  const first = cards[0];
  const shape = first ? shapeOf(first) : 'text';
  const set = /^set:(.+?)=(.*)$/.exec(shape);
  const head =
    first?.kind === 'decision'
      ? `Record ${n} ${n === 1 ? 'decision' : 'decisions'}`
      : set
        ? `Set ${set[1]!.replace(/_/g, ' ')} to ${set[2]} on ${n} ${noun}`
        : `Edit ${n} ${noun}`;
  const source = first ? sourceRef(first) : '';
  return source ? `${head}, from ${titleForRef(source)}` : head;
}
