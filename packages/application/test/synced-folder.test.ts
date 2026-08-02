import assert from 'node:assert/strict';
import test from 'node:test';
import { detectSyncedFolder } from '../src/use-cases/vault.js';

/**
 * A workspace inside a sync client's folder is the one setup where two programs
 * write the same files at once, so the check has to catch the real shapes those
 * folders take (an account suffix, a Windows drive letter, iCloud's container)
 * without claiming ordinary folders that merely contain the word.
 */

test('the common sync roots are recognised, account suffix and all', () => {
  const cases: [string, string][] = [
    ['/Users/ada/Library/Mobile Documents/com~apple~CloudDocs/work', 'iCloud Drive'],
    ['/Users/ada/Library/Mobile Documents/com~apple~CloudDocs/Documents/pm', 'iCloud Drive'],
    ['/Users/ada/Dropbox/product/memory', 'Dropbox'],
    ['/Users/ada/Dropbox (Personal)/memory', 'Dropbox'],
    ['/Users/ada/Library/CloudStorage/GoogleDrive-ada@acme.com/My Drive/pm', 'Google Drive'],
    ['/Users/ada/Google Drive/pm', 'Google Drive'],
    ['/Users/ada/OneDrive - Acme/pm', 'OneDrive'],
    ['C:\\Users\\ada\\OneDrive\\pm', 'OneDrive'],
    ['/Users/ada/Sync.com/pm', 'Sync.com'],
    ['/Users/ada/pCloud Drive/pm', 'pCloud'],
    ['/Users/ada/Nextcloud/pm', 'Nextcloud'],
  ];
  for (const [path, service] of cases) assert.equal(detectSyncedFolder(path), service, path);
});

test('ordinary folders are left alone', () => {
  for (const path of [
    '/Users/ada/Documents/pm',
    '/Users/ada/work/sync/pm', // "sync" alone is far too common a folder name
    '/Users/ada/dropbox-notes/pm', // a word inside a name is not the Dropbox root
    '/Users/ada/my-onedrive-backup/pm',
  ]) {
    assert.equal(detectSyncedFolder(path), null, path);
  }
});
