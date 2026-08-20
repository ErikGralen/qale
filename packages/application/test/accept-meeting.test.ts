import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeNote, type Frontmatter, type NoteType } from '@qale/domain';
import { acceptProposal, rejectProposal } from '../src/index.js';
import type { IndexedNote, ProposalRecord, UseCaseContext } from '../src/ports.js';

/**
 * Approving a meeting card, which is the whole of what used to happen the moment
 * a transcript was dropped.
 *
 * Two things have to be true on the other side of the click. The page has to
 * land finished — its own date, the summary in the body, the recording linked —
 * because nothing else is coming; there is no second card behind this one. And
 * the recording has to stop being unread, which is not automatic here: a meeting
 * has no `sources` field to cite through, so the flip rides on the card's own
 * evidence, and without it the transcript would sit at `new` forever, waiting to
 * be read a second time.
 */

interface Stored {
  frontmatter: Frontmatter;
  body: string;
}

function fakeContext(files: Record<string, Stored>) {
  const store = new Map(Object.entries(files));
  const proposals = new Map<string, ProposalRecord>();
  const statuses: Record<string, string> = {};
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
      writeBody: async () => note('x', { frontmatter: {} as Frontmatter, body: '' }),
      writeRaw: async () => {},
      writeBinary: async () => {},
      remove: async (p: string) => void store.delete(p),
      exists: async (p: string) => store.has(p),
      list: async () => [...store.keys()],
      contain: () => null,
    },
    index: {
      reindex: () => {},
      removeByPath: () => {},
      get: (p: string) => {
        const s = store.get(p);
        if (!s) return null;
        const n = note(p, s);
        return {
          path: p,
          slug: n.slug,
          type: n.type as NoteType,
          layer: n.layer,
          title: n.slug,
          summary: '',
          lifecycle: null,
          hasBody: true,
          mtime: 1,
          frontmatter: s.frontmatter as Record<string, unknown>,
          links: [],
        } satisfies IndexedNote;
      },
      all: () => [],
      listByType: () => [],
      search: () => [],
      backlinks: () => [],
      resolve: (target: string) => (store.has(`${target}.md`) ? `${target}.md` : null),
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
    clock: { now: () => '2026-08-07T00:00:00.000Z' },
    proposals: {
      create: (input, created) => {
        const rec = {
          ...input,
          id: 'p1',
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
        statuses[id] = status;
      },
      pendingCount: () => 0,
    } as never,
  };
  return { ctx, store, statuses };
}

const TRANSCRIPT = 'sources/2026-08-04-nordkap-qbr-transcript.md';

function world() {
  return fakeContext({
    [TRANSCRIPT]: {
      frontmatter: {
        type: 'source',
        summary: 'Transcript — Nordkap QBR',
        processing: 'new',
      } as Frontmatter,
      body: 'Erik: so we are live in July.',
    },
  });
}

function meetingCard(ctx: UseCaseContext): ProposalRecord {
  return ctx.proposals.create(
    {
      kind: 'note',
      sessionId: 's1',
      skill: 'arrival',
      targetPath: 'meetings/2026-08-04-nordkap-qbr.md',
      baseHash: null,
      payload: {
        path: 'meetings/2026-08-04-nordkap-qbr.md',
        frontmatter: {
          type: 'meeting',
          title: 'Nordkap QBR',
          summary: 'Nordkap QBR',
          date: '2026-08-04',
          processing: 'processed',
          transcript: '[[sources/2026-08-04-nordkap-qbr-transcript]]',
        },
        body: '## Notes\n\n## Summary\n\nJuly go-live confirmed.\n',
        rationale: 'The recording is the only record of this meeting.',
      },
      rationale: 'The recording is the only record of this meeting.',
      evidence: [{ ref: '[[sources/2026-08-04-nordkap-qbr-transcript]]', resolved: true }],
      inference: false,
    },
    Date.now(),
  );
}

test('approving a meeting card creates the finished page, summary and recording in place', async () => {
  const { ctx, store, statuses } = world();
  const rec = meetingCard(ctx);

  const result = await acceptProposal(ctx, rec.id);

  assert.equal(result.ok, true);
  assert.equal(statuses[rec.id], 'accepted');
  const page = store.get('meetings/2026-08-04-nordkap-qbr.md')!;
  assert.match(page.body, /## Summary\n\nJuly go-live confirmed/);
  assert.equal(page.frontmatter['date'], '2026-08-04');
  assert.equal(page.frontmatter['transcript'], '[[sources/2026-08-04-nordkap-qbr-transcript]]');
  // The recording has been read now, and says so.
  assert.equal(store.get(TRANSCRIPT)!.frontmatter['processing'], 'processed');
});

test('a meeting the PM declines leaves the workspace with the recording and nothing else', async () => {
  const { ctx, store } = world();
  const rec = meetingCard(ctx);

  assert.equal(rejectProposal(ctx, rec.id).ok, true);

  // The point of moving the page onto a card: "no" leaves no page behind. It
  // used to be written the moment the file was dropped, and declining the
  // summary left an empty meeting nobody had asked for.
  assert.equal(store.has('meetings/2026-08-04-nordkap-qbr.md'), false);
  assert.deepEqual([...store.keys()], [TRANSCRIPT]);
  // And the recording is still waiting to be read, not quietly marked done.
  assert.equal(store.get(TRANSCRIPT)!.frontmatter['processing'], 'new');
});
