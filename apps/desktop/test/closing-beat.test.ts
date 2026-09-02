import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NoteRefDTO, ProposalDTO, VaultTreeDTO } from '@qale/ipc';
import { waitingElsewhere, type AttentionItem } from '../src/renderer/src/lib/attention.js';
import { whereThingsStand } from '../src/renderer/src/lib/where-things-stand.js';
import {
  clearedInbox,
  receiptEntry,
  receiptOf,
  receiptSummary,
} from '../src/renderer/src/components/inbox/cardMeta.js';

/**
 * The closing beat (docs/closing-beat.md): what the three surfaces say when the
 * work is done. Every line they print is a fact the workspace already holds, so
 * these tests are about where each fact comes from and when it stays off the
 * page. A strip that invents a line, or an Inbox that greets a first-time PO
 * with a tally, is the failure this replaced.
 */

/** Local-clock instants, like the attention tests: the day is the PO's. */
const at = (day: number, hour: number, minute = 0): number =>
  new Date(2026, 6, day, hour, minute).getTime();

/** Tuesday 28 July 2026, 09:00. */
const NOW = at(28, 9);

const iso = (day: number): string => `2026-07-${String(day).padStart(2, '0')}`;

function note(type: NoteRefDTO['type'], slug: string, extra: Partial<NoteRefDTO> = {}): NoteRefDTO {
  return {
    path: `${type}s/${slug}.md`,
    slug,
    type,
    title: slug,
    summary: '',
    mtime: NOW,
    ...extra,
  };
}

function tree(...notes: NoteRefDTO[]): VaultTreeDTO {
  const groups = new Map<string, NoteRefDTO[]>();
  for (const n of notes) groups.set(n.type, [...(groups.get(n.type) ?? []), n]);
  return {
    groups: [...groups].map(([type, ns]) => ({
      type: type as NoteRefDTO['type'],
      notes: ns,
    })) as VaultTreeDTO['groups'],
  };
}

function card(id: string, extra: Partial<ProposalDTO> = {}): ProposalDTO {
  return {
    id,
    kind: 'note',
    sessionId: 'session-1',
    skill: null,
    targetPath: null,
    payload: {} as ProposalDTO['payload'],
    rationale: id,
    evidence: [],
    inference: false,
    asked: false,
    status: 'accepted',
    created: NOW,
    resolved: NOW,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Home: where things stand
// ---------------------------------------------------------------------------

test('the strip has nothing to say about an empty workspace', () => {
  assert.deepEqual(whereThingsStand(null, NOW), []);
  assert.deepEqual(whereThingsStand(tree(), NOW), []);
});

test('the next meeting is the soonest one ahead, however far ahead it is', () => {
  const lines = whereThingsStand(
    tree(
      note('meeting', 'yesterday', { date: iso(27), time: '10:00' }),
      note('meeting', 'far', { date: iso(31), time: '09:00' }),
      note('meeting', 'thursday', { date: iso(30), time: '14:00' }),
    ),
    NOW,
  );
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.kind, 'meeting');
  assert.equal(lines[0]!.label, 'thursday');
  assert.deepEqual(lines[0]!.target, { open: 'doc', path: 'meetings/thursday.md' });
  // Inside the week the day is named, and the clock rides along.
  assert.ok(lines[0]!.meta.endsWith(' 14:00'), lines[0]!.meta);
  assert.ok(!/\d/.test(lines[0]!.meta.replace(' 14:00', '')), lines[0]!.meta);
});

test('a meeting further off than a week is dated, not named by weekday', () => {
  const lines = whereThingsStand(tree(note('meeting', 'later', { date: '2026-09-08' })), NOW);
  assert.match(lines[0]!.meta, /8 Sep|Sep 8/);
});

test('a cancelled meeting is never the next one', () => {
  const lines = whereThingsStand(
    tree(note('meeting', 'called-off', { date: iso(30), eventStatus: 'cancelled' })),
    NOW,
  );
  assert.deepEqual(lines, []);
});

test('waiting on others reads off open todos that name an owner', () => {
  const lines = whereThingsStand(
    tree(
      note('todo', 'mine', { due: iso(29) }),
      note('todo', 'closed', { owner: '[[people/sara]]', due: iso(28), lifecycle: 'done' }),
      note('todo', 'later', { owner: 'Sara Lindqvist', due: iso(31) }),
      note('todo', 'soonest', { owner: '[[people/daniel-berg]]', due: iso(29) }),
    ),
    NOW,
  );
  const waiting = lines.find((l) => l.kind === 'waiting');
  assert.ok(waiting);
  // Two people are still owed something, and the soonest one is named.
  assert.equal(waiting.label, 'Waiting on 2 people, next: Daniel Berg');
  assert.equal(waiting.meta, 'due tomorrow');
  assert.deepEqual(waiting.target, { open: 'todos' });
});

test('one person is named rather than counted', () => {
  const lines = whereThingsStand(
    tree(
      note('todo', 'a', { owner: '[[people/daniel-berg]]', due: iso(29) }),
      note('todo', 'b', { owner: '[[people/daniel-berg]]' }),
    ),
    NOW,
  );
  assert.equal(lines[0]!.label, 'Waiting on Daniel Berg');
});

test('a commitment with no date says so instead of guessing one', () => {
  const lines = whereThingsStand(tree(note('todo', 'a', { owner: 'Sara' })), NOW);
  assert.equal(lines[0]!.meta, 'no date');
});

test('the PO’s own commitments are never in the strip: they are attention', () => {
  assert.deepEqual(whereThingsStand(tree(note('todo', 'mine', { due: iso(28) })), NOW), []);
});

test('the last theme that moved is the newest one, and it opens', () => {
  const lines = whereThingsStand(
    tree(
      note('theme', 'old', { mtime: at(20, 9) }),
      note('theme', 'pricing', { mtime: at(26, 9) }),
    ),
    NOW,
  );
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.kind, 'theme');
  assert.equal(lines[0]!.label, 'pricing');
  assert.equal(lines[0]!.meta, 'updated 2d ago');
  assert.deepEqual(lines[0]!.target, { open: 'doc', path: 'themes/pricing.md' });
});

test('a theme older than a fortnight is history, not orientation', () => {
  const justInside = whereThingsStand(
    tree(note('theme', 'pricing', { mtime: NOW - 14 * 86_400_000 })),
    NOW,
  );
  assert.equal(justInside.length, 1);
  const justOutside = whereThingsStand(
    tree(note('theme', 'pricing', { mtime: NOW - 14 * 86_400_000 - 1 })),
    NOW,
  );
  assert.deepEqual(justOutside, []);
});

test('the three lines read in order, and a line with nothing behind it is absent', () => {
  const full = whereThingsStand(
    tree(
      note('meeting', 'standup', { date: iso(30), time: '09:00' }),
      note('todo', 'theirs', { owner: 'Sara', due: iso(30) }),
      note('theme', 'pricing', { mtime: at(27, 9) }),
    ),
    NOW,
  );
  assert.deepEqual(
    full.map((l) => l.kind),
    ['meeting', 'waiting', 'theme'],
  );
  const partial = whereThingsStand(tree(note('theme', 'pricing', { mtime: at(27, 9) })), NOW);
  assert.deepEqual(
    partial.map((l) => l.kind),
    ['theme'],
  );
});

// ---------------------------------------------------------------------------
// Inbox: the moment and the state
// ---------------------------------------------------------------------------

test('judging something this sitting turns the empty Inbox into a receipt', () => {
  assert.deepEqual(clearedInbox({ accepted: 3, rejected: 1 }, true), { mode: 'receipt' });
  assert.deepEqual(clearedInbox({ accepted: 0, rejected: 1 }, false), { mode: 'receipt' });
});

test('an Inbox that was already empty stays quiet, and explains itself once', () => {
  assert.deepEqual(clearedInbox({ accepted: 0, rejected: 0 }, false), {
    mode: 'quiet',
    explain: true,
  });
  assert.deepEqual(clearedInbox({ accepted: 0, rejected: 0 }, true), {
    mode: 'quiet',
    explain: false,
  });
});

test('the tally names only what happened', () => {
  assert.equal(receiptSummary({ accepted: 2, rejected: 1 }), 'Approved 2, discarded 1');
  assert.equal(receiptSummary({ accepted: 2, rejected: 0 }), 'Approved 2');
  assert.equal(receiptSummary({ accepted: 0, rejected: 2 }), 'Discarded 2');
});

// ---------------------------------------------------------------------------
// Chat: the resolved-cards receipt
// ---------------------------------------------------------------------------

test('every kind of card has its own past tense', () => {
  assert.deepEqual(receiptEntry(card('a', { kind: 'note', targetPath: 'insights/pricing.md' })), {
    id: 'a',
    verb: 'Created',
    note: { title: 'Pricing', path: 'insights/pricing.md' },
  });
  assert.deepEqual(receiptEntry(card('b', { kind: 'update', targetPath: 'themes/pricing.md' })), {
    id: 'b',
    verb: 'Updated',
    note: { title: 'Pricing', path: 'themes/pricing.md' },
  });
  assert.deepEqual(
    receiptEntry(card('c', { kind: 'decision', targetPath: 'decisions/2026-07-28-scim.md' })),
    { id: 'c', verb: 'Decided', note: { title: 'SCIM', path: 'decisions/2026-07-28-scim.md' } },
  );
  // An outbound card touched no note, so it carries the sentence instead.
  assert.deepEqual(
    receiptEntry(
      card('d', {
        kind: 'outbound',
        payload: {
          action: 'comment_ticket',
          targetId: 'PAY-142',
        } as unknown as ProposalDTO['payload'],
      }),
    ),
    { id: 'd', verb: 'Sent', sent: 'Commented on PAY-142' },
  );
});

test('a create card with no target path still names what it wrote', () => {
  const entry = receiptEntry(
    card('a', {
      kind: 'note',
      payload: { path: 'insights/scim.md' } as unknown as ProposalDTO['payload'],
    }),
  );
  assert.deepEqual(entry.note, { title: 'SCIM', path: 'insights/scim.md' });
});

test('the receipt counts both answers and reports consequences for one', () => {
  const receipt = receiptOf([
    card('c', { status: 'rejected', created: NOW + 2 }),
    card('a', {
      status: 'accepted',
      created: NOW,
      targetPath: 'themes/pricing.md',
      kind: 'update',
    }),
    card('b', { status: 'accepted', created: NOW + 1, targetPath: 'insights/scim.md' }),
    // Neither of these was a decision of the PO's, so neither is in the tally.
    card('d', { status: 'pending' }),
    card('e', { status: 'withdrawn' as ProposalDTO['status'] }),
  ]);
  assert.equal(receipt.accepted, 2);
  assert.equal(receipt.rejected, 1);
  assert.deepEqual(
    receipt.entries.map((e) => `${e.verb} ${e.note?.title}`),
    ['Updated Pricing', 'Created SCIM'],
  );
});

test('a session that proposed nothing gets no receipt', () => {
  assert.deepEqual(receiptOf([]), { accepted: 0, rejected: 0, entries: [] });
});

// ---------------------------------------------------------------------------
// The door
// ---------------------------------------------------------------------------

function item(id: string, extra: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id,
    kind: 'card',
    label: id,
    meta: 'to approve',
    tone: 'brand',
    target: { open: 'inbox' },
    ...extra,
  };
}

test('the door counts what waits elsewhere, never this session’s own cards', () => {
  const items = [
    item('card:p1'),
    item('card:p2'),
    item('card:p3'),
    item('question:s2', { kind: 'question', target: { open: 'inbox' } }),
    // The librarian's own question can always wait, so no door counts it.
    item('question:s3', { kind: 'question', quiet: true }),
    // The clock's items are attention, but they are not waiting in the Inbox.
    item('todo:todos/a.md', { kind: 'todo' }),
  ];
  assert.equal(waitingElsewhere(items, ['p1', 'p2']), 2);
  assert.equal(waitingElsewhere(items, []), 4);
  assert.equal(waitingElsewhere([], ['p1']), 0);
});
