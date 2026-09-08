import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appliedVerb, changeLine } from '../src/index.js';

/**
 * The one line a landed row says about what changed (docs/fewer-approvals.md
 * FA-4). The row above it already names the page and the act, so this line is
 * only ever the thing neither of them can say: "Summary, 3 Next steps", "due
 * moved 12 to 24 Sep", "one line under Entra". A section keeps the heading's own
 * capitals, because the heading is the file's word for that part.
 */

test('a new meeting page names the sections it filled', () => {
  const line = changeLine({
    kind: 'note',
    targetPath: 'meetings/2026-09-04-nordkap-check-in.md',
    frontmatter: { type: 'meeting', title: 'Nordkap check-in' },
    body: [
      '## Summary',
      '',
      'Nordkap wants the SSO dates before the board meeting.',
      '',
      '## Next steps',
      '',
      '- Send the dates',
      '- Ask Åsa about the pilot',
      '- Book the follow-up',
    ].join('\n'),
  });
  assert.equal(line, 'Summary, 3 Next steps');
});

test('a section with one thing in it says the section, not a count of one', () => {
  const line = changeLine({
    kind: 'note',
    targetPath: 'meetings/2026-09-04-nordkap.md',
    frontmatter: { type: 'meeting' },
    body: '## Summary\n\nOne paragraph.\n\n## Next steps\n\n- Send the dates\n',
  });
  assert.equal(line, 'Summary, Next steps');
});

test('a to-do says who owes it and when', () => {
  // The PM's own to-do names them, because "you" is the fact they are checking:
  // a promise made in their name is the write they most want to catch (RC-2).
  assert.equal(
    changeLine({
      kind: 'note',
      targetPath: 'todos/2026-09-08-send-nordkap-the-sso-dates.md',
      frontmatter: { type: 'todo', due: '2026-09-11' },
      body: '> I will put the dates in writing this week.',
    }),
    'you · due 11 Sep',
  );
  assert.equal(
    changeLine({
      kind: 'note',
      targetPath: 'todos/2026-09-08-asa-scope-the-pilot.md',
      frontmatter: { type: 'todo', owner: '[[people/asa-lindqvist|Åsa]]' },
      body: '',
    }),
    'Asa Lindqvist · no date',
  );
});

test('an undated to-do says so, rather than saying nothing', () => {
  assert.equal(
    changeLine({
      kind: 'note',
      targetPath: 'todos/2026-09-08-scope-the-pilot.md',
      frontmatter: { type: 'todo' },
    }),
    'you · no date',
  );
});

test('a to-do line says who and when, and nothing about how Qale got it', () => {
  // The Todos view carries the "Qale heard this" mark. On a receipt line it was
  // noise, so the line stops at the date.
  assert.equal(
    changeLine({
      kind: 'note',
      targetPath: 'todos/2026-09-08-send-nordkap-the-sso-dates.md',
      frontmatter: { type: 'todo', due: '2026-09-11' },
    }),
    'you · due 11 Sep',
  );
  assert.equal(
    changeLine({
      kind: 'note',
      targetPath: 'todos/2026-09-08-asa-scope-the-pilot.md',
      frontmatter: { type: 'todo', owner: 'Åsa Lind' },
    }),
    'Åsa Lind · no date',
  );
});

test('a to-do that closed says who owed it and that it is done', () => {
  assert.equal(
    changeLine({
      kind: 'update',
      targetPath: 'todos/2026-09-08-confirm-the-scim-date.md',
      frontmatter: { commitment: 'done' },
      before: { type: 'todo', owner: 'Tom Berg', due: '2026-09-11' },
    }),
    'Tom Berg · done',
  );
  assert.equal(
    changeLine({
      kind: 'update',
      targetPath: 'todos/2026-09-08-send-the-dates.md',
      frontmatter: { commitment: 'dropped' },
      before: { type: 'todo' },
    }),
    'you · dropped',
  );
});

test('a page with no sections says its first line instead', () => {
  assert.equal(
    changeLine({
      kind: 'note',
      targetPath: 'insights/acme-wants-scim.md',
      frontmatter: { type: 'insight' },
      body: '# Acme wants SCIM\n\nThey will not renew without group mapping.\n',
    }),
    'They will not renew without group mapping.',
  );
});

test('a due date that moved says both ends, and keeps the month once', () => {
  assert.equal(
    changeLine({
      kind: 'update',
      targetPath: 'todos/2026-09-08-send-the-dates.md',
      frontmatter: { due: '2026-09-24' },
      before: { due: '2026-09-12' },
    }),
    'you · due moved 12 to 24 Sep',
  );
  assert.equal(
    changeLine({
      kind: 'update',
      targetPath: 'todos/2026-09-08-send-the-dates.md',
      frontmatter: { due: '2026-10-02' },
      before: { due: '2026-09-12' },
    }),
    'you · due moved 12 Sep to 2 Oct',
  );
  assert.equal(
    changeLine({
      kind: 'update',
      targetPath: 'todos/2026-09-08-send-the-dates.md',
      frontmatter: { due: '2026-09-24' },
    }),
    'you · due set to 24 Sep',
  );
});

test('a patch says how much moved, and where', () => {
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
});

test('an append says what it added, by section where it has one', () => {
  assert.equal(
    changeLine({
      kind: 'update',
      targetPath: 'meetings/2026-09-04-nordkap.md',
      append: '\n\n## Summary\n\nThey want the dates.\n',
    }),
    'Summary',
  );
  assert.equal(
    changeLine({
      kind: 'update',
      targetPath: 'customers/nordkap.md',
      append: '\n- Rebecca Holm owns the rollout.\n',
    }),
    'one line added',
  );
});

test('a field and a body change both get said, and a third is counted', () => {
  assert.equal(
    changeLine({
      kind: 'update',
      targetPath: 'todos/2026-09-08-send-the-dates.md',
      frontmatter: { due: '2026-09-24' },
      before: { due: '2026-09-12' },
      append: '\n- Åsa has the numbers.\n',
    }),
    'you · due moved 12 to 24 Sep, one line added',
  );
  assert.equal(
    changeLine({
      kind: 'update',
      targetPath: 'todos/2026-09-08-send-the-dates.md',
      frontmatter: { due: '2026-09-24', summary: 'Send the SSO dates' },
      before: { due: '2026-09-12' },
      append: '\n- Åsa has the numbers.\n',
    }),
    'you · due moved 12 to 24 Sep, summary now Send the SSO dates, and 1 more',
  );
});

test('the filing keys are never a change anyone reads', () => {
  assert.equal(
    changeLine({
      kind: 'update',
      targetPath: 'insights/acme.md',
      frontmatter: { tags: ['pricing'], type: 'insight', slug: 'acme' },
      before: {},
    }),
    '',
  );
});

test('a page that went, and a send, say nothing here', () => {
  assert.equal(changeLine({ kind: 'delete', targetPath: 'notes/untitled.md' }), '');
  assert.equal(changeLine({ kind: 'outbound', targetPath: null }), '');
});

test('the verb says what the write was: new, changed, removed', () => {
  assert.equal(appliedVerb({ kind: 'note', targetPath: 'insights/acme.md' }), 'New');
  assert.equal(appliedVerb({ kind: 'decision', targetPath: 'decisions/adopt.md' }), 'New');
  assert.equal(appliedVerb({ kind: 'update', targetPath: 'customers/nordkap.md' }), 'Changed');
  assert.equal(appliedVerb({ kind: 'delete', targetPath: 'notes/untitled.md' }), 'Removed');
  // A card that left the workspace (docs/receipt-redesign.md RC-3). It writes no
  // file, so nothing but the kind can say what it did, and its line is the
  // outbound receipt sentence rather than a change to a page.
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
