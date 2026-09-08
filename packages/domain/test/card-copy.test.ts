import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wantListChange,
  kindNoun,
  nounForDir,
  outboundReceipt,
  outboundTarget,
  outboundVerb,
  proposalHeadline,
  proposalLeadIn,
  sentLine,
  ticketFieldRows,
  vaultEffect,
  type HeadlineInput,
  type VaultEffectInput,
} from '../src/index.js';

/**
 * The words on a proposal card. These pin two things: the exact sentence per
 * card kind (a contract, since the PO reads it before every approval) and the
 * way it degrades when a fact is missing, which must always be a SHORTER true
 * line and never a guess.
 *
 * The bug this file exists for: a card led with a noun phrase borrowed from the
 * world ("New meeting: Nordkap QBR"), so the PO read it as the real act and
 * thought the app was about to book something. Vault cards also carried no
 * effect line at all, so the card made no claim and the reader supplied one.
 */

const headline = (input: HeadlineInput): string => proposalHeadline(input);
const effect = (input: VaultEffectInput): string | undefined => vaultEffect(input);

const meeting = {
  kind: 'note' as const,
  targetPath: 'meetings/2026-08-04-nordkap-qbr.md',
  frontmatter: {
    type: 'meeting',
    title: 'Nordkap QBR',
    summary: 'Nordkap QBR',
    date: '2026-08-04',
  },
};

// ---------------------------------------------------------------------------
// proposalHeadline
// ---------------------------------------------------------------------------

test('meeting: the act is writing the page up, and the day tells two apart', () => {
  assert.equal(headline(meeting), 'Write up Nordkap QBR, 4 Aug');
});

test('meeting: a missing or unreadable date shortens the line, with no stray comma', () => {
  const noDate = headline({
    ...meeting,
    frontmatter: { type: 'meeting', title: 'Nordkap QBR' },
  });
  assert.equal(noDate, 'Write up Nordkap QBR');
  assert.ok(!noDate.endsWith(','), 'a missing date must not leave a dangling comma');

  assert.equal(
    headline({ ...meeting, frontmatter: { type: 'meeting', title: 'Nordkap QBR', date: '' } }),
    'Write up Nordkap QBR',
  );
  assert.equal(
    headline({
      ...meeting,
      frontmatter: { type: 'meeting', title: 'Nordkap QBR', date: 'next tuesday' },
    }),
    'Write up Nordkap QBR',
  );
  // A date-shaped string that is not a date at all: no month 13, so no line.
  assert.equal(
    headline({
      ...meeting,
      frontmatter: { type: 'meeting', title: 'Nordkap QBR', date: '2026-13-04' },
    }),
    'Write up Nordkap QBR',
  );
});

test('meeting: with no title at all, the path names it', () => {
  assert.equal(
    headline({
      kind: 'note',
      targetPath: 'meetings/2026-08-04-nordkap-qbr.md',
      frontmatter: { type: 'meeting', date: '2026-08-04' },
    }),
    'Write up Nordkap QBR, 4 Aug',
  );
});

test('customer and person share one sentence: a page, not a person won or added', () => {
  assert.equal(
    headline({
      kind: 'note',
      targetPath: 'customers/nordkap.md',
      frontmatter: { type: 'customer', title: 'Nordkap' },
    }),
    'Add a page for Nordkap',
  );
  assert.equal(
    headline({
      kind: 'note',
      targetPath: 'people/asa-lind.md',
      frontmatter: { type: 'person', title: 'Åsa Lind' },
    }),
    'Add a page for Åsa Lind',
  );
});

test('person: the explicit title wins, since the slug folds away diacritics', () => {
  // Summary describes them, so it must never become the subject of the line.
  assert.equal(
    headline({
      kind: 'note',
      targetPath: 'people/asa-lind.md',
      frontmatter: { type: 'person', summary: 'Product owner, first real user' },
    }),
    'Add a page for Asa Lind',
  );
});

test('research: recorded, not raised', () => {
  assert.equal(
    headline({
      kind: 'note',
      targetPath: 'research/onboarding-drag.md',
      frontmatter: { type: 'research', title: 'Onboarding drag' },
    }),
    'Record a research page: Onboarding drag',
  );
});

test('a document, and any type with no line of its own, says it writes a document', () => {
  assert.equal(
    headline({
      kind: 'note',
      targetPath: 'notes/scim-rollout.md',
      frontmatter: { type: 'note', title: 'SCIM rollout' },
    }),
    'Write a document: SCIM rollout',
  );
  // No title in the payload ⇒ the path names it, wordmarks and all.
  assert.equal(
    headline({ kind: 'note', targetPath: 'notes/scim-rollout.md' }),
    'Write a document: SCIM Rollout',
  );
});

test('insight, decision and both todo lanes are unchanged', () => {
  assert.equal(
    headline({
      kind: 'note',
      targetPath: 'insights/onboarding-stalls-at-sso.md',
      frontmatter: { type: 'insight', summary: 'Onboarding stalls at SSO' },
    }),
    'Learned: Onboarding stalls at SSO',
  );
  assert.equal(
    headline({
      kind: 'decision',
      targetPath: 'decisions/defer-scim-to-q3.md',
      frontmatter: { type: 'decision', title: 'Defer SCIM to Q3' },
    }),
    'Decided: Defer SCIM to Q3',
  );
  assert.equal(
    headline({
      kind: 'note',
      targetPath: 'todos/send-daniel-the-draft.md',
      frontmatter: { type: 'todo', title: 'Send Daniel the draft' },
    }),
    'To do: Send Daniel the draft',
  );
  assert.equal(
    headline({
      kind: 'note',
      targetPath: 'todos/send-erik-the-draft.md',
      frontmatter: { type: 'todo', title: 'Send Erik the draft', owner: '[[people/daniel-ek]]' },
    }),
    'Waiting on Daniel Ek: Send Erik the draft',
  );
});

test('update: the page title, or the folder noun when there is none', () => {
  assert.equal(
    headline({ kind: 'update', targetPath: 'meetings/2026-08-04-nordkap-qbr.md' }),
    'Update Nordkap QBR',
  );
  assert.equal(headline({ kind: 'update' }), 'Update a page');
  // The `notes/` folder is Documents to the reader (docs/sidebar-ia.md, SB-3).
  assert.equal(nounForDir('notes'), 'a document');
  assert.equal(nounForDir('insights'), 'an insight');
  assert.equal(nounForDir('meetings'), 'the meeting notes');
  assert.equal(kindNoun('todos'), 'to-do');
  assert.equal(kindNoun('unknown'), 'page');
});

// The lead-in over a row's title: the act and the kind, in two words. The
// title alone read as the act, so "File the missing story under SCH-231"
// looked like approving the filing, not creating a to-do.

test('the lead-in says new or update, and what kind of thing', () => {
  const leadIn = (input: HeadlineInput): string => proposalLeadIn(input);
  const todo = { type: 'todo', title: 'Re-scope SCH-240' };
  // Own to-do and waiting-on to-do say the same thing; the owner is on the
  // facts line, so the name is never printed twice.
  assert.equal(leadIn({ kind: 'note', targetPath: 'todos/x.md', frontmatter: todo }), 'New to-do');
  assert.equal(
    leadIn({
      kind: 'note',
      targetPath: 'todos/x.md',
      frontmatter: { ...todo, owner: '[[people/rebecca-holm]]' },
    }),
    'New to-do',
  );
  assert.equal(leadIn({ kind: 'update', targetPath: 'todos/x.md' }), 'Update to-do');
  assert.equal(
    leadIn({ kind: 'note', targetPath: 'meetings/x.md', frontmatter: { type: 'meeting' } }),
    'New meeting notes',
  );
  assert.equal(leadIn({ kind: 'update', targetPath: 'meetings/x.md' }), 'Update meeting notes');
  assert.equal(leadIn({ kind: 'note', targetPath: 'notes/x.md', frontmatter: {} }), 'New document');
  assert.equal(leadIn({ kind: 'update', targetPath: 'notes/x.md' }), 'Update document');
  assert.equal(leadIn({ kind: 'decision', targetPath: 'decisions/x.md' }), 'New decision');
  assert.equal(leadIn({ kind: 'delete', targetPath: 'notes/x.md' }), 'Delete document');
  assert.equal(leadIn({ kind: 'delete', targetPath: 'decisions/x.md' }), 'Delete decision');
  // The frontmatter type wins over the folder for a new page.
  assert.equal(
    leadIn({ kind: 'note', targetPath: 'people/x.md', frontmatter: { type: 'customer' } }),
    'New customer',
  );
  // No folder and no type ⇒ the plain word, never a blank.
  assert.equal(leadIn({ kind: 'note' }), 'New page');
  assert.equal(leadIn({ kind: 'update' }), 'Update page');
});

test('a rule card and a new skill keep their own lead-in', () => {
  const leadIn = (input: HeadlineInput): string => proposalLeadIn(input);
  assert.equal(
    leadIn({
      kind: 'update',
      targetPath: 'skills/house-rules/SKILL.md',
      append: '- Always name the customer in a todo.\n',
    }),
    'Remember this',
  );
  assert.equal(
    leadIn({
      kind: 'update',
      targetPath: 'skills/house-rules/SKILL.md',
      patch: [
        {
          search: '## What you want from Qale\n\n- Shorter briefs.\n',
          replace: '## What you want from Qale\n',
        },
      ],
    }),
    'Stop this',
  );
  assert.equal(
    leadIn({
      kind: 'note',
      targetPath: 'skills/weekly-review/SKILL.md',
      frontmatter: { title: 'Weekly review' },
    }),
    'New skill',
  );
});

test('an instruction says the rule, whether it lands as an update or a new file', () => {
  assert.equal(
    headline({
      kind: 'update',
      targetPath: 'skills/house-rules/SKILL.md',
      append: '- Always name the customer in a todo.\n',
    }),
    'Remember this: Always name the customer in a todo.',
  );
  assert.equal(
    headline({
      kind: 'note',
      targetPath: 'skills/house-rules/SKILL.md',
      body: '# House rules\n\n## Your rules\n\n- Always name the customer in a todo.\n',
    }),
    'Remember this: Always name the customer in a todo.',
  );
  // Nothing to quote ⇒ the plain thing, never an empty "Remember this: ".
  assert.equal(
    headline({
      kind: 'update',
      targetPath: 'agents/librarian/AGENT.md',
      append: 'no bullets here',
    }),
    'A new standing instruction',
  );
});

test('outbound: the headline is the outbound target line', () => {
  assert.equal(
    headline({
      kind: 'outbound',
      outbound: { action: 'comment_ticket', targetId: 'PAY-142' },
    }),
    'Comment on PAY-142',
  );
  assert.equal(headline({ kind: 'outbound' }), 'Apply this change');
});

// ---------------------------------------------------------------------------
// vaultEffect
// ---------------------------------------------------------------------------

test('vaultEffect: an ordinary new page says nothing here, the lead-in and title already said it', () => {
  assert.equal(effect(meeting), undefined);
  assert.equal(
    effect({ kind: 'note', targetPath: 'people/asa-lind.md', frontmatter: { type: 'person' } }),
    undefined,
  );
  assert.equal(
    effect({ kind: 'note', targetPath: 'customers/nordkap.md', frontmatter: { type: 'customer' } }),
    undefined,
  );
  assert.equal(
    effect({
      kind: 'note',
      targetPath: 'insights/onboarding-stalls-at-sso.md',
      frontmatter: { type: 'insight' },
    }),
    undefined,
  );
  assert.equal(
    effect({
      kind: 'note',
      targetPath: 'research/onboarding-drag.md',
      frontmatter: { type: 'research' },
    }),
    undefined,
  );
});

// The headline is "Update <page>" and the diff is right below it. A sentence
// saying "edits a page" between the two is the headline with the page taken out.
test('vaultEffect: a plain update adds no line, the headline and the diff say it', () => {
  assert.equal(
    effect({ kind: 'update', targetPath: 'meetings/2026-08-04-nordkap-qbr.md' }),
    undefined,
  );
  // A rule still speaks: where it lands and what reads it are not on the card.
  assert.equal(
    effect({ kind: 'update', targetPath: 'skills/house-rules/SKILL.md' }),
    'Adds the rule to House Rules. Every session reads it from now on.',
  );
});

// What a decision replaces is the card's own "Replaces <title>" chip, two lines
// under the headline, and the headline itself already reads "Decided: …". A
// third sentence saying the same thing again is the one that gets skipped.
test('vaultEffect: a decision says nothing here, the headline already says it', () => {
  const decision: VaultEffectInput = {
    kind: 'decision',
    targetPath: 'decisions/defer-scim-to-q3.md',
    frontmatter: { type: 'decision' },
  };
  assert.equal(effect(decision), undefined);
});

test('vaultEffect: both todo lanes say nothing here, the facts line and title carry it', () => {
  assert.equal(
    effect({
      kind: 'note',
      targetPath: 'todos/send-daniel-the-draft.md',
      frontmatter: { type: 'todo' },
    }),
    undefined,
  );
  assert.equal(
    effect({
      kind: 'note',
      targetPath: 'todos/send-erik-the-draft.md',
      frontmatter: { type: 'todo', owner: 'Daniel' },
    }),
    undefined,
  );
});

test('vaultEffect: a standing instruction names the file it teaches', () => {
  assert.equal(
    effect({ kind: 'update', targetPath: 'skills/house-rules/SKILL.md' }),
    'Adds the rule to House Rules. Every session reads it from now on.',
  );
  // A path with nothing after the folder has no title to name. Degenerate, but
  // the sentence still has to land somewhere true rather than trail off.
  assert.equal(
    effect({ kind: 'update', targetPath: 'skills/' }),
    'Adds the rule to your house rules. Every session reads it from now on.',
  );
});

test('vaultEffect: a conventions rule says when it is read, not that everything reads it', () => {
  // A rule in a conventions skill is read at drafting time and nowhere else
  // (docs/conventions.md). The house-rules sentence would promise the opposite.
  assert.equal(
    effect({ kind: 'update', targetPath: 'skills/jira/SKILL.md' }),
    'Adds the rule to How you write tickets. Read whenever it drafts for Jira.',
  );
  // The file is written on first use, so the card that creates it is a `note`
  // and has to read the same as the one that appends to it.
  assert.equal(
    effect({ kind: 'note', targetPath: 'skills/confluence/SKILL.md' }),
    'Adds the rule to How you write pages. Read whenever it drafts for Confluence.',
  );
  // Every other skill keeps the sentence it had.
  assert.equal(
    effect({ kind: 'update', targetPath: 'skills/arrival/SKILL.md' }),
    'Adds the rule to Arrival. Every session reads it from now on.',
  );
});

/**
 * `propose_skill` writes a whole new skill, and it lands in the same folder a
 * rule does. A card that said "Remember this: <the last bullet in the file>"
 * would name one line of it and hide the rest.
 */
test('a new skill is a skill being written, not a rule being added to one', () => {
  const card = {
    kind: 'note' as const,
    targetPath: 'skills/weekly-roadmap-update/SKILL.md',
    frontmatter: { type: 'skill', title: 'Weekly roadmap update' },
    body: '## When\n\nMonday.\n\n## Read\n\n- The tickets that moved.\n',
  };
  assert.equal(headline(card), 'Write a skill: Weekly roadmap update');
  assert.equal(
    effect(card),
    'Creates a skill in Skills. Qale reaches for it when this work comes up again.',
  );
  // No title in the payload ⇒ the filename, de-slugged.
  assert.equal(
    headline({ ...card, frontmatter: { type: 'skill' } }),
    'Write a skill: Weekly Roadmap Update',
  );
  // The rules files keep the sentence they had, whichever card writes them.
  assert.equal(
    headline({
      kind: 'note',
      targetPath: 'skills/house-rules/SKILL.md',
      body: '## Your rules\n\n- Always name the customer.\n',
    }),
    'Remember this: Always name the customer.',
  );
  // And a rule appended to a skill is still a rule, not a skill being written.
  assert.equal(
    headline({
      kind: 'update',
      targetPath: 'skills/weekly-roadmap-update/SKILL.md',
      append: '\n- Lead with the epics that moved.',
    }),
    'Remember this: Lead with the epics that moved.',
  );
});

test('vaultEffect: a new page with no path still says nothing here', () => {
  assert.equal(effect({ kind: 'note', frontmatter: { type: 'insight' } }), undefined);
});

test('vaultEffect: outbound is not ours — outboundEffect owns those', () => {
  assert.equal(effect({ kind: 'outbound' }), undefined);
  assert.equal(effect({ kind: 'outbound', targetPath: 'meetings/x.md' }), undefined);
});

// ---------------------------------------------------------------------------
// Regressions, named for the bug
// ---------------------------------------------------------------------------

test('regression: a meeting card never reads "New meeting", and carries no effect line', () => {
  const line = headline(meeting);
  assert.ok(!/^New /.test(line), `headline must not lead with "New": ${line}`);
  // "meeting" as the name of the file being made is exactly what the PO read as
  // the real-world act. The subject is the meeting's own title, nothing else.
  assert.ok(!/\bmeetings?\b/i.test(line), `headline must not name the file "meeting": ${line}`);

  // The headline already says "Write up …": no effect line repeats it.
  assert.equal(effect(meeting), undefined);
});

test('regression: a customer card never reads "New customer", a person never "New person"', () => {
  const customer = headline({
    kind: 'note',
    targetPath: 'customers/nordkap.md',
    frontmatter: { type: 'customer', title: 'Nordkap' },
  });
  assert.ok(!customer.includes('New customer'), customer);
  assert.equal(customer, 'Add a page for Nordkap');

  const person = headline({
    kind: 'note',
    targetPath: 'people/asa-lind.md',
    frontmatter: { type: 'person', title: 'Åsa Lind' },
  });
  assert.ok(!person.includes('New person'), person);
  assert.equal(person, 'Add a page for Åsa Lind');
});

// ---------------------------------------------------------------------------
// The outbound strings, unchanged by the move out of the renderer
// ---------------------------------------------------------------------------

test('outboundVerb: one verb per action, and a default that claims nothing', () => {
  assert.equal(outboundVerb('update_page'), 'update the page');
  assert.equal(outboundVerb('comment_ticket'), 'post the comment');
  assert.equal(outboundVerb('create_ticket'), 'create the ticket');
  assert.equal(outboundVerb('create_event'), 'create the event');
  assert.equal(outboundVerb('update_event'), 'change the event');
  assert.equal(outboundVerb('respond_to_event'), 'reply');
  assert.equal(outboundVerb('who_knows'), 'apply it');
  assert.equal(outboundVerb(undefined), 'apply it');
});

test('ticketFieldRows: a row per field the draft set, and nothing for the rest', () => {
  assert.deepEqual(
    ticketFieldRows({
      action: 'create_ticket',
      labels: ['scheduling', ' '],
      priority: 'High',
      components: ['Rostering', 'Identity'],
    }),
    [
      { label: 'Labels', value: 'scheduling' },
      { label: 'Priority', value: 'High' },
      { label: 'Components', value: 'Rostering, Identity' },
    ],
  );
  // A draft that set none of them adds no rows: the card says what it does.
  assert.deepEqual(ticketFieldRows({ action: 'create_ticket', labels: [] }), []);
  assert.deepEqual(ticketFieldRows({ action: 'create_ticket' }), []);
});

test('outboundTarget: the same strings the renderer returned', () => {
  assert.equal(
    outboundTarget({ action: 'comment_ticket', targetId: 'PAY-142' }),
    'Comment on PAY-142',
  );
  assert.equal(outboundTarget({ action: 'comment_ticket' }), 'Comment on a ticket');
  assert.equal(
    outboundTarget({ action: 'create_ticket', container: 'PAY', title: 'SCIM group-mapping' }),
    'File a ticket in PAY: SCIM group-mapping',
  );
  assert.equal(
    outboundTarget({ action: 'create_ticket', container: 'PAY', issueType: 'Epic' }),
    'File a epic in PAY',
  );
  assert.equal(outboundTarget({ action: 'create_ticket' }), 'File a ticket');
  assert.equal(
    outboundTarget({ action: 'update_page', title: 'Rollout plan' }),
    'Update “Rollout plan”',
  );
  assert.equal(outboundTarget({ action: 'update_page' }), 'Update a page');
  assert.equal(
    outboundTarget({ action: 'create_event', title: 'Erik x Daniel: sync' }),
    'Add “Erik x Daniel: sync” to your calendar',
  );
  assert.equal(outboundTarget({ action: 'create_event' }), 'Add an event to your calendar');
  assert.equal(
    outboundTarget({ action: 'update_event', title: 'Nordkap sync' }),
    'Change “Nordkap sync”',
  );
  assert.equal(outboundTarget({ action: 'update_event' }), 'Change an event');
  assert.equal(
    outboundTarget({
      action: 'respond_to_event',
      responseStatus: 'declined',
      title: 'Nordkap sync',
    }),
    'Reply no to “Nordkap sync”',
  );
  assert.equal(
    outboundTarget({ action: 'respond_to_event', responseStatus: 'tentative' }),
    'Reply maybe to an invite',
  );
  assert.equal(outboundTarget({ action: 'respond_to_event' }), 'Reply yes to an invite');
  assert.equal(outboundTarget({ action: 'who_knows', title: 'Something' }), 'Apply “Something”');
  assert.equal(outboundTarget({}), 'Apply this change');
});

test('outboundReceipt: the same strings the renderer returned', () => {
  assert.equal(
    outboundReceipt({ action: 'update_page', title: 'Rollout plan' }),
    'Updated Rollout plan',
  );
  assert.equal(outboundReceipt({ action: 'update_page' }), 'Updated a page');
  assert.equal(
    outboundReceipt({ action: 'comment_ticket', targetId: 'PAY-142' }),
    'Commented on PAY-142',
  );
  assert.equal(outboundReceipt({ action: 'comment_ticket' }), 'Commented on a ticket');
  assert.equal(
    outboundReceipt({ action: 'create_ticket', container: 'PAY', issueType: 'Epic' }),
    'Created a epic in PAY',
  );
  assert.equal(outboundReceipt({ action: 'create_ticket' }), 'Created a ticket');
  assert.equal(
    outboundReceipt({ action: 'create_event', title: 'Nordkap sync' }),
    'Added Nordkap sync to your calendar',
  );
  assert.equal(outboundReceipt({ action: 'create_event' }), 'Added an event to your calendar');
  assert.equal(
    outboundReceipt({ action: 'update_event', title: 'Nordkap sync' }),
    'Changed Nordkap sync in your calendar',
  );
  assert.equal(outboundReceipt({ action: 'update_event' }), 'Changed an event in your calendar');
  assert.equal(
    outboundReceipt({
      action: 'respond_to_event',
      responseStatus: 'accepted',
      title: 'Nordkap sync',
    }),
    'Replied yes to Nordkap sync',
  );
  assert.equal(outboundReceipt({ action: 'respond_to_event' }), 'Replied yes to an invite');
  assert.equal(outboundReceipt({ action: 'who_knows', title: 'Something' }), 'Applied Something');
  assert.equal(outboundReceipt({}), 'Applied the change');
});

// ---------------------------------------------------------------------------
// House rules for every line this module can produce
// ---------------------------------------------------------------------------

test('every card has a headline, and every line it adds is a short clean sentence', () => {
  const cards: VaultEffectInput[] = [
    meeting,
    { kind: 'note', targetPath: 'people/asa-lind.md', frontmatter: { type: 'person' } },
    { kind: 'note', targetPath: 'customers/nordkap.md', frontmatter: { type: 'customer' } },
    { kind: 'note', targetPath: 'todos/x.md', frontmatter: { type: 'todo' } },
    { kind: 'note', targetPath: 'todos/x.md', frontmatter: { type: 'todo', owner: 'Daniel' } },
    { kind: 'note', targetPath: 'insights/x.md', frontmatter: { type: 'insight' } },
    { kind: 'decision', targetPath: 'decisions/x.md' },
    { kind: 'update', targetPath: 'meetings/x.md' },
    { kind: 'update', targetPath: 'skills/house-rules/SKILL.md' },
  ];
  for (const card of cards) {
    // A plain update adds no line at all. Where there is one, it is a sentence.
    const line = vaultEffect(card);
    if (line !== undefined) {
      assert.ok(line.endsWith('.'), `${card.targetPath}: expected a sentence, got ${line}`);
      assert.ok(!line.includes('—'), `${card.targetPath}: no em dashes in card copy`);
      assert.ok(
        line.length <= 130,
        `${card.targetPath}: too long at ${line.length} chars: ${line}`,
      );
    }

    const head = proposalHeadline(card as HeadlineInput);
    assert.ok(head.length > 0, `${card.targetPath}: every card needs a headline`);
    assert.ok(!head.includes('—'), `${card.targetPath}: no em dashes in a headline`);
    // The card leads with what the app does, never with a bare noun phrase.
    assert.ok(
      !/^New /.test(head),
      `${card.targetPath}: headline must not lead with "New": ${head}`,
    );
  }
});

// ---------------------------------------------------------------------------
// A deletion — the one card that takes something away
// ---------------------------------------------------------------------------

test('a deletion says the one word for what it does, and names the page', () => {
  assert.equal(headline({ kind: 'delete', targetPath: 'notes/untitled.md' }), 'Delete Untitled');
  assert.equal(
    effect({ kind: 'delete', targetPath: 'notes/untitled.md' }),
    'Deletes the page from Documents. Nothing else changes.',
  );
});

test('a deletion never borrows the standing-instruction line', () => {
  // A rules file cannot be deleted through a card (the tool refuses it), but a
  // stored row from a build where it could must not read as a rule being added.
  const card = { kind: 'delete' as const, targetPath: 'skills/house-rules/SKILL.md' };
  assert.equal(headline(card), 'Delete House Rules');
  assert.match(effect(card)!, /^Deletes the page/);
});

test('a deletion with no path still says something true', () => {
  assert.equal(headline({ kind: 'delete' }), 'Delete a page');
  assert.equal(
    effect({ kind: 'delete' }),
    'Deletes the page from your workspace. Nothing else changes.',
  );
});

/**
 * A line on the "What you want from Qale" list (docs/learning-how-you-work.md
 * ticket 8) lands as a patch over the whole section, so the card reads the
 * line back off the patch: what was added, or what comes off.
 */
const WANT_SECTION =
  '## What you want from Qale\n\n' +
  'What you want from Qale. Keep it to about ten lines.\n\n' +
  '- Tell me who is waiting for something before it ships, and what they were told.';

test('a line on the "What you want from Qale" list says the line, and which way it goes', () => {
  const added = {
    kind: 'update' as const,
    targetPath: 'skills/house-rules/SKILL.md',
    patch: [
      { search: WANT_SECTION, replace: `${WANT_SECTION}\n- Tell me what changed in the API.` },
    ],
  };
  assert.equal(headline(added), 'Remember this: Tell me what changed in the API.');
  assert.equal(
    effect(added),
    'Adds to what you want from Qale. Every session reads the list before it starts.',
  );

  const removed = {
    kind: 'update' as const,
    targetPath: 'skills/house-rules/SKILL.md',
    patch: [{ search: WANT_SECTION, replace: WANT_SECTION.split('\n').slice(0, -1).join('\n') }],
  };
  assert.equal(
    headline(removed),
    'Stop this: Tell me who is waiting for something before it ships, and what they were told.',
  );
  assert.equal(effect(removed), 'Removes from what you want from Qale. Nothing else changes.');

  // A patch on another section of a rules file is an ordinary instruction card.
  const other = {
    kind: 'update' as const,
    targetPath: 'skills/house-rules/SKILL.md',
    patch: [{ search: '## Your rules\n\n- Old', replace: '## Your rules\n\n- Old\n- New' }],
  };
  assert.equal(headline(other), 'A new standing instruction');
  assert.equal(effect(other), 'Adds the rule to House Rules. Every session reads it from now on.');

  // A bullet appended under the heading by hand reads as an add too.
  assert.deepEqual(
    wantListChange({ append: '\n\n## What you want from Qale\n\n- Keep me posted.' }),
    { op: 'add', line: 'Keep me posted.' },
  );
  assert.equal(wantListChange({ append: '\n- Keep me posted.' }), null);
});

test('sentLine: every send names an item the receipt can open', () => {
  // The comment and the page edit address something that already exists.
  assert.deepEqual(sentLine({ action: 'comment_ticket', targetId: 'PAY-142' }), {
    act: 'Commented on',
    item: 'PAY-142',
    url: undefined,
  });
  assert.deepEqual(sentLine({ action: 'update_page', targetId: '98311', title: 'Rollout plan' }), {
    act: 'Updated',
    item: '98311',
    name: 'Rollout plan',
    url: undefined,
  });
  // A created ticket has no key until the send comes back with one, so the line
  // names the key it made and says where it put it.
  assert.deepEqual(
    sentLine({
      action: 'create_ticket',
      container: 'Nordkap',
      targetId: 'PAY-171',
      url: 'https://example.atlassian.net/browse/PAY-171',
    }),
    {
      act: 'Created',
      item: 'PAY-171',
      name: 'PAY-171',
      url: 'https://example.atlassian.net/browse/PAY-171',
      tail: 'in Nordkap',
    },
  );
  assert.deepEqual(sentLine({ action: 'create_event', eventId: 'ev1', title: 'Nordkap sync' }), {
    act: 'Added',
    item: 'ev1',
    name: 'Nordkap sync',
    url: undefined,
    tail: 'to your calendar',
  });
  assert.deepEqual(sentLine({ action: 'update_event', eventId: 'ev1', title: 'Nordkap sync' }), {
    act: 'Changed',
    item: 'ev1',
    name: 'Nordkap sync',
    url: undefined,
    tail: 'in your calendar',
  });
  assert.deepEqual(
    sentLine({
      action: 'respond_to_event',
      eventId: 'ev1',
      responseStatus: 'declined',
      title: 'Nordkap sync',
    }),
    { act: 'Replied no to', item: 'ev1', name: 'Nordkap sync', url: undefined },
  );
});

test('sentLine: a send with nothing to open keeps the whole sentence', () => {
  // A card accepted before the send stamped its result carries no id, so the
  // line stays the flat receipt and draws no chip that opens nothing.
  assert.deepEqual(sentLine({ action: 'create_ticket', container: 'PAY' }), {
    act: 'Created a ticket in PAY',
  });
  assert.deepEqual(sentLine({ action: 'comment_ticket' }), { act: 'Commented on a ticket' });
  assert.deepEqual(sentLine({ action: 'who_knows', targetId: 'X-1', title: 'Something' }), {
    act: 'Applied Something',
  });
  // An empty address is no address: the chip would open a blank tab.
  assert.equal(sentLine({ action: 'create_event', eventId: 'ev1', url: '  ' }).url, undefined);
});
