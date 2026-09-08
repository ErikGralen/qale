import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reversePatch } from '../src/index.js';

// The undo's own arithmetic (docs/fewer-approvals.md FA-2), without a repo.
// `revertNoteChange` in packages/vault/test/restore-version.test.ts covers what
// it does to real files; this covers what it does to text.

const PAGE = ['# Rollout', '', 'One.', '', 'Two.', '', 'Three.', ''].join('\n');

test('takes one change back out and leaves the lines around it alone', () => {
  const after = PAGE.replace('Two.', 'Two, as the agent put it.');
  const current = `${after}\nFour, mine.\n`;
  const out = reversePatch(PAGE, after, current);
  assert.ok(out !== null);
  assert.ok(out.includes('\nTwo.\n'));
  assert.ok(!out.includes('as the agent put it'));
  assert.ok(out.includes('Four, mine.'));
});

test('two changes far apart both come out', () => {
  const after = PAGE.replace('One.', 'One, edited.').replace('Three.', 'Three, edited.');
  const out = reversePatch(PAGE, after, after);
  assert.equal(out, PAGE);
});

test('a line the change added is taken away again', () => {
  const after = PAGE.replace('Two.', 'Two.\n\nTwo and a half.');
  const out = reversePatch(PAGE, after, after);
  assert.equal(out, PAGE);
});

test('a line the change removed comes back', () => {
  const after = PAGE.replace('\nTwo.\n', '\n');
  const out = reversePatch(PAGE, after, after);
  assert.equal(out, PAGE);
});

test('nothing to search for means no patch, and the caller writes the whole file', () => {
  const after = PAGE.replace('Two, as the agent put it.', 'x');
  // The anchor the undo would look for is gone: the person rewrote it.
  const current = '# Rollout\n\nA page about something else now.\n';
  assert.equal(reversePatch(PAGE, after.replace('Two.', 'Two, agent.'), current), null);
});

test('an ambiguous anchor is refused rather than guessed at', () => {
  const before = ['A.', 'B.', 'A.', 'B.', ''].join('\n');
  const after = ['A.', 'B, edited.', 'A.', 'B.', ''].join('\n');
  // Both halves read the same, so the block matches twice and applyPatch says no.
  const current = ['A.', 'B, edited.', 'A.', 'B, edited.', ''].join('\n');
  assert.equal(reversePatch(before, after, current), null);
});

test('two files that differ by nothing give no patch at all', () => {
  assert.equal(reversePatch(PAGE, PAGE, PAGE), null);
});

test('a change in the properties block comes out on its own', () => {
  const before = '---\ntype: note\ntags: [alpha]\n---\n\nMine.\n';
  const after = '---\ntype: note\ntags: [alpha, beta]\n---\n\nMine.\n';
  const current = `${after}\nAnd a second paragraph.\n`;
  const out = reversePatch(before, after, current);
  assert.ok(out !== null);
  assert.ok(out.includes('tags: [alpha]'));
  assert.ok(!out.includes('beta'));
  assert.ok(out.includes('And a second paragraph.'));
});
