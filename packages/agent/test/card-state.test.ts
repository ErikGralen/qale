import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionCardState } from '@qale/application';
import { describeCardEdit, stripCardState, withCardState } from '../src/card-state.js';

/**
 * What the PM did to a card before approving it, told to the session that wrote
 * it (docs/learning-how-you-work.md ticket 7).
 *
 * The line exists so the next draft is written their way, so it has to say the
 * field and both versions, short. What it must never do is read as work: the
 * card landed as they left it, and a session that took the line for a failed
 * write would propose the whole thing again.
 */

const TICKET = {
  provider: 'jira',
  action: 'create_ticket',
  container: 'SCH',
  title: 'Swap request notifications',
  body: 'A manager cannot see a swap request today.\n\nAcceptance criteria:',
  labels: ['scheduling'],
  rationale: 'Åsa asked for it.',
};

function card(over: Partial<SessionCardState>): SessionCardState {
  return {
    id: 'p_1',
    kind: 'outbound',
    title: 'Swap request notifications',
    targetPath: null,
    status: 'accepted',
    payload: TICKET,
    ...over,
  };
}

test('a card kept as drafted says nothing', () => {
  assert.equal(describeCardEdit(TICKET, TICKET), null);
  const block = withCardState('what next?', [card({})]);
  assert.equal(block.includes('The PM changed'), false);
});

test('a changed summary is named as a summary, with what it now says', () => {
  const line = describeCardEdit(TICKET, {
    ...TICKET,
    title: 'Notify staff when a swap is requested',
  });
  assert.equal(line, 'The PM changed the summary to "Notify staff when a swap is requested".');
});

test('a changed body gives the first line of each version', () => {
  const line = describeCardEdit(TICKET, {
    ...TICKET,
    body: 'Staff never hear that a swap was asked for.\n\nAcceptance criteria:',
  });
  assert.equal(
    line,
    'The PM changed the description: it began "A manager cannot see a swap request today." and now begins "Staff never hear that a swap was asked for.".',
  );
});

test('a comment says comment, because that is what the PM sees', () => {
  const line = describeCardEdit(
    { action: 'comment_ticket', body: 'Deferred to H2.' },
    { action: 'comment_ticket', body: 'Deferred to H2, and Rebecca decides the date.' },
  );
  assert.equal(line?.startsWith('The PM changed the comment:'), true);
});

test('an answered question is on the line, with the question it answered', () => {
  const question = {
    text: 'Henrik has to review this for GDPR. Add `needs-legal`?',
    options: [{ label: 'Yes', labels: ['needs-legal'] }, { label: 'No' }],
  };
  const line = describeCardEdit(
    { ...TICKET, question },
    {
      ...TICKET,
      labels: ['scheduling', 'needs-legal'],
      question: { ...question, answer: 'Yes' },
    },
  );
  assert.equal(
    line,
    'The PM added the label needs-legal. ' +
      'The PM answered "Yes" to "Henrik has to review this for GDPR. Add `needs-legal`?"',
  );
});

test('the change rides under the card it belongs to, and comes off for display', () => {
  const prompt = 'thanks';
  const block = withCardState(prompt, [
    card({
      editedPayload: { ...TICKET, title: 'Notify staff when a swap is requested' },
    }),
  ]);
  const lines = block.split('\n');
  const at = lines.findIndex((l) => l.startsWith('- p_1 '));
  assert.equal(
    lines[at + 1],
    '  The PM changed the summary to "Notify staff when a swap is requested".',
  );
  // The PM typed one word and must read one word back.
  assert.equal(stripCardState(block), prompt);
});
