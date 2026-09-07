import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AtlassianClient } from '@qale/atlassian';
import { atlassianReadTools } from '../src/atlassian/read-tools.js';

/**
 * The agent's four reads into Jira and Confluence. They live beside the
 * connector because search speaks the provider's own query language, and they
 * hand back text plus the origin it came from. Fencing that text is the agent
 * package's job, and its own tests cover it.
 */

function fakeClient(over: Partial<Record<string, unknown>> = {}): AtlassianClient {
  return {
    getIssue: async (key: string) => ({
      key,
      summary: 'SSO rollout',
      status: 'In Progress',
      statusCategory: 'indeterminate',
      assignee: 'asa',
      updated: null,
      url: `https://x.atlassian.net/browse/${key}`,
      description: 'Customers want SCIM.',
      parentKey: null,
      links: [],
      labels: ['scheduling', 'needs-legal'],
      issueType: 'Story',
      priority: 'High',
      components: ['Rostering'],
      reporter: 'Åsa Lindqvist',
    }),
    searchIssues: async () => [
      {
        key: 'PAY-1',
        summary: 'a',
        status: 'To Do',
        statusCategory: null,
        assignee: null,
        updated: null,
        url: 'u',
        description: '',
        parentKey: null,
        links: [],
        labels: ['scheduling'],
        issueType: 'Bug',
        priority: null,
        components: [],
        reporter: null,
      },
    ],
    getPage: async (id: string) => ({
      id,
      title: 'Runbook',
      url: 'https://x/wiki/1',
      body: 'the page',
      version: 1,
      lastModified: null,
    }),
    searchConfluence: async () => [
      { id: '12345', title: 'Runbook', url: 'https://x/wiki/1', excerpt: 'an excerpt' },
    ],
    ...over,
  } as unknown as AtlassianClient;
}

const atlassian = (over: Partial<Record<string, unknown>> = {}) =>
  Object.fromEntries(atlassianReadTools(fakeClient(over)).map((t) => [t.name, t]));

test('the four reads keep the names the skills and transcripts use', () => {
  assert.deepEqual(
    atlassianReadTools(fakeClient()).map((t) => t.name),
    ['jira_search', 'jira_get_issue', 'confluence_search', 'confluence_get_page'],
  );
});

test('external reads come back with the origin they came from', async () => {
  const t = atlassian();
  const issue = await t['jira_get_issue']!.execute({ key: 'PAY-142' });
  assert.equal(issue.external, 'jira:PAY-142');
  assert.match(issue.text, /Customers want SCIM/);

  const page = await t['confluence_get_page']!.execute({ id: '12345' });
  assert.equal(page.external, 'confluence:12345');
  assert.match(page.text, /the page/);

  // The origin of a result set is the query, not one key: every row was typed
  // by whoever filed the issue or wrote the page.
  const issues = await t['jira_search']!.execute({ jql: 'project = PAY' });
  assert.equal(issues.external, 'jira:search');
  assert.match(issues.text, /PAY-1/);

  const pages = await t['confluence_search']!.execute({ cql: 'text ~ "SSO"' });
  assert.equal(pages.external, 'confluence:search');
  assert.match(pages.text, /an excerpt/);
});

test('the reads print the fields the description never says', async () => {
  const t = atlassian();

  // One issue, one line: type, labels, priority, components, who filed it.
  const issue = await t['jira_get_issue']!.execute({ key: 'PAY-142' });
  assert.match(
    issue.text,
    /Story · labels: scheduling, needs-legal · priority: High · components: Rostering · filed by Åsa Lindqvist/,
  );

  // A search row prints only the fields the issue has — no empty labels.
  const issues = await t['jira_search']!.execute({ jql: 'project = PAY' });
  assert.match(issues.text, /Bug · labels: scheduling/);
  assert.ok(!issues.text.includes('priority:'), issues.text);
  assert.ok(!issues.text.includes('components:'), issues.text);
});

test('an issue with none of the extra fields prints no extra line', async () => {
  const t = atlassian({
    getIssue: async (key: string) => ({
      key,
      summary: 'bare',
      status: 'To Do',
      statusCategory: null,
      assignee: null,
      updated: null,
      url: 'u',
      description: 'body',
      parentKey: null,
      links: [],
      labels: [],
      issueType: '',
      priority: null,
      components: [],
      reporter: null,
    }),
  });
  const issue = await t['jira_get_issue']!.execute({ key: 'PAY-9' });
  assert.equal(issue.text, '# PAY-9: bare\nStatus: To Do\nu\n\nbody');
});

test('an empty result set stays a plain sentence, not an empty envelope', async () => {
  const t = atlassian({ searchIssues: async () => [], searchConfluence: async () => [] });
  const issues = await t['jira_search']!.execute({ jql: 'project = NONE' });
  assert.deepEqual(issues, { text: 'No matching Jira issues.' });
  const pages = await t['confluence_search']!.execute({ cql: 'x' });
  assert.deepEqual(pages, { text: 'No matching Confluence pages.' });
});
