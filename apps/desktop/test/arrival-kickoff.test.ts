import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseKickoff } from '@qale/sessions';
import { arrivalKickoff, arrivalManifest } from '../src/main/arrival.js';

/**
 * What a drop says to the session that reads it.
 *
 * A drop now starts in a composer, so the sentence the PM typed beside the files
 * is the whole instruction: the skill's own body already says to read `input.md`
 * and file what is there. These check the two things that carry across the wire:
 * the person's words, and the list of what arrived.
 */

const FILES = [
  { file: 'source/nordkap-qbr.vtt', original: 'Nordkap QBR.vtt', bytes: 4210 },
  { file: 'source/skiss.png', original: 'skiss.png', bytes: 90 },
];

test('kickoff: the typed sentence is the instruction, verbatim', () => {
  const prompt = arrivalKickoff('These are old interviews, just file them.');
  assert.equal(prompt, 'Run the arrival skill: These are old interviews, just file them.');
  // And it reads back, so the chat renders a run row rather than a bubble.
  assert.deepEqual(parseKickoff(prompt), {
    skill: 'arrival',
    instruction: 'These are old interviews, just file them.',
  });
});

test('kickoff: nothing typed is an empty instruction, not a composed paragraph', () => {
  assert.equal(arrivalKickoff(), 'Run the arrival skill.');
  assert.equal(arrivalKickoff(''), 'Run the arrival skill.');
  assert.equal(arrivalKickoff('   \n  '), 'Run the arrival skill.');
  assert.equal(parseKickoff('Run the arrival skill.')?.instruction, '');
});

test('manifest: every file that landed is named, with where it sits now', () => {
  const md = arrivalManifest({
    written: FILES,
    refused: [],
    candidates: [],
    at: '2026-09-09',
  });
  assert.match(md, /^# What arrived/);
  assert.match(md, /2 sources, handed over 2026-09-09\./);
  assert.match(md, /- `source\/nordkap-qbr\.vtt` — dropped as "Nordkap QBR\.vtt", 4210 bytes/);
  assert.match(md, /- `source\/skiss\.png` — dropped as "skiss\.png", 90 bytes/);
  // Nothing was refused and nothing was said, so neither section is invented.
  assert.doesNotMatch(md, /Could not be read/);
  assert.doesNotMatch(md, /What the PM asked for/);
  assert.doesNotMatch(md, /Meetings on the calendar/);
});

test('manifest: one source is one source', () => {
  const md = arrivalManifest({ written: [FILES[0]!], refused: [], candidates: [], at: 'today' });
  assert.match(md, /1 source, handed over today\./);
});

test('manifest: what the PM typed travels with the files', () => {
  const md = arrivalManifest({
    written: FILES,
    refused: [{ name: 'deck.zip', error: 'a zip is not text' }],
    instruction: '  Attach the first one to the Nordkap meeting.  ',
    candidates: ['- meetings/nordkap.md — “Nordkap QBR”, 2026-09-08 09:00'],
    at: 'today',
  });
  assert.match(md, /Could not be read, so they are not here:\n- deck\.zip: a zip is not text/);
  // Trimmed, and nothing else done to it.
  assert.match(md, /## What the PM asked for\n\nAttach the first one to the Nordkap meeting\.\n/);
  assert.match(md, /## Meetings on the calendar near now/);
  assert.match(md, /- meetings\/nordkap\.md — “Nordkap QBR”, 2026-09-08 09:00/);
});
