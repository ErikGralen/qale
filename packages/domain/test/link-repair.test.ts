import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  suggestLinkTarget,
  suggestLinkCandidates,
  buildLinkRepairPatch,
  findUnlinkedMentions,
  buildMentionLinkPatch,
  type LinkRepairCandidate,
} from '../src/index.js';

const c = (slug: string, title = ''): LinkRepairCandidate => ({ slug, title });

test('suggestLinkTarget matches case/space/punctuation drift', () => {
  const cands = [c('people/tom-devlin', 'Tom Devlin'), c('customers/nordkap-shipping', 'Nordkap Shipping')];
  assert.equal(suggestLinkTarget('Tom Devlin', cands), 'people/tom-devlin');
  assert.equal(suggestLinkTarget('Tom_Devlin', cands), 'people/tom-devlin');
  assert.equal(suggestLinkTarget('people/Tom-Devlin', cands), 'people/tom-devlin');
});

test('suggestLinkTarget matches by note title', () => {
  const cands = [c('customers/kranelund-logistics', 'Kranelund Logistics AB')];
  assert.equal(suggestLinkTarget('kranelund-logistics-ab', cands), 'customers/kranelund-logistics');
});

test('suggestLinkTarget matches date-prefixed files', () => {
  const cands = [c('signals/2026-07-12-gong-sso', 'Gong: SSO ask')];
  assert.equal(suggestLinkTarget('gong-sso', cands), 'signals/2026-07-12-gong-sso');
});

test('suggestLinkTarget repairs small typos', () => {
  const cands = [c('customers/nordkap-shipping'), c('customers/bergman-falk')];
  assert.equal(suggestLinkTarget('nordkap-shiping', cands), 'customers/nordkap-shipping');
  assert.equal(suggestLinkTarget('bergman-folk', cands), 'customers/bergman-falk');
});

test('suggestLinkTarget expands unique short names, not short noise', () => {
  const cands = [c('people/tom-devlin'), c('people/elin-vestergaard')];
  assert.equal(suggestLinkTarget('tom-devlin-1on1', cands), 'people/tom-devlin');
  // 3 chars is below the containment floor — too easy to hit by accident.
  assert.equal(suggestLinkTarget('tom', cands), null);
});

test('suggestLinkTarget folds Swedish diacritics, keeping distinct names distinct', () => {
  const cands = [c('people/hook', 'Höök'), c('people/hok', 'Hök')];
  assert.equal(suggestLinkTarget('Hök', cands), 'people/hok');
  assert.equal(suggestLinkTarget('Höök', cands), 'people/hook');
  assert.equal(
    suggestLinkTarget('Möte med Åsa', [c('meetings/2026-07-20-mote-med-asa', 'Möte med Åsa')]),
    'meetings/2026-07-20-mote-med-asa',
  );
});

test('suggestLinkTarget declines ambiguous and hopeless targets', () => {
  const twins = [c('people/tom-devlin'), c('meetings/tom-devlin')];
  assert.equal(suggestLinkTarget('tom-devlin-x', twins), null);
  assert.equal(suggestLinkTarget('totally-unrelated', [c('people/tom-devlin')]), null);
});

test('suggestLinkCandidates ranks the ambiguous tier suggestLinkTarget declines', () => {
  const twins = [c('people/tom-devlin'), c('meetings/tom-devlin')];
  assert.equal(suggestLinkTarget('tom-devlin-x', twins), null);
  assert.deepEqual(
    suggestLinkCandidates('tom-devlin-x', twins).map((x) => x.slug),
    ['people/tom-devlin', 'meetings/tom-devlin'],
  );
});

test('suggestLinkCandidates caps at max and returns empty for hopeless targets', () => {
  const cands = [c('people/anna-nord'), c('people/anna-lund'), c('people/anna-berg'), c('people/anna-falk')];
  assert.equal(suggestLinkCandidates('anna', cands, 3).length, 3);
  assert.deepEqual(suggestLinkCandidates('totally-unrelated', cands), []);
});

test('findUnlinkedMentions finds plain-text mentions, skips linked lines and short titles', () => {
  const body = [
    'Talked to Anna Lindqvist about rollout.',
    'The [[people/anna-lindqvist|Anna Lindqvist]] thread continues.',
    'anna lindqvist pinged again.',
    'Nothing here.',
  ].join('\n');
  assert.deepEqual(findUnlinkedMentions(body, 'Anna Lindqvist'), [
    'Talked to Anna Lindqvist about rollout.',
    'anna lindqvist pinged again.',
  ]);
  assert.deepEqual(findUnlinkedMentions('Tom was there.', 'Tom'), []);
});

test('findUnlinkedMentions requires word boundaries', () => {
  assert.deepEqual(findUnlinkedMentions('The nordkapel choir sang.', 'nordkap'), []);
  assert.deepEqual(findUnlinkedMentions('Ask nordkap, then decide.', 'nordkap'), ['Ask nordkap, then decide.']);
});

test('buildMentionLinkPatch wraps the mention, preserving original casing via alias', () => {
  const body = 'Talked to anna lindqvist about rollout.';
  assert.deepEqual(buildMentionLinkPatch(body, 'Anna Lindqvist', 'people/anna-lindqvist'), [
    {
      search: 'Talked to anna lindqvist about rollout.',
      replace: 'Talked to [[people/anna-lindqvist|anna lindqvist]] about rollout.',
    },
  ]);
});

test('buildMentionLinkPatch skips the alias when the mention equals the slug basename', () => {
  assert.deepEqual(buildMentionLinkPatch('See pricing-v3 for details.', 'pricing-v3', 'ideas/pricing-v3'), [
    { search: 'See pricing-v3 for details.', replace: 'See [[ideas/pricing-v3]] for details.' },
  ]);
});

test('buildLinkRepairPatch repoints occurrences, preserving alias and anchor', () => {
  const body = 'See [[nordkap]] and [[nordkap|the Nordkap deal]], details in [[nordkap#SSO]].\nAlso [[other-note]].';
  const patch = buildLinkRepairPatch(body, 'nordkap', 'customers/nordkap-shipping');
  assert.deepEqual(patch, [
    { search: '[[nordkap]]', replace: '[[customers/nordkap-shipping]]' },
    { search: '[[nordkap|the Nordkap deal]]', replace: '[[customers/nordkap-shipping|the Nordkap deal]]' },
    { search: '[[nordkap#SSO]]', replace: '[[customers/nordkap-shipping#SSO]]' },
  ]);
});

test('buildLinkRepairPatch duplicate occurrences apply sequentially', () => {
  const body = 'twice: [[nordkap]] and [[nordkap]]';
  const patch = buildLinkRepairPatch(body, 'nordkap', 'customers/nordkap-shipping');
  assert.equal(patch.length, 2);
  // Simulate the accept path's sequential indexOf application.
  let result = body;
  for (const b of patch) {
    const i = result.indexOf(b.search);
    assert.ok(i !== -1);
    result = result.slice(0, i) + b.replace + result.slice(i + b.search.length);
  }
  assert.equal(result, 'twice: [[customers/nordkap-shipping]] and [[customers/nordkap-shipping]]');
});

test('buildLinkRepairPatch returns empty for frontmatter-only links', () => {
  assert.deepEqual(buildLinkRepairPatch('No links to it here.', 'nordkap', 'customers/nordkap-shipping'), []);
});

test('buildLinkRepairPatch re-emits the link type in the author direction', () => {
  const body = 'Held by [[blocked-by::nordkap]], we track [[evidence::nordkap#SSO|the deal]].';
  const patch = buildLinkRepairPatch(body, 'nordkap', 'customers/nordkap-shipping');
  assert.deepEqual(patch, [
    { search: '[[blocked-by::nordkap]]', replace: '[[blocked-by::customers/nordkap-shipping]]' },
    {
      search: '[[evidence::nordkap#SSO|the deal]]',
      replace: '[[evidence::customers/nordkap-shipping#SSO|the deal]]',
    },
  ]);
});
