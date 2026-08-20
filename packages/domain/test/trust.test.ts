import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  actorKind,
  parseActor,
  trustTier,
  latestVerification,
  trustTierLabel,
  parseFrontmatter,
  type Verification,
} from '../src/index.js';

/**
 * OKF trust family (OKF alignment, phase 2): the actor convention (§7)
 * and tier derivation (§5.3). Additive by contract — no `verified` means
 * `unverified`, never a rejection (§11).
 */

test('actorKind classifies by the OKF actor prefix', () => {
  assert.equal(actorKind('human:asa'), 'human');
  assert.equal(actorKind('process:sync-engine'), 'process');
  assert.equal(actorKind('after-meeting/1.2'), 'agent');
  assert.equal(actorKind('anything-else'), 'agent');
});

test('parseActor splits kind from id', () => {
  assert.deepEqual(parseActor('human:asa'), { kind: 'human', id: 'asa' });
  assert.deepEqual(parseActor('process:sync'), { kind: 'process', id: 'sync' });
  assert.deepEqual(parseActor('librarian/2.0'), { kind: 'agent', id: 'librarian/2.0' });
});

test('trustTier: human beats machine beats unverified', () => {
  assert.equal(trustTier(undefined), 'unverified');
  assert.equal(trustTier([]), 'unverified');
  assert.equal(trustTier([{ by: 'process:sync', at: '2026-07-20' }]), 'machine');
  assert.equal(trustTier([{ by: 'agent/1', at: '2026-07-20' }]), 'machine');
  assert.equal(
    trustTier([
      { by: 'process:sync', at: '2026-07-20' },
      { by: 'human:asa', at: '2026-07-21' },
    ]),
    'human',
  );
  assert.equal(trustTierLabel('human'), 'Human-reviewed');
});

test('latestVerification picks the newest of the tier-setting kind', () => {
  const v = latestVerification([
    { by: 'process:sync', at: '2026-07-25' },
    { by: 'human:asa', at: '2026-07-20' },
    { by: 'human:bo', at: '2026-07-22' },
  ]);
  // Human tier → newest human review, not the newer machine one.
  assert.deepEqual(v, { by: 'human:bo', at: '2026-07-22' });
});

test('verified is accepted, optional, and additive on the base schema', () => {
  const withV = parseFrontmatter({
    type: 'insight',
    summary: 's',
    evidence: ['[[sources/x]]'],
    verified: [{ by: 'human:asa', at: '2026-07-20' }],
  });
  assert.ok(withV.ok, withV.error);
  assert.equal((withV.data as { verified?: unknown[] }).verified?.length, 1);

  // Absent is fine — never a rejection.
  const without = parseFrontmatter({ type: 'note', summary: 's' });
  assert.ok(without.ok);

  // Malformed verified entries are rejected by the schema (must be {by, at}).
  const bad = parseFrontmatter({ type: 'note', summary: 's', verified: [{ by: 'human:asa' }] });
  assert.equal(bad.ok, false);
});

test('a lone verified mapping reads as the one-entry list it means', () => {
  // What a model (or a hand-edit) writes when there is only one verifier:
  //   verified:
  //     by: human:asa
  //     at: 2026-07-20
  const one = parseFrontmatter({
    type: 'note',
    summary: 's',
    verified: { by: 'human:asa', at: '2026-07-20' },
  });
  assert.ok(one.ok, one.error);
  assert.deepEqual((one.data as { verified?: unknown[] }).verified, [
    { by: 'human:asa', at: '2026-07-20' },
  ]);
  assert.equal(trustTier((one.data as { verified?: Verification[] }).verified), 'human');

  // The tolerance is for the shape, not for missing keys.
  const halfWritten = parseFrontmatter({
    type: 'note',
    summary: 's',
    verified: { by: 'human:asa' },
  });
  assert.equal(halfWritten.ok, false);
});

test('a list field written as one value is the one-entry list it means', () => {
  // The dash left off is the same mistake `verified` made, and it is not
  // special to `verified`: every list field takes it the same way.
  const meeting = parseFrontmatter({
    type: 'meeting',
    summary: 's',
    tags: 'pricing',
    participants: 'Åsa Lind',
  });
  assert.ok(meeting.ok, meeting.error);
  assert.deepEqual((meeting.data as { tags?: unknown }).tags, ['pricing']);
  assert.deepEqual((meeting.data as { participants?: unknown }).participants, ['Åsa Lind']);

  const insight = parseFrontmatter({ type: 'insight', summary: 's', evidence: '[[sources/x]]' });
  assert.ok(insight.ok, insight.error);
  assert.deepEqual((insight.data as { evidence?: unknown }).evidence, ['[[sources/x]]']);

  // `tags:` with nothing after it is the field being absent, not a broken note.
  const empty = parseFrontmatter({ type: 'note', summary: 's', tags: null, sources: null });
  assert.ok(empty.ok, empty.error);
  assert.equal((empty.data as { tags?: unknown }).tags, undefined);
  assert.deepEqual((empty.data as { sources?: unknown }).sources, []);

  // Still a real list of real refs: an empty entry is not silently swallowed.
  const junk = parseFrontmatter({ type: 'note', summary: 's', sources: [''] });
  assert.equal(junk.ok, false);
});
