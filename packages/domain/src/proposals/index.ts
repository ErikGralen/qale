import { z } from 'zod';

/**
 * Proposals (approval cards) are the ONLY write path for the agent (PLAN-V2 §3.3).
 * The trust mechanic — evidence must resolve, or the card is flagged inference — is
 * validated structurally here (domain), then enforced at the tool layer. Card kinds
 * grow per phase: note/update now, decision/outbound land in Phases 3 & 5.
 */

export const PROPOSAL_KINDS = ['note', 'update', 'decision', 'outbound'] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export const OUTBOUND_SYSTEMS = ['jira', 'confluence', 'message'] as const;
export type OutboundSystem = (typeof OUTBOUND_SYSTEMS)[number];

/**
 * Outbound card (PLAN-V2 §3.4) — a draft addressed to an external system or a
 * human. This tier is draft-and-approve forever: there is no auto-apply path. The
 * exact payload is stored; the resulting link is built from the API response only.
 */
export const zOutboundPayload = z.object({
  system: z.enum(OUTBOUND_SYSTEMS),
  /** create_issue | add_comment | update_page | message */
  action: z.string(),
  projectKey: z.string().optional(),
  issueType: z.string().optional(),
  issueKey: z.string().optional(),
  pageId: z.string().optional(),
  /** Jira issue summary / message subject. */
  title: z.string().optional(),
  /** The drafted body (markdown), shown verbatim in the card preview. */
  body: z.string().min(1),
  audience: z.string().optional(),
  /** Workspace note to append the resulting deterministic link back to. */
  linkBackPath: z.string().optional(),
  rationale: z.string().min(1),
});
export type OutboundPayload = z.infer<typeof zOutboundPayload>;

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
