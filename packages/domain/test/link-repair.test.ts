import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestLinkCandidates, type LinkRepairCandidate } from '../src/index.js';

const c = (slug: string, title = ''): LinkRepairCandidate => ({ slug, title });

const slugs = (target: string, cands: LinkRepairCandidate[], max?: number): string[] =>
  suggestLinkCandidates(target, cands, max).map((x) => x.slug);

test('candidates survive case, space and punctuation drift', () => {
  const cands = [c('people/tom-devlin', 'Tom Devlin'), c('customers/nordkap-shipping', 'Nordkap Shipping')];
  assert.deepEqual(slugs('Tom Devlin', cands), ['people/tom-devlin']);
  assert.deepEqual(slugs('Tom_Devlin', cands), ['people/tom-devlin']);
  assert.deepEqual(slugs('people/Tom-Devlin', cands), ['people/tom-devlin']);
});

test('candidates match by note title', () => {
  const cands = [c('customers/kranelund-logistics', 'Kranelund Logistics AB')];
  assert.deepEqual(slugs('kranelund-logistics-ab', cands), ['customers/kranelund-logistics']);
});

test('candidates match date-prefixed files', () => {
  const cands = [c('signals/2026-07-12-gong-sso', 'Gong: SSO ask')];
  assert.deepEqual(slugs('gong-sso', cands), ['signals/2026-07-12-gong-sso']);
});

test('candidates reach across small typos', () => {
  const cands = [c('customers/nordkap-shipping'), c('customers/bergman-falk')];
  assert.deepEqual(slugs('nordkap-shiping', cands), ['customers/nordkap-shipping']);
  assert.deepEqual(slugs('bergman-folk', cands), ['customers/bergman-falk']);
});

test('containment needs 4 characters, so short noise matches nothing', () => {
  const cands = [c('people/tom-devlin'), c('people/elin-vestergaard')];
  assert.deepEqual(slugs('tom-devlin-1on1', cands), ['people/tom-devlin']);
  assert.deepEqual(slugs('tom', cands), []);
});

test('Swedish diacritics fold, keeping distinct names distinct', () => {
  const cands = [c('people/hook', 'Höök'), c('people/hok', 'Hök')];
  assert.deepEqual(slugs('Hök', cands), ['people/hok']);
  assert.deepEqual(slugs('Höök', cands), ['people/hook']);
  assert.deepEqual(slugs('Möte med Åsa', [c('meetings/2026-07-20-mote-med-asa', 'Möte med Åsa')]), [
    'meetings/2026-07-20-mote-med-asa',
  ]);
});

test('an ambiguous target offers both, ranked, and the hint never resolves it', () => {
  const twins = [c('people/tom-devlin'), c('meetings/tom-devlin')];
  assert.deepEqual(slugs('tom-devlin-x', twins), ['people/tom-devlin', 'meetings/tom-devlin']);
});

test('candidates cap at max, and a hopeless target gets none', () => {
  const cands = [c('people/anna-nord'), c('people/anna-lund'), c('people/anna-berg'), c('people/anna-falk')];
  assert.equal(suggestLinkCandidates('anna', cands, 3).length, 3);
  assert.deepEqual(slugs('totally-unrelated', cands), []);
});
