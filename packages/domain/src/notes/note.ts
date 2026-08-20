import { layerForType, type Frontmatter, type NoteLayer, type NoteType } from './frontmatter.js';
import { slugFromPath, titleFromSlug } from './slug.js';

/**
 * A file whose frontmatter did not fit the type it claims (FH-1).
 *
 * The note is still read — nothing is ever dropped — but it is read as a plain
 * `note`, which is a real loss: it leaves `meetings/`, its date and participants
 * stop meaning anything, and the only sign is a line in a log. So the reading
 * layer records what it could not honour, and the librarian's scan turns that
 * into ordinary repair work.
 */
export interface SchemaMiss {
  /** The type the file declares (or its folder implies) and does not validate as. */
  type: NoteType;
  /** The schema's own message, field path included. */
  error: string;
}

/**
 * A Note entity: validated frontmatter + raw markdown body + its vault location.
 * This is the domain object; it is mapped to a NoteDTO at the IPC boundary.
 */
export interface Note {
  path: string;
  slug: string;
  type: NoteType;
  layer: NoteLayer;
  frontmatter: Frontmatter;
  body: string;
  mtime: number;
  /** Set only when the file failed its own type's schema — see {@link SchemaMiss}. */
  schemaMiss?: SchemaMiss;
}

export interface WikiLink {
  /** Raw target slug (already normalized, alias/anchor stripped). */
  target: string;
  anchor?: string;
  alias?: string;
  /** 1-based line number in the body where the link appears, if known. */
  line?: number;
}

export function makeNote(args: {
  path: string;
  frontmatter: Frontmatter;
  body: string;
  mtime: number;
  schemaMiss?: SchemaMiss;
}): Note {
  const slug = slugFromPath(args.path);
  return {
    path: args.path,
    slug,
    type: args.frontmatter.type,
    layer: layerForType(args.frontmatter.type),
    frontmatter: args.frontmatter,
    body: args.body,
    mtime: args.mtime,
    ...(args.schemaMiss ? { schemaMiss: args.schemaMiss } : {}),
  };
}

/**
 * The `type` a frontmatter write should put back on the file.
 *
 * Normally the one it is being given. The exception is a note we had to demote
 * (see {@link SchemaMiss}): it is in memory as a plain `note`, so writing that
 * back would make our READING permanent and replace the file's own
 * `type: meeting` for good — a recoverable file turned into a mistyped one by
 * the repair that was meant to save it. The file's word wins, unless the write
 * deliberately says some third thing, which is a real retype.
 */
export function typeToWrite(note: Note, nextType: unknown): NoteType {
  const declared = note.schemaMiss?.type;
  if (!declared) return note.frontmatter.type;
  return nextType === undefined || nextType === note.type ? declared : (nextType as NoteType);
}

/** The display title: an explicit frontmatter `title`, else derived from slug. */
export function noteTitle(note: Note): string {
  const fmTitle = (note.frontmatter as Record<string, unknown>)['title'];
  if (typeof fmTitle === 'string' && fmTitle.trim()) return fmTitle;
  return titleFromSlug(note.slug);
}
