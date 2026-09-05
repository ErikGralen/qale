import {
  DERIVED_LABEL_REASON,
  TAG_REASON,
  derivedSummary,
  documentFolderPurpose,
  FOLDER_PURPOSE_OF_FIELD,
  isMirrorType,
  isNormalizable,
  isReservedFile,
  isUnderstandingPath,
  isVoicePath,
  labelLine,
  NEEDS_SUMMARY_FIELD,
  slugFromPath,
  SUMMARY_AT_FIELD,
  SUMMARY_OF_FIELD,
  titleFromSlug,
  type Frontmatter,
  type NoteType,
} from '@qale/domain';
import { parseNote } from '@qale/markdown';
import type { IndexedNote, UseCaseContext } from '../ports.js';
import { DOCUMENTS_PREFIX, documentFolderOf, folderMetaOf, isDocument } from './index-files.js';
import { contentHash, logError, recordActivityRow } from './proposals.js';

/**
 * The summary pass (docs/index-maps.md IM-6, IM-7 and docs/background-system.md
 * ticket 3): the retrieval labels a document carries, from a cheap model,
 * written straight to the file.
 *
 * Two labels, one call. A document made in Qale gets `summary: <title>` or the
 * first line of its body, so the Documents map used to be a list of titles and
 * first lines. And a document nobody tagged is found by nobody. This pass runs
 * on the maintenance tick, asks the model for one line about the note and for
 * the tags it should carry, and writes what came back.
 *
 * Tagging used to be the librarian's: a finding, a card, and the PM approving a
 * label they cannot edit. A tag is the same kind of thing as a summary, so it
 * is written the same way (ticket 3, option A). The librarian keeps the graph
 * repairs and has one thing less on its list.
 *
 * This is a machinery writer outside the write policy, and the policy file
 * (packages/domain/src/proposals/policy.ts) is where that exception is stated.
 * The short of it: a summary and a tag are retrieval labels for the PM's own
 * text, reversible through history, never a claim. So this pass does not go
 * through proposals; it writes the file directly, and commits once per pass.
 *
 * Silent is not invisible. Every note the pass labels gets one Activity row,
 * written after the commit, carrying that commit and the policy's own sentence
 * for why the write needed no card. So "Put it back" works on a label the same
 * way it works on anything the agent wrote on its own (ticket 3, option A). The
 * row has no proposal and no session behind it, because a pass has neither. Who owns each field is stated once, in
 * apps/desktop/src/renderer/src/state/properties-schema.ts (`owner`): `summary` and
 * its markers are derived, `tags` are Qale's. This file keeps its own list and
 * points there.
 *
 * Selection by marker, not by author. No field records who wrote a note, so the
 * rule is what the file says: ask when the summary is a placeholder, or when
 * the body changed since `summary_of`, or when the note carries no tags. A note
 * with tags and a fresh marker is never a candidate, and a marker is written
 * whenever the model answered. So one body is asked about once, and a "no tags"
 * answer is not asked again the next time the tick comes round.
 *
 * The two halves cover different types. The summary is for documents and
 * meetings. A tag is for anything the team wrote (a decision, an insight, a
 * customer, a theme, a todo, a source too), and for none of the machinery: a
 * mirror carries the upstream site's own labels, and a person, a session or a
 * skill is reached by name.
 *
 * Collisions are benign. A session's `propose_update` on the same note merges
 * frontmatter at accept and its summary wins; a summary write between draft and
 * approval does not fail the card. Each write fires the watcher (reindex, one
 * repaint) and no loop: the marker stops the pass from asking about the same
 * body twice.
 */

/** Types the pass summarises: the PM's documents and their meetings. */
const SUMMARISED_TYPES: readonly NoteType[] = ['note', 'meeting'];

/**
 * Types the pass tags: what the team wrote. A person, a session, a skill and an
 * agent are reached by name rather than found by tag, and a mirrored ticket or
 * page carries the upstream site's own labels, which are not ours to write.
 */
const TAGGED_TYPES: readonly NoteType[] = [
  'meeting',
  'decision',
  'insight',
  'customer',
  'theme',
  'todo',
  'note',
  'source',
];

/** How many notes one pass asks the model about. */
export const SUMMARY_BATCH_LIMIT = 20;

/** The longest answer the pass accepts. The prompt asks for under 160. */
export const SUMMARY_MAX_CHARS = 200;

/** How many tags one note gets. Two is a label; five is a second summary. */
export const MAX_TAGS = 2;

/** Tags shown to the model as the vocabulary in use, most used first. */
export const TAGS_IN_USE_LIMIT = 24;

/**
 * The shape a tag has to have before the pass writes it: one plain word, no
 * spaces, hyphens allowed. A tag already in use is written back as it stands,
 * whatever its case, so the model naming an existing tag always matches it.
 */
const TAG_SHAPE = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,39}$/u;

/**
 * What one model call is about. The pass asks about two things, and the prompt
 * builder branches on `kind`: a document, and a Documents folder whose "body"
 * is the titles and summaries of the documents in it.
 */
export interface SummarySubject {
  kind: 'note' | 'folder';
  /** Vault path, named as the material's origin in the prompt. */
  path: string;
  title: string;
  body: string;
  /** Does this note need tags too? The prompt asks for them only then. */
  wantsTags?: boolean;
  /** The tags the workspace already uses, most used first, for the prompt. */
  tagsInUse?: readonly string[];
}

/** One note the pass wants a label for. */
export interface SummaryCandidate extends SummarySubject {
  kind: 'note';
  path: string;
  /** The note's title, for the prompt. Frontmatter first, then the filename. */
  title: string;
  /** The body below the frontmatter, as read. */
  body: string;
  /** Hash of that body: the marker to write, and the check before writing. */
  bodyHash: string;
  /** Is the summary on the file a placeholder, or older than the body? */
  wantsSummary: boolean;
  /** Has the note no tags, and is it a type a tag is for? */
  wantsTags: boolean;
  tagsInUse: readonly string[];
}

/** What the model said about one candidate. */
export interface SummaryResult {
  path: string;
  bodyHash: string;
  /** The line to write, or null to leave the summary as it is. */
  summary: string | null;
  /** The tags to write. Empty means the model named none that fit. */
  tags: string[];
  /**
   * Did the answer come back in a shape the pass could read? Nothing is written
   * when it did not, and the note is asked about again on the next pass.
   */
  answered: boolean;
}

/**
 * One note the pass labelled, and what it put on it. The Activity row is
 * written from this, so it says what the file now carries and not what the
 * model happened to answer.
 */
export interface LabelledNote {
  path: string;
  /** The note's title, as the Activity row names it. */
  title: string;
  /** The summary line written, or null when only the marker or tags changed. */
  summary: string | null;
  /** The tags written. Empty when none were. */
  tags: string[];
}

export interface SummaryPassResult {
  /** Notes the pass asked about. */
  asked: string[];
  /** Notes whose labels were written. */
  written: string[];
  /** Documents folders the pass asked a purpose for. */
  foldersAsked: string[];
  /** Folder maps whose purpose was written. */
  foldersWritten: string[];
}

/** The model call. Returns the raw answer, or null when nothing came back. */
export type NoteSummariser = (subject: SummarySubject) => Promise<string | null>;

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** "Q3 plan" and "Q3 plan." are the same placeholder. */
function fold(s: string): string {
  return s.trim().replace(/[.!]$/, '').toLowerCase();
}

/**
 * Is this summary one nobody wrote? Empty, marked, equal to the title
 * (`createNote`), or equal to the body's first line (`captureNote`, and the
 * normalize pass, which marks it too).
 */
function isPlaceholder(
  frontmatter: Record<string, unknown>,
  path: string,
  body: string,
  indexTitle: string,
): boolean {
  const summary = str(frontmatter['summary']);
  if (!summary) return true;
  if (NEEDS_SUMMARY_FIELD in frontmatter) return true;
  const titles = [str(frontmatter['title']), indexTitle, titleFromSlug(slugFromPath(path))];
  if (titles.some((t) => t && fold(t) === fold(summary))) return true;
  return fold(derivedSummary(path, body)) === fold(summary);
}

/**
 * Every way a file says "no tags": the field missing, an empty list, and a
 * `tags:` with nothing after it. The frontmatter reader keeps the field as the
 * file wrote it, so all three arrive here.
 */
function hasTag(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some((t) => String(t ?? '').trim().length > 0);
  return false;
}

/**
 * A note the pass may label at all: nothing mirrored, nothing machinery owns.
 * `isReservedFile` covers `index.md` and `log.md`, so a folder map is out;
 * `isNormalizable` covers the session files and the skill and agent folders.
 */
function labellable(n: IndexedNote): boolean {
  if (isMirrorType(n.type)) return false;
  if (isReservedFile(n.path) || isUnderstandingPath(n.path) || isVoicePath(n.path)) return false;
  if (!isNormalizable(n.path)) return false;
  if (!SUMMARISED_TYPES.includes(n.type) && !TAGGED_TYPES.includes(n.type)) return false;
  return n.hasBody;
}

/**
 * Could the pass want anything from this note, by what the index alone says?
 * A summary needs the body to judge, so a document or a meeting is always
 * opened. Everything else is here for its tags, and a note that has one is
 * settled, so the tick reads no file for it.
 */
function maybeWanted(n: IndexedNote): boolean {
  if (SUMMARISED_TYPES.includes(n.type)) return true;
  return !hasTag(n.frontmatter['tags']);
}

/**
 * The tags the workspace already uses, most used first. The point of a tag is
 * that a second note carries the same one, so the model is shown the vocabulary
 * rather than left to invent a word per note.
 *
 * Only tags of the shape the pass itself writes are shown. A tag is workspace
 * text going back into a prompt, and one that arrived as a sentence would read
 * as instruction next to the list.
 */
export function tagsInUse(notes: readonly IndexedNote[]): string[] {
  const counts = new Map<string, number>();
  for (const note of notes) {
    const raw = note.frontmatter['tags'];
    const list = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw : [];
    for (const entry of list) {
      const tag = String(entry ?? '').trim();
      if (!TAG_SHAPE.test(tag)) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TAGS_IN_USE_LIMIT)
    .map(([tag]) => tag);
}

/**
 * The notes one pass will ask about, oldest first, at most `limit`. Each is
 * read once here so the body the model sees is the body the hash is over.
 */
export async function planSummaries(
  ctx: UseCaseContext,
  opts: { limit?: number } = {},
): Promise<SummaryCandidate[]> {
  const limit = opts.limit ?? SUMMARY_BATCH_LIMIT;
  const out: SummaryCandidate[] = [];
  const all = ctx.index.all();
  const inUse = tagsInUse(all);
  const notes = all
    .filter((n) => labellable(n) && maybeWanted(n))
    .sort((a, b) => a.mtime - b.mtime);

  for (const n of notes) {
    if (out.length >= limit) break;
    try {
      const raw = await ctx.vault.readRaw(n.path);
      if (raw === null) continue;
      const parsed = parseNote(raw);
      // A block that would not parse is normalize's problem, not ours. Writing
      // over it would guess at fields the PM meant.
      if (parsed.malformed) continue;
      const body = parsed.body;
      if (!body.trim()) continue;
      const bodyHash = contentHash(body);
      const fm = parsed.frontmatter;
      const marker = str(fm[SUMMARY_OF_FIELD]);
      // A marker that matches means the pass already read this body and said
      // what it had to say. Nothing is asked twice about one body, so a note
      // the model gave no tags for stays quiet until the PM edits it.
      if (marker && marker === bodyHash) continue;
      // Past the line above, a marker that is there is a stale one: the body
      // moved, so the summary is older than the note. With no marker the
      // summary itself is examined for being a placeholder.
      const stale = marker !== '';
      const wantsSummary =
        SUMMARISED_TYPES.includes(n.type) && (stale || isPlaceholder(fm, n.path, body, n.title));
      const wantsTags = TAGGED_TYPES.includes(n.type) && !hasTag(fm['tags']);
      if (!wantsSummary && !wantsTags) continue;
      out.push({
        kind: 'note',
        path: n.path,
        title: str(fm['title']) || n.title || titleFromSlug(slugFromPath(n.path)),
        body,
        bodyHash,
        wantsSummary,
        wantsTags,
        tagsInUse: inUse,
      });
    } catch (err) {
      logError('[qale] summary plan skipped', n.path, err instanceof Error ? err.message : err);
    }
  }
  return out;
}

/**
 * One clean line out of whatever the model said, or null to leave the note
 * alone this pass. Empty, more than one line, or over {@link SUMMARY_MAX_CHARS}
 * all count as no answer: a bad summary is worse than a placeholder, and the
 * next pass asks again.
 */
export function acceptSummary(answer: string | null | undefined): string | null {
  if (!answer) return null;
  let s = answer.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  if (!s) return null;
  if (/[\r\n]/.test(s)) return null;
  if (s.length > SUMMARY_MAX_CHARS) return null;
  return s;
}

/**
 * The tags out of a `tags: a, b` line, or none.
 *
 * Quiet on everything it does not recognise. "none", an empty line, a word with
 * a space in it, a sentence: all of them come back as no tags, because a wrong
 * tag is worse than a missing one and nobody is at the screen to catch it. A
 * word already in use is written back exactly as the workspace spells it; a new
 * word is written in lower case, and only if it is one word.
 */
export function acceptTags(line: string | null | undefined, inUse: readonly string[]): string[] {
  const body = str(line)
    .replace(/^tags\s*:/i, '')
    .trim();
  if (!body || /^(none|no tags?|-|\[\]|n\/a)$/i.test(body)) return [];
  const out: string[] = [];
  for (const raw of body.split(/[,;]/)) {
    const word = raw
      .trim()
      .replace(/^["'`#[]+/, '')
      .replace(/["'`\]]+$/, '')
      .trim();
    if (!word) continue;
    const known = inUse.find((t) => t.toLowerCase() === word.toLowerCase());
    const tag = known ?? word.toLowerCase();
    if (!known && !TAG_SHAPE.test(tag)) continue;
    if (!out.includes(tag)) out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/**
 * Both labels out of one answer. The model writes the summary on the first
 * line and, when it was asked for tags, `tags: a, b` on a second one.
 *
 * `answered` is what the summary line decides: a first line the pass cannot
 * read as a summary is a broken answer, and a broken answer writes nothing at
 * all, tags included. A tags line that is missing or unreadable is not broken;
 * it means no tags, which is an answer the prompt asks for by name.
 */
export function acceptLabels(
  answer: string | null | undefined,
  inUse: readonly string[] = [],
): { summary: string | null; tags: string[]; answered: boolean } {
  const lines = String(answer ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const tagLine = lines.length > 1 && /^tags\s*:/i.test(lines.at(-1)!) ? lines.pop() : undefined;
  const summary = acceptSummary(lines.join('\n'));
  if (summary === null) return { summary: null, tags: [], answered: false };
  return { summary, tags: acceptTags(tagLine, inUse), answered: true };
}

/**
 * Write the labels that came back. Each note is read again first: the model
 * took its time, and a body that changed underneath is left for the next pass
 * rather than labelled with a line about an older version. The caller commits,
 * so the notes and the folder purposes below land in one commit.
 *
 * The marker is written whenever the model answered, even when there was
 * nothing else to write. That is what "asked once per body" is made of: without
 * it, a note the model gave no tags for comes back every pass forever.
 */
export async function applySummaries(
  ctx: UseCaseContext,
  results: SummaryResult[],
): Promise<LabelledNote[]> {
  const written: LabelledNote[] = [];
  const today = ctx.clock.now().slice(0, 10);

  for (const r of results) {
    if (!r.answered) continue;
    try {
      const raw = await ctx.vault.readRaw(r.path);
      if (raw === null) continue;
      const parsed = parseNote(raw);
      if (parsed.malformed) continue;
      if (contentHash(parsed.body) !== r.bodyHash) continue;
      const next: Record<string, unknown> = {
        ...parsed.frontmatter,
        [SUMMARY_OF_FIELD]: r.bodyHash,
      };
      if (r.summary) {
        next['summary'] = r.summary;
        next[SUMMARY_AT_FIELD] = today;
        // Deleted, never set false: normalize deletes the key, and a `false`
        // would be rewritten and committed again on the next tick.
        delete next[NEEDS_SUMMARY_FIELD];
      }
      // Never an empty `tags:`. No tags at all is what the file already says,
      // and a bare key would read as a field somebody meant to fill in.
      if (r.tags.length > 0) next['tags'] = r.tags;
      const note = await ctx.vault.writeNote(r.path, next as Frontmatter, parsed.body);
      ctx.index.reindex(note);
      written.push({
        path: r.path,
        title:
          str(parsed.frontmatter['title']) ||
          ctx.index.get(r.path)?.title ||
          titleFromSlug(slugFromPath(r.path)),
        summary: r.summary,
        tags: r.tags,
      });
    } catch (err) {
      logError('[qale] summary write skipped', r.path, err instanceof Error ? err.message : err);
    }
  }

  return written;
}

/**
 * Folder purposes (docs/index-maps.md IM-7), the second half of the pass.
 *
 * A Documents folder's purpose line is the stub `createDocumentFolder` wrote
 * ("Specs, a folder of your documents") and nothing ever replaced it. So the
 * Documents tree maps say what a folder is called and nothing about what is in
 * it. This half fills the line in from the same cheap model, on the same tick,
 * in the same commit.
 *
 * It reads the TITLES AND SUMMARIES of the documents in the folder, never their
 * bodies. The summaries are one line each, so a whole folder fits in one small
 * call, and a body that changed without changing its summary is not news about
 * the folder. It runs after the note summaries, so the lines it reads are the
 * ones this tick just wrote.
 *
 * Which folders. A folder qualifies when it holds three or more documents
 * (counting the ones in its subfolders) and either its purpose is still the
 * stub, or the folder is missing one, or its contents changed by more than half
 * since the purpose was written. A line a person wrote stays until then.
 *
 * The marker. `purpose_of` holds one short hash per document the model was
 * shown, sorted and space separated. One hash over the whole set would answer
 * "did anything change" but not "by how much", and the count alone would miss a
 * folder whose documents were all replaced. The list of per-document hashes is
 * the smallest thing that answers both, and it stays one frontmatter key. The
 * generator reads it back off the file and re-emits it, so it survives every
 * regeneration of the map.
 */

/** How many documents a folder needs before it is worth a purpose. */
export const FOLDER_MIN_DOCUMENTS = 3;

/** How many folders one pass asks the model about. */
export const FOLDER_PURPOSE_LIMIT = 5;

/** Rewrite the purpose when more than this share of the documents differ. */
export const FOLDER_CHANGE_SHARE = 0.5;

/** One folder the pass wants a purpose for. */
export interface FolderPurposeCandidate extends SummarySubject {
  kind: 'folder';
  /** The folder's `index.md`, which is the file the line is written to. */
  path: string;
  /** The folder name as a title. */
  title: string;
  /** The titles and summaries of the documents in it, one per line. */
  body: string;
  /** The marker to write: what this line was written from. */
  marker: string;
}

/** What the model said about one folder. `null` means it gave nothing usable. */
export interface FolderPurposeResult {
  path: string;
  marker: string;
  purpose: string | null;
}

/** One short hash per document path, sorted, space separated. */
export function purposeMarker(paths: string[]): string {
  return [...paths]
    .sort()
    .map((p) => contentHash(p))
    .join(' ');
}

/**
 * The share of documents that differ between two markers: 0 is the same set, 1
 * is nothing in common. Both sets count, so a folder that doubled in size and a
 * folder that was emptied both read as changed.
 */
export function changedShare(before: string, after: string): number {
  const a = new Set(before.split(/\s+/).filter(Boolean));
  const b = new Set(after.split(/\s+/).filter(Boolean));
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  let shared = 0;
  for (const h of a) if (b.has(h)) shared++;
  return 1 - shared / union.size;
}

/**
 * One clean line, or null to leave the folder alone this pass. Everything
 * {@link acceptSummary} refuses, plus a line the folder map could not carry:
 * the purpose is written as a bare YAML scalar, so a `key: value` colon in it
 * would break the file for the next reader.
 */
export function acceptPurpose(answer: string | null | undefined): string | null {
  const line = acceptSummary(answer);
  if (line === null) return null;
  if (/:\s/.test(line)) return null;
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(line)) return null;
  return line;
}

/** The documents in a folder and in every folder under it, by path. */
function documentsIn(docs: IndexedNote[], key: string): IndexedNote[] {
  return docs
    .filter((d) => d.path.startsWith(`${DOCUMENTS_PREFIX}${key}/`))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** The list the model reads: one document per line, title and summary only. */
function documentLines(docs: IndexedNote[]): string {
  return docs
    .map((d) => {
      const title = (d.title || d.path).trim();
      const summary = d.summary.trim();
      return summary ? `- ${title} (${summary})` : `- ${title}`;
    })
    .join('\n');
}

/**
 * The folders one pass will ask about, at most `limit`. The folder names come
 * from the documents themselves: a folder with three documents in it always has
 * them in the index, so this never has to list the vault.
 */
export async function planFolderPurposes(
  ctx: UseCaseContext,
  opts: { limit?: number } = {},
): Promise<FolderPurposeCandidate[]> {
  const limit = opts.limit ?? FOLDER_PURPOSE_LIMIT;
  const docs = ctx.index.all().filter(isDocument);

  const keys = new Set<string>();
  for (const d of docs) {
    const parts = documentFolderOf(d.path).split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i++) keys.add(parts.slice(0, i).join('/'));
  }

  const out: FolderPurposeCandidate[] = [];
  for (const key of [...keys].sort()) {
    if (out.length >= limit) break;
    const path = `${DOCUMENTS_PREFIX}${key}/index.md`;
    try {
      const inside = documentsIn(docs, key);
      if (inside.length < FOLDER_MIN_DOCUMENTS) continue;
      const meta = folderMetaOf(await ctx.vault.readRaw(path));
      const title = titleFromSlug(key);
      const stub =
        !meta.description || fold(meta.description) === fold(documentFolderPurpose(title));
      const marker = purposeMarker(inside.map((d) => d.path));
      // A line somebody wrote stays until the folder is more than half new
      // documents. With no marker there is nothing to compare, so it stays.
      const drifted =
        !!meta.purposeOf && changedShare(meta.purposeOf, marker) > FOLDER_CHANGE_SHARE;
      if (!stub && !drifted) continue;
      out.push({ kind: 'folder', path, title, body: documentLines(inside), marker });
    } catch (err) {
      logError('[qale] folder purpose skipped', path, err instanceof Error ? err.message : err);
    }
  }
  return out;
}

/**
 * Put `description` and `purpose_of` at the top of a folder map's frontmatter,
 * in the order the generator writes them, and leave the rest of the file alone.
 * The same order means the next regeneration renders the same bytes and makes
 * no second commit.
 */
export function withFolderPurpose(raw: string, purpose: string, marker: string): string {
  const block = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const rest = block
    ? (block[1] ?? '')
        .split(/\r?\n/)
        .filter(
          (l) =>
            l !== '' &&
            !l.startsWith('description:') &&
            !l.startsWith(`${FOLDER_PURPOSE_OF_FIELD}:`),
        )
    : [];
  const head = [
    '---',
    `description: ${purpose}`,
    `${FOLDER_PURPOSE_OF_FIELD}: ${marker}`,
    ...rest,
    '---',
    '',
  ].join('\n');
  return head + (block ? raw.slice(block[0].length) : raw);
}

/**
 * Write the purposes that came back. Each folder is checked again first: the
 * model took its time, and a folder whose documents moved underneath is left
 * for the next pass rather than labelled from a list that is out of date.
 */
export async function applyFolderPurposes(
  ctx: UseCaseContext,
  results: FolderPurposeResult[],
): Promise<string[]> {
  const written: string[] = [];
  const docs = ctx.index.all().filter(isDocument);

  for (const r of results) {
    if (!r.purpose) continue;
    try {
      const key = r.path.slice(DOCUMENTS_PREFIX.length, -'/index.md'.length);
      if (purposeMarker(documentsIn(docs, key).map((d) => d.path)) !== r.marker) continue;
      // No map on disk yet is a folder the generator has not reached. Write
      // the frontmatter on its own; the generator fills the body in below, on
      // this same tick. Skipping instead would ask about it again every pass.
      const raw = (await ctx.vault.readRaw(r.path)) ?? '';
      const next = withFolderPurpose(raw, r.purpose, r.marker);
      if (next === raw) continue;
      await ctx.vault.writeRaw(r.path, next);
      written.push(r.path);
    } catch (err) {
      logError(
        '[qale] folder purpose write skipped',
        r.path,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return written;
}

/**
 * One Activity row per labelled note (docs/background-system.md ticket 3).
 *
 * After the commit, never before: the row carries the commit its write landed
 * in, and that is what "Put it back" undoes. Reverting one row puts back one
 * note, because the git layer answers with the paths the commit touched that
 * the row asked about.
 *
 * A note whose file changed but whose labels did not gets no row. That is the
 * marker-only write, where the pass records that it read a body and had nothing
 * to add. There is nothing for the PM to read there and nothing to put back.
 *
 * A folder map gets no row either. Its `index.md` is a generated file, not a
 * page the PM opens, and the Activity view opens the path it names.
 */
async function recordLabels(ctx: UseCaseContext, labelled: LabelledNote[]): Promise<void> {
  for (const note of labelled) {
    if (!note.summary && note.tags.length === 0) continue;
    await recordActivityRow(
      ctx,
      {
        proposalId: null,
        action: 'labelled',
        line: labelLine(note),
        // The policy's own sentence, not a second copy of it. A summary is the
        // bigger half, so a note that got both is reported as a label.
        reason: note.summary ? DERIVED_LABEL_REASON : TAG_REASON,
        path: note.path,
        // A pass has no card behind it and no chat around it.
        sessionId: null,
        skill: null,
      },
      // The file was there before the pass, so putting it back means the
      // contents it had.
      'restore',
    );
  }
}

/**
 * The whole pass: plan, ask the model one subject at a time, write what passed
 * the answer rules, and commit once. Notes first, so the folder half reads the
 * summaries this tick wrote. A model call that throws counts as no answer for
 * that subject; the rest of the batch carries on.
 */
export async function runSummaryPass(
  ctx: UseCaseContext,
  opts: { summarise: NoteSummariser; limit?: number; folderLimit?: number },
): Promise<SummaryPassResult> {
  const ask = async (subject: SummarySubject): Promise<string | null> => {
    try {
      return await opts.summarise(subject);
    } catch (err) {
      logError(
        '[qale] summary call failed',
        subject.path,
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  };

  const candidates = await planSummaries(
    ctx,
    opts.limit === undefined ? {} : { limit: opts.limit },
  );
  const results: SummaryResult[] = [];
  for (const c of candidates) {
    const labels = acceptLabels(await ask(c), c.tagsInUse);
    results.push({
      path: c.path,
      bodyHash: c.bodyHash,
      // A note that only needed tags keeps the summary it has. The model is
      // asked for one all the same: it is one answer shape for the parser, and
      // writing the line is what makes the model read the note before it picks
      // a word.
      summary: c.wantsSummary ? labels.summary : null,
      tags: c.wantsTags ? labels.tags : [],
      answered: labels.answered,
    });
  }
  const labelled = await applySummaries(ctx, results);
  const written = labelled.map((n) => n.path);

  const folders = await planFolderPurposes(
    ctx,
    opts.folderLimit === undefined ? {} : { limit: opts.folderLimit },
  );
  const folderResults: FolderPurposeResult[] = [];
  for (const f of folders) {
    folderResults.push({ path: f.path, marker: f.marker, purpose: acceptPurpose(await ask(f)) });
  }
  const foldersWritten = await applyFolderPurposes(ctx, folderResults);

  const touched = [...written, ...foldersWritten];
  if (touched.length > 0) {
    await ctx.git.commitPaths(touched, 'maintenance: labels');
    await recordLabels(ctx, labelled);
  }
  return {
    asked: candidates.map((c) => c.path),
    written,
    foldersAsked: folders.map((f) => f.path),
    foldersWritten,
  };
}
