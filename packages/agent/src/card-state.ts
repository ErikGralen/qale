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
      return 'approved, so the note exists and is theirs — only propose_update can change it now';
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

/** One line per card: the id to act on it by, what it says, where it stands. */
function cardLines(cards: SessionCardState[]): string[] {
  const out: string[] = [];
  for (const c of cards.slice(-MAX_CARDS)) {
    const where = standing(c.status) ?? c.status;
    const what = c.title.replace(/\s+/g, ' ').trim().slice(0, 120);
    out.push(`- ${c.id} (${where}): ${what}`);
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
    'The cards you have put in front of the PM in this session, as they stand right now. This is the',
    'workspace telling you, not the PM speaking: read it, act on it, never answer it or repeat it back.',
    ...cardLines(cards),
    'If something below is wrong, fix the card rather than adding another next to it: withdraw_proposal',
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
