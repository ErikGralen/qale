import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all';
import { LLM_PROVIDERS, LLM_PROVIDER_INFO } from '@qale/domain';
import { providerFault } from '../src/api-errors.js';

/**
 * The shortlist has to be routable.
 *
 * `LLM_PROVIDER_INFO` is a table we wrote by hand, and pi's catalogue is a
 * generated file that moves with every pi upgrade. When they disagree, the
 * picker offers a model that cannot answer, and the first anybody hears of it
 * is a session that will not start. So the two are checked against each other
 * here rather than at 9am on a Monday.
 *
 * If this fails after a pi bump: the id was retired. Replace it in
 * `packages/domain/src/models/index.ts` with whatever pi carries now.
 */
test('every model we offer is one pi can actually route', () => {
  for (const provider of LLM_PROVIDERS) {
    const carried = new Set(getBuiltinModels(provider).map((m) => m.id));
    for (const model of LLM_PROVIDER_INFO[provider].models) {
      assert.ok(carried.has(model.id), `pi no longer carries ${model.id}`);
    }
  }
});

/**
 * The refusal reads its own provider off the message (see ./api-errors.ts), so
 * the two vocabularies have to stay told apart. Sending somebody with a Gemini
 * key to console.anthropic.com to top up an account they do not have is worse
 * than saying nothing.
 */
test('a Google refusal names Google, and an Anthropic one names Anthropic', () => {
  const badKey = providerFault(
    '400 {"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}',
  );
  assert.match(badKey.text, /^Google/);
  assert.equal(badKey.blocking, true);

  const quota = providerFault(
    '429 {"error":{"code":429,"message":"Resource has been exhausted (e.g. check quota).","status":"RESOURCE_EXHAUSTED"}}',
  );
  assert.match(quota.text, /^Google/);
  // The fix is to wait, so nobody gets interrupted over it.
  assert.equal(quota.blocking, false);

  // Google's overload sentence contains Anthropic's word for it. The one that
  // says more has to be asked first, or every Gemini outage blames Anthropic.
  const busy = providerFault(
    '503 {"error":{"code":503,"message":"The model is overloaded. Please try again later.","status":"UNAVAILABLE"}}',
  );
  assert.match(busy.text, /^Google/);
  assert.equal(busy.blocking, false);
  assert.match(providerFault('529 {"error":{"message":"Overloaded"}}').text, /^Anthropic/);

  const billing = providerFault(
    '403 {"error":{"code":403,"message":"This API method requires billing to be enabled. Please enable billing on project #123.","status":"PERMISSION_DENIED"}}',
  );
  assert.match(billing.text, /^Google/);
  assert.equal(billing.blocking, true);
});
