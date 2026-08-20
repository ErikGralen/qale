import test from 'node:test';
import assert from 'node:assert/strict';
import { findDuplicate, titleOverlap, type ProposalIdentity } from '../src/proposals/duplicate.js';

/**
 * The duplicate check, from both directions at once.
 *
 * Every test here is a pair, and half of them assert that a pair stays APART.
 * That half is the important half: a duplicate that slips through costs one
 * click, while a real finding swallowed as a duplicate is gone and nobody is
 * told. When the threshold is tuned, these are what says whether it went too
 * far.
 */

const todo = (
  title: string,
  path = `todos/2026-08-05-${title.toLowerCase().replace(/\W+/g, '-')}.md`,
): ProposalIdentity => ({
  kind: 'note',
  targetPath: path,
  noteType: 'todo',
  title,
});

test('the same commitment worded differently is one commitment', () => {
  const pending = [todo('Get back to Jonas on pricing')];
  assert.ok(findDuplicate(pending, todo('Get back to Jonas about pricing')));
  assert.ok(findDuplicate(pending, todo('get back to jonas on pricing')));
});

test('a shorter phrasing of the same commitment still matches', () => {
  const pending = [todo('Send Nordkap the SSO rollout dates')];
  assert.ok(findDuplicate(pending, todo('Send Nordkap SSO rollout dates')));
});

test('one word apart in a way that changes the meaning stays two commitments', () => {
  const pending = [todo('Send Nordkap the Q3 roadmap')];
  assert.equal(findDuplicate(pending, todo('Send Nordkap the Q4 roadmap')), null);
});

test('same verb, different object, stays two commitments', () => {
  const pending = [
    todo('Send Nordkap the SSO rollout dates'),
    todo('Write up the schema decision'),
  ];
  assert.equal(findDuplicate(pending, todo('Send Kranelund the billing export')), null);
  assert.equal(findDuplicate(pending, todo('Talk to Sara about pricing')), null);
});

test('two terse titles sharing one word are not duplicates', () => {
  // Below MIN_SHARED_WORDS these would score 1.0 on overlap alone.
  const pending = [todo('Email Jonas')];
  assert.equal(findDuplicate(pending, todo('Call Jonas')), null);
});

test('a todo and an insight that read alike are different cards', () => {
  const pending = [todo('Nordkap wants SCIM before renewal')];
  const insight: ProposalIdentity = {
    kind: 'note',
    targetPath: 'insights/nordkap-wants-scim-before-renewal.md',
    noteType: 'insight',
    title: 'Nordkap wants SCIM before renewal',
  };
  assert.equal(findDuplicate(pending, insight), null);
});

test('two cards writing the same path collide whatever they are called', () => {
  const pending = [todo('Send Nordkap the rollout dates', 'todos/2026-08-05-nordkap.md')];
  assert.ok(findDuplicate(pending, todo('Something else entirely', 'todos/2026-08-05-nordkap.md')));
});

test('an update to one page does not block a different update to the same page', () => {
  const pending: ProposalIdentity[] = [
    {
      kind: 'update',
      targetPath: 'customers/nordkap.md',
      title: 'record the SSO rollout dates they were given',
    },
  ];
  assert.equal(
    findDuplicate(pending, {
      kind: 'update',
      targetPath: 'customers/nordkap.md',
      title: 'answer the open question about billing exports',
    }),
    null,
  );
  assert.ok(
    findDuplicate(pending, {
      kind: 'update',
      targetPath: 'customers/nordkap.md',
      title: 'record the SSO rollout dates they were given',
    }),
  );
});

test('the same words about a different page are not a duplicate', () => {
  const pending: ProposalIdentity[] = [
    {
      kind: 'update',
      targetPath: 'customers/nordkap.md',
      title: 'record the rollout dates they were given',
    },
  ];
  assert.equal(
    findDuplicate(pending, {
      kind: 'update',
      targetPath: 'customers/kranelund.md',
      title: 'record the rollout dates they were given',
    }),
    null,
  );
});

test('kinds never cross', () => {
  const pending: ProposalIdentity[] = [
    { kind: 'decision', targetPath: 'decisions/adopt-workos.md', title: 'Adopt WorkOS for SSO' },
  ];
  assert.equal(
    findDuplicate(pending, {
      kind: 'note',
      targetPath: 'notes/x.md',
      title: 'Adopt WorkOS for SSO',
    }),
    null,
  );
});

test('overlap folds diacritics so half-Swedish titles compare', () => {
  assert.equal(titleOverlap('Boka möte med Jonas', 'Boka mote med Jonas'), 1);
});
