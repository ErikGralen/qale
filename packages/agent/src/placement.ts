import { dirForType, NOTE_TYPES, type NoteType } from '@qale/domain';

/**
 * Where a note the agent writes may go (docs/memory-types.md, MT-6).
 *
 * The agent creates no folders. Every write goes to one of the known top-level
 * folders, one level deep: `<dir>/<name>.md`, where `dir` is the folder the
 * note's type owns. The one exception is the PM's own Documents: a folder under
 * `notes/` that the PM already made is theirs, and a page they asked for may go
 * into it. The check sits where the write happens, so a session cannot leave
 * `research/competitors/acme.md` behind and a folder nobody made with it.
 *
 * `knownFolder` says whether a folder under `notes/` exists. Without it, only
 * the top level of `notes/` is open.
 *
 * Returns the refusal, or null when the path is fine.
 */
export function placementError(
  path: string,
  type: string | undefined,
  knownFolder?: (dir: string) => boolean,
): string | null {
  const parts = path.split('/');
  const name = parts[parts.length - 1] ?? '';
  const wellFormed = parts.every((p) => p.length > 0) && name.toLowerCase().endsWith('.md');
  const known = isNoteType(type) ? type : null;
  const dir = known ? dirForType(known) : null;

  if (known === 'note' && dir) {
    // The PM's folder. Their subfolders are open; a subfolder nobody made is not.
    const folder = parts.slice(0, -1).join('/');
    const inside = parts.length >= 2 && parts[0] === dir;
    const ok =
      wellFormed && inside && (parts.length === 2 || (knownFolder?.(folder) ?? false));
    if (ok) return null;
    return (
      `Rejected: a document lives in ${dir}/, or in a folder the PM already made under it, so the ` +
      `path has to be ${dir}/<name>.md or ${dir}/<their folder>/<name>.md, not "${path}". ` +
      'Qale makes no folders.'
    );
  }

  if (dir) {
    if (wellFormed && parts.length === 2 && parts[0] === dir) return null;
    return (
      `Rejected: ${article(known!)} ${known} page lives in ${dir}/, one level deep, so the path ` +
      `has to be ${dir}/<name>.md, not "${path}". Qale makes no folders.`
    );
  }

  if (wellFormed && parts.length === 2) return null;
  return (
    'Rejected: a note lives one level deep, <folder>/<name>.md, in the folder its type owns, ' +
    `not "${path}". Qale makes no folders.`
  );
}

function isNoteType(type: unknown): type is NoteType {
  return typeof type === 'string' && (NOTE_TYPES as readonly string[]).includes(type);
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}
