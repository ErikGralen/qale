import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectSyncedFolder,
  isWindowsPathTooDeep,
  workspaceNameOf,
  WINDOWS_ROOT_LIMIT,
} from '../src/use-cases/vault.js';

/**
 * A workspace inside a sync client's folder is the one setup where two programs
 * write the same files at once, so the check has to catch the real shapes those
 * folders take (an account suffix, a Windows drive letter, iCloud's container)
 * without claiming ordinary folders that merely contain the word.
 */

test('the common sync roots are recognised, account suffix and all', () => {
  const cases: [string, string][] = [
    ['/Users/ada/Library/Mobile Documents/com~apple~CloudDocs/work', 'iCloud Drive'],
    ['/Users/ada/Library/Mobile Documents/com~apple~CloudDocs/Documents/qale', 'iCloud Drive'],
    ['/Users/ada/Dropbox/product/memory', 'Dropbox'],
    ['/Users/ada/Dropbox (Personal)/memory', 'Dropbox'],
    ['/Users/ada/Library/CloudStorage/GoogleDrive-ada@acme.com/My Drive/qale', 'Google Drive'],
    ['/Users/ada/Google Drive/qale', 'Google Drive'],
    ['/Users/ada/OneDrive - Acme/qale', 'OneDrive'],
    ['C:\\Users\\ada\\OneDrive\\qale', 'OneDrive'],
    ['/Users/ada/Sync.com/qale', 'Sync.com'],
    ['/Users/ada/pCloud Drive/qale', 'pCloud'],
    ['/Users/ada/Nextcloud/qale', 'Nextcloud'],
  ];
  for (const [path, service] of cases) assert.equal(detectSyncedFolder(path), service, path);
});

/**
 * The same services as they actually appear on Windows, which is a different
 * shape in every case: OneDrive is the default place a work profile keeps
 * Documents, Google Drive is a mounted drive letter rather than a folder under
 * home, and iCloud writes its folder name without the space.
 */
test('the Windows shapes of the same services are recognised', () => {
  const cases: [string, string][] = [
    ['C:\\Users\\ada\\OneDrive\\Documents\\Qale', 'OneDrive'],
    ['C:\\Users\\ada\\OneDrive - Acme\\Documents\\Qale', 'OneDrive'],
    ['C:\\Users\\ada\\OneDrive - Acme Holdings AB\\Qale', 'OneDrive'],
    ['C:\\Users\\ada\\Dropbox\\Qale', 'Dropbox'],
    ['C:\\Users\\ada\\Dropbox (Acme)\\Qale', 'Dropbox'],
    // Google Drive for desktop: a virtual drive, and the letter is the user's
    // to change, so "My Drive" is the only thing about the path that says Google.
    ['G:\\My Drive\\Qale', 'Google Drive'],
    ['H:\\My Drive\\work\\Qale', 'Google Drive'],
    ['G:\\Shared drives\\Product\\Qale', 'Google Drive'],
    // It can also be mounted as a folder instead of a drive.
    ['C:\\Users\\ada\\My Drive\\Qale', 'Google Drive'],
    ['C:\\Users\\ada\\Google Drive\\Qale', 'Google Drive'],
    // iCloud for Windows: one word, no space.
    ['C:\\Users\\ada\\iCloudDrive\\Qale', 'iCloud Drive'],
    ['C:\\Users\\ada\\iCloudDrive\\iCloud~md~obsidian\\Qale', 'iCloud Drive'],
    ['C:\\Users\\ada\\Nextcloud\\Qale', 'Nextcloud'],
    ['C:\\Users\\ada\\pCloud Drive\\Qale', 'pCloud'],
  ];
  for (const [path, service] of cases) assert.equal(detectSyncedFolder(path), service, path);
});

test('ordinary folders are left alone', () => {
  for (const path of [
    '/Users/ada/Documents/qale',
    '/Users/ada/work/sync/qale', // "sync" alone is far too common a folder name
    '/Users/ada/dropbox-notes/qale', // a word inside a name is not the Dropbox root
    '/Users/ada/my-onedrive-backup/qale',
    'C:\\Users\\ada\\Documents\\Qale',
    'C:\\Users\\ada\\Documents\\My Drives\\Qale', // plural: not Google's folder
    'C:\\Users\\ada\\OneDrive-backup-2024\\Qale',
    'D:\\work\\drive\\Qale',
  ]) {
    assert.equal(detectSyncedFolder(path), null, path);
  }
});

/**
 * The Windows path limit, decided by the shape of the path rather than by the
 * platform running the check, so it is one pure function that can be asserted
 * from a Mac. What it protects: a workspace so deep that the files inside it
 * (worst case a session's working file, at about 113 characters of vault-relative
 * path) run past MAX_PATH, which surfaces months later as one note that will not
 * save and never as a message about path length.
 */
test('a deep Windows workspace is caught, a shallow one is not', () => {
  const deep = `C:\\Users\\ada\\${'a-fairly-long-folder-name\\'.repeat(6)}Qale`;
  assert.ok(deep.length > WINDOWS_ROOT_LIMIT, 'the fixture has to actually be too deep');
  assert.equal(isWindowsPathTooDeep(deep), true);
  assert.equal(isWindowsPathTooDeep(`${deep}\\`), true, 'a trailing separator changes nothing');

  for (const ok of [
    'C:\\Qale',
    'C:\\Users\\ada\\Documents\\Qale',
    'C:\\Users\\ada\\OneDrive - Acme Holdings AB\\Documents\\Product memory\\Qale',
    `C:\\${'x'.repeat(WINDOWS_ROOT_LIMIT - 3)}`, // exactly at the limit is still fine
  ]) {
    assert.equal(isWindowsPathTooDeep(ok), false, ok);
  }
});

test('the budget leaves room for the longest path the app mints', () => {
  // The arithmetic written down in vault.ts, asserted rather than trusted. Both
  // worst cases have to fit in what is left of MAX_PATH under a root that sits
  // right on the limit, or the warning is drawing the line in the wrong place.
  const worst = [
    // Dropped material: the session folder plus a 72-character filename.
    `sessions/.files/${'0'.repeat(36)}/material/${'x'.repeat(72)}`,
    // A session's own working file.
    `sessions/.files/${'0'.repeat(36)}/per-item/${'x'.repeat(48)}.md`,
    // A session receipt, and an ordinary note under the longest folder name.
    `sessions/2026-08-12-${'x'.repeat(48)}-0a1b2c3d.md`,
    `attachments/2026-08-12-${'x'.repeat(48)}.png`,
  ];
  const root = `C:\\${'x'.repeat(WINDOWS_ROOT_LIMIT - 3)}`;
  assert.equal(isWindowsPathTooDeep(root), false);
  for (const path of worst) {
    assert.ok(
      root.length + 1 + path.length <= 259,
      `${path.length}: ${root.length + 1 + path.length}`,
    );
  }
});

test('a posix path is never too deep, however long it is', () => {
  // No such limit exists on macOS or Linux, and warning about one there would be
  // an invented problem.
  const long = `/Users/ada/${'a-fairly-long-folder-name/'.repeat(12)}qale`;
  assert.ok(long.length > WINDOWS_ROOT_LIMIT);
  assert.equal(isWindowsPathTooDeep(long), false);
});

test('a UNC share is a Windows path and is measured like one', () => {
  const deep = `\\\\nas\\share\\${'a-fairly-long-folder-name\\'.repeat(6)}Qale`;
  assert.equal(isWindowsPathTooDeep(deep), true);
  assert.equal(isWindowsPathTooDeep('\\\\nas\\share\\Qale'), false);
});

/**
 * The workspace name is the folder's own name, and the argument is an absolute
 * OS path rather than a vault path, so a backslash there is a separator. Reading
 * it with `/` alone gave the whole disk path back as the "name" on Windows, in
 * the switcher, the window title and the root index.md.
 */
test('the workspace name is the last folder segment, on either kind of path', () => {
  assert.equal(workspaceNameOf('/Users/ada/Documents/Qale'), 'Qale');
  assert.equal(workspaceNameOf('C:\\Users\\ada\\Documents\\Qale'), 'Qale');
  assert.equal(
    workspaceNameOf('C:\\Users\\ada\\Documents\\Qale\\'),
    'Qale',
    'a trailing separator names nothing',
  );
  assert.equal(workspaceNameOf('/Users/ada/Documents/Qale/'), 'Qale');
  assert.equal(workspaceNameOf('\\\\nas\\share\\Qale'), 'Qale', 'a UNC share is still a path');
  assert.equal(workspaceNameOf('/'), null, 'no segment left to name it after');
});
