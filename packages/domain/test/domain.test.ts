import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFrontmatter,
  checkFrontmatterMutation,
  buildChain,
  checkSupersede,
  refToSlug,
  slugify,
  titleFromSlug,
  isSessionFile,
  validateEvidence,
  todoLane,
  isOverdueTodo,
  isExternalTodo,
  byDue,
  type DecisionNode,
  type Frontmatter,
} from '../src/index.js';

test('parseFrontmatter validates + applies defaults + preserves unknown keys', () => {
  const r = parseFrontmatter({ type: 'insight', summary: 'x', evidence: ['[[meetings/a]]'], custom_x: 42 });
  assert.equal(r.ok, true);
  const fm = r.data as Record<string, unknown>;
  assert.equal(fm['confidence'], 'med'); // default applied
  assert.equal(fm['custom_x'], 42); // unknown key preserved (OKF-tolerant)
});

test('insight requires evidence', () => {
  const r = parseFrontmatter({ type: 'insight', summary: 'x', evidence: [] });
  assert.equal(r.ok, false);
});

test('source: defaults to processing new, rejects free-text processing', () => {
  const r = parseFrontmatter({ type: 'source', summary: 'article dump' });
  assert.equal(r.ok, true);
  assert.equal((r.data as Record<string, unknown>)['processing'], 'new');

  const bad = parseFrontmatter({ type: 'source', summary: 'x', processing: 'kinda-fresh' });
  assert.equal(bad.ok, false); // the lifecycle is an enum, never free text
});

test('source: body immutable, only workflow fields may change', () => {
  const prev = { type: 'source', summary: 's', processing: 'new' } as Frontmatter;
  const okChange = { ...prev, processing: 'processed' } as Frontmatter;
  assert.equal(checkFrontmatterMutation('source', prev, okChange).allowed, true);
  const badChange = { ...prev, source: { system: 'web' } } as Frontmatter;
  assert.equal(checkFrontmatterMutation('source', prev, badChange).allowed, false);
});

test('meeting: carries linked transcript + series; both mutable post-creation', () => {
  const r = parseFrontmatter({
    type: 'meeting',
    summary: 'nordkap check-in',
    date: '2026-07-21',
    transcript: '[[sources/2026-07-21-nordkap-checkin-transcript]]',
    series: 'nordkap-checkin',
  });
  assert.equal(r.ok, true);

  // A transcript can be matched to a pre-created meeting after the fact.
  const prev = { type: 'meeting', summary: 'm', date: '2026-07-21' } as Frontmatter;
  const attach = { ...prev, transcript: '[[sources/t]]', series: 'x' } as Frontmatter;
  assert.equal(checkFrontmatterMutation('meeting', prev, attach).allowed, true);
  // Provenance stays immutable.
  const badChange = { ...prev, date: '2026-07-22' } as Frontmatter;
  assert.equal(checkFrontmatterMutation('meeting', prev, badChange).allowed, false);
});

test('source: origin marks an external meeting transcript (signal, not meeting)', () => {
  const r = parseFrontmatter({
    type: 'source',
    summary: 'Nordkap sales call',
    origin: 'Jonas Palm',
    customer: '[[customers/nordkap-payments]]',
  });
  assert.equal(r.ok, true);
  assert.equal((r.data as Record<string, unknown>)['origin'], 'Jonas Palm');

  // origin/customer are workflow fields — settable after filing.
  const prev = { type: 'source', summary: 's', processing: 'new' } as Frontmatter;
  const okChange = { ...prev, origin: 'Jonas Palm' } as Frontmatter;
  assert.equal(checkFrontmatterMutation('source', prev, okChange).allowed, true);
});

test('processing is enum-validated on meetings and notes too', () => {
  assert.equal(parseFrontmatter({ type: 'meeting', summary: 'm', processing: 'new' }).ok, true);
  assert.equal(parseFrontmatter({ type: 'meeting', summary: 'm', processing: 'whatever' }).ok, false);
  assert.equal(parseFrontmatter({ type: 'note', summary: 'n', processing: 'stale' }).ok, true);
});

test('checkFrontmatterMutation: decision body-frozen fields immutable, standing mutable', () => {
  const prev = { type: 'decision', summary: 's', standing: 'active', date: '2026-01-01', sources: ['[[m]]'] } as Frontmatter;
  const okChange = { ...prev, standing: 'superseded', superseded_by: '[[decisions/new]]' } as Frontmatter;
  assert.equal(checkFrontmatterMutation('decision', prev, okChange).allowed, true);
  const badChange = { ...prev, summary: 'edited!' } as Frontmatter;
  assert.equal(checkFrontmatterMutation('decision', prev, badChange).allowed, false);
});

test('decision supersedes-chain: build, cycle guard', () => {
  const nodes: Record<string, DecisionNode> = {
    'decisions/d1': { slug: 'decisions/d1', frontmatter: { type: 'decision', summary: 'd1', standing: 'superseded', superseded_by: '[[decisions/d2]]', sources: [] } as never },
    'decisions/d2': { slug: 'decisions/d2', frontmatter: { type: 'decision', summary: 'd2', standing: 'active', supersedes: '[[decisions/d1]]', sources: [] } as never },
  };
  const resolve = (slug: string): DecisionNode | null => nodes[slug] ?? null;

  const { chain, cycle } = buildChain('decisions/d2', resolve);
  assert.equal(cycle, false);
  assert.deepEqual(chain.map((n) => n.slug), ['decisions/d1', 'decisions/d2']);

  // superseding an already-superseded decision is refused
  assert.equal(checkSupersede('decisions/d3', 'decisions/d1', resolve).allowed, false);
  // superseding the live head is allowed
  assert.equal(checkSupersede('decisions/d3', 'decisions/d2', resolve).allowed, true);
  // self-supersede refused
  assert.equal(checkSupersede('decisions/d2', 'decisions/d2', resolve).allowed, false);
});

test('refToSlug normalizes wikilinks', () => {
  assert.equal(refToSlug('[[decisions/d1]]'), 'decisions/d1');
  assert.equal(refToSlug('decisions/d1.md'), 'decisions/d1');
  assert.equal(refToSlug('[[decisions/d1|Alias]]'), 'decisions/d1');
  assert.equal(refToSlug(undefined), null);
});

test('slugify transliterates diacritics instead of stripping them', () => {
  assert.equal(slugify('Möte med Åsa'), 'mote-med-asa');
  assert.equal(slugify('Bergman & Falk: Q3-läge'), 'bergman-falk-q3-lage');
  assert.equal(slugify('Straße café søren'), 'strasse-cafe-soren');
});

test('titleFromSlug speaks the note name back, not machine title case', () => {
  assert.equal(titleFromSlug('decisions/2026-04-15-defer-scim-to-q3'), 'Defer SCIM to Q3');
  assert.equal(titleFromSlug('adopt-workos'), 'Adopt Workos');
  // Small words lead and close in full case; only the middle stays quiet.
  assert.equal(titleFromSlug('the-case-for-sso'), 'The Case for SSO');
  assert.equal(titleFromSlug('what-we-ship-in'), 'What We Ship In');
  assert.equal(titleFromSlug('wikipages/enterprise-onboarding'), 'Enterprise Onboarding');
});

test('todo: defaults to open, commitment is enum, owner marks external', () => {
  const r = parseFrontmatter({ type: 'todo', summary: 'Email Åsa about rollout' });
  assert.equal(r.ok, true);
  const fm = r.data as Record<string, unknown>;
  assert.equal(fm['commitment'], 'open');
  assert.deepEqual(fm['sources'], []);
  assert.equal(parseFrontmatter({ type: 'todo', summary: 'x', commitment: 'maybe-later' }).ok, false);
  assert.equal(isExternalTodo({ owner: '[[people/jonas-bergman]]' }), true);
  assert.equal(isExternalTodo({ owner: '  ' }), false);
  assert.equal(isExternalTodo({}), false);
});

test('todoLane: buckets by commitment, owner and due date', () => {
  const today = '2026-07-17';
  assert.equal(todoLane({ due: '2026-07-10' }, today), 'overdue');
  assert.equal(todoLane({ due: '2026-07-17' }, today), 'today');
  assert.equal(todoLane({ due: '2026-08-01' }, today), 'upcoming');
  assert.equal(todoLane({}, today), 'someday');
  // external commitments always land in waiting, even overdue ones
  assert.equal(todoLane({ owner: 'Jonas', due: '2026-07-01' }, today), 'waiting');
  assert.equal(todoLane({ commitment: 'done', due: '2026-07-10' }, today), 'closed');
  assert.equal(todoLane({ commitment: 'dropped' }, today), 'closed');
  // overdue predicate still fires for external items (drives the librarian ping)
  assert.equal(isOverdueTodo({ owner: 'Jonas', due: '2026-07-01' }, today), true);
  assert.equal(isOverdueTodo({ commitment: 'done', due: '2026-07-01' }, today), false);
});

test('byDue: dated before undated, earlier first', () => {
  const sorted = [{ due: undefined }, { due: '2026-07-20' }, { due: '2026-07-18' }].sort(byDue);
  assert.deepEqual(sorted.map((t) => t.due), ['2026-07-18', '2026-07-20', undefined]);
});

// --- Sessions v2 invariant 2: citations pass THROUGH session files ---

test('evidence may not cite a session file — the card must cite the original source', () => {
  const resolves = () => true;
  const bad = validateEvidence(['[[sessions/.files/a1b2c3/per-item/nordkap]]'], false, resolves);
  assert.equal(bad.ok, false);
  assert.match(bad.reason ?? '', /session files/);
  // Even flagged as inference — this is the failure that otherwise stays silent
  // until someone follows a link months later and finds deleted scratch.
  assert.equal(validateEvidence(['sessions/.files/a1b2c3/brief.md'], true, resolves).ok, false);
  // The source the file was written FROM is exactly what should be cited.
  assert.equal(validateEvidence(['[[sources/2026-06-12-nordkap]]'], false, resolves).ok, true);
  // A real session receipt is still citable — only its `.files` body is not.
  assert.equal(validateEvidence(['[[sessions/2026-07-28-synthesis-a1b2c3]]'], false, resolves).ok, true);
});

test('isSessionFile matches the folder and its contents, nothing adjacent', () => {
  assert.equal(isSessionFile('sessions/.files'), true);
  assert.equal(isSessionFile('sessions/.files/a1/brief.md'), true);
  assert.equal(isSessionFile('sessions/2026-07-28-synthesis.md'), false);
  assert.equal(isSessionFile('sessions/.filesystem/x.md'), false);
});
