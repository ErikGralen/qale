import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeUnicodeEscapes, decodeArgs, withDecodedArgs } from '../src/tool-args.js';

/**
 * A model that spells Swedish out as backslash-u escapes files unreadable notes
 * (see `tool-args.ts`). These cover the repair and, just as important, the text
 * it must not touch.
 */

test('decodes escaped letters back to the characters they spell', () => {
  assert.equal(decodeUnicodeEscapes('Aff\\u00e4rsmodell och pris'), 'Affärsmodell och pris');
  assert.equal(decodeUnicodeEscapes('m\\u00f6ten'), 'möten');
});

test('decodes escapes that sit next to each other', () => {
  assert.equal(decodeUnicodeEscapes('\\u00e5\\u00e4\\u00f6'), 'åäö');
});

test('leaves text without escapes untouched', () => {
  const s = 'Affärsmodell och pris — inget att laga här';
  assert.equal(decodeUnicodeEscapes(s), s);
});

test('leaves a deliberately doubled backslash alone', () => {
  assert.equal(decodeUnicodeEscapes('skriv \\\\u00e4 för ä'), 'skriv \\\\u00e4 för ä');
});

test('leaves control-character escapes as written', () => {
  assert.equal(decodeUnicodeEscapes('rad\\u000arad'), 'rad\\u000arad');
});

test('repairs strings at any depth, arrays included', () => {
  const args = {
    path: 'people/daniel.md',
    frontmatter: { summary: 'Medgrundare', tags: ['gtm'] },
    body: 'Vad han \\u00e4ger. Aff\\u00e4rsmodell och pris.',
    patch: [{ search: 'm\\u00f6te', replace: 'm\\u00f6tet' }],
    inference: false,
    count: 3,
  };
  assert.deepEqual(decodeArgs(args), {
    path: 'people/daniel.md',
    frontmatter: { summary: 'Medgrundare', tags: ['gtm'] },
    body: 'Vad han äger. Affärsmodell och pris.',
    patch: [{ search: 'möte', replace: 'mötet' }],
    inference: false,
    count: 3,
  });
});

test('a wrapped tool never sees the escaped arguments', async () => {
  let seen: unknown = null;
  const tool = {
    name: 'propose_note',
    execute: (_id: string, params: unknown) => {
      seen = params;
      return { content: [{ type: 'text', text: 'ok' }] };
    },
  };
  const [wrapped] = withDecodedArgs([tool as never]);
  await (wrapped!.execute as (id: string, p: unknown) => unknown)('call-1', {
    body: 'Bor i Uppsala. K\\u00f6r agendan punkt f\\u00f6r punkt.',
  });
  assert.deepEqual(seen, { body: 'Bor i Uppsala. Kör agendan punkt för punkt.' });
});
