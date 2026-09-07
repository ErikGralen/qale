import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerOutboundQuestion, zOutboundPayload } from '../src/index.js';

/**
 * The question a draft carries (docs/learning-how-you-work.md ticket 6).
 *
 * The draft is written the safe way and asks about the one thing it left out,
 * so two things have to hold: a card with no question parses exactly as it did
 * before, and an answer can only ever ADD what its option names. An option that
 * could rewrite the address would turn one click into a send nobody read.
 */

const TICKET = {
  provider: 'jira',
  system: 'jira',
  action: 'create_ticket',
  container: 'SCH',
  issueType: 'Story',
  title: 'Swap request notifications',
  body: 'A manager cannot see a swap request today.',
  labels: ['scheduling'],
  rationale: 'Åsa asked for it in the steering meeting.',
};

test('a draft parses with no question, exactly as before', () => {
  const parsed = zOutboundPayload.safeParse(TICKET);
  assert.equal(parsed.success, true);
  assert.equal(parsed.data?.question, undefined);
});

test('a question rides on the payload with its options', () => {
  const parsed = zOutboundPayload.safeParse({
    ...TICKET,
    question: {
      text: 'Henrik has to review this for GDPR. Your other SCH stories mark that with `needs-legal`. Add it?',
      options: [{ label: 'Yes', labels: ['needs-legal'] }, { label: 'No' }],
    },
  });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data?.question?.options.length, 2);
  assert.deepEqual(parsed.data?.question?.options[0]?.labels, ['needs-legal']);
  // Nobody has answered yet, and the card says so by saying nothing.
  assert.equal(parsed.data?.question?.answer, undefined);
});

test('three options is a form, and a form is refused', () => {
  const parsed = zOutboundPayload.safeParse({
    ...TICKET,
    question: {
      text: 'Which label?',
      options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
    },
  });
  assert.equal(parsed.success, false);
});

test('an answer adds what its option carries, and keeps the labels the draft set', () => {
  const question = {
    text: 'Add `needs-legal`?',
    options: [{ label: 'Yes', labels: ['needs-legal'], priority: 'High' }, { label: 'No' }],
  };
  const answered = answerOutboundQuestion({ ...TICKET, question }, 'Yes');
  assert.deepEqual(answered.labels, ['scheduling', 'needs-legal']);
  assert.equal(answered.priority, 'High');
  assert.equal(answered.question?.answer, 'Yes');
  // And the payload still parses, so what the card sends is what accept reads.
  assert.equal(zOutboundPayload.safeParse(answered).success, true);
});

test('the option that adds nothing still records the answer', () => {
  const question = {
    text: 'Add `needs-legal`?',
    options: [{ label: 'Yes', labels: ['needs-legal'] }, { label: 'No' }],
  };
  const answered = answerOutboundQuestion({ ...TICKET, question }, 'No');
  assert.deepEqual(answered.labels, ['scheduling']);
  assert.equal(answered.question?.answer, 'No');
});

test('a label that names no option changes nothing', () => {
  const payload = {
    ...TICKET,
    question: { text: 'Add `needs-legal`?', options: [{ label: 'Yes', labels: ['needs-legal'] }] },
  };
  assert.deepEqual(answerOutboundQuestion(payload, 'Maybe'), payload);
  assert.deepEqual(answerOutboundQuestion({ ...TICKET }, 'Yes'), TICKET);
});
