import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  copyMemoryKey,
  draftAnswerMessage,
  draftRepeatMessage,
  draftTextOf,
  draftTextShown,
  draftVoiceMessage,
  draftWordCount,
  forgetCopy,
  rememberCopy,
  type CopyMemory,
} from '../src/renderer/src/lib/draft-text.js';

/**
 * The draft panel's decisions (docs/draft-text.md): whether a tool call has
 * anything to show, what a question's answer sends, and what the voice picker
 * sends.
 *
 * The panel keeps no state the model can read, so the sentences built here are
 * the only record of what the person picked.
 */

const VARIANTS = [
  { label: 'Short', body: 'Exports land on 3 September.' },
  { label: 'Friendly', body: 'Good news: exports land on 3 September.' },
];

test('a call with variants reads as a panel', () => {
  const draft = draftTextOf({ title: 'Exec update', voice: 'exec', variants: VARIANTS });
  assert.equal(draft?.title, 'Exec update');
  assert.equal(draft?.voice, 'exec');
  assert.deepEqual(draft?.variants, VARIANTS);
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

/**
 * The panel's question (docs/learning-how-you-work.md, ticket 10). It rides the
 * tool input like everything else, so a malformed one has to read as no
 * question rather than a broken panel.
 */

test('an `ask` with one sentence and up to three options reads as a question', () => {
  const draft = draftTextOf({
    variants: VARIANTS,
    ask: {
      text: 'Write updates this way from now on?',
      options: ['For exec', ' For every audience ', 'Not now'],
    },
  });
  assert.deepEqual(draft?.ask, {
    text: 'Write updates this way from now on?',
    options: ['For exec', 'For every audience', 'Not now'],
  });
});

test('a malformed `ask` is dropped and the panel is otherwise unchanged', () => {
  for (const ask of [
    undefined,
    null,
    'Which?',
    { text: 'Which?' },
    { options: ['a'] },
    { text: '', options: ['a'] },
    { text: 'Which?', options: [] },
    { text: 'Which?', options: [1, 2] },
    { text: 'Which?', options: ['a', 'b', 'c', 'd'] },
  ]) {
    const draft = draftTextOf({ variants: VARIANTS, ask });
    assert.equal(draft?.ask, undefined, JSON.stringify(ask ?? null));
    assert.equal(draft?.variants.length, 2);
  }
});

test('the answer names the copied tab and the option', () => {
  assert.equal(
    draftAnswerMessage('One paragraph', 'For exec'),
    'I copied "One paragraph" and answered "For exec".',
  );
});

test('a second copy of the same style says it is the pick', () => {
  assert.equal(
    draftRepeatMessage('One paragraph', 'exec'),
    'I copied "One paragraph" again without answering, so treat it as the pick for exec.',
  );
});

/** A stand-in for localStorage. */
function memory(): CopyMemory & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get: (k) => map.get(k) ?? null,
    set: (k, v) => void map.set(k, v),
    remove: (k) => void map.delete(k),
  };
}

test('the same style copied from a later panel is a repeat, and clears the memory', () => {
  const store = memory();
  const key = copyMemoryKey('/vaults/tavla', 'exec');
  assert.deepEqual(rememberCopy(store, key, 'One paragraph', 'panel-1'), { repeat: false });
  // Copying again from the same panel is making sure the clipboard took it.
  assert.deepEqual(rememberCopy(store, key, 'One paragraph', 'panel-1'), { repeat: false });
  assert.deepEqual(rememberCopy(store, key, 'One paragraph', 'panel-2'), { repeat: true });
  assert.equal(store.get(key), null);
});

test('a different style from a later panel is a fresh copy, not a repeat', () => {
  const store = memory();
  const key = copyMemoryKey('/vaults/tavla', 'exec');
  rememberCopy(store, key, 'One paragraph', 'panel-1');
  assert.deepEqual(rememberCopy(store, key, 'Three lines', 'panel-2'), { repeat: false });
  assert.deepEqual(JSON.parse(store.get(key)!), { label: 'Three lines', panel: 'panel-2' });
});

test('an answer forgets the copy, and a broken value reads as nothing remembered', () => {
  const store = memory();
  const key = copyMemoryKey('/vaults/tavla', 'exec');
  rememberCopy(store, key, 'One paragraph', 'panel-1');
  forgetCopy(store, key);
  assert.equal(store.get(key), null);

  store.set(key, '{not json');
  assert.deepEqual(rememberCopy(store, key, 'One paragraph', 'panel-2'), { repeat: false });
});

test('the memory is keyed by workspace and voice, so two workspaces never share a pick', () => {
  assert.notEqual(copyMemoryKey('/a', 'exec'), copyMemoryKey('/b', 'exec'));
  assert.notEqual(copyMemoryKey('/a', 'exec'), copyMemoryKey('/a', 'cs'));
  assert.equal(copyMemoryKey('/a', 'Exec'), copyMemoryKey('/a', 'exec'));
});
