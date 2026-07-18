import {
  classifyCapture,
  isBodyEditable,
  normalizeLinkTarget,
  dirForType,
  fileSlug,
  slugify,
  titleFromSlug,
  TYPE_RULES,
  NOTE_STATUSES,
  type CaptureKind,
  type Frontmatter,
  type MeetingFrontmatter,
  type NoteFrontmatter,
  type NoteStatus,
  type Note,
  type ProblemStance,
  type SourceNoteFrontmatter,
  type SourceRef,
} from '@pm/domain';
import type { SkillEvent } from '@pm/sessions';
import type { BacklinkRow, IndexedNote, UseCaseContext } from '../ports.js';
import { skillsForEvent } from './skills.js';

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
 * (Phase 3) repoints this at an After-Meeting session, but a plain capture is the
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
  body: string;
  source?: SourceRef;
  participants?: string[];
}

/**
 * Drop/paste a transcript → meetings/…md. One file anchors the whole meeting
 * lifecycle (prep, notes, processed summary); the transcript itself is filed as
 * an immutable source note and linked via the `transcript` frontmatter ref, so
 * the meeting page stays human-scale. After-Meeting reads both and proposes the
 * truth delta. Provenance (date/participants/source) is immutable thereafter.
 */
export async function captureMeeting(ctx: UseCaseContext, input: CaptureMeetingInput): Promise<Note> {
  const now = ctx.clock.now();
  const date = now.slice(0, 10);
  const summary = input.title.slice(0, 200) || 'meeting';
  const desired = `${dirForType('meeting')}/${fileSlug(summary, date)}.md`;
  const path = await freePath(ctx, desired);

  const committed: string[] = [];
  const tPath = await freePath(
    ctx,
    `${dirForType('source')}/${fileSlug(`${summary} transcript`, date)}.md`,
  );
  const tFrontmatter: SourceNoteFrontmatter = {
    type: 'source',
    summary: `Transcript — ${summary}`,
    status: 'new',
    source: input.source ?? { system: 'transcript' },
    captured: date,
  };
  const tNote = await ctx.vault.writeNote(tPath, tFrontmatter, input.body.trim());
  ctx.index.reindex(tNote);
  committed.push(tNote.path);
  const transcriptRef = `[[${tNote.slug}]]`;

  const frontmatter: MeetingFrontmatter = {
    type: 'meeting',
    summary,
    date,
    status: 'new' as const,
    ...(input.participants ? { participants: input.participants } : {}),
    ...(input.source ? { source: input.source } : {}),
    transcript: transcriptRef,
  };
  const body = `## Notes\n\n## Summary\n\n_Unprocessed — After-Meeting proposes this section as a card._\n`;
  const note = await ctx.vault.writeNote(path, frontmatter, body);
  ctx.index.reindex(note);
  committed.push(note.path);
  await ctx.git.commitPaths(committed, `meeting: ${summary}`);
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
    status: 'new',
    source: input.source ?? { system: 'transcript' },
    captured: date,
    ...(input.origin ? { origin: input.origin } : {}),
  };
  const note = await ctx.vault.writeNote(path, frontmatter, input.body.trim());
  ctx.index.reindex(note);
  await ctx.git.commitPaths([note.path], `source: ${summary}`);
  return note;
}

export interface IngestCaptureInput {
  /** What the capture is; omit to let the classifier decide. */
  kind?: CaptureKind;
  /** The dumped content: transcript body, note text, link + comment, or a screenshot caption. */
  text: string;
  title?: string;
  /** Primary URL for a link capture. */
  url?: string;
  /** Transcript only — someone else's meeting: filed as a source (signal), not a meeting. */
  external?: boolean;
  /** External transcript only — whose meeting it was. */
  origin?: string;
  /** Screenshot only — the dropped image bytes, stored under attachments/. */
  attachment?: { name: string; data: Uint8Array };
}

export interface IngestFollowUp {
  sessionType: string;
  prompt: string;
  tabTitle: string;
  /** Run headlessly on ingest — the gate is the review, not the run, so nothing
   * waits on the PO to start it; cards land in the Inbox when the session settles. */
  background?: boolean;
}

export interface IngestCaptureResult {
  note: Note;
  kind: CaptureKind;
  /** The session the capture should kick off, if it needs processing. */
  followUp?: IngestFollowUp;
  /** Further bound skills the same event fires — always run headlessly. */
  extras?: IngestFollowUp[];
}

/**
 * Which sessions a capture event fires (Skills v2): the workspace's triggered
 * bindings decide; the hardwired default is the fallback when nothing is bound
 * (e.g. a workspace whose skill copies predate bindings). The first hit keeps
 * the branch's foreground/background semantics; any further hits run headless.
 */
async function boundFollowUps(
  ctx: UseCaseContext,
  event: SkillEvent,
  payload: Record<string, unknown>,
  fallbackType: string | null,
  mk: (sessionType: string) => IngestFollowUp,
): Promise<{ followUp?: IngestFollowUp; extras?: IngestFollowUp[] }> {
  const hits = await skillsForEvent(ctx, event, payload);
  const types = hits.length > 0 ? hits.map((h) => h.sessionType) : fallbackType ? [fallbackType] : [];
  if (types.length === 0) return {};
  const [first, ...rest] = types;
  return {
    followUp: mk(first!),
    ...(rest.length > 0 ? { extras: rest.map((t) => ({ ...mk(t), background: true })) } : {}),
  };
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;

/**
 * Universal ingest (one pipeline, entry-agnostic): anything the PO dumps — via
 * the capture dialog, a shell drop, or a future watcher/bot — lands here. The
 * capture itself is a user action, so it files immediately; everything derived
 * from it still goes through approval cards. Transcripts hand off to
 * After-Meeting; links and screenshots hand off to Intake.
 */
export async function ingestCapture(ctx: UseCaseContext, input: IngestCaptureInput): Promise<IngestCaptureResult> {
  const guess = classifyCapture(input.text, input.attachment?.name);
  const kind = input.kind ?? (input.attachment ? 'screenshot' : guess.kind);
  const title = input.title?.trim() || guess.title || (kind === 'transcript' ? 'Meeting' : 'capture');
  const now = ctx.clock.now();
  const date = now.slice(0, 10);

  if (kind === 'transcript') {
    if (input.external) {
      const note = await captureExternalTranscript(ctx, {
        title,
        body: input.text,
        origin: input.origin,
      });
      const dispatched = await boundFollowUps(
        ctx,
        'capture.transcript',
        { origin: 'external', path: note.path },
        'external-transcript',
        (sessionType) => ({
          sessionType,
          prompt: `Run the ${sessionType} session on ${note.path}: the PO was not in this meeting. Extract cited insights and customer signals as approval cards — never decisions.`,
          tabTitle: `Signals: ${title}`,
          background: true,
        }),
      );
      return { note, kind, ...dispatched };
    }
    const note = await captureMeeting(ctx, { title, body: input.text });
    const dispatched = await boundFollowUps(
      ctx,
      'capture.transcript',
      { origin: 'po', path: note.path },
      'after-meeting',
      (sessionType) => ({
        sessionType,
        prompt: `Run the ${sessionType} session on ${note.path}: read the meeting note and its linked transcript plus related memory, then produce the truth delta as approval cards.`,
        tabTitle: `After-Meeting: ${title}`,
        background: true,
      }),
    );
    return { note, kind, ...dispatched };
  }

  const intakeFollowUp = (note: Note, display: string) => (sessionType: string): IngestFollowUp => ({
    sessionType,
    prompt: `Run the ${sessionType} session on ${note.path}: read the capture, search the memory it might touch, and propose how to file and link it as approval cards. Ask me if something is unclear.`,
    tabTitle: `Intake: ${display}`,
  });

  if (kind === 'link') {
    const url = input.url ?? guess.url;
    if (!url) throw new Error('link capture without a URL');
    const summary = title.slice(0, 200);
    const path = await freePath(ctx, `${dirForType('source')}/${fileSlug(summary, date)}.md`);
    const frontmatter: SourceNoteFrontmatter = {
      type: 'source',
      summary,
      status: 'new',
      source: { system: 'web', url },
      captured: date,
    };
    const note = await ctx.vault.writeNote(path, frontmatter, input.text.trim());
    ctx.index.reindex(note);
    await ctx.git.commitPaths([note.path], `source: ${summary}`);
    const dispatched = await boundFollowUps(
      ctx,
      'capture.ingested',
      { kind, path: note.path },
      'intake',
      intakeFollowUp(note, summary),
    );
    return { note, kind, ...dispatched };
  }

  if (kind === 'screenshot') {
    if (!input.attachment) throw new Error('screenshot capture without an image');
    // The caption beats the file name as the retrieval index — it carries the claim.
    const summary = (input.title?.trim() || firstLine(input.text) || title).slice(0, 200);
    const ext = IMAGE_EXT.exec(input.attachment.name)?.[1]?.toLowerCase() ?? 'png';
    const assetPath = await freePath(ctx, `attachments/${fileSlug(summary, date)}.${ext}`);
    await ctx.vault.writeBinary(assetPath, input.attachment.data);
    const caption = input.text.trim();
    const body = `${caption}\n\n![${summary}](../${assetPath})\n`;
    const path = await freePath(ctx, `${dirForType('source')}/${fileSlug(summary, date)}.md`);
    const frontmatter: SourceNoteFrontmatter = {
      type: 'source',
      summary,
      status: 'new',
      source: { system: 'screenshot' },
      captured: date,
    };
    const note = await ctx.vault.writeNote(path, frontmatter, body);
    ctx.index.reindex(note);
    await ctx.git.commitPaths([note.path, assetPath], `source: ${summary}`);
    const dispatched = await boundFollowUps(
      ctx,
      'capture.ingested',
      { kind, path: note.path },
      'intake',
      intakeFollowUp(note, summary),
    );
    return { note, kind, ...dispatched };
  }

  const note = await captureNote(ctx, { body: input.text, summary: title });
  // Quick notes have no default follow-up, but a workspace binding on
  // `capture.ingested` with `when: {kind: note}` can opt in.
  const dispatched = await boundFollowUps(
    ctx,
    'capture.ingested',
    { kind: 'note', path: note.path },
    null,
    intakeFollowUp(note, title),
  );
  return { note, kind: 'note', ...dispatched };
}

/** Save an edit to an authored/derived note body (immutable-body types reject). */
export async function saveAuthoredNote(ctx: UseCaseContext, path: string, body: string): Promise<Note> {
  const existing = await ctx.vault.readNote(path);
  if (!existing) throw new Error(`note not found: ${path}`);
  if (!isBodyEditable(existing.type)) {
    throw new Error(`this note type has an immutable body: ${path}`);
  }
  const note = await ctx.vault.writeNote(path, existing.frontmatter, body);
  ctx.index.reindex(note);
  await ctx.git.commitPaths([note.path], `edit: ${note.slug}`);
  return note;
}

/**
 * Re-sync a source from upstream (the Confluence page changed, the article was
 * revised). This is an *update*, not an edit — the whole body is replaced with
 * the fresh upstream content, `updated` is stamped, and `status` drops back to
 * `new` so analyses know to re-run. The only sanctioned way a raw body changes.
 */
export async function refreshSource(ctx: UseCaseContext, path: string, body: string): Promise<Note> {
  const existing = await ctx.vault.readNote(path);
  if (!existing || existing.type !== 'source') throw new Error(`not a source: ${path}`);
  const frontmatter = {
    ...existing.frontmatter,
    status: 'new',
    updated: ctx.clock.now().slice(0, 10),
  } as Frontmatter;
  const note = await ctx.vault.writeNote(path, frontmatter, body.trim());
  ctx.index.reindex(note);
  await ctx.git.commitPaths([note.path], `sync: ${note.slug}`);
  return note;
}

/** Types that carry the generic lifecycle `status` enum. */
const STATUS_TYPES = new Set(['source', 'meeting', 'insight', 'note']);

/** Flip a note's lifecycle status (new/processed/active/stale) — enum-guarded. */
export async function setNoteStatus(ctx: UseCaseContext, path: string, status: NoteStatus): Promise<Note> {
  if (!NOTE_STATUSES.includes(status)) throw new Error(`invalid status: ${status}`);
  const existing = await ctx.vault.readNote(path);
  if (!existing) throw new Error(`note not found: ${path}`);
  if (!STATUS_TYPES.has(existing.type)) {
    throw new Error(`${existing.type} does not carry a lifecycle status`);
  }
  const frontmatter = { ...existing.frontmatter, status } as Frontmatter;
  const note = await ctx.vault.writeNote(path, frontmatter, existing.body);
  ctx.index.reindex(note);
  await ctx.git.commitPaths([note.path], `status: ${note.slug} → ${status}`);
  return note;
}

/** Change a problem's stance (authored field). */
export async function setProblemStance(
  ctx: UseCaseContext,
  path: string,
  stance: ProblemStance,
): Promise<Note> {
  const existing = await ctx.vault.readNote(path);
  if (!existing || existing.type !== 'problem') {
    throw new Error(`not a problem: ${path}`);
  }
  const frontmatter = { ...existing.frontmatter, stance } as Frontmatter;
  const note = await ctx.vault.writeNote(path, frontmatter, existing.body);
  ctx.index.reindex(note);
  await ctx.git.commitPaths([note.path], `stance: ${note.slug} → ${stance}`);
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
  if (!existing) throw new Error(`note not found: ${input.path}`);
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
  if (!existing) throw new Error(`note not found: ${path}`);
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
  if (!existing) throw new Error(`note not found: ${path}`);
  const note = await ctx.vault.writeNote(path, frontmatter, existing.body);
  ctx.index.reindex(note);
  await ctx.git.commitPaths([note.path], `properties: ${note.slug}`);
  return note;
}

export interface Backlink {
  from: IndexedNote;
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
    if (from) out.push({ from, line: row.line });
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
