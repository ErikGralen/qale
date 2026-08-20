import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LANGUAGE,
  detectLanguage,
  languageName,
  languageTag,
  sameLanguage,
  workspaceLanguage,
} from '../src/language/index.js';

test('a region is not a language: sv-SE, sv-FI and sv are one setting', () => {
  assert.equal(languageTag('sv-SE'), 'sv');
  assert.equal(languageTag('sv-FI'), 'sv');
  assert.equal(languageTag('sv_FI'), 'sv');
  assert.equal(languageTag('SV'), 'sv');
  // The whole point: moving country, or a laptop flipping region, must never
  // read as "the PM changed what they write in".
  assert.ok(sameLanguage('sv-SE', 'sv-FI'));
  assert.ok(sameLanguage('en-US', 'en-GB'));
  assert.ok(!sameLanguage('sv-SE', 'en-SE'));
  // Two different languages spoken in the same country are still two languages.
  assert.ok(!sameLanguage('fi-FI', 'sv-FI'));
});

test('nothing usable in the locale is not a match, and never the default by accident', () => {
  assert.equal(languageTag(''), '');
  assert.equal(languageTag(null), '');
  assert.equal(languageTag(undefined), '');
  assert.equal(languageTag('C'), '');
  assert.equal(languageTag('123-45'), '');
  // sameLanguage must not answer "yes, both are nothing".
  assert.ok(!sameLanguage('', ''));
  assert.ok(!sameLanguage(null, undefined));
});

test('a locale becomes a workspace language, and an unknown one falls to English', () => {
  assert.equal(workspaceLanguage('sv-SE'), 'sv');
  assert.equal(workspaceLanguage('zh-Hant-TW'), DEFAULT_LANGUAGE);
  assert.equal(workspaceLanguage(undefined), DEFAULT_LANGUAGE);
  assert.equal(languageName('sv-SE'), 'Swedish');
  assert.equal(languageName('en'), 'English');
  assert.equal(languageName('xx'), 'English');
});

test('the detector reads short Swedish and short English', () => {
  assert.equal(detectLanguage('Vi ska inte lova det här innan priset är satt.'), 'sv');
  assert.equal(detectLanguage('We should not promise this before the price is set.'), 'en');
  assert.equal(
    detectLanguage('Kranelund vill ha en offert och det är inte klart vad som ingår.'),
    'sv',
  );
  assert.equal(
    detectLanguage('The customer wants a quote and it is not clear what is included.'),
    'en',
  );
});

test('the detector says nothing rather than guessing', () => {
  assert.equal(detectLanguage(''), null);
  // A heading and a ticket id decide nothing.
  assert.equal(detectLanguage('# PAY-142\n\nKranelund AB'), null);
  // Frontmatter is machine vocabulary in every workspace, so it must not tilt a
  // Swedish note English on the strength of its keys.
  const swedish = `---\ntype: meeting\nsummary: Kort\nprocessing: new\n---\n\nVi kom överens om att inte höja priset.\n`;
  assert.equal(detectLanguage(swedish), 'sv');
});

test('an English note with Swedish quotes in it still reads as English', () => {
  const mixed = [
    'The team is split on the price. Åsa said "vi kan inte höja nu" and the rest of the room',
    'agreed with her, so the decision is that we hold it until the autumn.',
  ].join(' ');
  assert.equal(detectLanguage(mixed), 'en');
});
