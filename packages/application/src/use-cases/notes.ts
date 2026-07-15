import {
  isBodyEditable,
  normalizeLinkTarget,
  dirForType,
  fileSlug,
  type Frontmatter,
  type MeetingFrontmatter,
  type NoteFrontmatter,
  type Note,
  type ProblemStance,
  type SourceRef,
} from '@pm/domain';
import type { BacklinkRow, IndexedNote, UseCaseContext } from '../ports.js';

export async function getNote(ctx: UseCaseContext, path: string): Promise<Note | null> {
  return ctx.vault.readNote(path);
}

/** Find a free path near `desired`, appending -2, -3 … to avoid clobbering. */
async function freePath(ctx: UseCaseContext, desired: string): Promise<string> {
  let path = desired;
  let n = 2;
  while (await ctx.vault.exists(path)) {
    path = desired.replace(/\.md$/, `-${n}.md`);
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
  const frontmatter: NoteFrontmatter = { type: 'note', summary, sources: [] };
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
  safeSpace?: boolean;
}

/**
 * Drop/paste a transcript → meetings/…md. The transcript is the meeting's raw,
 * immutable body; an After-Meeting session (Phase 3) reads it and proposes the
 * truth delta. Provenance (date/participants/source) is immutable thereafter.
 */
export async function captureMeeting(ctx: UseCaseContext, input: CaptureMeetingInput): Promise<Note> {
  const now = ctx.clock.now();
  const date = now.slice(0, 10);
  const summary = input.title.slice(0, 200) || 'meeting';
  const desired = `${dirForType('meeting')}/${fileSlug(summary, date)}.md`;
  const path = await freePath(ctx, desired);
  const frontmatter: MeetingFrontmatter = {
    type: 'meeting',
    summary,
    date,
    ...(input.participants ? { participants: input.participants } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(input.safeSpace ? { safe_space: true } : {}),
  };
  const body = `## Transcript\n\n${input.body.trim()}\n`;
  const note = await ctx.vault.writeNote(path, frontmatter, body);
  ctx.index.reindex(note);
  await ctx.git.commitPaths([note.path], `meeting: ${summary}`);
  return note;
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
