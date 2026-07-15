import { layerForType, type Frontmatter, type NoteType } from './frontmatter.js';

/**
 * Edit invariants, precisely (PLAN-V2 §3.1). Different note types have different
 * mutability: raw provenance (meeting transcripts, session receipts) is immutable
 * except for a designated workflow field; decisions are append-only (body frozen,
 * only `status`/`superseded_by` may flip); authored/derived hubs are freely
 * editable. These are pure predicates the application layer calls before writing —
 * the domain states the rule, the app enforces the trigger (a human-accepted card).
 */

export interface TypeRule {
  /** May the markdown BODY be edited after creation? */
  bodyEditable: boolean;
  /**
   * Frontmatter fields that MAY change post-creation. `'all'` = unrestricted;
   * otherwise every other field is immutable. Undefined ⇒ `'all'`.
   */
  mutableFields?: readonly string[] | 'all';
  /** Append-only spine: superseded, never edited (decisions). */
  appendOnly?: boolean;
}

/**
 * `meeting` provenance (date/participants/source) and its transcript are the raw,
 * immutable part; the derived summary body stays editable. Sessions are receipts —
 * fully immutable once filed. Decisions are append-only. Everything else is open.
 */
export const TYPE_RULES: Record<NoteType, TypeRule> = {
  meeting: {
    bodyEditable: true,
    mutableFields: ['summary', 'title', 'tags', 'safe_space', 'customer'],
  },
  decision: {
    bodyEditable: false,
    appendOnly: true,
    mutableFields: ['status', 'superseded_by', 'last_verified', 'title', 'tags'],
  },
  insight: { bodyEditable: true, mutableFields: 'all' },
  customer: { bodyEditable: true, mutableFields: 'all' },
  problem: { bodyEditable: true, mutableFields: 'all' },
  release: { bodyEditable: true, mutableFields: 'all' },
  person: { bodyEditable: true, mutableFields: 'all' },
  session: { bodyEditable: false, mutableFields: [] },
  skill: { bodyEditable: true, mutableFields: 'all' },
  note: { bodyEditable: true, mutableFields: 'all' },
};

export interface MutationCheck {
  allowed: boolean;
  reason?: string;
}

/** May a human/agent edit the *body* of a note of this type? */
export function isBodyEditable(type: NoteType): boolean {
  return TYPE_RULES[type].bodyEditable;
}

/** Back-compat: raw = layer whose body is not editable. */
export function isRawType(type: NoteType): boolean {
  return layerForType(type) === 'raw' || !isBodyEditable(type);
}

/** Validate a proposed frontmatter change against the type's mutable-field rule. */
export function checkFrontmatterMutation(
  type: NoteType,
  prev: Frontmatter,
  next: Frontmatter,
): MutationCheck {
  const rule = TYPE_RULES[type];
  const mutable = rule.mutableFields ?? 'all';
  if (mutable === 'all') return { allowed: true };
  const allowed = new Set<string>([...mutable, 'type']);

  const prevRec = prev as Record<string, unknown>;
  const nextRec = next as Record<string, unknown>;
  const keys = new Set([...Object.keys(prevRec), ...Object.keys(nextRec)]);

  for (const key of keys) {
    if (allowed.has(key)) continue;
    if (JSON.stringify(prevRec[key]) !== JSON.stringify(nextRec[key])) {
      return {
        allowed: false,
        reason: `${type} field "${key}" is immutable; only ${[...mutable].join(', ') || '(none)'} may change`,
      };
    }
  }
  return { allowed: true };
}

/**
 * Back-compat shim for the previous raw-invariant call site name. Delegates to the
 * generalized {@link checkFrontmatterMutation}.
 */
export const checkRawFrontmatterMutation = checkFrontmatterMutation;
export const RAW_MUTABLE_FIELDS = ['status'] as const;
