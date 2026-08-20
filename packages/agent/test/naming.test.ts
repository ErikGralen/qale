import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cheapestModel, cleanTitle, namingSystemPrompt, namingUserPrompt } from '../src/naming.js';

const OPUS = { id: 'claude-opus-5', cost: { input: 5, output: 25 } };
const SONNET = { id: 'claude-sonnet-5', cost: { input: 2, output: 10 } };
const HAIKU = { id: 'claude-haiku-4-5', cost: { input: 1, output: 5 } };

test('the naming model is the cheapest one the workspace can actually reach', () => {
  assert.equal(cheapestModel([OPUS, SONNET, HAIKU])?.id, HAIKU.id);
  // Nothing hardcodes a model id: with haiku gone the next cheapest wins, which
  // is what keeps this working across a catalogue that keeps moving.
  assert.equal(cheapestModel([OPUS, SONNET])?.id, SONNET.id);
  assert.equal(cheapestModel([]), undefined);
});

test('an unpriced model is not treated as a free one', () => {
  const unpriced = { id: 'mystery-model' };
  assert.equal(cheapestModel([OPUS, unpriced])?.id, OPUS.id);
  // Nothing priced at all: the caller falls back to the session's own model.
  assert.equal(cheapestModel([unpriced]), undefined);
  // A genuinely free model still wins — zero is a price, absent is not.
  assert.equal(cheapestModel([HAIKU, { id: 'local', cost: { input: 0, output: 0 } }])?.id, 'local');
});

test('a name is one clean line, whatever the model wrapped it in', () => {
  assert.equal(cleanTitle('Nordkap SSO renewal'), 'Nordkap SSO renewal');
  assert.equal(cleanTitle('"Nordkap SSO renewal."'), 'Nordkap SSO renewal');
  assert.equal(cleanTitle('Title: Nordkap SSO renewal'), 'Nordkap SSO renewal');
  assert.equal(
    cleanTitle('  **Nordkap   SSO** renewal  \n\nHope that helps!'),
    'Nordkap SSO renewal',
  );
});

test('an answer that is not a name loses to the first message', () => {
  assert.equal(cleanTitle(''), null);
  assert.equal(cleanTitle('\n\n'), null);
  assert.equal(cleanTitle('.'), null);
  // A sentence is not a name: truncating one would keep the tab readable and
  // the Sessions row wrong.
  assert.equal(
    cleanTitle(
      'Sure! Here is a name for this conversation about the Nordkap SSO renewal and the dates involved',
    ),
    null,
  );
});

test('the workspace language reaches the namer, and English says nothing extra', () => {
  assert.match(namingSystemPrompt('sv'), /Write the name in Swedish/);
  assert.doesNotMatch(namingSystemPrompt('en'), /Write the name in/);
  assert.doesNotMatch(namingSystemPrompt(), /Write the name in/);
});

test('a typed message is the subject; a kickoff hands over the facts underneath it', () => {
  assert.equal(
    namingUserPrompt({ prompt: 'Which customers care about SCIM?' }),
    'First message:\nWhich customers care about SCIM?',
  );
  const kickoff = namingUserPrompt({
    skill: 'Meeting prep',
    targets: ['Nordkap SSO check-in', 'Kranelund renewal'],
  });
  assert.match(kickoff, /"Meeting prep" skill/);
  assert.match(kickoff, /Nordkap SSO check-in, Kranelund renewal/);
  // The machine prose that started it never reaches the model, so no
  // conversation gets named after a path.
  assert.doesNotMatch(kickoff, /First message/);
});
