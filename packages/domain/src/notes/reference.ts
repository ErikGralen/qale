import { z } from 'zod';
import { DAY_FIELDS, NOTE_TYPE_META, zFrontmatterFor, type NoteType } from './frontmatter.js';

/**
 * The note-shape reference the model reads, GENERATED from the schemas it will
 * be checked against (FH-2).
 *
 * Prose about the schema was what caused the bug this exists for: a skill file
 * said `verified` took `by` and `at`, which reads as one mapping, while the
 * schema took a list of them. Both were written by hand, months apart, and
 * nothing could notice they disagreed. Anything a sentence claims about a field
 * can drift; this cannot, because there is only the one source.
 *
 * Deliberately shapes only. What a field MEANS belongs to the tool that writes
 * it and to the filing rules; repeating it here would be a second description
 * to keep in step, which is the thing being fixed.
 */

/**
 * The types a session ever authors. The rest are written by the app itself — a
 * source note by capture, a receipt by the harness, a ticket by sync — so their
 * fields are noise in a prompt, and a model that learns their shape learns to
 * write files it must not write.
 */
const AUTHORED: readonly NoteType[] = [
  'note',
  'insight',
  'decision',
  'theme',
  'customer',
  'person',
  'todo',
  'meeting',
];

/**
 * Fields nothing but the app ever sets: a mirror's identity, the sync clock, the
 * normalizer's own markers (which the system prompt explains where it explains
 * what to do about them).
 */
const MACHINE_OWNED = new Set([
  'type',
  'provider',
  'external_id',
  'calendar',
  'container',
  'event_status',
  'remote_updated',
  'url',
  'version',
  'state',
  'state_category',
  'assignee',
  'parent',
  'links',
  'session_id',
  // Provenance the capture path stamps: what system a note came out of.
  'source',
  'needs_summary',
  'broken_frontmatter',
]);

/** Everything on every note, rendered once instead of on all eight types. */
const SHARED = ['summary', 'title', 'tags', 'verified'];

interface JsonNode {
  type?: string;
  const?: unknown;
  enum?: string[];
  items?: JsonNode;
  properties?: Record<string, JsonNode>;
}

function jsonSchemaOf(type: NoteType): { properties: Record<string, JsonNode> } {
  const schema = zFrontmatterFor(type);
  const json = z.toJSONSchema(
    schema as never,
    {
      // The INPUT side, which is what a card is: `sources` has a default, so on
      // the output side it is always present and on the input side it is optional.
      io: 'input',
      unrepresentable: 'any',
    } as never,
  ) as { properties?: Record<string, JsonNode> };
  return { properties: json.properties ?? {} };
}

/**
 * Which fields the type cannot do without, asked of the schema rather than read
 * off the JSON projection: a field behind a preprocess (every list field is)
 * comes out of that projection as optional even when it is not.
 */
function requiredFields(type: NoteType): Set<string> {
  const result = zFrontmatterFor(type).safeParse({ type });
  if (result.success) return new Set();
  const out = new Set<string>();
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (typeof field === 'string' && field !== 'type') out.add(field);
  }
  return out;
}

/** One field as `name (shape)`, where the shape is worth saying at all. */
function fieldLine(name: string, node: JsonNode, required: boolean): string {
  const shape = ((): string => {
    if (node.enum?.length) return node.enum.join(' | ');
    if (node.type === 'array') {
      const item = node.items;
      if (item?.properties) return `list of {${Object.keys(item.properties).join(', ')}}`;
      return 'list';
    }
    if (node.type === 'number') return 'number';
    if (node.type === 'boolean') return 'true | false';
    if ((DAY_FIELDS as readonly string[]).includes(name)) return 'YYYY-MM-DD';
    return '';
  })();
  const suffix = required ? (shape ? `${shape}, required` : 'required') : shape;
  return suffix ? `${name} (${suffix})` : name;
}

function typeLine(type: NoteType): string {
  const { properties } = jsonSchemaOf(type);
  const required = requiredFields(type);
  const own = Object.keys(properties).filter((k) => !MACHINE_OWNED.has(k) && !SHARED.includes(k));
  const fields = own.map((k) => fieldLine(k, properties[k]!, required.has(k)));
  const where = NOTE_TYPE_META[type].dir;
  return `- **${type}** (${where}/): ${fields.length ? fields.join(', ') : 'nothing beyond the shared fields'}`;
}

function sharedLine(): string {
  const { properties } = jsonSchemaOf('note');
  const required = requiredFields('note');
  return SHARED.map((k) => fieldLine(k, properties[k]!, required.has(k))).join(', ');
}

/**
 * The reference, as markdown. Pass `types` for the one type at hand (a refusal
 * says what the shape should have been); omit it for the whole set.
 */
export function frontmatterReference(types: readonly NoteType[] = AUTHORED): string {
  const lines = [
    `Every note carries: ${sharedLine()}.`,
    ``,
    `A list is written as a list even when there is one of something, and a day is written`,
    `"YYYY-MM-DD" and nothing else. Then, by type:`,
    ``,
    ...types.filter((t) => AUTHORED.includes(t)).map(typeLine),
  ];
  return lines.join('\n');
}
