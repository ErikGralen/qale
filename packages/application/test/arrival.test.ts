import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeNote,
  transcriptRefs,
  type Frontmatter,
  type Note,
  type NoteType,
} from '@qale/domain';
import { fileMaterial, refileMaterial } from '../src/use-cases/arrival.js';
import type { IndexedNote, UseCaseContext } from '../src/ports.js';

/**
 * Filing, done by the agent (docs/arrival-agentic.md).
 *
 * There is no planner left to test: what a dropped file IS, and where it
 * belongs, is decided by an agent that read it. What survives is the pair of
 * writes that agent performs, and the questions worth asking about them are all
 * about NOT losing anything: a recording delivered in two files is one meeting
 * rather than two, a transcript moved to the meeting it really belongs to takes
 * its evidence with it, and a page somebody has written on is never emptied out
 * from under them.
 *
 * The fake vault below actually persists, unlike the drift helpers' one:
 * `freePath` resolves collisions by asking the disk, and a vault where nothing
 * exists would let two notes quietly take one path.
 */

function fakeWorld(now = '2026-08-04T09:00:00.000Z'): {
  ctx: UseCaseContext;
  files: Map<string, Note>;
  commits: string[];
} {
  const files = new Map<string, Note>();
  const indexed = new Map<string, IndexedNote>();
  const commits: string[] = [];

  const ctx = {
    vault: {
      root: () => '/fake',
      ensureScaffold: async () => {},
      readNote: async (p: string) => files.get(p) ?? null,
      readRaw: async (p: string) => (files.has(p) ? files.get(p)!.body : null),
      writeNote: async (p: string, frontmatter: Frontmatter, body: string) => {
        const note = makeNote({ path: p, frontmatter, body, mtime: 1 });
        files.set(p, note);
        return note;
      },
      writeBody: async (p: string, body: string) => {
        const prev = files.get(p)!;
        const note = makeNote({ path: p, frontmatter: prev.frontmatter, body, mtime: 1 });
        files.set(p, note);
        return note;
      },
      writeRaw: async () => {},
      writeBinary: async () => {},
      remove: async (p: string) => void files.delete(p),
      exists: async (p: string) => files.has(p),
      list: async () => [...files.keys()],
      contain: () => null,
    },
    index: {
      reindex: (note: Note) => {
        indexed.set(note.path, {
          path: note.path,
          slug: note.slug,
          type: note.type as NoteType,
          layer: note.layer,
          title: note.slug,
          summary: '',
          lifecycle: null,
          hasBody: !!note.body.trim(),
          mtime: 1,
          frontmatter: note.frontmatter as Record<string, unknown>,
          links: [],
        });
      },
      removeByPath: (p: string) => void indexed.delete(p),
      get: (p: string) => indexed.get(p) ?? null,
      all: () => [...indexed.values()],
      listByType: (t: NoteType) => [...indexed.values()].filter((n) => n.type === t),
      search: () => [],
      // Only the edge this module actually reads: a meeting pointing at a
      // transcript. Derived from the live frontmatter, so a refile that rewrites
      // `transcript` is visible to the very next lookup.
      backlinks: (slug: string) =>
        [...indexed.values()]
          .filter((n) => transcriptRefs(n.frontmatter).includes(`[[${slug}]]`))
          .map((n) => ({ fromPath: n.path })),
      resolve: (target: string) =>
        [...indexed.values()].find((n) => n.slug === target)?.path ?? null,
      count: () => indexed.size,
      clear: () => void indexed.clear(),
    },
    git: {
      available: async () => false,
      isRepo: async () => false,
      init: async () => {},
      commitPaths: async (_paths: string[], message: string) => void commits.push(message),
      history: async () => [],
      fileAt: async () => null,
    },
    clock: { now: () => now },
  } as unknown as UseCaseContext;

  return { ctx, files, commits };
}

/** The frontmatter refs of the meeting at `path`, freshly read. */
function refsOf(files: Map<string, Note>, path: string): string[] {
  return transcriptRefs(files.get(path)!.frontmatter);
}

test('a recording delivered in two files is one meeting with two transcripts', async () => {
  const { ctx, files } = fakeWorld();
  const result = await fileMaterial(ctx, {
    as: 'meeting',
    title: 'Nordkap QBR',
    date: '2026-08-04',
    parts: [
      { name: 'qbr-part-1.vtt', text: 'Erik: first half.' },
      { name: 'qbr-part-2.vtt', text: 'Erik: second half.' },
    ],
  });

  const meetings = [...files.keys()].filter((p) => p.startsWith('meetings/'));
  assert.equal(meetings.length, 1, 'one meeting, not two');
  assert.equal(result.path, meetings[0]);
  assert.equal(refsOf(files, result.path).length, 2, 'both halves are linked as evidence');
  // The date the material states, not the day it was handed over.
  assert.match(result.path, /2026-08-04/);
  assert.equal(result.wrote.length, 3, 'the meeting page plus one source per half');
});

test('attaching to a meeting the calendar already holds never mints a second page', async () => {
  const { ctx, files } = fakeWorld();
  const synced = await ctx.vault.writeNote(
    'meetings/2026-08-04-nordkap-qbr.md',
    { type: 'meeting', summary: 'Nordkap QBR', date: '2026-08-04', processing: 'new' } as Frontmatter,
    '## Notes\n\n## Summary\n',
  );
  ctx.index.reindex(synced);

  const result = await fileMaterial(ctx, {
    as: 'meeting',
    title: 'Nordkap QBR',
    attachTo: synced.path,
    parts: [{ name: 'qbr.vtt', text: 'Erik: hello.' }],
  });

  assert.equal(result.path, synced.path);
  assert.equal([...files.keys()].filter((p) => p.startsWith('meetings/')).length, 1);
  assert.equal(refsOf(files, synced.path).length, 1);
  // Only the transcript this call wrote is reported, never the ones the page
  // was already carrying.
  assert.equal(result.wrote.length, 2);
});

test('a transcript of somebody else’s meeting files as a source and says whose it was', async () => {
  const { ctx, files } = fakeWorld();
  const result = await fileMaterial(ctx, {
    as: 'source',
    title: 'Kranelund sales call',
    origin: 'Jonas Palm',
    parts: [{ name: 'kranelund.vtt', text: 'Jonas: thanks for joining.' }],
  });

  assert.ok(result.path.startsWith('sources/'), `landed in ${result.path}`);
  assert.equal([...files.keys()].filter((p) => p.startsWith('meetings/')).length, 0);
  assert.equal(files.get(result.path)!.frontmatter['origin'], 'Jonas Palm');
});

test('an image is never a meeting, and the refusal names the file', async () => {
  const { ctx } = fakeWorld();
  await assert.rejects(
    fileMaterial(ctx, {
      as: 'meeting',
      title: 'Whiteboard',
      parts: [{ name: 'board.png', image: new Uint8Array([1, 2, 3]) }],
    }),
    /board\.png/,
  );
});

test('refiling a transcript onto another meeting moves the evidence and clears the empty page', async () => {
  const { ctx, files } = fakeWorld();
  const wrong = await fileMaterial(ctx, {
    as: 'meeting',
    title: 'Nordkap QBR',
    parts: [{ name: 'qbr.vtt', text: 'Erik: hello.' }],
  });
  const right = await fileMaterial(ctx, {
    as: 'meeting',
    title: 'Kranelund sync',
    parts: [{ name: 'sync.vtt', text: 'Erik: other meeting.' }],
  });
  const transcript = refsOf(files, wrong.path)[0]!;
  const transcriptPath = wrong.wrote[1]!;

  const result = await refileMaterial(ctx, { path: transcriptPath, meeting: right.path });

  assert.equal(result.path, right.path);
  assert.deepEqual(result.moved, [transcriptPath]);
  assert.equal(result.removed, wrong.path, 'the page it left is empty, so it goes');
  assert.equal(files.has(wrong.path), false);
  assert.equal(refsOf(files, right.path).includes(transcript), true);
  assert.equal(files.has(transcriptPath), true, 'the evidence itself is never deleted');
});

test('a whole meeting that was never the PM’s becomes signal, with whose it was', async () => {
  const { ctx, files } = fakeWorld();
  const filed = await fileMaterial(ctx, {
    as: 'meeting',
    title: 'Kranelund call',
    parts: [{ name: 'call.vtt', text: 'Jonas: hello.' }],
  });
  const transcriptPath = filed.wrote[1]!;

  const result = await refileMaterial(ctx, {
    path: filed.path,
    meeting: 'none',
    origin: 'Jonas Palm',
  });

  assert.equal(files.has(filed.path), false, 'the meeting page it should never have had');
  assert.equal(result.path, transcriptPath);
  assert.equal(files.get(transcriptPath)!.frontmatter['origin'], 'Jonas Palm');
});

test('a meeting somebody has written on is never emptied out from under them', async () => {
  const { ctx, files } = fakeWorld();
  const filed = await fileMaterial(ctx, {
    as: 'meeting',
    title: 'Nordkap QBR',
    parts: [{ name: 'qbr.vtt', text: 'Erik: hello.' }],
  });
  await ctx.vault.writeNote(
    filed.path,
    files.get(filed.path)!.frontmatter,
    '## Prep\n\nAsk about the schema date.\n\n## Notes\n\n## Summary\n',
  );

  await assert.rejects(
    refileMaterial(ctx, { path: filed.path, meeting: 'none', origin: 'Jonas Palm' }),
    /notes or a summary/,
  );
  assert.equal(files.has(filed.path), true);
});

test('refiling can just rename, without touching where anything lives', async () => {
  const { ctx, files } = fakeWorld();
  const filed = await fileMaterial(ctx, {
    as: 'meeting',
    title: 'Untitled meeting',
    parts: [{ name: 'qbr.vtt', text: 'Erik: hello.' }],
  });

  const result = await refileMaterial(ctx, { path: filed.path, title: 'Nordkap QBR' });

  assert.equal(files.get(result.path)!.frontmatter['title'], 'Nordkap QBR');
  assert.equal(refsOf(files, result.path).length, 1, 'the transcript stayed attached');
});
