import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { UseCaseContext } from '@qale/application';
import { languagePreamble } from '../src/prompts.js';
import { createVaultTools } from '../src/tools.js';

/**
 * OW5: the workspace language is a setting the prompt states, and the keys stay
 * stable whatever it is set to.
 */

const out = async (tool: unknown, params: unknown) =>
  (
    await (
      tool as {
        execute: (
          id: string,
          p: unknown,
          s?: AbortSignal,
        ) => Promise<{ content: { text: string }[] }>;
      }
    ).execute('call-1', params, undefined)
  ).content[0]!.text;

test('the prompt states the language rather than leaving it to be inferred', () => {
  const swedish = languagePreamble('sv');
  assert.match(swedish, /This workspace is written in Swedish/);
  assert.match(swedish, /Write prose, titles and summaries in Swedish/);

  // A region is not a language: the same sentence comes out for sv-SE and sv-FI.
  assert.equal(languagePreamble('sv-SE'), swedish);
  assert.equal(languagePreamble('sv-FI'), swedish);
  assert.equal(languagePreamble('en-US'), languagePreamble('en-GB'));

  // A tag with no name we can spell out is English, never a raw tag in the prose.
  assert.match(languagePreamble('xx'), /written in English/);
  assert.doesNotMatch(languagePreamble('xx'), /\bxx\b/);
});

test('the keys never localize, whatever the language is set to', () => {
  for (const language of ['en', 'sv', 'de']) {
    const p = languagePreamble(language);
    for (const key of [
      'note types',
      'tags',
      'typed-link relation names',
      'folder names',
      'file slugs',
    ]) {
      assert.match(p, new RegExp(key), `${key} must be named as an address in ${language}`);
    }
    assert.match(p, /stay in English/);
  }
});

test('editing an existing note follows the note, not the setting', () => {
  assert.match(languagePreamble('sv'), /match the language that note is already written in/);
  assert.match(languagePreamble('sv'), /The workspace language is for what you write new/);
});

/** A Swedish note and an English one, both the PM's own writing. */
function fakeCtx(): UseCaseContext {
  const files: Record<string, string> = {
    'decisions/hoj-inte-priset.md':
      '---\ntype: decision\n---\nVi bestämde att inte höja priset förrän i höst, för det är inte klart vad kunderna får.',
    'decisions/adopt-workos.md':
      '---\ntype: decision\n---\nWe adopted it because the team is not going to build this on its own.',
    'sources/gong-call.md':
      '---\ntype: source\n---\nDe sa att det är för dyrt och att vi inte lyssnar.',
    'decisions/index.md':
      '# Decisions\n\nThe decisions in this folder, and what each of them is about.',
  };
  const indexed: Record<string, { layer: string }> = {
    'decisions/hoj-inte-priset.md': { layer: 'authored' },
    'decisions/adopt-workos.md': { layer: 'authored' },
    'sources/gong-call.md': { layer: 'raw' },
    'decisions/index.md': { layer: 'authored' },
  };
  return {
    vault: { contain: (p: string) => p, readRaw: async (p: string) => files[p] ?? null },
    index: { get: (p: string) => indexed[p] ?? null },
  } as unknown as UseCaseContext;
}

test('a read says which language the note is in, but only when it differs', async () => {
  const [swedishWorkspace] = createVaultTools(fakeCtx(), undefined, 'sv');
  const [englishWorkspace] = createVaultTools(fakeCtx(), undefined, 'en');

  // English workspace, Swedish note: the note wins for edits, and it is said.
  const flagged = await out(englishWorkspace, { path: 'decisions/hoj-inte-priset.md' });
  assert.match(flagged, /Vi bestämde att inte höja priset/);
  assert.match(
    flagged,
    /\[Qale\] This note is written in Swedish\. If you edit it, keep it in Swedish\./,
  );

  // Same note, Swedish workspace: nothing to say, so nothing is said.
  const quiet = await out(swedishWorkspace, { path: 'decisions/hoj-inte-priset.md' });
  assert.doesNotMatch(quiet, /\[Qale\]/);

  // And the other way round.
  assert.match(
    await out(swedishWorkspace, { path: 'decisions/adopt-workos.md' }),
    /This note is written in English/,
  );
});

test('raw material gets an envelope, never a language line: nothing is edited into it', async () => {
  const [vaultRead] = createVaultTools(fakeCtx(), undefined, 'en');
  const got = await out(vaultRead, { path: 'sources/gong-call.md' });
  assert.match(got, /^<<<EXTERNAL_MATERIAL /);
  assert.doesNotMatch(got, /\[Qale\]/);
});

test('a generated index.md is machinery, so it is never told what language it is in', async () => {
  const [vaultRead] = createVaultTools(fakeCtx(), undefined, 'sv');
  assert.doesNotMatch(await out(vaultRead, { path: 'decisions/index.md' }), /\[Qale\]/);
});

test('with no workspace language set, a read is exactly the file', async () => {
  const [vaultRead] = createVaultTools(fakeCtx());
  const got = await out(vaultRead, { path: 'decisions/hoj-inte-priset.md' });
  assert.doesNotMatch(got, /\[Qale\]/);
});
