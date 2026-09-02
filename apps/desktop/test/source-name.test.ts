import assert from 'node:assert/strict';
import test from 'node:test';
import { SOURCE_NAME_CAP, sourceName } from '../src/main/source-name.js';

/**
 * The name a dropped file gets inside a session's folder. Every rule here is
 * about a machine other than the one the file was dropped on: the name has to
 * survive being written on Windows, and it has to stay short enough that the
 * whole path does too.
 */

test('an ordinary filename is kept as it is, spaces and all', () => {
  const taken = new Set<string>();
  assert.equal(
    sourceName('2026-08-12 Nordkap QBR transcript part 2.vtt', taken),
    '2026-08-12 Nordkap QBR transcript part 2.vtt',
  );
  assert.equal(sourceName('C:\\Users\\ada\\Desktop\\notes.txt', taken), 'notes.txt');
  assert.equal(sourceName('/Users/ada/Desktop/skiss.png', taken), 'skiss.png');
});

test('a name Windows would refuse is made writable', () => {
  const taken = new Set<string>();
  assert.equal(sourceName('CON.txt', taken), 'CON_.txt', 'a device name, extension or not');
  assert.equal(sourceName('aux', taken), 'aux_');
  // Legal on macOS, silently rewritten by Windows, which is what makes the file
  // we wrote and the file on disk two different names.
  assert.equal(sourceName('summary.txt.', taken), 'summary.txt');
  assert.equal(sourceName('notes ', taken), 'notes');
});

test('a very long name is cut, and the extension survives the cut', () => {
  const taken = new Set<string>();
  const name = sourceName(`${'x'.repeat(300)}.png`, taken);
  assert.equal(name.length, SOURCE_NAME_CAP);
  // Load-bearing: the read tool decides image-or-text by the extension, so a
  // picture that lost its `.png` on the way in arrives as unreadable bytes.
  assert.ok(name.endsWith('.png'), name);
});

test('the whole path stays inside the Windows budget', () => {
  // `sessions/.files/<uuid>/source/` is 62 characters before the name.
  const longest = sourceName(`${'x'.repeat(300)}.transcript.vtt`, new Set());
  assert.ok(62 + longest.length <= 140, `${62 + longest.length} against a budget of 140`);
});

test('two files that differ only in case are still two files', () => {
  // Both filesystems compare names case-insensitively, so without this the
  // second source would overwrite the first and nobody would know.
  const taken = new Set<string>();
  assert.equal(sourceName('Notes.txt', taken), 'Notes.txt');
  assert.equal(sourceName('notes.txt', taken), 'notes-2.txt');
  assert.equal(sourceName('NOTES.TXT', taken), 'NOTES-3.TXT');
});

test('a name with nothing usable left in it still gets one', () => {
  assert.equal(sourceName('...', new Set()), 'source');
  assert.equal(sourceName('', new Set()), 'source');
});
