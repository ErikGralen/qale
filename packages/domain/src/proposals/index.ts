import { z } from 'zod';
import { THEME_STANCES } from '../notes/frontmatter.js';

/**
 * Proposals are the ONLY write path for the agent (PLAN §3.3). The trust
 * mechanic — evidence must resolve, or the proposal is flagged inference — is
 * validated structurally here (domain), then enforced at the tool layer.
 */

export const PROPOSAL_KINDS = ['triage', 'note', 'update'] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export const PROPOSAL_STATUSES = ['pending', 'accepted', 'rejected', 'stale'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const TRIAGE_ACTIONS = ['link', 'new-theme', 'discard'] as const;
export type TriageAction = (typeof TRIAGE_ACTIONS)[number];

export const zTriagePayload = z
  .object({
    signalPaths: z.array(z.string().min(1)).min(1),
    action: z.enum(TRIAGE_ACTIONS),
    themeRef: z.string().optional(),
    newTheme: z
      .object({ summary: z.string().min(1), stance: z.enum(THEME_STANCES).default('exploring') })
      .optional(),
    groupId: z.string().optional(),
    rationale: z.string().min(1),
  })
  .refine((p) => (p.action === 'link' ? !!p.themeRef : true), {
    message: 'link triage requires a themeRef',
  })
  .refine((p) => (p.action === 'new-theme' ? !!p.newTheme : true), {
    message: 'new-theme triage requires newTheme',
  });
export type TriagePayload = z.infer<typeof zTriagePayload>;

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

export interface EvidenceValidation {
  ok: boolean;
  reason?: string;
}

/**
 * Evidence must be present and resolvable unless explicitly flagged inference.
 * `resolve` reports whether a given wikilink/URL target exists in the index or a
 * tool result from this session (PLAN §3.3).
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
