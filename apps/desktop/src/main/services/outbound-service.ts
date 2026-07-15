import { AtlassianClient, type AtlassianCreds } from '@pm/atlassian';
import type { OutboundPort, OutboundResult } from '@pm/application';

/**
 * Adapts the Atlassian client to the application's OutboundPort (PLAN-V2 §3.4).
 * Constructed only when creds are configured, and invoked ONLY by the card-
 * application layer on approval — never by an agent tool. Links come from the API.
 */
export class AtlassianOutbound implements OutboundPort {
  private readonly client: AtlassianClient;

  constructor(creds: AtlassianCreds) {
    this.client = new AtlassianClient(creds);
  }

  async createJiraIssue(input: {
    projectKey: string;
    issueType?: string;
    summary: string;
    body: string;
  }): Promise<OutboundResult> {
    const { key, url } = await this.client.createIssue({
      projectKey: input.projectKey,
      issueType: input.issueType,
      summary: input.summary,
      descriptionMarkdown: input.body,
    });
    return { url, ref: key };
  }

  async addJiraComment(input: { issueKey: string; body: string }): Promise<OutboundResult> {
    const { id, url } = await this.client.addComment(input.issueKey, input.body);
    return { url, ref: id };
  }

  async updateConfluencePage(input: { pageId: string; body: string }): Promise<OutboundResult> {
    const { id, url } = await this.client.updatePage(input.pageId, input.body);
    return { url, ref: id };
  }
}

export function makeOutbound(creds: AtlassianCreds | null): AtlassianOutbound | undefined {
  return creds ? new AtlassianOutbound(creds) : undefined;
}
