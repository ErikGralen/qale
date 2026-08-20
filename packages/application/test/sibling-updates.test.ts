import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeNote, type Frontmatter } from '@qale/domain';
import { acceptProposal, contentHash, previewProposal } from '../src/index.js';
import type { ProposalRecord, UseCaseContext } from '../src/ports.js';

// Two cards against one note used to be one card: approving the first changed
// the file, and the base-hash check read any change at all as "this no longer
// fits", so every sibling died with it. A session that proposed three edits to
// one meeting page could only ever land one of them, and the PM was told the
// note had moved under the others — by the app that had just moved it.
//
// Placement is the test now: an edit is stale when its anchor is gone or
// ambiguous, never because bytes elsewhere in the note changed.

interface Stored {
  frontmatter: Frontmatter;
  body: string;
}

function fakeContext(files: Record<string, Stored>) {
  const store = new Map(Object.entries(files));
  const proposals = new Map<string, ProposalRecord>();
  let seq = 0;
  const note = (path: string, s: Stored) =>
    makeNote({ path, frontmatter: s.frontmatter, body: s.body, mtime: 1 });
  const ctx: UseCaseContext = {
    vault: {
      root: () => '/fake',
      ensureScaffold: async () => {},
      readNote: async (p: string) => {
        const s = store.get(p);
        return s ? note(p, s) : null;
      },
      readRaw: async () => null,
      writeNote: async (p: string, frontmatter: Frontmatter, body: string) => {
        store.set(p, { frontmatter, body });
        return note(p, { frontmatter, body });
      },
      writeBody: async (p: string, body: string) => {
        const s = store.get(p)!;
        store.set(p, { ...s, body });
        return note(p, { ...s, body });
      },
      writeRaw: async () => {},
      writeBinary: async () => {},
      remove: async (p: string) => void store.delete(p),
      exists: async (p: string) => store.has(p),
      list: async () => [],
      contain: () => null,
    },
    index: {
      reindex: () => {},
      removeByPath: () => {},
      get: () => null,
      all: () => [],
      listByType: () => [],
      search: () => [],
      backlinks: () => [],
      resolve: () => null,
      count: () => 0,
      clear: () => {},
    },
    git: {
      available: async () => false,
      isRepo: async () => false,
      init: async () => {},
      commitPaths: async () => {},
      history: async () => [],
      fileAt: async () => null,
    },
    clock: { now: () => '2026-08-14T00:00:00.000Z' },
    proposals: {
      create: (input, created) => {
        const rec = {
          ...input,
          id: `p${++seq}`,
          status: 'pending',
          created,
          resolved: null,
        } as ProposalRecord;
        proposals.set(rec.id, rec);
        return rec;
      },
      get: (id: string) => proposals.get(id) ?? null,
      list: () => [...proposals.values()],
      setStatus: (id: string, status: string) => {
        const rec = proposals.get(id);
        if (rec) proposals.set(id, { ...rec, status });
      },
      pendingCount: () => 0,
    } as never,
  };
  return { ctx, store };
}

const PATH = 'meetings/2026-08-12-nordkap.md';

const page = (): Stored => ({
  frontmatter: {
    type: 'meeting',
    title: 'Nordkap weekly',
    summary: 'Nordkap weekly',
    date: '2026-08-12',
    sources: [],
  } as unknown as Frontmatter,
  body: [
    '## What we said',
    '',
    'Alexandra wants the Windows build before the pilot.',
    '',
    '## Open',
    '',
    'Nobody owns the SSO rollout dates.',
  ].join('\n'),
});

/** A card proposed against the note as it reads at this moment. */
function updateCard(ctx: UseCaseContext, body: string, payload: Record<string, unknown>) {
  return ctx.proposals.create(
    {
      kind: 'update',
      sessionId: 's1',
      skill: 'meeting-prep',
      targetPath: payload['path'] as string,
      baseHash: contentHash(body),
      payload,
      rationale: 'write up the meeting',
      evidence: [],
      inference: false,
    },
    1,
  );
}

test('two edits to different parts of one note both apply, in either order', async () => {
  const { ctx, store } = fakeContext({ [PATH]: page() });
  const body = store.get(PATH)!.body;
  const first = updateCard(ctx, body, {
    path: PATH,
    patch: [
      {
        search: 'Alexandra wants the Windows build before the pilot.',
        replace: 'Alexandra wants the Windows build before the pilot, signed.',
      },
    ],
    rationale: 'correct the ask',
  });
  const second = updateCard(ctx, body, {
    path: PATH,
    patch: [
      { search: 'Nobody owns the SSO rollout dates.', replace: 'Erik owns the SSO rollout dates.' },
    ],
    rationale: 'name an owner',
  });

  assert.equal((await acceptProposal(ctx, first.id)).ok, true);

  // The sibling was written against the text before that write. It still fits,
  // and the review must say so rather than blaming a change the app just made.
  const preview = await previewProposal(ctx, second.id);
  assert.equal(preview!.stale, false, 'a sibling approval is not a conflict');
  assert.equal(preview!.moved, true, 'but the note did move, and the card says so');

  assert.equal((await acceptProposal(ctx, second.id)).ok, true);
  const after = store.get(PATH)!.body;
  assert.match(after, /before the pilot, signed\./);
  assert.match(after, /Erik owns the SSO rollout dates\./);
});

test('two edits to the same sentence: the second one has nowhere left to go', async () => {
  const { ctx, store } = fakeContext({ [PATH]: page() });
  const body = store.get(PATH)!.body;
  const anchor = 'Nobody owns the SSO rollout dates.';
  const first = updateCard(ctx, body, {
    path: PATH,
    patch: [{ search: anchor, replace: 'Erik owns the SSO rollout dates.' }],
    rationale: 'name an owner',
  });
  const second = updateCard(ctx, body, {
    path: PATH,
    patch: [{ search: anchor, replace: 'Alexandra owns the SSO rollout dates.' }],
    rationale: 'name a different owner',
  });

  assert.equal((await acceptProposal(ctx, first.id)).ok, true);

  const preview = await previewProposal(ctx, second.id);
  assert.equal(preview!.stale, true);
  assert.equal(preview!.staleReason, 'unanchored');

  const result = await acceptProposal(ctx, second.id);
  assert.equal(result.ok, false);
  assert.equal(result.staleReason, 'unanchored');
  assert.match(store.get(PATH)!.body, /Erik owns the SSO rollout dates\./, 'and nothing clobbered');
});

test('an edit to the body does not kill a card that only sets a property', async () => {
  const { ctx, store } = fakeContext({ [PATH]: page() });
  const body = store.get(PATH)!.body;
  const meta = updateCard(ctx, body, {
    path: PATH,
    frontmatter: { processing: 'processed' },
    rationale: 'mark it handled',
  });
  const text = updateCard(ctx, body, {
    path: PATH,
    append: '\n## Next\n\nSend the dates on Monday.',
    rationale: 'add the follow-up',
  });

  assert.equal((await acceptProposal(ctx, text.id)).ok, true);
  const preview = await previewProposal(ctx, meta.id);
  assert.equal(preview!.stale, false, 'a property has no anchor to lose');
  assert.equal((await acceptProposal(ctx, meta.id)).ok, true);
  assert.equal(store.get(PATH)!.frontmatter.processing, 'processed');
});

test('the same block appended twice is refused rather than said twice', async () => {
  const { ctx, store } = fakeContext({ [PATH]: page() });
  const body = store.get(PATH)!.body;
  const append = '## Next\n\nSend the dates on Monday.';
  const first = updateCard(ctx, body, { path: PATH, append, rationale: 'add the follow-up' });
  const second = updateCard(ctx, body, { path: PATH, append, rationale: 'add the follow-up' });

  assert.equal((await acceptProposal(ctx, first.id)).ok, true);

  const preview = await previewProposal(ctx, second.id);
  assert.equal(preview!.stale, true);
  assert.equal(preview!.staleReason, 'duplicate');

  const result = await acceptProposal(ctx, second.id);
  assert.equal(result.ok, false);
  assert.equal(result.staleReason, 'duplicate');
  assert.equal(
    store.get(PATH)!.body.split('Send the dates on Monday.').length - 1,
    1,
    'the note says it once',
  );
});

test('a hand edit elsewhere in the note leaves an edit that still fits alone', async () => {
  const { ctx, store } = fakeContext({ [PATH]: page() });
  const body = store.get(PATH)!.body;
  const card = updateCard(ctx, body, {
    path: PATH,
    patch: [
      { search: 'Nobody owns the SSO rollout dates.', replace: 'Erik owns the SSO rollout dates.' },
    ],
    rationale: 'name an owner',
  });

  // The PM opened the note in Obsidian and typed a line at the top.
  store.set(PATH, { ...store.get(PATH)!, body: `Typed while reading.\n\n${body}` });

  const preview = await previewProposal(ctx, card.id);
  assert.equal(preview!.stale, false);
  assert.equal(preview!.moved, true);
  assert.equal((await acceptProposal(ctx, card.id)).ok, true);
  const after = store.get(PATH)!.body;
  assert.match(after, /Typed while reading\./, 'their line survives');
  assert.match(after, /Erik owns the SSO rollout dates\./);
});
