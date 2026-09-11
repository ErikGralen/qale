import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AskOptionDTO, AskQuestionDTO } from '@qale/ipc';
import { isAnswered, isBatch, isWritten } from '../src/renderer/src/lib/ask-card.js';

/** What makes Next (or Answer, on the last step) live on a question card. */

function question(options: AskOptionDTO[] = []): AskQuestionDTO {
  return { header: 'Scope', question: 'Is it in scope for October?', options, multiSelect: false };
}

const KEEP = { label: 'Keep it' };
const DROP = { label: 'Drop it' };

test('a written question can be answered with an empty box', () => {
  const q = question();
  assert.equal(isWritten(q), true);
  assert.equal(isAnswered(q, { selected: [] }), true);
  assert.equal(isAnswered(q, { selected: [], written: '' }), true);
  assert.equal(isAnswered(q, { selected: [], written: 'One thing is missing.' }), true);
});

test('an option question waits for a pick', () => {
  const q = question([KEEP, DROP]);
  assert.equal(isAnswered(q, { selected: [] }), false);
  assert.equal(isAnswered(q, { selected: ['Keep it'] }), true);
  // "Something else" on its own is an answer too.
  assert.equal(isAnswered(q, { selected: [], written: 'Neither.' }), true);
});

test('clearing every box on a batch is an answer, not a blank', () => {
  const q = question([
    { ...KEEP, description: 'What it costs', checked: true },
    { ...DROP, description: 'What it costs' },
  ]);
  assert.equal(isBatch(q), true);
  assert.equal(isAnswered(q, { selected: [] }), true);
});
