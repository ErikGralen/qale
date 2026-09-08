import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  approveProposal,
  createProposal,
  restoreNoteVersion,
  revertNoteChange,
  runSummaryPass,
  type CreateProposalInput,
  type ProposalRecord,
  type UseCaseContext,
} from '@qale/application';
import {
  APPROVED_REASON,
  titleFromSlug,
  type ActivityRecord,
  type CreateActivityInput,
} from '@qale/domain';
import { FsVault } from '../src/fs-vault.js';
import { GitAdapter } from '../src/git.js';

// Undo against a real repo and a real file: the whole point of the feature is
// that the earlier text comes back and the record of what happened does not
// change. A fake git would test the wiring and none of that.

process.env['GIT_CONFIG_GLOBAL'] = '/dev/null';
process.env['GIT_CONFIG_NOSYSTEM'] = '1';

const NOOP_INDEX: UseCaseContext['index'] = {
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
};

async function workspace(): Promise<{ dir: string; ctx: UseCaseContext; git: GitAdapter }> {
  const dir = await mkdtemp(join(tmpdir(), 'pm-restore-'));
  await mkdir(join(dir, 'notes'), { recursive: true });
  const git = new GitAdapter(dir);
  await git.init();
  const ctx = {
    vault: new FsVault(dir),
    index: NOOP_INDEX,
    git,
    clock: { now: () => '2026-08-02T00:00:00.000Z' },
    proposals: {
      create: () => {
        throw new Error('unused');
      },
      get: () => null,
      list: () => [],
      setStatus: () => {},
      pendingCount: () => 0,
      markStaleFor: () => {},
    },
  } as unknown as UseCaseContext;
  return { dir, ctx, git };
}

test('restoring writes the old text forward: later versions survive and the content matches', async () => {
  const { dir, ctx, git } = await workspace();
  const path = 'notes/x.md';
  const file = join(dir, path);

  await writeFile(file, '---\ntype: note\nsummary: s\n---\n\nFirst draft.\n');
  await git.commitPaths([path], 'create: x');
  await writeFile(file, '---\ntype: note\nsummary: s\n---\n\nWhat the agent wrote.\n');
  await git.commitPaths([path], 'edit: x');

  const before = await git.history(path);
  assert.equal(before.length, 2);
  const first = before[1]!; // oldest

  const note = await restoreNoteVersion(ctx, { path, hash: first.hash });
  assert.equal(note.body.trim(), 'First draft.');
  assert.equal((await readFile(file, 'utf8')).includes('First draft.'), true);

  const after = await git.history(path);
  // Three versions, not one: the restore is a new version on top and nothing
  // that happened in between was discarded.
  assert.equal(after.length, 3);
  assert.equal(after[0]!.message, 'restored an earlier version');
  assert.equal(after[1]!.hash, before[0]!.hash);
  assert.equal(after[2]!.hash, before[1]!.hash);

  // The version we undid is still readable, so the undo is itself undoable.
  const undone = await git.fileAt(path, before[0]!.hash);
  assert.ok(undone?.includes('What the agent wrote.'));
});

test('restoring brings back the text, not the properties', async () => {
  const { dir, ctx, git } = await workspace();
  const path = 'notes/todo.md';
  const file = join(dir, path);

  // `commitment: open` and the invalid `status: wip` are the live state: an old
  // version must not re-open finished work or rewrite fields it never validated.
  await writeFile(
    file,
    '---\ntype: note\nsummary: s\nstatus: wip\ncommitment: open\n---\n\nOld text.\n',
  );
  await git.commitPaths([path], 'create: todo');
  const [old] = await git.history(path);

  await writeFile(
    file,
    '---\ntype: note\nsummary: s\nstatus: wip\ncommitment: done\n---\n\nNew text.\n',
  );
  await git.commitPaths([path], 'edit: todo');

  await restoreNoteVersion(ctx, { path, hash: old!.hash });
  const raw = await readFile(file, 'utf8');
  assert.ok(raw.includes('Old text.'));
  assert.ok(!raw.includes('New text.'));
  assert.ok(raw.includes('commitment: done'), 'the current properties stand');
  assert.ok(raw.includes('status: wip'), 'and are kept byte for byte');
});

test('restoring twice returns to where it started, because the record never shrinks', async () => {
  const { dir, ctx, git } = await workspace();
  const path = 'notes/x.md';
  const file = join(dir, path);
  await writeFile(file, '---\ntype: note\nsummary: s\n---\n\nA.\n');
  await git.commitPaths([path], 'create: x');
  await writeFile(file, '---\ntype: note\nsummary: s\n---\n\nB.\n');
  await git.commitPaths([path], 'edit: x');

  const list = await git.history(path);
  await restoreNoteVersion(ctx, { path, hash: list[1]!.hash }); // back to A
  assert.ok((await readFile(file, 'utf8')).includes('A.'));
  // Undoing the undo: B is still a version, so it can be picked again.
  await restoreNoteVersion(ctx, { path, hash: list[0]!.hash });
  assert.ok((await readFile(file, 'utf8')).includes('B.'));
  assert.equal((await git.history(path)).length, 4);
});

test('a note whose body nobody may rewrite refuses the restore (the UI hides the control for the same reason)', async () => {
  const { dir, ctx, git } = await workspace();
  await mkdir(join(dir, 'sources'), { recursive: true });
  const path = 'sources/t.md';
  const file = join(dir, path);
  const fm = '---\ntype: source\nsummary: s\nprocessing: new\ncaptured: 2026-08-02\n---\n';
  await writeFile(file, `${fm}\nWhat was said.\n`);
  await git.commitPaths([path], 'source: t');
  const [only] = await git.history(path);
  await writeFile(file, `${fm}\nTampered.\n`);

  // The message is user-facing (a toast prints it), so it names the note, not
  // its path or its layer.
  await assert.rejects(
    () => restoreNoteVersion(ctx, { path, hash: only!.hash }),
    /nobody rewrites/,
  );
});

// ---------------------------------------------------------------------------
// The undo (E-2). Same real repo, because "the note comes back" is a claim
// about git and a stand-in would prove none of it.
// ---------------------------------------------------------------------------

const FM = '---\ntype: note\nsummary: s\ntags: [alpha]\n---\n';

test('undoing an edit puts the whole file back, properties included', async () => {
  const { dir, ctx, git } = await workspace();
  const path = 'notes/x.md';
  const file = join(dir, path);
  await writeFile(file, `${FM}\nWhat I wrote.\n`);
  await git.commitPaths([path], 'create: x');
  await writeFile(
    file,
    '---\ntype: note\nsummary: s\ntags: [alpha, beta]\n---\n\nWhat the agent wrote.\n',
  );
  await git.commitPaths([path], 'update: x');

  const applied = (await git.history(path))[0]!;
  const result = await revertNoteChange(ctx, { path, hash: applied.hash });
  assert.deepEqual(result, { path, outcome: 'restored', method: 'patch' });

  const raw = await readFile(file, 'utf8');
  assert.ok(raw.includes('What I wrote.'));
  // The tag the agent added goes too. Half an undo leaves a note nobody wrote.
  assert.ok(!raw.includes('beta'));
  // Forward, not a rewind: the undone change is still a version, so it can be
  // put back in turn.
  assert.equal((await git.history(path)).length, 3);
  assert.ok((await git.fileAt(path, applied.hash))?.includes('What the agent wrote.'));
});

test('undoing a delete brings the note back', async () => {
  const { dir, ctx, git } = await workspace();
  const path = 'notes/x.md';
  const file = join(dir, path);
  await writeFile(file, `${FM}\nStill wanted.\n`);
  await git.commitPaths([path], 'create: x');
  await rm(file);
  await git.commitPaths([path], 'delete: x');
  assert.equal(existsSync(file), false);

  const deleted = (await git.history(path))[0]!;
  const result = await revertNoteChange(ctx, { path, hash: deleted.hash });
  assert.deepEqual(result, { path, outcome: 'undeleted', method: 'patch' });
  assert.ok((await readFile(file, 'utf8')).includes('Still wanted.'));
});

test('undoing a change that created the note takes the note away', async () => {
  const { dir, ctx, git } = await workspace();
  const path = 'notes/agent-wrote-this.md';
  const file = join(dir, path);
  await writeFile(join(dir, 'notes/other.md'), `${FM}\nUnrelated.\n`);
  await git.commitPaths(['notes/other.md'], 'create: other');
  await writeFile(file, `${FM}\nFiled without asking.\n`);
  await git.commitPaths([path], 'note: agent-wrote-this');

  const created = (await git.history(path))[0]!;
  const result = await revertNoteChange(ctx, { path, hash: created.hash });
  assert.deepEqual(result, { path, outcome: 'removed', method: 'patch' });
  assert.equal(existsSync(file), false);
  assert.ok(existsSync(join(dir, 'notes/other.md')), 'nothing else was touched');
  // And it is still in the record, so the undo can be undone.
  assert.ok((await git.fileAt(path, created.hash))?.includes('Filed without asking.'));
});

test('undoing a rename puts the note back under the name it had', async () => {
  const { dir, ctx, git } = await workspace();
  const from = 'notes/old-name.md';
  const to = 'notes/new-name.md';
  await writeFile(join(dir, from), `${FM}\nA body long enough for git to see the rename.\n`);
  await git.commitPaths([from], 'create: old-name');
  await writeFile(join(dir, to), `${FM}\nA body long enough for git to see the rename.\n`);
  await rm(join(dir, from));
  await git.commitPaths([from, to], 'rename: old-name → new-name');

  const renamed = (await git.history(to))[0]!;
  const result = await revertNoteChange(ctx, { path: to, hash: renamed.hash });
  assert.deepEqual(result, { path: from, outcome: 'undeleted', method: 'patch' });
  assert.equal(existsSync(join(dir, to)), false, 'the new name goes');
  assert.ok((await readFile(join(dir, from), 'utf8')).includes('A body long enough'));
});

test('a hash from another note is refused, and nothing is written', async () => {
  const { dir, ctx, git } = await workspace();
  await writeFile(join(dir, 'notes/a.md'), `${FM}\nA.\n`);
  await git.commitPaths(['notes/a.md'], 'create: a');
  await writeFile(join(dir, 'notes/b.md'), `${FM}\nB.\n`);
  await git.commitPaths(['notes/b.md'], 'create: b');
  const other = (await git.history('notes/a.md'))[0]!;

  await assert.rejects(
    () => revertNoteChange(ctx, { path: 'notes/b.md', hash: other.hash }),
    /did not touch this note/,
  );
  assert.ok((await readFile(join(dir, 'notes/b.md'), 'utf8')).includes('B.'));
});

test('there is nothing to restore when the note did not exist in that version', async () => {
  const { dir, ctx, git } = await workspace();
  await writeFile(join(dir, 'notes/a.md'), '---\ntype: note\nsummary: s\n---\n\nA.\n');
  await git.commitPaths(['notes/a.md'], 'create: a');
  const [first] = await git.history('notes/a.md');

  await writeFile(join(dir, 'notes/b.md'), '---\ntype: note\nsummary: s\n---\n\nB.\n');
  await git.commitPaths(['notes/b.md'], 'create: b');

  await assert.rejects(
    () => restoreNoteVersion(ctx, { path: 'notes/b.md', hash: first!.hash }),
    /no longer available/,
  );
  // And the note on disk is untouched.
  assert.ok((await readFile(join(dir, 'notes/b.md'), 'utf8')).includes('B.'));
});

// ---------------------------------------------------------------------------
// A label the summary pass wrote (docs/background-system.md ticket 3). The row
// it leaves has no proposal behind it, so this is the whole way back: the pass
// writes, the pass commits, the row carries that commit, and the undo runs on a
// real repo.
// ---------------------------------------------------------------------------

/** The index entry the pass reads before it opens a file. */
function entry(path: string, title: string) {
  return {
    path,
    slug: path.replace(/\.md$/, ''),
    type: 'note',
    layer: 'authored',
    title,
    summary: title,
    lifecycle: null,
    hasBody: true,
    mtime: Date.UTC(2026, 7, 1),
    frontmatter: {},
    links: [],
  };
}

test('a label the pass wrote can be put back from its Activity row', async () => {
  const { dir, ctx, git } = await workspace();
  const plan = 'notes/q3-plan.md';
  const renewals = 'notes/renewals.md';
  const planRaw = '---\ntype: note\ntitle: Q3 plan\nsummary: Q3 plan\n---\n\nShip SCIM first.\n';
  const renewalsRaw =
    '---\ntype: note\ntitle: Renewals\nsummary: Renewals\n---\n\nNovember is heavy.\n';
  await writeFile(join(dir, plan), planRaw);
  await writeFile(join(dir, renewals), renewalsRaw);
  await git.commitPaths([plan, renewals], 'create: the two notes');

  const rows: ActivityRecord[] = [];
  const notes = [entry(plan, 'Q3 plan'), entry(renewals, 'Renewals')];
  const passCtx = {
    ...ctx,
    index: {
      ...NOOP_INDEX,
      all: () => notes,
      get: (p: string) => notes.find((n) => n.path === p) ?? null,
    },
    activity: {
      record: (input: CreateActivityInput, now: number) => {
        const row = { ...input, id: `a_${rows.length + 1}`, at: now, reverted: null };
        rows.push(row);
        return row;
      },
      list: () => [...rows].reverse(),
      get: (id: string) => rows.find((r) => r.id === id) ?? null,
      latestLearned: () => [],
      forProposal: (id: string) => rows.find((r) => r.proposalId === id) ?? null,
      markReverted: () => {},
    },
  } as unknown as UseCaseContext;

  await runSummaryPass(passCtx, {
    summarise: async () => 'One line about the note.\ntags: pricing',
  });

  const commit = (await git.history(plan))[0]!;
  assert.equal(commit.message, 'maintenance: labels');
  assert.equal(rows.length, 2);
  const row = rows.find((r) => r.path === plan)!;
  assert.equal(row.proposalId, null);
  assert.deepEqual(row.revert, { commit: commit.hash, undo: 'restore' });
  assert.ok((await readFile(join(dir, plan), 'utf8')).includes('tags:'), 'the label landed');

  const result = await revertNoteChange(ctx, { path: row.path!, hash: row.revert.commit! });

  assert.deepEqual(result, { path: plan, outcome: 'restored', method: 'patch' });
  assert.equal(await readFile(join(dir, plan), 'utf8'), planRaw, 'byte for byte, labels gone');
  // One row, one note. The pass commit touched both, and the undo asked about
  // one, so the other keeps what the pass wrote.
  assert.ok((await readFile(join(dir, renewals), 'utf8')).includes('tags:'));
});

// ---------------------------------------------------------------------------
// The undo as a reverse patch (docs/fewer-approvals.md FA-2). Every autosave is
// its own commit, so the PM almost always has versions on top of the agent's.
// These are about what happens to those.
// ---------------------------------------------------------------------------

test('undoing an edit keeps what the PM typed afterwards', async () => {
  const { dir, ctx, git } = await workspace();
  const path = 'notes/rollout.md';
  const file = join(dir, path);
  await writeFile(file, `${FM}\nOne.\n\nTwo.\n\nThree.\n`);
  await git.commitPaths([path], 'create: rollout');

  // The agent rewrites the middle line.
  await writeFile(file, `${FM}\nOne.\n\nTwo, as the agent put it.\n\nThree.\n`);
  await git.commitPaths([path], 'update: rollout');
  const applied = (await git.history(path))[0]!;

  // The PM keeps typing, at the other end of the file. Two autosaves, two
  // commits, exactly as the editor writes them.
  await writeFile(file, `${FM}\nOne.\n\nTwo, as the agent put it.\n\nThree.\n\nFour, mine.\n`);
  await git.commitPaths([path], 'save: rollout');
  await writeFile(
    file,
    `${FM}\nOne.\n\nTwo, as the agent put it.\n\nThree.\n\nFour, mine.\n\nFive, also mine.\n`,
  );
  await git.commitPaths([path], 'save: rollout');

  const result = await revertNoteChange(ctx, { path, hash: applied.hash });
  assert.deepEqual(result, { path, outcome: 'restored', method: 'patch' });

  const raw = await readFile(file, 'utf8');
  assert.ok(raw.includes('\nTwo.\n'), "the agent's line is back the way it was");
  assert.ok(!raw.includes('as the agent put it'));
  assert.ok(raw.includes('Four, mine.'), 'and what the PM wrote after it stands');
  assert.ok(raw.includes('Five, also mine.'));
});

test('a frontmatter-only change is taken back out without touching the body written since', async () => {
  const { dir, ctx, git } = await workspace();
  const path = 'notes/tagged.md';
  const file = join(dir, path);
  await writeFile(file, `${FM}\nMy own paragraph.\n`);
  await git.commitPaths([path], 'create: tagged');
  await writeFile(
    file,
    `---\ntype: note\nsummary: s\ntags: [alpha, beta]\n---\n\nMy own paragraph.\n`,
  );
  await git.commitPaths([path], 'labels: tagged');
  const applied = (await git.history(path))[0]!;

  await writeFile(
    file,
    `---\ntype: note\nsummary: s\ntags: [alpha, beta]\n---\n\nMy own paragraph.\n\nAnd a second one.\n`,
  );
  await git.commitPaths([path], 'save: tagged');

  const result = await revertNoteChange(ctx, { path, hash: applied.hash });
  assert.equal(result.method, 'patch');
  const raw = await readFile(file, 'utf8');
  assert.ok(raw.includes('tags: [alpha]'), 'the tag the pass added goes');
  assert.ok(!raw.includes('beta'));
  assert.ok(raw.includes('And a second one.'), 'the paragraph written since stays');
});

test('when the reverse patch has nowhere to land the whole file goes back, and the undo says so', async () => {
  const { dir, ctx, git } = await workspace();
  const path = 'notes/rewritten.md';
  const file = join(dir, path);
  const before = `${FM}\nOne.\n\nTwo.\n\nThree.\n`;
  await writeFile(file, before);
  await git.commitPaths([path], 'create: rewritten');
  await writeFile(file, `${FM}\nOne.\n\nTwo, as the agent put it.\n\nThree.\n`);
  await git.commitPaths([path], 'update: rewritten');
  const applied = (await git.history(path))[0]!;

  // The PM rewrites the very lines the undo would search for, so there is
  // nothing left to take out.
  await writeFile(file, `${FM}\nA page about something else now.\n`);
  await git.commitPaths([path], 'save: rewritten');

  const result = await revertNoteChange(ctx, { path, hash: applied.hash });
  assert.deepEqual(result, { path, outcome: 'restored', method: 'snapshot' });
  assert.equal(await readFile(file, 'utf8'), before, 'the file as it read before the change');
});

test('undoing a page that cited a transcript marks the transcript unread again', async () => {
  const { dir, ctx, git } = await workspace();
  await mkdir(join(dir, 'sources'), { recursive: true });
  const source = 'sources/nordkap-call.md';
  const page = 'notes/nordkap-write-up.md';
  const unread =
    '---\ntype: source\nsummary: Nordkap call\nprocessing: new\ncaptured: 2026-08-02\n---\n\nWhat was said.\n';
  await writeFile(join(dir, source), unread);
  await git.commitPaths([source], 'source: nordkap-call');

  // The accept: the page lands in one commit, and the source flips to read in
  // a commit of its own, which is what leaves it flipped after an undo.
  await writeFile(
    join(dir, page),
    '---\ntype: note\nsummary: Nordkap write-up\nsources: ["[[sources/nordkap-call]]"]\n---\n\nWhat it meant.\n',
  );
  await git.commitPaths([page], 'note: nordkap-write-up');
  const applied = (await git.history(page))[0]!;
  await writeFile(join(dir, source), unread.replace('processing: new', 'processing: processed'));
  await git.commitPaths([source], 'processing: sources/nordkap-call → processed');

  const result = await revertNoteChange(ctx, { path: page, hash: applied.hash });
  assert.deepEqual(result, { path: page, outcome: 'removed', method: 'patch' });
  assert.equal(existsSync(join(dir, page)), false);

  const raw = await readFile(join(dir, source), 'utf8');
  assert.ok(raw.includes('processing: new'), 'the transcript is waiting to be read again');
  assert.ok(raw.includes('What was said.'), 'and nothing else in it moved');
  // One commit, not two: the page and the mark went back together.
  assert.equal((await git.history(source))[0]!.message, `undo: ${titleFromSlug(page)}`);
});

test('a source the PM marked read themselves is left alone by the undo', async () => {
  const { dir, ctx, git } = await workspace();
  await mkdir(join(dir, 'sources'), { recursive: true });
  const source = 'sources/read-already.md';
  const page = 'notes/second-write-up.md';
  await writeFile(
    join(dir, source),
    '---\ntype: source\nsummary: A call\nprocessing: processed\ncaptured: 2026-08-02\n---\n\nWhat was said.\n',
  );
  await git.commitPaths([source], 'source: read-already');
  await writeFile(
    join(dir, page),
    '---\ntype: note\nsummary: Second write-up\nsources: ["[[sources/read-already]]"]\n---\n\nWhat it meant.\n',
  );
  await git.commitPaths([page], 'note: second-write-up');
  const applied = (await git.history(page))[0]!;

  await revertNoteChange(ctx, { path: page, hash: applied.hash });
  // It said `processed` before the change landed, so the change is not what
  // marked it, and the undo has no claim on it.
  assert.ok((await readFile(join(dir, source), 'utf8')).includes('processing: processed'));
  assert.equal((await git.history(source)).length, 1, 'not even a commit');
});

// ---------------------------------------------------------------------------
// A card the PM approved (docs/receipt-redesign.md RC-4). The row it leaves is
// the same row a silent write leaves, so the same undo runs on it. Against a
// real repo, because the whole promise is that the file goes back.
// ---------------------------------------------------------------------------

/** A workspace whose cards and Activity rows are kept in memory. */
function approving(ctx: UseCaseContext) {
  const rows = new Map<string, ProposalRecord>();
  const activity: ActivityRecord[] = [];
  let seq = 0;
  return {
    activity,
    ctx: {
      ...ctx,
      proposals: {
        create: (input: CreateProposalInput, now: number) => {
          const rec = {
            ...input,
            id: `p_${++seq}`,
            skill: input.skill ?? null,
            status: 'pending',
            created: now,
            resolved: null,
          } as unknown as ProposalRecord;
          rows.set(rec.id, rec);
          return rec;
        },
        get: (id: string) => rows.get(id) ?? null,
        list: () => [...rows.values()],
        setStatus: (id: string, status: string) => {
          const rec = rows.get(id);
          if (rec) rows.set(id, { ...rec, status } as ProposalRecord);
        },
        setEditedPayload: () => {},
        pendingCount: () => 0,
        markStaleFor: () => {},
      },
      activity: {
        record: (input: CreateActivityInput, now: number) => {
          const row = { ...input, id: `a_${activity.length + 1}`, at: now, reverted: null };
          activity.push(row);
          return row;
        },
        list: () => [...activity].reverse(),
        get: (id: string) => activity.find((r) => r.id === id) ?? null,
        latestLearned: () => [],
        forProposal: (id: string) => activity.find((r) => r.proposalId === id) ?? null,
        markReverted: () => {},
      },
    } as unknown as UseCaseContext,
  };
}

test('a note card the PM approved can be put back from its Activity row', async () => {
  const plain = await workspace();
  const { dir, git } = plain;
  const { ctx, activity } = approving(plain.ctx);
  // A repo with a commit already in it, which is what any real workspace is.
  await writeFile(join(dir, 'notes/other.md'), `${FM}\nUnrelated.\n`);
  await git.commitPaths(['notes/other.md'], 'create: other');

  const path = 'notes/rollout-runbook.md';
  const rec = createProposal(ctx, {
    kind: 'note',
    sessionId: 's1',
    skill: null,
    targetPath: path,
    baseHash: null,
    payload: {
      path,
      frontmatter: { type: 'note', title: 'Rollout runbook', summary: 'Rollout runbook' },
      body: 'Entra first.',
      rationale: 'Because.',
    },
    rationale: 'Because.',
    evidence: [],
    inference: false,
  });

  const result = await approveProposal(ctx, rec.id);
  assert.equal(result.ok, true);
  assert.ok(existsSync(join(dir, path)), 'the page landed');

  assert.equal(activity.length, 1);
  const row = activity[0]!;
  assert.equal(result.activityId, row.id);
  assert.equal(row.reason, APPROVED_REASON);
  assert.equal(row.revert.undo, 'delete');
  assert.equal(row.revert.commit, (await git.history(path))[0]!.hash);

  const undone = await revertNoteChange(ctx, {
    path: row.path!,
    hash: row.revert.commit!,
    activityId: row.id,
    proposalId: row.proposalId!,
  });

  assert.deepEqual(undone, { path, outcome: 'removed', method: 'patch' });
  assert.equal(existsSync(join(dir, path)), false, 'the approved page is gone again');
  assert.ok(existsSync(join(dir, 'notes/other.md')), 'nothing else was touched');
});

test('an update card the PM approved goes back to the text it changed', async () => {
  const plain = await workspace();
  const { dir, git } = plain;
  const { ctx, activity } = approving(plain.ctx);
  const path = 'notes/nordkap.md';
  const before = `${FM}\nThe old line.\n`;
  await writeFile(join(dir, path), before);
  await git.commitPaths([path], 'create: nordkap');

  const rec = createProposal(ctx, {
    kind: 'update',
    sessionId: 's1',
    skill: null,
    targetPath: path,
    baseHash: null,
    payload: {
      path,
      patch: [{ search: 'The old line.', replace: 'The new line.' }],
      rationale: 'Because.',
    },
    rationale: 'Because.',
    evidence: [],
    inference: false,
  });

  const result = await approveProposal(ctx, rec.id);
  assert.equal(result.ok, true);
  assert.ok((await readFile(join(dir, path), 'utf8')).includes('The new line.'));

  const row = activity[0]!;
  assert.equal(row.revert.undo, 'restore');
  const undone = await revertNoteChange(ctx, { path: row.path!, hash: row.revert.commit! });

  assert.deepEqual(undone, { path, outcome: 'restored', method: 'patch' });
  assert.equal(await readFile(join(dir, path), 'utf8'), before, 'byte for byte, as it read before');
});
