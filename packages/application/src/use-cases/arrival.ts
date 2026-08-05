import {
  addTranscriptRef,
  refToSlug,
  titleFromSlug,
  transcriptRefs,
  type Frontmatter,
  type Note,
} from '@qale/domain';
import type { UseCaseContext } from '../ports.js';
import {
  attachTranscriptToMeeting,
  captureDocument,
  captureExternalTranscript,
  captureMeeting,
  captureScreenshot,
  deleteNote,
  renameNote,
  resolveLink,
  type MeetingTranscriptPart,
} from './notes.js';

/**
 * Arrival (docs/arrival-agentic.md) — filing, done by the agent.
 *
 * The old pipeline decided what a dropped file was and where it went before
 * anything had read it: a clock window guessing which meeting a transcript
 * belonged to, a 21-day rule switching reviews off, a regex deciding two files
 * were one recording. Every one of those rules answered "what is this?" without
 * looking, and every edge of every rule was a bug.
 *
 * So the rules are gone and the judgment moved. Material lands in the session
 * folder as bytes, and the agent reads it, decides, and calls the two functions
 * here: {@link fileMaterial} to put it where it belongs, {@link refileMaterial}
 * to move it when that turns out to be wrong. Both are ordinary vault writes,
 * not approval cards, and the reason is the same one that makes them safe: the
 * PM handed the file over, so filing it carries out an instruction rather than
 * proposing one, and a wrong shelf is fixed by moving it. Everything DERIVED
 * from the material is still a card.
 */

/** One file of material, already read out of the session folder. */
export interface ArrivalPart {
  /** The file name it arrived as — provenance, and the label on a split recording. */
  name: string;
  /** Text content. Absent for an image. */
  text?: string;
  /** Image bytes; presence makes this a screenshot. */
  image?: Uint8Array;
  /** "part 2" — set only where this is one piece of a recording that split. */
  label?: string;
}

export interface FileMaterialInput {
  /**
   * The files that make up ONE thing. More than one means a recording delivered
   * in pieces: one meeting, one source note per piece, never several meetings.
   */
  parts: ArrivalPart[];
  /**
   * `meeting` is a meeting the PM was in and gets a page of its own in
   * `meetings/`. Everything else is `source`: a colleague's call, an article, a
   * spec, a screenshot. Nothing arriving ever reaches `notes/`, which means "the
   * PM wrote this".
   */
  as: 'meeting' | 'source';
  title: string;
  /** The day the material is about (YYYY-MM-DD), where the material says so. */
  date?: string;
  /** Attach to this already-synced meeting rather than minting a second one. */
  attachTo?: string;
  /** Whose meeting it was, on a transcript the PM was not in. */
  origin?: string;
  /** Screenshot only: what the picture shows, which is the note's whole body. */
  caption?: string;
}

export interface FileMaterialResult {
  /** The page this became: the meeting, or the first source. */
  path: string;
  /** Every note this call created, so the agent can cite them straight away. */
  wrote: string[];
}

/**
 * File one thing. Everything about WHAT it is has already been decided by the
 * agent that read it; this only carries that decision out.
 */
export async function fileMaterial(
  ctx: UseCaseContext,
  input: FileMaterialInput,
): Promise<FileMaterialResult> {
  const parts = input.parts;
  if (parts.length === 0) throw new Error('nothing to file: no files were named');
  const title = input.title.trim();
  if (!title) throw new Error('file_material needs a title — it is what the page is called');

  if (input.as === 'meeting') {
    const image = parts.find((p) => p.image);
    if (image) {
      throw new Error(
        `“${image.name}” is an image, and an image is never a meeting. File it as a source with a caption.`,
      );
    }
    const body: MeetingTranscriptPart[] = parts.map((p) => ({
      body: p.text ?? '',
      ...(parts.length > 1 ? { label: p.label ?? `part ${parts.indexOf(p) + 1}` } : {}),
    }));
    // What the meeting held BEFORE, so the report names the transcripts this
    // call wrote rather than every one the page has ever collected.
    const before = input.attachTo
      ? transcriptRefs((await ctx.vault.readNote(input.attachTo))?.frontmatter ?? {})
      : [];
    const note = input.attachTo
      ? await attachTranscriptToMeeting(ctx, { meetingPath: input.attachTo, body })
      : await captureMeeting(ctx, { title, body, ...(input.date ? { date: input.date } : {}) });
    const added = transcriptRefs(note.frontmatter)
      .filter((r) => !before.includes(r))
      .flatMap((r) => refPath(ctx, r) ?? []);
    return { path: note.path, wrote: [note.path, ...added] };
  }

  // A source that arrived in several files is several sources: nothing in
  // `sources/` owns anything else, so there is no page to gather them under and
  // splicing them into one body would be a claim about how they fit together.
  const wrote: string[] = [];
  for (const [i, part] of parts.entries()) {
    const name = parts.length > 1 ? `${title} (${part.label ?? `part ${i + 1}`})` : title;
    if (part.image) {
      const note = await captureScreenshot(ctx, {
        title: name,
        caption: input.caption?.trim() || name,
        image: { name: part.name, data: part.image },
      });
      wrote.push(note.path);
      continue;
    }
    const note = input.origin
      ? await captureExternalTranscript(ctx, { title: name, body: part.text ?? '', origin: input.origin })
      : await captureDocument(ctx, { title: name, body: part.text ?? '', fileName: part.name });
    wrote.push(note.path);
  }
  return { path: wrote[0]!, wrote };
}

export interface RefileMaterialInput {
  /** The page that was filed wrong: a meeting, or a source. */
  path: string;
  /**
   * The meeting this material actually belongs to, as a note path. The literal
   * string `none` means it belongs to no meeting of the PM's at all, which is
   * how "that was Kranelund's call" is said.
   */
  meeting?: string;
  /** Whose meeting it was — only with `meeting: none`, on a transcript. */
  origin?: string;
  /** A better name for the page, when the first one missed. */
  title?: string;
}

export interface RefileMaterialResult {
  /** Where the material lives now. */
  path: string;
  /** Transcripts that changed hands. */
  moved: string[];
  /** A meeting page this emptied and removed, if any. */
  removed?: string;
}

/**
 * The scaffold `captureMeeting` writes, and nothing else. A meeting page that
 * still says only this is a container, so moving its transcripts elsewhere
 * leaves nothing behind worth keeping. One that carries a prep section, notes
 * or a summary is somebody's work and is never deleted from under them.
 */
function meetingIsEmpty(body: string): boolean {
  const stripped = body
    .replace(/^##\s+(Notes|Summary)\s*$/gim, '')
    // The italic placeholder under `## Summary`. Matched by its shape rather
    // than its words: the sentence is product copy and has been rewritten once
    // already, and a stale match here would refuse every honest refile.
    .replace(/^_[^_\n]*_$/gim, '')
    .trim();
  return stripped.length === 0;
}

/**
 * The note a `transcript` ref points at. The field holds whole wikilinks
 * (`[[sources/…]]`), so the brackets come off before anything tries to resolve
 * one — a ref that silently fails to resolve reads as "this meeting has no
 * transcript", which is the one wrong answer that loses evidence.
 */
function refPath(ctx: UseCaseContext, ref: string): string | null {
  const slug = refToSlug(ref);
  return slug ? resolveLink(ctx, slug) : null;
}

/** The source notes a meeting's `transcript` refs point at, in order. */
function transcriptPaths(ctx: UseCaseContext, note: Note): string[] {
  return transcriptRefs(note.frontmatter).flatMap((ref) => refPath(ctx, ref) ?? []);
}

/** Take one transcript ref off a meeting, leaving the rest of it alone. */
async function unlinkTranscript(ctx: UseCaseContext, meetingPath: string, ref: string): Promise<void> {
  const meeting = await ctx.vault.readNote(meetingPath);
  if (!meeting) return;
  const rest = transcriptRefs(meeting.frontmatter).filter((r) => r !== ref);
  const next = { ...meeting.frontmatter } as Record<string, unknown>;
  if (rest.length === 0) delete next['transcript'];
  else next['transcript'] = rest.length === 1 ? rest[0]! : rest;
  const written = await ctx.vault.writeNote(meetingPath, next as Frontmatter, meeting.body);
  ctx.index.reindex(written);
}

/** Write one frontmatter field onto a note, leaving body and everything else. */
async function setField(ctx: UseCaseContext, path: string, key: string, value: string): Promise<string> {
  const note = await ctx.vault.readNote(path);
  if (!note) throw new Error(`there is no note called “${titleFromSlug(path)}”`);
  const next = { ...note.frontmatter, [key]: value } as Frontmatter;
  const written = await ctx.vault.writeNote(path, next, note.body);
  ctx.index.reindex(written);
  return written.path;
}

/**
 * Correct a filing. Three moves, which are the three ways the agent can get it
 * wrong: this belongs to a different meeting, this was never the PM's meeting
 * at all, and this is called the wrong thing.
 *
 * Deliberately not an undo. Nothing is restored to a previous state; the
 * material is moved to where it should have gone, and git holds the trail.
 */
export async function refileMaterial(
  ctx: UseCaseContext,
  input: RefileMaterialInput,
): Promise<RefileMaterialResult> {
  const note = await ctx.vault.readNote(input.path);
  if (!note) throw new Error(`there is no note called “${titleFromSlug(input.path)}”`);
  const target = input.meeting?.trim();
  const toNothing = target === 'none';
  const moved: string[] = [];
  let path = note.path;
  let removed: string | undefined;

  if (target && !toNothing) {
    const meeting = await ctx.vault.readNote(target);
    if (!meeting || meeting.type !== 'meeting') {
      throw new Error(`“${titleFromSlug(target)}” is not a meeting page, so nothing can be attached to it`);
    }
  }

  if (note.type === 'meeting') {
    if (!target) {
      if (!input.title) {
        throw new Error(
          'refile_material on a meeting needs a `meeting` (the one it really belongs to, or "none") or a `title`.',
        );
      }
    } else {
      const sources = transcriptPaths(ctx, note);
      if (sources.length === 0) {
        throw new Error(`“${titleFromSlug(note.slug)}” holds no transcript, so there is nothing to move off it`);
      }
      if (!meetingIsEmpty(note.body)) {
        throw new Error(
          `“${titleFromSlug(note.slug)}” has notes or a summary written on it. Move the transcripts one at a time (refile the source pages) so nothing written here is lost.`,
        );
      }
      for (const source of sources) {
        if (toNothing) {
          if (input.origin) await setField(ctx, source, 'origin', input.origin);
        } else {
          await attachExistingTranscript(ctx, target!, source);
        }
        moved.push(source);
      }
      await deleteNote(ctx, note.path);
      removed = note.path;
      path = toNothing ? sources[0]! : target!;
    }
  } else {
    // A source page: a transcript that ended up under the wrong meeting, or one
    // that was never the PM's meeting.
    const holder = meetingHolding(ctx, note);
    if (target && !toNothing) {
      if (holder) await unlinkTranscript(ctx, holder.path, `[[${note.slug}]]`);
      await attachExistingTranscript(ctx, target, note.path);
      moved.push(note.path);
      // The page that OWNS the material now, which is what the agent should
      // cite from here on. The transcript itself never moves: it is evidence,
      // and evidence keeps its address.
      path = target;
      if (holder) {
        const after = await ctx.vault.readNote(holder.path);
        if (after && transcriptRefs(after.frontmatter).length === 0 && meetingIsEmpty(after.body)) {
          await deleteNote(ctx, holder.path);
          removed = holder.path;
        }
      }
    } else if (toNothing) {
      if (holder) {
        await unlinkTranscript(ctx, holder.path, `[[${note.slug}]]`);
        moved.push(note.path);
        const after = await ctx.vault.readNote(holder.path);
        if (after && transcriptRefs(after.frontmatter).length === 0 && meetingIsEmpty(after.body)) {
          await deleteNote(ctx, holder.path);
          removed = holder.path;
        }
      }
      if (input.origin) await setField(ctx, note.path, 'origin', input.origin);
    }
  }

  // A title renames the page the PM NAMED, not whatever the move ended up
  // pointing at: asking for a better name on a transcript must not retitle the
  // meeting it was just attached to. Falls through to `path` only when the page
  // they named is the one this call deleted.
  if (input.title?.trim()) {
    const subject = (await ctx.vault.readNote(input.path)) ? input.path : path;
    const renamed = await renameNote(ctx, { path: subject, title: input.title.trim() });
    if (subject === path) path = renamed.path;
  }

  const touched = [path, ...moved, ...(removed ? [removed] : [])];
  await ctx.git.commitPaths(touched, `refile: ${titleFromSlug(path)}`);
  return { path, moved, ...(removed ? { removed } : {}) };
}

/** The meeting whose `transcript` list currently holds this source, if any. */
function meetingHolding(ctx: UseCaseContext, source: Note): { path: string } | null {
  for (const row of ctx.index.backlinks(source.slug)) {
    const from = ctx.index.get(row.fromPath);
    if (from?.type === 'meeting' && transcriptRefs(from.frontmatter).includes(`[[${source.slug}]]`)) {
      return { path: from.path };
    }
  }
  return null;
}

/**
 * Link a source note that ALREADY exists onto a meeting. Unlike
 * `attachTranscriptToMeeting`, which writes the transcript as it attaches, this
 * only moves the pointer — the evidence is on disk and must not be copied.
 */
async function attachExistingTranscript(
  ctx: UseCaseContext,
  meetingPath: string,
  sourcePath: string,
): Promise<void> {
  const meeting = await ctx.vault.readNote(meetingPath);
  const source = await ctx.vault.readNote(sourcePath);
  if (!meeting || !source) throw new Error('the meeting or the transcript is gone');
  const next = {
    ...meeting.frontmatter,
    transcript: addTranscriptRef(meeting.frontmatter, `[[${source.slug}]]`),
    processing: 'new',
  } as Frontmatter;
  const written = await ctx.vault.writeNote(meetingPath, next, meeting.body);
  ctx.index.reindex(written);
}
