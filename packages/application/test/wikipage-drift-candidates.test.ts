import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectDriftPairs } from '../src/index.js';
import { inote, resolverFor } from './drift-helpers.js';

// Candidate selection is DETERMINISTIC: only deep-tracked wikipages linked
// from a theme hub / decision chain, paired only with the ACTIVE
// head of a decision chain. No LLM anywhere near this file.

const wikipageFm = (externalId: string, version: number): Record<string, unknown> => ({
  provider: 'confluence',
  external_id: externalId,
  container: 'Product',
  version,
  remote_updated: '2026-07-11T16:20:00Z',
  url: 'https://tavla.atlassian.net/wiki/x',
});

function tavlaNotes() {
  const page = inote({
    path: 'wikipages/enterprise-onboarding.md',
    type: 'wikipage',
    title: 'Enterprise Onboarding',
    frontmatter: wikipageFm('910231', 12),
  });
  const hub = inote({
    path: 'themes/enterprise-onboarding.md',
    type: 'theme',
    links: [
      'decisions/2026-04-15-defer-scim-to-q3',
      'decisions/2026-05-20-adopt-workos',
      'wikipages/enterprise-onboarding',
    ],
  });
  const scim = inote({
    path: 'decisions/2026-04-15-defer-scim-to-q3.md',
    type: 'decision',
    title: 'Defer SCIM to Q3',
    mtime: 500,
    frontmatter: { standing: 'active', theme: '[[themes/enterprise-onboarding]]', date: '2026-04-15' },
    links: ['themes/enterprise-onboarding'],
  });
  const workos = inote({
    path: 'decisions/2026-05-20-adopt-workos.md',
    type: 'decision',
    title: 'Adopt WorkOS',
    frontmatter: {
      standing: 'active',
      supersedes: '[[decisions/2026-02-10-use-firebase-auth]]',
      theme: '[[themes/enterprise-onboarding]]',
    },
    links: ['decisions/2026-02-10-use-firebase-auth'],
  });
  const firebase = inote({
    path: 'decisions/2026-02-10-use-firebase-auth.md',
    type: 'decision',
    title: 'Use Firebase Auth',
    frontmatter: { standing: 'superseded', superseded_by: '[[decisions/2026-05-20-adopt-workos]]' },
  });
  return { page, hub, scim, workos, firebase };
}

test('pairs a hub-linked wikipage with every active decision in the hub orbit', () => {
  const { page, hub, scim, workos, firebase } = tavlaNotes();
  const notes = [page, hub, scim, workos, firebase];
  const pairs = selectDriftPairs(notes, resolverFor(notes));

  assert.deepEqual(
    pairs.map((p) => p.decision.slug),
    ['decisions/2026-04-15-defer-scim-to-q3', 'decisions/2026-05-20-adopt-workos'],
  );
  const scimPair = pairs[0]!;
  assert.equal(scimPair.page.externalId, '910231');
  assert.equal(scimPair.key, 'page-drift:wikipages/enterprise-onboarding:decisions/2026-04-15-defer-scim-to-q3');
  assert.equal(scimPair.via, 'themes/enterprise-onboarding.md');
});

test('a superseded decision never heads a pair, but rides along as chain context', () => {
  const { page, hub, scim, workos, firebase } = tavlaNotes();
  const notes = [page, hub, scim, workos, firebase];
  const pairs = selectDriftPairs(notes, resolverFor(notes));

  assert.ok(!pairs.some((p) => p.decision.slug.includes('use-firebase-auth')));
  const workosPair = pairs.find((p) => p.decision.slug.includes('adopt-workos'))!;
  assert.deepEqual(
    workosPair.chain.map((c) => `${c.slug}:${c.standing}`),
    ['decisions/2026-02-10-use-firebase-auth:superseded', 'decisions/2026-05-20-adopt-workos:active'],
  );
});

test('a wikipage nobody in the spine links is never a candidate', () => {
  const { page, scim } = tavlaNotes();
  // Only a plain note links the page — that is not a tracking gesture.
  const note = inote({ path: 'notes/scratch.md', type: 'note', links: ['wikipages/enterprise-onboarding'] });
  const notes = [page, scim, note];
  assert.deepEqual(selectDriftPairs(notes, resolverFor(notes)), []);
});

test('a decision linking the page directly pairs without any hub', () => {
  const { page } = tavlaNotes();
  const decision = inote({
    path: 'decisions/2026-04-15-defer-scim-to-q3.md',
    type: 'decision',
    frontmatter: { standing: 'active' },
    links: ['wikipages/enterprise-onboarding'],
  });
  const notes = [page, decision];
  const pairs = selectDriftPairs(notes, resolverFor(notes));
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0]!.via, 'decisions/2026-04-15-defer-scim-to-q3.md');
});

test('revision moves with the page version and the decision mtime — and only with them', () => {
  const { page, hub, scim, workos, firebase } = tavlaNotes();
  const notes = [page, hub, scim, workos, firebase];
  const rev = () =>
    selectDriftPairs(notes, resolverFor(notes)).find((p) => p.decision.slug.includes('defer-scim'))!.revision;

  const before = rev();
  assert.equal(rev(), before); // stable when nothing changed

  const synced = inote({
    path: page.path,
    type: 'wikipage',
    title: page.title,
    frontmatter: wikipageFm('910231', 13),
  });
  notes[0] = synced;
  const afterSync = rev();
  assert.notEqual(afterSync, before);

  notes[2] = { ...scim, mtime: 900 };
  assert.notEqual(rev(), afterSync);
});

test('output order is deterministic regardless of input order', () => {
  const { page, hub, scim, workos, firebase } = tavlaNotes();
  const a = [page, hub, scim, workos, firebase];
  const b = [firebase, workos, scim, hub, page];
  assert.deepEqual(
    selectDriftPairs(a, resolverFor(a)).map((p) => p.key),
    selectDriftPairs(b, resolverFor(b)).map((p) => p.key),
  );
});
