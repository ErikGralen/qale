import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isFolderIndex,
  isReservedFile,
  isRunnableEntry,
  slugFromPath,
  typeForDir,
} from '@qale/domain';
import { FsVault } from '../src/fs-vault.js';
import { toPosixPath } from '../src/paths.js';

/**
 * The vault-path invariant: a vault-relative path is posix on every platform.
 *
 * These tests pass the Windows separator in by hand rather than pretending to be
 * on win32. `sep` is `/` here, so a test that just handed `toPosixPath` a
 * backslash string would pass while proving nothing, and the whole point is the
 * platform we cannot run on.
 */

const WIN = '\\';
const POSIX = '/';

test('a Windows relative path comes back posix', () => {
  assert.equal(toPosixPath('meetings\\2026-07-17-weekly.md', WIN), 'meetings/2026-07-17-weekly.md');
  assert.equal(toPosixPath('skills\\spec-review\\SKILL.md', WIN), 'skills/spec-review/SKILL.md');
  assert.equal(toPosixPath('note.md', WIN), 'note.md', 'a bare filename has nothing to convert');
  assert.equal(toPosixPath('', WIN), '', 'the root itself is empty, not "/"');
});

test('a posix relative path is left exactly as it is, backslashes included', () => {
  assert.equal(toPosixPath('meetings/weekly.md', POSIX), 'meetings/weekly.md');
  // A backslash is a legal character in a macOS or Linux filename. A blanket
  // replace would rewrite this into a folder that does not exist and quietly
  // drop the note, which is why the conversion splits on the separator instead.
  assert.equal(toPosixPath('notes/before\\after.md', POSIX), 'notes/before\\after.md');
});

test('the readers that take a vault path apart only work once it is posix', () => {
  const raw = 'meetings\\2026-07-17-weekly.md';
  const rel = toPosixPath(raw, WIN);

  // Type inference from the top folder. Unconverted, the whole path is one
  // segment, `typeForDir` finds no folder by that name, and every note in the
  // workspace would index as a plain `note`.
  assert.equal(typeForDir(rel.split('/')[0] ?? ''), 'meeting');
  assert.equal(typeForDir(raw.split('/')[0] ?? ''), null, 'the failure this guards against');

  assert.equal(slugFromPath(rel), 'meetings/2026-07-17-weekly');
});

test('folder hubs and reserved files are recognised after conversion, not before', () => {
  assert.equal(isFolderIndex(toPosixPath('insights\\index.md', WIN)), true);
  assert.equal(isFolderIndex('insights\\index.md'), false, 'the failure this guards against');

  assert.equal(isReservedFile(toPosixPath('insights\\log.md', WIN)), true);
  // `isReservedFile` cuts at the last `/`, so an unconverted path hands it the
  // whole string as a basename and a folder's log.md would be indexed as a
  // concept note that nothing wrote.
  assert.equal(isReservedFile('insights\\log.md'), false, 'the failure this guards against');

  assert.equal(isRunnableEntry(toPosixPath('skills\\spec-review\\SKILL.md', WIN)), true);
  assert.equal(
    isRunnableEntry('skills\\spec-review\\SKILL.md'),
    false,
    'the failure this guards against',
  );
});

test('the walk that feeds the index reports posix paths', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pm-vault-paths-'));
  await mkdir(join(dir, 'skills', 'spec-review'), { recursive: true });
  await mkdir(join(dir, 'meetings'), { recursive: true });
  await writeFile(
    join(dir, 'meetings', 'weekly.md'),
    '---\ntype: meeting\nsummary: s\n---\n\nBody.\n',
  );
  await writeFile(
    join(dir, 'skills', 'spec-review', 'SKILL.md'),
    '---\ntype: skill\nsummary: s\n---\n\nBody.\n',
  );

  const listing = await new FsVault(dir).list();
  const paths = listing.map((f) => f.path).sort();
  assert.deepEqual(paths, ['meetings/weekly.md', 'skills/spec-review/SKILL.md']);
  assert.ok(
    paths.every((p) => !p.includes('\\')),
    'a listed path must never carry a native separator',
  );
});

test('contain() takes posix paths and resolves them the way this OS writes them', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pm-vault-paths-'));
  const vault = new FsVault(dir);
  // The caller always says `/`; what comes back is a real path for this platform,
  // which on Windows means backslashes. That asymmetry is the whole contract.
  // Measured from `vault.root()`, not the temp dir we asked for: the vault
  // canonicalizes its root, and on macOS /tmp is a symlink into /private/tmp.
  assert.equal(
    vault.contain('skills/spec-review/SKILL.md'),
    join(vault.root(), 'skills', 'spec-review', 'SKILL.md'),
  );
  // An absolute path is not a vault path, whichever root it names.
  assert.equal(vault.contain('/etc/passwd'), null);
});

test('type inference from the folder survives the walk (regression: separators broke it)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pm-vault-paths-'));
  await mkdir(join(dir, 'decisions'), { recursive: true });
  // No `type:` in the frontmatter, so the only thing that can say what this is
  // is the folder it sits in, read off the vault path.
  await writeFile(join(dir, 'decisions', 'd.md'), 'Just a body, no frontmatter at all.\n');
  const note = await new FsVault(dir).readNote('decisions/d.md');
  assert.equal(note?.frontmatter.type, 'decision');
});
