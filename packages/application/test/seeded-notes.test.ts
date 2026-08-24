import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNote } from '@qale/markdown';
import { parseFrontmatter, runnableNameFromPath, slugFromPath, typeForDir } from '@qale/domain';
import { DEFAULT_NOTES } from '@qale/sessions';

/**
 * SK-5: the product understanding is memory now, not a skill. Nothing injects
 * it, so the only way a session ever sees it again is the ordinary note path:
 * the file has to parse as a note of its folder's type, carry the summary the
 * folder map and the search index read, and answer to a slug a wikilink can
 * point at. A file that seeds but does not index is invisible, and invisible
 * fails silently.
 */

test('every seeded note parses as the note type its folder means', () => {
  assert.ok(DEFAULT_NOTES.length > 0, 'the pack seeds no notes at all');
  for (const { file, content } of DEFAULT_NOTES) {
    const dir = file.split('/')[0] ?? '';
    const type = typeForDir(dir);
    assert.ok(type, `${file} sits in ${dir}, which is no note folder`);

    const parsed = parseNote(content);
    const result = parseFrontmatter(parsed.frontmatter);
    assert.ok(
      result.ok,
      `${file} has frontmatter the indexer rejects: ${!result.ok && result.error}`,
    );
    assert.equal(result.ok && result.data.type, type, `${file} does not match its folder`);
    // The summary IS the retrieval index: the folder map prints it, and search
    // ranks on it. A note without one indexes as a title and a body nobody found.
    assert.ok(
      result.ok && typeof result.data.summary === 'string' && result.data.summary.length > 0,
    );
    assert.ok(parsed.body.trim().length > 0, `${file} has no body`);
  }
});

test('a seeded note is a note, never a runnable', () => {
  for (const { file } of DEFAULT_NOTES) {
    // The skill resolver reads `skills/` and `agents/`. A note in `notes/` has
    // no name it answers to there, which is what took the product understanding
    // off the Skills page for good.
    assert.equal(runnableNameFromPath(file), null, `${file} still resolves as a runnable`);
    assert.ok(!file.startsWith('skills/'), `${file} is still filed as a skill`);
  }
});

test('the orientation note answers to the slug a wikilink would use', () => {
  const seed = DEFAULT_NOTES.find((n) => n.file === 'notes/understanding.md');
  assert.ok(seed);
  assert.equal(slugFromPath(seed.file), 'notes/understanding');
});
