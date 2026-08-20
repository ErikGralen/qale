import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  outboundEffect,
  zOutboundPayload,
  type OutboundEffectFacts,
  type OutboundPayload,
} from '../src/index.js';

/**
 * The effect line: what approving an outbound card DOES, and who it reaches.
 * These pin two things — the exact sentence per card kind (it is a contract, the
 * PO reads it before every send) and the way it degrades when a fact is missing,
 * which must always be a SHORTER true line and never a guess.
 */

const payload = (fields: Record<string, unknown>): OutboundPayload => {
  const parsed = zOutboundPayload.safeParse(fields);
  assert.ok(parsed.success, `payload should parse: ${JSON.stringify(fields)}`);
  return parsed.data;
};

const jira = { provider: 'jira' as const, body: 'x', rationale: 'r' };
const confluence = { provider: 'confluence' as const, body: 'x', rationale: 'r' };
const calendar = { provider: 'google-calendar' as const, body: 'x', rationale: 'r' };

/** Tavla is us; Nordkap and Kranelund are not. */
const facts: OutboundEffectFacts = {
  selfEmails: ['erik@tavla.example'],
  names: new Map([
    ['asa.holm@tavla.example', 'Åsa Holm'],
    ['johan.berg@tavla.example', 'Johan Berg'],
  ]),
  titles: new Map([
    ['12345', 'Rollout plan'],
    ['evt-1', 'Nordkap sync'],
  ]),
};

test('create_ticket: names the project, claims no audience', () => {
  assert.equal(
    outboundEffect(payload({ ...jira, action: 'create_ticket', projectKey: 'PAY' }), facts),
    'Creates a ticket in PAY.',
  );
  assert.equal(
    outboundEffect(
      payload({ ...jira, action: 'create_ticket', projectKey: 'PAY', issueType: 'Epic' }),
      facts,
    ),
    'Creates an epic in PAY.',
  );
});

test('comment_ticket: names the ticket and its watchers, without counting them', () => {
  assert.equal(
    outboundEffect(payload({ ...jira, action: 'comment_ticket', issueKey: 'PAY-142' }), facts),
    'Posts a comment on PAY-142. Anyone watching the ticket is notified.',
  );
});

test('update_page: the mirror title, and append vs in-place edit', () => {
  assert.equal(
    outboundEffect(payload({ ...confluence, action: 'update_page', pageId: '12345' }), facts),
    'Adds a section to “Rollout plan”. Anyone watching the page is notified.',
  );
  assert.equal(
    outboundEffect(
      payload({
        ...confluence,
        action: 'update_page',
        pageId: '12345',
        patch: { search: 'a', replace: 'b' },
      }),
      facts,
    ),
    'Edits “Rollout plan” in place. Anyone watching the page is notified.',
  );
});

test('update_page: an unknown page is "the page", never the raw id', () => {
  const line = outboundEffect(
    payload({ ...confluence, action: 'update_page', pageId: '99999' }),
    facts,
  );
  assert.equal(line, 'Adds a section to the page. Anyone watching it is notified.');
  assert.ok(!line!.includes('99999'));
});

test('send_message: says the quiet part — nothing leaves the machine', () => {
  assert.equal(
    outboundEffect(
      payload({
        provider: 'message',
        action: 'send_message',
        audience: 'CS',
        body: 'x',
        rationale: 'r',
      }),
      facts,
    ),
    'Saves the draft for CS in your workspace. Nothing is sent.',
  );
  assert.equal(
    outboundEffect(
      payload({ provider: 'message', action: 'send_message', body: 'x', rationale: 'r' }),
      facts,
    ),
    'Saves the draft in your workspace. Nothing is sent.',
  );
});

test('create_event: first names for people we know, the address for those we do not', () => {
  assert.equal(
    outboundEffect(
      payload({
        ...calendar,
        action: 'create_event',
        title: 'Follow-up',
        start: '2026-08-04T15:00:00+02:00',
        attendees: ['asa.holm@tavla.example', 'johan.berg@tavla.example'],
      }),
      facts,
    ),
    'Creates the event for Åsa and Johan. No invite email goes out.',
  );
});

test('create_event: one attendee outside the company is flagged in place', () => {
  assert.equal(
    outboundEffect(
      payload({
        ...calendar,
        action: 'create_event',
        title: 'Follow-up',
        start: '2026-08-04T15:00:00+02:00',
        // The PO's own address drops out: they are not their own guest.
        attendees: [
          'erik@tavla.example',
          'asa.holm@tavla.example',
          'johan.berg@tavla.example',
          'marcus@kranelund.example',
        ],
      }),
      facts,
    ),
    'Creates the event for Åsa, Johan and marcus@kranelund.example (outside your company). No invite email goes out.',
  );
});

test('create_event: several outsiders are counted at the end, and a long list is capped', () => {
  assert.equal(
    outboundEffect(
      payload({
        ...calendar,
        action: 'create_event',
        title: 'Follow-up',
        start: '2026-08-04T15:00:00+02:00',
        attendees: ['asa.holm@tavla.example', 'marcus@kranelund.example', 'sara@nordkap.example'],
      }),
      facts,
    ),
    'Creates the event for Åsa, marcus@kranelund.example and sara@nordkap.example (2 outside your company). No invite email goes out.',
  );
  assert.equal(
    outboundEffect(
      payload({
        ...calendar,
        action: 'create_event',
        title: 'Follow-up',
        start: '2026-08-04T15:00:00+02:00',
        attendees: [
          'asa.holm@tavla.example',
          'johan.berg@tavla.example',
          'p3@tavla.example',
          'p4@tavla.example',
          'marcus@kranelund.example',
        ],
      }),
      facts,
    ),
    'Creates the event for Åsa, Johan, p3@tavla.example and 2 others (1 outside your company). No invite email goes out.',
  );
});

test('create_event: no self identity ⇒ no claim about who is outside the company', () => {
  const line = outboundEffect(
    payload({
      ...calendar,
      action: 'create_event',
      title: 'Follow-up',
      start: '2026-08-04T15:00:00+02:00',
      attendees: ['marcus@kranelund.example'],
    }),
    { titles: facts.titles },
  );
  assert.equal(line, 'Creates the event for marcus@kranelund.example. No invite email goes out.');
});

test('create_event: nobody invited is said plainly', () => {
  assert.equal(
    outboundEffect(
      payload({
        ...calendar,
        action: 'create_event',
        title: 'Focus block',
        start: '2026-08-04T15:00:00+02:00',
      }),
      facts,
    ),
    'Creates the event on your calendar. Nobody else is invited.',
  );
});

test('update_event: the new time as written, never re-zoned', () => {
  assert.equal(
    outboundEffect(
      payload({
        ...calendar,
        action: 'update_event',
        eventId: 'evt-1',
        start: '2026-08-04T15:00:00+02:00',
      }),
      facts,
    ),
    'Moves “Nordkap sync” to 4 Aug, 15:00. Guests see the change, with no email.',
  );
  assert.equal(
    outboundEffect(
      payload({
        ...calendar,
        action: 'update_event',
        eventId: 'evt-1',
        start: '2026-08-04T15:00:00+02:00',
        title: 'Nordkap sync (short)',
      }),
      facts,
    ),
    'Moves “Nordkap sync” to 4 Aug, 15:00 and renames it. Guests see the change, with no email.',
  );
});

test('update_event: degrades through rename to a bare change', () => {
  assert.equal(
    outboundEffect(
      payload({
        ...calendar,
        action: 'update_event',
        eventId: 'evt-1',
        title: 'Nordkap sync (short)',
      }),
      facts,
    ),
    'Renames “Nordkap sync” to “Nordkap sync (short)”. Guests see the change, with no email.',
  );
  // Unknown event, unparsable start: no title, no time, still a true sentence.
  assert.equal(
    outboundEffect(
      payload({ ...calendar, action: 'update_event', eventId: 'evt-9', start: 'next tuesday' }),
      facts,
    ),
    'Changes the event. Guests see the change, with no email.',
  );
});

test('respond_to_event: the answer in the PO’s words', () => {
  const rsvp = (responseStatus: string): string | undefined =>
    outboundEffect(
      payload({
        ...calendar,
        action: 'respond_to_event',
        eventId: 'evt-1',
        attendeeEmail: 'erik@tavla.example',
        responseStatus,
      }),
      facts,
    );
  assert.equal(rsvp('accepted'), 'Replies yes on your behalf. The organiser sees it on the event.');
  assert.equal(rsvp('declined'), 'Replies no on your behalf. The organiser sees it on the event.');
  assert.equal(
    rsvp('tentative'),
    'Replies maybe on your behalf. The organiser sees it on the event.',
  );
});

test('every kind produces a line, with no facts at all and no em dashes', () => {
  const cards = [
    payload({ ...jira, action: 'create_ticket', projectKey: 'PAY' }),
    payload({ ...jira, action: 'comment_ticket', issueKey: 'PAY-142' }),
    payload({ ...confluence, action: 'update_page', pageId: '12345' }),
    payload({
      provider: 'message',
      action: 'send_message',
      audience: 'CS',
      body: 'x',
      rationale: 'r',
    }),
    payload({
      ...calendar,
      action: 'create_event',
      title: 'Follow-up',
      start: '2026-08-04T15:00:00+02:00',
      attendees: ['marcus@kranelund.example'],
    }),
    payload({
      ...calendar,
      action: 'update_event',
      eventId: 'evt-1',
      start: '2026-08-04T15:00:00+02:00',
    }),
    payload({
      ...calendar,
      action: 'respond_to_event',
      eventId: 'evt-1',
      attendeeEmail: 'erik@tavla.example',
      responseStatus: 'accepted',
    }),
  ];
  for (const card of cards) {
    const line = outboundEffect(card);
    assert.ok(line && line.endsWith('.'), `${card.action}: expected a sentence, got ${line}`);
    assert.ok(!line.includes('—'), `${card.action}: no em dashes in card copy`);
    // Two sentences at most, and short enough that the card cannot grow a
    // third line: the whole point of composing this instead of asking the model.
    assert.ok(line.split('. ').length <= 2, `${card.action}: one line, two sentences at most`);
    assert.ok(line.length <= 120, `${card.action}: too long at ${line.length} chars — ${line}`);
  }
});
