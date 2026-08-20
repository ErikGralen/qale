import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeEventWhen, rsvpAnswer } from '../src/index.js';

/**
 * The "when" on a calendar card. These pin the two things that make it worth
 * showing: the hour is the one written in the payload (never re-zoned into the
 * app's clock), and every missing fact shortens the line instead of inventing a
 * number. The 30-minute default is the single exception, and only because the
 * connector really does create exactly that.
 */

// 10 Aug 2026 is a Monday; "now" sits on the 7th.
const NOW = Date.parse('2026-08-07T09:00:00Z');

test('a timed event reads as day, clock and length', () => {
  const when = describeEventWhen('2026-08-10T14:00:00+02:00', '2026-08-10T14:30:00+02:00', NOW);
  assert.deepEqual(when, {
    day: 'Mon 10 Aug',
    time: '14:00–14:30',
    length: '30 min',
    assumedLength: false,
    allDay: false,
    past: false,
  });
});

test('the hour is the one in the payload, whatever zone the app is in', () => {
  // Same instant, written in two zones: each card shows the time it was drafted
  // with, because that offset IS the intent.
  assert.equal(describeEventWhen('2026-08-10T14:00:00+02:00', undefined, NOW)?.time, '14:00');
  assert.equal(describeEventWhen('2026-08-10T12:00:00Z', undefined, NOW)?.time, '12:00');
});

test('no end means the connector default, said as a default', () => {
  const when = describeEventWhen('2026-08-10T14:00:00+02:00', undefined, NOW);
  assert.equal(when?.length, '30 min');
  assert.equal(when?.assumedLength, true);
});

test('an unreadable end claims no length at all', () => {
  const when = describeEventWhen('2026-08-10T14:00:00+02:00', 'after lunch', NOW);
  assert.equal(when?.time, '14:00');
  assert.equal(when?.length, undefined);
  assert.equal(when?.assumedLength, false);
});

test('longer meetings read in hours; a span across days keeps the start alone', () => {
  assert.equal(
    describeEventWhen('2026-08-10T09:00:00+02:00', '2026-08-10T10:30:00+02:00', NOW)?.length,
    '1 hour 30 min',
  );
  assert.equal(
    describeEventWhen('2026-08-10T09:00:00+02:00', '2026-08-10T11:00:00+02:00', NOW)?.length,
    '2 hours',
  );
  const across = describeEventWhen('2026-08-10T09:00:00+02:00', '2026-08-11T17:00:00+02:00', NOW);
  assert.equal(across?.time, '09:00');
  assert.equal(across?.length, '1 day 8 hours');
});

test('an all-day event has a day and no clock', () => {
  const when = describeEventWhen('2026-08-10', undefined, NOW);
  assert.equal(when?.allDay, true);
  assert.equal(when?.time, undefined);
  assert.equal(when?.length, undefined);
});

test('another year is spelled out; this year is not', () => {
  assert.equal(
    describeEventWhen('2027-01-04T09:00:00+01:00', undefined, NOW)?.day,
    'Mon 4 Jan 2027',
  );
  assert.equal(describeEventWhen('2026-08-10T09:00:00+02:00', undefined, NOW)?.day, 'Mon 10 Aug');
});

test('a start that has already gone by is flagged', () => {
  assert.equal(describeEventWhen('2026-07-10T14:00:00+02:00', undefined, NOW)?.past, true);
  assert.equal(describeEventWhen('2026-08-10T14:00:00+02:00', undefined, NOW)?.past, false);
  // An all-day event is past only once its whole day is over.
  assert.equal(describeEventWhen('2026-08-07', undefined, NOW)?.past, false);
});

test('nothing readable means no line, never a guess', () => {
  assert.equal(describeEventWhen(undefined, undefined, NOW), undefined);
  assert.equal(describeEventWhen('next tuesday', undefined, NOW), undefined);
  assert.equal(describeEventWhen('2026-13-40', undefined, NOW), undefined);
});

test('an RSVP is a yes, a no or a maybe', () => {
  assert.equal(rsvpAnswer('accepted'), 'yes');
  assert.equal(rsvpAnswer('declined'), 'no');
  assert.equal(rsvpAnswer('tentative'), 'maybe');
});
