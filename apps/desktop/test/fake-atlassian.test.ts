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
const SITE = 'https://tavla.atlassian.net';

const CREDS = { siteUrl: SITE, email: 'demo@tavla.example', apiToken: 'demo' };

const TICKETS: ExternalContainer = { kind: 'ticket', id: 'PAY', name: 'Payments' };
const PAGES: ExternalContainer = { kind: 'wikipage', id: 'PRODUCT', name: 'Product' };

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

test('listContainers returns the PAY project and the Product space', async () => {
  const containers = await connectorFor(fake()).listContainers();
  assert.deepEqual(
    containers.map((c) => `${c.kind}:${c.id}`),
    ['ticket:PAY', 'wikipage:PRODUCT'],
  );
});

test('a full ticket pull returns the cast, oldest first, with state categories', async () => {
  const pull = await connectorFor(fake()).pullChanges(TICKETS, null);
  assert.deepEqual(
    pull.changes.map((c) => c.external_id),
    ['PAY-148', 'PAY-165', 'PAY-167', 'PAY-156', 'PAY-161', 'PAY-142'],
  );
  const byKey = new Map(pull.changes.map((c) => [c.external_id, c]));
  assert.equal(byKey.get('PAY-142')?.kind === 'ticket' && byKey.get('PAY-142')?.state, 'Blocked');
  const categories = pull.changes.map((c) => (c.kind === 'ticket' ? c.state_category : ''));
  assert.deepEqual(categories, ['done', 'open', 'open', 'done', 'in_progress', 'blocked']);
  assert.equal(pull.highWaterMark, '2026-07-16T15:40:00Z');
});

test('a ticket fetch carries description, comments and the blocks link', async () => {
  const item = await connectorFor(fake()).fetchFull('ticket', 'PAY-142');
  assert.equal(item.title, 'SAML SSO (epic)');
  assert.match(item.bodyMarkdown, /SAML SSO against customer IdPs via WorkOS/);
  assert.match(item.bodyMarkdown, /Scoped per sprint planning/);
  assert.deepEqual(item.kind === 'ticket' ? item.links : [], [
    { type: 'blocks', key: 'PAY-161', reversed: true },
  ]);
  const child = await connectorFor(fake()).fetchFull('ticket', 'PAY-156');
  assert.equal(child.kind === 'ticket' ? child.parentKey : '', 'PAY-142');
});

test('a full page pull returns both wikipages with their versions', async () => {
  const connector = connectorFor(fake());
  const pull = await connector.pullChanges(PAGES, null);
  assert.deepEqual(
    pull.changes.map((c) => `${c.external_id}:${c.kind === 'wikipage' ? c.version : ''}`),
    ['910231:12', '18350081:41'],
  );
  const page = await connector.fetchFull('wikipage', '910231');
  assert.equal(page.title, 'Enterprise Onboarding');
  assert.equal(page.url, `${SITE}/wiki/spaces/PRODUCT/pages/910231`);
  assert.match(page.bodyMarkdown, /SCIM provisioning ships in Q2/);
});

test('an incremental pull with a fresh mark returns nothing', async () => {
  const connector = connectorFor(fake());
  const mark = new Date().toISOString();
  assert.deepEqual((await connector.pullChanges(TICKETS, mark)).changes, []);
  assert.deepEqual((await connector.pullChanges(PAGES, mark)).changes, []);
});

test('dates slide by the demo offset', async () => {
  const pull = await connectorFor(fake(10)).pullChanges(TICKETS, null);
  const epic = pull.changes.find((c) => c.external_id === 'PAY-142');
  assert.equal(epic?.remote_updated, '2026-07-26T15:40:00Z');
});

test('tracked keys pull by id, unknown keys drop out', async () => {
  const changes = await connectorFor(fake()).pullByKeys('ticket', [
    'PAY-161',
    'PAY-142',
    'PAY-999',
  ]);
  assert.deepEqual(
    changes.map((c) => c.external_id),
    ['PAY-161', 'PAY-142'],
  );
});

test('a created ticket gets the next key and turns up in a pull', async () => {
  const f = fake();
  const connector = connectorFor(f);
  const out = await connector.execute({
    provider: 'jira',
    system: 'jira',
    action: 'create_ticket',
    container: 'PAY',
    title: 'SCIM group-mapping for Nordkap',
    body: 'Map IdP groups to roles at sign-in.',
    rationale: 'Agreed in the after-meeting session.',
  });
  assert.equal(out.externalId, 'PAY-168');
  assert.equal(out.url, `${SITE}/browse/PAY-168`);

  const pull = await connector.pullChanges(TICKETS, null);
  const created = pull.changes.find((c) => c.external_id === 'PAY-168');
  assert.equal(created?.title, 'SCIM group-mapping for Nordkap');
  assert.equal(created?.kind === 'ticket' && created.state_category, 'open');

  // The write persisted, so a relaunch of the fake still has it.
  const item = await connectorFor(f).fetchFull('ticket', 'PAY-168');
  assert.match(item.bodyMarkdown, /Map IdP groups to roles at sign-in\./);
});

test('a comment lands on the ticket thread', async () => {
  const connector = connectorFor(fake());
  const out = await connector.execute({
    provider: 'jira',
    system: 'jira',
    action: 'comment_ticket',
    targetId: 'PAY-161',
    body: 'Nordkap go-live moved to next week.',
    rationale: 'Decided in the steering meeting.',
  });
  assert.equal(out.externalId, 'PAY-161');
  const item = await connector.fetchFull('ticket', 'PAY-161');
  assert.match(item.bodyMarkdown, /Nordkap go-live moved to next week\./);
});

test('a page update bumps the version and a stale version is refused', async () => {
  const f = fake();
  const connector = connectorFor(f);
  await connector.execute({
    provider: 'confluence',
    system: 'confluence',
    action: 'update_page',
    targetId: '910231',
    body: '## Status\n\nSCIM is deferred to Q3.',
    provenance: 'Source: decisions/2026-04-15-defer-scim-to-q3',
    rationale: 'The page still describes the pre-deferral plan.',
  });
  const page = await connector.fetchFull('wikipage', '910231');
  assert.equal(page.kind === 'wikipage' ? page.version : 0, 13);
  assert.match(page.bodyMarkdown, /SCIM is deferred to Q3\./);

  const stale = await f.fetchImpl(`${SITE}/wiki/api/v2/pages/910231`, {
    method: 'PUT',
    body: JSON.stringify({
      id: '910231',
      status: 'current',
      title: 'Enterprise Onboarding',
      body: { representation: 'storage', value: '<p>stale</p>' },
      version: { number: 13 },
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
    container: 'PAY',
    title: 'Thrown away by reset',
    body: 'Temporary.',
    rationale: 'Testing reset.',
  });
  assert.equal((await connectorFor(f).pullChanges(TICKETS, null)).changes.length, 7);
  f.reset();
  const after = await connectorFor(f).pullChanges(TICKETS, null);
  assert.equal(after.changes.length, 6);
  assert.equal(
    after.changes.some((c) => c.external_id === 'PAY-168'),
    false,
  );
});

test('a scripted step moves the tracker and the next pull sees it', async () => {
  const f = fake();
  assert.deepEqual(f.steps(), [{ id: 'pay-161-done', label: 'PAY-161 goes Done', applied: false }]);
  assert.equal(f.applyStep('no-such-step'), false);
  assert.equal(f.applyStep('pay-161-done'), true);
  // Applying twice would double the comment.
  assert.equal(f.applyStep('pay-161-done'), false);
  assert.equal(f.steps()[0]?.applied, true);

  const connector = connectorFor(f);
  const pull = await connector.pullChanges(TICKETS, null);
  const done = pull.changes.find((c) => c.external_id === 'PAY-161');
  assert.equal(done?.kind === 'ticket' && done.state, 'Done');
  assert.equal(done?.kind === 'ticket' && done.state_category, 'done');
  // The step lands last, so it is the new high-water mark.
  assert.equal(pull.changes.at(-1)?.external_id, 'PAY-161');
  const item = await connector.fetchFull('ticket', 'PAY-161');
  assert.match(item.bodyMarkdown, /Okta regression pair passed too\./);
});

test('the footprint survey finds the project and the space', async () => {
  // Slide the cast onto today, or the survey's 90-day window would age out.
  const offset = Math.round((Date.now() - Date.parse('2026-07-17T00:00:00Z')) / 86_400_000);
  const footprint = await connectorFor(fake(offset)).surveyFootprint();
  const tickets = footprint.find((f) => f.kind === 'ticket');
  assert.equal(tickets?.id, 'PAY');
  assert.equal(tickets?.count, 6);
  const pages = footprint.find((f) => f.kind === 'wikipage');
  assert.equal(pages?.id, 'PRODUCT');
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
    steps: unknown[];
  };
  assert.equal(fixture.anchor, '2026-07-17');
  assert.equal(fixture.siteUrl, SITE);
  assert.equal(fixture.projects.length, 1);
  assert.equal(fixture.spaces.length, 1);
  assert.equal(fixture.steps.length, 1);
  assert.deepEqual(
    fixture.issues.map((i) => i.key),
    ['PAY-142', 'PAY-148', 'PAY-156', 'PAY-161', 'PAY-165', 'PAY-167'],
  );
  // Every ticket carries its one area label (the conventions skill names it).
  assert.equal(
    fixture.issues.every((i) => i.labels.length === 1),
    true,
  );
  assert.deepEqual(
    fixture.pages.map((p) => p.id),
    ['910231', '18350081'],
  );
  assert.match(fixture.pages[0]?.body ?? '', /^<h2>Provisioning<\/h2>/);
});
