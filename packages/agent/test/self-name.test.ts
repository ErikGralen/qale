import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selfPreamble } from '../src/prompts.js';

/**
 * The prompt says whose workspace it is, because a draft the PM sends as
 * themselves needs their name and nothing else in the prompt carries it. The
 * failure this prevents is a sign-off reading "Best, Sam" or "[Your name]".
 */

test('with a name set, the sign-off is theirs', () => {
  const p = selfPreamble('Erik');
  assert.match(p, /This workspace belongs to Erik/);
  assert.match(p, /a sign-off is signed Erik/);
  assert.match(p, /Never sign with\s+another name/);
  assert.match(p, /never leave a placeholder like "\[Your name\]"/);
});

test('a name is trimmed, never passed through raw', () => {
  assert.equal(selfPreamble('  Erik  '), selfPreamble('Erik'));
});

test('with no name set, the draft is unsigned rather than guessed', () => {
  for (const empty of [null, undefined, '', '   ']) {
    const p = selfPreamble(empty);
    assert.match(p, /nobody has told you their name/);
    assert.match(p, /no sign-off/);
    assert.match(p, /Never\s+invent a name for them/);
    assert.match(p, /never leave a placeholder like "\[Your name\]"/);
    // It says where the name comes from, so the answer to "why unsigned" is true.
    assert.match(p, /Settings, under "You"/);
  }
});
