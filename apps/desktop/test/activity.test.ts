import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ActivityDTO } from '@qale/ipc';
import {
  countToday,
  dayLabel,
  groupByDay,
  startOfToday,
  timeOfDay,
} from '../src/renderer/src/lib/activity.js';

/** A row as the channel hands it over, newest first. */
function row(at: Date, over: Partial<ActivityDTO> = {}): ActivityDTO {
  return {
    id: `a_${at.getTime()}`,
    action: 'created',
    line: 'I filed Tuesday’s standup notes under sources.',
    reason: 'material arrived: a new page',
    path: 'sources/tuesday-standup.md',
    proposalId: 'p1',
    sessionId: 's1',
    at: at.toISOString(),
    revertable: true,
    reverted: null,
    ...over,
  };
}

/** A local time on a given day, so no test depends on the machine's zone. */
function at(daysAgo: number, hour: number, now = new Date()): Date {
  const d = new Date(now);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 30, 0, 0);
  return d;
}

test('a day is named the way a person names it', () => {
  const now = Date.now();
  assert.equal(dayLabel(at(0, 9).getTime(), now), 'Today');
  assert.equal(dayLabel(at(1, 9).getTime(), now), 'Yesterday');
  const older = dayLabel(at(4, 9).getTime(), now);
  assert.notEqual(older, 'Today');
  assert.notEqual(older, 'Yesterday');
  // A date, never "4 days ago": inside a list of dates that is arithmetic.
  assert.ok(!/ago/.test(older));
});

test('late evening still belongs to today, not to tomorrow', () => {
  const now = at(0, 23).getTime();
  assert.equal(dayLabel(at(0, 22).getTime(), now), 'Today');
});

test('rows group into days, newest first, order inside a day untouched', () => {
  const rows = [row(at(0, 16)), row(at(0, 9)), row(at(1, 11)), row(at(3, 14))];
  const days = groupByDay(rows);
  assert.deepEqual(
    days.map((d) => d.label),
    ['Today', 'Yesterday', days[2]!.label],
  );
  assert.equal(days[0]!.rows.length, 2);
  assert.equal(days[0]!.rows[0]!.id, rows[0]!.id);
  assert.equal(days[1]!.rows.length, 1);
});

test('a row with no readable time is dropped, never heaped into a day', () => {
  const days = groupByDay([row(at(0, 9), { at: 'not a date' }), row(at(0, 10))]);
  assert.equal(days.length, 1);
  assert.equal(days[0]!.rows.length, 1);
});

test('nothing to show is no days at all', () => {
  assert.deepEqual(groupByDay([]), []);
});

test('the rail counts today only, and never counts what was put back', () => {
  const now = Date.now();
  const rows = [
    row(at(0, 9)),
    row(at(0, 14), { id: 'undone', reverted: new Date().toISOString(), revertable: false }),
    row(at(1, 9)),
  ];
  assert.equal(countToday(rows, now), 1);
  assert.equal(countToday([], now), 0);
});

test('today starts at local midnight', () => {
  const now = at(0, 15).getTime();
  const start = new Date(startOfToday(now));
  assert.equal(start.getHours(), 0);
  assert.equal(start.getMinutes(), 0);
  assert.equal(start.getDate(), new Date(now).getDate());
});

test('a row says what time it landed, and stays quiet about a broken one', () => {
  assert.match(timeOfDay(at(0, 14).toISOString()), /\d{1,2}[:.]\d{2}/);
  assert.equal(timeOfDay('not a date'), '');
});
