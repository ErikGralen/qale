import { windowsSafeName } from '@qale/domain';

/**
 * What a dropped file is called once it is inside a session's folder.
 *
 * Its own module rather than a closure in `handlers.ts` because it is the third
 * place in the app where a filename is MINTED (the other two are `slugify` and
 * `fileSlug`), it is pure, and the rules it enforces are exactly the ones that
 * only fail on somebody else's machine. A function that can only be exercised by
 * launching Electron and dragging a file onto the window is a function whose
 * edge cases are never checked.
 */

/**
 * The longest a dropped file's name may be once it is inside the session folder.
 *
 * Not a taste call: it is the last term in the Windows path budget (see
 * `VAULT_PATH_BUDGET` in @qale/application's vault use-case, which names this
 * cap). `sessions/.files/<uuid>/material/` is already 62 characters before the
 * name, so an unbounded name is what would put a workspace over MAX_PATH no
 * matter how sensibly the PM chose their folder. 72 still holds every real
 * filename: "2026-08-12 Nordkap QBR transcript part 2.vtt" is 45.
 */
export const MATERIAL_NAME_CAP = 72;

/**
 * A file name safe to write inside the session folder, and unique within it.
 * The original name is worth keeping — it is often the only date and title the
 * material carries — so this only takes out what a path cannot hold.
 *
 * The extension is cut off and put back rather than trimmed away with the rest
 * of the name, because it is not decoration: `files_read` decides whether it is
 * looking at an image or at text by the extension, and the filing tool hands the
 * agent these paths by name. A long name that lost its `.png` on the way in would
 * arrive as unreadable bytes.
 *
 * {@link windowsSafeName} has the last word, so a file called `CON.txt`, or one
 * whose name ends in a dot or a space (all three legal on macOS, none of them
 * writable on Windows), lands under a name the filesystem will actually keep.
 *
 * `taken` is the set of names already used in this drop, lowercased: Windows and
 * macOS both compare filenames case-insensitively, so `Notes.txt` and `notes.txt`
 * are one file there and two pieces of material would silently become one.
 */
export function materialName(raw: string, taken: Set<string>): string {
  const cleaned = (raw.split(/[\\/]/).pop() ?? 'material').replace(/[^\p{L}\p{N}._ -]+/gu, '-');
  const dot = cleaned.lastIndexOf('.');
  const ext = dot > 0 && cleaned.length - dot <= 6 ? cleaned.slice(dot) : '';
  const stem = ext ? cleaned.slice(0, dot) : cleaned;
  const base = windowsSafeName(stem.slice(0, MATERIAL_NAME_CAP - ext.length) + ext);
  let name = base || 'material';
  let n = 2;
  while (taken.has(name.toLowerCase())) {
    name = base.replace(/(\.[a-z0-9]+)$|$/i, `-${n}$1`);
    n++;
  }
  taken.add(name.toLowerCase());
  return name;
}
