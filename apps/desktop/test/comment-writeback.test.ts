import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyComments } from '../src/main/comment-writeback.js';

/**
 * The round, rewritten with what the PM wrote in it (docs/brainstorm-skill.md,
 * IT-4). This rewrite is for people: the model gets the answers as its tool
 * result and never reads the file back. What it has to be is faithful — every
 * question still where it was, every answer under it, and nothing invented for
 * a box that was left alone.
 */

const ROUND = [
  '# Splitting the payments epic',
  '',
  'Three stories, roughly.',
  '',
  '```slot idea-1',
  'Keep? Cut? Smaller?',
  '```',
  '',
  'The second one is the risky one.',
  '',
  '```slot idea-2',
  'Worth doing at all?',
  '```',
  '',
  'That is the lot.',
  '',
].join('\n');

test('every fence becomes what was written there, in place', () => {
  const out = applyComments(ROUND, {
    answers: { 'idea-1': 'Cut it. Nobody asked for this.', 'idea-2': 'Keep, but smaller.' },
  });
  assert.equal(
    out,
    [
      '# Splitting the payments epic',
      '',
      'Three stories, roughly.',
      '',
      '**You:** Cut it. Nobody asked for this.',
      '',
      'The second one is the risky one.',
      '',
      '**You:** Keep, but smaller.',
      '',
      'That is the lot.',
      '',
    ].join('\n'),
  );
});

test('a box nobody wrote in says so, rather than disappearing', () => {
  // The question was asked. A file that reads back as if it never was would be
  // a worse record than one that says the PM passed on it.
  const out = applyComments(ROUND, { answers: { 'idea-2': 'Yes.' } });
  assert.ok(out);
  assert.ok(out.includes('**You:** (no comment)'));
  assert.ok(out.includes('**You:** Yes.'));
  assert.ok(!out.includes('```slot'));
});

test('whitespace-only text counts as nothing written', () => {
  const out = applyComments(ROUND, { answers: { 'idea-1': '   \n  ', 'idea-2': '\t' } });
  assert.equal(out?.match(/\(no comment\)/g)?.length, 2);
});

test('an id from another round is ignored, and its answer with it', () => {
  const out = applyComments(ROUND, { answers: { 'idea-9': 'stale' } });
  assert.ok(!out?.includes('stale'));
  assert.equal(out?.match(/\(no comment\)/g)?.length, 2);
});

test('the general comment lands under a heading at the end', () => {
  const out = applyComments(ROUND, {
    answers: { 'idea-1': 'Fine.', 'idea-2': 'Fine.' },
    general: 'This is all far too detailed for where we are.',
  });
  assert.ok(out);
  assert.ok(
    out.endsWith(
      '\n\n## Anything else\n\n**You:** This is all far too detailed for where we are.\n',
    ),
    out.slice(-120),
  );
  // One heading, and the document above it is untouched.
  assert.equal(out.match(/## Anything else/g)?.length, 1);
  assert.ok(out.startsWith('# Splitting the payments epic'));
});

test('a general comment alone still gets written, boxes and all', () => {
  const out = applyComments(ROUND, { answers: {}, general: 'Start again from the pricing side.' });
  assert.ok(out?.includes('## Anything else'));
  assert.equal(out?.match(/\(no comment\)/g)?.length, 2);
});

test('an empty general box adds no heading', () => {
  const out = applyComments(ROUND, { answers: { 'idea-1': 'Keep.' }, general: '  ' });
  assert.ok(!out?.includes('## Anything else'));
});

test('multi-line answers keep their lines', () => {
  const out = applyComments(ROUND, { answers: { 'idea-1': 'Two things.\nThe second is worse.' } });
  assert.ok(out?.includes('**You:** Two things.\nThe second is worse.'));
});

test('a fence inside another fence is content, not a box', () => {
  // A round that SHOWS the slot syntax in an example block must not sprout a
  // box in the middle of its own example.
  const doc = ['~~~~', '```slot example', 'not a real one', '```', '~~~~', ''].join('\n');
  assert.equal(applyComments(doc, { answers: { example: 'hello' } }), doc);
});

test('a round that no longer parses is left exactly as it is', () => {
  // Two boxes with one id: the answers cannot be told apart, so nothing is
  // rewritten. The comments still reach the session; only the record is lost.
  const broken = ['```slot idea-1', 'a', '```', '', '```slot idea-1', 'b', '```', ''].join('\n');
  assert.equal(applyComments(broken, { answers: { 'idea-1': 'yes' } }), null);

  const unclosed = ['```slot idea-1', 'never closed', ''].join('\n');
  assert.equal(applyComments(unclosed, { answers: { 'idea-1': 'yes' } }), null);
});
