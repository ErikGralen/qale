import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEETING_TOOL_WORDS, TELEMETRY_EVENT_IDS, filterTelemetryProps } from '@qale/ipc';
import type { NoteRefDTO, VaultTreeDTO } from '@qale/ipc';
import {
  FIRST_STEP_ORDER,
  MEETING_TOOLS,
  MEETING_TOOL_IDS,
  firstStepsTally,
  stepRank,
} from '../src/renderer/src/lib/first-steps.js';

/**
 * The First steps arc (docs/critical-mass.md CM-1, CM-6, CM-7): the order the
 * rows stand in, the guides under the backlog row, and the sentence the card
 * leaves behind on its last showing.
 */

function note(over: Partial<NoteRefDTO> = {}): NoteRefDTO {
  return {
    path: 'meetings/one.md',
    slug: 'one',
    type: 'meeting',
    title: 'One',
    summary: '',
    mtime: 0,
    ...over,
  };
}

function tree(counts: Partial<Record<string, NoteRefDTO[]>>): VaultTreeDTO {
  return {
    groups: Object.entries(counts).map(([type, notes]) => ({
      dir: type,
      type: type as NoteRefDTO['type'],
      layer: 'record' as VaultTreeDTO['groups'][number]['layer'],
      notes: notes ?? [],
    })),
  };
}

test('the rows stand in the arc, and the payoff row is last', () => {
  const arc = [
    'connect:google-calendar',
    'transcript',
    'connect:atlassian',
    'understanding',
    'proposal',
    'prep',
  ];
  const ranks = arc.map(stepRank);
  assert.deepEqual(
    [...ranks].sort((a, b) => a - b),
    ranks,
    'the arc must read calendar, backlog, trackers, product, proposal, prep',
  );
  // Nothing runs without the key, so it stays first for anyone who skipped it.
  assert.equal(stepRank('key'), 0);
  assert.equal(stepRank('prep'), FIRST_STEP_ORDER.length - 1);
});

test('a row nobody named sorts to the end rather than to the front', () => {
  assert.equal(stepRank('connect:slack'), FIRST_STEP_ORDER.length);
  assert.ok(stepRank('connect:slack') > stepRank('prep'));
});

test('every tool has a guide, and one of them is for having nothing', () => {
  assert.equal(MEETING_TOOLS.length, 6);
  for (const tool of MEETING_TOOLS) {
    assert.ok(tool.label.length > 0, `${tool.id} needs a label`);
    assert.ok(tool.guide.length > 40, `${tool.id} needs a real guide`);
    assert.ok(!tool.guide.includes('—'), `${tool.id} guide must hold no em dash`);
  }
  const none = MEETING_TOOLS.find((t) => t.id === 'other');
  assert.ok(none && /notes/i.test(none.guide), 'the last option must say their own notes count');
});

test('the tool ids are the words telemetry may send, and nothing else', () => {
  assert.deepEqual([...MEETING_TOOL_IDS].sort(), [...MEETING_TOOL_WORDS].sort());
});

test('the tool event is on the allowlist and carries the id alone', () => {
  assert.ok(TELEMETRY_EVENT_IDS.includes('source.tool'));
  assert.deepEqual(filterTelemetryProps('source.tool', { tool: 'granola' }), {
    tool: 'granola',
  });
  // A tool nobody wrote down, and anything else riding along, is dropped.
  assert.deepEqual(filterTelemetryProps('source.tool', { tool: 'Nordkap weekly' }), {});
  assert.deepEqual(
    filterTelemetryProps('source.tool', { tool: 'zoom', path: 'meetings/one.md' }),
    { tool: 'zoom' },
  );
});

test('the tally counts what the workspace holds', () => {
  const built = tree({
    meeting: [
      note({ captured: true }),
      note({ slug: 'two', captured: true }),
      note({ slug: 'three' }),
    ],
    person: [note({ type: 'person', slug: 'ada' }), note({ type: 'person', slug: 'bo' })],
    decision: [note({ type: 'decision', slug: 'd1' })],
  });
  assert.equal(
    firstStepsTally(built),
    'Your memory now holds 3 meetings, 2 with notes, 2 people and 1 decision.',
  );
});

test('a count of zero loses its segment rather than printing zero', () => {
  const built = tree({ meeting: [note(), note({ slug: 'two' })] });
  assert.equal(firstStepsTally(built), 'Your memory now holds 2 meetings.');
  assert.ok(!firstStepsTally(built)!.includes('0 '));
});

test('one of a thing reads as one of a thing', () => {
  const built = tree({
    meeting: [note({ captured: true })],
    person: [note({ type: 'person', slug: 'ada' })],
  });
  assert.equal(
    firstStepsTally(built),
    'Your memory now holds 1 meeting, 1 with notes and 1 person.',
  );
});

test('an empty workspace says nothing at all', () => {
  assert.equal(firstStepsTally(null), null);
  assert.equal(firstStepsTally({ groups: [] }), null);
});
