/**
 * Typed links (docs/typed-links.md): every relationship in the system
 * normalizes to one directed edge `(source, target, type, reversed)`. The enum
 * below is the vocabulary the system UNDERSTANDS — a type earns a place here
 * only when some behavior consumes it (labels, grouping, Jira mapping, and
 * later propagation/traversal). Free-text types are legal everywhere a type is
 * accepted: they index and display but drive nothing.
 *
 * Direction: one canonical spelling per relationship. Inverse spellings
 * (`blocked-by`, `superseded-by`, …) normalize to the canonical type plus a
 * `reversed` flag, so queries never check two spellings. `reversed` means the
 * SEMANTIC edge runs target → source while the row stays with the file that
 * contains the link.
 */

import type { NoteType } from './frontmatter.js';

export interface LinkTypeDef {
  /** Canonical token, lowercase-kebab. */
  type: string;
  /** Label describing the TARGET as seen from the source ("blocks"). */
  forwardLabel: string;
  /** Label describing the SOURCE as seen from the target ("blocked by"). */
  inverseLabel: string;
  /**
   * Note types this relationship reads sensibly against as the TARGET — the
   * offer list for pickers, NOT a validation rule (any type on any target
   * still parses and indexes). Omitted = fits any target.
   */
  targets?: readonly NoteType[];
  /**
   * Suppress the reversed row in pickers: the relationship is symmetric
   * (`relates`) or its inverse is a backlink reading rather than something a
   * human would author forward (`about` → "mentioned in").
   */
  noInverse?: boolean;
}

export const LINK_TYPES: LinkTypeDef[] = [
  // Superseding is a document-lifecycle move: it only makes sense against
  // something that states a position, never against a person or a raw source.
  {
    type: 'supersedes',
    forwardLabel: 'supersedes',
    inverseLabel: 'superseded by',
    targets: ['decision', 'insight', 'note', 'theme', 'skill', 'wikipage'],
  },
  {
    type: 'evidence',
    forwardLabel: 'evidence',
    inverseLabel: 'evidence for',
    targets: ['source', 'meeting', 'session', 'insight', 'note', 'ticket', 'wikipage'],
  },
  // A person can absolutely BE the source ("source: Åsa"), so people stay in.
  {
    type: 'source',
    forwardLabel: 'source',
    inverseLabel: 'source for',
    targets: ['source', 'meeting', 'person', 'note', 'wikipage', 'ticket'],
  },
  {
    type: 'blocks',
    forwardLabel: 'blocks',
    inverseLabel: 'blocked by',
    targets: ['todo', 'ticket', 'decision', 'theme', 'note'],
  },
  {
    type: 'part-of',
    forwardLabel: 'part of',
    inverseLabel: 'contains',
    targets: ['theme', 'customer', 'ticket', 'wikipage', 'skill', 'note'],
  },
  // `about` and `relates` are the untyped-adjacent catch-alls — they fit
  // anything, which is what keeps a person link from having an empty list.
  { type: 'about', forwardLabel: 'about', inverseLabel: 'mentioned in', noInverse: true },
  { type: 'relates', forwardLabel: 'relates to', inverseLabel: 'related to', noInverse: true },
  {
    type: 'duplicates',
    forwardLabel: 'duplicates',
    inverseLabel: 'duplicated by',
    targets: ['ticket', 'todo', 'note', 'insight', 'theme', 'decision'],
  },
];

/** Inverse spelling → canonical type. `[[blocked-by::X]]` = X blocks me. */
const INVERSE_SPELLINGS: Record<string, string> = {
  'blocked-by': 'blocks',
  'superseded-by': 'supersedes',
  contains: 'part-of',
  'evidence-for': 'evidence',
  'source-for': 'source',
  'duplicated-by': 'duplicates',
  'mentioned-in': 'about',
};

/** Forward synonyms (label spellings, common variants) → canonical type. */
const SYNONYMS: Record<string, string> = {
  'relates-to': 'relates',
  'related-to': 'relates',
};

const BY_TYPE = new Map(LINK_TYPES.map((d) => [d.type, d]));

/** Where an edge came from — only human-authored and synced edges may ever
 *  drive hard behavior; a future inferred origin only suggests. */
export type LinkOrigin = 'body' | 'frontmatter' | 'synced';

/** Lowercase-kebab a raw type token ("Blocked By" → "blocked-by"). */
export function kebabLinkType(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Normalize a raw type token to `{ type, reversed }` — canonicalizing known
 * inverse spellings — or null when the token is empty/unusable (the caller
 * falls back to an untyped link; a type never hard-fails a parse).
 */
export function normalizeLinkType(raw: string): { type: string; reversed: boolean } | null {
  const token = kebabLinkType(raw);
  if (!token || !/^[a-z0-9][a-z0-9-]*$/.test(token)) return null;
  const canonical = INVERSE_SPELLINGS[token];
  if (canonical) return { type: canonical, reversed: true };
  return { type: SYNONYMS[token] ?? token, reversed: false };
}

/**
 * Human label for an edge as read FROM the file containing it: what the target
 * is to me. `[[blocks::X]]` → "blocks", `[[blocked-by::X]]` → "blocked by".
 * Free-text types read as themselves with hyphens as spaces.
 */
export function linkTypeLabel(type: string, reversed = false): string {
  const def = BY_TYPE.get(type);
  if (def) return reversed ? def.inverseLabel : def.forwardLabel;
  return type.replace(/-/g, ' ');
}

/**
 * Human label for an edge as read FROM the target (the backlink side): what the
 * source is to me. A —blocks→ me reads "Blocked by"; A —[[blocked-by::me]]→
 * (reversed, meaning I block A) reads "Blocks".
 */
export function backlinkTypeLabel(type: string, reversed = false): string {
  const def = BY_TYPE.get(type);
  if (def) return reversed ? def.forwardLabel : def.inverseLabel;
  return type.replace(/-/g, ' ');
}

/** One offerable relationship: a type plus the direction it's authored in. */
export interface LinkTypeOption {
  type: string;
  reversed: boolean;
  /** The `type::` token this writes ("blocks", "blocked-by"). */
  token: string;
  /** How the link reads in the sentence "this note ___ the target". */
  label: string;
}

/**
 * The relationships worth OFFERING for a link whose target is a `targetType`
 * note — both directions where the inverse is a real authoring choice
 * (`blocks` / `blocked by`), and only types that read sensibly against that
 * kind of thing: a person link offers "source"/"about"/"relates to", never
 * "supersedes". `null` (unknown or not-yet-created target) offers everything.
 *
 * This is an offer list, not a rule. Any type on any target still parses,
 * indexes and renders — free-text types included.
 */
export function linkTypeOptions(targetType: NoteType | null): LinkTypeOption[] {
  const options: LinkTypeOption[] = [];
  for (const def of LINK_TYPES) {
    if (targetType && def.targets && !def.targets.includes(targetType)) continue;
    options.push({ type: def.type, reversed: false, token: def.type, label: def.forwardLabel });
    if (!def.noInverse) {
      options.push({
        type: def.type,
        reversed: true,
        token: linkTypeToken(def.type, true),
        label: def.inverseLabel,
      });
    }
  }
  return options;
}

/** Canonical `[[…]]` token for an edge — inverse spelling when reversed, so
 *  reconstruction round-trips the author's direction. */
export function linkTypeToken(type: string, reversed = false): string {
  if (!reversed) return type;
  for (const [spelling, canonical] of Object.entries(INVERSE_SPELLINGS)) {
    if (canonical === type) return spelling;
  }
  return type;
}
