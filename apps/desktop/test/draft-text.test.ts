import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  draftTextOf,
  draftTextShown,
  draftUseMessage,
  draftVoiceMessage,
  draftWordCount,
} from '../src/renderer/src/lib/draft-text.js';

/**
 * The draft panel's decisions (docs/draft-text.md): whether a tool call has
 * anything to show, what the Use button sends, and what the voice picker sends.
 *
 * The panel keeps no state the model can read, so the sentences built here are
 * the only record of what the person picked. If Use stops naming the open tab,
 * "post that one on the ticket" lands on whichever one the agent guesses.
 */

const VARIANTS = [
  { label: 'Short', body: 'Exports land on 3 September.' },
  { label: 'Friendly', body: 'Good news: exports land on 3 September.' },
];

test('the message names the open tab', () => {
  assert.equal(draftUseMessage('Short'), 'Use the "Short" version.');
});

test('an action message follows the sentence that named the tab', () => {
  assert.equal(
    draftUseMessage('Short', 'Post it as a comment on PAY-142.'),
    'Use the "Short" version. Post it as a comment on PAY-142.',
  );
});

test('a call with variants reads as a panel', () => {
  const draft = draftTextOf({ title: 'Exec update', voice: 'exec', variants: VARIANTS });
  assert.equal(draft?.title, 'Exec update');
  assert.equal(draft?.voice, 'exec');
  assert.deepEqual(draft?.variants, VARIANTS);
});

test('the action carries the button label and its sentence', () => {
  const draft = draftTextOf({
    variants: [VARIANTS[0]!],
    action: { label: 'Post on PAY-142', message: 'Post it as a comment on PAY-142.' },
  });
  assert.equal(draft?.action?.label, 'Post on PAY-142');
  assert.equal(
    draftUseMessage(draft!.variants[0]!.label, draft!.action?.message),
    'Use the "Short" version. Post it as a comment on PAY-142.',
  );
});

test('a call with nothing to show folds into the activity trail', () => {
  for (const input of [undefined, null, {}, { variants: [] }, { variants: 'Short' }])
    assert.equal(draftTextOf(input), null, JSON.stringify(input ?? null));
});

test('a refused draft draws nothing, so the rewrite is the only panel', () => {
  const call = {
    state: 'output-available',
    input: { voice: 'exec', variants: VARIANTS },
    output:
      'Rejected: this draft says it is in the exec voice, but you have not read that brief yet.',
  };
  assert.equal(draftTextShown(call), null);
  // The same variants, once the tool accepts them.
  assert.equal(
    draftTextShown({ ...call, output: 'Showed 2 versions in the chat: Short, Friendly.' })?.variants
      .length,
    2,
  );
});

test('a call still running draws nothing, however complete its input looks', () => {
  for (const state of ['input-streaming', 'input-available', 'output-error', undefined])
    assert.equal(draftTextShown({ state, input: { variants: VARIANTS } }), null, String(state));
});

test('a half-streamed variant is dropped, an unnamed one is numbered', () => {
  const draft = draftTextOf({ variants: [{ label: 'Short' }, { body: 'Ships Thursday.' }] });
  assert.deepEqual(draft?.variants, [{ label: 'Version 1', body: 'Ships Thursday.' }]);
});

/**
 * The voice picker's sentence. A voice is how the whole draft sounds, so it
 * asks for every version — naming one tab here would come back as a panel whose
 * versions no longer compare, which is the one thing the tabs are for.
 */

test('picking a voice asks for every version, never the open tab', () => {
  const draft = draftTextOf({ title: 'Exec update', voice: 'exec', variants: VARIANTS })!;
  assert.equal(
    draftVoiceMessage(draft, 'CS voice'),
    'Rewrite every version of "Exec update". Use the CS voice.',
  );
});

test('one version is not "every version", and an untitled panel is "that draft"', () => {
  const draft = draftTextOf({ variants: [VARIANTS[0]!] })!;
  assert.equal(draftVoiceMessage(draft, 'CS voice'), 'Rewrite that draft. Use the CS voice.');
});

test('a voice titled without the word gets it, so "Boardroom" is not read as a place', () => {
  const draft = draftTextOf({ variants: [VARIANTS[0]!] })!;
  assert.equal(
    draftVoiceMessage(draft, 'Boardroom'),
    'Rewrite that draft. Use the Boardroom voice.',
  );
});

test('dropping the voice asks for plain writing, not for a voice named plain', () => {
  const draft = draftTextOf({ title: 'Exec update', voice: 'exec', variants: VARIANTS })!;
  assert.equal(
    draftVoiceMessage(draft, null),
    'Rewrite every version of "Exec update". Write it plainly, with no voice.',
  );
});

test('the word count counts prose, not the markdown holding it up', () => {
  assert.equal(draftWordCount('Exports land on 3 September.'), 5);
  assert.equal(draftWordCount('## What changed\n\n- Exports land\n- Imports do not\n'), 7);
  assert.equal(draftWordCount('Run it:\n\n```\nnpm run build\n```\n'), 2);
  assert.equal(draftWordCount(''), 0);
});
