import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiErrorText, providerFault } from '../src/api-errors.js';
import { PiUiBridge, type Chunk } from '../src/bridge.js';
import { entriesToUiMessages } from '../src/history.js';

/**
 * The turn where the provider says no.
 *
 * What went wrong in the real app: an Anthropic account ran out of credit
 * mid-conversation. pi ended the assistant message with `stopReason: "error"`
 * and the provider's sentence in `errorMessage`, and resolved the prompt
 * normally. Nothing in the app read either field, so the session showed
 * "Reading the memory…", then nothing, and kept doing that for every message
 * typed into it afterwards. The only place the reason existed was the session
 * JSONL on disk. These cover the paths that now surface it (live, on reopen,
 * and out to the notification an unwatched run needs), plus the wording of the
 * sentence and which refusals are worth interrupting somebody over.
 */

const CREDIT =
  '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}';

function collect(): { chunks: Chunk[]; bridge: PiUiBridge } {
  const chunks: Chunk[] = [];
  return { chunks, bridge: new PiUiBridge((c) => chunks.push(c)) };
}

const ended = (message: unknown) => ({ type: 'message_end', message }) as never;

test('a refused turn reaches the chat as an error, in words that say what to do', () => {
  const { chunks, bridge } = collect();
  bridge.start();
  bridge.handle(ended({ role: 'assistant', stopReason: 'error', errorMessage: CREDIT }));
  bridge.finish();

  const errors = chunks.filter((c) => c.type === 'error');
  assert.equal(errors.length, 1);
  const text = String(errors[0]!.errorText);
  assert.match(text, /out of credit/);
  assert.match(text, /console\.anthropic\.com/);
  // The raw envelope never reaches the screen.
  assert.doesNotMatch(text, /400 \{/);
  // And the stream still terminates, or the composer would sit there spinning.
  assert.equal(chunks.at(-1)?.type, 'finish');
});

test('a stop is not a failure, and a good turn says nothing', () => {
  const { chunks, bridge } = collect();
  bridge.start();
  bridge.handle(
    ended({ role: 'assistant', stopReason: 'aborted', errorMessage: 'aborted by user' }),
  );
  bridge.handle(ended({ role: 'assistant', stopReason: 'stop' }));
  bridge.finish();
  assert.equal(chunks.filter((c) => c.type === 'error').length, 0);
});

test('reopening the session explains the silence rather than showing an empty turn', () => {
  const entries = [
    {
      type: 'message',
      message: { role: 'user', content: 'where is the product-overview.md ???', timestamp: 1 },
    },
    {
      type: 'message',
      message: {
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: CREDIT,
        timestamp: 2,
      },
    },
  ];
  const messages = entriesToUiMessages(entries as never);
  assert.equal(messages.length, 2);
  const reply = messages[1]!;
  assert.equal(reply.role, 'assistant');
  assert.match((reply.parts[0] as { text: string }).text, /could not reach the model/);
  assert.match((reply.parts[0] as { text: string }).text, /out of credit/);
});

test("an unrecognised refusal keeps the provider's own message and drops the envelope", () => {
  assert.equal(
    apiErrorText(
      '529 {"type":"error","error":{"type":"api_error","message":"Something went sideways."}}',
    ),
    'Something went sideways.',
  );
  assert.match(apiErrorText(''), /refused the request/);
});

test('only the refusals the PM has to go and fix are worth interrupting them for', () => {
  // Their move: nothing runs, scheduled or otherwise, until they act.
  assert.equal(providerFault(CREDIT).blocking, true);
  assert.equal(providerFault('401 {"error":{"message":"invalid x-api-key"}}').blocking, true);
  // Fixes itself. Interrupting over these is what teaches people to ignore the
  // notification that mattered.
  assert.equal(providerFault('429 {"error":{"message":"rate limit exceeded"}}').blocking, false);
  assert.equal(providerFault('529 {"error":{"message":"Overloaded"}}').blocking, false);
  assert.equal(providerFault('socket hang up').blocking, false);
});

test('the fault travels with the turn, so a run nobody watched can still report it', () => {
  const { bridge } = collect();
  bridge.start();
  assert.equal(bridge.fault, null);
  bridge.handle(ended({ role: 'assistant', stopReason: 'error', errorMessage: CREDIT }));
  assert.equal(bridge.fault?.blocking, true);
});
