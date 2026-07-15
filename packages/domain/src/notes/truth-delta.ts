import { z } from 'zod';
import { zRef, PROBLEM_STANCES, CONFIDENCE_LEVELS } from './frontmatter.js';

/**
 * The truth delta (PLAN-V2 §3.1) — the first-class typed payload an After-Meeting
 * session produces from a transcript. Each item becomes exactly one approval card.
 * It is what turns "the meeting is over" into "the systems are updated".
 *
 * Every item carries `evidence` (wikilinks/URLs into the transcript + prior
 * memory) and an optional one-line `because` — the receipts an approval card
 * shows. Nothing here writes anything; it is a proposal shape the human disposes.
 */

const item = {
  /** The claim/decision/action text — one crisp sentence. */
  statement: z.string().min(1),
  /** Evidence refs (transcript path, prior decisions/insights). */
  evidence: z.array(zRef).default([]),
  /** One-line rationale surfaced on the card. */
  because: z.string().optional(),
  /** Marks a statement the agent inferred rather than found verbatim. */
  inference: z.boolean().optional(),
};

export const zDeltaDecision = z.object({
  ...item,
  deciders: z.array(z.string()).optional(),
  /** Slug of an existing decision this one supersedes, if any. */
  supersedes: zRef.optional(),
  problem: zRef.optional(),
});
export type DeltaDecision = z.infer<typeof zDeltaDecision>;

export const zDeltaAction = z.object({
  ...item,
  owner: z.string().optional(),
  due: z.string().optional(),
  /** Existing tracker key mentioned in the meeting (never invented). */
  tracker: z.string().optional(),
});
export type DeltaAction = z.infer<typeof zDeltaAction>;

export const zDeltaInsight = z.object({
  ...item,
  confidence: z.enum(CONFIDENCE_LEVELS).default('med'),
  customer: zRef.optional(),
  problem: zRef.optional(),
});
export type DeltaInsight = z.infer<typeof zDeltaInsight>;

export const zDeltaOpenQuestion = z.object({
  ...item,
});
export type DeltaOpenQuestion = z.infer<typeof zDeltaOpenQuestion>;

export const zDeltaNotDoing = z.object({
  ...item,
});
export type DeltaNotDoing = z.infer<typeof zDeltaNotDoing>;

export const zDeltaWhoNeedsToKnow = z.object({
  ...item,
  /** Person/customer refs who should be told. */
  who: z.array(zRef).default([]),
  audience: z.string().optional(),
});
export type DeltaWhoNeedsToKnow = z.infer<typeof zDeltaWhoNeedsToKnow>;

export const zTruthDelta = z.object({
  meeting: zRef.optional(),
  decisions: z.array(zDeltaDecision).default([]),
  actions: z.array(zDeltaAction).default([]),
  insights: z.array(zDeltaInsight).default([]),
  open_questions: z.array(zDeltaOpenQuestion).default([]),
  not_doings: z.array(zDeltaNotDoing).default([]),
  who_needs_to_know: z.array(zDeltaWhoNeedsToKnow).default([]),
});
export type TruthDelta = z.infer<typeof zTruthDelta>;

/** Total item count across every bucket — the number of cards produced. */
export function truthDeltaSize(delta: TruthDelta): number {
  return (
    delta.decisions.length +
    delta.actions.length +
    delta.insights.length +
    delta.open_questions.length +
    delta.not_doings.length +
    delta.who_needs_to_know.length
  );
}

export const DELTA_STANCES = PROBLEM_STANCES;
