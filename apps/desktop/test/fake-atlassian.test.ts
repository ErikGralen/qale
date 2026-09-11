import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atlassianConnector } from '@qale/connectors';
import type { ExternalContainer } from '@qale/connectors';
import { createFakeAtlassian, type FakeAtlassian } from '../src/main/demo/fake-atlassian.js';

/**
 * The fake is only worth anything if the REAL connector is happy with it, so
 * every test here drives `atlassianConnector.create(creds, { fetchImpl })` —
 * the same call SyncService makes — and never the fake's router directly,
 * except where a raw request is the point (a stale page version, a foreign
 * host).
 */

const ROOT = join(import.meta.dirname, '..', '..', '..');
const FIXTURE = join(ROOT, 'demo', 'atlassian-fixture.json');
const SITE = 'https://bord.atlassian.net';

const CREDS = { siteUrl: SITE, email: 'demo@bord.example', apiToken: 'demo' };

const TICKETS: ExternalContainer = { kind: 'ticket', id: 'BOK', name: 'Bookings' };
const PAGES: ExternalContainer = { kind: 'wikipage', id: 'PROD', name: 'Product' };

/** The Bookings issues, in key order. The pull order is by update time, which
 *  the ticket mirrors own, so only the set is asserted below. */
const BOOKINGS_KEYS = ['BOK-260', 'BOK-262', 'BOK-265', 'BOK-300', 'BOK-301', 'BOK-412', 'BOK-520'];

function fake(dateOffsetDays = 0): FakeAtlassian {
  const dir = mkdtempSync(join(tmpdir(), 'qale-fake-atlassian-'));
  return createFakeAtlassian({
    fixturePath: FIXTURE,
    statePath: join(dir, 'demo', 'atlassian.json'),
    dateOffsetDays,
    siteUrl: SITE,
  });
}

function connectorFor(f: FakeAtlassian): ReturnType<typeof atlassianConnector.create> {
  return atlassianConnector.create(CREDS, { fetchImpl: f.fetchImpl });
}

test('the probe passes and reports the account', async () => {
  const verify = await connectorFor(fake()).verifyAuth();
  assert.equal(verify.ok, true);
  assert.equal(verify.health, 'ok');
  assert.equal(verify.identity?.displayName, 'Demo user');
});

test('a request to another host is a 404, not a live call', async () => {
  const f = fake();
  const res = await f.fetchImpl('https://real.atlassian.net/rest/api/3/myself');
  assert.equal(res.status, 404);
  const unknown = await f.fetchImpl(`${SITE}/rest/api/3/nothing-here`);
  assert.equal(unknown.status, 404);
  // A scoped token routes through the gateway; the same store answers.
  const gateway = await f.fetchImpl('https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/myself');
  assert.equal(gateway.status, 200);
});

test('listContainers returns the three projects and the Product space', async () => {
  const containers = await connectorFor(fake()).listContainers();
  assert.deepEqual(
    containers.map((c) => `${c.kind}:${c.id}`),
    ['ticket:BOK', 'ticket:GST', 'ticket:PAY', 'wikipage:PROD'],
  );
});

test('a full ticket pull returns the cast, oldest first, with state categories', async () => {
  const pull = await connectorFor(fake()).pullChanges(TICKETS, null);
  assert.deepEqual([...pull.changes.map((c) => c.external_id)].sort(), BOOKINGS_KEYS);
  const byKey = new Map(pull.changes.map((c) => [c.external_id, c]));
  const stateOf = (key: string): string => {
    const change = byKey.get(key);
    return change?.kind === 'ticket' ? change.state : '';
  };
  const categoryOf = (key: string): string => {
    const change = byKey.get(key);
    return change?.kind === 'ticket' ? change.state_category : '';
  };
  assert.equal(stateOf('BOK-300'), 'In Progress');
  assert.equal(stateOf('BOK-412'), 'Done');
  assert.equal(stateOf('BOK-520'), 'To Do');
  assert.equal(categoryOf('BOK-300'), 'in_progress');
  assert.equal(categoryOf('BOK-412'), 'done');
  assert.equal(categoryOf('BOK-520'), 'open');
  // The bug was fixed on the anchor day, so it is the last thing that moved.
  assert.equal(pull.changes.at(-1)?.external_id, 'BOK-412');
  assert.match(pull.highWaterMark ?? '', /^2026-07-17/);
});

test('a ticket fetch carries description, comments and the blocks link', async () => {
  const connector = connectorFor(fake());
  const epic = await connector.fetchFull('ticket', 'BOK-520');
  assert.equal(epic.title, 'Group bookings (epic)');
  assert.match(epic.bodyMarkdown, /set menu/);
  // Deposits block group bookings, the one cross-project dependency.
  assert.deepEqual(epic.kind === 'ticket' ? epic.links : [], [
    { type: 'blocks', key: 'PAY-210', reversed: true },
  ]);

  const bug = await connectorFor(fake()).fetchFull('ticket', 'BOK-412');
  assert.equal(bug.title, 'Reminder SMS sent twice for Google bookings');
  assert.match(bug.bodyMarkdown, /one reminder per booking/);

  const story = await connectorFor(fake()).fetchFull('ticket', 'BOK-265');
  assert.equal(story.kind === 'ticket' ? story.parentKey : '', 'BOK-260');
});

test('a full page pull returns both wikipages with their versions', async () => {
  const connector = connectorFor(fake());
  const pull = await connector.pullChanges(PAGES, null);
  assert.deepEqual(
    pull.changes.map((c) => `${c.external_id}:${c.kind === 'wikipage' ? c.version : ''}`),
    ['4521985:17', '4784129:38'],
  );
  const page = await connector.fetchFull('wikipage', '4521985');
  assert.equal(page.title, 'Roadmap H2');
  assert.equal(page.url, `${SITE}/wiki/spaces/PROD/pages/4521985`);
  assert.match(
    page.bodyMarkdown,
    /No-show fees: Q4\. A card at booking, charged when the guest does not turn up\. \(BOK-300\)/,
  );
});

test('an incremental pull with a fresh mark returns nothing', async () => {
  const connector = connectorFor(fake());
  const mark = new Date().toISOString();
  assert.deepEqual((await connector.pullChanges(TICKETS, mark)).changes, []);
  assert.deepEqual((await connector.pullChanges(PAGES, mark)).changes, []);
});

test('dates slide by the demo offset', async () => {
  const pull = await connectorFor(fake(10)).pullChanges(TICKETS, null);
  const bug = pull.changes.find((c) => c.external_id === 'BOK-412');
  // Fixed on the anchor day, so ten days on it reads as the 27th.
  assert.match(bug?.remote_updated ?? '', /^2026-07-27/);
});

test('tracked keys pull by id, unknown keys drop out', async () => {
  const changes = await connectorFor(fake()).pullByKeys('ticket', [
    'BOK-300',
    'PAY-210',
    'BOK-999',
  ]);
  assert.deepEqual([...changes.map((c) => c.external_id)].sort(), ['BOK-300', 'PAY-210']);
});

test('a created ticket gets the next key and turns up in a pull', async () => {
  const f = fake();
  const connector = connectorFor(f);
  const out = await connector.execute({
    provider: 'jira',
    system: 'jira',
    action: 'create_ticket',
    container: 'BOK',
    title: 'Charge the fee the morning after a no-show',
    body: 'Charge the stored card the morning after the booking, and send a receipt by text.',
    rationale: 'Agreed at the quarterly review.',
  });
  assert.equal(out.externalId, 'BOK-521');
  assert.equal(out.url, `${SITE}/browse/BOK-521`);

  const pull = await connector.pullChanges(TICKETS, null);
  const created = pull.changes.find((c) => c.external_id === 'BOK-521');
  assert.equal(created?.title, 'Charge the fee the morning after a no-show');
  assert.equal(created?.kind === 'ticket' && created.state_category, 'open');

  // The write persisted, so a relaunch of the fake still has it.
  const item = await connectorFor(f).fetchFull('ticket', 'BOK-521');
  assert.match(item.bodyMarkdown, /send a receipt by text\./);
});

test('a comment lands on the ticket thread', async () => {
  const connector = connectorFor(fake());
  const out = await connector.execute({
    provider: 'jira',
    system: 'jira',
    action: 'comment_ticket',
    targetId: 'BOK-300',
    body: 'The stories are written, so this is ready for sprint planning.',
    rationale: 'Agreed in the 1:1.',
  });
  assert.equal(out.externalId, 'BOK-300');
  const item = await connector.fetchFull('ticket', 'BOK-300');
  assert.match(
    item.bodyMarkdown,
    /The stories are written, so this is ready for sprint planning\./,
  );
});

test('a page update bumps the version and a stale version is refused', async () => {
  const f = fake();
  const connector = connectorFor(f);
  await connector.execute({
    provider: 'confluence',
    system: 'confluence',
    action: 'update_page',
    targetId: '4521985',
    body: '## Committed\n\nNo-show fees: Q4, live by the end of October.',
    provenance: 'Source: meetings/2026-07-16-brasserie-lund-quarterly-review',
    rationale: 'The page does not carry the date the customer was given.',
  });
  const page = await connector.fetchFull('wikipage', '4521985');
  assert.equal(page.kind === 'wikipage' ? page.version : 0, 18);
  assert.match(page.bodyMarkdown, /No-show fees: Q4, live by the end of October\./);

  const stale = await f.fetchImpl(`${SITE}/wiki/api/v2/pages/4521985`, {
    method: 'PUT',
    body: JSON.stringify({
      id: '4521985',
      status: 'current',
      title: 'Roadmap H2',
      body: { representation: 'storage', value: '<p>stale</p>' },
      version: { number: 18 },
    }),
  });
  assert.equal(stale.status, 409);
});

test('reset puts the fixture back', async () => {
  const f = fake();
  const connector = connectorFor(f);
  await connector.execute({
    provider: 'jira',
    system: 'jira',
    action: 'create_ticket',
    container: 'BOK',
    title: 'Thrown away by reset',
    body: 'Temporary.',
    rationale: 'Testing reset.',
  });
  assert.equal(
    (await connectorFor(f).pullChanges(TICKETS, null)).changes.length,
    BOOKINGS_KEYS.length + 1,
  );
  f.reset();
  const after = await connectorFor(f).pullChanges(TICKETS, null);
  assert.equal(after.changes.length, BOOKINGS_KEYS.length);
  assert.equal(
    after.changes.some((c) => c.external_id === 'BOK-521'),
    false,
  );
});

test('the footprint survey finds the project and the space', async () => {
  // Slide the cast onto today, or the survey's 90-day window would age out.
  const offset = Math.round((Date.now() - Date.parse('2026-07-17T00:00:00Z')) / 86_400_000);
  const footprint = await connectorFor(fake(offset)).surveyFootprint();
  const tickets = footprint.find((f) => f.kind === 'ticket');
  assert.equal(tickets?.id, 'BOK');
  assert.equal(tickets?.count, BOOKINGS_KEYS.length);
  const pages = footprint.find((f) => f.kind === 'wikipage');
  assert.equal(pages?.id, 'PROD');
  assert.equal(pages?.count && pages.count >= 1, true);
});

test('the generated fixture is valid JSON with the cast in it', () => {
  assert.equal(existsSync(FIXTURE), true, 'run `pnpm build-demo-fixture`');
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
    anchor: string;
    siteUrl: string;
    projects: unknown[];
    spaces: unknown[];
    issues: { key: string; comments: unknown[]; labels: string[] }[];
    pages: { id: string; body: string }[];
  };
  assert.equal(fixture.anchor, '2026-07-17');
  assert.equal(fixture.siteUrl, SITE);
  assert.equal(fixture.projects.length, 3);
  assert.equal(fixture.spaces.length, 1);
  assert.deepEqual(
    fixture.issues.map((i) => i.key),
    [
      'BOK-260',
      'BOK-262',
      'BOK-265',
      'BOK-300',
      'BOK-301',
      'BOK-412',
      'BOK-520',
      'GST-140',
      'GST-160',
      'GST-77',
      'PAY-190',
      'PAY-210',
    ],
  );
  // Every ticket carries its one area label (the conventions skill names it).
  assert.equal(
    fixture.issues.every((i) => i.labels.length === 1),
    true,
  );
  assert.deepEqual(
    fixture.pages.map((p) => p.id),
    ['4521985', '4784129'],
  );
  assert.match(fixture.pages[0]?.body ?? '', /^<h1>Roadmap H2 2026<\/h1>/);
});

test('a patch that spans two paragraphs lands, and stays two paragraphs', async () => {
  const f = fake();
  const connector = connectorFor(f);
  // The exact edit S1 drafts: the two committed lines are two paragraphs in
  // storage, with no whitespace between them, only `</p><p>`.
  const committed =
    'No-show fees: Q4. A card at booking, charged when the guest does not turn up. (BOK-300)' +
    '\n\nWaitlist: Q4, after no-show fees. (BOK-260)';
  await connector.execute({
    provider: 'confluence',
    system: 'confluence',
    action: 'update_page',
    targetId: '4521985',
    body: 'The date the customer was given.',
    patch: {
      search: committed,
      replace:
        'No-show fees: Q4, live by the end of October. A card at booking, charged when the ' +
        'guest does not turn up. (BOK-300)\n\nWaitlist: Q4, after no-show fees. (BOK-260)',
    },
    provenance: 'Source: meetings/2026-07-16-brasserie-lund-quarterly-review',
    rationale: 'Lena was told the end of October and the page does not say it.',
  });
  const page = await connector.fetchFull('wikipage', '4521985');
  assert.match(page.bodyMarkdown, /No-show fees: Q4, live by the end of October\./);
  assert.match(page.bodyMarkdown, /Waitlist: Q4, after no-show fees\. \(BOK-260\)/);
  assert.doesNotMatch(page.bodyMarkdown, /No-show fees: Q4\. A card/);
  // Two paragraphs in, two paragraphs out: the lines are not on one line.
  assert.doesNotMatch(page.bodyMarkdown, /\(BOK-300\) Waitlist/);
});
