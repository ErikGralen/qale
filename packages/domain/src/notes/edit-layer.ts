import {
  layerForType,
  TICKET_PROVIDERS,
  WIKIPAGE_PROVIDERS,
  type NoteType,
} from './frontmatter.js';
import { TYPE_RULES } from './invariant.js';

/**
 * Why a note can't be typed in, in one sentence the user can read.
 *
 * {@link ./invariant.ts} states the machine rule (which body, which fields) and
 * {@link ./frontmatter.ts} states the provenance layer. Neither is legible: a PM
 * clicking into a ticket and getting no cursor sees thirteen arbitrary
 * per-type behaviours. There is really only one axis — WHO OWNS THE TEXT — and
 * it is fully derivable from the two rules that already exist. Nothing here is
 * a second list of types to keep in sync; it reads TYPE_RULES and NOTE_TYPE_META
 * and turns the answer into a sentence.
 *
 * - `open` — the human owns it, type away (no sentence to show);
 * - `mirror` — a connector owns it, the real page lives in Jira/Confluence;
 * - `raw` — dumped material, kept as it arrived;
 * - `receipt` — a filed record of something that already happened;
 * - `spine` — append-only, superseded rather than rewritten.
 *
 * Deliberately about EDITABILITY only. What each type *is* (a decision is a
 * standing call, a customer is a relationship) is a separate vocabulary.
 */
export type EditLayer = 'open' | 'mirror' | 'raw' | 'receipt' | 'spine';

/**
 * The mirror types, bound to the provider enums the schema already declares —
 * adding Linear is one entry in TICKET_PROVIDERS, not an edit here.
 */
const MIRROR_PROVIDERS = {
  ticket: TICKET_PROVIDERS,
  wikipage: WIKIPAGE_PROVIDERS,
} as const satisfies Partial<Record<NoteType, readonly string[]>>;

type MirrorType = keyof typeof MIRROR_PROVIDERS;

/** Is this type a local copy of something that lives in another system? */
export function isMirrorType(type: NoteType): type is MirrorType {
  return type in MIRROR_PROVIDERS;
}

/** `"jira"` → `"Jira"`, `"google-calendar"` → `"Google Calendar"`. */
export function providerLabel(provider: string): string {
  return provider
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * The system a mirror is a copy of ("Jira", "Confluence"), or null for anything
 * that isn't a mirror. Prefers the note's own `provider` field; falls back to
 * the type's provider enum while that enum has exactly one member, which is the
 * only case where the type alone can name the system honestly.
 */
export function mirrorSource(
  type: NoteType,
  frontmatter?: Readonly<Record<string, unknown>> | null,
): string | null {
  if (!isMirrorType(type)) return null;
  const declared = frontmatter?.['provider'];
  if (typeof declared === 'string' && declared.trim()) return providerLabel(declared.trim());
  const known = MIRROR_PROVIDERS[type];
  return known.length === 1 ? providerLabel(known[0]) : 'the source system';
}

/** Which of the five ownership layers a type sits in, derived from its rules. */
export function editLayerForType(type: NoteType): EditLayer {
  const rule = TYPE_RULES[type];
  if (isMirrorType(type)) return 'mirror';
  if (rule.appendOnly) return 'spine';
  if (rule.bodyEditable) return 'open';
  // What's left is frozen text that isn't a mirror: raw provenance if the note
  // arrived that way, otherwise something the workspace filed and won't revise.
  return layerForType(type) === 'raw' ? 'raw' : 'receipt';
}

/**
 * THE sentences. One per layer, so every read-only surface says the same thing.
 * Short, concrete, and about consequence: what this note is, and what happens
 * to it instead of editing.
 */
const LAYER_SENTENCE: Record<Exclude<EditLayer, 'open' | 'mirror'>, string> = {
  raw: 'Raw material. Never rewritten.',
  receipt: 'A record of what happened. Kept exactly as it was filed.',
  spine: 'Superseded, never edited. Write a new one to change course.',
};

/**
 * The one line to show on a note the user cannot type in. Null when they can —
 * an editable note explains itself by taking the cursor.
 */
export function readOnlyReason(
  type: NoteType,
  frontmatter?: Readonly<Record<string, unknown>> | null,
): string | null {
  const layer = editLayerForType(type);
  if (layer === 'open') return null;
  if (layer === 'mirror') {
    return `Mirrored from ${mirrorSource(type, frontmatter)}. Edits happen there.`;
  }
  return LAYER_SENTENCE[layer];
}

/**
 * The types a person may start from a blank page, in the order a "new …" menu
 * should offer them. Being editable is not enough to be here, and the four that
 * are missing are the point:
 *
 * - `meeting` and `source` arrive as material — a transcript, a calendar event —
 *   and the memory proposes the page from it. A blank one has no provenance to
 *   stand on, and its date and participants freeze at creation.
 * - `decision` is the append-only spine: the body is final the moment it is
 *   written, so a blank one could never be filled in. Decisions arrive as cards.
 * - `insight` must cite evidence, which a blank page has none of.
 * - `todo`, `skill` and `agent` are created where they live (quick-add, New skill).
 * - `session` is a receipt and `ticket`/`wikipage` are mirrors: nobody authors them.
 *
 * What is left is the four pages the PM owns outright — the desk, and the three
 * hubs that stand for a durable thing rather than a moment.
 */
export const HAND_CREATABLE_TYPES = ['note', 'theme', 'customer', 'person'] as const;
export type HandCreatableType = (typeof HAND_CREATABLE_TYPES)[number];

/** May a person create one of these from scratch? */
export function isHandCreatable(type: NoteType): type is HandCreatableType {
  return (HAND_CREATABLE_TYPES as readonly NoteType[]).includes(type);
}

/**
 * What a fresh page of this type is for, in one clause — the subtitle on a
 * "new …" menu row, so picking a type is a choice about the work rather than a
 * guess at our vocabulary.
 */
export const NEW_NOTE_PURPOSE: Record<HandCreatableType, string> = {
  note: 'A blank page for anything',
  theme: 'A problem worth solving',
  customer: 'An account to hang meetings on',
  person: 'A stakeholder and what they care about',
};

/**
 * How a type names itself to the user. A mirror is named by the system it
 * mirrors ("Jira mirror"), never by our folder — calling it a "ticket" next to
 * meetings and decisions implies the workspace owns it, and it does not.
 * Sentence case, so surfaces can print it without a `capitalize` class.
 */
export function noteTypeLabel(
  type: NoteType,
  frontmatter?: Readonly<Record<string, unknown>> | null,
): string {
  const source = mirrorSource(type, frontmatter);
  if (source) return `${source} mirror`;
  return type.charAt(0).toUpperCase() + type.slice(1);
}
