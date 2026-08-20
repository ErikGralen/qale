import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeNote, type Frontmatter } from '@qale/domain';
import { acceptProposal, contentHash, previewProposal } from '../src/index.js';
import type { ProposalRecord, UseCaseContext } from '../src/ports.js';

// An update card can carry `frontmatter` — a shallow merge over the note's
// current properties. It's the only card path that edits metadata (a todo's
// `due`/`commitment`), so a reschedule/close applies without touching the body, and
// a metadata-only card is never reported as an unanchored patch.

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
    clock: { now: () => '2026-07-22T00:00:00.000Z' },
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
      setStatus: (id: string, status) => {
        statuses[id] = status;
      },
      pendingCount: () => 0,
    } as never,
  };
  return { ctx, store, statuses };
}

function updateCard(
  ctx: UseCaseContext,
  body: string,
  payload: Record<string, unknown>,
): ProposalRecord {
  return ctx.proposals.create(
    {
      kind: 'update',
      sessionId: 's1',
      skill: 'commitment-check',
      targetPath: payload['path'] as string,
      baseHash: contentHash(body),
      payload,
      rationale: 'handle',
      evidence: [],
      inference: false,
    },
    1,
  );
}

const todo = (over: Partial<Record<string, unknown>> = {}): Stored => ({
  frontmatter: {
    type: 'todo',
    summary: 'Send Nordkap the SSO rollout dates',
    title: 'Send Nordkap the SSO rollout dates',
    commitment: 'open',
    sources: [],
    due: '2026-07-10',
    ...over,
  } as Frontmatter,
  body: "> I'll get those dates over\n",
});

test('a frontmatter-only update reschedules the due date without touching the body', async () => {
  const { ctx, store, statuses } = fakeContext({ 'todos/nordkap-sso.md': todo() });
  const body = store.get('todos/nordkap-sso.md')!.body;
  const rec = updateCard(ctx, body, {
    path: 'todos/nordkap-sso.md',
    frontmatter: { due: '2026-08-01' },
    rationale: 'waiting on the eng ticket to land first',
  });

  const result = await acceptProposal(ctx, rec.id);
  assert.equal(result.ok, true);
  assert.equal(statuses[rec.id], 'accepted');
  const after = store.get('todos/nordkap-sso.md')!;
  assert.equal((after.frontmatter as Record<string, unknown>)['due'], '2026-08-01');
  assert.equal((after.frontmatter as Record<string, unknown>)['commitment'], 'open');
  assert.equal(after.body, body, 'body must be untouched by a metadata-only edit');
});

test('a frontmatter-only update closes the todo (commitment + resolved)', async () => {
  const { ctx, store } = fakeContext({ 'todos/nordkap-sso.md': todo() });
  const body = store.get('todos/nordkap-sso.md')!.body;
  const rec = updateCard(ctx, body, {
    path: 'todos/nordkap-sso.md',
    frontmatter: { commitment: 'done', resolved: '2026-07-22' },
    rationale: 'the dates went out in the Friday recap',
  });

  const result = await acceptProposal(ctx, rec.id);
  assert.equal(result.ok, true);
  const after = store.get('todos/nordkap-sso.md')!.frontmatter as Record<string, unknown>;
  assert.equal(after['commitment'], 'done');
  assert.equal(after['resolved'], '2026-07-22');
});

test('an update carries both a body patch and a frontmatter change', async () => {
  const { ctx, store } = fakeContext({ 'todos/nordkap-sso.md': todo() });
  const body = store.get('todos/nordkap-sso.md')!.body;
  const rec = updateCard(ctx, body, {
    path: 'todos/nordkap-sso.md',
    patch: [
      {
        search: "I'll get those dates over",
        replace: 'Plan: pull dates from ENG-214, send Monday',
      },
    ],
    frontmatter: { due: '2026-07-27' },
    rationale: 'plan + a realistic date',
  });

  const result = await acceptProposal(ctx, rec.id);
  assert.equal(result.ok, true);
  const after = store.get('todos/nordkap-sso.md')!;
  assert.match(after.body, /Plan: pull dates from ENG-214/);
  assert.equal((after.frontmatter as Record<string, unknown>)['due'], '2026-07-27');
});

test('a body-only update goes through writeBody — coerced frontmatter never round-trips', async () => {
  const { ctx, store } = fakeContext({ 'todos/nordkap-sso.md': todo() });
  const body = store.get('todos/nordkap-sso.md')!.body;
  let wroteNote = false;
  const origWriteNote = ctx.vault.writeNote;
  ctx.vault.writeNote = async (p, fm, b) => {
    wroteNote = true;
    return origWriteNote(p, fm, b);
  };
  const rec = updateCard(ctx, body, {
    path: 'todos/nordkap-sso.md',
    patch: [{ search: "I'll get those dates over", replace: 'Dates sent Monday' }],
    rationale: 'body only',
  });

  const result = await acceptProposal(ctx, rec.id);
  assert.equal(result.ok, true);
  assert.equal(wroteNote, false, 'a body-only card must use writeBody, not writeNote');
  assert.match(store.get('todos/nordkap-sso.md')!.body, /Dates sent Monday/);
});

/**
 * The write-up onto a meeting the calendar already holds. That page is
 * frontmatter and no body at all, so the card's lever is `append` — a patch has
 * nothing there to anchor to, and the card used to reach the PM as an unanchored
 * red box with the whole summary trapped inside it.
 */
const mirroredMeeting = (): Stored => ({
  frontmatter: {
    type: 'meeting',
    title: 'Erik x Daniel',
    summary: 'Erik x Daniel',
    date: '2026-07-25',
    provider: 'google-calendar',
    external_id: '2k17j50am5d52mldalav8kupt9',
    participants: ['danielrosensand@gmail.com'],
    processing: 'new',
  } as unknown as Frontmatter,
  body: '',
});

test('an append card writes the summary onto a calendar page that has no body', async () => {
  const { ctx, store } = fakeContext({ 'meetings/2026-07-25-erik-x-daniel.md': mirroredMeeting() });
  const rec = updateCard(ctx, '', {
    path: 'meetings/2026-07-25-erik-x-daniel.md',
    append: '## Summary\n\nErik demoed v1 and they set the deadline.',
    rationale: 'the calendar already holds this meeting',
  });

  const preview = await previewProposal(ctx, rec.id);
  assert.equal(preview!.stale, false, 'nothing to anchor is not staleness');
  assert.equal(preview!.before, '');
  assert.match(preview!.after, /Erik demoed v1/);

  const result = await acceptProposal(ctx, rec.id);
  assert.equal(result.ok, true);
  // Just the write-up: no blank lines led in from the empty body it landed on.
  assert.equal(
    store.get('meetings/2026-07-25-erik-x-daniel.md')!.body,
    '## Summary\n\nErik demoed v1 and they set the deadline.',
  );
});

test('preview reports the frontmatter change and is never unanchored for a metadata-only card', async () => {
  const { ctx, store } = fakeContext({ 'todos/nordkap-sso.md': todo() });
  const body = store.get('todos/nordkap-sso.md')!.body;
  const rec = updateCard(ctx, body, {
    path: 'todos/nordkap-sso.md',
    frontmatter: { due: '2026-08-01', commitment: 'open' },
    rationale: 'reschedule',
  });

  const preview = await previewProposal(ctx, rec.id);
  assert.ok(preview);
  assert.equal(preview!.stale, false);
  assert.equal(preview!.staleReason, undefined);
  // `commitment` is unchanged (open → open) so it drops out; only `due` is reported.
  assert.deepEqual(preview!.frontmatterChanges, [
    { key: 'due', before: '2026-07-10', after: '2026-08-01' },
  ]);
});

/**
 * What an update card writes still has to BE a note of its type. `acceptNote`
 * has always parsed what it writes; this path never did, so a malformed field
 * reached disk in silence and the note came back untyped on the next read.
 */
test("an update that would break the note's schema is refused, not written", async () => {
  const { ctx, store } = fakeContext({ 'todos/nordkap-sso.md': todo() });
  const body = store.get('todos/nordkap-sso.md')!.body;
  const rec = updateCard(ctx, body, {
    path: 'todos/nordkap-sso.md',
    frontmatter: { commitment: 'finished-ish' },
    rationale: 'close it',
  });

  const result = await acceptProposal(ctx, rec.id);
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /commitment/);
  assert.equal(
    (store.get('todos/nordkap-sso.md')!.frontmatter as Record<string, unknown>)['commitment'],
    'open',
    'nothing may reach disk when the merge does not validate',
  );
});

test('a due date that is not a date is refused wherever it comes from', async () => {
  const { ctx, store } = fakeContext({ 'todos/nordkap-sso.md': todo() });
  const body = store.get('todos/nordkap-sso.md')!.body;
  const rec = updateCard(ctx, body, {
    path: 'todos/nordkap-sso.md',
    frontmatter: { due: 'next Friday' },
    rationale: 'reschedule',
  });

  // It would never throw: "next Friday" sorts above every real date, so the
  // todo would simply never be overdue again.
  const result = await acceptProposal(ctx, rec.id);
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /YYYY-MM-DD/);
  assert.equal(
    (store.get('todos/nordkap-sso.md')!.frontmatter as Record<string, unknown>)['due'],
    '2026-07-10',
  );
});

test('a note already carrying a bad field can still be repaired by a card', async () => {
  // The guard is about what THIS card breaks. A note that is already wrong must
  // stay editable, or the only way out of it is a hand edit.
  const { ctx, store } = fakeContext({
    'todos/nordkap-sso.md': todo({ commitment: 'finished-ish' }),
  });
  const body = store.get('todos/nordkap-sso.md')!.body;
  const rec = updateCard(ctx, body, {
    path: 'todos/nordkap-sso.md',
    frontmatter: { commitment: 'done', resolved: '2026-07-22' },
    rationale: 'fix the value',
  });

  const result = await acceptProposal(ctx, rec.id);
  assert.equal(result.ok, true);
  assert.equal(
    (store.get('todos/nordkap-sso.md')!.frontmatter as Record<string, unknown>)['commitment'],
    'done',
  );
});

/**
 * The repair card the librarian raises for FH-1, and the trap under it. A note
 * that failed its schema is in memory as a plain `note`, so the merge that
 * fixes the field would also have written `type: note` over the file's own
 * `type: meeting` — the repair completing the demotion it was sent to undo.
 */
test('repairing a demoted note fixes the field and gives the note its type back', async () => {
  const stored: Record<string, Stored> = {
    'meetings/nordkap.md': {
      frontmatter: {
        // As FsVault hands it over: coerced to `note`, every original field
        // still riding along, and the miss recorded beside it.
        type: 'note',
        summary: 'Nordkap check-in',
        date: '2026-08-04',
        participants: 'Åsa Lind',
        duration_minutes: 'half an hour',
        sources: [],
      } as Frontmatter,
      body: '## Notes\n',
    },
  };
  const { ctx, store } = fakeContext(stored);
  const readNote = ctx.vault.readNote;
  ctx.vault.readNote = async (p: string) => {
    const note = await readNote(p);
    return note
      ? {
          ...note,
          schemaMiss: { type: 'meeting' as const, error: 'duration_minutes: expected number' },
        }
      : null;
  };

  const rec = updateCard(ctx, stored['meetings/nordkap.md']!.body, {
    path: 'meetings/nordkap.md',
    frontmatter: { duration_minutes: 30 },
    rationale: 'the length was written in words',
  });

  const result = await acceptProposal(ctx, rec.id);
  assert.equal(result.ok, true, result.error);
  const after = store.get('meetings/nordkap.md')!.frontmatter as Record<string, unknown>;
  assert.equal(
    after['type'],
    'meeting',
    'the file said meeting; our reading of it must not become the file',
  );
  assert.equal(after['duration_minutes'], 30);
  assert.equal(after['date'], '2026-08-04', 'and the immutable provenance rode through untouched');
});
