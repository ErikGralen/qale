import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeNote, type Frontmatter } from '@qale/domain';
import { completeMeetingReview, markMeetingReviewed } from '../src/index.js';
import type { CreateProposalInput, ProposalRecord, UseCaseContext } from '../src/ports.js';

// Meeting-review closure: the LAST card of a session resolving is what closes
// the review. Keeping something means the PO looked, so the meeting flips to
// `processed` silently. Discarding everything means nothing was kept and nothing
// here knows they looked, so the meeting stays put and the Inbox gets a question.

interface Stored {
  frontmatter: Frontmatter;
  body: string;
}

function fakeContext(files: Record<string, Stored>) {
  const store = new Map(Object.entries(files));
  const proposals = new Map<string, ProposalRecord>();
  const commits: string[] = [];
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
      commitPaths: async (paths: string[]) => void commits.push(...paths),
      history: async () => [],
      fileAt: async () => null,
    },
    clock: { now: () => '2026-07-22T00:00:00.000Z' },
    proposals: {
      create: (input: CreateProposalInput, created: number) => {
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
      // The real store persists the lifecycle, and closure reads it back. A fake
      // that only records the call would report every card as still pending.
      setStatus: (id: string, status: string, resolved: number) => {
        const rec = proposals.get(id);
        if (rec) proposals.set(id, { ...rec, status, resolved } as ProposalRecord);
      },
      pendingCount: () => 0,
    } as never,
  };
  return { ctx, store, commits };
}

const meeting = (over: Record<string, unknown> = {}): Stored => ({
  frontmatter: {
    type: 'meeting',
    title: 'Roadmap sync',
    summary: 'Roadmap sync',
    processing: 'new',
    date: '2026-07-17',
    ...over,
  } as Frontmatter,
  body: '## Notes\nWe went round on the SSO dates.\n',
});

function card(ctx: UseCaseContext, targetPath: string): ProposalRecord {
  return ctx.proposals.create(
    {
      kind: 'note',
      sessionId: 's1',
      skill: 'after-meeting',
      targetPath,
      payload: { path: 'insights/sso-dates.md', frontmatter: {}, body: '' },
      rationale: 'worth keeping',
      evidence: [],
      inference: false,
    },
    1,
  );
}

const processingOf = (store: Map<string, Stored>, path: string): unknown =>
  (store.get(path)!.frontmatter as Record<string, unknown>)['processing'];

test('the last card resolving with something kept closes the review silently', async () => {
  const { ctx, store } = fakeContext({ 'meetings/roadmap-sync.md': meeting() });
  const a = card(ctx, 'meetings/roadmap-sync.md');
  const b = card(ctx, 'meetings/roadmap-sync.md');
  ctx.proposals.setStatus(a.id, 'accepted', 2);
  ctx.proposals.setStatus(b.id, 'rejected', 3);

  const result = await completeMeetingReview(ctx, 's1');
  assert.equal(result.completed, 'meetings/roadmap-sync.md');
  assert.equal(result.ask, null);
  assert.equal(processingOf(store, 'meetings/roadmap-sync.md'), 'processed');
});

test('discarding every card asks instead of flipping, leaving the meeting in needs review', async () => {
  const { ctx, store } = fakeContext({ 'meetings/roadmap-sync.md': meeting() });
  const a = card(ctx, 'meetings/roadmap-sync.md');
  const b = card(ctx, 'meetings/roadmap-sync.md');
  ctx.proposals.setStatus(a.id, 'rejected', 2);
  ctx.proposals.setStatus(b.id, 'rejected', 3);

  const result = await completeMeetingReview(ctx, 's1');
  assert.equal(result.completed, null);
  assert.deepEqual(result.ask, { path: 'meetings/roadmap-sync.md', title: 'Roadmap sync' });
  assert.equal(processingOf(store, 'meetings/roadmap-sync.md'), 'new');
});

test('a session with a card still pending neither flips nor asks', async () => {
  const { ctx, store } = fakeContext({ 'meetings/roadmap-sync.md': meeting() });
  const a = card(ctx, 'meetings/roadmap-sync.md');
  card(ctx, 'meetings/roadmap-sync.md');
  ctx.proposals.setStatus(a.id, 'rejected', 2);

  const result = await completeMeetingReview(ctx, 's1');
  assert.deepEqual(result, { completed: null, ask: null });
  assert.equal(processingOf(store, 'meetings/roadmap-sync.md'), 'new');
});

test('a cancelled meeting is never asked about, since it never asked to be reviewed', async () => {
  const { ctx } = fakeContext({
    'meetings/roadmap-sync.md': meeting({ event_status: 'cancelled' }),
  });
  const a = card(ctx, 'meetings/roadmap-sync.md');
  ctx.proposals.setStatus(a.id, 'rejected', 2);

  const result = await completeMeetingReview(ctx, 's1');
  assert.deepEqual(result, { completed: null, ask: null });
});

test('an already processed meeting is neither re-flipped nor asked about', async () => {
  const { ctx } = fakeContext({ 'meetings/roadmap-sync.md': meeting({ processing: 'processed' }) });
  const a = card(ctx, 'meetings/roadmap-sync.md');
  ctx.proposals.setStatus(a.id, 'rejected', 2);

  const result = await completeMeetingReview(ctx, 's1');
  assert.deepEqual(result, { completed: null, ask: null });
});

test('answering the ask marks the meeting reviewed, and answering twice is a no-op', async () => {
  const { ctx, store, commits } = fakeContext({ 'meetings/roadmap-sync.md': meeting() });

  assert.deepEqual(await markMeetingReviewed(ctx, 'meetings/roadmap-sync.md'), { ok: true });
  assert.equal(processingOf(store, 'meetings/roadmap-sync.md'), 'processed');
  assert.deepEqual(commits, ['meetings/roadmap-sync.md']);

  assert.deepEqual(await markMeetingReviewed(ctx, 'meetings/roadmap-sync.md'), { ok: false });
  assert.equal(commits.length, 1, 'a second answer must not write or commit again');
});

test('marking a note that is not a meeting reviewed is refused', async () => {
  const { ctx } = fakeContext({
    'notes/scratch.md': { frontmatter: { type: 'note', processing: 'new' } as Frontmatter, body: '' },
  });
  assert.deepEqual(await markMeetingReviewed(ctx, 'notes/scratch.md'), { ok: false });
  assert.deepEqual(await markMeetingReviewed(ctx, 'meetings/gone.md'), { ok: false });
});
