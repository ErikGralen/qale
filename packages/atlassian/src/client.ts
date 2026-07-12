import { adfToMarkdown } from './adf.js';

/**
 * Atlassian REST client (PLAN §5): fetch-based, Basic auth with email + an
 * UNSCOPED API token. Jira uses the NEW `POST /rest/api/3/search/jql` (the legacy
 * `/search` endpoint is removed; responses have no `total`; you MUST pass
 * `fields`). Confluence uses v1 CQL search + v2 page fetch. Calls are serialized
 * with 429 backoff honoring Retry-After.
 */
export interface AtlassianCreds {
  /** Site base, e.g. https://your-domain.atlassian.net */
  baseUrl: string;
  email: string;
  token: string;
}

export interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  assignee: string | null;
  url: string;
  description: string;
}

export interface ConfluenceResult {
  id: string;
  title: string;
  url: string;
  excerpt: string;
}

export class AtlassianClient {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly creds: AtlassianCreds) {}

  private authHeader(): string {
    const basic = Buffer.from(`${this.creds.email}:${this.creds.token}`).toString('base64');
    return `Basic ${basic}`;
  }

  /** Serialize requests + back off on 429 (Retry-After), re-throw 401 for re-auth. */
  private request<T>(path: string, init?: RequestInit): Promise<T> {
    const run = async (): Promise<T> => {
      const url = `${this.creds.baseUrl.replace(/\/$/, '')}${path}`;
      for (let attempt = 0; attempt < 4; attempt++) {
        const res = await fetch(url, {
          ...init,
          headers: {
            Authorization: this.authHeader(),
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...(init?.headers ?? {}),
          },
        });
        if (res.status === 429) {
          const retry = Number(res.headers.get('Retry-After') ?? '2');
          await sleep(retry * 1000);
          continue;
        }
        if (res.status === 401) throw new Error('Atlassian auth failed (401) — check email + unscoped API token.');
        if (!res.ok) throw new Error(`Atlassian ${res.status}: ${await res.text().catch(() => res.statusText)}`);
        return (await res.json()) as T;
      }
      throw new Error('Atlassian request throttled (429) after retries.');
    };
    const result = this.queue.then(run, run);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async searchIssues(jql: string, max = 15): Promise<JiraIssue[]> {
    const body = JSON.stringify({
      jql,
      maxResults: max,
      fields: ['summary', 'status', 'assignee', 'description'],
    });
    const data = await this.request<{ issues?: RawIssue[] }>('/rest/api/3/search/jql', {
      method: 'POST',
      body,
    });
    return (data.issues ?? []).map((i) => this.toIssue(i));
  }

  async getIssue(key: string): Promise<JiraIssue> {
    const data = await this.request<RawIssue>(
      `/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,status,assignee,description`,
    );
    return this.toIssue(data);
  }

  async searchConfluence(cql: string, limit = 10): Promise<ConfluenceResult[]> {
    const data = await this.request<{ results?: RawCqlResult[] }>(
      `/wiki/rest/api/search?cql=${encodeURIComponent(cql)}&limit=${limit}`,
    );
    return (data.results ?? []).map((r) => ({
      id: r.content?.id ?? r.id ?? '',
      title: r.content?.title ?? r.title ?? '(untitled)',
      url: `${this.creds.baseUrl.replace(/\/$/, '')}/wiki${r.url ?? r.content?._links?.webui ?? ''}`,
      excerpt: stripTags(r.excerpt ?? ''),
    }));
  }

  async getPage(id: string): Promise<{ id: string; title: string; url: string; body: string }> {
    const data = await this.request<RawPage>(`/wiki/api/v2/pages/${encodeURIComponent(id)}?body-format=storage`);
    return {
      id: data.id,
      title: data.title,
      url: `${this.creds.baseUrl.replace(/\/$/, '')}/wiki${data._links?.webui ?? ''}`,
      body: await xhtmlToMarkdown(data.body?.storage?.value ?? ''),
    };
  }

  private toIssue(raw: RawIssue): JiraIssue {
    return {
      key: raw.key,
      summary: raw.fields?.summary ?? '',
      status: raw.fields?.status?.name ?? 'Unknown',
      assignee: raw.fields?.assignee?.displayName ?? null,
      url: `${this.creds.baseUrl.replace(/\/$/, '')}/browse/${raw.key}`,
      description: raw.fields?.description ? adfToMarkdown(raw.fields.description) : '',
    };
  }
}

interface RawIssue {
  key: string;
  fields?: {
    summary?: string;
    status?: { name?: string };
    assignee?: { displayName?: string } | null;
    description?: unknown;
  };
}
interface RawCqlResult {
  id?: string;
  title?: string;
  url?: string;
  excerpt?: string;
  content?: { id?: string; title?: string; _links?: { webui?: string } };
}
interface RawPage {
  id: string;
  title: string;
  _links?: { webui?: string };
  body?: { storage?: { value?: string } };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
}

/**
 * Confluence storage format is XHTML → markdown via turndown. turndown needs a
 * DOM; if one isn't available in this runtime we fall back to tag-stripping so
 * the agent still gets readable text.
 */
async function xhtmlToMarkdown(xhtml: string): Promise<string> {
  if (!xhtml) return '';
  try {
    const { default: TurndownService } = await import('turndown');
    const service = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
    return service.turndown(xhtml);
  } catch {
    return stripTags(xhtml);
  }
}
