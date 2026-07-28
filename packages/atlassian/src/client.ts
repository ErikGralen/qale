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
  /**
   * Request routing for SCOPED tokens, which only work via
   * https://api.atlassian.com/ex/{product}/{cloudId}. Deep links always build
   * from `baseUrl` (the human-facing site) regardless. Omitted = unscoped token,
   * every request hits `baseUrl` directly.
   */
  apiBases?: { jira?: string; wiki?: string };
}

/** Injectable fetch so connectors can be tested against recorded fixtures. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** One issue link as Jira models it, direction preserved: `outward` = this
 *  issue applies the type's outward description to `key` ("blocks PAY-1"). */
export interface JiraIssueLink {
  /** The link type's name as configured on the site ("Blocks", "Relates"). */
  typeName: string;
  key: string;
  outward: boolean;
}

export interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  /** Jira's statusCategory key: 'new' | 'indeterminate' | 'done' (null when not requested). */
  statusCategory: string | null;
  assignee: string | null;
  /** Last-updated timestamp as Jira returns it (ISO with offset). */
  updated: string | null;
  url: string;
  description: string;
  /** Epic/parent key, when the issue has one. */
  parentKey: string | null;
  links: JiraIssueLink[];
}

export interface ConfluenceResult {
  id: string;
  title: string;
  url: string;
  excerpt: string;
}

export interface JiraProject {
  key: string;
  name: string;
}

export interface ConfluenceSpace {
  key: string;
  name: string;
}

/** Shallow issue metadata for incremental pulls — no description (bodies are deep-track only). */
export interface JiraIssueMeta {
  key: string;
  summary: string;
  status: string;
  statusCategory: string | null;
  assignee: string | null;
  updated: string | null;
  url: string;
}

export interface JiraComment {
  author: string | null;
  created: string | null;
  /** Comment body, ADF converted to markdown. */
  body: string;
}

/** Shallow page metadata for incremental pulls. */
export interface ConfluencePageMeta {
  id: string;
  title: string;
  version: number | null;
  lastModified: string | null;
  url: string;
}

/**
 * Page budget for every pagination loop: a misbehaving API that keeps promising
 * more pages must not spin the sync forever. If the budget ever truncates a
 * search, incremental pulls self-heal — results are ordered ASC by update time
 * and the high-water mark advances to the last item seen, so the next tick
 * resumes exactly where this one stopped. The list endpoints don't self-heal,
 * but 20 pages (1000+ items) is far past any realistic project/space count.
 */
const MAX_PAGES = 20;

/** Append vs. in-place edit for {@link AtlassianClient.updatePage}. */
export type UpdatePageInput =
  | { mode: 'append'; markdown: string; provenance?: string }
  | { mode: 'replace'; search: string; replace: string; provenance?: string };

export class AtlassianClient {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly creds: AtlassianCreds,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
  ) {}

  private authHeader(): string {
    const basic = Buffer.from(`${this.creds.email}:${this.creds.token}`).toString('base64');
    return `Basic ${basic}`;
  }

  /**
   * Serialize requests + back off on 429 (Retry-After). Failures cross this
   * boundary in plain language ONLY — these messages surface verbatim on cards
   * and in Settings, so the raw status/body rides along as `cause` (for logs),
   * never in the message itself.
   */
  private request<T>(path: string, init?: RequestInit): Promise<T> {
    const run = async (): Promise<T> => {
      // Scoped tokens route per product; /wiki/... is Confluence, the rest Jira.
      const base = path.startsWith('/wiki')
        ? (this.creds.apiBases?.wiki ?? this.creds.baseUrl)
        : (this.creds.apiBases?.jira ?? this.creds.baseUrl);
      const url = `${base.replace(/\/$/, '')}${path}`;
      for (let attempt = 0; attempt < 4; attempt++) {
        let res: Response;
        try {
          res = await this.fetchImpl(url, {
            ...init,
            headers: {
              Authorization: this.authHeader(),
              Accept: 'application/json',
              'Content-Type': 'application/json',
              ...(init?.headers ?? {}),
            },
          });
        } catch (err) {
          throw new Error("Couldn't reach your Atlassian site — check your connection.", { cause: err });
        }
        if (res.status === 429) {
          await sleep(retryAfterMs(res.headers.get('Retry-After')));
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          throw await httpError(
            res,
            'Your Atlassian token was rejected — it may have expired. Paste a new one in Settings → Connections.',
          );
        }
        if (res.status === 404) {
          throw await httpError(res, "That item no longer exists on your Atlassian site (or the token can't see it).");
        }
        if (!res.ok) throw await httpError(res, `Your Atlassian site returned an error (HTTP ${res.status}).`);
        return (await res.json()) as T;
      }
      throw new Error('Your Atlassian site is rate-limiting requests — try again in a minute.');
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
      fields: ['summary', 'status', 'assignee', 'updated', 'description', 'parent', 'issuelinks'],
    });
    const data = await this.request<{ issues?: RawIssue[] }>('/rest/api/3/search/jql', {
      method: 'POST',
      body,
    });
    return (data.issues ?? []).map((i) => this.toIssue(i));
  }

  /**
   * Shallow variant for incremental mirror pulls: metadata only, no
   * descriptions. Follows `nextPageToken` until `isLast` (the new /search/jql
   * endpoint has no `total`; the token is the only cursor), within MAX_PAGES.
   */
  async searchIssuesMeta(jql: string, pageSize = 100): Promise<JiraIssueMeta[]> {
    const out: JiraIssueMeta[] = [];
    let nextPageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await this.request<{ issues?: RawIssue[]; nextPageToken?: string; isLast?: boolean }>(
        '/rest/api/3/search/jql',
        {
          method: 'POST',
          body: JSON.stringify({
            jql,
            maxResults: pageSize,
            fields: ['summary', 'status', 'assignee', 'updated'],
            ...(nextPageToken ? { nextPageToken } : {}),
          }),
        },
      );
      for (const raw of data.issues ?? []) {
        const { description: _description, parentKey: _parentKey, links: _links, ...meta } = this.toIssue(raw);
        out.push(meta);
      }
      if (data.isLast || !data.nextPageToken) break;
      nextPageToken = data.nextPageToken;
    }
    return out;
  }

  async getIssue(key: string): Promise<JiraIssue> {
    const data = await this.request<RawIssue>(
      `/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,status,assignee,updated,description,parent,issuelinks`,
    );
    return this.toIssue(data);
  }

  /**
   * Recent comments on an issue, newest first, ADF bodies converted to markdown.
   * Also returns the thread's TRUE total so callers can disclose truncation —
   * a 100-comment epic must not silently mirror as its last ten.
   */
  async getComments(key: string, max = 10): Promise<{ comments: JiraComment[]; total: number }> {
    const data = await this.request<{ comments?: RawComment[]; total?: number }>(
      `/rest/api/3/issue/${encodeURIComponent(key)}/comment?maxResults=${max}&orderBy=-created`,
    );
    const comments = (data.comments ?? []).map((c) => ({
      author: c.author?.displayName ?? null,
      created: c.created ?? null,
      body: c.body ? adfToMarkdown(c.body) : '',
    }));
    return { comments, total: data.total ?? comments.length };
  }

  /** All projects, following `isLast`/`startAt` — a >50-project site must not
   *  silently truncate the container picker. */
  async listProjects(pageSize = 50): Promise<JiraProject[]> {
    const out: JiraProject[] = [];
    let startAt = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await this.request<{ values?: { key?: string; name?: string }[]; isLast?: boolean }>(
        `/rest/api/3/project/search?maxResults=${pageSize}&startAt=${startAt}`,
      );
      const values = data.values ?? [];
      out.push(...values.filter((p) => !!p.key).map((p) => ({ key: p.key!, name: p.name ?? p.key! })));
      // Missing isLast reads as last: never loop on a shape we don't recognize.
      if (data.isLast !== false || values.length === 0) break;
      startAt += values.length;
    }
    return out;
  }

  /** All spaces, following the v2 cursor (`_links.next` is a /wiki-relative URL). */
  async listSpaces(pageSize = 50): Promise<ConfluenceSpace[]> {
    const out: ConfluenceSpace[] = [];
    let path = `/wiki/api/v2/spaces?limit=${pageSize}`;
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await this.request<{
        results?: { key?: string; name?: string }[];
        _links?: { next?: string };
      }>(path);
      out.push(
        ...(data.results ?? []).filter((s) => !!s.key).map((s) => ({ key: s.key!, name: s.name ?? s.key! })),
      );
      const next = data._links?.next;
      if (!next) break;
      path = next;
    }
    return out;
  }

  async searchConfluence(cql: string, limit = 10): Promise<ConfluenceResult[]> {
    const data = await this.request<{ results?: RawCqlResult[] }>(
      `/wiki/rest/api/search?cql=${encodeURIComponent(cql)}&limit=${limit}`,
    );
    return (data.results ?? []).map((r) => ({
      id: r.content?.id ?? r.id ?? '',
      title: r.content?.title ?? r.title ?? '(untitled)',
      url: `${this.base()}/wiki${r.url ?? r.content?._links?.webui ?? ''}`,
      excerpt: stripTags(r.excerpt ?? ''),
    }));
  }

  /**
   * Shallow variant for incremental mirror pulls: CQL search with version
   * expanded, paged on the v1 `start`/`limit` window (a short page means
   * exhausted) within MAX_PAGES.
   */
  async searchPagesMeta(cql: string, limit = 50): Promise<ConfluencePageMeta[]> {
    const out: ConfluencePageMeta[] = [];
    let start = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await this.request<{ results?: RawCqlResult[] }>(
        `/wiki/rest/api/search?cql=${encodeURIComponent(cql)}&start=${start}&limit=${limit}&expand=content.version`,
      );
      const results = data.results ?? [];
      out.push(
        ...results
          .filter((r) => !!(r.content?.id ?? r.id))
          .map((r) => ({
            id: (r.content?.id ?? r.id)!,
            title: r.content?.title ?? r.title ?? '(untitled)',
            version: r.content?.version?.number ?? null,
            lastModified: r.content?.version?.when ?? r.lastModified ?? null,
            url: `${this.base()}/wiki${r.url ?? r.content?._links?.webui ?? ''}`,
          })),
      );
      if (results.length < limit) break;
      start += results.length;
    }
    return out;
  }

  async getPage(
    id: string,
  ): Promise<{ id: string; title: string; url: string; body: string; version: number | null; lastModified: string | null }> {
    const data = await this.request<RawPage>(`/wiki/api/v2/pages/${encodeURIComponent(id)}?body-format=storage`);
    return {
      id: data.id,
      title: data.title,
      url: `${this.base()}/wiki${data._links?.webui ?? ''}`,
      body: await xhtmlToMarkdown(data.body?.storage?.value ?? ''),
      version: data.version?.number ?? null,
      lastModified: data.version?.createdAt ?? null,
    };
  }

  // ---------------------------------------------------------------------------
  // Writes (PLAN-V2 §3.4) — invoked ONLY by the card-application layer on
  // approval, never by an agent tool. Links are built from the API response.
  // ---------------------------------------------------------------------------

  /** Create a Jira issue from a markdown description. Returns the deterministic link. */
  async createIssue(input: {
    projectKey: string;
    issueType?: string;
    summary: string;
    descriptionMarkdown?: string;
  }): Promise<{ key: string; url: string }> {
    const data = await this.request<{ key: string }>('/rest/api/3/issue', {
      method: 'POST',
      body: JSON.stringify({
        fields: {
          project: { key: input.projectKey },
          issuetype: { name: input.issueType ?? 'Task' },
          summary: input.summary,
          description: markdownToAdf(input.descriptionMarkdown ?? ''),
        },
      }),
    });
    return { key: data.key, url: `${this.base()}/browse/${data.key}` };
  }

  async addComment(key: string, bodyMarkdown: string): Promise<{ id: string; url: string }> {
    const data = await this.request<{ id: string }>(
      `/rest/api/3/issue/${encodeURIComponent(key)}/comment`,
      { method: 'POST', body: JSON.stringify({ body: markdownToAdf(bodyMarkdown) }) },
    );
    return { id: data.id, url: `${this.base()}/browse/${key}?focusedCommentId=${data.id}` };
  }

  /**
   * Update a Confluence page (fetch → edit → bump version → PUT).
   *  - `append`: converts markdown to storage XHTML and adds it after the
   *    existing content — for new sections.
   *  - `replace`: patches the drafted passage IN the fetched storage XHTML, no
   *    markdown round-trip — macros, tables and links elsewhere on the page
   *    survive byte-for-byte. Refuses (plain-language error) when the passage
   *    is missing or ambiguous rather than guess at someone's page.
   * `provenance` (both modes) appends one italic line naming the source.
   */
  async updatePage(id: string, input: UpdatePageInput): Promise<{ id: string; url: string }> {
    const page = await this.request<RawPage & { version?: { number?: number }; spaceId?: string }>(
      `/wiki/api/v2/pages/${encodeURIComponent(id)}?body-format=storage`,
    );
    const currentBody = page.body?.storage?.value ?? '';
    let nextBody =
      input.mode === 'append'
        ? `${currentBody}${markdownToStorage(input.markdown)}`
        : replaceInStorage(currentBody, input.search, input.replace);
    if (input.provenance) nextBody += `<p><em>${escapeXml(input.provenance)}</em></p>`;
    const nextVersion = (page.version?.number ?? 1) + 1;
    const data = await this.request<RawPage>(`/wiki/api/v2/pages/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({
        id,
        status: 'current',
        title: page.title,
        body: { representation: 'storage', value: nextBody },
        version: { number: nextVersion, message: 'Produktminnet update' },
      }),
    });
    return { id: data.id, url: `${this.base()}/wiki${data._links?.webui ?? ''}` };
  }

  private base(): string {
    return this.creds.baseUrl.replace(/\/$/, '');
  }

  private toIssue(raw: RawIssue): JiraIssue {
    const links: JiraIssueLink[] = [];
    for (const l of raw.fields?.issuelinks ?? []) {
      const typeName = l.type?.name ?? '';
      const outwardKey = l.outwardIssue?.key;
      const inwardKey = l.inwardIssue?.key;
      // Exactly one side is present: `outwardIssue` = this issue applies the
      // outward description ("blocks X"), `inwardIssue` = the inward one
      // ("is blocked by X").
      if (typeName && outwardKey) links.push({ typeName, key: outwardKey, outward: true });
      else if (typeName && inwardKey) links.push({ typeName, key: inwardKey, outward: false });
    }
    return {
      key: raw.key,
      summary: raw.fields?.summary ?? '',
      status: raw.fields?.status?.name ?? 'Unknown',
      statusCategory: raw.fields?.status?.statusCategory?.key ?? null,
      assignee: raw.fields?.assignee?.displayName ?? null,
      updated: raw.fields?.updated ?? null,
      url: `${this.base()}/browse/${raw.key}`,
      description: raw.fields?.description ? adfToMarkdown(raw.fields.description) : '',
      parentKey: raw.fields?.parent?.key ?? null,
      links,
    };
  }
}

interface RawIssue {
  key: string;
  fields?: {
    summary?: string;
    status?: { name?: string; statusCategory?: { key?: string } };
    assignee?: { displayName?: string } | null;
    updated?: string;
    description?: unknown;
    parent?: { key?: string };
    issuelinks?: {
      type?: { name?: string };
      inwardIssue?: { key?: string };
      outwardIssue?: { key?: string };
    }[];
  };
}
interface RawComment {
  author?: { displayName?: string };
  created?: string;
  body?: unknown;
}
interface RawCqlResult {
  id?: string;
  title?: string;
  url?: string;
  excerpt?: string;
  lastModified?: string;
  content?: {
    id?: string;
    title?: string;
    version?: { number?: number; when?: string };
    _links?: { webui?: string };
  };
}
interface RawPage {
  id: string;
  title: string;
  _links?: { webui?: string };
  body?: { storage?: { value?: string } };
  version?: { number?: number; createdAt?: string };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Plain-language HTTP error; the status + response body ride along as `cause`. */
async function httpError(res: Response, message: string): Promise<Error> {
  const detail = await res.text().catch(() => res.statusText);
  return new Error(message, { cause: `HTTP ${res.status}: ${detail}` });
}

/**
 * Retry-After is either delta-seconds or an HTTP-date. `Number()` on a date is
 * NaN, and sleeping NaN ms sleeps zero — a hot retry loop against a server
 * that's asking us to slow down. Parse both forms; clamp to [1s, 60s] so a
 * bogus header can neither hot-loop nor hang the queue; absent/garbage → 2s.
 */
function retryAfterMs(header: string | null): number {
  if (!header) return 2_000;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
  if (!Number.isFinite(ms)) return 2_000;
  return Math.min(Math.max(ms, 1_000), 60_000);
}

/**
 * Locate + replace one drafted passage in storage XHTML. The search text is the
 * page's PLAIN text as the drafter saw it, while the storage may differ by
 * whitespace runs and XML entities — matching tolerates exactly those two.
 * Zero matches and multiple matches both refuse: an approved edit must land on
 * the passage the PM read, or not at all. Errors are user-facing card copy —
 * no XML or plumbing in the message.
 */
function replaceInStorage(storage: string, search: string, replace: string): string {
  const splice = (index: number, length: number): string =>
    storage.slice(0, index) + escapeXml(replace) + storage.slice(index + length);

  // Exact match first: cheap, and unambiguous when unique.
  const exact = storage.indexOf(search);
  if (exact !== -1 && storage.indexOf(search, exact + 1) === -1) return splice(exact, search.length);
  if (exact === -1) {
    const matches = [...storage.matchAll(tolerantPattern(search))];
    if (matches.length === 1) return splice(matches[0]!.index, matches[0]![0].length);
    if (matches.length === 0) {
      throw new Error(
        "The page's text changed — the passage this edit targets couldn't be found. Re-sync and redraft.",
      );
    }
  }
  throw new Error(
    'That passage appears more than once on the page — the edit is ambiguous. Redraft with more surrounding text.',
  );
}

/** Whitespace runs → `\s+`; chars XML-escapes may have rewritten match either form. */
function tolerantPattern(search: string): RegExp {
  const ENTITY: Record<string, string> = {
    '&': '(?:&amp;|&)',
    '<': '(?:&lt;|<)',
    '>': '(?:&gt;|>)',
    '"': '(?:&quot;|")',
    "'": "(?:&#39;|')",
  };
  const parts: string[] = [];
  for (const ch of search.trim()) {
    if (/\s/.test(ch)) {
      if (parts.at(-1) !== '\\s+') parts.push('\\s+');
    } else {
      parts.push(ENTITY[ch] ?? ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    }
  }
  return new RegExp(parts.join(''), 'g');
}

/**
 * Minimal markdown → ADF (Atlassian Document Format) for Jira writes. Handles
 * paragraphs, `#`/`##` headings and `-` bullet lists — enough for a decision
 * rationale or an action description. Anything richer degrades to a paragraph.
 */
export function markdownToAdf(md: string): AdfDoc {
  const content: AdfNode[] = [];
  const lines = md.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      content.push({
        type: 'heading',
        attrs: { level: heading[1]!.length },
        content: [{ type: 'text', text: heading[2]! }],
      });
      i++;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: AdfNode[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i]!)) {
        items.push({
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: lines[i]!.replace(/^[-*]\s+/, '') }] }],
        });
        i++;
      }
      content.push({ type: 'bulletList', content: items });
      continue;
    }
    content.push({ type: 'paragraph', content: [{ type: 'text', text: line }] });
    i++;
  }
  if (content.length === 0) content.push({ type: 'paragraph', content: [] });
  return { type: 'doc', version: 1, content };
}

interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  text?: string;
}
interface AdfDoc {
  type: 'doc';
  version: 1;
  content: AdfNode[];
}

/** Minimal markdown → Confluence storage XHTML for page appends. */
export function markdownToStorage(md: string): string {
  const out: string[] = [];
  const lines = md.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length + 1;
      out.push(`<h${level}>${escapeXml(heading[2]!)}</h${level}>`);
      i++;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i]!)) {
        items.push(`<li>${escapeXml(lines[i]!.replace(/^[-*]\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    out.push(`<p>${escapeXml(line)}</p>`);
    i++;
  }
  return out.join('');
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
}

/**
 * Confluence code macros are namespaced elements turndown silently drops —
 * `<ac:structured-macro ac:name="code">` wrapping `<ac:plain-text-body>` CDATA
 * — deleting code from mirrors. Rewrite them to plain <pre><code> blocks BEFORE
 * conversion so the content survives turndown (as a fenced block) and the
 * tag-stripping fallback alike. escapeXml here is round-trip safety: the DOM
 * parse un-escapes it again, so the code text comes out verbatim.
 */
function liftCodeMacros(xhtml: string): string {
  const cdata = /<ac:plain-text-body>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/ac:plain-text-body>/;
  return xhtml
    .replace(
      /<ac:structured-macro[^>]*\bac:name="code"[^>]*>([\s\S]*?)<\/ac:structured-macro>/g,
      (_m, inner: string) => `<pre><code>${escapeXml(cdata.exec(inner)?.[1] ?? '')}</code></pre>`,
    )
    .replace(new RegExp(cdata.source, 'g'), (_m, body: string) => `<pre><code>${escapeXml(body)}</code></pre>`);
}

/**
 * Confluence storage format is XHTML → markdown via turndown. turndown needs a
 * DOM; if one isn't available in this runtime we fall back to tag-stripping so
 * the agent still gets readable text.
 */
async function xhtmlToMarkdown(xhtml: string): Promise<string> {
  if (!xhtml) return '';
  const lifted = liftCodeMacros(xhtml);
  try {
    const { default: TurndownService } = await import('turndown');
    const service = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
    return service.turndown(lifted);
  } catch {
    return stripTags(lifted);
  }
}
