import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DERIVED_LABEL_REASON,
  NEEDS_SUMMARY_FIELD,
  SUMMARY_AT_FIELD,
  SUMMARY_OF_FIELD,
  TAG_REASON,
  type ActivityRecord,
  type CreateActivityInput,
  type NoteType,
} from '@qale/domain';
import { parseNote, serializeNote } from '@qale/markdown';
import {
  acceptLabels,
  acceptSummary,
  acceptTags,
  runSummaryPass,
  type SummaryCandidate,
} from '../src/index.js';
import { contentHash } from '../src/use-cases/proposals.js';
import type { IndexedNote, IndexPort, UseCaseContext, VaultPort } from '../src/ports.js';

/**
 * The summary pass end to end (IM-6, and the tags of ticket 3) with the model
 * stood in for: which notes it asks about, what it writes, what it leaves
 * alone, and that a pass is one commit.
 */

function inote(path: string, type: NoteType, extra: Partial<IndexedNote> = {}): IndexedNote {
  return {
    path,
    slug: path.replace(/\.md$/, ''),
    type,
    layer: 'authored',
    title: path,
    summary: '',
    lifecycle: null,
    hasBody: true,
    mtime: Date.UTC(2026, 7, 1),
    frontmatter: {},
    links: [],
    ...extra,
  } as IndexedNote;
}

/**
 * The Activity double: the port, plus the rows it was handed. A pass with no
 * activity port is the default, so every other test in this file also holds the
 * pass to writing nothing extra and throwing nothing when the log is absent.
 */
function fakeActivity() {
  const rows: ActivityRecord[] = [];
  const port = {
    record: (input: CreateActivityInput, now: number) => {
      const row: ActivityRecord = { ...input, id: `a_${rows.length + 1}`, at: now, reverted: null };
      rows.push(row);
      return row;
    },
    list: () => [...rows].reverse(),
    get: (id: string) => rows.find((r) => r.id === id) ?? null,
    latestLearned: () => [],
    markReverted: () => {},
  };
  return { rows, port };
}

function fakeCtx(
  files: Record<string, string>,
  notes: IndexedNote[],
  opts: { activity?: boolean } = {},
) {
  const store = new Map(Object.entries(files));
  const commits: { paths: string[]; message: string }[] = [];
  const activity = fakeActivity();
  const reindexed: string[] = [];
  const reads: string[] = [];
  const vault = {
    readRaw: async (p: string) => {
      reads.push(p);
      return store.get(p) ?? null;
    },
    writeNote: async (p: string, fm: Record<string, unknown>, body: string) => {
      store.set(p, serializeNote(fm, body));
      return { path: p, slug: p.replace(/\.md$/, ''), frontmatter: fm, body };
    },
  } as unknown as VaultPort;
  const index = {
    all: () => notes,
    get: (p: string) => notes.find((n) => n.path === p) ?? null,
    reindex: (n: { path: string }) => void reindexed.push(n.path),
  } as unknown as IndexPort;
  const git = {
    commitPaths: async (paths: string[], message: string) => void commits.push({ paths, message }),
    // The hash a commit would have, by the order the commits were made. The
    // Activity row reads the newest commit that touched its own note.
    history: async (p: string) =>
      commits
        .map((c, i) => ({ ...c, hash: `c${i + 1}` }))
        .filter((c) => c.paths.includes(p))
        .reverse()
        .map((c) => ({ hash: c.hash, date: '2026-09-05', message: c.message, author: 'qale' })),
  } as unknown as UseCaseContext['git'];
  const clock = { now: () => '2026-09-05T09:00:00.000Z' };
  const ctx = {
    vault,
    index,
    git,
    clock,
    ...(opts.activity ? { activity: activity.port } : {}),
  } as unknown as UseCaseContext;
  return { ctx, store, commits, reindexed, reads, rows: activity.rows };
}

/** A model that answers by path, and remembers what it was asked. */
function fakeModel(answers: Record<string, string | null> = {}) {
  const asked: SummaryCandidate[] = [];
  const summarise = async (c: SummaryCandidate): Promise<string | null> => {
    asked.push(c);
    return c.path in answers ? (answers[c.path] ?? null) : `One line about ${c.title}.`;
  };
  return { summarise, asked };
}

const fm = (path: string, store: Map<string, string>) => parseNote(store.get(path)!).frontmatter;

test('a note whose summary is its title is summarised, marked, reindexed and committed once', async () => {
  const { ctx, store, commits, reindexed } = fakeCtx(
    {
      'notes/q3-plan.md':
        '---\ntype: note\ntitle: Q3 plan\nsummary: Q3 plan\n---\n\nShip SCIM before pricing.\n',
    },
    [inote('notes/q3-plan.md', 'note', { title: 'Q3 plan' })],
  );
  const model = fakeModel();

  const res = await runSummaryPass(ctx, { summarise: model.summarise });

  assert.deepEqual(res.asked, ['notes/q3-plan.md']);
  assert.deepEqual(res.written, ['notes/q3-plan.md']);
  assert.deepEqual(reindexed, ['notes/q3-plan.md']);
  assert.deepEqual(commits, [{ paths: ['notes/q3-plan.md'], message: 'maintenance: labels' }]);
  assert.equal(model.asked[0]?.title, 'Q3 plan');
  assert.match(model.asked[0]?.body ?? '', /Ship SCIM before pricing/);

  const next = fm('notes/q3-plan.md', store);
  assert.equal(next['summary'], 'One line about Q3 plan.');
  assert.equal(next[SUMMARY_AT_FIELD], '2026-09-05');
  assert.equal(next[SUMMARY_OF_FIELD], contentHash(parseNote(store.get('notes/q3-plan.md')!).body));
  assert.equal(next['title'], 'Q3 plan', 'the rest of the frontmatter is kept');
  assert.match(store.get('notes/q3-plan.md')!, /Ship SCIM before pricing\./, 'body untouched');
});

test('a mirror, a labelled note, a tagged research page and an empty body are skipped', async () => {
  // The body as parsed keeps the blank line after the frontmatter block.
  const body = '\nNordkap wants SSO by October.\n';
  const marked = `---\ntype: note\nsummary: Nordkap asked for SSO by October, tied to their renewal.\n${SUMMARY_AT_FIELD}: 2026-08-01\n${SUMMARY_OF_FIELD}: ${contentHash(body)}\n---\n${body}`;
  const { ctx, commits } = fakeCtx(
    {
      'tickets/jira/PAY-1.md': '---\ntype: ticket\nsummary: PAY-1\n---\n\nA ticket body.\n',
      'notes/nordkap.md': marked,
      'research/product.md':
        "---\ntype: research\nsummary: product\ntags: ['product']\n---\n\nWhat we sell.\n",
      'notes/empty.md': '---\ntype: note\nsummary: empty\n---\n\n',
      // A real summary and a tag: nothing left to label.
      'notes/real.md':
        "---\ntype: note\ntitle: Real\nsummary: A line an agent wrote about pricing tiers.\ntags: ['pricing']\n---\n\nPricing tiers.\n",
    },
    [
      inote('tickets/jira/PAY-1.md', 'ticket', { title: 'PAY-1' }),
      inote('notes/nordkap.md', 'note', { title: 'nordkap' }),
      inote('research/product.md', 'research', { title: 'product' }),
      inote('notes/empty.md', 'note', { title: 'empty', hasBody: false }),
      inote('notes/real.md', 'note', { title: 'Real' }),
    ],
  );
  const model = fakeModel();

  const res = await runSummaryPass(ctx, { summarise: model.summarise });

  assert.deepEqual(res.asked, [], 'nothing qualified');
  assert.deepEqual(res.written, []);
  assert.equal(commits.length, 0, 'no write, no commit');
});

test('a body that changed since the marker is summarised again', async () => {
  const { ctx, store } = fakeCtx(
    {
      'notes/roadmap.md': `---\ntype: note\nsummary: An old line about the roadmap.\n${SUMMARY_AT_FIELD}: 2026-08-01\n${SUMMARY_OF_FIELD}: stale\n---\n\nThe roadmap moved to Q4.\n`,
    },
    [inote('notes/roadmap.md', 'note', { title: 'roadmap' })],
  );
  const model = fakeModel({ 'notes/roadmap.md': 'The roadmap now lands in Q4.' });

  const res = await runSummaryPass(ctx, { summarise: model.summarise });

  assert.deepEqual(res.written, ['notes/roadmap.md']);
  const next = fm('notes/roadmap.md', store);
  assert.equal(next['summary'], 'The roadmap now lands in Q4.');
  assert.equal(next[SUMMARY_OF_FIELD], contentHash('\nThe roadmap moved to Q4.\n'));
});

test('a bad model answer leaves the note alone that pass', async () => {
  const files = {
    'notes/a.md': '---\ntype: note\ntitle: A\nsummary: A\n---\n\nBody of A.\n',
    'notes/b.md': '---\ntype: note\ntitle: B\nsummary: B\n---\n\nBody of B.\n',
    'notes/c.md': '---\ntype: note\ntitle: C\nsummary: C\n---\n\nBody of C.\n',
  };
  const { ctx, store, commits } = fakeCtx(files, [
    inote('notes/a.md', 'note', { title: 'A' }),
    inote('notes/b.md', 'note', { title: 'B' }),
    inote('notes/c.md', 'note', { title: 'C' }),
  ]);
  const model = fakeModel({
    'notes/a.md': 'Two lines\nabout A.',
    'notes/b.md': 'x'.repeat(201),
    'notes/c.md': null,
  });

  const res = await runSummaryPass(ctx, { summarise: model.summarise });

  assert.equal(res.asked.length, 3);
  assert.deepEqual(res.written, []);
  assert.equal(commits.length, 0);
  for (const [path, raw] of Object.entries(files)) assert.equal(store.get(path), raw);
});

test('acceptSummary strips wrapping quotes and refuses the rest', () => {
  assert.equal(acceptSummary('"Nordkap asked for SSO."'), 'Nordkap asked for SSO.');
  assert.equal(acceptSummary('  Plain.  '), 'Plain.');
  assert.equal(acceptSummary(''), null);
  assert.equal(acceptSummary('   '), null);
  assert.equal(acceptSummary(null), null);
  assert.equal(acceptSummary('a\nb'), null);
  assert.equal(acceptSummary('y'.repeat(200)), 'y'.repeat(200));
  assert.equal(acceptSummary('y'.repeat(201)), null);
});

test('needs_summary is deleted, never set false, and a meeting qualifies too', async () => {
  const { ctx, store } = fakeCtx(
    {
      'meetings/2026-09-01-nordkap.md': `---\ntype: meeting\ndate: 2026-09-01\nsummary: Nordkap check-in\n${NEEDS_SUMMARY_FIELD}: true\n---\n\n# Nordkap check-in\n\nThey want SCIM first.\n`,
    },
    [inote('meetings/2026-09-01-nordkap.md', 'meeting', { title: 'Nordkap check-in' })],
  );
  const model = fakeModel({
    'meetings/2026-09-01-nordkap.md': 'Nordkap wants SCIM before anything else.',
  });

  const res = await runSummaryPass(ctx, { summarise: model.summarise });

  assert.deepEqual(res.written, ['meetings/2026-09-01-nordkap.md']);
  const raw = store.get('meetings/2026-09-01-nordkap.md')!;
  assert.ok(!raw.includes(NEEDS_SUMMARY_FIELD), 'the key is gone');
  const next = parseNote(raw).frontmatter;
  assert.equal(next['summary'], 'Nordkap wants SCIM before anything else.');
  assert.equal(next['date'], '2026-09-01');
});

test('the limit is honoured, oldest first, and a pass is one commit', async () => {
  const day = (d: number) => Date.UTC(2026, 7, d);
  const { ctx, commits } = fakeCtx(
    {
      'notes/new.md': '---\ntype: note\ntitle: New\nsummary: New\n---\n\nNewest.\n',
      'notes/old.md': '---\ntype: note\ntitle: Old\nsummary: Old\n---\n\nOldest.\n',
      'notes/mid.md': '---\ntype: note\ntitle: Mid\nsummary: Mid\n---\n\nMiddle.\n',
    },
    [
      inote('notes/new.md', 'note', { title: 'New', mtime: day(3) }),
      inote('notes/old.md', 'note', { title: 'Old', mtime: day(1) }),
      inote('notes/mid.md', 'note', { title: 'Mid', mtime: day(2) }),
    ],
  );
  const model = fakeModel();

  const res = await runSummaryPass(ctx, { summarise: model.summarise, limit: 2 });

  assert.deepEqual(res.asked, ['notes/old.md', 'notes/mid.md']);
  assert.deepEqual(res.written, ['notes/old.md', 'notes/mid.md']);
  assert.equal(commits.length, 1);
  assert.deepEqual(commits[0]?.paths, ['notes/old.md', 'notes/mid.md']);

  // The next pass picks up what the first left, and nothing it already wrote.
  const again = await runSummaryPass(ctx, { summarise: model.summarise, limit: 2 });
  assert.deepEqual(again.asked, ['notes/new.md']);
  assert.equal(commits.length, 2);
});

test('a body that moved while the model was answering is not labelled', async () => {
  const { ctx, store, commits } = fakeCtx(
    { 'notes/live.md': '---\ntype: note\ntitle: Live\nsummary: Live\n---\n\nFirst draft.\n' },
    [inote('notes/live.md', 'note', { title: 'Live' })],
  );
  const summarise = async (): Promise<string> => {
    store.set(
      'notes/live.md',
      '---\ntype: note\ntitle: Live\nsummary: Live\n---\n\nSecond draft.\n',
    );
    return 'A line about the first draft.';
  };

  const res = await runSummaryPass(ctx, { summarise });

  assert.deepEqual(res.asked, ['notes/live.md']);
  assert.deepEqual(res.written, []);
  assert.equal(commits.length, 0);
  assert.match(store.get('notes/live.md')!, /summary: Live/);
});

/**
 * The tag half (docs/background-system.md ticket 3). A note with no tags is a
 * candidate even when its summary is fine, the model picks from the tags in
 * use, and everything it did not say plainly writes nothing.
 */

const TAGGED_WORLD = [
  inote('insights/anchor.md', 'insight', { title: 'Anchor', frontmatter: { tags: ['pricing'] } }),
  inote('research/pricing.md', 'research', {
    title: 'Pricing',
    frontmatter: { tags: ['pricing'] },
  }),
  inote('notes/sso.md', 'note', {
    title: 'SSO',
    frontmatter: { tags: ['checkout', 'a whole phrase'] },
  }),
];

test('a note with no tags is a candidate, and the tags in use are handed to the model', async () => {
  const { ctx, store, commits } = fakeCtx(
    {
      'notes/renewals.md':
        '---\ntype: note\ntitle: Renewals\nsummary: What the renewal calls keep coming back to.\n---\n\nNordkap and Kranelund both asked about price.\n',
    },
    [...TAGGED_WORLD, inote('notes/renewals.md', 'note', { title: 'Renewals' })],
  );
  const model = fakeModel({
    'notes/renewals.md': 'A line the pass will not use.\ntags: pricing, renewals',
  });

  const res = await runSummaryPass(ctx, { summarise: model.summarise });

  assert.deepEqual(res.asked, ['notes/renewals.md'], 'a real summary, no tags: still a candidate');
  assert.deepEqual(res.written, ['notes/renewals.md']);
  assert.equal(commits.length, 1);
  // Most used first, and only tag-shaped words: "a whole phrase" is not one.
  assert.deepEqual(model.asked[0]?.tagsInUse, ['pricing', 'checkout']);
  assert.equal(model.asked[0]?.wantsTags, true);
  assert.equal(model.asked[0]?.wantsSummary, false);

  const next = fm('notes/renewals.md', store);
  assert.deepEqual(next['tags'], ['pricing', 'renewals']);
  assert.equal(
    next['summary'],
    'What the renewal calls keep coming back to.',
    'a note that only needed tags keeps its summary',
  );
  assert.equal(next[SUMMARY_AT_FIELD], undefined, 'and no summary was written, so no date');
  assert.equal(
    next[SUMMARY_OF_FIELD],
    contentHash('\nNordkap and Kranelund both asked about price.\n'),
  );
});

test('a decision is tagged but never summarised', async () => {
  const { ctx, store } = fakeCtx(
    {
      'decisions/2026-08-01-sso.md':
        '---\ntype: decision\ntitle: SSO first\nsummary: We ship SSO before SCIM.\n---\n\nNordkap needs it for the renewal.\n',
    },
    [...TAGGED_WORLD, inote('decisions/2026-08-01-sso.md', 'decision', { title: 'SSO first' })],
  );
  const model = fakeModel({
    'decisions/2026-08-01-sso.md': 'A line nobody asked for.\ntags: enterprise-auth',
  });

  await runSummaryPass(ctx, { summarise: model.summarise });

  const next = fm('decisions/2026-08-01-sso.md', store);
  assert.deepEqual(next['tags'], ['enterprise-auth']);
  assert.equal(next['summary'], 'We ship SSO before SCIM.');
});

test('the model may say "no tags", and the note is not asked about again', async () => {
  const { ctx, store, commits } = fakeCtx(
    {
      'notes/scratch.md':
        '---\ntype: note\ntitle: Scratch\nsummary: Two lines from Tuesday that never became anything.\n---\n\nCall Ida. Check the export.\n',
    },
    [...TAGGED_WORLD, inote('notes/scratch.md', 'note', { title: 'Scratch' })],
  );
  const model = fakeModel({ 'notes/scratch.md': 'A line the pass will not use.\ntags: none' });

  const res = await runSummaryPass(ctx, { summarise: model.summarise });

  assert.deepEqual(res.asked, ['notes/scratch.md']);
  assert.equal(commits.length, 1, 'the marker is a write, and one commit carries it');
  const raw = store.get('notes/scratch.md')!;
  assert.equal(raw.includes('tags:'), false, 'no tags key at all, never an empty one');
  assert.equal(
    fm('notes/scratch.md', store)[SUMMARY_OF_FIELD],
    contentHash('\nCall Ida. Check the export.\n'),
  );

  // The marker is the whole point: the same body is never asked about twice.
  const again = await runSummaryPass(ctx, { summarise: model.summarise });
  assert.deepEqual(again.asked, []);
});

test('a tagged note with a fresh summary is not a candidate', async () => {
  const body = '\nWhat Nordkap asked for.\n';
  const { ctx, commits, reads } = fakeCtx(
    {
      'notes/nordkap.md': `---\ntype: note\nsummary: What Nordkap asked for on the renewal call.\ntags: ['pricing']\n${SUMMARY_AT_FIELD}: 2026-08-01\n${SUMMARY_OF_FIELD}: ${contentHash(body)}\n---\n${body}`,
    },
    [...TAGGED_WORLD, inote('notes/nordkap.md', 'note', { title: 'Nordkap' })],
  );
  const model = fakeModel();

  const res = await runSummaryPass(ctx, { summarise: model.summarise });

  assert.deepEqual(res.asked, []);
  assert.equal(commits.length, 0);
  assert.equal(
    reads.includes('insights/anchor.md'),
    false,
    'a tagged insight is not even opened: the index already says it is settled',
  );
});

test('an answer the pass cannot read writes nothing, and a bad tag line writes no tag', async () => {
  const files = {
    'notes/json.md':
      '---\ntype: note\ntitle: JSON\nsummary: A summary somebody wrote.\n---\n\nBody of the JSON note.\n',
    'notes/wordy.md':
      '---\ntype: note\ntitle: Wordy\nsummary: Another summary somebody wrote.\n---\n\nBody of the wordy note.\n',
  };
  const { ctx, store } = fakeCtx(files, [
    ...TAGGED_WORLD,
    inote('notes/json.md', 'note', { title: 'JSON' }),
    inote('notes/wordy.md', 'note', { title: 'Wordy' }),
  ]);
  const model = fakeModel({
    'notes/json.md': '{\n  "summary": "A line.",\n  "tags": ["pricing"]\n}',
    'notes/wordy.md': 'A line.\ntags: a whole sentence about pricing, ANOTHER!!!, ok',
  });

  const res = await runSummaryPass(ctx, { summarise: model.summarise });

  assert.deepEqual(res.written, ['notes/wordy.md'], 'the unreadable answer wrote nothing');
  assert.equal(store.get('notes/json.md'), files['notes/json.md']);
  const next = fm('notes/wordy.md', store);
  assert.deepEqual(next['tags'], ['ok'], 'the words that are not tags are dropped, the tag stays');
});

test('acceptTags takes the workspace spelling, one word, at most two', () => {
  const inUse = ['Pricing', 'enterprise-auth'];
  assert.deepEqual(acceptTags('tags: pricing', inUse), ['Pricing']);
  assert.deepEqual(acceptTags('tags: enterprise-auth, mobile', inUse), [
    'enterprise-auth',
    'mobile',
  ]);
  assert.deepEqual(acceptTags('tags: a, b, c', inUse), ['a', 'b']);
  assert.deepEqual(acceptTags('tags: none', inUse), []);
  assert.deepEqual(acceptTags('tags:', inUse), []);
  assert.deepEqual(acceptTags(null, inUse), []);
  assert.deepEqual(acceptTags('tags: two words', inUse), []);
  assert.deepEqual(acceptTags('tags: ["pricing"]', inUse), ['Pricing']);
});

test('acceptLabels reads the summary line, the tags line, and refuses the rest', () => {
  assert.deepEqual(acceptLabels('One line.\ntags: pricing', ['pricing']), {
    summary: 'One line.',
    tags: ['pricing'],
    answered: true,
  });
  assert.deepEqual(acceptLabels('One line.'), { summary: 'One line.', tags: [], answered: true });
  assert.deepEqual(acceptLabels('One line.\nAnd another.'), {
    summary: null,
    tags: [],
    answered: false,
  });
  assert.deepEqual(acceptLabels(null), { summary: null, tags: [], answered: false });
});

// ---------------------------------------------------------------------------
// The Activity row (docs/background-system.md ticket 3). A label lands with no
// card, so the row is what the PM reads afterwards and what "Put it back" runs.
// ---------------------------------------------------------------------------

test('every note the pass labelled leaves one row, with the pass commit and a restore', async () => {
  const { ctx, rows, commits } = fakeCtx(
    {
      'notes/q3-plan.md':
        '---\ntype: note\ntitle: Q3 plan\nsummary: Q3 plan\n---\n\nShip SCIM before pricing.\n',
      'notes/renewals.md':
        '---\ntype: note\ntitle: Renewals\nsummary: Renewals\n---\n\nWhat is up in November.\n',
    },
    [
      ...TAGGED_WORLD,
      inote('notes/q3-plan.md', 'note', { title: 'Q3 plan' }),
      inote('notes/renewals.md', 'note', { title: 'Renewals' }),
    ],
    { activity: true },
  );
  const model = fakeModel({
    'notes/q3-plan.md': 'One line about the plan.\ntags: pricing',
    'notes/renewals.md': 'One line about renewals.\ntags: pricing, checkout',
  });

  await runSummaryPass(ctx, { summarise: model.summarise });

  assert.equal(commits.length, 1, 'one pass, one commit');
  assert.deepEqual(
    rows.map((r) => r.path),
    ['notes/q3-plan.md', 'notes/renewals.md'],
  );
  assert.deepEqual(
    rows.map((r) => r.line),
    [
      'I added a summary and a tag to Q3 plan: pricing.',
      'I added a summary and 2 tags to Renewals: pricing, checkout.',
    ],
  );
  for (const row of rows) {
    assert.equal(row.action, 'labelled');
    assert.equal(row.proposalId, null, 'no card made this write');
    assert.equal(row.sessionId, null, 'and no chat was running');
    assert.equal(row.skill, null);
    // The commit the pass just made, so the row can undo that write and no
    // other. Both notes landed in it.
    assert.deepEqual(row.revert, { commit: 'c1', undo: 'restore' });
    assert.equal(row.reverted, null);
  }
});

test('a row carries the policy sentence for what it wrote', async () => {
  const { ctx, rows } = fakeCtx(
    {
      'notes/q3-plan.md':
        '---\ntype: note\ntitle: Q3 plan\nsummary: Q3 plan\n---\n\nShip SCIM before pricing.\n',
      'insights/renewal-risk.md':
        '---\ntype: insight\ntitle: Renewal risk\nsummary: Two customers named the same gap.\n---\n\nBoth asked for SSO.\n',
    },
    [
      ...TAGGED_WORLD,
      inote('notes/q3-plan.md', 'note', { title: 'Q3 plan' }),
      inote('insights/renewal-risk.md', 'insight', { title: 'Renewal risk' }),
    ],
    { activity: true },
  );
  const model = fakeModel({
    'notes/q3-plan.md': 'One line about the plan.\ntags: pricing',
    'insights/renewal-risk.md': 'One line about the risk.\ntags: pricing',
  });

  await runSummaryPass(ctx, { summarise: model.summarise });

  // An insight is tagged and never summarised, so its row says why a tag needs
  // no card. Both sentences are the policy's own.
  assert.deepEqual(
    rows.map((r) => [r.line, r.reason]),
    [
      ['I added a summary and a tag to Q3 plan: pricing.', DERIVED_LABEL_REASON],
      ['I tagged Renewal risk: pricing.', TAG_REASON],
    ],
  );
});

test('a pass that labelled nothing leaves no row', async () => {
  const body = '\nWhat Nordkap asked for.\n';
  const { ctx, rows } = fakeCtx(
    {
      // Nothing to ask about: a fresh summary and a tag already on the file.
      'notes/nordkap.md': `---\ntype: note\nsummary: What Nordkap asked for on the renewal call.\ntags: ['pricing']\n${SUMMARY_AT_FIELD}: 2026-08-01\n${SUMMARY_OF_FIELD}: ${contentHash(body)}\n---\n${body}`,
      // Asked about, and the model named no tag: the marker is written, the
      // labels are not, and there is nothing for the PM to read.
      'notes/scratch.md':
        '---\ntype: insight\ntitle: Scratch\nsummary: Two lines from Tuesday.\n---\n\nCall Ida.\n',
    },
    [
      ...TAGGED_WORLD,
      inote('notes/nordkap.md', 'note', { title: 'Nordkap' }),
      inote('notes/scratch.md', 'insight', { title: 'Scratch' }),
    ],
    { activity: true },
  );
  const model = fakeModel({ 'notes/scratch.md': 'A line the pass will not use.\ntags: none' });

  const res = await runSummaryPass(ctx, { summarise: model.summarise });

  assert.deepEqual(res.written, ['notes/scratch.md'], 'the marker landed');
  assert.deepEqual(rows, [], 'and no row says a label did');
});

test('a workspace with no Activity log still labels, and throws nothing', async () => {
  const { ctx, store, rows } = fakeCtx(
    {
      'notes/q3-plan.md':
        '---\ntype: note\ntitle: Q3 plan\nsummary: Q3 plan\n---\n\nShip SCIM before pricing.\n',
    },
    [...TAGGED_WORLD, inote('notes/q3-plan.md', 'note', { title: 'Q3 plan' })],
  );
  const model = fakeModel({ 'notes/q3-plan.md': 'One line about the plan.\ntags: pricing' });

  const res = await runSummaryPass(ctx, { summarise: model.summarise });

  assert.deepEqual(res.written, ['notes/q3-plan.md']);
  assert.equal(fm('notes/q3-plan.md', store)['summary'], 'One line about the plan.');
  assert.deepEqual(rows, []);
});
