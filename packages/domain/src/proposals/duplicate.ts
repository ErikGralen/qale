/**
 * Is this card already waiting on the PM?
 *
 * Two sessions reading the same material propose the same things, and until now
 * nothing stopped them: the propose tools tell the model to "check existing
 * todos first", but a card that has not been approved yet is not a note on
 * disk, so there is nothing for it to find. Drop part 2 of a recording an hour
 * after part 1 and the second run re-proposes every commitment the first one
 * found, with no way for either to know.
 *
 * The check is deliberately conservative. A duplicate that slips through is a
 * card the PM discards in one click; a real finding suppressed as a duplicate is
 * gone silently, and silence is the failure this codebase spends most of its
 * rules avoiding. So: same kind, strong overlap, and never a match on so few
 * words that any two short titles would collide.
 */

/**
 * Words that carry no meaning for "are these the same commitment". English plus
 * the Swedish that shows up in a Swedish PM's own phrasing.
 */
const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'to',
  'of',
  'on',
  'in',
  'for',
  'and',
  'or',
  'with',
  'about',
  'by',
  'from',
  'at',
  'as',
  'is',
  'are',
  'be',
  'we',
  'i',
  'our',
  'us',
  'them',
  'it',
  'this',
  'that',
  'och',
  'att',
  'till',
  'för',
  'med',
  'om',
  'en',
  'ett',
  'den',
  'det',
  'som',
  'på',
  'av',
  'vi',
]);

/**
 * The content words of a title, order thrown away.
 *
 * Order has to go: "get back to Jonas on pricing" and "get back to Jonas about
 * pricing" are one commitment, and any comparison that respects word order says
 * they are not. Diacritics are folded so "för" and "for" do not read as
 * different words in a half-Swedish title.
 */
export function contentTokens(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
  return new Set(words);
}

/** How many words two token sets have in common. */
function sharedCount(left: Set<string>, right: Set<string>): number {
  let shared = 0;
  for (const w of left) if (right.has(w)) shared++;
  return shared;
}

/** Shared words over total distinct words: 1 is the same sentence, 0 shares nothing. */
export function titleOverlap(a: string, b: string): number {
  const left = contentTokens(a);
  const right = contentTokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  const shared = sharedCount(left, right);
  return shared / (left.size + right.size - shared);
}

/**
 * How alike two cards must read before one is treated as the other.
 *
 * Set from the pairs that matter. "Send Nordkap SSO dates" against "Send Nordkap
 * the SSO rollout dates" is 0.8 and is one commitment. "Send Nordkap the Q3
 * roadmap" against the Q4 one is 0.6 and is two, which is exactly the kind of
 * pair that must survive.
 */
export const DUPLICATE_THRESHOLD = 0.8;

/** Below this many shared words, any two terse titles look alike. */
const MIN_SHARED_WORDS = 2;

/** Enough of a card to ask whether it already exists. */
export interface ProposalIdentity {
  /** Card kind — a note and an update are never the same card. */
  kind: string;
  /** The note the card is about, where it has one. */
  targetPath?: string | null;
  /**
   * The note type a `note` card would create ('todo', 'insight'). A todo and an
   * insight that happen to be worded alike are not duplicates of each other.
   */
  noteType?: string | undefined;
  /** What the card says it does, in the words it says it. */
  title: string;
}

/**
 * The pending card this one repeats, or null.
 *
 * `targetPath` equality is decisive on its own for cards that CREATE a note:
 * two cards writing the same path cannot both land, whatever they are called.
 * For an update it is only a hint — a hub can legitimately collect two
 * different edits in one queue — so those still have to read alike.
 */
export function findDuplicate<T extends ProposalIdentity>(
  pending: T[],
  candidate: ProposalIdentity,
): T | null {
  const mine = contentTokens(candidate.title);
  for (const other of pending) {
    if (other.kind !== candidate.kind) continue;
    if ((other.noteType ?? '') !== (candidate.noteType ?? '')) continue;

    const samePath =
      !!other.targetPath && !!candidate.targetPath && other.targetPath === candidate.targetPath;
    if (samePath && candidate.kind !== 'update') return other;
    if (candidate.kind === 'update' && !samePath) continue;

    const theirs = contentTokens(other.title);
    if (mine.size === 0 || theirs.size === 0) continue;
    const shared = sharedCount(mine, theirs);
    if (shared < MIN_SHARED_WORDS) continue;
    if (shared / (mine.size + theirs.size - shared) >= DUPLICATE_THRESHOLD) return other;
  }
  return null;
}
