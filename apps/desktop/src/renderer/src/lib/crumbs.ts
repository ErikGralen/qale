import { dirForType, isMirrorType, noteTypeLabel, typeForDir } from '@qale/domain';
import type { NoteType } from '@qale/ipc';
import { providerLabelOf } from './connections';
import { surfaceForType } from './nav';
import { mirrorFolder } from './providers';

/**
 * Where a location crumb goes when you click it. One shape per surface, so the
 * page that draws the crumb only has to hand each target to the right `open…`
 * call (docs/sidebar-ia.md, SB-4).
 */
export type CrumbTarget =
  { kind: 'documents'; folder: string } | { kind: 'calendar' } | { kind: 'folder'; dir: string };

/** One segment of the location line: what it says, and where it goes. A
 *  segment with no target names an ancestor without opening it. */
export interface LocationCrumb {
  label: string;
  target?: CrumbTarget;
}

const NOTES_DIR = dirForType('note');

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * The shelf's own name: the plural of the type's label, which is exactly what
 * the Memory page prints on the shelf row. `person` is the one irregular
 * plural, and `note` reads "Documents" because its label is "Document".
 *
 * A mirror type keeps its folder's name. One page is a "Jira mirror", but the
 * folder holds every system's, so naming one of them there would be a lie.
 */
function shelfLabelForType(type: NoteType): string {
  if (type === 'person') return 'People';
  if (isMirrorType(type)) return capitalize(dirForType(type));
  return `${noteTypeLabel(type)}s`;
}

/**
 * What a folder is called on screen. The type owns the name, so a folder reads
 * the same word here, on the Memory shelf and on the page inside it. A folder
 * no type claims keeps its own name, capitalized.
 */
export function shelfLabel(dir: string): string {
  const [head = '', ...rest] = dir.split('/');
  const type = typeForDir(head);
  return [type ? shelfLabelForType(type) : capitalize(head), ...rest].join('/');
}

/**
 * The Documents folder a `folder:` tab is really asking for, or null when the
 * dir is not documents. `notes` is the root (''), `notes/specs` is `specs`.
 */
export function documentsFolder(dir: string): string | null {
  if (dir === NOTES_DIR) return '';
  if (dir.startsWith(`${NOTES_DIR}/`)) return dir.slice(NOTES_DIR.length + 1);
  return null;
}

/**
 * The location line for a page, in the words the rail uses. A document reads
 * "Documents › <folder>", a meeting reads "Calendar", everything else reads its
 * shelf. The type decides the surface (`surfaceForType`), so a page is only
 * ever offered one home.
 *
 * A document is one that lives under `notes/`, so the path has the last word:
 * `understanding/` files carry `type: note` and are not documents.
 *
 * Empty for a file at the workspace root: there is nothing above it to name.
 */
export function locationCrumbs(path: string, type?: NoteType | null): LocationCrumb[] {
  const slash = path.lastIndexOf('/');
  if (slash < 0) return [];
  const dir = path.slice(0, slash);
  const parts = dir.split('/');
  const resolved = type ?? typeForDir(parts[0] ?? '');
  const surface = resolved ? surfaceForType(resolved) : null;
  const folder = documentsFolder(dir);
  if (surface === 'documents' && folder !== null) {
    const sub = folder ? folder.split('/') : [];
    return [
      { label: 'Documents', target: { kind: 'documents', folder: '' } },
      ...sub.map((part, i) => ({
        label: part,
        target: { kind: 'documents', folder: sub.slice(0, i + 1).join('/') } as CrumbTarget,
      })),
    ];
  }
  if (surface === 'calendar') return [{ label: 'Calendar', target: { kind: 'calendar' } }];
  // A mirror belongs to the system it came from, not to Memory. The system
  // leads and opens its own folder, the rail row's folder; the kind after it
  // only says what that folder holds, so it is text (docs/memory-placement.md).
  if (surface === 'synced') {
    const kindLabel = resolved === 'wikipage' ? 'Pages' : 'Tickets';
    const folder = mirrorFolder(dir);
    // A flat mirror, written before PD-10, names no system. The kind alone is
    // all there is to say, and the folder it opens holds every system's.
    if (!folder) return [{ label: kindLabel, target: { kind: 'folder', dir } }];
    return [
      { label: providerLabelOf(folder.providerId), target: { kind: 'folder', dir } },
      { label: kindLabel },
    ];
  }
  return [{ label: shelfLabel(dir), target: { kind: 'folder', dir } }];
}
