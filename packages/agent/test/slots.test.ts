import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSlots, type Slot } from '../src/slots.js';

/**
 * The slot syntax has two readers. This package validates a round before it
 * parks on it, and the renderer draws a box where each fence is. So the offsets
 * here are part of the contract and not an implementation detail.
 */

const slots = (md: string): Slot[] => {
  const r = parseSlots(md);
  if ('error' in r) throw new Error(r.error);
  return r.slots;
};
const err = (md: string): string => {
  const r = parseSlots(md);
  if (!('error' in r)) throw new Error('expected a rejection');
  return r.error;
};

const round = [
  '# Round 1',
  '',
  'Three ways to split the epic.',
  '',
  '```slot idea-1',
  'Keep? Cut? Smaller?',
  '```',
  '',
  'The second one is riskier.',
  '',
  '```slot idea-2',
  '```',
  '',
  'Done.',
].join('\n');

test('every slot comes back in document order, with its prompt', () => {
  const found = slots(round);
  assert.deepEqual(
    found.map((s) => s.id),
    ['idea-1', 'idea-2'],
  );
  assert.equal(found[0]!.prompt, 'Keep? Cut? Smaller?');
  // An empty fence is still a slot; it just has nothing above the box.
  assert.equal(found[1]!.prompt, undefined);
});

test('the range covers the whole fence, so replacing it leaves the prose alone', () => {
  const found = slots(round);
  const first = found[0]!;
  assert.equal(round.slice(first.start, first.end), '```slot idea-1\nKeep? Cut? Smaller?\n```');
  const rewritten = round.slice(0, first.start) + '**You:** smaller' + round.slice(first.end);
  assert.match(rewritten, /Three ways to split the epic\.\n\n\*\*You:\*\* smaller\n\nThe second/);
});

test('a document with no slots parses cleanly and finds none', () => {
  assert.deepEqual(slots('# Round 1\n\nNothing to react to yet.\n'), []);
  assert.deepEqual(slots(''), []);
});

test('a slot fence inside another fence is that fence’s content, not a slot', () => {
  const md = [
    'This is how a slot looks:',
    '',
    '````markdown',
    '```slot example',
    'Keep? Cut?',
    '```',
    '````',
    '',
    '```slot idea-1',
    'And this one is real.',
    '```',
  ].join('\n');
  assert.deepEqual(
    slots(md).map((s) => s.id),
    ['idea-1'],
  );
});

test('two slots with one id are refused: the answers could not be told apart', () => {
  const md = ['```slot idea-1', 'a', '```', '', '```slot idea-1', 'b', '```'].join('\n');
  assert.match(err(md), /two slots are called "idea-1"/);
});

test('a slot fence nobody closed is refused rather than quietly swallowing the rest', () => {
  const md = ['```slot idea-1', 'Keep? Cut?', '', 'and then the document just ends'].join('\n');
  assert.match(err(md), /is never closed/);
  // A plain fence left open is markdown behaving as markdown: it swallows what
  // follows, and that is the author's business, not an error.
  assert.deepEqual(slots('```js\nconst a = 1;\n\n```slot idea-1\na\n'), []);
});

test('a slot needs exactly one usable id', () => {
  assert.match(err('```slot\nKeep?\n```'), /no id/);
  assert.match(err('```slot idea 1\nKeep?\n```'), /more than one word/);
  assert.match(err('```slot -idea/1\nKeep?\n```'), /not a usable slot id/);
});

test('a tilde fence works the same, and only its own marker closes it', () => {
  const md = ['~~~slot idea-1', '```', 'Keep?', '~~~'].join('\n');
  const found = slots(md);
  assert.deepEqual(
    found.map((s) => s.id),
    ['idea-1'],
  );
  assert.equal(found[0]!.prompt, '```\nKeep?');
});
