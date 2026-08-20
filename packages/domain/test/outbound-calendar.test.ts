import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zOutboundPayload } from '../src/index.js';

/**
 * The calendar outbound actions (phase 4) enforce their required target at
 * FILING time — a card missing its target must be rejected where the agent can
 * react, not at approval. These pin the per-action superRefine.
 */

const base = {
  provider: 'google-calendar' as const,
  system: 'google-calendar' as const,
  body: 'x',
  rationale: 'r',
};

test('create_event: needs a title and a start', () => {
  assert.equal(zOutboundPayload.safeParse({ ...base, action: 'create_event' }).success, false);
  assert.equal(
    zOutboundPayload.safeParse({ ...base, action: 'create_event', title: 'Follow-up' }).success,
    false,
  );
  assert.equal(
    zOutboundPayload.safeParse({
      ...base,
      action: 'create_event',
      title: 'Follow-up',
      start: '2026-08-04T15:00:00+02:00',
    }).success,
    true,
  );
});

test('update_event: needs an eventId', () => {
  assert.equal(zOutboundPayload.safeParse({ ...base, action: 'update_event' }).success, false);
  assert.equal(
    zOutboundPayload.safeParse({ ...base, action: 'update_event', eventId: 'evt-1' }).success,
    true,
  );
});

test('respond_to_event: needs eventId, attendeeEmail and responseStatus', () => {
  assert.equal(
    zOutboundPayload.safeParse({ ...base, action: 'respond_to_event', eventId: 'evt-1' }).success,
    false,
  );
  assert.equal(
    zOutboundPayload.safeParse({
      ...base,
      action: 'respond_to_event',
      eventId: 'evt-1',
      attendeeEmail: 'erik@tavla.example',
    }).success,
    false,
  );
  assert.equal(
    zOutboundPayload.safeParse({
      ...base,
      action: 'respond_to_event',
      eventId: 'evt-1',
      attendeeEmail: 'erik@tavla.example',
      responseStatus: 'accepted',
    }).success,
    true,
  );
  // responseStatus is a closed set.
  assert.equal(
    zOutboundPayload.safeParse({
      ...base,
      action: 'respond_to_event',
      eventId: 'evt-1',
      attendeeEmail: 'erik@tavla.example',
      responseStatus: 'maybe',
    }).success,
    false,
  );
});

test('provider round-trips: google-calendar carries `system` as its mirror', () => {
  const parsed = zOutboundPayload.parse({
    provider: 'google-calendar',
    action: 'create_event',
    title: 'x',
    start: '2026-08-04T15:00:00+02:00',
    body: 'x',
    rationale: 'r',
  });
  assert.equal(parsed.provider, 'google-calendar');
  assert.equal(parsed.system, 'google-calendar'); // preprocess mirrors it for legacy readers
});
