import { randomUUID } from 'node:crypto';
import type { SessionCardState } from '@qale/application';

/**
 * What became of the cards this session proposed, told to the session itself at
 * the top of every turn after the first.
 *
 * A session's only memory of its own cards was the sentence the propose tool
 * handed back: "Proposed new note (p_x): …. Awaiting review." That sentence
 * stops being true the moment the PM clicks, and nothing ever corrected it. So a
 * correction typed into the chat ("it's qale.ai, not kale") reached a model
 * whose best available picture was "I proposed four cards, all awaiting review",
 * and it did the only thing that picture allows: propose the whole batch again.
 * The two the PM had already approved came back as cards that could never land,
 * and the two wrong ones stayed. Four cards where two were wanted.
 *
 * It rides in on the user's message rather than the system prompt because it is
 * true per turn, not per session, and a system prompt that changed under a live
 * session would break its cache and teach the model that its instructions drift.
 * The envelope is the same trick `external.ts` plays, for the same reason: the
 * two display paths (`bridge.ts` live, `history.ts` on replay) unwrite it, so
 * what the PM sees in the chat is the sentence they actually typed.
 */
const MARKER = 'YOUR_CARDS';

/** Any opening or closing marker, however spaced or cased. */
const MARKER_RE = /<<<\s*(?:END_)?YOUR_CARDS/gi;

/**
 * The two marker lines plus everything between them. Unlike external material,
 * which is content the PM should still read once the envelope is off, this block
 * is plumbing end to end: leaving the list behind would put the workspace's own
 * bookkeeping in the middle of the PM's message.
 */
const BLOCK_RE =
  /[ \t]*<<<\s*YOUR_CARDS\b[^\n]*>>>[\s\S]*?<<<\s*END_YOUR_CARDS\b[^\n]*>>>[ \t]*\r?\n?/gi;

/** How many cards are worth naming. Older ones are the least likely to be what
 *  the PM is talking about, and a long list is a list nobody reads. */
const MAX_CARDS = 25;

/** What each status means for what the session may still do about it. */
function standing(status: string): string | null {
  switch (status) {
    case 'pending':
      return 'waiting on the PM — withdraw_proposal takes it back';
    case 'accepted':
      // Two ways a card gets here now: the PM approved it, or the write policy
      // applied it on the spot. Either way the note exists and is theirs, which
      // is the only thing this line has to say.
      return 'it landed, so the note exists and is theirs: only propose_update can change it now';
    case 'rejected':
      return 'discarded by the PM — leave it be unless they bring it up';
    case 'withdrawn':
      return 'you took this one back';
    case 'stale':
      return 'the text it was anchored to is gone, so it can no longer be applied — re-read the note and propose it again';
    default:
      return null;
  }
}

/** How much of a quoted line is worth showing. */
const QUOTE = 80;

/** One line, on one line, short enough to sit in a list. */
function quote(value: unknown): string {
  const line = String(value ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  const one = (line ?? '').replace(/\s+/g, ' ');
  return one.length > QUOTE ? `${one.slice(0, QUOTE - 1)}…` : one;
}

const record = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];

/** What each card kind calls its title and its text, in the words the PM sees. */
function fieldWords(action: string): { title: string; body: string } {
  if (action === 'create_ticket') return { title: 'summary', body: 'description' };
  if (action === 'comment_ticket') return { title: 'title', body: 'comment' };
  if (action === 'update_page') return { title: 'title', body: 'page text' };
  return { title: 'title', body: 'text' };
}

/**
 * What the PM did to a card before they approved it, in one line, or null when
 * they kept it as drafted (docs/learning-how-you-work.md ticket 7).
 *
 * The point is what the session does with it next: a change that would repeat is
 * how this PM writes, and belongs in the Jira or Confluence file. So the line
 * names the field and gives both versions short, never a diff and never the
 * whole body. Words the PM would use, not field names: a ticket has a summary
 * and a description.
 */
export function describeCardEdit(before: unknown, after: unknown): string | null {
  const was = record(before);
  const now = record(after);
  if (!was || !now) return null;
  const words = fieldWords(str(was['action']));
  const said: string[] = [];

  if (str(was['title']) !== str(now['title']) && str(now['title'])) {
    said.push(`The PM changed the ${words.title} to "${quote(now['title'])}".`);
  }
  if (str(was['body']) !== str(now['body'])) {
    said.push(
      `The PM changed the ${words.body}: it began "${quote(was['body'])}" and now begins "${quote(now['body'])}".`,
    );
  }
  if (str(was['append']) !== str(now['append']) && str(now['append'])) {
    said.push(`The PM changed what gets added: it now begins "${quote(now['append'])}".`);
  }
  if (JSON.stringify(was['patch'] ?? null) !== JSON.stringify(now['patch'] ?? null)) {
    said.push('The PM changed the passage this replaces, or what it says instead.');
  }
  for (const field of ['labels', 'components'] as const) {
    const added = list(now[field]).filter((v) => !list(was[field]).includes(v));
    const gone = list(was[field]).filter((v) => !list(now[field]).includes(v));
    if (added.length)
      said.push(
        `The PM added ${field === 'labels' ? 'the label' : 'the component'} ${added.join(', ')}.`,
      );
    if (gone.length)
      said.push(
        `The PM took ${gone.join(', ')} off the ${field === 'labels' ? 'labels' : 'components'}.`,
      );
  }
  if (str(was['priority']) !== str(now['priority']) && str(now['priority'])) {
    said.push(`The PM set the priority to ${str(now['priority'])}.`);
  }

  return said.length ? said.join(' ') : null;
}

/** One line per card: the id to act on it by, what it says, where it stands.
 *  A card the PM changed before approving carries a second, indented line. */
function cardLines(cards: SessionCardState[]): string[] {
  const out: string[] = [];
  for (const c of cards.slice(-MAX_CARDS)) {
    const where = standing(c.status) ?? c.status;
    const what = c.title.replace(/\s+/g, ' ').trim().slice(0, 120);
    out.push(`- ${c.id} (${where}): ${what}`);
    if (c.editedPayload === undefined || c.editedPayload === null) continue;
    const change = describeCardEdit(c.payload, c.editedPayload);
    if (change) out.push(`  ${change}`);
  }
  return out;
}

/** Neutralize a marker the message itself carries, without mangling anything else. */
function defang(s: string): string {
  return s.replace(MARKER_RE, (m) => m.replace('<<<', '<<'));
}

/**
 * The PM's message with the card list in front of it, or the message unchanged
 * when this session has never proposed anything (the ordinary first turn).
 */
export function withCardState(prompt: string, cards: SessionCardState[]): string {
  if (cards.length === 0) return prompt;
  const id = randomUUID().slice(0, 8);
  const lines = [
    `<<<${MARKER} id=${id}>>>`,
    'What you have written in this session, as it stands right now. Some of it landed as you wrote it',
    'and some is waiting on the PM. This is the workspace telling you, not the PM speaking: read it,',
    'act on it, never answer it or repeat it back.',
    ...cardLines(cards),
    'If something below is wrong, fix the proposal rather than adding another next to it: withdraw_proposal',
    'the wrong one, then propose the corrected version. Never re-propose what they already approved.',
    `<<<END_${MARKER} id=${id}>>>`,
  ].join('\n');
  return `${lines}\n${defang(prompt)}`;
}

/**
 * Drop the block for display. The PM typed one sentence and must see one
 * sentence, in the chat and in the receipt, however much the model was told
 * around it.
 */
export function stripCardState(s: string): string {
  if (!s.includes(MARKER)) return s;
  return s.replace(BLOCK_RE, '');
}
