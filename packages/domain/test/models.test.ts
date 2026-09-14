import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PROVIDER,
  LLM_PROVIDERS,
  LLM_PROVIDER_INFO,
  defaultModelId,
  llmProvider,
  modelForProvider,
  providerModels,
  providerName,
  providerOfModel,
} from '../src/models/index.js';

/**
 * The provider choice, and the rule that keeps a model belonging to it.
 *
 * The failure this guards against is quiet and expensive: a workspace switched
 * to Gemini while `claude-opus-5` stays in the settings file. Nothing complains
 * until the first session, which then cannot start at all.
 */

test('the shortlist stays short, and every provider offers the model it defaults to', () => {
  for (const id of LLM_PROVIDERS) {
    const info = LLM_PROVIDER_INFO[id];
    assert.ok(info.models.length >= 2, `${id} needs something to choose between`);
    // The point of the list is that it is not a catalogue.
    assert.ok(info.models.length <= 4, `${id} is drifting back into a catalogue`);
    // The default is named, not positional, and it has to be a row you can see:
    // a default missing from the picker is a model nobody can get back to.
    assert.ok(
      info.models.some((m) => m.id === defaultModelId(id)),
      `${id} defaults to a model it does not offer`,
    );
    // Every row says when to reach for it. A name and an id told nobody that.
    for (const model of info.models) assert.ok(model.note.trim().length > 0);
  }
});

test('new sessions open on the fast model, not the strongest one', () => {
  // Named here because it is a cost decision, not a detail of the list: a run
  // the PM never got to pick a model for (a page button, a scheduled tick)
  // opens on this one.
  assert.equal(defaultModelId('anthropic'), 'claude-sonnet-5');
  assert.equal(defaultModelId('google'), 'gemini-3.6-flash');
});

test('ids are unique across providers, so one id can only mean one thing', () => {
  const seen = new Set<string>();
  for (const id of LLM_PROVIDERS) {
    for (const model of providerModels(id)) {
      assert.ok(!seen.has(model.id), `${model.id} is listed twice`);
      seen.add(model.id);
      assert.equal(providerOfModel(model.id), id);
    }
  }
});

test('anything unrecognised settles to the default provider rather than throwing', () => {
  assert.equal(llmProvider(undefined), DEFAULT_PROVIDER);
  assert.equal(llmProvider(null), DEFAULT_PROVIDER);
  assert.equal(llmProvider('openai'), DEFAULT_PROVIDER);
  assert.equal(llmProvider('google'), 'google');
  assert.equal(providerName('google'), 'Google');
  assert.equal(providerName('nonsense'), 'Anthropic');
  assert.equal(providerOfModel('gpt-9'), null);
  assert.equal(providerOfModel(null), null);
});

test('switching provider carries the model with it', () => {
  // Their own model stays.
  assert.equal(modelForProvider('anthropic', 'claude-sonnet-5'), 'claude-sonnet-5');
  // The other one's does not, and neither does one we have dropped.
  assert.equal(modelForProvider('google', 'claude-sonnet-5'), defaultModelId('google'));
  assert.equal(modelForProvider('anthropic', 'gemini-3.6-flash'), defaultModelId('anthropic'));
  assert.equal(modelForProvider('anthropic', 'claude-opus-4-8'), defaultModelId('anthropic'));
  assert.equal(modelForProvider('google', null), defaultModelId('google'));
});
