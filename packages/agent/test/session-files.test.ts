import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createSessionFileTools,
  listSessionFiles,
  readSessionFile,
  sessionFilesRelRoot,
  sessionFilesRoot,
} from '../src/session-files.js';

function fixture(): string {
  const root = join(mkdtempSync(join(tmpdir(), 'pm-sf-')), 'vault');
  mkdirSync(root, { recursive: true });
  return root;
}

const run = (tool: { execute: (...a: never[]) => unknown }, params: unknown) =>
  // The tools only use (id, params); the rest of pi's signature is unused here.
  (tool.execute as unknown as (id: string, p: unknown, s?: AbortSignal) => Promise<{ content: { text: string }[] }>)(
    'call-1',
    params,
    undefined,
  );

test('the session folder lives under sessions/.files — invisible to the indexer', () => {
  assert.equal(sessionFilesRelRoot('abc123'), 'sessions/.files/abc123');
  assert.ok(sessionFilesRoot('/vault', 'abc123').endsWith('/vault/sessions/.files/abc123'));
});

test('a session writes, lists and reads back its own files', async () => {
  const root = join(fixture(), 'sessions/.files/s1');
  const [list, read, write] = createSessionFileTools(root);
  await run(write!, { path: 'brief.md', content: 'what everyone needs to know' });
  await run(write!, { path: 'per-item/nordkap.md', content: 'from sources/2026-06-12-nordkap.md' });

  const files = await listSessionFiles(root);
  assert.deepEqual(
    files.map((f) => f.path),
    ['brief.md', 'per-item/nordkap.md'],
  );
  assert.ok(files[0]!.bytes > 0);

  const got = await run(read!, { path: 'per-item/nordkap.md' });
  assert.match(got.content[0]!.text, /sources\/2026-06-12-nordkap\.md/);

  const listed = await run(list!, { path: '.' });
  assert.match(listed.content[0]!.text, /brief\.md/);
  assert.equal(await readSessionFile(root, 'brief.md'), 'what everyone needs to know');
});

test('read scope is structural: ../, absolute and ~ paths cannot be expressed', async () => {
  const vault = fixture();
  writeFileSync(join(vault, 'secret.md'), 'the memory');
  const root = join(vault, 'sessions/.files/s1');
  const [, read, write] = createSessionFileTools(root);

  for (const escape of ['../../../secret.md', '/etc/hosts', '~/.ssh/id_rsa']) {
    await assert.rejects(() => run(read!, { path: escape }), /outside your session folder/, `read escaped via ${escape}`);
    await assert.rejects(
      () => run(write!, { path: escape, content: 'x' }),
      /outside your session folder/,
      `write escaped via ${escape}`,
    );
  }
  // And the file it tried to reach is untouched, not overwritten with 'x'.
  assert.equal(readFileSync(join(vault, 'secret.md'), 'utf8'), 'the memory');
});

test('listing a session that never wrote anything is empty, not an error', async () => {
  assert.deepEqual(await listSessionFiles(join(fixture(), 'sessions/.files/never')), []);
  assert.equal(await readSessionFile(join(fixture(), 'sessions/.files/never'), 'brief.md'), null);
});

test('a write fires onWrite so the tree fills live', async () => {
  const root = join(fixture(), 'sessions/.files/s1');
  let writes = 0;
  const [, , write, edit] = createSessionFileTools(root, () => {
    writes++;
  });
  await run(write!, { path: 'a.md', content: 'one' });
  assert.equal(writes, 1);
  await run(edit!, { path: 'a.md', edits: [{ oldText: 'one', newText: 'two' }] });
  assert.equal(writes, 2);
  // A refused write must not claim the tree changed.
  await run(write!, { path: '../escape.md', content: 'x' }).catch(() => undefined);
  assert.equal(writes, 2);
});
