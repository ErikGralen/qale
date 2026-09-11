import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NoteRefDTO, VaultTreeDTO } from '@qale/ipc';
import {
  tokenizeWikilink,
  wikilinkAttrs,
  renderWikilink,
  retypeWikilink,
  wikilinkLabel,
} from '../src/renderer/src/components/editor/wikilink.js';
import { setNoteTitles } from '../src/renderer/src/lib/note-titles.js';
import { targetNoteType } from '../src/renderer/src/components/editor/link-type.js';
import { splitTypePrefix } from '../src/renderer/src/components/editor/wikilink-suggest.js';

/** tokenize → attrs → render must reproduce the source exactly. */
function roundTrip(src: string): string {
  const token = tokenizeWikilink(src);
  assert.ok(token, `expected a wikilink token at start of: ${src}`);
  return renderWikilink(wikilinkAttrs(token.raw, token.text));
}

test('wikilink round-trip is byte-exact', () => {
  for (const src of [
    '[[decisions/2026-07-01-drop-sso]]',
    '[[nordkap|Nordkap AB]]',
    '[[releases/tavla-1.2#Scope|the 1.2 scope]]',
    '[[weird  spacing | alias with spaces ]]',
    '[[blocks::PAY-142]]',
    '[[blocked-by::PAY-155|the security review]]',
    '[[waiting on::people/asa-lindqvist]]',
  ]) {
    assert.equal(roundTrip(src), src);
  }
});

test('tokenize matches only at the start and stops at the first ]]', () => {
  assert.equal(tokenizeWikilink('text [[a]]'), undefined);
  assert.equal(tokenizeWikilink('[[a]] and [[b]]')?.raw, '[[a]]');
  assert.equal(tokenizeWikilink('[[unclosed'), undefined);
  assert.equal(tokenizeWikilink('[not-a-wikilink](x.md)'), undefined);
  assert.equal(tokenizeWikilink('[[]]'), undefined);
});

test('attrs normalize like the indexer (alias, anchor, .md stripping)', () => {
  assert.deepEqual(wikilinkAttrs('[[a/b.md#H|Alias]]', 'a/b.md#H|Alias'), {
    raw: '[[a/b.md#H|Alias]]',
    target: 'a/b',
    anchor: 'H',
    alias: 'Alias',
    linkType: null,
    reversed: false,
  });
  assert.deepEqual(wikilinkAttrs('[[a/b]]', 'a/b'), {
    raw: '[[a/b]]',
    target: 'a/b',
    anchor: null,
    alias: null,
    linkType: null,
    reversed: false,
  });
});

test('typed links canonicalize inverse spellings, keep the raw source', () => {
  assert.deepEqual(wikilinkAttrs('[[blocked-by::PAY-155]]', 'blocked-by::PAY-155'), {
    raw: '[[blocked-by::PAY-155]]',
    target: 'PAY-155',
    anchor: null,
    alias: null,
    linkType: 'blocks',
    reversed: true,
  });
  // Free-text types kebab; a malformed prefix degrades to an untyped link.
  assert.equal(wikilinkAttrs('', 'waiting on::people/asa').linkType, 'waiting-on');
  assert.equal(wikilinkAttrs('', '::PAY-1').linkType, null);
  assert.equal(wikilinkAttrs('', '::PAY-1').target, '::PAY-1');
});

test('renderWikilink reconstructs from parts when raw is missing', () => {
  assert.equal(
    renderWikilink({
      raw: '',
      target: 'a/b',
      anchor: 'H',
      alias: 'X',
      linkType: null,
      reversed: false,
    }),
    '[[a/b#H|X]]',
  );
  assert.equal(
    renderWikilink({
      raw: '',
      target: 'a/b',
      anchor: null,
      alias: null,
      linkType: null,
      reversed: false,
    }),
    '[[a/b]]',
  );
  // The type re-emits in the author's direction — never silently stripped.
  assert.equal(
    renderWikilink({
      raw: '',
      target: 'PAY-1',
      anchor: null,
      alias: null,
      linkType: 'blocks',
      reversed: true,
    }),
    '[[blocked-by::PAY-1]]',
  );
});

test('retypeWikilink sets, changes and clears a relationship in place', () => {
  const attrs = wikilinkAttrs('[[tickets/PAY-142|PAY-142]]', 'tickets/PAY-142|PAY-142');

  const blocked = retypeWikilink(attrs, { type: 'blocks', reversed: true });
  assert.equal(renderWikilink(blocked), '[[blocked-by::tickets/PAY-142|PAY-142]]');
  assert.equal(blocked.linkType, 'blocks');
  assert.equal(blocked.reversed, true);

  // Retyping the other way round drops the inverse spelling with it.
  const blocks = retypeWikilink(blocked, { type: 'blocks', reversed: false });
  assert.equal(renderWikilink(blocks), '[[blocks::tickets/PAY-142|PAY-142]]');
  assert.equal(blocks.reversed, false);

  // Clearing returns the plain link — target, anchor and alias all survive.
  assert.equal(renderWikilink(retypeWikilink(blocks, null)), '[[tickets/PAY-142|PAY-142]]');
  const anchored = wikilinkAttrs(
    '[[sources/call#pricing|the call]]',
    'sources/call#pricing|the call',
  );
  assert.equal(
    renderWikilink(retypeWikilink(anchored, { type: 'evidence', reversed: false })),
    '[[evidence::sources/call#pricing|the call]]',
  );
});

test('targetNoteType reads the kind of thing a link points at', () => {
  assert.equal(targetNoteType('people/asa-lindqvist'), 'person');
  assert.equal(targetNoteType('decisions/2026-07-01-drop-sso'), 'decision');
  // A bare ticket key normalizes to its mirror folder first.
  assert.equal(targetNoteType('PAY-142'), 'ticket');
  assert.equal(targetNoteType('tickets/PAY-142#scope'), 'ticket');
  // No folder = a note that doesn't exist yet: unknown, so offer everything.
  assert.equal(targetNoteType('nordkap'), null);
});

/** A workspace tree holding just the notes a test needs. */
function tree(notes: [slug: string, title: string][]): VaultTreeDTO {
  return {
    groups: [
      {
        dir: 'notes',
        type: 'note',
        layer: 'work',
        notes: notes.map(
          ([slug, title]): NoteRefDTO => ({
            path: `${slug}.md`,
            slug,
            type: 'note',
            title,
            summary: '',
            mtime: 0,
          }),
        ),
      },
    ],
  };
}

test('a wikilink chip prints the note title, never the storage path', () => {
  setNoteTitles(
    tree([
      ['meetings/2026-09-10-brasserie-lund-quarterly-review', 'Brasserie Lund quarterly review'],
      ['people/asa-lindgren', 'Åsa Lindgren'],
    ]),
  );
  const label = (src: string): string => {
    const token = tokenizeWikilink(src);
    assert.ok(token, `expected a wikilink token at start of: ${src}`);
    return wikilinkLabel(wikilinkAttrs(token.raw, token.text));
  };

  assert.equal(
    label('[[meetings/2026-09-10-brasserie-lund-quarterly-review]]'),
    'Brasserie Lund quarterly review',
  );
  assert.equal(label('[[people/asa-lindgren]]'), 'Åsa Lindgren');
  // An alias is what the author wrote to be read, so it wins over the title.
  assert.equal(label('[[people/asa-lindgren|Åsa]]'), 'Åsa');
  // A page the workspace does not hold falls back to its own last segment,
  // de-slugged and without the date prefix a calendar mirror carries.
  assert.equal(label('[[meetings/2026-09-11-nordic-steak-weekly]]'), 'Nordic Steak Weekly');
  // A ticket keeps its written form: the chip swaps in the key and the state
  // pill when the local mirror answers.
  assert.equal(label('[[tickets/jira/BOK-300]]'), 'tickets/jira/BOK-300');
  assert.equal(label('[[BOK-300]]'), 'BOK-300');
  setNoteTitles(null);
});

test('the chip title follows the tree, and the source it serializes does not', () => {
  const attrs = wikilinkAttrs(
    '[[todos/bok-300-stories-before-sprint-planning]]',
    'todos/bok-300-stories-before-sprint-planning',
  );
  // Before the tree loads the chip still reads as words, not as a path.
  setNoteTitles(null);
  assert.equal(wikilinkLabel(attrs), 'Bok 300 Stories Before Sprint Planning');
  setNoteTitles(
    tree([['todos/bok-300-stories-before-sprint-planning', 'Write the BOK-300 stories']]),
  );
  assert.equal(wikilinkLabel(attrs), 'Write the BOK-300 stories');
  // What the file holds is untouched: a save writes the link back as typed.
  assert.equal(renderWikilink(attrs), '[[todos/bok-300-stories-before-sprint-planning]]');
  setNoteTitles(null);
});

test('splitTypePrefix holds a usable type out of the picker query', () => {
  assert.deepEqual(splitTypePrefix('blocks::pay'), { typePrefix: 'blocks::', search: 'pay' });
  assert.deepEqual(splitTypePrefix('waiting on::asa'), {
    typePrefix: 'waiting on::',
    search: 'asa',
  });
  // Not a usable type token — the whole thing stays search text.
  assert.deepEqual(splitTypePrefix('::pay'), { typePrefix: '', search: '::pay' });
  assert.deepEqual(splitTypePrefix('pay'), { typePrefix: '', search: 'pay' });
});
