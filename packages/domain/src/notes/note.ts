import { layerForType, type Frontmatter, type NoteLayer, type NoteType } from './frontmatter.js';
import { slugFromPath, titleFromSlug } from './slug.js';

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
  };
}

/** The display title: an explicit frontmatter `title`, else derived from slug. */
export function noteTitle(note: Note): string {
  const fmTitle = (note.frontmatter as Record<string, unknown>)['title'];
  if (typeof fmTitle === 'string' && fmTitle.trim()) return fmTitle;
  return titleFromSlug(note.slug);
}
