import { z } from 'zod';

/**
 * Proposals (approval cards) are the ONLY write path for the agent (PLAN-V2 §3.3).
 * The trust mechanic — evidence must resolve, or the card is flagged inference — is
 * validated structurally here (domain), then enforced at the tool layer. Card kinds
 * grow per phase: note/update now, decision/outbound land in Phases 3 & 5.
 */

export const PROPOSAL_KINDS = ['note', 'update', 'decision'] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export const PROPOSAL_STATUSES = ['pending', 'accepted', 'rejected', 'stale'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const zSearchReplace = z.object({ search: z.string().min(1), replace: z.string() });

export const zNotePayload = z.object({
  path: z.string().min(1),
  frontmatter: z.record(z.string(), z.unknown()),
  body: z.string(),
  rationale: z.string().min(1),
});
export type NotePayload = z.infer<typeof zNotePayload>;

export const zUpdatePayload = z.object({
  path: z.string().min(1),
  patch: z.array(zSearchReplace).min(1),
  rationale: z.string().min(1),
});
export type UpdatePayload = z.infer<typeof zUpdatePayload>;

/** A decision card carries the new decision plus an optional supersede target. */
export const zDecisionPayload = z.object({
  path: z.string().min(1),
  frontmatter: z.record(z.string(), z.unknown()),
  body: z.string(),
  rationale: z.string().min(1),
  /** Slug of an existing decision this one supersedes (flips its status). */
  supersedes: z.string().optional(),
});
export type DecisionPayload = z.infer<typeof zDecisionPayload>;

export interface EvidenceValidation {
  ok: boolean;
  reason?: string;
}

/**
 * Evidence must be present and resolvable unless explicitly flagged inference.
 * `resolve` reports whether a given wikilink/URL target exists in the index or a
 * tool result from this session (PLAN-V2 §3.3 — cite or decline).
 */
export function validateEvidence(
  sources: string[],
  inference: boolean,
  resolve: (ref: string) => boolean,
): EvidenceValidation {
  if (inference) return { ok: true };
  if (sources.length === 0) {
    return { ok: false, reason: 'proposal has no sources[]; set inference:true to allow' };
  }
  const unresolved = sources.filter((s) => !isUrl(s) && !resolve(s));
  if (unresolved.length > 0) {
    return { ok: false, reason: `unresolved evidence targets: ${unresolved.join(', ')}` };
  }
  return { ok: true };
}

export function isUrl(ref: string): boolean {
  return /^https?:\/\//i.test(ref);
}
