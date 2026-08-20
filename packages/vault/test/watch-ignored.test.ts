import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { isWatchIgnored } from '../src/watcher.js';

/**
 * The watcher's ignore rule has to be the SAME rule `FsVault.walk` uses, because
 * they are the two doors a note id comes in through. While they disagreed, a
 * session's working files were skipped by the scan and upserted live by the
 * watcher: dropping a transcript put a phantom "Input — What arrived" note in the
 * notes list and in search, and only the next reconcile took it back out.
 */

const ROOT = '/vault';
const at = (rel: string): string => join(ROOT, ...rel.split('/'));

test('a dot-folder at any depth is invisible to the watcher', () => {
  for (const rel of [
    'sessions/.files/abc123/input.md',
    'sessions/.files/abc123/material/kranelund.md',
    '.git/COMMIT_EDITMSG',
    '.obsidian/workspace.json',
    'insights/.trash/old.md',
    'node_modules/pkg/readme.md',
  ]) {
    assert.equal(isWatchIgnored(ROOT, at(rel)), true, `${rel} must be ignored`);
  }
});

test('ordinary notes still get through', () => {
  for (const rel of ['insights/acme.md', 'sessions/2026-08-13-arrival-abc123.md', 'index.md']) {
    assert.equal(isWatchIgnored(ROOT, at(rel)), false, `${rel} must be watched`);
  }
});

test('the root itself is not ignored, even under a dot-folder', () => {
  // A vault living inside e.g. `~/.config/qale` would otherwise ignore itself:
  // the rule reads the path RELATIVE to the root, and the root is empty there.
  assert.equal(isWatchIgnored('/home/e/.config/qale', '/home/e/.config/qale'), false);
  assert.equal(
    isWatchIgnored('/home/e/.config/qale', '/home/e/.config/qale/insights/acme.md'),
    false,
  );
});
