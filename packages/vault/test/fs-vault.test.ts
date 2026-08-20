import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Frontmatter } from '@qale/domain';
import { isVaultBoundaryError, VaultBoundaryError } from '@qale/application';
import { FsVault } from '../src/fs-vault.js';

async function vaultDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'pm-vault-'));
}

/**
 * Windows needs SeCreateSymbolicLinkPrivilege to make a symlink, which an
 * ordinary account does not hold. The two tests below are about what `contain()`
 * does with a link that escapes the vault, so with no link there is nothing to
 * assert — the honest outcome is a skip, not a pass and not a failure. Anywhere
 * that can make the link, this returns true and the test runs as written.
 */
async function trySymlink(target: string, path: string): Promise<boolean> {
  try {
    await symlink(target, path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EPERM') return false;
    throw err;
  }
}

const NO_SYMLINKS = 'this account cannot create symlinks (Windows without the privilege)';

test('body-only save preserves invalid frontmatter byte-for-byte (regression: coerced fallback erased real fields)', async () => {
  const dir = await vaultDir();
  await mkdir(join(dir, 'notes'));
  // `status: wip` is no lifecycle value any type claims → validation fails → the
  // in-memory note falls back to a permissive shape. The file must not care.
  const original =
    '---\ntype: insight\nstatus: wip\ncustom_field: keep-me\nsummary: s\n---\n\nOld body.\n';
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
  await writeFile(
    join(dir, 'notes/x.md'),
    '---\ntype: insight\nstatus: wip\ncustom_field: keep-me\n---\nBody.\n',
  );
  const vault = new FsVault(dir);
  const note = await vault.readNote('notes/x.md');
  assert.ok(note);
  const fm = note.frontmatter as Record<string, unknown>;
  assert.equal(fm['custom_field'], 'keep-me');
  assert.equal(fm['status'], 'wip');
});

test('a note that fails its own type says so, instead of just becoming a note', async () => {
  const dir = await vaultDir();
  await mkdir(join(dir, 'meetings'));
  // A `commitment` value no lifecycle claims is the ordinary hand-edit version:
  // the file is fine, the schema is not, and the note quietly leaves meetings/.
  await writeFile(
    join(dir, 'meetings/nordkap.md'),
    '---\ntype: meeting\nsummary: Nordkap check-in\ndate: not-a-date-at-all\nduration_minutes: half an hour\n---\nBody.\n',
  );
  const vault = new FsVault(dir);
  const note = await vault.readNote('meetings/nordkap.md');
  assert.ok(note);
  assert.equal(note.type, 'note', 'still read, still permissive');
  assert.equal(note.schemaMiss?.type, 'meeting', 'and it remembers what the file says it is');
  assert.match(note.schemaMiss?.error ?? '', /duration_minutes/);
});

test('a note that fits its type carries no miss', async () => {
  const dir = await vaultDir();
  await mkdir(join(dir, 'meetings'));
  await writeFile(
    join(dir, 'meetings/ok.md'),
    '---\ntype: meeting\nsummary: fine\ndate: 2026-08-13\n---\nBody.\n',
  );
  const vault = new FsVault(dir);
  const note = await vault.readNote('meetings/ok.md');
  assert.equal(note?.type, 'meeting');
  assert.equal(note?.schemaMiss, undefined);
});

test('contain() rejects lexical and symlink escapes', async (t) => {
  const dir = await vaultDir();
  const outside = await vaultDir();
  await writeFile(join(outside, 'secret.md'), 'secret\n');
  if (!(await trySymlink(join(outside, 'secret.md'), join(dir, 'leak.md')))) {
    t.skip(NO_SYMLINKS);
    return;
  }

  const vault = new FsVault(dir);
  assert.equal(vault.contain('../etc/passwd'), null);
  assert.equal(vault.contain('notes/../../etc/passwd'), null);
  assert.equal(
    vault.contain('leak.md'),
    null,
    'symlink pointing outside the vault must be rejected',
  );
  assert.ok(vault.contain('notes/ok.md'));
  assert.equal(await vault.readRaw('leak.md'), null);
});

test('a refused write is loud — every write path throws, and the file outside is untouched', async () => {
  // OW8. A refusal is our own path construction gone wrong, so no write may
  // report it by returning something a caller can skip past. `remove` is in the
  // list on purpose: it used to return quietly, and every caller follows it with
  // `index.removeByPath`, so the note left the app while the file stayed.
  const dir = await vaultDir();
  const outside = await vaultDir();
  await writeFile(join(outside, 'secret.md'), 'the memory\n');
  // The lexical escapes below need no symlink, so where one cannot be made this
  // test still earns its keep. Only the link case drops out.
  const linked = await trySymlink(join(outside, 'secret.md'), join(dir, 'leak.md'));

  const vault = new FsVault(dir);
  const escapes = ['../escape.md', 'notes/../../escape.md', ...(linked ? ['leak.md'] : [])];
  for (const path of escapes) {
    await assert.rejects(
      () => vault.writeRaw(path, 'x'),
      VaultBoundaryError,
      `writeRaw escaped via ${path}`,
    );
    await assert.rejects(
      () =>
        vault.writeNote(
          path,
          { type: 'note', summary: 's', sources: [] } as unknown as Frontmatter,
          'x',
        ),
      VaultBoundaryError,
      `writeNote escaped via ${path}`,
    );
    await assert.rejects(
      () => vault.writeBinary(path, new Uint8Array([1, 2, 3])),
      VaultBoundaryError,
      `writeBinary escaped via ${path}`,
    );
    await assert.rejects(
      () => vault.remove(path),
      VaultBoundaryError,
      `remove escaped via ${path}`,
    );
  }
  assert.equal(await readFile(join(outside, 'secret.md'), 'utf8'), 'the memory\n');
});

test('a refusal is recognisable as one across the package boundary', async () => {
  // What sync's mirror writer branches on: a provider having a bad minute is
  // worth shrugging off and retrying, a path we built wrong is not.
  const vault = new FsVault(await vaultDir());
  const err = await vault.writeRaw('../escape.md', 'x').then(
    () => null,
    (e: unknown) => e,
  );
  assert.ok(
    isVaultBoundaryError(err),
    'a refusal must be told apart from an ordinary write failure',
  );
  assert.equal(isVaultBoundaryError(new Error('EACCES: permission denied')), false);
});

test("an old vault reads and rewrites under the type's own lifecycle key", async () => {
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
