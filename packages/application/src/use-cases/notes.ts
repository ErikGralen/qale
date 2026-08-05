import {
  addTranscriptRef,
  checkFrontmatterMutation,
  isBodyEditable,
  normalizeLinkTarget,
  dirForType,
  fileSlug,
  slugify,
  titleFromSlug,
  TYPE_RULES,
  type Frontmatter,
  type MeetingFrontmatter,
  type NoteFrontmatter,
  type Note,
  type SourceNoteFrontmatter,
  type SourceRef,
} from '@qale/domain';
import type { BacklinkRow, IndexedNote, UseCaseContext } from '../ports.js';

export async function getNote(ctx: UseCaseContext, path: string): Promise<Note | null> {
  return ctx.vault.readNote(path);
}

/** Find a free path near `desired`, appending -2, -3 … to avoid clobbering. */
async function freePath(ctx: UseCaseContext, desired: string): Promise<string> {
  let path = desired;
  let n = 2;
  while (await ctx.vault.exists(path)) {
    path = desired.replace(/(\.[a-z0-9]+)$/i, `-${n}$1`);
    n++;
  }
  return path;
}

export interface CaptureNoteInput {
  body: string;
  summary?: string;
  source?: SourceRef;
}

/**
 * ⌘N quick capture → notes/…md. A generic authored note; the 60-second debrief
 * (Phase 3) repoints this at an arrival session, but a plain capture is the
 * always-available fallback.
 */
export async function captureNote(ctx: UseCaseContext, input: CaptureNoteInput): Promise<Note> {
  const now = ctx.clock.now();
  const date = now.slice(0, 10);
  const summary = (input.summary ?? firstLine(input.body)).slice(0, 200) || 'captured note';
  const desired = `${dirForType('note')}/${fileSlug(summary, date)}.md`;
  const path = await freePath(ctx, desired);
  const frontmatter: NoteFrontmatter = { type: 'note', title: summary, summary, sources: [] };
  const note = await ctx.vault.writeNote(path, frontmatter, input.body.trim());
  ctx.index.reindex(note);
  await ctx.git.commitPaths([note.path], `capture: ${summary}`);
  return note;
}

export interface CaptureMeetingInput {
  title: string;
  /** The recording. Several parts means several files, one meeting. */
  body: string | MeetingTranscriptPart[];
  /**
   * The day the meeting happened (YYYY-MM-DD), when the material says so.
   * Defaults to today, which is right for a transcript dropped straight off the
   * call and wrong for one dropped on Monday from a call on Thursday.
   */
  date?: string;
  source?: SourceRef;
  participants?: string[];
}

/** One file of a recording that arrived in several: its text and what to call it. */
export interface MeetingTranscriptPart {
  body: string;
  /** Names the source note ("… transcript, part 2"); omit for a single recording. */
  label?: string;
}

/**
 * Drop/paste a transcript → meetings/…md. One file anchors the whole meeting
 * lifecycle (prep, notes, processed summary); each transcript is filed as an
 * immutable source note and linked from the `transcript` frontmatter ref, so
 * the meeting page stays human-scale. Arrival reads them all and proposes the
 * truth delta. Provenance (date/participants/source) is immutable thereafter.
 *
 * A recording delivered as several files is ONE meeting with several
 * transcripts, never several meetings. The parts stay separate notes and are
 * never spliced into one body: they are raw provenance, and a join we performed
 * is a claim about how they fit together that only the recording can settle.
 */
export async function captureMeeting(ctx: UseCaseContext, input: CaptureMeetingInput): Promise<Note> {
  // When the meeting HAPPENED, which is only today for a transcript dropped
  // straight off the call. Dating Thursday's call to the Monday it was filed
  // makes it read as this week's meeting everywhere that sorts by date, and the
  // provenance is immutable afterwards, so the wrong answer sticks.
  const date = input.date ?? ctx.clock.now().slice(0, 10);
  const summary = input.title.slice(0, 200) || 'meeting';
  const desired = `${dirForType('meeting')}/${fileSlug(summary, date)}.md`;
  const path = await freePath(ctx, desired);

  const parts: MeetingTranscriptPart[] =
    typeof input.body === 'string' ? [{ body: input.body }] : input.body;
  const committed: string[] = [];
  const refs: string[] = [];
  // One at a time: `freePath` resolves collisions by looking at the disk, so
  // two parts of one recording racing each other would both take part 1's path.
  for (const part of parts) {
    const name = part.label ? `${summary} transcript ${part.label}` : `${summary} transcript`;
    const tPath = await freePath(ctx, `${dirForType('source')}/${fileSlug(name, date)}.md`);
    const tFrontmatter: SourceNoteFrontmatter = {
      type: 'source',
      summary: part.label ? `Transcript (${part.label}) — ${summary}` : `Transcript — ${summary}`,
      processing: 'new',
      source: input.source ?? { system: 'transcript' },
      captured: date,
    };
    const tNote = await ctx.vault.writeNote(tPath, tFrontmatter, part.body.trim());
    ctx.index.reindex(tNote);
    committed.push(tNote.path);
    refs.push(`[[${tNote.slug}]]`);
  }

  const frontmatter: MeetingFrontmatter = {
    type: 'meeting',
    summary,
    date,
    processing: 'new' as const,
    ...(input.participants ? { participants: input.participants } : {}),
    ...(input.source ? { source: input.source } : {}),
    transcript: refs.length === 1 ? refs[0]! : refs,
  };
  const body = `## Notes\n\n## Summary\n\n_Not read yet. The summary arrives as an approval card._\n`;
  const note = await ctx.vault.writeNote(path, frontmatter, body);
  ctx.index.reindex(note);
  committed.push(note.path);
  await ctx.git.commitPaths(committed, `meeting: ${summary}`);
  return note;
}

export interface AttachTranscriptInput {
  /** The existing (typically calendar-synced) meeting note to attach to. */
  meetingPath: string;
  /** The recording. Several parts means several files, one meeting. */
  body: string | MeetingTranscriptPart[];
  source?: SourceRef;
}

/**
 * Attach captured transcripts to a meeting note that ALREADY exists — the
 * capture-matching path. Instead of
 * minting a second `meeting` note for a slot the calendar mirror already
 * created, file each transcript as an immutable source and link it onto the
 * synced note. Only the meeting-mutable fields move (`transcript`, `processing`):
 * the machine-owned scheduling fields the mirror set (date/time/participants/
 * series/external_id…) and the PM's body are left untouched. Arrival then reads
 * them all and proposes the truth delta, exactly as for a fresh capture.
 *
 * Transcripts APPEND. Dropping part 2 onto a meeting that already holds part 1
 * used to overwrite the ref, which left part 1 on disk with nothing pointing at
 * it — evidence the meeting no longer cited and nobody had deleted.
 */
export async function attachTranscriptToMeeting(
  ctx: UseCaseContext,
  input: AttachTranscriptInput,
): Promise<Note> {
  const meeting = await ctx.vault.readNote(input.meetingPath);
  if (!meeting || meeting.type !== 'meeting') {
    throw new Error(`attach target is not a meeting note: ${input.meetingPath}`);
  }
  const now = ctx.clock.now();
  const date = now.slice(0, 10);
  const fm = meeting.frontmatter as Record<string, unknown>;
  const summary = (typeof fm['summary'] === 'string' && fm['summary']) || titleFromSlug(meeting.slug);

  const parts: MeetingTranscriptPart[] =
    typeof input.body === 'string' ? [{ body: input.body }] : input.body;
  const committed: string[] = [];
  let transcript = fm['transcript'] as string | string[] | undefined;
  for (const part of parts) {
    const name = part.label ? `${summary} transcript ${part.label}` : `${summary} transcript`;
    const tPath = await freePath(ctx, `${dirForType('source')}/${fileSlug(name, date)}.md`);
    const tFrontmatter: SourceNoteFrontmatter = {
      type: 'source',
      summary: part.label ? `Transcript (${part.label}) — ${summary}` : `Transcript — ${summary}`,
      processing: 'new',
      source: input.source ?? { system: 'transcript' },
      captured: date,
    };
    const tNote = await ctx.vault.writeNote(tPath, tFrontmatter, part.body.trim());
    ctx.index.reindex(tNote);
    committed.push(tNote.path);
    transcript = addTranscriptRef({ transcript }, `[[${tNote.slug}]]`);
  }

  // Link the transcripts and flag the meeting for review. `processing: 'new'` is what
  // makes the freshness spine mark dependents stale — same signal captureMeeting
  // emits. Provenance and the machine-owned mirror fields ride through the spread.
  const next = { ...meeting.frontmatter, transcript, processing: 'new' } as Frontmatter;
  const note = await ctx.vault.writeNote(input.meetingPath, next, meeting.body);
  ctx.index.reindex(note);
  await ctx.git.commitPaths([...committed, note.path], `transcript: ${summary}`);
  return note;
}

export interface CaptureDocumentInput {
  title: string;
  body: string;
  /** The file it arrived as, when there was one — provenance on the source ref. */
  fileName?: string;
}

/**
 * Material that arrived — a spec someone sent, a pasted thread, an exported
 * page. Raw layer, `sources/`, exactly like a link or a screenshot: the PO is
 * its reader, not its author. Anything derived from it (a note, an insight, a
 * decision) is proposed later and cites this.
 */
export async function captureDocument(
  ctx: UseCaseContext,
  input: CaptureDocumentInput,
): Promise<Note> {
  const date = ctx.clock.now().slice(0, 10);
  const summary = input.title.slice(0, 200) || 'document';
  const path = await freePath(ctx, `${dirForType('source')}/${fileSlug(summary, date)}.md`);
  const frontmatter: SourceNoteFrontmatter = {
    type: 'source',
    summary,
    processing: 'new',
    source: input.fileName ? { system: 'file', author: input.fileName } : { system: 'paste' },
    captured: date,
  };
  const note = await ctx.vault.writeNote(path, frontmatter, input.body.trim());
  ctx.index.reindex(note);
  await ctx.git.commitPaths([note.path], `source: ${summary}`);
  return note;
}

export interface CaptureScreenshotInput {
  title: string;
  /** What the picture shows and why it matters — the note's whole body. */
  caption: string;
  /** The image itself: the file name it arrived as, and its bytes. */
  image: { name: string; data: Uint8Array };
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;

/**
 * A dropped image → `attachments/` plus a source note that captions it. The
 * caption is the retrieval index, because it carries the claim: nothing in the
 * memory can read pixels, so a screenshot nobody described is a file nobody
 * will ever find again.
 */
export async function captureScreenshot(
  ctx: UseCaseContext,
  input: CaptureScreenshotInput,
): Promise<Note> {
  const date = ctx.clock.now().slice(0, 10);
  const summary = (input.title.trim() || firstLine(input.caption) || 'screenshot').slice(0, 200);
  const ext = IMAGE_EXT.exec(input.image.name)?.[1]?.toLowerCase() ?? 'png';
  const assetPath = await freePath(ctx, `attachments/${fileSlug(summary, date)}.${ext}`);
  await ctx.vault.writeBinary(assetPath, input.image.data);
  const body = `${input.caption.trim()}\n\n![${summary}](../${assetPath})\n`;
  const path = await freePath(ctx, `${dirForType('source')}/${fileSlug(summary, date)}.md`);
  const frontmatter: SourceNoteFrontmatter = {
    type: 'source',
    summary,
    processing: 'new',
    source: { system: 'screenshot' },
    captured: date,
  };
  const note = await ctx.vault.writeNote(path, frontmatter, body);
  ctx.index.reindex(note);
  await ctx.git.commitPaths([note.path, assetPath], `source: ${summary}`);
  return note;
}

export interface CaptureExternalTranscriptInput {
  title: string;
  body: string;
  /** Whose meeting it was — e.g. "Jonas Palm" or "Jonas — sales call". */
  origin?: string;
  source?: SourceRef;
}

/**
 * A transcript of a meeting the PO was NOT in (a colleague's sales call, a
 * forwarded customer conversation). Not a meeting — the PO is a reader, not a
 * participant — so it files as raw signal in sources/: no prep, no series, no
 * follow-up ownership. The External-Transcript session mines it for insights.
 */
export async function captureExternalTranscript(
  ctx: UseCaseContext,
  input: CaptureExternalTranscriptInput,
): Promise<Note> {
  const now = ctx.clock.now();
  const date = now.slice(0, 10);
  const summary = input.title.slice(0, 200) || 'external transcript';
  const path = await freePath(ctx, `${dirForType('source')}/${fileSlug(summary, date)}.md`);
  const frontmatter: SourceNoteFrontmatter = {
    type: 'source',
    summary,
    processing: 'new',
    source: input.source ?? { system: 'transcript' },
    captured: date,
    ...(input.origin ? { origin: input.origin } : {}),
  };
  const note = await ctx.vault.writeNote(path, frontmatter, input.body.trim());
  ctx.index.reindex(note);
  await ctx.git.commitPaths([note.path], `source: ${summary}`);
  return note;
}

/**
 * Save an edit to an authored/derived note body (immutable-body types reject).
 * `label` names the version in the history list; a restore reuses this whole
 * path and only wants a different name for what happened.
 */
export async function saveAuthoredNote(
  ctx: UseCaseContext,
  path: string,
  body: string,
  label?: string,
): Promise<Note> {
  const existing = await ctx.vault.readNote(path);
  // User-facing text: a toast prints these verbatim, so they name the note the
  // way the app does everywhere else, never by where it is stored.
  if (!existing) throw new Error(`there is no note called “${titleFromSlug(path)}”`);
  if (!isBodyEditable(existing.type)) {
    throw new Error(`“${titleFromSlug(path)}” is a kind of note nobody rewrites`);
  }
  // Body-only edit: splice under the raw frontmatter block. Writing
  // `existing.frontmatter` here would persist the coerced fallback for notes
  // whose frontmatter failed validation, erasing the user's real fields.
  const note = await ctx.vault.writeBody(path, body);
  ctx.index.reindex(note);
  await ctx.git.commitPaths([note.path], label ?? `edit: ${note.slug}`);
  return note;
}

export interface RenameNoteInput {
  path: string;
  title: string;
}

/**
 * Retitle a note. The frontmatter `title` is the display name everywhere; the
 * FILE only moves while nothing links here yet — a slug that has been cited is
 * a stable id, and renaming it would orphan wikilinks and frontmatter refs.
 */
export async function renameNote(ctx: UseCaseContext, input: RenameNoteInput): Promise<Note> {
  const title = input.title.trim();
  if (!title) throw new Error('title must not be empty');
  const existing = await ctx.vault.readNote(input.path);
  if (!existing) throw new Error(`there is no note called “${titleFromSlug(input.path)}”`);
  const mutable = TYPE_RULES[existing.type].mutableFields ?? 'all';
  if (mutable !== 'all' && !mutable.includes('title')) {
    throw new Error(`${existing.type} titles are immutable`);
  }

  const prev = existing.frontmatter as Record<string, unknown>;
  const frontmatter = { ...existing.frontmatter, title } as Frontmatter;
  // A summary that just mirrored the old title (or the "Untitled" placeholder)
  // was never authored — it follows the new title.
  const oldTitle = ((prev['title'] as string | undefined) ?? titleFromSlug(existing.slug)).trim().toLowerCase();
  const summary = (prev['summary'] as string | undefined)?.trim().toLowerCase();
  if (!summary || summary === oldTitle || summary === 'untitled') {
    (frontmatter as Record<string, unknown>)['summary'] = title.slice(0, 200);
  }

  const cited = ctx.index.backlinks(existing.slug).length > 0;
  const dir = existing.path.slice(0, existing.path.lastIndexOf('/') + 1);
  const base = existing.path.slice(dir.length);
  const dateMatch = /^(\d{4}-\d{2}-\d{2})-/.exec(base);
  const desired = `${dir}${dateMatch ? fileSlug(title, dateMatch[1] ?? '') : slugify(title) || 'note'}.md`;
  if (cited || desired === existing.path) {
    const note = await ctx.vault.writeNote(existing.path, frontmatter, existing.body);
    ctx.index.reindex(note);
    await ctx.git.commitPaths([note.path], `rename: ${note.slug} → "${title}"`);
    return note;
  }

  const target = await freePath(ctx, desired);
  const note = await ctx.vault.writeNote(target, frontmatter, existing.body);
  await ctx.vault.remove(existing.path);
  ctx.index.removeByPath(existing.path);
  ctx.index.reindex(note);
  await ctx.git.commitPaths([existing.path, note.path], `rename: ${existing.slug} → ${note.slug}`);
  return note;
}

/** Delete a note: remove from disk, drop from index, and commit. */
export async function deleteNote(ctx: UseCaseContext, path: string): Promise<void> {
  const existing = await ctx.vault.readNote(path);
  if (!existing) throw new Error(`there is no note called “${titleFromSlug(path)}”`);
  await ctx.vault.remove(path);
  ctx.index.removeByPath(path);
  await ctx.git.commitPaths([path], `delete: ${existing.slug}`);
}

/** Write validated frontmatter (from the properties form) — never hand-edited. */
export async function saveFrontmatter(
  ctx: UseCaseContext,
  path: string,
  frontmatter: Frontmatter,
): Promise<Note> {
  const existing = await ctx.vault.readNote(path);
  if (!existing) throw new Error(`there is no note called “${titleFromSlug(path)}”`);
  // The mutability invariant (immutable meeting provenance, receipt-frozen
  // sessions, append-only decisions) is enforced HERE — every frontmatter
  // write path (IPC properties form, MCP) funnels through this use-case.
  const check = checkFrontmatterMutation(existing.type, existing.frontmatter, frontmatter);
  if (!check.allowed) throw new Error(check.reason ?? 'immutable frontmatter field');
  const note = await ctx.vault.writeNote(path, frontmatter, existing.body);
  ctx.index.reindex(note);
  await ctx.git.commitPaths([note.path], `properties: ${note.slug}`);
  return note;
}

export interface Backlink {
  from: IndexedNote;
  /** Canonical link type of the inbound edge; absent = untyped mention. */
  type?: string;
  /** True when the semantic edge runs from THIS note to `from` ("blocked by" authored on the other side). */
  reversed?: boolean;
  origin?: BacklinkRow['origin'];
  line?: number;
}

/** Notes that link to `path` (backlinks = links WHERE target resolves here). */
export function getBacklinks(ctx: UseCaseContext, path: string): Backlink[] {
  const record = ctx.index.get(path);
  const slug = record?.slug ?? path.replace(/\.md$/, '');
  const rows: BacklinkRow[] = ctx.index.backlinks(slug);
  const out: Backlink[] = [];
  for (const row of rows) {
    const from = ctx.index.get(row.fromPath);
    if (from) out.push({ from, type: row.type, reversed: row.reversed, origin: row.origin, line: row.line });
  }
  return out;
}

/** Resolve a wikilink target (possibly aliased/anchored) to a note path. */
export function resolveLink(ctx: UseCaseContext, target: string): string | null {
  const { target: normalized } = normalizeLinkTarget(target);
  return ctx.index.resolve(normalized);
}

function firstLine(text: string): string {
  const line = text.trim().split('\n', 1)[0] ?? '';
  return line.replace(/^#+\s*/, '').replace(/^>\s*/, '').trim();
}
