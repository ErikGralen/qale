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

test('ordinary folders are left alone', () => {
  for (const path of [
    '/Users/ada/Documents/qale',
    '/Users/ada/work/sync/qale', // "sync" alone is far too common a folder name
    '/Users/ada/dropbox-notes/qale', // a word inside a name is not the Dropbox root
    '/Users/ada/my-onedrive-backup/qale',
  ]) {
    assert.equal(detectSyncedFolder(path), null, path);
  }
});
