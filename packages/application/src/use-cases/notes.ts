import {
  draftSignal,
  isBodyEditable,
  normalizeLinkTarget,
  type Note,
  type SourceRef,
  type ThemeStance,
} from '@pm/domain';
import type { BacklinkRow, IndexedNote, UseCaseContext } from '../ports.js';

export async function getNote(ctx: UseCaseContext, path: string): Promise<Note | null> {
  return ctx.vault.readNote(path);
}

export interface CaptureSignalInput {
  body: string;
  summary?: string;
  source?: SourceRef;
}

/** ⌘N quick capture → signals/…md (status new), indexed + committed. */
export async function captureSignal(
  ctx: UseCaseContext,
  input: CaptureSignalInput,
): Promise<Note> {
  const draft = draftSignal({
    body: input.body,
    summary: input.summary,
    source: input.source,
    now: ctx.clock.now(),
  });

  // Avoid clobbering an existing capture from the same day/summary.
  let path = draft.path;
  let n = 2;
  while (await ctx.vault.exists(path)) {
    path = draft.path.replace(/\.md$/, `-${n}.md`);
    n++;
  }

  const note = await ctx.vault.writeNote(path, draft.frontmatter, draft.body);
  ctx.index.reindex(note);
  await ctx.git.commitPaths([note.path], `capture: ${draft.frontmatter.summary}`);
  return note;
}

/** Save an edit to an authored/derived note body (raw bodies are immutable). */
export async function saveAuthoredNote(
  ctx: UseCaseContext,
  path: string,
  body: string,
): Promise<Note> {
  const existing = await ctx.vault.readNote(path);
  if (!existing) throw new Error(`note not found: ${path}`);
  if (!isBodyEditable(existing.type)) {
    throw new Error(`raw note bodies are immutable: ${path}`);
  }
  const note = await ctx.vault.writeNote(path, existing.frontmatter, body);
  ctx.index.reindex(note);
  await ctx.git.commitPaths([note.path], `edit: ${note.slug}`);
  return note;
}

/** Change a theme's stance (authored field). */
export async function setThemeStance(
  ctx: UseCaseContext,
  path: string,
  stance: ThemeStance,
): Promise<Note> {
  const existing = await ctx.vault.readNote(path);
  if (!existing || existing.type !== 'theme') {
    throw new Error(`not a theme: ${path}`);
  }
  const frontmatter = { ...existing.frontmatter, stance };
  const note = await ctx.vault.writeNote(path, frontmatter, existing.body);
  ctx.index.reindex(note);
  await ctx.git.commitPaths([note.path], `stance: ${note.slug} → ${stance}`);
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
