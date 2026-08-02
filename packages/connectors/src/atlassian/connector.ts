import { z } from 'zod';
import {
  AtlassianClient,
  type ConfluencePageMeta,
  type JiraIssueMeta,
} from '@pm/atlassian';
import { kebabLinkType, zOutboundPayload, type StateCategory } from '@pm/domain';
import type {
  Connector,
  ConnectorProvider,
  ContainerKind,
  ExternalContainer,
  ExecuteResult,
  FetchLike,
  FullItem,
  PullResult,
  ShallowChange,
  TicketLink,
  VerifyResult,
} from '../types.js';
import { probeAtlassian, type AtlassianAuth, type ProbeResult } from './probe.js';
import { mapJiraStateCategory } from './state-map.js';

/**
 * Atlassian connector: Jira projects → `ticket` mirrors, Confluence spaces →
 * `wikipage` mirrors. Wraps the existing AtlassianClient — JQL/CQL search, v2
 * pages, ADF→markdown, serialized requests with 429 backoff all stay there;
 * this file is the provider→generic mapping and nothing else.
 */

export const atlassianAuthSchema = z.object({
  siteUrl: z
    .string()
    .url()
    .describe('Site URL — e.g. https://your-team.atlassian.net'),
  email: z.string().email().describe('Atlassian account email'),
  apiToken: z
    .string()
    .min(1)
    .describe('API token — create one at id.atlassian.com/manage-profile/security/api-tokens'),
});
export type AtlassianAuthInput = z.infer<typeof atlassianAuthSchema>;

/**
 * Incremental pulls use RELATIVE time windows ("-38m") instead of formatting
 * the high-water mark as an absolute JQL/CQL datetime: Jira and Confluence
 * interpret bare datetimes in the account's profile timezone, so an absolute
 * UTC-formatted mark can silently MISS hours of changes on a west-of-UTC
 * profile. Relative windows are timezone-proof; the extra slack only re-fetches
 * items the sync engine upserts idempotently anyway.
 */
const WINDOW_SLACK_MINUTES = 5;

/**
 * Null = the mark is unparseable, which must mean "no mark" (full re-pull): a
 * zero-ish window would match nothing, return no changes, and re-persist the
 * same corrupt mark — the container would silently never sync again.
 */
function minutesSince(sinceIso: string, now: number): number | null {
  const since = Date.parse(sinceIso);
  if (Number.isNaN(since)) return null;
  return Math.max(0, Math.ceil((now - since) / 60_000)) + WINDOW_SLACK_MINUTES;
}

/**
 * Container ids are interpolated into quoted JQL/CQL string literals; an
 * embedded quote or backslash would otherwise terminate the literal early.
 * Ids come from the provider's own container list, so this is belt-and-braces
 * against odd project/space keys, not hostile-input sanitizing.
 */
function quoteJql(id: string): string {
  return `"${id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Jira link-type name → canonical link vocabulary.
 * Unknown site-configured types pass through as free-text tokens — they index
 * and display but drive nothing. `outward` = this issue applies the outward
 * description ("blocks X"); inward entries are the same edge reversed.
 */
const JIRA_LINK_TYPES: Record<string, string> = {
  blocks: 'blocks',
  relates: 'relates',
  duplicate: 'duplicates',
  duplicates: 'duplicates',
  cloners: 'duplicates',
};

function mapJiraLink(typeName: string, key: string, outward: boolean): TicketLink {
  const token = kebabLinkType(typeName) || 'relates';
  const type = JIRA_LINK_TYPES[token] ?? token;
  return { type, key, ...(outward ? {} : { reversed: true }) };
}

/**
 * Ids per `key in (…)` / `id in (…)` query. Well under any URL or JQL length
 * limit, and small enough that halving on failure (see `pullBatch`) converges
 * in a handful of requests.
 */
const KEY_BATCH = 50;

/** Jira keys are `PROJECT-N`, so a key pulled by id still knows its container
 *  even though the search payload never says which project it came from. */
function projectKeyOf(issueKey: string): string {
  return issueKey.split('-')[0] ?? '';
}

/**
 * A 400 means the QUERY was rejected — for `key in (…)`, that's Jira refusing
 * the whole batch because one id doesn't resolve. Worth halving and retrying.
 * Anything else (401/403/429/5xx/network) is about the connection, not the
 * ids: rethrow, or an outage would turn one request into a hundred.
 */
function isBadQuery(err: unknown): boolean {
  const cause = (err as { cause?: unknown } | null)?.cause;
  return typeof cause === 'string' && cause.startsWith('HTTP 400');
}

function toPageChange(p: ConfluencePageMeta, container: string, now: number): ShallowChange {
  return {
    kind: 'wikipage',
    external_id: p.id,
    container,
    title: p.title,
    version: p.version ?? 0,
    remote_updated: p.lastModified ?? new Date(now).toISOString(),
    url: p.url,
  };
}

class AtlassianConnector implements Connector {
  readonly id = 'atlassian';
  readonly providers: Partial<Record<ContainerKind, string>> = {
    ticket: 'jira',
    wikipage: 'confluence',
  };

  private probePromise: Promise<ProbeResult> | null = null;
  private client: AtlassianClient | null = null;

  constructor(
    private readonly auth: AtlassianAuth,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
  ) {}

  async verifyAuth(): Promise<VerifyResult> {
    // An explicit verify always re-probes: health must reflect NOW, and a fixed
    // token must not stay condemned by a cached failure.
    this.probePromise = probeAtlassian(this.auth, this.fetchImpl);
    this.client = null;
    const { apiBases: _apiBases, ...result } = await this.probePromise;
    return result;
  }

  /** Probe once and keep the resolved bases; failed probes are not cached, so a
   *  transient outage doesn't poison every later pull. */
  private async getClient(): Promise<AtlassianClient> {
    if (this.client) return this.client;
    this.probePromise ??= probeAtlassian(this.auth, this.fetchImpl);
    const probe = await this.probePromise;
    if (!probe.ok) {
      this.probePromise = null;
      throw new Error(probe.error ?? `Atlassian connection ${probe.health}`);
    }
    this.client = new AtlassianClient(
      {
        baseUrl: this.auth.siteUrl,
        email: this.auth.email,
        token: this.auth.apiToken,
        apiBases: probe.apiBases,
      },
      this.fetchImpl,
    );
    return this.client;
  }

  async listContainers(): Promise<ExternalContainer[]> {
    const client = await this.getClient();
    const [projects, spaces] = await Promise.all([client.listProjects(), client.listSpaces()]);
    return [
      ...projects.map((p): ExternalContainer => ({ kind: 'ticket', id: p.key, name: p.name })),
      ...spaces.map((s): ExternalContainer => ({ kind: 'wikipage', id: s.key, name: s.name })),
    ];
  }

  async pullChanges(
    container: ExternalContainer,
    sinceHighWaterMark: string | null,
    opts?: { now?: number },
  ): Promise<PullResult> {
    const client = await this.getClient();
    const now = opts?.now ?? Date.now();
    const window = sinceHighWaterMark ? minutesSince(sinceHighWaterMark, now) : null;

    let changes: ShallowChange[];
    if (container.kind === 'ticket') {
      // Clauses join with AND; ORDER BY sits outside the boolean expression.
      const clauses = [
        `project = ${quoteJql(container.id)}`,
        ...(window !== null ? [`updated >= "-${window}m"`] : []),
      ];
      const jql = `${clauses.join(' AND ')} ORDER BY updated ASC`;
      const issues = await client.searchIssuesMeta(jql);
      changes = issues.map((i) => this.toTicketChange(i, container.id, now));
    } else {
      const clauses = [
        `space = ${quoteJql(container.id)}`,
        'type = page',
        ...(window !== null ? [`lastmodified > now("-${window}m")`] : []),
      ];
      const cql = `${clauses.join(' AND ')} ORDER BY lastmodified ASC`;
      const pages = await client.searchPagesMeta(cql);
      changes = pages.map((p) => toPageChange(p, container.id, now));
    }

    return {
      changes,
      highWaterMark: changes.at(-1)?.remote_updated ?? sinceHighWaterMark,
    };
  }

  private toTicketChange(i: JiraIssueMeta, container: string, now: number): ShallowChange {
    return {
      kind: 'ticket',
      external_id: i.key,
      container,
      title: i.summary,
      state: i.status,
      state_category: this.mapStateCategory(i.status, i.statusCategory),
      ...(i.assignee ? { assignee: i.assignee } : {}),
      remote_updated: i.updated ?? new Date(now).toISOString(),
      url: i.url,
    };
  }

  /**
   * Tracked items, pulled by id regardless of which project or space they live
   * in. No high-water mark is possible here (there's no "changed since" to hang
   * one on for an arbitrary id set), so this re-reads the same handful of items
   * every tick — cheap, because it's one request per 50 ids and the mirror
   * writer skips anything whose `remote_updated` hasn't moved.
   */
  async pullByKeys(kind: ContainerKind, externalIds: string[]): Promise<ShallowChange[]> {
    if (kind === 'calendar') return [];
    const ids = [...new Set(externalIds.map((id) => id.trim()).filter(Boolean))];
    if (ids.length === 0) return [];
    const client = await this.getClient();
    const out: ShallowChange[] = [];
    for (let i = 0; i < ids.length; i += KEY_BATCH) {
      out.push(...(await this.pullBatch(client, kind, ids.slice(i, i + KEY_BATCH))));
    }
    return out;
  }

  /**
   * Jira rejects the WHOLE query when a single key doesn't resolve ("does not
   * exist or you do not have permission"), so one typo'd `[[FOO-1]]` in a note
   * would otherwise stop every tracked ticket from syncing — silently, forever.
   * Halve and retry: the bad ids get isolated and dropped, the good ones still
   * come back. Depth is log2(50) ≈ 6 in the pathological case.
   */
  private async pullBatch(
    client: AtlassianClient,
    kind: ContainerKind,
    ids: string[],
  ): Promise<ShallowChange[]> {
    try {
      return await this.searchByIds(client, kind, ids);
    } catch (err) {
      if (!isBadQuery(err)) throw err;
      // A lone id that the provider won't resolve is gone or invisible to these
      // credentials. Dropping it quietly is right: the note keeps its link, we
      // just have nothing to show for it.
      if (ids.length === 1) return [];
      const mid = Math.ceil(ids.length / 2);
      const [head, tail] = [ids.slice(0, mid), ids.slice(mid)];
      return [
        ...(await this.pullBatch(client, kind, head)),
        ...(await this.pullBatch(client, kind, tail)),
      ];
    }
  }

  private async searchByIds(
    client: AtlassianClient,
    kind: ContainerKind,
    ids: string[],
  ): Promise<ShallowChange[]> {
    const now = Date.now();
    if (kind === 'ticket') {
      const jql = `key in (${ids.map(quoteJql).join(', ')}) ORDER BY updated ASC`;
      const issues = await client.searchIssuesMeta(jql);
      return issues.map((i) => this.toTicketChange(i, projectKeyOf(i.key), now));
    }
    const cql = `id in (${ids.map(quoteJql).join(', ')})`;
    const pages = await client.searchPagesMeta(cql);
    // Confluence search doesn't say which space a page lives in, and we won't
    // spend a request per page to find out — the sync engine keeps whatever
    // container it already recorded rather than blanking it.
    return pages.map((p) => toPageChange(p, '', now));
  }

  async fetchFull(kind: ContainerKind, externalId: string): Promise<FullItem> {
    const client = await this.getClient();
    if (kind === 'ticket') {
      const issue = await client.getIssue(externalId);
      const { comments, total } = await client.getComments(externalId, 10);
      // API order is newest-first; the note reads chronologically.
      const chronological = [...comments].reverse();
      // Disclose truncation: `ask` cites this note as the thread, so a 100-
      // comment epic must say it's showing the last ten, not pose as complete.
      const hidden = total - comments.length;
      const truncationNote =
        hidden > 0
          ? `_${hidden} earlier comment${hidden === 1 ? '' : 's'} not mirrored — open the ticket for the full thread._\n\n`
          : '';
      const commentBlock = chronological.length
        ? `\n\n## Recent comments\n\n${truncationNote}${chronological
            .map((c) => `**${c.author ?? 'Unknown'}** — ${c.created?.slice(0, 10) ?? ''}\n\n${c.body}`.trim())
            .join('\n\n---\n\n')}`
        : '';
      const links = issue.links.map((l): TicketLink => mapJiraLink(l.typeName, l.key, l.outward));
      return {
        kind,
        external_id: issue.key,
        title: issue.summary,
        url: issue.url,
        bodyMarkdown: `${issue.description.trim()}${commentBlock}`.trim(),
        state: issue.status,
        state_category: this.mapStateCategory(issue.status, issue.statusCategory),
        ...(issue.assignee ? { assignee: issue.assignee } : {}),
        ...(issue.parentKey ? { parentKey: issue.parentKey } : {}),
        ...(links.length ? { links } : {}),
        ...(issue.updated ? { remote_updated: issue.updated } : {}),
      };
    }
    const page = await client.getPage(externalId);
    return {
      kind,
      external_id: page.id,
      title: page.title,
      url: page.url,
      bodyMarkdown: page.body.trim(),
      ...(page.version !== null ? { version: page.version } : {}),
      ...(page.lastModified ? { remote_updated: page.lastModified } : {}),
    };
  }

  mapStateCategory(rawState: string, categoryHint?: string | null): StateCategory {
    return mapJiraStateCategory(rawState, categoryHint);
  }

  async execute(payload: unknown): Promise<ExecuteResult> {
    // Re-validate the stored card payload here — legacy records normalize to the
    // generic vocabulary in the same parse.
    const parsed = zOutboundPayload.safeParse(payload);
    if (!parsed.success) {
      throw new Error(`invalid outbound payload: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    }
    const p = parsed.data;
    const client = await this.getClient();

    if (p.provider === 'jira' && p.action === 'create_ticket') {
      if (!p.projectKey) throw new Error('create_ticket requires projectKey');
      const out = await client.createIssue({
        projectKey: p.projectKey,
        issueType: p.issueType,
        summary: p.title ?? '',
        descriptionMarkdown: p.body,
      });
      return { externalId: out.key, url: out.url };
    }
    if (p.provider === 'jira' && p.action === 'comment_ticket') {
      if (!p.issueKey) throw new Error('comment_ticket requires issueKey');
      const out = await client.addComment(p.issueKey, p.body);
      return { externalId: p.issueKey, url: out.url };
    }
    if (p.provider === 'confluence' && p.action === 'update_page') {
      if (!p.pageId) throw new Error('update_page requires pageId');
      // `patch` = a localized in-place edit on the page's live text (replace
      // semantics, no markdown round-trip); absent, the body is appended as a
      // new section. Provenance rides along as one trailing line in both modes.
      const out = await client.updatePage(
        p.pageId,
        p.patch
          ? { mode: 'replace', search: p.patch.search, replace: p.patch.replace, provenance: p.provenance }
          : { mode: 'append', markdown: p.body, provenance: p.provenance },
      );
      return { externalId: out.id, url: out.url };
    }
    throw new Error(`unsupported outbound action for this connector: ${p.provider}/${p.action}`);
  }
}

export const atlassianConnector: ConnectorProvider<AtlassianAuthInput> = {
  id: 'atlassian',
  label: 'Jira + Confluence',
  authSchema: atlassianAuthSchema,
  create: (creds, opts) => new AtlassianConnector(creds, opts?.fetchImpl),
};
