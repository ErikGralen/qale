import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTE_LIFECYCLES,
  NOTE_TYPES,
  lifecycleField,
  lifecycleValue,
  lifecycleValueLabel,
  normalizeLifecycleKeys,
  parseFrontmatter,
  type NoteType,
} from '../src/index.js';

/**
 * Each lifecycle has its own field name and its own enum, so `active` on a
 * decision and `active` on a customer are never the same key (ticket 8). Vaults
 * written before that still say `status:`, and must keep working.
 */

test('every type carries at most one lifecycle, and never under the name "status"', () => {
  for (const type of NOTE_TYPES) {
    const lc = NOTE_LIFECYCLES[type];
    if (!lc) continue;
    assert.notEqual(lc.field, 'status', `${type} must not call its lifecycle "status"`);
    assert.ok(lc.values.length > 0, `${type} lifecycle needs values`);
    for (const v of lc.values) {
      assert.ok(lc.valueLabels[v], `${type}/${v} needs a human label`);
    }
  }
});

test('the three "active"s are three different fields', () => {
  assert.equal(lifecycleField('decision'), 'standing');
  assert.equal(lifecycleField('customer'), 'relationship');
  assert.equal(lifecycleField('source'), 'processing');
  assert.equal(lifecycleField('todo'), 'commitment');
  assert.equal(lifecycleField('theme'), 'stance');
  // Types with no lifecycle say so rather than faking one.
  assert.equal(lifecycleField('person'), null);
  assert.equal(lifecycleField('skill'), null);
});

test('lifecycleValue reads whichever key the type uses', () => {
  assert.equal(lifecycleValue('decision', { standing: 'superseded' }), 'superseded');
  assert.equal(lifecycleValue('customer', { relationship: 'churned' }), 'churned');
  assert.equal(lifecycleValue('person', { standing: 'active' }), null);
  assert.equal(lifecycleValue('todo', {}), null);
});

test('values render as labels, never raw tokens', () => {
  assert.equal(lifecycleValueLabel('theme', 'wont-do'), "Won't do");
  assert.equal(lifecycleValueLabel('decision', 'superseded'), 'Superseded');
  assert.equal(lifecycleValueLabel('customer', 'prospect'), 'Prospect');
  // A token no lifecycle claims still reads as words, never as a raw enum.
  assert.equal(lifecycleValueLabel('ticket', 'in_progress'), 'In progress');
  assert.equal(lifecycleValueLabel(null, 'wont-do'), 'Wont do');
});

test("compat read: a legacy `status:` folds onto the type's own key", () => {
  const decision = parseFrontmatter({
    type: 'decision',
    summary: 'Adopt WorkOS',
    status: 'superseded',
    sources: [],
  });
  assert.equal(decision.ok, true, decision.error);
  const dfm = decision.data as Record<string, unknown>;
  assert.equal(dfm['standing'], 'superseded');
  assert.equal(dfm['status'], undefined, 'the old key does not survive the read');

  const customer = parseFrontmatter({ type: 'customer', summary: 'Nordkap', status: 'churned' });
  assert.equal((customer.data as Record<string, unknown>)['relationship'], 'churned');

  const todo = parseFrontmatter({ type: 'todo', summary: 'Email Åsa', status: 'done' });
  assert.equal((todo.data as Record<string, unknown>)['commitment'], 'done');

  const source = parseFrontmatter({ type: 'source', summary: 'Transcript', status: 'processed' });
  assert.equal((source.data as Record<string, unknown>)['processing'], 'processed');
});

test('compat read: the retired `active` folds onto `processed`', () => {
  // Old wikipages/sources were filed `status: active`, which only ever meant
  // "done with it and relied upon" — the same thing `processed` says.
  const page = parseFrontmatter({
    type: 'wikipage',
    summary: 'Enterprise onboarding',
    status: 'active',
    provider: 'confluence',
    external_id: '98342',
    container: 'PROD',
    version: 17,
    remote_updated: '2026-07-18T09:12:00Z',
    url: 'https://example.atlassian.net/wiki/x',
  });
  assert.equal(page.ok, true, page.error);
  assert.equal((page.data as Record<string, unknown>)['processing'], 'processed');
});

test('compat read leaves a value the lifecycle does not recognise alone', () => {
  // Somebody else's `status: draft` is an unknown key, not a lifecycle, and the
  // workspace round-trips unknown keys rather than guessing at them.
  const r = parseFrontmatter({ type: 'note', summary: 'scratch', status: 'draft', sources: [] });
  assert.equal(r.ok, true, r.error);
  const fm = r.data as Record<string, unknown>;
  assert.equal(fm['status'], 'draft');
  assert.equal(fm['processing'], undefined);
});

test('compat read: the new key wins when a note somehow carries both', () => {
  const out = normalizeLifecycleKeys({
    type: 'todo',
    summary: 'x',
    status: 'done',
    commitment: 'open',
  }) as Record<string, unknown>;
  assert.equal(out['commitment'], 'open');
  assert.equal(out['status'], undefined);
});

test('normalizeLifecycleKeys is a no-op on types with no lifecycle', () => {
  const input = { type: 'person' as NoteType, summary: 'Åsa', status: 'active' };
  assert.equal(normalizeLifecycleKeys(input), input);
});
