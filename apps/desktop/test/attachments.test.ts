import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  attachedMessage,
  attachmentName,
  itemsFromFiles,
  pastedName,
  type DroppedFile,
} from '../src/renderer/src/lib/attachments.js';

/**
 * What a drop becomes on its way into a composer.
 *
 * The branching here is the part that only fails on somebody else's machine: a
 * file dragged out of a browser has no path, a folder can only be read through
 * one, and an image has to travel as bytes. So it is a plain function over a
 * plain shape, checked here rather than by launching Electron and dragging
 * something onto the window.
 */

function file(over: Partial<DroppedFile> & { name: string }): DroppedFile {
  return {
    type: '',
    lastModified: 1_700_000_000_000,
    text: () => Promise.resolve('text'),
    arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
    ...over,
  };
}

/** The path route, as the preload answers it: a real path, or an empty string. */
const withPaths = (paths: Record<string, string>) => (f: DroppedFile) => paths[f.name] ?? '';
const noPaths = () => '';

test('a dropped file with a real path travels as that path, not as bytes', async () => {
  const items = await itemsFromFiles(
    [file({ name: 'Nordkap QBR.vtt' }), file({ name: 'interviews' })],
    withPaths({ 'Nordkap QBR.vtt': '/Users/ada/qbr.vtt', interviews: '/Users/ada/interviews' }),
  );
  assert.deepEqual(items, [
    { path: '/Users/ada/qbr.vtt', name: 'Nordkap QBR.vtt', lastModified: 1_700_000_000_000 },
    { path: '/Users/ada/interviews', name: 'interviews', lastModified: 1_700_000_000_000 },
  ]);
});

test('a file dragged out of a browser carries its own content', async () => {
  const items = await itemsFromFiles(
    [file({ name: 'notes.md', text: () => Promise.resolve('# Notes') })],
    noPaths,
  );
  assert.deepEqual(items, [
    { name: 'notes.md', text: '# Notes', lastModified: 1_700_000_000_000 },
  ]);
});

test('an image with no path travels as base64', async () => {
  const items = await itemsFromFiles([file({ name: 'skiss.png', type: 'image/png' })], noPaths);
  assert.equal(items[0]?.name, 'skiss.png');
  assert.equal(items[0]?.dataBase64, Buffer.from([1, 2, 3]).toString('base64'));
  assert.equal(items[0]?.text, undefined);
});

test('a file nothing can read travels as a name, so main can refuse it by name', async () => {
  const items = await itemsFromFiles([file({ name: 'deck.zip' })], noPaths);
  assert.deepEqual(items, [{ name: 'deck.zip', lastModified: 1_700_000_000_000 }]);
});

test('an empty drop is an empty list', async () => {
  assert.deepEqual(await itemsFromFiles([], noPaths), []);
});

test('pasted text is named like a file, and two pastes are told apart', () => {
  assert.equal(pastedName([]), 'Pasted text.md');
  assert.equal(pastedName([{ name: 'Pasted text.md' }]), 'Pasted text 2.md');
  assert.equal(
    pastedName([{ name: 'Pasted text.md' }, { name: 'Pasted text 2.md' }, { name: 'notes.md' }]),
    'Pasted text 3.md',
  );
  assert.equal(attachmentName({ text: 'a wall of text' }), 'Pasted text.md');
  assert.equal(attachmentName({ name: 'notes.md' }), 'notes.md');
});

test('the message names the files, then says what the PM typed', () => {
  assert.equal(
    attachedMessage(['source/notes.md'], 'What did they commit to?'),
    'I added `source/notes.md` to this session.\n\nWhat did they commit to?',
  );
  assert.equal(
    attachedMessage(['source/a.md', 'source/b.png'], ''),
    'I added `source/a.md` and `source/b.png` to this session.',
  );
  assert.equal(
    attachedMessage(['source/a.md', 'source/b.png', 'source/c.vtt'], '  '),
    'I added `source/a.md`, `source/b.png` and `source/c.vtt` to this session.',
  );
  // No files is just what they typed. The sentence would be a lie otherwise.
  assert.equal(attachedMessage([], 'Hello'), 'Hello');
});
