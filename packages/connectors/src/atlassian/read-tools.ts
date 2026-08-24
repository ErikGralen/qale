import { Type } from 'typebox';
import { AtlassianClient } from '@qale/atlassian';
import type { FetchLike, ProviderReadTool } from '../types.js';
import type { AtlassianAuth } from './probe.js';

/**
 * The four READS into Jira and Confluence, the agent's side of this connector.
 * They ride on the workspace's connection alone, and every session gets them:
 * "what is the status of PAY-142?" is an ordinary question, and a plain chat
 * opens on the base skill, which declares no capabilities and never will.
 * Gating these would mean a chat could never answer it.
 *
 * Results are normalized to markdown with deep links so ask-answers can cite
 * them. Jira stays the system of execution: we point at the *what* and hold the
 * *why*.
 */
export function atlassianReadTools(client: AtlassianClient): ProviderReadTool[] {
  const jiraSearch: ProviderReadTool = {
    name: 'jira_search',
    label: 'Search Jira',
    description:
      'Search Jira issues with a JQL query. Returns key, summary, status, assignee and a deep link.',
    parameters: Type.Object({ jql: Type.String({ description: 'A JQL query.' }) }),
    async execute(params) {
      const issues = await client.searchIssues(params['jql'] as string);
      if (issues.length === 0) return { text: 'No matching Jira issues.' };
      // Every summary in the list was typed by whoever filed the issue, so the
      // whole result set is external; the origin is the query, not one key.
      return {
        external: 'jira:search',
        text: issues
          .map(
            (i) =>
              `- ${i.key} [${i.status}] ${i.summary}${i.assignee ? ` (@${i.assignee})` : ''}\n    ${i.url}`,
          )
          .join('\n'),
      };
    },
  };

  const jiraGetIssue: ProviderReadTool = {
    name: 'jira_get_issue',
    label: 'Get Jira issue',
    description:
      'Fetch a single Jira issue by key (e.g. ENG-214), including its description as markdown.',
    parameters: Type.Object({ key: Type.String() }),
    async execute(params) {
      const i = await client.getIssue(params['key'] as string);
      return {
        external: `jira:${i.key}`,
        text: `# ${i.key}: ${i.summary}\nStatus: ${i.status}${i.assignee ? ` · @${i.assignee}` : ''}\n${i.url}\n\n${i.description}`,
      };
    },
  };

  const confluenceSearch: ProviderReadTool = {
    name: 'confluence_search',
    label: 'Search Confluence',
    description:
      'Search Confluence pages with a CQL query. Returns title, deep link and an excerpt.',
    parameters: Type.Object({
      cql: Type.String({ description: 'A CQL query, e.g. text ~ "SSO".' }),
    }),
    async execute(params) {
      const results = await client.searchConfluence(params['cql'] as string);
      if (results.length === 0) return { text: 'No matching Confluence pages.' };
      // Excerpts are page text: same treatment as the pages themselves.
      return {
        external: 'confluence:search',
        text: results
          .map((r) => `- [${r.id}] ${r.title}\n    ${r.url}\n    ${r.excerpt}`)
          .join('\n'),
      };
    },
  };

  const confluenceGetPage: ProviderReadTool = {
    name: 'confluence_get_page',
    label: 'Get Confluence page',
    description: 'Fetch a Confluence page by id, converted to markdown.',
    parameters: Type.Object({ id: Type.String() }),
    async execute(params) {
      const page = await client.getPage(params['id'] as string);
      return {
        external: `confluence:${page.id}`,
        text: `# ${page.title}\n${page.url}\n\n${page.body}`,
      };
    },
  };

  return [jiraSearch, jiraGetIssue, confluenceSearch, confluenceGetPage];
}

/**
 * The same four, bound to stored credentials. The reads take the site URL as
 * pasted, without the probe the sync engine runs: a search must not wait on a
 * round trip that only resolves scoped-token API bases, which these endpoints
 * do not need.
 */
export function atlassianReadToolsFor(
  auth: AtlassianAuth,
  opts?: { fetchImpl?: FetchLike },
): ProviderReadTool[] {
  return atlassianReadTools(
    new AtlassianClient(
      { baseUrl: auth.siteUrl, email: auth.email, token: auth.apiToken },
      opts?.fetchImpl,
    ),
  );
}
