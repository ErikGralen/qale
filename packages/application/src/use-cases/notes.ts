import {
  addTranscriptRef,
  checkFrontmatterMutation,
  typeToWrite,
  isBodyEditable,
  normalizeLinkTarget,
  dirForType,
  fileSlug,
  isHandCreatable,
  slugify,
  titleFromSlug,
  TYPE_RULES,
  type HandCreatableType,
  type Frontmatter,
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

export interface CreateNoteInput {
  type: HandCreatableType;
  /**
   * What to call it. Blank is fine and is the common case: the page opens with
   * the cursor in the title, and renaming moves the file while nothing cites it.
   */
  title?: string;
}

/**
 * Start a page of a given type from nothing — the "+" on a Memory shelf.
 *
 * The type decides the filename shape, and the two shapes mean different things.
 * A note is about a moment, so it keeps the date prefix quick capture gives it
 * (`notes/2026-08-14-…`). A hub is about a thing that persists — an account, a
 * person, a problem — and is named after that thing alone (`customers/nordkap`),
 * which is what every hub written by the agent already looks like and what the
 * slug in a wikilink reads as.
 *
 * Only the types a human may author get through here ({@link HAND_CREATABLE_TYPES}):
 * this path writes a blank page, and a blank page of a type nobody can type into
 * is a dead end, not a start.
 */
export async function createNote(ctx: UseCaseContext, input: CreateNoteInput): Promise<Note> {
  if (!isHandCreatable(input.type)) {
    throw new Error(`a ${input.type} is not something you write from a blank page`);
  }
  const title = (input.title ?? '').trim().slice(0, 200) || 'Untitled';
  const dir = dirForType(input.type);
  const desired =
    input.type === 'note'
      ? `${dir}/${fileSlug(title, ctx.clock.now().slice(0, 10))}.md`
      : `${dir}/${slugify(title) || 'untitled'}.md`;
  const path = await freePath(ctx, desired);

  // The lifecycle values a new page starts on: a problem you have just written
  // down is one you are exploring, and an account you bothered to make a page
  // for is one you are working. Both are one click away on the page itself.
  const lifecycle =
    input.type === 'theme'
      ? { stance: 'exploring' as const, evidence: [] }
      : input.type === 'customer'
        ? { relationship: 'active' as const }
        : input.type === 'note'
          ? { sources: [] }
          : {};
  const frontmatter = { type: input.type, title, summary: title, ...lifecycle } as Frontmatter;

  const note = await ctx.vault.writeNote(path, frontmatter, '');
  ctx.index.reindex(note);
  await ctx.git.commitPaths([note.path], `create: ${input.type} ${title}`);
  return note;
}

/** One file of a recording that arrived in several: its text and what to call it. */
export interface MeetingTranscriptPart {
  body: string;
  /** Names the source note ("… transcript, part 2"); omit for a single recording. */
  label?: string;
}

export interface CaptureTranscriptsInput {
  /** What the recording is of — the source notes are named after it. */
  title: string;
  /** The recording. Several parts means several files, one recording. */
  parts: MeetingTranscriptPart[];
  /**
   * The day the meeting happened (YYYY-MM-DD), when the material says so.
   * Defaults to today, which is right for a transcript dropped straight off the
   * call and wrong for one dropped on Monday from a call on Thursday.
   */
  date?: string;
  source?: SourceRef;
}

/**
 * Put a recording on the shelf: one immutable source note per file, and nothing
 * else. This is the whole of what arriving material writes by itself.
 *
 * There used to be a `captureMeeting` here that wrote a meeting page too — an
 * empty scaffold with "not read yet" where the summary goes, which the agent
 * then had to patch with an update card. That was two steps for one thing, and
 * the first of them created a page in `meetings/` that nobody had approved. Now
 * the transcript lands (it is the PM's own material, and every card cites it)
 * and the meeting page is proposed whole, summary included: see `propose_meeting`.
 *
 * A recording delivered as several files is ONE recording with several parts,
 * never several meetings. The parts stay separate notes and are never spliced
 * into one body: they are raw provenance, and a join we performed is a claim
 * about how they fit together that only the recording can settle.
 */
export async function captureTranscripts(
  ctx: UseCaseContext,
  input: CaptureTranscriptsInput,
): Promise<Note[]> {
  const date = input.date ?? ctx.clock.now().slice(0, 10);
  const summary = input.title.slice(0, 200) || 'meeting';
  const written: Note[] = [];
  // One at a time: `freePath` resolves collisions by looking at the disk, so
  // two parts of one recording racing each other would both take part 1's path.
  for (const part of input.parts) {
    const name = part.label ? `${summary} transcript ${part.label}` : `${summary} transcript`;
    const path = await freePath(ctx, `${dirForType('source')}/${fileSlug(name, date)}.md`);
    const frontmatter: SourceNoteFrontmatter = {
      type: 'source',
      summary: part.label ? `Transcript (${part.label}) — ${summary}` : `Transcript — ${summary}`,
      processing: 'new',
      source: input.source ?? { system: 'transcript' },
      captured: date,
    };
    const note = await ctx.vault.writeNote(path, frontmatter, part.body.trim());
    ctx.index.reindex(note);
    written.push(note);
  }
  await ctx.git.commitPaths(
    written.map((n) => n.path),
    `transcript: ${summary}`,
  );
  return written;
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
  const fm = meeting.frontmatter as Record<string, unknown>;
  const summary =
    (typeof fm['summary'] === 'string' && fm['summary']) || titleFromSlug(meeting.slug);

  const parts: MeetingTranscriptPart[] =
    typeof input.body === 'string' ? [{ body: input.body }] : input.body;
  const written = await captureTranscripts(ctx, {
    title: summary,
    parts,
    ...(input.source ? { source: input.source } : {}),
  });
  const committed = written.map((n) => n.path);
  let transcript = fm['transcript'] as string | string[] | undefined;
  for (const note of written) {
    transcript = addTranscriptRef({ transcript }, `[[${note.slug}]]`);
  }

  // Link the transcripts and flag the meeting for review. `processing: 'new'` is
  // what makes the freshness spine mark dependents stale. Provenance and the
  // machine-owned mirror fields ride through the spread.
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
  const oldTitle = ((prev['title'] as string | undefined) ?? titleFromSlug(existing.slug))
    .trim()
    .toLowerCase();
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
  // A note that failed its schema is in memory as a plain `note`, and the form
  // above shows what it was given — so saving it back would quietly replace the
  // file's own `type: meeting` with our reading of it. The file's word wins
  // unless this save is a deliberate retype (see {@link typeToWrite}).
  const declared = typeToWrite(existing, (frontmatter as Record<string, unknown>)['type']);
  const next = { ...frontmatter, type: declared } as Frontmatter;
  const prev = { ...existing.frontmatter, type: declared } as Frontmatter;
  // The mutability invariant (immutable meeting provenance, receipt-frozen
  // sessions, append-only decisions) is enforced HERE — every frontmatter
  // write path (IPC properties form, MCP) funnels through this use-case.
  const check = checkFrontmatterMutation(existing.type, prev, next);
  if (!check.allowed) throw new Error(check.reason ?? 'immutable frontmatter field');
  const note = await ctx.vault.writeNote(path, next, existing.body);
  ctx.index.reindex(note);
  await ctx.git.commitPaths([note.path], `properties: ${note.slug}`);
  return note;
}

/**
 * "I checked this note": append one verification to the `verified` list, which
 * is what derives the trust tier (OKF §5.2, see `trustTier` in @qale/domain).
 * `by` is the actor string, `human:<id>` for a person.
 *
 * Its own use-case rather than a frontmatter save, because a verification is a
 * statement ABOUT a note, not a field of it. The mutability invariant freezes a
 * meeting's provenance and a session receipt whole, and it should: this still
 * has to work there, since raw material is exactly what a person vouches for.
 * The write only ever APPENDS one entry, so nothing already in the file can be
 * rewritten through this door.
 *
 * The same actor on the same day is the same check: it writes nothing and
 * reports `ok: false`, so a second click never grows the list.
 */
export async function markNoteChecked(
  ctx: UseCaseContext,
  path: string,
  by: string,
): Promise<{ ok: boolean }> {
  const existing = await ctx.vault.readNote(path);
  if (!existing) return { ok: false };
  const at = ctx.clock.now().slice(0, 10);
  const fm = existing.frontmatter as Record<string, unknown>;
  const list = Array.isArray(fm['verified']) ? fm['verified'] : [];
  const already = list.some((entry) => {
    const v = entry as { by?: unknown; at?: unknown };
    return v?.by === by && typeof v.at === 'string' && v.at.slice(0, 10) === at;
  });
  if (already) return { ok: false };
  // A note that failed its schema reads as a plain `note`; writing that reading
  // back would replace the file's own `type` (see {@link typeToWrite}).
  const type = typeToWrite(existing, undefined);
  const written = await ctx.vault.writeNote(
    path,
    { ...existing.frontmatter, type, verified: [...list, { by, at }] } as Frontmatter,
    existing.body,
  );
  ctx.index.reindex(written);
  await ctx.git.commitPaths([written.path], `verified: ${written.slug}`);
  return { ok: true };
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
    if (from)
      out.push({
        from,
        type: row.type,
        reversed: row.reversed,
        origin: row.origin,
        line: row.line,
      });
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
  return line
    .replace(/^#+\s*/, '')
    .replace(/^>\s*/, '')
    .trim();
}
