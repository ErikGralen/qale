import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsVault } from '../src/fs-vault.js';

async function vaultDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'pm-vault-'));
}

test('body-only save preserves invalid frontmatter byte-for-byte (regression: coerced fallback erased real fields)', async () => {
  const dir = await vaultDir();
  await mkdir(join(dir, 'notes'));
  // `status: wip` is no lifecycle value any type claims → validation fails → the
  // in-memory note falls back to a permissive shape. The file must not care.
  const original = '---\ntype: insight\nstatus: wip\ncustom_field: keep-me\nsummary: s\n---\n\nOld body.\n';
  await writeFile(join(dir, 'notes/x.md'), original);

  const vault = new FsVault(dir);
  const note = await vault.readNote('notes/x.md');
  assert.ok(note);

  await vault.writeBody('notes/x.md', 'New body.');
  const after = await readFile(join(dir, 'notes/x.md'), 'utf8');
  assert.ok(after.includes('status: wip'), 'lost status');
  assert.ok(after.includes('custom_field: keep-me'), 'lost custom field');
  assert.ok(after.includes('type: insight'), 'lost type');
  assert.ok(after.includes('New body.'));
  assert.ok(!after.includes('Old body.'));
});

test('coerceFrontmatter fallback keeps the original fields in memory', async () => {
  const dir = await vaultDir();
  await mkdir(join(dir, 'notes'));
  await writeFile(join(dir, 'notes/x.md'), '---\ntype: insight\nstatus: wip\ncustom_field: keep-me\n---\nBody.\n');
  const vault = new FsVault(dir);
  const note = await vault.readNote('notes/x.md');
  assert.ok(note);
  const fm = note.frontmatter as Record<string, unknown>;
  assert.equal(fm['custom_field'], 'keep-me');
  assert.equal(fm['status'], 'wip');
});

test('contain() rejects lexical and symlink escapes', async () => {
  const dir = await vaultDir();
  const outside = await vaultDir();
  await writeFile(join(outside, 'secret.md'), 'secret\n');
  await symlink(join(outside, 'secret.md'), join(dir, 'leak.md'));

  const vault = new FsVault(dir);
  assert.equal(vault.contain('../etc/passwd'), null);
  assert.equal(vault.contain('notes/../../etc/passwd'), null);
  assert.equal(vault.contain('leak.md'), null, 'symlink pointing outside the vault must be rejected');
  assert.ok(vault.contain('notes/ok.md'));
  assert.equal(await vault.readRaw('leak.md'), null);
});

test('an old vault reads and rewrites under the type\'s own lifecycle key', async () => {
  // Ticket 8 renamed the polymorphic `status` per lifecycle. Files on disk still
  // say `status:`; the read folds it over and the next write puts the new key
  // down, so no vault needs a migration script.
  const dir = await vaultDir();
  await mkdir(join(dir, 'decisions'));
  await writeFile(
    join(dir, 'decisions/d.md'),
    '---\ntype: decision\nsummary: Adopt WorkOS\nstatus: superseded\nsources: []\n---\n\nBody.\n',
  );

  const vault = new FsVault(dir);
  const note = await vault.readNote('decisions/d.md');
  assert.ok(note);
  const fm = note.frontmatter as Record<string, unknown>;
  assert.equal(fm['standing'], 'superseded');
  assert.equal(fm['status'], undefined);

  await vault.writeNote('decisions/d.md', note.frontmatter, note.body);
  const after = await readFile(join(dir, 'decisions/d.md'), 'utf8');
  assert.ok(after.includes('standing: superseded'), 'the new key lands on disk');
  assert.ok(!/^status:/m.test(after), 'the old key does not survive a rewrite');
});

test('writeNote folds a stray legacy `status` onto the right key', async () => {
  const dir = await vaultDir();
  await mkdir(join(dir, 'todos'));
  const vault = new FsVault(dir);
  await vault.writeNote(
    'todos/t.md',
    { type: 'todo', summary: 'Email Åsa', status: 'done', sources: [] } as never,
    '',
  );
  const after = await readFile(join(dir, 'todos/t.md'), 'utf8');
  assert.ok(after.includes('commitment: done'));
  assert.ok(!/^status:/m.test(after));
});
