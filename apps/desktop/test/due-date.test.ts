import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addMonths,
  datePresets,
  dueLabel,
  endOfWeek,
  monthGrid,
  parseDateInput,
} from '../src/renderer/src/lib/due-date.js';

/** 2026-08-30 is a Sunday; 2026-09-04 is the Friday after it. */
const SUNDAY = '2026-08-30';
/** 2026-09-02 is a Wednesday. */
const WEDNESDAY = '2026-09-02';
/** 2026-09-04 is a Friday. */
const FRIDAY = '2026-09-04';

test('end of week is the coming Friday, today included', () => {
  assert.equal(endOfWeek(SUNDAY), '2026-09-04');
  assert.equal(endOfWeek(WEDNESDAY), '2026-09-04');
  assert.equal(endOfWeek(FRIDAY), FRIDAY);
});

test('presets read today, tomorrow, and the two Fridays', () => {
  assert.deepEqual(datePresets(WEDNESDAY), [
    { label: 'Today', due: '2026-09-02' },
    { label: 'Tomorrow', due: '2026-09-03' },
    { label: 'End of week', due: '2026-09-04' },
    { label: 'End of next week', due: '2026-09-11' },
  ]);
});

test('on a Friday the end-of-week preset drops instead of repeating today', () => {
  assert.deepEqual(
    datePresets(FRIDAY).map((p) => p.label),
    ['Today', 'Tomorrow', 'End of next week'],
  );
});

test('months clamp to the last day of a shorter month', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-03-15', -1), '2026-02-15');
});

test('the grid holds six Monday-first weeks around the month', () => {
  const grid = monthGrid('2026-09-15');
  assert.equal(grid.length, 42);
  assert.equal(grid[0], '2026-08-31');
  assert.equal(grid[41], '2026-10-11');
});

test('dueLabel says today, tomorrow, then the date', () => {
  assert.equal(dueLabel(WEDNESDAY, WEDNESDAY), 'today');
  assert.equal(dueLabel('2026-09-03', WEDNESDAY), 'tomorrow');
  assert.equal(dueLabel('2026-09-18', WEDNESDAY), '18 Sept');
  assert.equal(dueLabel('2027-01-04', WEDNESDAY), '4 Jan 2027');
});

test('parses the words', () => {
  const p = (s: string) => parseDateInput(s, WEDNESDAY);
  assert.equal(p('today'), '2026-09-02');
  assert.equal(p('Tomorrow'), '2026-09-03');
  assert.equal(p('tmrw'), '2026-09-03');
  assert.equal(p('eow'), '2026-09-04');
  assert.equal(p('end of week'), '2026-09-04');
  assert.equal(p('end of next week'), '2026-09-11');
  assert.equal(p('next week'), '2026-09-07');
  assert.equal(p('next month'), '2026-10-02');
});

test('parses weekdays, with "next" pushing a full week', () => {
  const p = (s: string) => parseDateInput(s, WEDNESDAY);
  assert.equal(p('fri'), '2026-09-04');
  assert.equal(p('friday'), '2026-09-04');
  assert.equal(p('mon'), '2026-09-07');
  assert.equal(p('wed'), WEDNESDAY, 'the coming Wednesday is today');
  assert.equal(p('next wed'), '2026-09-09');
  assert.equal(p('next fri'), '2026-09-04', 'the Friday ahead is already this week');
});

test('parses spans', () => {
  const p = (s: string) => parseDateInput(s, WEDNESDAY);
  assert.equal(p('in 3 days'), '2026-09-05');
  assert.equal(p('3d'), '2026-09-05');
  assert.equal(p('in a week'), '2026-09-09');
  assert.equal(p('2w'), '2026-09-16');
  assert.equal(p('in 2 months'), '2026-11-02');
});

test('parses written dates, day first', () => {
  const p = (s: string) => parseDateInput(s, WEDNESDAY);
  assert.equal(p('2026-09-18'), '2026-09-18');
  assert.equal(p('18/9'), '2026-09-18');
  assert.equal(p('4.1'), '2027-01-04', 'a day already past rolls to next year');
  assert.equal(p('18/9/2027'), '2027-09-18');
  assert.equal(p('18.9.27'), '2027-09-18');
  assert.equal(p('18 sep'), '2026-09-18');
  assert.equal(p('18 september'), '2026-09-18');
  assert.equal(p('sept 18'), '2026-09-18');
  assert.equal(p('18 sep 2028'), '2028-09-18');
  assert.equal(p('may 4'), '2027-05-04');
});

test('a bare number is a day of the month, this one or the next', () => {
  const p = (s: string) => parseDateInput(s, WEDNESDAY);
  assert.equal(p('18'), '2026-09-18');
  assert.equal(p('2'), WEDNESDAY);
  assert.equal(p('1'), '2026-10-01');
  assert.equal(parseDateInput('31', '2026-09-02'), '2026-10-31', 'September has no 31st');
});

test('nonsense parses to nothing, and says so by returning null', () => {
  const p = (s: string) => parseDateInput(s, WEDNESDAY);
  assert.equal(p(''), null);
  assert.equal(p('   '), null);
  assert.equal(p('email Åsa'), null);
  assert.equal(p('ne'), null);
  assert.equal(p('2026-02-30'), null);
  assert.equal(p('99'), null);
  assert.equal(p('t'), null);
});
