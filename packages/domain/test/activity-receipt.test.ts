import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activityAction,
  activityLine,
  appliedReceipt,
  labelLine,
  readAppliedReceipt,
} from '../src/index.js';

// The receipt for a write that needed no card: the Activity row's sentence, and
// the quiet line the chat shows. Both are written once, here, because the tool
// result and the session view have to say the same thing about the same write.

test('a new note reads as a thing the agent created', () => {
  const input = {
    kind: 'note',
    targetPath: 'insights/acme-wants-scim.md',
    frontmatter: { title: 'Acme wants SCIM' },
  };
  assert.equal(activityAction(input), 'created');
  assert.equal(activityLine(input), 'I created Acme wants SCIM.');
});

test('a note with no title falls back to its own filename', () => {
  const line = activityLine({ kind: 'note', targetPath: 'meetings/2026-07-08-sprint-planning.md' });
  assert.equal(line, 'I created Sprint Planning.');
});

test('a decision says so, because a decision is not an ordinary page', () => {
  const line = activityLine({
    kind: 'decision',
    targetPath: 'decisions/adopt-workos.md',
    frontmatter: { title: 'Adopt WorkOS' },
  });
  assert.equal(line, 'I recorded a decision: Adopt WorkOS.');
});

test('an edit reads as an update', () => {
  const input = {
    kind: 'update',
    targetPath: 'customers/nordkap.md',
    frontmatter: { title: 'Nordkap' },
  };
  assert.equal(activityAction(input), 'updated');
  assert.equal(activityLine(input), 'I updated Nordkap.');
});

test('a rule appended to a skill quotes the rule, not the file', () => {
  const input = {
    kind: 'update',
    targetPath: 'skills/house-rules/SKILL.md',
    append: '\n- Create a person note for anyone a source names.',
  };
  assert.equal(activityAction(input), 'remembered');
  assert.equal(
    activityLine(input),
    'I remembered a rule: Create a person note for anyone a source names.',
  );
});

test('a rules file written whole reads the rule off the end of the body', () => {
  const input = {
    kind: 'note',
    targetPath: 'skills/jira/SKILL.md',
    frontmatter: { title: 'How we use Jira' },
    body: '# How we use Jira\n\n## Standing instructions\n\n- Put the roadmap label on every ticket.',
  };
  assert.equal(activityAction(input), 'remembered');
  assert.equal(activityLine(input), 'I remembered a rule: Put the roadmap label on every ticket.');
});

test('a skill with no rule in it is a skill the agent created', () => {
  const input = {
    kind: 'note',
    targetPath: 'skills/weekly-roadmap/SKILL.md',
    frontmatter: { title: 'Weekly roadmap update' },
    body: '## When\n\nEvery Monday.\n',
  };
  assert.equal(activityAction(input), 'created');
  assert.equal(activityLine(input), 'I created Weekly roadmap update.');
});

test('a delete says what went', () => {
  const line = activityLine({ kind: 'delete', targetPath: 'notes/untitled.md' });
  assert.equal(line, 'I deleted Untitled.');
});

test('the chat line survives the round trip through a tool result', () => {
  const first = appliedReceipt('created', 'Acme wants SCIM');
  const output = `${first}.\nIt is in the workspace now and nothing is waiting on the PM.`;
  assert.deepEqual(readAppliedReceipt(output), { verb: 'Created', detail: 'Acme wants SCIM' });
  assert.deepEqual(
    readAppliedReceipt(`${appliedReceipt('remembered', '"Always tag the project"')}.`),
    {
      verb: 'Added to rules',
      detail: '"Always tag the project"',
    },
  );
});

test('a write still waiting on the PM reads back as nothing', () => {
  assert.equal(
    readAppliedReceipt('Proposed new note (p_x): insights/foo.md. Awaiting review.'),
    null,
  );
  assert.equal(readAppliedReceipt(''), null);
  assert.equal(readAppliedReceipt(undefined), null);
  // The tag alone, with no verb behind it, is not a receipt either.
  assert.equal(readAppliedReceipt('Applied: something else entirely'), null);
});

test('a label row says what the page now carries, and names the tags', () => {
  assert.equal(
    labelLine({ title: 'Q3 plan', summary: 'One line about the plan.', tags: ['pricing'] }),
    'I added a summary and a tag to Q3 plan: pricing.',
  );
  assert.equal(
    labelLine({ title: 'Renewals', summary: 'One line.', tags: ['pricing', 'checkout'] }),
    'I added a summary and 2 tags to Renewals: pricing, checkout.',
  );
  assert.equal(
    labelLine({ title: 'Renewals', summary: 'One line.', tags: [] }),
    'I added a summary to Renewals.',
  );
  assert.equal(
    labelLine({ title: 'Renewal risk', summary: null, tags: ['pricing'] }),
    'I tagged Renewal risk: pricing.',
  );
});
