import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appliedVerb, changeLine } from '../src/index.js';

/**
 * The one phrase a landed row says about what changed (docs/fewer-approvals.md
 * FA-4, thinned 2026-09-09).
 *
 * Only a page that was updated says anything, and only about its body: "3
 * places changed", "one line under Entra", "2 lines added". A new page, a
 * to-do and a page that went are told by their title alone, and no line ever
 * reads out a property ("processing now processed"). The chevron opens the
 * diff, and that is where a properties change belongs.
 */

test('an update says how much of the body moved, and where', () => {
  assert.equal(
    changeLine({
      kind: 'update',
      targetPath: 'notes/rollout-runbook.md',
      patch: [
        {
          search: '## Entra\n\n- Turn on SCIM',
          replace: '## Entra\n\n- Turn on SCIM\n- Map the groups',
        },
      ],
    }),
    'one line under Entra',
  );
  assert.equal(
    changeLine({
      kind: 'update',
      targetPath: 'notes/rollout-runbook.md',
      patch: [{ search: 'Ships in Q2.', replace: 'Ships in Q3.' }],
    }),
    'one line rewritten',
  );
  assert.equal(
    changeLine({
      kind: 'update',
      targetPath: 'notes/rollout-runbook.md',
      patch: [
        { search: 'Ships in Q2.', replace: 'Ships in Q3.' },
        { search: 'Åsa owns it.', replace: 'Tom owns it.' },
        { search: 'Pilot in May.', replace: 'Pilot in June.' },
      ],
    }),
    '3 places changed',
  );
});

test('an append says how much it added, never the sections it filled', () => {
  // "Summary, 2 Notes" was a table of contents for text the row cannot show
  // (Erik, 2026-09-09). The chevron shows the text itself.
  assert.equal(
    changeLine({
      kind: 'update',
      targetPath: 'meetings/2026-09-04-nordkap.md',
      append: '\n\n## Summary\n\nThey want the dates.\n',
    }),
    'one line added',
  );
  assert.equal(
    changeLine({
      kind: 'update',
      targetPath: 'customers/nordkap.md',
      append: '\n- Rebecca Holm owns the rollout.\n- Åsa has the numbers.\n',
    }),
    '2 lines added',
  );
});

test('a property that moved is never read out on the row', () => {
  // A meeting that finished processing, a person told something today, a
  // summary that was rewritten: all of it read as a properties diff out loud.
  assert.equal(
    changeLine({
      kind: 'update',
      targetPath: 'meetings/2026-09-04-nordkap.md',
      frontmatter: { processing: 'processed' },
    }),
    '',
  );
  assert.equal(
    changeLine({
      kind: 'update',
      targetPath: 'people/lena-strand.md',
      frontmatter: { last_told: '2026-09-10' },
    }),
    '',
  );
  assert.equal(
    changeLine({
      kind: 'update',
      targetPath: 'todos/2026-09-08-send-the-dates.md',
      frontmatter: { due: '2026-09-24' },
    }),
    '',
  );
});

test('a page that is new, or gone, or a send, says nothing here', () => {
  // The title IS the change on every one of these.
  assert.equal(
    changeLine({
      kind: 'note',
      targetPath: 'meetings/2026-09-04-nordkap-check-in.md',
      frontmatter: { type: 'meeting', title: 'Nordkap check-in' },
      body: '## Summary\n\nThey want the dates.\n\n## Next steps\n\n- Send the dates\n',
    }),
    '',
  );
  assert.equal(
    changeLine({
      kind: 'note',
      targetPath: 'todos/2026-09-08-send-nordkap-the-sso-dates.md',
      frontmatter: { type: 'todo', due: '2026-09-11' },
      body: '> I will put the dates in writing this week.',
    }),
    '',
  );
  assert.equal(
    changeLine({
      kind: 'decision',
      targetPath: 'decisions/scim-q2.md',
      frontmatter: { type: 'decision', title: 'SCIM ships in Q2' },
      body: 'We ship group mapping in Q2.',
    }),
    '',
  );
  assert.equal(changeLine({ kind: 'delete', targetPath: 'notes/untitled.md' }), '');
  assert.equal(changeLine({ kind: 'outbound', targetPath: null }), '');
});

test('the verb says what the write was: new, changed, removed', () => {
  assert.equal(appliedVerb({ kind: 'note', targetPath: 'insights/acme.md' }), 'New');
  assert.equal(appliedVerb({ kind: 'decision', targetPath: 'decisions/adopt.md' }), 'New');
  assert.equal(appliedVerb({ kind: 'update', targetPath: 'customers/nordkap.md' }), 'Changed');
  assert.equal(appliedVerb({ kind: 'delete', targetPath: 'notes/untitled.md' }), 'Removed');
  // A card that left the workspace (docs/receipt-redesign.md RC-3). It writes no
  // file, so nothing but the kind can say what it did, and the green card it
  // keeps says what happened to the thing it touched.
  assert.equal(appliedVerb({ kind: 'outbound' }), 'Sent');
  assert.equal(changeLine({ kind: 'outbound' }), '');
});

test('a to-do leads with its own word, so the row names the kind', () => {
  assert.equal(
    appliedVerb({
      kind: 'note',
      targetPath: 'todos/2026-09-08-send-the-dates.md',
      frontmatter: { type: 'todo' },
    }),
    'New todo',
  );
  assert.equal(
    appliedVerb({
      kind: 'update',
      targetPath: 'todos/2026-09-08-send-the-dates.md',
      frontmatter: { commitment: 'done' },
    }),
    'Todo done',
  );
  assert.equal(
    appliedVerb({
      kind: 'update',
      targetPath: 'todos/2026-09-08-send-the-dates.md',
      frontmatter: { commitment: 'dropped' },
    }),
    'Todo done',
  );
  // A to-do that was only re-dated is still an ordinary change to a to-do.
  assert.equal(
    appliedVerb({
      kind: 'update',
      targetPath: 'todos/2026-09-08-send-the-dates.md',
      frontmatter: { due: '2026-09-24' },
    }),
    'Todo changed',
  );
  // A to-do that went is a page that went, like any other.
  assert.equal(
    appliedVerb({ kind: 'delete', targetPath: 'todos/2026-09-08-send-the-dates.md' }),
    'Removed',
  );
});
