import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BROKEN_FRONTMATTER_FIELD,
  isNormalizable,
  NEEDS_SUMMARY_FIELD,
  normalizeFrontmatter,
  checkFrontmatterMutation,
  type Frontmatter,
} from '../src/index.js';

/**
 * The deterministic frontmatter pass (OW4): what it may fill in, what it refuses
 * to invent, that it is a no-op the second time, and that it never touches a
 * file another part of the app owns.
 */

const body = '# Nordkap check-in\n\nThey want SCIM before the rollout.\n';

test('fills what the file and its path already say', () => {
  const out = normalizeFrontmatter({
    path: 'sources/2026-07-30-nordkap-transcript.md',
    frontmatter: {},
    body,
  });
  assert.equal(out.frontmatter['type'], 'source', 'type comes from the folder');
  assert.equal(out.frontmatter['captured'], '2026-07-30', 'the date is in the filename');
  assert.equal(
    out.frontmatter['title'],
    'Nordkap check-in',
    'the opening heading says more than the slug',
  );
  assert.equal(out.frontmatter['summary'], 'Nordkap check-in');
  assert.equal(
    out.frontmatter[NEEDS_SUMMARY_FIELD],
    true,
    'a derived summary is a placeholder, and says so',
  );
});

test('an explicit type wins over the folder, and a file we cannot place is left alone', () => {
  const typed = normalizeFrontmatter({
    path: 'notes/x.md',
    frontmatter: { type: 'insight' },
    body: 'a\n',
  });
  assert.equal(typed.frontmatter['type'], 'insight');
  assert.ok(!typed.filled.includes('type'));

  const stray = normalizeFrontmatter({ path: 'README.md', frontmatter: {}, body: 'a\n' });
  assert.deepEqual(stray.filled, [], 'a markdown file outside every folder is not ours to stamp');
});

test('a note that already passes is not rewritten', () => {
  const out = normalizeFrontmatter({
    path: 'insights/nordkap-check-in.md',
    frontmatter: {
      type: 'insight',
      summary: 'Acme wants SCIM before rollout.',
      evidence: ['[[sources/a]]'],
    },
    body,
  });
  assert.deepEqual(out.filled, []);
});

test('idempotent: a second pass over its own output changes nothing', () => {
  const first = normalizeFrontmatter({
    path: 'sources/2026-07-30-nordkap.md',
    frontmatter: {},
    body,
  });
  assert.ok(first.filled.length > 0);
  const second = normalizeFrontmatter({
    path: 'sources/2026-07-30-nordkap.md',
    frontmatter: first.frontmatter,
    body,
  });
  assert.deepEqual(second.filled, [], 'nothing left to fill');
  assert.deepEqual(second.frontmatter, first.frontmatter);
});

test('the marker retires itself once a real summary lands, however it lands', () => {
  const marked = normalizeFrontmatter({ path: 'notes/scim.md', frontmatter: {}, body });
  assert.equal(marked.frontmatter[NEEDS_SUMMARY_FIELD], true);

  // A session that wrote the summary and forgot the flag still ends up clean.
  const fixed = normalizeFrontmatter({
    path: 'notes/scim.md',
    frontmatter: { ...marked.frontmatter, summary: 'Nordkap will not roll out without SCIM.' },
    body,
  });
  assert.deepEqual(fixed.filled, [NEEDS_SUMMARY_FIELD]);
  assert.ok(!(NEEDS_SUMMARY_FIELD in fixed.frontmatter), 'the flag is gone');

  // A card cannot delete a key, so clearing it to false works too.
  const cleared = normalizeFrontmatter({
    path: 'notes/scim.md',
    frontmatter: { ...marked.frontmatter, [NEEDS_SUMMARY_FIELD]: false },
    body,
  });
  assert.ok(!(NEEDS_SUMMARY_FIELD in cleared.frontmatter));
});

test('a type whose summary is frozen gets the fill and no marker it could never clear', () => {
  const out = normalizeFrontmatter({
    path: 'decisions/adopt-workos.md',
    frontmatter: { type: 'decision' },
    body: 'We are adopting WorkOS.\n',
  });
  assert.equal(out.frontmatter['summary'], 'We are adopting WorkOS.');
  assert.ok(!(NEEDS_SUMMARY_FIELD in out.frontmatter), 'a decision card cannot revise a summary');
});

test('broken YAML is preserved verbatim and marked, never guessed at', () => {
  const block = 'type: source\n  summary: "unclosed\ntags: [a, b';
  const out = normalizeFrontmatter({
    path: 'sources/2026-07-30-mess.md',
    frontmatter: null,
    rawFrontmatter: block,
    body,
  });
  assert.equal(out.frontmatter[BROKEN_FRONTMATTER_FIELD], block, 'the original text is kept whole');
  assert.equal(out.frontmatter['type'], 'source', 'the folder still names the type');
  assert.equal(out.frontmatter[NEEDS_SUMMARY_FIELD], true);

  // Second pass: the file parses now, and the preserved block stays put.
  const again = normalizeFrontmatter({
    path: 'sources/2026-07-30-mess.md',
    frontmatter: out.frontmatter,
    body,
  });
  assert.deepEqual(again.filled, []);
  assert.equal(again.frontmatter[BROKEN_FRONTMATTER_FIELD], block);

  // Blanked by a session, swept away by the next pass.
  const repaired = normalizeFrontmatter({
    path: 'sources/2026-07-30-mess.md',
    frontmatter: { ...out.frontmatter, [BROKEN_FRONTMATTER_FIELD]: '' },
    body,
  });
  assert.ok(!(BROKEN_FRONTMATTER_FIELD in repaired.frontmatter));
});

test('an empty frontmatter block is not a broken one', () => {
  const out = normalizeFrontmatter({
    path: 'notes/blank.md',
    frontmatter: {},
    rawFrontmatter: '',
    body: 'Something.\n',
  });
  assert.ok(!(BROKEN_FRONTMATTER_FIELD in out.frontmatter));
});

test('never touches generated, reserved, runnable or session files', () => {
  for (const path of [
    'index.md',
    'insights/index.md',
    'decisions/log.md',
    'skills/librarian/SKILL.md',
    'skills/librarian/checklist.md',
    'agents/meeting-prep/AGENT.md',
    'sessions/.files/a1b2c3/brief.md',
  ]) {
    assert.equal(isNormalizable(path), false, path);
    assert.deepEqual(
      normalizeFrontmatter({ path, frontmatter: {}, body: '# Hi\n' }).filled,
      [],
      path,
    );
  }
  // A session receipt is indexed like any note; it is skipped by its type.
  assert.deepEqual(
    normalizeFrontmatter({ path: 'sessions/2026-07-20-librarian.md', frontmatter: {}, body: 'x\n' })
      .filled,
    [],
  );
  // A flat legacy skill file resolves to the skill type and is skipped too.
  assert.deepEqual(
    normalizeFrontmatter({ path: 'skills/ask.md', frontmatter: {}, body: 'x\n' }).filled,
    [],
  );
});

test('a title that only repeats the filename is not written', () => {
  const out = normalizeFrontmatter({
    path: 'notes/nordkap-check-in.md',
    frontmatter: {},
    body: '# Nordkap Check in\n\nText.\n',
  });
  assert.ok(!out.filled.includes('title'), 'the slug already says this');
});

test('the source captured date falls back to the file, and a meeting date never guesses', () => {
  const source = normalizeFrontmatter({
    path: 'sources/nordkap.md',
    frontmatter: { type: 'source', summary: 'A call.' },
    body,
    fileDate: '2026-08-01',
  });
  assert.equal(source.frontmatter['captured'], '2026-08-01');

  const meeting = normalizeFrontmatter({
    path: 'meetings/nordkap.md',
    frontmatter: { type: 'meeting', summary: 'A meeting.' },
    body,
    fileDate: '2026-08-01',
  });
  assert.ok(
    !('date' in meeting.frontmatter),
    'when a meeting happened is not a fact about its file',
  );
});

test('a session may clear the markers on a type that freezes everything else', () => {
  const prev = {
    type: 'source',
    summary: 'Transcript.',
    [NEEDS_SUMMARY_FIELD]: true,
  } as unknown as Frontmatter;
  const next = {
    type: 'source',
    summary: 'Nordkap on SCIM.',
    [NEEDS_SUMMARY_FIELD]: false,
  } as unknown as Frontmatter;
  assert.equal(checkFrontmatterMutation('source', prev, next).allowed, true);
});
