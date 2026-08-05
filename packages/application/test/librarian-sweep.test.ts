import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markLibrarianHandled, markLibrarianRun, planLibrarianSweep } from '../src/index.js';
import { fakeDriftWorld, inote } from './drift-helpers.js';

/**
 * The tick's whole job: notice, wait to see if it holds, and hand the agent a
 * list once. Everything below is about that timing, because getting it wrong is
 * how a background pass turns into either nagging or silence.
 */

const T0 = Date.parse('2026-08-05T09:00:00.000Z');
const SETTLE = 5 * 60 * 1000;
const INTERVAL = 30 * 60 * 1000;
const QUIET = 7 * 24 * 60 * 60 * 1000;
const OPTS = { settleMs: SETTLE, intervalMs: INTERVAL, quietMs: QUIET };

/** A broken link with one plausible target, and one note nothing touches. */
function linkWorld() {
  return fakeDriftWorld({
    notes: [
      inote({ path: 'notes/plan.md', type: 'note', title: 'Rollout plan', links: ['customers/nordkap-shiping'] }),
      inote({
        path: 'customers/nordkap-shipping.md',
        type: 'customer',
        title: 'Nordkap Shipping',
        links: ['notes/plan'],
      }),
      inote({ path: 'notes/scratch.md', type: 'note', title: 'Scratch pad', mtime: 500 }),
    ],
  });
}

/** One deep-tracked page in the orbit of a decision that replaced another. */
function driftWorld(decisionMtime = 300) {
  return fakeDriftWorld({
    notes: [
      inote({
        path: 'wikipages/onboarding.md',
        type: 'wikipage',
        title: 'Enterprise Onboarding',
        frontmatter: {
          provider: 'confluence',
          external_id: '910231',
          version: 12,
          url: 'https://tavla.atlassian.net/wiki/x',
        },
      }),
      inote({
        path: 'themes/onboarding.md',
        type: 'theme',
        title: 'Enterprise onboarding',
        links: ['decisions/2026-05-20-adopt-workos', 'wikipages/onboarding'],
      }),
      inote({
        path: 'decisions/2026-05-20-adopt-workos.md',
        type: 'decision',
        title: 'Adopt WorkOS',
        mtime: decisionMtime,
        frontmatter: {
          standing: 'active',
          theme: '[[themes/onboarding]]',
          supersedes: '[[decisions/2026-02-10-use-firebase-auth]]',
        },
        links: ['decisions/2026-02-10-use-firebase-auth'],
      }),
      inote({
        path: 'decisions/2026-02-10-use-firebase-auth.md',
        type: 'decision',
        title: 'Use Firebase Auth',
        frontmatter: { standing: 'superseded', superseded_by: '[[decisions/2026-05-20-adopt-workos]]' },
      }),
    ],
  });
}

test('a finding is only noted on the first tick, and handed over on the second', async () => {
  const w = linkWorld();

  assert.equal(await planLibrarianSweep(w.ctx, T0, OPTS), null);
  // Noted, not acted on: the settle window is exactly this row existing.
  assert.deepEqual(
    [...w.checks.keys()].sort(),
    ['librarian:link:notes/plan.md → customers/nordkap-shiping', 'librarian:orphan:notes/scratch.md'],
  );
  assert.match(w.checks.get('librarian:orphan:notes/scratch.md')!, /^seen\|500\|/);

  assert.equal(await planLibrarianSweep(w.ctx, T0 + 60_000, OPTS), null);

  const work = await planLibrarianSweep(w.ctx, T0 + SETTLE, OPTS);
  assert.ok(work);
  assert.deepEqual(
    work.findings.map((f) => f.kind),
    ['broken-link', 'unlinked-note'],
  );
  assert.match(work.worklist, /found 2 things that may need tidying/);
});

test('a broken-link line carries its similar pages, said to be a hint', async () => {
  const w = linkWorld();
  await planLibrarianSweep(w.ctx, T0, OPTS);
  const work = (await planLibrarianSweep(w.ctx, T0 + SETTLE, OPTS))!;

  assert.equal(
    work.findings[0]!.line,
    '- Broken link in notes/plan.md: [[customers/nordkap-shiping]] resolves to nothing.' +
      ' Similar existing pages: customers/nordkap-shipping.',
  );
  assert.match(work.worklist, /they decide nothing/);
  assert.equal(
    work.findings[1]!.line,
    '- Unlinked note: "Scratch pad" (notes/scratch.md). Nothing links it and it links nothing.',
  );
});

test('a handled finding stays quiet for a week', async () => {
  const w = linkWorld();
  await planLibrarianSweep(w.ctx, T0, OPTS);
  const work = (await planLibrarianSweep(w.ctx, T0 + SETTLE, OPTS))!;
  markLibrarianHandled(w.ctx, work.findings, T0 + SETTLE);
  markLibrarianRun(w.ctx, T0 + SETTLE);

  // Long past both the settle window and the session interval, and right up to
  // the last moment of the quiet window: a card the PM declined this morning
  // does not come back this afternoon.
  assert.equal(await planLibrarianSweep(w.ctx, T0 + 5 * INTERVAL, OPTS), null);
  assert.equal(await planLibrarianSweep(w.ctx, T0 + 20 * INTERVAL, OPTS), null);
  assert.equal(await planLibrarianSweep(w.ctx, T0 + SETTLE + QUIET - 1, OPTS), null);
});

test('a handled finding still there a week later gets one more look', async () => {
  const w = linkWorld();
  await planLibrarianSweep(w.ctx, T0, OPTS);
  const first = (await planLibrarianSweep(w.ctx, T0 + SETTLE, OPTS))!;
  markLibrarianHandled(w.ctx, first.findings, T0 + SETTLE);
  markLibrarianRun(w.ctx, T0 + SETTLE);

  // Handing a finding to a session says nothing about it being fixed, and the
  // link is still broken. Straight back on the list the moment the window ends,
  // with no second settle wait: it has held still for a week.
  const again = await planLibrarianSweep(w.ctx, T0 + SETTLE + QUIET, OPTS);
  assert.ok(again);
  assert.deepEqual(
    again.findings.map((f) => f.key),
    first.findings.map((f) => f.key),
  );

  // And the second hand-over buys another week of quiet, not a nightly nag.
  markLibrarianHandled(w.ctx, again.findings, T0 + SETTLE + QUIET);
  markLibrarianRun(w.ctx, T0 + SETTLE + QUIET);
  assert.equal(await planLibrarianSweep(w.ctx, T0 + SETTLE + QUIET + 20 * INTERVAL, OPTS), null);
  assert.ok(await planLibrarianSweep(w.ctx, T0 + SETTLE + 2 * QUIET, OPTS));
});

test('a row from before the sweep was agentic starts its quiet week at the upgrade', async () => {
  const w = fakeDriftWorld({
    notes: [inote({ path: 'notes/scratch.md', type: 'note', title: 'Scratch pad', mtime: 500 })],
  });
  // What the old sweep wrote: a bare revision, no state and no stamp.
  w.checks.set('librarian:orphan:notes/scratch.md', '500');

  assert.equal(await planLibrarianSweep(w.ctx, T0, OPTS), null);
  assert.match(w.checks.get('librarian:orphan:notes/scratch.md')!, /^handled\|500\|/);
  // Not re-raised on the first tick after an upgrade, which is the whole point
  // of reading those rows as handled at all.
  assert.equal(await planLibrarianSweep(w.ctx, T0 + SETTLE, OPTS), null);

  const work = (await planLibrarianSweep(w.ctx, T0 + QUIET, OPTS))!;
  assert.deepEqual(
    work.findings.map((f) => f.kind),
    ['unlinked-note'],
  );
});

test('the workspace\'s own machinery is never an unlinked note', async () => {
  const w = fakeDriftWorld({
    notes: [
      // Everything a workspace ships with or writes for itself. On a fresh
      // install this is the entire vault, and none of it is a hygiene problem.
      inote({ path: 'agents/librarian/AGENT.md', type: 'agent', title: 'Librarian' }),
      inote({ path: 'agents/meeting-prep/AGENT.md', type: 'agent', title: 'Meeting prep' }),
      inote({ path: 'skills/arrival/SKILL.md', type: 'skill', title: 'Arrival' }),
      inote({ path: 'sessions/2026-08-05-0900.md', type: 'session', title: 'Chat' }),
      inote({ path: 'todos/email-asa.md', type: 'todo', title: 'Email Åsa about rollout' }),
      inote({ path: 'notes/scratch.md', type: 'note', title: 'Scratch pad' }),
    ],
  });

  await planLibrarianSweep(w.ctx, T0, OPTS);
  const work = (await planLibrarianSweep(w.ctx, T0 + SETTLE, OPTS))!;
  assert.deepEqual(
    work.findings.map((f) => f.key),
    ['librarian:orphan:notes/scratch.md'],
  );
});

test('the similar-pages hint never points at machinery', async () => {
  const w = fakeDriftWorld({
    notes: [
      // The agent file's real path folds to this slug, which is what the fuzzy
      // match would see.
      inote({ path: 'agents/librarian.md', type: 'agent', title: 'Librarian' }),
      inote({ path: 'notes/plan.md', type: 'note', title: 'Rollout plan', links: ['librarain'] }),
    ],
  });

  await planLibrarianSweep(w.ctx, T0, OPTS);
  const work = (await planLibrarianSweep(w.ctx, T0 + SETTLE, OPTS))!;
  assert.equal(work.findings.length, 1);
  assert.equal(
    work.findings[0]!.line,
    '- Broken link in notes/plan.md: [[librarain]] resolves to nothing.',
  );
});

test('a drift pair whose revision changes is a new finding', async () => {
  const w = driftWorld();
  const key = 'page-drift:wikipages/onboarding:decisions/2026-05-20-adopt-workos';

  await planLibrarianSweep(w.ctx, T0, OPTS);
  const first = (await planLibrarianSweep(w.ctx, T0 + SETTLE, OPTS))!;
  assert.equal(first.findings.length, 1);
  assert.equal(first.findings[0]!.key, key);
  assert.match(first.findings[0]!.line, /"Enterprise Onboarding" \(\[\[wikipages\/onboarding\]\], confluence, /);
  assert.match(first.findings[0]!.line, /orbit of the decision "Adopt WorkOS"/);
  assert.match(first.findings[0]!.line, /It replaced "Use Firebase Auth"\./);
  markLibrarianHandled(w.ctx, first.findings, T0 + SETTLE);
  markLibrarianRun(w.ctx, T0 + SETTLE);
  assert.equal(await planLibrarianSweep(w.ctx, T0 + 4 * INTERVAL, OPTS), null);

  // The decision was edited, so the pair the agent read is not this pair.
  w.reindex(driftWorld(900).ctx.index.get('decisions/2026-05-20-adopt-workos.md')!);
  const t = T0 + 5 * INTERVAL;
  assert.equal(await planLibrarianSweep(w.ctx, t, OPTS), null);
  const second = (await planLibrarianSweep(w.ctx, t + SETTLE, OPTS))!;
  assert.equal(second.findings[0]!.revision, 'd:900|p:12');
});

test('the minimum interval holds a second session back', async () => {
  const w = linkWorld();
  await planLibrarianSweep(w.ctx, T0, OPTS);
  const t = T0 + SETTLE;
  assert.ok(await planLibrarianSweep(w.ctx, t, OPTS));
  markLibrarianRun(w.ctx, t);

  assert.equal(await planLibrarianSweep(w.ctx, t + SETTLE, OPTS), null);
  assert.equal(await planLibrarianSweep(w.ctx, t + INTERVAL - 1, OPTS), null);
  assert.ok(await planLibrarianSweep(w.ctx, t + INTERVAL, OPTS));
});

test("the card cap holds a session back, counting only the librarian's own cards", async () => {
  const w = linkWorld();
  const card = (skill: string): void => {
    w.ctx.proposals.create(
      {
        kind: 'update',
        sessionId: 's1',
        skill,
        targetPath: 'notes/plan.md',
        baseHash: null,
        payload: {},
        rationale: 'r',
        evidence: [],
        inference: false,
      },
      T0,
    );
  };
  card('meeting-prep');
  card('meeting-prep');
  card('meeting-prep');

  await planLibrarianSweep(w.ctx, T0, OPTS);
  const t = T0 + SETTLE;
  assert.ok(await planLibrarianSweep(w.ctx, t, { ...OPTS, cardCap: 2 }));

  card('librarian');
  card('librarian');
  assert.equal(await planLibrarianSweep(w.ctx, t, { ...OPTS, cardCap: 2 }), null);
  assert.ok(await planLibrarianSweep(w.ctx, t, { ...OPTS, cardCap: 3 }));
});

test('a long worklist truncates and says how many are waiting', async () => {
  const w = fakeDriftWorld({
    notes: [1, 2, 3, 4, 5].map((n) =>
      inote({ path: `notes/stray-${n}.md`, type: 'note', title: `Stray ${n}` }),
    ),
  });
  await planLibrarianSweep(w.ctx, T0, OPTS);
  const work = (await planLibrarianSweep(w.ctx, T0 + SETTLE, { ...OPTS, worklistMax: 2 }))!;

  assert.equal(work.findings.length, 2);
  assert.match(work.worklist, /3 more findings are waiting for the next pass\./);
  // Only what was handed over gets marked, so the other three keep their turn.
  markLibrarianHandled(w.ctx, work.findings, T0 + SETTLE);
  const next = (await planLibrarianSweep(w.ctx, T0 + SETTLE + INTERVAL, { ...OPTS, worklistMax: 2 }))!;
  assert.equal(next.findings.length, 2);
  assert.match(next.worklist, /1 more finding is waiting for the next pass\./);
});
