import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionCards, withdrawProposal } from '../src/use-cases/proposals.js';
import type { CreateProposalInput, ProposalRecord, UseCaseContext } from '../src/ports.js';

/**
 * Taking a card back, and the list that tells a session it can.
 *
 * The bug both of these close: a correction typed into a live session ("it's
 * qale.ai, not kale") used to hand the PM MORE cards than they started with.
 * The session could not see that two of its cards were already approved and two
 * were still waiting, and it had no way to take back the wrong ones, so it
 * re-proposed the lot. The rules worth pinning down here are the refusals — a
 * withdraw that reached someone else's card, or a card the PM had already
 * decided, would turn "ignore what I said" into a write nobody approved.
 */

function worldWith(cards: Partial<ProposalRecord>[]): UseCaseContext & { rows: ProposalRecord[] } {
  const rows = cards.map((p, i) => ({
    id: `p${i + 1}`,
    kind: 'note',
    sessionId: 's1',
    skill: null,
    targetPath: null,
    baseHash: null,
    payload: {},
    rationale: '',
    evidence: [],
    inference: false,
    status: 'pending',
    created: i,
    resolved: null,
    ...p,
  })) as ProposalRecord[];
  const ctx = {
    rows,
    proposals: {
      create: (_input: CreateProposalInput) => rows[0]!,
      list: (status?: string) => rows.filter((r) => !status || r.status === status),
      get: (id: string) => rows.find((r) => r.id === id) ?? null,
      setStatus: (id: string, status: string, resolved: number | null) => {
        const row = rows.find((r) => r.id === id);
        if (row) Object.assign(row, { status, resolved });
      },
      pendingCount: () => rows.filter((r) => r.status === 'pending').length,
    },
  };
  return ctx as unknown as UseCaseContext & { rows: ProposalRecord[] };
}

/** A card as `propose_note` stores one. */
const card = (title: string, over: Partial<ProposalRecord> = {}): Partial<ProposalRecord> => ({
  targetPath: `notes/${title.toLowerCase().replace(/\W+/g, '-')}.md`,
  payload: { path: 'notes/x.md', frontmatter: { type: 'note', title }, body: '', rationale: title },
  rationale: title,
  ...over,
});

test('a session takes back its own waiting card, and nothing is written', () => {
  const ctx = worldWith([card('Register kale.ai')]);
  assert.deepEqual(withdrawProposal(ctx, 'p1', 's1'), { ok: true });
  assert.equal(ctx.rows[0]!.status, 'withdrawn');
  // Withdrawn is not pending, so it leaves the Inbox and the session's own card
  // list by the same read every surface already does.
  assert.equal(ctx.proposals.list('pending').length, 0);
});

test('a card the PM already approved cannot be taken back — it is a note now', () => {
  const ctx = worldWith([card('Register qale.ai', { status: 'accepted' })]);
  const result = withdrawProposal(ctx, 'p1', 's1');
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /already accepted/);
  assert.equal(ctx.rows[0]!.status, 'accepted', 'the PM decided it; nothing here overrides that');
});

test('a discarded card says so rather than reporting a silent success', () => {
  const ctx = worldWith([card('Register qale.ai', { status: 'rejected' })]);
  const result = withdrawProposal(ctx, 'p1', 's1');
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /already rejected/);
});

test("another session's card is not yours to take back", () => {
  const ctx = worldWith([card('Register kale.ai', { sessionId: 's2' })]);
  const result = withdrawProposal(ctx, 'p1', 's1');
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /another session/);
  assert.equal(ctx.rows[0]!.status, 'pending');
});

test('an id that names nothing fails loudly', () => {
  const result = withdrawProposal(worldWith([]), 'p9', 's1');
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /no card called p9/);
});

test('the session is told where each of its own cards stands, oldest first', () => {
  const ctx = worldWith([
    card('Register kale.ai', { status: 'accepted' }),
    card('Tell Nordkap about the domain'),
    card("Someone else's card", { sessionId: 's2' }),
  ]);
  const mine = sessionCards(ctx, 's1');
  assert.deepEqual(
    mine.map((c) => [c.id, c.status, c.title]),
    [
      ['p1', 'accepted', 'Register kale.ai'],
      ['p2', 'pending', 'Tell Nordkap about the domain'],
    ],
    "only this session's cards, in the order it made them, with what became of each",
  );
});
