import { sep } from 'node:path';

/**
 * The one place a filesystem path becomes a vault path.
 *
 * **The invariant: a vault-relative path is ALWAYS posix, with `/`, on every
 * platform.** It is not a filesystem path that happens to be relative, it is the
 * app's note id. It is what the sqlite index keys rows by, what a wikilink
 * targets, what a proposal card carries, what `git show <hash>:<path>` is handed,
 * and what every writer in the app builds by hand with slashes
 * (`runnableEntryPath`, the event mirror, `listDir`, the session file tools).
 * Every reader takes it apart the same way: `slugFromPath`, `isFolderIndex`,
 * `isReservedFile` and the type-from-folder inference in `FsVault` all split on
 * `/` and nothing else.
 *
 * `relative()` from `node:path` does not honour that. On Windows it hands back
 * `meetings\weekly.md`, and every one of those readers then sees a single
 * path segment: the type inferred from the top folder comes back null so every
 * note is a plain `note`, `isFolderIndex` never matches a folder hub, and the
 * index keys a row that no write will ever line up with, so the same file is
 * indexed twice under two spellings. None of that fails loudly. It just makes
 * the app quietly wrong.
 *
 * So the two places where a path enters from the filesystem (the walk that feeds
 * the index, and the watcher events that keep it current) normalize here, at the
 * boundary, rather than every call site defending itself.
 *
 * It splits on `sep` rather than replacing every backslash, and that difference
 * is load-bearing: on macOS and Linux a backslash is a perfectly legal character
 * in a filename, so a blanket replace would turn somebody's `notes/a\b.md` into a
 * folder that does not exist and lose the file. On posix `sep` is `/`, so this is
 * a no-op there and the backslash survives; on Windows a filename cannot contain
 * either separator, so there is nothing to lose.
 *
 * The separator is a parameter, defaulting to this platform's, purely so the
 * Windows behaviour can be asserted from a Mac. That is not a detail worth
 * hiding: nobody here develops on Windows, so the only test that could catch a
 * regression is one that passes `\` deliberately, and a function whose whole job
 * depends on a global is a function nobody can check.
 */
export function toPosixPath(osRelPath: string, separator: string = sep): string {
  return osRelPath.split(separator).join('/');
}
