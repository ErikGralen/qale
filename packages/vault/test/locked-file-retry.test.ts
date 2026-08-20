import assert from 'node:assert/strict';
import test from 'node:test';
import { retryWhileLocked } from '../src/retry.js';

/**
 * The Windows "another process has this file open" retry, tested directly with
 * the errno values Windows produces. Nothing here fakes a platform: the helper
 * has no platform in it, and the two codes are the whole of its logic.
 *
 * The sleep is injected in every case so the suite spends no real time waiting.
 */

function errno(code: string): NodeJS.ErrnoException {
  const err = new Error(`${code}: operation not permitted`) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

const noSleep = async (): Promise<void> => undefined;

test('a lock that clears on the second attempt is invisible to the caller', async () => {
  for (const code of ['EPERM', 'EBUSY']) {
    let attempts = 0;
    const result = await retryWhileLocked(async () => {
      attempts++;
      if (attempts === 1) throw errno(code);
      return 'written';
    }, noSleep);
    assert.equal(result, 'written', code);
    assert.equal(attempts, 2, code);
  }
});

test('a lock that never clears throws the original error, and not forever', async () => {
  let attempts = 0;
  await assert.rejects(
    retryWhileLocked(async () => {
      attempts++;
      throw errno('EBUSY');
    }, noSleep),
    (err: NodeJS.ErrnoException) => err.code === 'EBUSY',
  );
  // Four attempts in total: the first plus one per backoff step. An app that
  // waits longer than this on a file somebody has genuinely locked open is an
  // app that hangs on save, which is worse than one that says it could not save.
  assert.equal(attempts, 4);
});

test('the backoff is short and it grows', async () => {
  const waits: number[] = [];
  await assert.rejects(
    retryWhileLocked(
      async () => {
        throw errno('EPERM');
      },
      async (ms) => {
        waits.push(ms);
      },
    ),
  );
  assert.deepEqual(waits, [20, 60, 140]);
  assert.ok(
    waits.reduce((a, b) => a + b, 0) < 300,
    'the whole retry has to stay under a third of a second',
  );
});

test('any other error is a real error and is thrown at once', async () => {
  // Retrying these would only make a certain failure slower to report. EACCES is
  // in the list on purpose: Windows does sometimes report a sharing violation
  // that way, but it is also what a read-only file looks like, and the second
  // reading is the one worth being right about.
  for (const code of ['ENOENT', 'EACCES', 'ENOSPC', 'EISDIR']) {
    let attempts = 0;
    await assert.rejects(
      retryWhileLocked(async () => {
        attempts++;
        throw errno(code);
      }, noSleep),
      (err: NodeJS.ErrnoException) => err.code === code,
    );
    assert.equal(attempts, 1, code);
  }
  // An error carrying no code at all (a thrown string, a TypeError from a bug in
  // the operation itself) must not be treated as a lock either.
  let plain = 0;
  await assert.rejects(
    retryWhileLocked(async () => {
      plain++;
      throw new Error('something else went wrong');
    }, noSleep),
  );
  assert.equal(plain, 1);
});
