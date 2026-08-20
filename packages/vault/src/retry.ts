/**
 * The Windows "someone else has this file open" retry.
 *
 * On macOS and Linux a rename, a delete or an overwrite of a file another
 * process is reading simply succeeds: the other process keeps its open handle on
 * the old inode and nobody is disturbed. Windows does not work that way. A file
 * opened without `FILE_SHARE_DELETE` (which is the default for most programs)
 * cannot be renamed, deleted or replaced while that handle is open, and the call
 * fails immediately with `EPERM` or `EBUSY`.
 *
 * That is not a rare condition on a vault. The folder is markdown that other
 * software is meant to touch: OneDrive or Dropbox uploading the file we just
 * wrote, an editor the PM has the same note open in, the Windows Search indexer,
 * and above all antivirus, which opens every newly written file to scan it and
 * holds it for a few tens of milliseconds. Every one of those windows is short.
 * Which is exactly why a retry is the right answer: the operation is not
 * refused, it is early.
 *
 * So: retry a handful of times over roughly a fifth of a second, then give up
 * and throw the original error. Deliberately NOT a longer or unbounded wait. If
 * the file is held open for good (the PM has it open in Word, the folder is on a
 * network share that went away), no amount of waiting fixes it, and an app that
 * hangs on a save is worse than one that says it could not save.
 */

/**
 * The two errno values a locked file produces. Nothing else is retried.
 *
 * `EACCES` is deliberately absent even though Windows does sometimes report a
 * sharing violation that way, because it is also what a genuinely
 * unwritable file, a read-only folder and a permission problem look like, and
 * retrying those three times only makes a certain failure slower to report.
 * `ENOENT`, `ENOSPC` and the rest are facts about the world that a second
 * attempt cannot change either.
 */
const LOCKED_CODES = new Set(['EPERM', 'EBUSY']);

/** Waits between attempts, in milliseconds. Four attempts, ~220ms of patience in all. */
const BACKOFF_MS = [20, 60, 140];

function codeOf(err: unknown): string | null {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
}

const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/**
 * Run a filesystem write and retry it briefly while the file is locked.
 *
 * Real errors are never swallowed: anything that is not `EPERM`/`EBUSY` throws on
 * the first attempt, and a lock that outlasts the backoff throws the last error
 * as it was, so the caller (and the toast the user reads) sees the real cause
 * rather than a message we invented.
 *
 * Applied on every platform rather than behind a `win32` check. macOS produces
 * these two codes far less often but it does produce them (a file a cloud client
 * is materialising, an `flock` held by another tool, a mount going away
 * mid-write), and the only cost on the platform where it never happens is that
 * an operation which was going to fail anyway takes a fifth of a second longer
 * to say so. A platform branch here would also mean the retry path is dead code
 * on every machine this is developed and tested on, which is how a retry that
 * does not actually work ships.
 *
 * `sleep` is injectable purely so the tests can prove the backoff without
 * spending real time in it.
 */
export async function retryWhileLocked<T>(
  operation: () => Promise<T>,
  sleep: (ms: number) => Promise<void> = wait,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (err) {
      const delay = BACKOFF_MS[attempt];
      if (delay === undefined || !LOCKED_CODES.has(codeOf(err) ?? '')) throw err;
      await sleep(delay);
    }
  }
}
