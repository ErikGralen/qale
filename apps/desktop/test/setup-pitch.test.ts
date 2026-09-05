import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentDTO, NoteRefDTO, SkillDTO, VaultTreeDTO } from '@qale/ipc';
import {
  ENOUGH_MEETINGS,
  pitchFinding,
  pitchPlans,
  setupPitch,
} from '../src/renderer/src/onboarding/setup-pitch.js';

/**
 * The pitch (docs/easier-tickets.md E-24).
 *
 * Every sentence on that card is a promise the product then has to keep, so
 * these tests are about what it refuses to say: no rhythm, no finding; a switch
 * off, no promise; nothing set up, no card at all.
 */

const DAY = 86_400_000;
/** A fixed clock, so "last four weeks" means the same thing on every run. */
const NOW = Date.parse('2026-09-02T09:00:00Z');

function meeting(daysAgo: number, over: Partial<NoteRefDTO> = {}): NoteRefDTO {
  const date = new Date(NOW - daysAgo * DAY).toISOString().slice(0, 10);
  return {
    path: `meetings/${date}-${over.series ?? 'one'}.md`,
    slug: date,
    type: 'meeting',
    title: 'A meeting',
    summary: '',
    mtime: 0,
    date,
    ...over,
  };
}

function tree(notes: NoteRefDTO[]): VaultTreeDTO {
  return {
    groups: [
      {
        dir: 'meetings',
        type: 'meeting',
        layer: 'record' as VaultTreeDTO['groups'][number]['layer'],
        notes,
      },
    ],
  };
}

function skill(name: string, over: Partial<SkillDTO> = {}): SkillDTO {
  return {
    path: `skills/${name}/SKILL.md`,
    slug: name,
    kind: 'skill',
    name,
    title: name,
    summary: '',
    can: [],
    errors: [],
    mtime: 0,
    files: [],
    lastUsedMs: null,
    ...over,
  };
}

function agent(id: string, over: Partial<AgentDTO> = {}): AgentDTO {
  return {
    id,
    title: id,
    summary: '',
    path: `agents/${id}/AGENT.md`,
    enabled: true,
    status: 'on',
    lastRunMs: null,
    lastCheckedMs: null,
    lastQuietMs: null,
    lastStoppedMs: null,
    starts: [],
    can: [],
    errors: [],
    pendingCards: 0,
    files: [],
    ...over,
  };
}

/** Everything on, which is what a seeded workspace looks like. */
const SKILLS = [skill('arrival'), skill('commitment-check')];
const AGENTS = [agent('meeting-prep'), agent('librarian')];

/** One meeting a day for `n` days, spread back from a week ago. */
function weekly(perWeek: number): NoteRefDTO[] {
  const notes: NoteRefDTO[] = [];
  for (let week = 0; week < 4; week += 1) {
    for (let i = 0; i < perWeek; i += 1) {
      notes.push(meeting(1 + week * 7 + i));
    }
  }
  return notes;
}

// ---------------------------------------------------------------------------
// What it refuses to say
// ---------------------------------------------------------------------------

test('under four meetings in the month, it has not seen enough and says nothing', () => {
  const notes = [meeting(2), meeting(5), meeting(9)];
  assert.equal(notes.length, ENOUGH_MEETINGS - 1);
  assert.equal(pitchFinding(tree(notes), NOW), null);
  assert.equal(setupPitch(tree(notes), SKILLS, AGENTS, NOW), null);
});

test('an empty workspace gets no pitch', () => {
  assert.equal(setupPitch(tree([]), SKILLS, AGENTS, NOW), null);
  assert.equal(setupPitch(null, SKILLS, AGENTS, NOW), null);
});

test('cancelled meetings and folder index files are not a rhythm', () => {
  const notes = [
    meeting(2, { eventStatus: 'cancelled' }),
    meeting(5, { eventStatus: 'cancelled' }),
    meeting(9, { eventStatus: 'cancelled' }),
    meeting(12, { path: 'meetings/index.md' }),
    meeting(15),
  ];
  assert.equal(pitchFinding(tree(notes), NOW), null);
});

test('a full calendar with nothing set up gets no card', () => {
  assert.equal(setupPitch(tree(weekly(4)), [], [], NOW), null);
});

// ---------------------------------------------------------------------------
// What it found
// ---------------------------------------------------------------------------

test('a steady four a week reads as four a week', () => {
  assert.match(pitchFinding(tree(weekly(4)), NOW)!, /^You have about four meetings most weeks/);
});

test('two middle weeks that disagree give both numbers', () => {
  // Weeks hold 6, 5, 4 and 3. The middle two are 4 and 5, so the outliers on
  // either side lose their vote.
  const notes: NoteRefDTO[] = [];
  const counts = [6, 5, 4, 3];
  counts.forEach((n, week) => {
    for (let i = 0; i < n; i += 1) notes.push(meeting(1 + week * 7 + i));
  });
  assert.match(pitchFinding(tree(notes), NOW)!, /^You have four or five meetings most weeks\./);
});

test('a month that is all one busy week states the total instead of a rate', () => {
  const notes = [meeting(1), meeting(2), meeting(3), meeting(4), meeting(5)];
  assert.equal(pitchFinding(tree(notes), NOW), 'You have five meetings in a month.');
});

test('an empty past falls forward to the meetings on the calendar ahead', () => {
  const ahead = [meeting(-2), meeting(-3), meeting(-4), meeting(-9), meeting(-10)];
  assert.match(pitchFinding(tree(ahead), NOW)!, /^You have /);
});

test('it names the meetings that come round, and only those', () => {
  const notes = [
    ...Array.from({ length: 4 }, (_, i) => meeting(1 + i * 7, { series: 'a', title: 'Standup' })),
    ...Array.from({ length: 3 }, (_, i) =>
      meeting(2 + i * 7, { series: 'b', title: 'Product sync' }),
    ),
    ...Array.from({ length: 2 }, (_, i) =>
      meeting(3 + i * 7, { series: 'c', title: 'Nordkap weekly' }),
    ),
    // Seen once: not a rhythm, so it is never named.
    meeting(4, { series: 'd', title: 'One off' }),
    meeting(5, { title: 'No series at all' }),
  ];
  const found = pitchFinding(tree(notes), NOW)!;
  assert.match(
    found,
    /the same three keep coming round: Standup, Product sync and Nordkap weekly\.$/,
  );
  assert.doesNotMatch(found, /One off|No series at all/);
});

test('one repeating meeting is said as one, not as a list of one', () => {
  const notes = [
    ...Array.from({ length: 4 }, (_, i) => meeting(1 + i * 7, { series: 'a', title: 'Standup' })),
    meeting(4, { title: 'One off' }),
  ];
  assert.match(pitchFinding(tree(notes), NOW)!, /, and Standup comes round again and again\.$/);
});

// ---------------------------------------------------------------------------
// What it plans to do
// ---------------------------------------------------------------------------

test('a seeded workspace promises all four, each pointing at its own file', () => {
  const plans = pitchPlans(SKILLS, AGENTS);
  assert.deepEqual(
    plans.map((p) => p.id),
    ['meeting-prep', 'commitment-check', 'librarian', 'arrival'],
  );
  assert.deepEqual(
    plans.map((p) => p.path),
    [
      'agents/meeting-prep/AGENT.md',
      'skills/commitment-check/SKILL.md',
      'agents/librarian/AGENT.md',
      'skills/arrival/SKILL.md',
    ],
  );
});

test('an agent switched off promises nothing', () => {
  const ids = pitchPlans(SKILLS, [
    agent('meeting-prep', { enabled: false, status: 'off' }),
    agent('librarian'),
  ]).map((p) => p.id);
  assert.deepEqual(ids, ['commitment-check', 'librarian', 'arrival']);
});

test('an agent that cannot run promises nothing either', () => {
  const ids = pitchPlans(SKILLS, [
    agent('meeting-prep', { status: 'blocked', blockedReason: 'No API key' }),
    agent('librarian'),
  ]).map((p) => p.id);
  assert.deepEqual(ids, ['commitment-check', 'librarian', 'arrival']);
});

test('a skill file with errors in it promises nothing', () => {
  const ids = pitchPlans(
    [skill('arrival', { errors: ['unknown key: on'] }), skill('commitment-check')],
    AGENTS,
  ).map((p) => p.id);
  assert.deepEqual(ids, ['meeting-prep', 'commitment-check', 'librarian']);
});

test('a voice is never mistaken for the skill of the same name', () => {
  const ids = pitchPlans(
    [skill('arrival', { kind: 'voice', path: 'voices/arrival.md' })],
    AGENTS,
  ).map((p) => p.id);
  assert.deepEqual(ids, ['meeting-prep', 'librarian']);
});

test('every promise is said in plain words, with none of our filing vocabulary', () => {
  const banned = /propose|proposal|note type|frontmatter|shelf|vault|memory layer|hub/i;
  for (const plan of pitchPlans(SKILLS, AGENTS)) assert.doesNotMatch(plan.line, banned);
});

// ---------------------------------------------------------------------------
// The whole card
// ---------------------------------------------------------------------------

test('with a rhythm and a roster, the card is a finding and its promises', () => {
  const pitch = setupPitch(tree(weekly(4)), SKILLS, AGENTS, NOW)!;
  assert.ok(pitch.found.startsWith('You have '));
  assert.equal(pitch.plans.length, 4);
});
