import {
  checkFrontmatterMutation,
  classifyCapture,
  isBodyEditable,
  normalizeLinkTarget,
  dirForType,
  fileSlug,
  slugify,
  titleFromSlug,
  TYPE_RULES,
  type CaptureKind,
  type Frontmatter,
  type MeetingFrontmatter,
  type NoteFrontmatter,
  type Note,
  type SourceNoteFrontmatter,
  type SourceRef,
} from '@pm/domain';
import { ARRIVAL_AGENT_NAME, buildKickoff } from '@pm/sessions';
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
    processing: 'new',
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
    processing: 'new' as const,
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

export interface AttachTranscriptInput {
  /** The existing (typically calendar-synced) meeting note to attach to. */
  meetingPath: string;
  body: string;
  source?: SourceRef;
}

/**
 * Attach a captured transcript to a meeting note that ALREADY exists — the
 * capture-matching path. Instead of
 * minting a second `meeting` note for a slot the calendar mirror already
 * created, file the transcript as an immutable source and link it onto the
 * synced note. Only the meeting-mutable fields move (`transcript`, `processing`):
 * the machine-owned scheduling fields the mirror set (date/time/participants/
 * series/external_id…) and the PM's body are left untouched. After-Meeting then
 * reads both and proposes the truth delta, exactly as for a fresh capture.
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

  const tPath = await freePath(
    ctx,
    `${dirForType('source')}/${fileSlug(`${summary} transcript`, date)}.md`,
  );
  const tFrontmatter: SourceNoteFrontmatter = {
    type: 'source',
    summary: `Transcript — ${summary}`,
    processing: 'new',
    source: input.source ?? { system: 'transcript' },
    captured: date,
  };
  const tNote = await ctx.vault.writeNote(tPath, tFrontmatter, input.body.trim());
  ctx.index.reindex(tNote);

  // Link the transcript and flag the meeting for review. `processing: 'new'` is what
  // makes the freshness spine mark dependents stale — same signal captureMeeting
  // emits. Provenance and the machine-owned mirror fields ride through the spread.
  const next = { ...meeting.frontmatter, transcript: `[[${tNote.slug}]]`, processing: 'new' } as Frontmatter;
  const note = await ctx.vault.writeNote(input.meetingPath, next, meeting.body);
  ctx.index.reindex(note);
  await ctx.git.commitPaths([tNote.path, note.path], `transcript: ${summary}`);
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

export interface IngestCaptureInput {
  /** What the capture is; omit to let the classifier decide. */
  kind?: CaptureKind;
  /**
   * Is there anything in here to act on? (Sessions v2 Part 5.) When false the
   * document files and nothing runs over it — extraction is time-sensitive and a
   * four-month-old transcript has nothing left to extract, while an analysis
   * session reads unprocessed sources perfectly well. Defaults to true.
   */
  process?: boolean;
  /** The dumped content: transcript body, note text, link + comment, or a screenshot caption. */
  text: string;
  title?: string;
  /**
   * The file this came from, when there was one. The classifier reads it for
   * both kind (`.vtt` is a transcript whatever it says) and title — without it
   * a dropped `nordkap-qbr.txt` files as "Meeting", because a transcript's
   * first line is a spoken turn and never a name.
   */
  fileName?: string;
  /** Primary URL for a link capture. */
  url?: string;
  /** Transcript only — someone else's meeting: filed as a source (signal), not a meeting. */
  external?: boolean;
  /** External transcript only — whose meeting it was. */
  origin?: string;
  /** Transcript only — attach to this existing (calendar-synced) meeting note
   *  instead of creating a new one (capture matching, job 3). Ignored when
   *  `external` is set. */
  attachTo?: string;
  /** Screenshot only — the dropped image bytes, stored under attachments/. */
  attachment?: { name: string; data: Uint8Array };
}

export interface IngestFollowUp {
  skill: string;
  prompt: string;
  tabTitle: string;
  /**
   * Whether the firing trigger lets this arrival draft outbound — the
   * material's permission, not the session's (Sessions v2 invariant 3). A
   * colleague's sales call fires the same agent as the PM's own meeting but
   * without outbound, so "never draft outbound from an external transcript" is
   * enforced by the tool set rather than by the model remembering a rule.
   */
  outbound?: boolean;
  /** Run headlessly on ingest — the gate is the review, not the run, so nothing
   * waits on the PO to start it; cards land in the Inbox when the session settles. */
  background?: boolean;
}

export interface IngestCaptureResult {
  note: Note;
  kind: CaptureKind;
  /** The session the capture should kick off, if it needs processing. */
  followUp?: IngestFollowUp;
}

/**
 * The session a capture fires: always the pipeline's own skill (arrival) — how
 * material is handled is the product's, not a binding the workspace can lose.
 */
function pipelineFollowUp(
  mk: (skill: string) => IngestFollowUp,
  /** The `process` toggle: false means file it and run nothing (Part 5). */
  process: boolean,
  /**
   * Whether this run may draft outbound. The product invariant lives here, in
   * code: a transcript of the PM's own meeting may draft outbound, everything
   * else may not — a property of the material, not a rule the file remembers.
   */
  fallbackOutbound = false,
): { followUp?: IngestFollowUp } {
  if (!process) return {};
  return { followUp: { ...mk(ARRIVAL_AGENT_NAME), ...(fallbackOutbound ? { outbound: true } : {}) } };
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
  const guess = classifyCapture(input.text, input.attachment?.name ?? input.fileName);
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
      const dispatched = pipelineFollowUp(
        (skill) => ({
          skill,
          prompt: buildKickoff({
            skill,
            target: note.path,
            instruction:
              'the PM was NOT in this meeting, so this is signal to mine, not a meeting to process. Extract what needs to happen (commitments anyone made, dates, customer signals) and flag anything that contradicts what the memory holds. Never a decision.',
          }),
          tabTitle: `Signals: ${title}`,
          background: true,
        }),
        input.process ?? true,
      );
      return { note, kind, ...dispatched };
    }
    // Capture matching: attach to the meeting the calendar already mirrored,
    // rather than minting a duplicate note for the same slot.
    const note = input.attachTo
      ? await attachTranscriptToMeeting(ctx, { meetingPath: input.attachTo, body: input.text })
      : await captureMeeting(ctx, { title, body: input.text });
    const dispatched = pipelineFollowUp(
      (skill) => ({
        skill,
        prompt: buildKickoff({
          skill,
          target: note.path,
          instruction:
            "this was the PM's own meeting. Read the meeting note and its linked transcript plus the memory it touches, then extract what it changes as approval cards: decisions with their decider, every commitment made, the summary, and anything that contradicts what the memory holds.",
        }),
        tabTitle: `After-Meeting: ${title}`,
        background: true,
      }),
      input.process ?? true,
      // The PM's own meeting is the one capture that may draft outbound.
      true,
    );
    return { note, kind, ...dispatched };
  }

  const intakeFollowUp = (note: Note, display: string) => (skill: string): IngestFollowUp => ({
    skill,
    prompt: buildKickoff({
      skill,
      target: note.path,
      instruction:
        'read the capture, search the memory it might touch, and extract what needs to happen or to be linked, as approval cards. Ask me if something is unclear.',
    }),
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
      processing: 'new',
      source: { system: 'web', url },
      captured: date,
    };
    const note = await ctx.vault.writeNote(path, frontmatter, input.text.trim());
    ctx.index.reindex(note);
    await ctx.git.commitPaths([note.path], `source: ${summary}`);
    const dispatched = pipelineFollowUp(intakeFollowUp(note, summary), input.process ?? true);
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
      processing: 'new',
      source: { system: 'screenshot' },
      captured: date,
    };
    const note = await ctx.vault.writeNote(path, frontmatter, body);
    ctx.index.reindex(note);
    await ctx.git.commitPaths([note.path, assetPath], `source: ${summary}`);
    const dispatched = pipelineFollowUp(intakeFollowUp(note, summary), input.process ?? true);
    return { note, kind, ...dispatched };
  }

  /**
   * Ingest is ARRIVAL, and arrival never authors. Everything that comes through
   * this door is raw material in `sources/` — a dropped file, a pasted thread,
   * a link, a screenshot. `notes/` is the authored layer and is reachable only
   * by writing one (`captureNote`, ⌘N): the workspace must never claim to have
   * written something that was handed to it, because once the memory starts
   * citing that claim it cannot be corrected.
   */
  const note = await captureDocument(ctx, {
    title,
    body: input.text,
    ...(input.fileName ? { fileName: input.fileName } : {}),
  });
  const dispatched = pipelineFollowUp(intakeFollowUp(note, title), input.process ?? true);
  return { note, kind: 'note', ...dispatched };
}

/** Save an edit to an authored/derived note body (immutable-body types reject). */
export async function saveAuthoredNote(ctx: UseCaseContext, path: string, body: string): Promise<Note> {
  const existing = await ctx.vault.readNote(path);
  if (!existing) throw new Error(`note not found: ${path}`);
  if (!isBodyEditable(existing.type)) {
    throw new Error(`this note type has an immutable body: ${path}`);
  }
  // Body-only edit: splice under the raw frontmatter block. Writing
  // `existing.frontmatter` here would persist the coerced fallback for notes
  // whose frontmatter failed validation, erasing the user's real fields.
  const note = await ctx.vault.writeBody(path, body);
  ctx.index.reindex(note);
  await ctx.git.commitPaths([note.path], `edit: ${note.slug}`);
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
