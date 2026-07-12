import { layerForType, type Frontmatter, type NoteType } from './frontmatter.js';

/**
 * The raw invariant, precisely (PLAN §1): for raw notes (signals, transcripts),
 * the body and provenance fields (`source`, `captured`) are immutable; only the
 * designated workflow field (`status`) may change, and only through an
 * application-layer use case triggered by a human-accepted proposal.
 *
 * These are pure predicates the application layer calls before persisting an
 * edit — the domain states the rule, the app enforces the trigger.
 */

export const RAW_MUTABLE_FIELDS = ['status'] as const;

export interface MutationCheck {
  allowed: boolean;
  reason?: string;
}

/** May a human/agent edit the *body* of a note of this type? */
export function isBodyEditable(type: NoteType): boolean {
  return layerForType(type) !== 'raw';
}

/** Validate a proposed frontmatter change against the raw invariant. */
export function checkRawFrontmatterMutation(
  type: NoteType,
  prev: Frontmatter,
  next: Frontmatter,
): MutationCheck {
  if (layerForType(type) !== 'raw') return { allowed: true };

  const prevRec = prev as Record<string, unknown>;
  const nextRec = next as Record<string, unknown>;
  const keys = new Set([...Object.keys(prevRec), ...Object.keys(nextRec)]);

  for (const key of keys) {
    if ((RAW_MUTABLE_FIELDS as readonly string[]).includes(key)) continue;
    if (JSON.stringify(prevRec[key]) !== JSON.stringify(nextRec[key])) {
      return {
        allowed: false,
        reason: `raw note field "${key}" is immutable; only ${RAW_MUTABLE_FIELDS.join(', ')} may change`,
      };
    }
  }
  return { allowed: true };
}
