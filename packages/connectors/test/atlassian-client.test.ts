import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AtlassianClient, type FetchLike } from '@qale/atlassian';
import { makeFetch } from './fetch-fixture.js';

/**
 * Client-level tests (the @qale/atlassian package has no test harness of its own,
 * so its wire behavior is covered here with the same injected fetch): the
 * pagination loops, plain-language error mapping, and the tolerant storage-
 * XHTML patcher — behaviors the connector tests only exercise on one page.
 */

const SITE = 'https://tavla.atlassian.net';
const client = (fetchImpl: FetchLike): AtlassianClient =>
  new AtlassianClient({ baseUrl: SITE, email: 'erik@tavla.example', token: 'tok-123' }, fetchImpl);

const rawIssue = (key: string): unknown => ({
  key,
  fields: {
    summary: key,
    status: { name: 'Open', statusCategory: { key: 'new' } },
    assignee: null,
    updated: '2026-07-01T00:00:00.000+0200',
  },
});

test('searchIssuesMeta: follows nextPageToken until isLast', async () => {
  const { fetchImpl, calls } = makeFetch([
    {
      url: '/rest/api/3/search/jql',
      method: 'POST',
      seq: [
        {
          json: {
            issues: [rawIssue('PAY-1'), rawIssue('PAY-2')],
            nextPageToken: 'tok-2',
            isLast: false,
          },
        },
        { json: { issues: [rawIssue('PAY-3')], isLast: true } },
      ],
    },
  ]);
  const issues = await client(fetchImpl).searchIssuesMeta('project = "PAY" ORDER BY updated ASC');
  assert.deepEqual(
    issues.map((i) => i.key),
    ['PAY-1', 'PAY-2', 'PAY-3'],
  );
  assert.equal(calls.length, 2);
  assert.equal((calls[0]!.body as { nextPageToken?: string }).nextPageToken, undefined);
  assert.equal((calls[1]!.body as { nextPageToken?: string }).nextPageToken, 'tok-2');
  // Every page must re-send the same JQL — the token is a cursor, not a query.
  assert.equal((calls[1]!.body as { jql: string }).jql, 'project = "PAY" ORDER BY updated ASC');
});

test('searchIssuesMeta: the page budget stops a server that never says isLast', async () => {
  const { fetchImpl, calls } = makeFetch([
    {
      url: '/rest/api/3/search/jql',
      method: 'POST',
      json: { issues: [rawIssue('PAY-1')], nextPageToken: 'again', isLast: false },
    },
  ]);
  const issues = await client(fetchImpl).searchIssuesMeta('project = "PAY"');
  // Truncation here is safe: ASC ordering + mark advancement resume next tick.
  assert.equal(issues.length, 20);
  assert.equal(calls.length, 20);
});

test('searchPagesMeta: pages the v1 start/limit window until a short page', async () => {
  const page = (id: string): unknown => ({
    content: {
      id,
      title: id,
      version: { number: 1, when: '2026-07-01T00:00:00Z' },
      _links: { webui: `/x/${id}` },
    },
  });
  const { fetchImpl, calls } = makeFetch([
    {
      url: '/wiki/rest/api/search',
      seq: [{ json: { results: [page('1'), page('2')] } }, { json: { results: [page('3')] } }],
    },
  ]);
  const pages = await client(fetchImpl).searchPagesMeta('space = "PROD"', 2);
  assert.deepEqual(
    pages.map((p) => p.id),
    ['1', '2', '3'],
  );
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[0]!.url).searchParams.get('start'), '0');
  assert.equal(new URL(calls[1]!.url).searchParams.get('start'), '2');
});

test('listProjects: follows isLast/startAt — >1 page of projects must not truncate the picker', async () => {
  const { fetchImpl, calls } = makeFetch([
    {
      url: '/rest/api/3/project/search',
      seq: [
        { json: { values: [{ key: 'PAY', name: 'Payments' }], isLast: false } },
        { json: { values: [{ key: 'CORE', name: 'Core Platform' }], isLast: true } },
      ],
    },
  ]);
  const projects = await client(fetchImpl).listProjects();
  assert.deepEqual(
    projects.map((p) => p.key),
    ['PAY', 'CORE'],
  );
  assert.equal(new URL(calls[1]!.url).searchParams.get('startAt'), '1');
});

test('listSpaces: follows the v2 _links.next cursor', async () => {
  const { fetchImpl, calls } = makeFetch([
    {
      url: '/wiki/api/v2/spaces',
      seq: [
        {
          json: {
            results: [{ key: 'PROD', name: 'Product' }],
            _links: { next: '/wiki/api/v2/spaces?cursor=abc' },
          },
        },
        { json: { results: [{ key: 'ENG', name: 'Engineering' }] } },
      ],
    },
  ]);
  const spaces = await client(fetchImpl).listSpaces();
  assert.deepEqual(
    spaces.map((s) => s.key),
    ['PROD', 'ENG'],
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[1]!.url, `${SITE}/wiki/api/v2/spaces?cursor=abc`);
});

test('updatePage(replace): tolerates whitespace runs and XML entities in the stored passage', async () => {
  const { fetchImpl, calls } = makeFetch([
    {
      url: '/wiki/api/v2/pages/9',
      method: 'PUT',
      json: { id: '9', title: 'T', _links: { webui: '/x' } },
    },
    {
      url: '/wiki/api/v2/pages/9',
      json: {
        id: '9',
        title: 'T',
        version: { number: 4 },
        _links: { webui: '/x' },
        // The drafter saw plain text; storage has an entity and a wrapped line.
        body: { storage: { value: '<p>Q2 &amp; Q3   rollout\nplan</p>' } },
      },
    },
  ]);
  await client(fetchImpl).updatePage('9', {
    mode: 'replace',
    search: 'Q2 & Q3 rollout plan',
    replace: 'Q3 & Q4 rollout plan',
  });
  const put = calls.find((x) => x.method === 'PUT')!.body as {
    body: { value: string };
    version: { number: number };
  };
  assert.equal(put.body.value, '<p>Q3 &amp; Q4 rollout plan</p>'); // replacement re-escaped for XML
  assert.equal(put.version.number, 5);
});

test('request: REST failures cross the boundary in plain language, raw detail only in cause', async () => {
  const at401 = client(makeFetch([{ url: '/rest/api/3/issue/PAY-1', status: 401 }]).fetchImpl);
  await assert.rejects(() => at401.getIssue('PAY-1'), {
    message:
      'Your Atlassian token was rejected — it may have expired. Paste a new one in Settings → Connections.',
  });

  const at404 = client(makeFetch([{ url: '/wiki/api/v2/pages/404404', status: 404 }]).fetchImpl);
  await assert.rejects(() => at404.getPage('404404'), {
    message: "That item no longer exists on your Atlassian site (or the token can't see it).",
  });

  const at500 = client(
    makeFetch([{ url: '/rest/api/3/issue/PAY-1', status: 500, json: { stack: 'secret' } }])
      .fetchImpl,
  );
  await assert.rejects(
    () => at500.getIssue('PAY-1'),
    (err: Error) => {
      assert.equal(err.message, 'Your Atlassian site returned an error (HTTP 500).');
      assert.ok(String(err.cause).includes('500')); // plumbing rides in cause, not the message
      return true;
    },
  );

  const offline = client(makeFetch([{ url: SITE, throws: true }]).fetchImpl);
  await assert.rejects(() => offline.getIssue('PAY-1'), {
    message: "Couldn't reach your Atlassian site — check your connection.",
  });
});

test('getComments: returns the true thread total alongside the fetched window', async () => {
  const { fetchImpl } = makeFetch([
    {
      url: '/rest/api/3/issue/PAY-1/comment',
      json: {
        comments: [{ author: { displayName: 'Mika' }, created: '2026-07-01T00:00:00Z' }],
        total: 41,
      },
    },
  ]);
  const { comments, total } = await client(fetchImpl).getComments('PAY-1', 1);
  assert.equal(comments.length, 1);
  assert.equal(total, 41);
});
