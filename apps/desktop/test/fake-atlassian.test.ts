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
const SITE = 'https://rota.atlassian.net';

const CREDS = { siteUrl: SITE, email: 'demo@rota.example', apiToken: 'demo' };

const TICKETS: ExternalContainer = { kind: 'ticket', id: 'SCH', name: 'Scheduling' };
const PAGES: ExternalContainer = { kind: 'wikipage', id: 'PROD', name: 'Product' };

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
    ['ticket:SCH', 'ticket:APP', 'ticket:PLT', 'wikipage:PROD'],
  );
});

test('a full ticket pull returns the cast, oldest first, with state categories', async () => {
  const pull = await connectorFor(fake()).pullChanges(TICKETS, null);
  assert.deepEqual(
    pull.changes.map((c) => c.external_id),
    ['SCH-121', 'SCH-232', 'SCH-236', 'SCH-118', 'SCH-240', 'SCH-125', 'SCH-231'],
  );
  const byKey = new Map(pull.changes.map((c) => [c.external_id, c]));
  assert.equal(
    byKey.get('SCH-231')?.kind === 'ticket' && byKey.get('SCH-231')?.state,
    'In Progress',
  );
  const categories = pull.changes.map((c) => (c.kind === 'ticket' ? c.state_category : ''));
  assert.deepEqual(categories, [
    'done',
    'done',
    'done',
    'in_progress',
    'in_progress',
    'in_progress',
    'in_progress',
  ]);
  assert.equal(pull.highWaterMark, '2026-07-15T14:20:00Z');
});

test('a ticket fetch carries description, comments and the blocks link', async () => {
  const item = await connectorFor(fake()).fetchFull('ticket', 'SCH-125');
  assert.equal(item.title, 'Fortnox connector');
  assert.match(item.bodyMarkdown, /Push approved hours straight into Fortnox/);
  assert.match(item.bodyMarkdown, /Mapping and the push work against the Fortnox sandbox/);
  assert.deepEqual(item.kind === 'ticket' ? item.links : [], [
    { type: 'blocks', key: 'PLT-77', reversed: true },
  ]);
  assert.equal(item.kind === 'ticket' ? item.parentKey : '', 'SCH-118');
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
  assert.match(page.bodyMarkdown, /First: payroll export \(Fortnox first\), in Q3\./);
});

test('an incremental pull with a fresh mark returns nothing', async () => {
  const connector = connectorFor(fake());
  const mark = new Date().toISOString();
  assert.deepEqual((await connector.pullChanges(TICKETS, mark)).changes, []);
  assert.deepEqual((await connector.pullChanges(PAGES, mark)).changes, []);
});

test('dates slide by the demo offset', async () => {
  const pull = await connectorFor(fake(10)).pullChanges(TICKETS, null);
  const epic = pull.changes.find((c) => c.external_id === 'SCH-231');
  assert.equal(epic?.remote_updated, '2026-07-25T14:20:00Z');
});

test('tracked keys pull by id, unknown keys drop out', async () => {
  const changes = await connectorFor(fake()).pullByKeys('ticket', [
    'SCH-125',
    'SCH-231',
    'SCH-999',
  ]);
  assert.deepEqual(
    changes.map((c) => c.external_id),
    ['SCH-125', 'SCH-231'],
  );
});

test('a created ticket gets the next key and turns up in a pull', async () => {
  const f = fake();
  const connector = connectorFor(f);
  const out = await connector.execute({
    provider: 'jira',
    system: 'jira',
    action: 'create_ticket',
    container: 'SCH',
    title: 'Notify the affected colleague of a swap request',
    body: 'Send the colleague a notification when a swap request names them.',
    rationale: 'Agreed in the steering meeting.',
  });
  assert.equal(out.externalId, 'SCH-241');
  assert.equal(out.url, `${SITE}/browse/SCH-241`);

  const pull = await connector.pullChanges(TICKETS, null);
  const created = pull.changes.find((c) => c.external_id === 'SCH-241');
  assert.equal(created?.title, 'Notify the affected colleague of a swap request');
  assert.equal(created?.kind === 'ticket' && created.state_category, 'open');

  // The write persisted, so a relaunch of the fake still has it.
  const item = await connectorFor(f).fetchFull('ticket', 'SCH-241');
  assert.match(
    item.bodyMarkdown,
    /Send the colleague a notification when a swap request names them\./,
  );
});

test('a comment lands on the ticket thread', async () => {
  const connector = connectorFor(fake());
  const out = await connector.execute({
    provider: 'jira',
    system: 'jira',
    action: 'comment_ticket',
    targetId: 'SCH-118',
    body: 'Payroll export moves to Q1 after the steering call.',
    rationale: 'Decided in the steering meeting.',
  });
  assert.equal(out.externalId, 'SCH-118');
  const item = await connector.fetchFull('ticket', 'SCH-118');
  assert.match(item.bodyMarkdown, /Payroll export moves to Q1 after the steering call\./);
});

test('a page update bumps the version and a stale version is refused', async () => {
  const f = fake();
  const connector = connectorFor(f);
  await connector.execute({
    provider: 'confluence',
    system: 'confluence',
    action: 'update_page',
    targetId: '4521985',
    body: '## Committed\n\nShift swaps ship before payroll export.',
    provenance: 'Source: decisions/2026-07-16-swaps-before-payroll-export',
    rationale: 'The page still describes the old H2 order.',
  });
  const page = await connector.fetchFull('wikipage', '4521985');
  assert.equal(page.kind === 'wikipage' ? page.version : 0, 18);
  assert.match(page.bodyMarkdown, /Shift swaps ship before payroll export\./);

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
    container: 'SCH',
    title: 'Thrown away by reset',
    body: 'Temporary.',
    rationale: 'Testing reset.',
  });
  assert.equal((await connectorFor(f).pullChanges(TICKETS, null)).changes.length, 8);
  f.reset();
  const after = await connectorFor(f).pullChanges(TICKETS, null);
  assert.equal(after.changes.length, 7);
  assert.equal(
    after.changes.some((c) => c.external_id === 'SCH-241'),
    false,
  );
});

test('the footprint survey finds the project and the space', async () => {
  // Slide the cast onto today, or the survey's 90-day window would age out.
  const offset = Math.round((Date.now() - Date.parse('2026-07-17T00:00:00Z')) / 86_400_000);
  const footprint = await connectorFor(fake(offset)).surveyFootprint();
  const tickets = footprint.find((f) => f.kind === 'ticket');
  assert.equal(tickets?.id, 'SCH');
  assert.equal(tickets?.count, 7);
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
      'APP-54',
      'PLT-77',
      'PLT-80',
      'SCH-118',
      'SCH-121',
      'SCH-125',
      'SCH-231',
      'SCH-232',
      'SCH-236',
      'SCH-240',
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
  assert.match(fixture.pages[0]?.body ?? '', /^<h1>Roadmap H2<\/h1>/);
});

test('a patch that spans two paragraphs lands, and stays two paragraphs', async () => {
  const f = fake();
  const connector = connectorFor(f);
  // The exact edit Flow 1 drafts: the two order lines are two paragraphs in
  // storage, with no whitespace between them, only `</p><p>`.
  await connector.execute({
    provider: 'confluence',
    system: 'confluence',
    action: 'update_page',
    targetId: '4521985',
    body: 'The H2 order after the steering call.',
    patch: {
      search: 'First: payroll export (Fortnox first), in Q3.\n\nThen: shift swaps, in Q4.',
      replace: 'First: shift swaps, in Q3 and Q4.\n\nThen: payroll export (Fortnox first), in Q1.',
    },
    provenance: 'Source: decisions/2026-07-16-h2-order-swaps-first',
    rationale: 'The steering call flipped the order.',
  });
  const page = await connector.fetchFull('wikipage', '4521985');
  assert.match(page.bodyMarkdown, /First: shift swaps, in Q3 and Q4\./);
  assert.match(page.bodyMarkdown, /Then: payroll export \(Fortnox first\), in Q1\./);
  assert.doesNotMatch(page.bodyMarkdown, /payroll export \(Fortnox first\), in Q3/);
  // Two paragraphs in, two paragraphs out: the lines are not on one line.
  assert.doesNotMatch(page.bodyMarkdown, /Q4\. Then: payroll/);
});
