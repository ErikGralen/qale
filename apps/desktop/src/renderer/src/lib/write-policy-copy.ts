import {
  WRITE_DISPOSITIONS,
  describeWritePolicy,
  type WriteDisposition,
  type WritePolicyPlace,
  type WritePolicyRow,
} from '@qale/domain';

/**
 * The write policy, in the shape the Settings section reads it
 * (docs/background-system.md ticket 6, docs/review-rework.md RR-1).
 *
 * The policy already answers for every write and says why in one sentence. The
 * screen adds two things and nothing else: one word per answer, and a grouping,
 * because a column of rows each carrying "asks every time" is a wall. The rows
 * keep the policy's order inside their group, so the list on screen and the
 * rules in the domain read in the same order.
 */

/**
 * What each answer is called, everywhere a person reads it. One term per
 * answer: two wordings for one behaviour read as two behaviours.
 */
export const DISPOSITION_WORDS: Record<WriteDisposition, string> = {
  silent: 'Lands, listed in Activity',
  ask: 'Asks every time',
};

/** The rows of one sphere that share an answer. */
export interface WritePolicyGroup {
  disposition: WriteDisposition;
  /** {@link DISPOSITION_WORDS} for this answer. */
  word: string;
  rows: WritePolicyRow[];
}

/** One sphere, its rows gathered under the answer they share. */
export interface WritePolicyBlock {
  place: WritePolicyPlace['place'];
  title: string;
  groups: WritePolicyGroup[];
}

/**
 * The policy as the screen shows it: the two spheres in the policy's order, and
 * inside each one the answers in the order silent, then ask. What lands on its
 * own comes first because it is the part nobody would guess. An answer no row
 * has is left out.
 */
export function writePolicyBlocks(): WritePolicyBlock[] {
  return describeWritePolicy().map(({ place, title, rows }) => ({
    place,
    title,
    groups: WRITE_DISPOSITIONS.map((disposition) => ({
      disposition,
      word: DISPOSITION_WORDS[disposition],
      rows: rows.filter((row) => row.disposition === disposition),
    })).filter((group) => group.rows.length > 0),
  }));
}
