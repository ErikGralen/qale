import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { atlassianConnector, mapJiraStateCategory, type FetchLike } from '../src/index.js';
import { makeFetch, type Route } from './fetch-fixture.js';

/**
 * Connector tests against recorded fixtures — no live credentials, no network.
 * The fake fetch serves fixture JSON by URL pattern and records every request,
 * so tests assert both the mapping AND the wire shape. Query strings are
 * asserted as EXACT full JQL/CQL — a substring check once let a missing `AND`
 * ship green.
 */

const fx = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const misc = fx('misc') as Record<string, unknown>;

const SITE = 'https://tavla.atlassian.net';
const CLOUD_ID = '11223344-5566-7788-99aa-bbccddeeff00';
const AUTH = { siteUrl: SITE, email: 'erik@tavla.example', apiToken: 'tok-123' };

/** Routes for a healthy unscoped-token site — the probe checks BOTH products. */
const unscopedProbe: Route[] = [
  { url: `${SITE}/rest/api/3/myself`, json: misc['myself'] },
  { url: `${SITE}/wiki/rest/api/space`, json: { results: [] } },
];

test('verifyAuth: unscoped token authenticates against the site directly, both products probed', async () => {
  const { fetchImpl } = makeFetch(unscopedProbe);
  const c = atlassianConnector.create(AUTH, { fetchImpl });
  const r = await c.verifyAuth();
  assert.equal(r.ok, true);
  assert.equal(r.health, 'ok');
  assert.equal(r.site?.detail?.['tokenKind'], 'unscoped');
  assert.equal(r.identity?.displayName, 'Erik Gralén');
  assert.deepEqual(r.products, { jira: 'ok', confluence: 'ok' });
});

test('verifyAuth: scoped token falls back to the api.atlassian.com gateway via tenant_info', async () => {
  const { fetchImpl, calls } = makeFetch([
    { url: `${SITE}/rest/api/3/myself`, status: 401 },
    { url: `${SITE}/wiki/rest/api/space`, status: 401 },
    { url: `${SITE}/_edge/tenant_info`, json: misc['tenantInfo'] },
    {
      url: `https://api.atlassian.com/ex/jira/${CLOUD_ID}/rest/api/3/myself`,
      json: misc['myself'],
    },
    {
      url: `https://api.atlassian.com/ex/confluence/${CLOUD_ID}/wiki/rest/api/space`,
      json: { results: [] },
    },
    {
      url: `https://api.atlassian.com/ex/jira/${CLOUD_ID}/rest/api/3/project/search`,
      json: misc['projects'],
    },
    {
      url: `https://api.atlassian.com/ex/confluence/${CLOUD_ID}/wiki/api/v2/spaces`,
      json: misc['spaces'],
    },
  ]);
  const c = atlassianConnector.create(AUTH, { fetchImpl });
  const r = await c.verifyAuth();
  assert.equal(r.ok, true);
  assert.equal(r.site?.detail?.['tokenKind'], 'scoped');
  assert.equal(r.site?.detail?.['cloudId'], CLOUD_ID);
  assert.deepEqual(r.products, { jira: 'ok', confluence: 'ok' });

  // Subsequent data calls must route through the gateway, not the site.
  const containers = await c.listContainers();
  assert.deepEqual(containers, [
    { kind: 'ticket', id: 'PAY', name: 'Payments' },
    { kind: 'ticket', id: 'CORE', name: 'Core Platform' },
    { kind: 'wikipage', id: 'PROD', name: 'Product' },
  ]);
  const dataCalls = calls.filter(
    (x) => x.url.includes('project/search') || x.url.includes('/wiki/api/v2/spaces'),
  );
  assert.equal(dataCalls.length, 2);
  for (const call of dataCalls)
    assert.ok(call.url.startsWith('https://api.atlassian.com/'), call.url);
});

test('verifyAuth: token valid for ONE product only → overall ok with per-product detail', async () => {
  // A Confluence-only token is a working connection, not an expired one.
  const { fetchImpl } = makeFetch([
    { url: `${SITE}/rest/api/3/myself`, status: 401 },
    { url: `${SITE}/wiki/rest/api/space`, json: { results: [] } },
  ]);
  const r = await atlassianConnector.create(AUTH, { fetchImpl }).verifyAuth();
  assert.equal(r.ok, true);
  assert.equal(r.health, 'ok');
  assert.deepEqual(r.products, { jira: 'auth-expired', confluence: 'ok' });
  assert.equal(r.identity, undefined); // /myself never authenticated
});

test('verifyAuth: rejected credentials on both paths → auth-expired, not unreachable', async () => {
  const { fetchImpl } = makeFetch([
    { url: `${SITE}/rest/api/3/myself`, status: 401 },
    { url: `${SITE}/wiki/rest/api/space`, status: 401 },
    { url: `${SITE}/_edge/tenant_info`, json: misc['tenantInfo'] },
    { url: `https://api.atlassian.com/ex/jira/${CLOUD_ID}/rest/api/3/myself`, status: 401 },
    { url: `https://api.atlassian.com/ex/confluence/${CLOUD_ID}/wiki/rest/api/space`, status: 401 },
  ]);
  const r = await atlassianConnector.create(AUTH, { fetchImpl }).verifyAuth();
  assert.equal(r.ok, false);
  assert.equal(r.health, 'auth-expired');
  assert.deepEqual(r.products, { jira: 'auth-expired', confluence: 'auth-expired' });
});

test('verifyAuth: network failure → unreachable, never auth-expired', async () => {
  const { fetchImpl } = makeFetch([{ url: SITE, throws: true }]);
  const r = await atlassianConnector.create(AUTH, { fetchImpl }).verifyAuth();
  assert.equal(r.ok, false);
  assert.equal(r.health, 'unreachable');
});

test('verifyAuth: a 429 during probing waits per Retry-After and retries once', async () => {
  const { fetchImpl, calls } = makeFetch([
    {
      url: `${SITE}/rest/api/3/myself`,
      seq: [{ status: 429, headers: { 'Retry-After': '0' } }, { json: misc['myself'] }],
    },
    { url: `${SITE}/wiki/rest/api/space`, status: 401 },
  ]);
  const r = await atlassianConnector.create(AUTH, { fetchImpl }).verifyAuth();
  assert.equal(r.ok, true);
  assert.equal(r.identity?.displayName, 'Erik Gralén');
  assert.equal(calls.filter((x) => x.url.includes('/rest/api/3/myself')).length, 2);
});

test('verifyAuth: throttled even after the retry → soft ok, NEVER auth-expired/unreachable', async () => {
  const throttle = { seq: [{ status: 429, headers: { 'Retry-After': '0' } }] };
  const { fetchImpl } = makeFetch([
    { url: `${SITE}/rest/api/3/myself`, ...throttle },
    { url: `${SITE}/wiki/rest/api/space`, ...throttle },
  ]);
  const r = await atlassianConnector.create(AUTH, { fetchImpl }).verifyAuth();
  // The server IS answering and never judged the token; ok is the least-
  // alarming honest state — the next probe re-judges for real.
  assert.equal(r.ok, true);
  assert.equal(r.health, 'ok');
  assert.deepEqual(r.products, { jira: 'ok', confluence: 'ok' });
});

test('pullChanges(ticket): incremental JQL is EXACT (clauses ANDed), mapping + high-water mark', async () => {
  const { fetchImpl, calls } = makeFetch([
    ...unscopedProbe,
    { url: '/rest/api/3/search/jql', method: 'POST', json: fx('jira-search') },
  ]);
  const c = atlassianConnector.create(AUTH, { fetchImpl });
  const now = Date.parse('2026-07-22T08:00:00Z');
  const r = await c.pullChanges(
    { kind: 'ticket', id: 'PAY', name: 'Payments' },
    '2026-07-22T07:27:00Z',
    { now },
  );

  const search = calls.find((x) => x.url.includes('/search/jql'))!;
  // 33 minutes since the mark + 5 slack — relative window, timezone-proof.
  assert.equal(
    (search.body as { jql: string }).jql,
    'project = "PAY" AND updated >= "-38m" ORDER BY updated ASC',
  );

  assert.equal(r.changes.length, 4);
  const byKey = Object.fromEntries(r.changes.map((ch) => [ch.external_id, ch]));
  assert.equal(byKey['PAY-140']!.state_category, 'open'); // statusCategory new
  assert.equal(byKey['PAY-156']!.state_category, 'done');
  assert.equal(byKey['PAY-142']!.state_category, 'blocked'); // label beats indeterminate
  assert.equal(byKey['PAY-161']!.state_category, 'in_progress');
  assert.equal(byKey['PAY-161']!.state, 'Väntar på granskning'); // raw label verbatim
  assert.equal(byKey['PAY-142']!.url, `${SITE}/browse/PAY-142`);
  assert.equal(r.highWaterMark, '2026-07-21T17:22:00.000+0200'); // newest updated seen
});

test('pullChanges(ticket): first sync (null mark) pulls without a window clause', async () => {
  const { fetchImpl, calls } = makeFetch([
    ...unscopedProbe,
    { url: '/rest/api/3/search/jql', method: 'POST', json: fx('jira-search') },
  ]);
  const c = atlassianConnector.create(AUTH, { fetchImpl });
  await c.pullChanges({ kind: 'ticket', id: 'PAY', name: 'Payments' }, null);
  const jql = (calls.find((x) => x.url.includes('/search/jql'))!.body as { jql: string }).jql;
  assert.equal(jql, 'project = "PAY" ORDER BY updated ASC');
});

test('pullChanges(ticket): an UNPARSEABLE high-water mark means full re-pull, not a dead window', async () => {
  // A zero-ish window would match nothing forever and re-persist the corrupt mark.
  const { fetchImpl, calls } = makeFetch([
    ...unscopedProbe,
    { url: '/rest/api/3/search/jql', method: 'POST', json: fx('jira-search') },
  ]);
  const c = atlassianConnector.create(AUTH, { fetchImpl });
  const r = await c.pullChanges({ kind: 'ticket', id: 'PAY', name: 'Payments' }, 'corrupted-mark');
  const jql = (calls.find((x) => x.url.includes('/search/jql'))!.body as { jql: string }).jql;
  assert.equal(jql, 'project = "PAY" ORDER BY updated ASC');
  assert.equal(r.highWaterMark, '2026-07-21T17:22:00.000+0200'); // mark heals from the pull
});

test('pullChanges(ticket): container ids are escaped inside the JQL string literal', async () => {
  const { fetchImpl, calls } = makeFetch([
    ...unscopedProbe,
    { url: '/rest/api/3/search/jql', method: 'POST', json: { issues: [] } },
  ]);
  const c = atlassianConnector.create(AUTH, { fetchImpl });
  await c.pullChanges({ kind: 'ticket', id: 'PA"Y\\', name: 'Odd' }, null);
  const jql = (calls.find((x) => x.url.includes('/search/jql'))!.body as { jql: string }).jql;
  assert.equal(jql, 'project = "PA\\"Y\\\\" ORDER BY updated ASC');
});

test('pullChanges(wikipage): EXACT CQL by space with version + last-modified mapping', async () => {
  const { fetchImpl, calls } = makeFetch([
    ...unscopedProbe,
    { url: '/wiki/rest/api/search', json: fx('confluence-search') },
  ]);
  const c = atlassianConnector.create(AUTH, { fetchImpl });
  const now = Date.parse('2026-07-22T08:00:00Z');
  const r = await c.pullChanges(
    { kind: 'wikipage', id: 'PROD', name: 'Product' },
    '2026-07-22T06:00:00Z',
    { now },
  );

  const url = new URL(calls.find((x) => x.url.includes('/wiki/rest/api/search'))!.url);
  assert.equal(
    url.searchParams.get('cql'),
    'space = "PROD" AND type = page AND lastmodified > now("-125m") ORDER BY lastmodified ASC',
  );
  assert.equal(url.searchParams.get('expand'), 'content.version');
  assert.equal(url.searchParams.get('start'), '0');

  assert.equal(r.changes.length, 2);
  const page = r.changes[0]!;
  assert.equal(page.kind, 'wikipage');
  assert.equal(page.external_id, '98342');
  assert.equal(page.kind === 'wikipage' && page.version, 17);
  assert.equal(page.url, `${SITE}/wiki/spaces/PROD/pages/98342/Enterprise+Onboarding`);
  assert.equal(r.highWaterMark, '2026-07-21T11:05:00.000+0200');
});

test('fetchFull(ticket): description + recent comments as chronological markdown', async () => {
  const { fetchImpl } = makeFetch([
    ...unscopedProbe,
    { url: '/rest/api/3/issue/PAY-142/comment', json: fx('jira-comments') },
    { url: '/rest/api/3/issue/PAY-142', json: fx('jira-issue') },
  ]);
  const c = atlassianConnector.create(AUTH, { fetchImpl });
  const full = await c.fetchFull('ticket', 'PAY-142');

  assert.equal(full.external_id, 'PAY-142');
  assert.equal(full.state_category, 'blocked');
  assert.equal(full.remote_updated, '2026-07-21T14:03:00.000+0200');
  assert.ok(full.bodyMarkdown.includes('## Goal'));
  assert.ok(full.bodyMarkdown.includes('- IdP-initiated flow'));
  assert.ok(full.bodyMarkdown.includes('## Recent comments'));
  assert.ok(!full.bodyMarkdown.includes('not mirrored')); // all 2 of 2 shown — no truncation line
  // API returns newest-first; the note reads oldest-first.
  const jonas = full.bodyMarkdown.indexOf('Jonas Ek');
  const mika = full.bodyMarkdown.indexOf('Mika Ranta');
  assert.ok(jonas !== -1 && mika !== -1 && jonas < mika, 'comments should read chronologically');
});

test('fetchFull(ticket): a long thread discloses how many earlier comments are not mirrored', async () => {
  const comments = fx('jira-comments') as { comments: unknown[] };
  const { fetchImpl } = makeFetch([
    ...unscopedProbe,
    { url: '/rest/api/3/issue/PAY-142/comment', json: { ...comments, total: 12 } },
    { url: '/rest/api/3/issue/PAY-142', json: fx('jira-issue') },
  ]);
  const c = atlassianConnector.create(AUTH, { fetchImpl });
  const full = await c.fetchFull('ticket', 'PAY-142');
  const marker = '_10 earlier comments not mirrored — open the ticket for the full thread._';
  const at = full.bodyMarkdown.indexOf(marker);
  assert.ok(at !== -1, full.bodyMarkdown);
  // The disclosure leads the comment block — a reader must see it before any comment.
  assert.ok(at < full.bodyMarkdown.indexOf('Jonas Ek'));
});

test('fetchFull(wikipage): storage XHTML → markdown with version + remote_updated', async () => {
  const { fetchImpl } = makeFetch([
    ...unscopedProbe,
    { url: '/wiki/api/v2/pages/98342', json: fx('confluence-page') },
  ]);
  const c = atlassianConnector.create(AUTH, { fetchImpl });
  const full = await c.fetchFull('wikipage', '98342');

  assert.equal(full.title, 'Enterprise Onboarding');
  assert.equal(full.version, 17);
  assert.equal(full.remote_updated, '2026-07-18T07:12:00Z');
  assert.ok(full.bodyMarkdown.includes('SCIM ships in Q2'));
  assert.ok(/[-*]\s+SAML metadata exchange/.test(full.bodyMarkdown), full.bodyMarkdown);
});

test('fetchFull(wikipage): Confluence code macros survive the markdown conversion', async () => {
  const { fetchImpl } = makeFetch([
    ...unscopedProbe,
    {
      url: '/wiki/api/v2/pages/555',
      json: {
        id: '555',
        title: 'Runbook',
        version: { number: 2, createdAt: '2026-07-18T07:12:00Z' },
        _links: { webui: '/spaces/PROD/pages/555/Runbook' },
        body: {
          storage: {
            value:
              '<p>Deploy:</p><ac:structured-macro ac:name="code" ac:schema-version="1">' +
              '<ac:parameter ac:name="language">bash</ac:parameter>' +
              '<ac:plain-text-body><![CDATA[helm upgrade tavla --set replicas=3]]></ac:plain-text-body>' +
              '</ac:structured-macro>',
          },
        },
      },
    },
  ]);
  const c = atlassianConnector.create(AUTH, { fetchImpl });
  const full = await c.fetchFull('wikipage', '555');
  assert.ok(full.bodyMarkdown.includes('helm upgrade tavla --set replicas=3'), full.bodyMarkdown);
});

test('mapStateCategory: done beats the blocked-label heuristic', () => {
  // "Closed — Blocked" is a resolved ticket whose name remembers why it stalled.
  assert.equal(mapJiraStateCategory('Closed — Blocked', 'done'), 'done');
  assert.equal(mapJiraStateCategory('Blocked', 'indeterminate'), 'blocked');
  assert.equal(mapJiraStateCategory('Waiting for review', 'indeterminate'), 'in_progress');
  assert.equal(mapJiraStateCategory('Backlog', 'new'), 'open');
});

test('execute(create_ticket): posts ADF description, returns key + browse link', async () => {
  const { fetchImpl, calls } = makeFetch([
    ...unscopedProbe,
    { url: '/rest/api/3/issue', method: 'POST', json: misc['createIssue'] },
  ]);
  const c = atlassianConnector.create(AUTH, { fetchImpl });
  const r = await c.execute({
    provider: 'jira',
    action: 'create_ticket',
    container: 'PAY',
    title: 'SCIM group-mapping for Nordkap',
    body: 'Nordkap needs SCIM group-mapping before the September rollout.',
    rationale: 'agreed in the Jul 14 check-in',
  });
  assert.deepEqual(r, { externalId: 'PAY-201', url: `${SITE}/browse/PAY-201` });

  const post = calls.find((x) => x.method === 'POST' && x.url.endsWith('/rest/api/3/issue'))!;
  const fields = (post.body as { fields: Record<string, unknown> }).fields;
  assert.deepEqual(fields['project'], { key: 'PAY' });
  assert.equal((fields['description'] as { type: string }).type, 'doc'); // markdown → ADF
});

test('execute: LEGACY payload (system + add_comment) normalizes and still executes', async () => {
  const { fetchImpl } = makeFetch([
    ...unscopedProbe,
    { url: '/rest/api/3/issue/PAY-142/comment', method: 'POST', json: misc['createComment'] },
  ]);
  const c = atlassianConnector.create(AUTH, { fetchImpl });
  const r = await c.execute({
    system: 'jira',
    action: 'add_comment',
    issueKey: 'PAY-142',
    body: 'Nordkap confirms go-live Jul 28.',
    rationale: 'from the check-in',
  });
  assert.equal(r.externalId, 'PAY-142');
  assert.equal(r.url, `${SITE}/browse/PAY-142?focusedCommentId=5001`);
});

test('execute(update_page, no patch): appends the body + provenance, bumps the version', async () => {
  const { fetchImpl, calls } = makeFetch([
    ...unscopedProbe,
    { url: '/wiki/api/v2/pages/98342', method: 'PUT', json: misc['putPage'] },
    { url: '/wiki/api/v2/pages/98342', json: fx('confluence-page') },
  ]);
  const c = atlassianConnector.create(AUTH, { fetchImpl });
  const r = await c.execute({
    provider: 'confluence',
    action: 'update_page',
    targetId: '98342',
    body: '## Update\nSCIM deferred to Q3 per the Apr 15 decision.',
    provenance: 'Source: Nordkap check-in, Jul 14',
    rationale: 'page contradicts the SCIM deferral decision',
  });
  assert.equal(r.externalId, '98342');
  const put = calls.find((x) => x.method === 'PUT')!.body as {
    version: { number: number };
    body: { value: string };
  };
  assert.equal(put.version.number, 18); // 17 + 1
  assert.equal(
    put.body.value,
    '<h1>Enterprise Onboarding</h1><p>SCIM ships in Q2 together with SSO.</p>' +
      '<ul><li>SAML metadata exchange</li><li>Provisioning</li></ul>' +
      '<h3>Update</h3><p>SCIM deferred to Q3 per the Apr 15 decision.</p>' +
      '<p><em>Source: Nordkap check-in, Jul 14</em></p>',
  );
});

test('execute(update_page, patch): replaces the passage IN the storage XHTML — no append, no round-trip', async () => {
  const { fetchImpl, calls } = makeFetch([
    ...unscopedProbe,
    { url: '/wiki/api/v2/pages/98342', method: 'PUT', json: misc['putPage'] },
    { url: '/wiki/api/v2/pages/98342', json: fx('confluence-page') },
  ]);
  const c = atlassianConnector.create(AUTH, { fetchImpl });
  await c.execute({
    provider: 'confluence',
    action: 'update_page',
    targetId: '98342',
    body: 'SCIM ships in Q3 (deferred Apr 15).',
    patch: {
      search: 'SCIM ships in Q2 together with SSO.',
      replace: 'SCIM ships in Q3 (deferred Apr 15).',
    },
    provenance: 'Source: Decision — SCIM deferral, Apr 15',
    rationale: 'page contradicts the SCIM deferral decision',
  });
  const put = calls.find((x) => x.method === 'PUT')!.body as { body: { value: string } };
  assert.equal(
    put.body.value,
    '<h1>Enterprise Onboarding</h1><p>SCIM ships in Q3 (deferred Apr 15).</p>' +
      '<ul><li>SAML metadata exchange</li><li>Provisioning</li></ul>' +
      '<p><em>Source: Decision — SCIM deferral, Apr 15</em></p>',
  );
});

test('execute(update_page, patch): a passage the page no longer contains refuses in plain language', async () => {
  const { fetchImpl, calls } = makeFetch([
    ...unscopedProbe,
    { url: '/wiki/api/v2/pages/98342', json: fx('confluence-page') },
  ]);
  const c = atlassianConnector.create(AUTH, { fetchImpl });
  await assert.rejects(
    () =>
      c.execute({
        provider: 'confluence',
        action: 'update_page',
        targetId: '98342',
        body: 'x',
        patch: { search: 'A sentence that was edited away.', replace: 'y' },
        rationale: 'r',
      }),
    /passage this edit targets couldn't be found/,
  );
  assert.ok(!calls.some((x) => x.method === 'PUT'), 'must not PUT after a failed locate');
});

test('execute(update_page, patch): an ambiguous passage refuses rather than guess', async () => {
  const { fetchImpl, calls } = makeFetch([
    ...unscopedProbe,
    {
      url: '/wiki/api/v2/pages/777',
      json: {
        id: '777',
        title: 'Risks',
        version: { number: 3 },
        _links: { webui: '/spaces/PROD/pages/777/Risks' },
        body: { storage: { value: '<p>SCIM slips.</p><p>SCIM slips.</p>' } },
      },
    },
  ]);
  const c = atlassianConnector.create(AUTH, { fetchImpl });
  await assert.rejects(
    () =>
      c.execute({
        provider: 'confluence',
        action: 'update_page',
        targetId: '777',
        body: 'x',
        patch: { search: 'SCIM slips.', replace: 'SCIM holds.' },
        rationale: 'r',
      }),
    /more than once/,
  );
  assert.ok(!calls.some((x) => x.method === 'PUT'));
});

test('execute: actions this connector cannot perform are refused loudly', async () => {
  const { fetchImpl } = makeFetch(unscopedProbe);
  const c = atlassianConnector.create(AUTH, { fetchImpl });
  await assert.rejects(
    () =>
      c.execute({
        provider: 'google-calendar',
        action: 'create_event',
        title: 'Sync',
        start: '2026-08-24T15:00:00+02:00',
        body: 'b',
        rationale: 'r',
      }),
    /unsupported outbound action/,
  );
  await assert.rejects(
    () => c.execute({ provider: 'jira', action: 'create_ticket', body: 'b', rationale: 'r' }),
    /container/,
  );
});

test('data calls surface a failed probe as an error, and a later probe can recover', async () => {
  let failing = true;
  const inner = makeFetch(unscopedProbe);
  const flaky: FetchLike = (url, init) => {
    if (failing) throw new TypeError('fetch failed');
    return inner.fetchImpl(url, init);
  };
  const c = atlassianConnector.create(AUTH, { fetchImpl: flaky });
  await assert.rejects(() => c.listContainers(), /could not reach/);
  failing = false;
  // The failed probe was not cached; the connection heals without a re-create.
  const r = await c.verifyAuth();
  assert.equal(r.health, 'ok');
});

// ---------------------------------------------------------------------------
// pullByKeys — tracked items, held by id across container boundaries
// ---------------------------------------------------------------------------

/** Two issues in DIFFERENT projects: the point of pulling by key at all. */
const crossProject = {
  issues: [
    {
      key: 'PAY-142',
      fields: {
        summary: 'SAML SSO (epic)',
        status: { name: 'Blocked', statusCategory: { key: 'indeterminate' } },
        assignee: { displayName: 'Mika Ranta' },
        updated: '2026-07-21T14:03:00.000+0200',
      },
    },
    {
      key: 'INFRA-88',
      fields: {
        summary: 'Ingress cert rotation',
        status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
        assignee: { displayName: 'Tove Ahl' },
        updated: '2026-07-22T07:10:00.000+0200',
      },
    },
  ],
};

test('pullByKeys(ticket): EXACT key-in JQL, container inferred from the key prefix', async () => {
  const { fetchImpl, calls } = makeFetch([
    ...unscopedProbe,
    { url: '/rest/api/3/search/jql', method: 'POST', json: crossProject },
  ]);
  const c = atlassianConnector.create(AUTH, { fetchImpl });
  const changes = await c.pullByKeys!('ticket', ['PAY-142', 'INFRA-88']);

  const jql = (calls.find((x) => x.url.includes('/search/jql'))!.body as { jql: string }).jql;
  assert.equal(jql, 'key in ("PAY-142", "INFRA-88") ORDER BY updated ASC');

  // The search payload never says which project an issue came from; the key does.
  assert.deepEqual(
    changes.map((ch) => [ch.external_id, ch.container]),
    [
      ['PAY-142', 'PAY'],
      ['INFRA-88', 'INFRA'],
    ],
  );
  assert.equal(changes[1]!.kind === 'ticket' && changes[1]!.state_category, 'in_progress');
});

test('pullByKeys(ticket): duplicates collapse and blanks are dropped before the query', async () => {
  const { fetchImpl, calls } = makeFetch([
    ...unscopedProbe,
    { url: '/rest/api/3/search/jql', method: 'POST', json: { issues: [] } },
  ]);
  const c = atlassianConnector.create(AUTH, { fetchImpl });
  await c.pullByKeys!('ticket', ['PAY-142', ' PAY-142 ', '', '   ']);
  const jql = (calls.find((x) => x.url.includes('/search/jql'))!.body as { jql: string }).jql;
  assert.equal(jql, 'key in ("PAY-142") ORDER BY updated ASC');
});

test('pullByKeys(ticket): an id Jira refuses (400) is isolated by halving — the good ones still return', async () => {
  // Jira rejects the WHOLE query for one unresolvable key. Without the split, a
  // single typo'd [[FOO-1]] in a note stops every tracked ticket from syncing.
  const search: Route = {
    url: '/rest/api/3/search/jql',
    method: 'POST',
    seq: [
      { status: 400, json: { errorMessages: ["The issue key 'FOO-1' does not exist"] } },
      { status: 400, json: { errorMessages: ["The issue key 'FOO-1' does not exist"] } },
      { json: { issues: [crossProject.issues[0]] } }, // PAY-142 alone
      { json: { issues: [] } }, // FOO-1 alone → dropped
      { json: { issues: [crossProject.issues[1]] } }, // INFRA-88 half
    ],
  };
  const { fetchImpl } = makeFetch([...unscopedProbe, search]);
  const c = atlassianConnector.create(AUTH, { fetchImpl });
  const changes = await c.pullByKeys!('ticket', ['PAY-142', 'FOO-1', 'INFRA-88']);
  assert.deepEqual(changes.map((ch) => ch.external_id).sort(), ['INFRA-88', 'PAY-142']);
});

test('pullByKeys(ticket): a NON-400 failure propagates instead of fanning out into a retry storm', async () => {
  const { fetchImpl, calls } = makeFetch([
    ...unscopedProbe,
    { url: '/rest/api/3/search/jql', method: 'POST', status: 503 },
  ]);
  const c = atlassianConnector.create(AUTH, { fetchImpl });
  await assert.rejects(() => c.pullByKeys!('ticket', ['PAY-142', 'INFRA-88', 'OPS-3']));
  // One attempt, not a halving cascade: an outage is about the connection, not the ids.
  assert.equal(calls.filter((x) => x.url.includes('/search/jql')).length, 1);
});

test('pullByKeys(wikipage): EXACT id-in CQL; container is left for the sync engine to keep', async () => {
  const { fetchImpl, calls } = makeFetch([
    ...unscopedProbe,
    { url: '/wiki/rest/api/search', json: fx('confluence-search') },
  ]);
  const c = atlassianConnector.create(AUTH, { fetchImpl });
  const changes = await c.pullByKeys!('wikipage', ['98342', '98410']);

  const url = new URL(calls.find((x) => x.url.includes('/wiki/rest/api/search'))!.url);
  assert.equal(url.searchParams.get('cql'), 'id in ("98342", "98410")');
  assert.equal(changes.length, 2);
  // Confluence search doesn't report the space, and we won't spend a request per
  // page to learn it — blank means "keep whatever you already recorded".
  assert.equal(changes[0]!.container, '');
  assert.equal(changes[0]!.kind === 'wikipage' && changes[0]!.version, 17);
});

test('pullByKeys: no ids and calendar kind never touch the network', async () => {
  const { fetchImpl, calls } = makeFetch([...unscopedProbe]);
  const c = atlassianConnector.create(AUTH, { fetchImpl });
  assert.deepEqual(await c.pullByKeys!('ticket', []), []);
  assert.deepEqual(await c.pullByKeys!('calendar', ['whatever']), []);
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// surveyFootprint (docs/product-understanding.md FL-1) — where the person works
// ---------------------------------------------------------------------------

/** A sampled Jira page: only the key and the update stamp matter to a survey. */
const surveyIssues = (rows: [key: string, updated: string][]): unknown => ({
  issues: rows.map(([key, updated]) => ({
    key,
    fields: { summary: key, status: { name: 'Open', statusCategory: { key: 'new' } }, updated },
  })),
  isLast: true,
});

/** A sampled Confluence page, with the space expand the survey asks for. */
const surveyPages = (rows: [space: string, when: string][], totalSize: number): unknown => ({
  totalSize,
  results: rows.map(([space, when], i) => ({
    content: {
      id: `p${i}`,
      title: `Page ${i}`,
      space: { key: space },
      version: { number: 1, when },
    },
  })),
});

test('surveyFootprint: EXACT currentUser() queries, and counts are the provider totals', async () => {
  const { fetchImpl, calls } = makeFetch([
    ...unscopedProbe,
    {
      url: '/rest/api/3/search/approximate-count',
      method: 'POST',
      seq: [{ json: { count: 41 } }, { json: { count: 3 } }],
    },
    {
      url: '/rest/api/3/search/jql',
      method: 'POST',
      json: surveyIssues([
        ['PAY-1', '2026-07-20T10:00:00.000+0200'],
        ['PAY-2', '2026-07-21T10:00:00.000+0200'],
        ['OPS-9', '2026-06-01T10:00:00.000+0200'],
      ]),
    },
    // The sample carries the space expand; the bare search URL is the count query.
    {
      url: 'expand=content.space',
      json: surveyPages([['DESIGN', '2026-07-19T09:00:00.000+0200']], 12),
    },
    { url: '/wiki/rest/api/search', json: { totalSize: 12 } },
  ]);
  const c = atlassianConnector.create(AUTH, { fetchImpl });
  const footprint = await c.surveyFootprint!();

  const sample = calls.find((x) => x.url.includes('/search/jql'))!;
  assert.equal(
    (sample.body as { jql: string }).jql,
    '(assignee = currentUser() OR reporter = currentUser()) AND updated >= "-90d" ORDER BY updated DESC',
  );
  const count = calls.find((x) => x.url.includes('approximate-count'))!;
  assert.equal(
    (count.body as { jql: string }).jql,
    'project = "PAY" AND (assignee = currentUser() OR reporter = currentUser()) AND updated >= "-90d"',
  );
  const cql = new URL(calls.find((x) => x.url.includes('/wiki/rest/api/search'))!.url);
  assert.equal(
    cql.searchParams.get('cql'),
    'contributor = currentUser() AND type = page AND lastmodified > now("-90d") ORDER BY lastmodified DESC',
  );
  assert.equal(cql.searchParams.get('expand'), 'content.space,content.version');

  // Busiest first. PAY's 41 is the API's real total, NOT the 2 rows we sampled —
  // the whole point of the second query.
  assert.deepEqual(footprint, [
    { kind: 'ticket', id: 'PAY', count: 41, lastTouched: '2026-07-21T10:00:00.000+0200' },
    { kind: 'wikipage', id: 'DESIGN', count: 12, lastTouched: '2026-07-19T09:00:00.000+0200' },
    { kind: 'ticket', id: 'OPS', count: 3, lastTouched: '2026-06-01T10:00:00.000+0200' },
  ]);
});

test('surveyFootprint: one product failing leaves the other product standing', async () => {
  const { fetchImpl } = makeFetch([
    ...unscopedProbe,
    { url: '/rest/api/3/search/jql', method: 'POST', status: 503 },
    {
      url: 'expand=content.space',
      json: surveyPages([['DESIGN', '2026-07-19T09:00:00.000+0200']], 4),
    },
    { url: '/wiki/rest/api/search', json: { totalSize: 4 } },
  ]);
  const c = atlassianConnector.create(AUTH, { fetchImpl });
  assert.deepEqual(await c.surveyFootprint!(), [
    { kind: 'wikipage', id: 'DESIGN', count: 4, lastTouched: '2026-07-19T09:00:00.000+0200' },
  ]);
});

test('surveyFootprint: a failed count query falls back to what was sampled', async () => {
  const { fetchImpl } = makeFetch([
    ...unscopedProbe,
    { url: '/rest/api/3/search/approximate-count', method: 'POST', status: 503 },
    {
      url: '/rest/api/3/search/jql',
      method: 'POST',
      json: surveyIssues([
        ['PAY-1', '2026-07-20T10:00:00.000+0200'],
        ['PAY-2', '2026-07-21T10:00:00.000+0200'],
      ]),
    },
    { url: '/wiki/rest/api/search', json: { results: [] } },
  ]);
  const c = atlassianConnector.create(AUTH, { fetchImpl });
  assert.deepEqual(await c.surveyFootprint!(), [
    { kind: 'ticket', id: 'PAY', count: 2, lastTouched: '2026-07-21T10:00:00.000+0200' },
  ]);
});
