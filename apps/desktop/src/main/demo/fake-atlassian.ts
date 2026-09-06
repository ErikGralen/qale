/**
 * The fake Jira + Confluence (docs/demo-mode.md DM-8): a `FetchLike` that
 * answers the REST endpoints the Atlassian connector uses from an in-memory
 * store seeded by a fixture. Nothing leaves the process.
 *
 * The store is the Rota cast: `demo/atlassian-fixture.json` is generated from
 * scripts/lib/atlassian-cast.ts and the static mirrors in vault-dev/, so the
 * keys, page ids and site URL already match what the demo vault says. Dates in
 * the fixture are anchored on 2026-07-17 and slid by `dateOffsetDays` at load,
 * the same slide Reset gives the vault.
 *
 * Writes (create issue, add comment, transition, update page) mutate the store
 * and persist to `statePath`, so a relaunch keeps them until Reset. Scripted
 * steps let the presenter move the tracker on cue, e.g. "PAY-161 goes Done".
 *
 * The query languages are the thin part. This answers the exact JQL and CQL
 * shapes the connector builds (project/space filter, key list, relative
 * `updated`/`lastmodified` window, order by update time) plus a substring `~`
 * for the agent's own searches. Anything it does not understand is ignored
 * rather than refused: a demo that answers too much beats one that errors.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FetchLike } from '@qale/connectors';

export interface FakeAtlassianOptions {
  /** The generated fixture (`demo/atlassian-fixture.json`), anchored dates. */
  fixturePath: string;
  /** Where mutations persist between launches (`<userData>/demo/atlassian.json`). */
  statePath: string;
  /** Days to slide fixture date tokens by at load (today − anchor). */
  dateOffsetDays: number;
  /** The site the mirrors name, e.g. `https://tavla.atlassian.net`. */
  siteUrl: string;
  /** Overrides the fixture's account, for a demo run under another name. */
  self?: Partial<FakeSelf>;
  /** Clock, for tests. Writes stamp `updated` with it. */
  now?: () => number;
}

/** A scripted change the presenter can trigger (e.g. "WO-231 goes Done"). */
export interface DemoStep {
  id: string;
  label: string;
  applied: boolean;
}

export interface FakeAtlassian {
  fetchImpl: FetchLike;
  /** Back to the fixture, mutations and steps forgotten. */
  reset(): void;
  steps(): DemoStep[];
  /** Apply one scripted step. False if unknown or already applied. */
  applyStep(id: string): boolean;
}

// ---------------------------------------------------------------------------
// The fixture, which is also the store: a write mutates it and it is written
// back to statePath as is.
// ---------------------------------------------------------------------------

export interface FakeSelf {
  accountId: string;
  displayName: string;
  emailAddress: string;
}

export interface FakeComment {
  id: string;
  author: string;
  created: string;
  body: string;
}

/** `outward` = this issue applies the type's outward description ("blocks X"). */
export interface FakeIssueLink {
  type: string;
  key: string;
  outward: boolean;
}

export interface FakeIssue {
  id: string;
  key: string;
  projectKey: string;
  summary: string;
  /** Plain text. The ADF the API returns is built from it on the way out. */
  description: string;
  issueType: string;
  status: string;
  statusCategory: StatusCategory;
  labels: string[];
  assignee: string | null;
  reporter: string;
  created: string;
  updated: string;
  parentKey?: string;
  comments: FakeComment[];
  links: FakeIssueLink[];
}

export interface FakePage {
  id: string;
  title: string;
  spaceKey: string;
  version: number;
  /** Storage XHTML, as Confluence stores it. */
  body: string;
  created: string;
  updated: string;
  /** Site-relative link, e.g. `/spaces/PRODUCT/pages/910231`. */
  webui: string;
}

export interface FakeProject {
  id: string;
  key: string;
  name: string;
}

export interface FakeSpace {
  id: string;
  key: string;
  name: string;
}

export type FakeChange =
  | { kind: 'transition'; key: string; to: string }
  | { kind: 'comment'; key: string; author: string; body: string }
  | { kind: 'page'; id: string; body: string };

export interface FakeStep {
  id: string;
  label: string;
  changes: FakeChange[];
  /**
   * Ids of the steps this one comes after. `applyStep` applies each of them
   * first if it is not applied yet, so a presenter can jump straight to a late
   * step and still get a tracker that reads in order. Steps that have nothing
   * to do with each other name nothing here and stay independent.
   */
  requires?: string[];
}

export interface AtlassianFixture {
  /** The date every date token in the fixture is written against. */
  anchor: string;
  siteUrl: string;
  self: FakeSelf;
  projects: FakeProject[];
  spaces: FakeSpace[];
  issues: FakeIssue[];
  pages: FakePage[];
  steps?: FakeStep[];
  /** Steps already applied. Absent in a fixture, written in a saved state. */
  appliedStepIds?: string[];
}

type StatusCategory = 'new' | 'indeterminate' | 'done';

/** The workflow the demo site has. Transitions are all-to-all, as a Kanban
 *  board is by default, so any status can follow any other. */
const STATUSES: { name: string; category: StatusCategory }[] = [
  { name: 'To Do', category: 'new' },
  { name: 'In Progress', category: 'indeterminate' },
  { name: 'In Review', category: 'indeterminate' },
  { name: 'Blocked', category: 'indeterminate' },
  { name: 'Done', category: 'done' },
];

function categoryOf(status: string): StatusCategory {
  const known = STATUSES.find((s) => s.name.toLowerCase() === status.toLowerCase());
  return known?.category ?? 'indeterminate';
}

const DATE_RE = /\d{4}-\d{2}-\d{2}/g;

/** Slide every `YYYY-MM-DD` in a string, timestamps included: an ISO stamp
 *  begins with one, so one rule covers prose, due dates and `updated`. */
function slideText(text: string, days: number): string {
  if (days === 0) return text;
  return text.replace(DATE_RE, (iso) => {
    const parts = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(parts[0] ?? 1970, (parts[1] ?? 1) - 1, parts[2] ?? 1));
    dt.setUTCDate(dt.getUTCDate() + days);
    return dt.toISOString().slice(0, 10);
  });
}

function slide<T>(value: T, days: number): T {
  if (typeof value === 'string') return slideText(value, days) as T;
  if (Array.isArray(value)) return value.map((v) => slide(v, days)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = slide(v, days);
    return out as T;
  }
  return value;
}

// ---------------------------------------------------------------------------
// ADF, both ways. The client sends ADF on a write and reads ADF on a read.
// ---------------------------------------------------------------------------

function textToAdf(text: string): unknown {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return {
    version: 1,
    type: 'doc',
    content: paragraphs.map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p }] })),
  };
}

function adfToText(node: unknown): string {
  if (typeof node === 'string') return node;
  if (!node || typeof node !== 'object') return '';
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === 'text') return n.text ?? '';
  const inner = (n.content ?? []).map(adfToText);
  return n.type === 'doc' || n.type === 'bulletList' ? inner.join('\n\n') : inner.join('');
}

// ---------------------------------------------------------------------------
// JQL and CQL, the subset the connector builds.
// ---------------------------------------------------------------------------

interface Query {
  container?: string;
  ids?: string[];
  /** Cutoff in ms, from a relative window like `-38m` or `-90d`. */
  since?: number;
  mine: boolean;
  text?: string;
  descending: boolean;
}

const UNIT_MS: Record<string, number> = {
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

function relativeCutoff(amount: string, unit: string, now: number): number | undefined {
  const ms = UNIT_MS[unit.toLowerCase()];
  if (!ms) return undefined;
  return now - Number(amount) * ms;
}

function unquote(raw: string): string {
  return raw
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function idList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => unquote(s))
    .filter(Boolean);
}

/** One parser for both languages: the clause names differ, the shapes do not. */
function parseQuery(raw: string, field: 'updated' | 'lastmodified', now: number): Query {
  const query: Query = { mine: /currentUser\(\)/i.test(raw), descending: false };
  const order = new RegExp(`ORDER\\s+BY\\s+${field}\\s*(ASC|DESC)?`, 'i').exec(raw);
  if (order) query.descending = (order[1] ?? '').toUpperCase() === 'DESC';
  const container = /\b(?:project|space)\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+)/i.exec(
    raw,
  );
  if (container?.[1]) query.container = unquote(container[1]);
  const ids = /\b(?:key|id)\s+in\s*\(([^)]*)\)/i.exec(raw);
  if (ids?.[1]) query.ids = idList(ids[1]);
  const window = new RegExp(
    `${field}\\s*>=?\\s*(?:now\\()?\\s*["']?-(\\d+)([mhdw])["']?\\s*\\)?`,
    'i',
  ).exec(raw);
  if (window?.[1] && window[2]) query.since = relativeCutoff(window[1], window[2], now);
  const text = /\b(?:text|summary|title)\s*~\s*("(?:[^"\\]|\\.)*"|'[^']*'|\S+)/i.exec(raw);
  if (text?.[1]) query.text = unquote(text[1]).toLowerCase();
  return query;
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

interface Store extends AtlassianFixture {
  steps: FakeStep[];
  appliedStepIds: string[];
}

function loadStore(path: string, dateOffsetDays: number, fromFixture: boolean): Store {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as AtlassianFixture;
  // A saved state was slid when it was seeded; sliding it again would move
  // every date twice.
  const data = fromFixture ? slide(raw, dateOffsetDays) : raw;
  return {
    ...data,
    steps: data.steps ?? [],
    appliedStepIds: data.appliedStepIds ?? [],
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function notFound(what: string): Response {
  return json({ errorMessages: [`${what} not found`], errors: {} }, 404);
}

const GATEWAY = /^https:\/\/api\.atlassian\.com\/ex\/(?:jira|confluence)\/[^/]+/;

export function createFakeAtlassian(opts: FakeAtlassianOptions): FakeAtlassian {
  const site = opts.siteUrl.replace(/\/$/, '');
  const now = opts.now ?? Date.now;
  let store = seed();

  function seed(): Store {
    const fromState = existsSync(opts.statePath);
    const loaded = loadStore(
      fromState ? opts.statePath : opts.fixturePath,
      opts.dateOffsetDays,
      !fromState,
    );
    if (opts.self) loaded.self = { ...loaded.self, ...opts.self };
    return loaded;
  }

  function persist(): void {
    mkdirSync(dirname(opts.statePath), { recursive: true });
    writeFileSync(opts.statePath, `${JSON.stringify(store, null, 2)}\n`);
  }

  function stamp(): string {
    return new Date(now()).toISOString();
  }

  // -- reads ----------------------------------------------------------------

  function issue(key: string): FakeIssue | undefined {
    return store.issues.find((i) => i.key.toLowerCase() === key.toLowerCase());
  }

  function page(id: string): FakePage | undefined {
    return store.pages.find((p) => p.id === id);
  }

  function matchIssues(jql: string): FakeIssue[] {
    const q = parseQuery(jql, 'updated', now());
    const hits = store.issues.filter((i) => {
      if (q.container && i.projectKey.toLowerCase() !== q.container.toLowerCase()) return false;
      if (q.ids && !q.ids.some((id) => id.toLowerCase() === i.key.toLowerCase())) return false;
      if (q.since !== undefined && Date.parse(i.updated) < q.since) return false;
      if (q.mine && i.assignee !== store.self.displayName && i.reporter !== store.self.displayName)
        return false;
      if (q.text && !`${i.summary} ${i.description}`.toLowerCase().includes(q.text)) return false;
      return true;
    });
    hits.sort((a, b) => a.updated.localeCompare(b.updated));
    return q.descending ? hits.reverse() : hits;
  }

  function matchPages(cql: string): FakePage[] {
    const q = parseQuery(cql, 'lastmodified', now());
    const hits = store.pages.filter((p) => {
      if (q.container && p.spaceKey.toLowerCase() !== q.container.toLowerCase()) return false;
      if (q.ids && !q.ids.includes(p.id)) return false;
      if (q.since !== undefined && Date.parse(p.updated) < q.since) return false;
      if (q.text && !`${p.title} ${p.body}`.toLowerCase().includes(q.text)) return false;
      return true;
    });
    hits.sort((a, b) => a.updated.localeCompare(b.updated));
    return q.descending ? hits.reverse() : hits;
  }

  function issueJson(i: FakeIssue): unknown {
    return {
      id: i.id,
      key: i.key,
      self: `${site}/rest/api/3/issue/${i.id}`,
      fields: {
        summary: i.summary,
        description: textToAdf(i.description),
        issuetype: { name: i.issueType },
        project: { key: i.projectKey, name: projectName(i.projectKey) },
        labels: i.labels,
        status: {
          name: i.status,
          statusCategory: { key: i.statusCategory, name: i.status },
        },
        assignee: i.assignee ? { displayName: i.assignee } : null,
        reporter: { displayName: i.reporter },
        created: i.created,
        updated: i.updated,
        ...(i.parentKey ? { parent: { key: i.parentKey } } : {}),
        issuelinks: i.links.map((l, n) => ({
          id: `${i.id}-${n}`,
          type: {
            name: l.type,
            inward: `is ${l.type.toLowerCase()}ed by`,
            outward: l.type.toLowerCase(),
          },
          ...(l.outward
            ? { outwardIssue: { key: l.key, fields: { summary: issue(l.key)?.summary ?? '' } } }
            : { inwardIssue: { key: l.key, fields: { summary: issue(l.key)?.summary ?? '' } } }),
        })),
      },
    };
  }

  function projectName(key: string): string {
    return store.projects.find((p) => p.key === key)?.name ?? key;
  }

  function commentJson(c: FakeComment, key: string): unknown {
    return {
      id: c.id,
      self: `${site}/rest/api/3/issue/${key}/comment/${c.id}`,
      author: { displayName: c.author },
      body: textToAdf(c.body),
      created: c.created,
      updated: c.created,
    };
  }

  function pageSearchJson(p: FakePage): unknown {
    return {
      id: p.id,
      title: p.title,
      url: p.webui,
      excerpt: p.body
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200),
      lastModified: p.updated,
      content: {
        id: p.id,
        title: p.title,
        type: 'page',
        space: { key: p.spaceKey, name: spaceName(p.spaceKey) },
        version: { number: p.version, when: p.updated },
        _links: { webui: p.webui },
      },
      resultGlobalContainer: { title: spaceName(p.spaceKey), displayUrl: `/spaces/${p.spaceKey}` },
    };
  }

  function spaceName(key: string): string {
    return store.spaces.find((s) => s.key === key)?.name ?? key;
  }

  function pageJson(p: FakePage): unknown {
    return {
      id: p.id,
      title: p.title,
      status: 'current',
      spaceId: store.spaces.find((s) => s.key === p.spaceKey)?.id ?? '',
      body: { storage: { value: p.body, representation: 'storage' } },
      version: { number: p.version, createdAt: p.updated, message: '' },
      _links: { webui: p.webui },
    };
  }

  // -- writes ---------------------------------------------------------------

  function nextKey(projectKey: string): string {
    const used = store.issues
      .filter((i) => i.projectKey === projectKey)
      .map((i) => Number(i.key.split('-')[1] ?? 0));
    return `${projectKey}-${Math.max(0, ...used) + 1}`;
  }

  function nextId(): string {
    const used = store.issues.map((i) => Number(i.id) || 0);
    return String(Math.max(10_000, ...used) + 1);
  }

  function nextCommentId(): string {
    const used = store.issues.flatMap((i) => i.comments.map((c) => Number(c.id) || 0));
    return String(Math.max(100_000, ...used) + 1);
  }

  function addComment(target: FakeIssue, author: string, body: string): FakeComment {
    const created = stamp();
    const comment: FakeComment = { id: nextCommentId(), author, created, body };
    target.comments.push(comment);
    target.updated = created;
    return comment;
  }

  function transition(target: FakeIssue, status: string): void {
    target.status = status;
    target.statusCategory = categoryOf(status);
    target.updated = stamp();
  }

  function applyChange(change: FakeChange): void {
    if (change.kind === 'page') {
      const target = page(change.id);
      if (!target) return;
      target.body = change.body;
      target.version += 1;
      target.updated = stamp();
      return;
    }
    const target = issue(change.key);
    if (!target) return;
    if (change.kind === 'transition') transition(target, change.to);
    else addComment(target, change.author, change.body);
  }

  // -- the router -----------------------------------------------------------

  async function route(url: string, init?: RequestInit): Promise<Response> {
    const path = pathOf(url);
    if (path === null) return notFound('host');
    const [pathname, search] = path.split('?');
    const params = new URLSearchParams(search ?? '');
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = parseBody(init?.body);

    // Jira ------------------------------------------------------------------
    if (pathname === '/rest/api/3/myself') return json(store.self);
    if (pathname === '/rest/api/3/serverInfo') return json({ baseUrl: site, version: '1001.0.0' });

    if (pathname === '/rest/api/3/search/jql' && method === 'POST') {
      const jql = String(body['jql'] ?? '');
      const pageSize = Number(body['maxResults'] ?? 50);
      const from = Number(body['nextPageToken'] ?? 0);
      const hits = matchIssues(jql);
      const slice = hits.slice(from, from + pageSize);
      const last = from + slice.length >= hits.length;
      return json({
        issues: slice.map(issueJson),
        isLast: last,
        ...(last ? {} : { nextPageToken: String(from + slice.length) }),
      });
    }
    if (pathname === '/rest/api/3/search/approximate-count' && method === 'POST') {
      return json({ count: matchIssues(String(body['jql'] ?? '')).length });
    }
    if (pathname === '/rest/api/3/project/search') {
      const startAt = Number(params.get('startAt') ?? 0);
      const max = Number(params.get('maxResults') ?? 50);
      const slice = store.projects.slice(startAt, startAt + max);
      return json({
        values: slice.map((p) => ({ id: p.id, key: p.key, name: p.name })),
        startAt,
        maxResults: max,
        total: store.projects.length,
        isLast: startAt + slice.length >= store.projects.length,
      });
    }
    if (pathname === '/rest/api/3/issue' && method === 'POST') {
      const fields = (body['fields'] ?? {}) as Record<string, unknown>;
      const projectKey = String((fields['project'] as { key?: string })?.key ?? '');
      if (!store.projects.some((p) => p.key === projectKey)) return notFound('project');
      const created: FakeIssue = {
        id: nextId(),
        key: nextKey(projectKey),
        projectKey,
        summary: String(fields['summary'] ?? ''),
        description: adfToText(fields['description']),
        issueType: String((fields['issuetype'] as { name?: string })?.name ?? 'Task'),
        status: 'To Do',
        statusCategory: 'new',
        labels: Array.isArray(fields['labels']) ? (fields['labels'] as string[]) : [],
        assignee: null,
        reporter: store.self.displayName,
        created: stamp(),
        updated: stamp(),
        comments: [],
        links: [],
      };
      store.issues.push(created);
      persist();
      return json(
        { id: created.id, key: created.key, self: `${site}/rest/api/3/issue/${created.id}` },
        201,
      );
    }

    const issuePath = /^\/rest\/api\/3\/issue\/([^/]+)(\/comment|\/transitions|\/assignee)?$/.exec(
      pathname ?? '',
    );
    if (issuePath?.[1]) {
      const target = issue(decodeURIComponent(issuePath[1]));
      if (!target) return notFound('issue');
      const tail = issuePath[2];
      if (!tail && method === 'GET') return json(issueJson(target));
      if (tail === '/comment' && method === 'GET') {
        const max = Number(params.get('maxResults') ?? 50);
        const newestFirst = [...target.comments].reverse();
        const slice = newestFirst.slice(0, max);
        return json({
          comments: slice.map((c) => commentJson(c, target.key)),
          startAt: 0,
          maxResults: max,
          total: target.comments.length,
        });
      }
      if (tail === '/comment' && method === 'POST') {
        const added = addComment(target, store.self.displayName, adfToText(body['body']));
        persist();
        return json(commentJson(added, target.key), 201);
      }
      if (tail === '/transitions' && method === 'GET') {
        return json({
          transitions: STATUSES.map((s, n) => ({
            id: String(n + 1),
            name: s.name,
            to: { name: s.name, statusCategory: { key: s.category } },
          })),
        });
      }
      if (tail === '/transitions' && method === 'POST') {
        const id = String((body['transition'] as { id?: string })?.id ?? '');
        const to = STATUSES[Number(id) - 1];
        if (!to) return notFound('transition');
        transition(target, to.name);
        persist();
        return new Response(null, { status: 204 });
      }
      if (tail === '/assignee' && method === 'PUT') {
        target.assignee = store.self.displayName;
        target.updated = stamp();
        persist();
        return new Response(null, { status: 204 });
      }
    }

    // Confluence ------------------------------------------------------------
    if (pathname === '/wiki/rest/api/space') {
      const limit = Number(params.get('limit') ?? 25);
      return json({
        results: store.spaces.slice(0, limit).map((s) => ({ id: s.id, key: s.key, name: s.name })),
        size: Math.min(limit, store.spaces.length),
        limit,
      });
    }
    if (pathname === '/wiki/api/v2/spaces') {
      return json({
        results: store.spaces.map((s) => ({ id: s.id, key: s.key, name: s.name })),
        _links: {},
      });
    }
    if (pathname === '/wiki/rest/api/search') {
      const cql = params.get('cql') ?? '';
      const start = Number(params.get('start') ?? 0);
      const limit = Number(params.get('limit') ?? 25);
      const hits = matchPages(cql);
      const slice = hits.slice(start, start + limit);
      return json({
        results: slice.map(pageSearchJson),
        start,
        limit,
        size: slice.length,
        totalSize: hits.length,
      });
    }
    const spacePages = /^\/wiki\/api\/v2\/spaces\/([^/]+)\/pages$/.exec(pathname ?? '');
    if (spacePages?.[1]) {
      const space = store.spaces.find((s) => s.id === spacePages[1] || s.key === spacePages[1]);
      if (!space) return notFound('space');
      return json({
        results: store.pages.filter((p) => p.spaceKey === space.key).map(pageJson),
        _links: {},
      });
    }
    const pagePath = /^\/wiki\/api\/v2\/pages\/([^/]+)$/.exec(pathname ?? '');
    if (pagePath?.[1]) {
      const target = page(decodeURIComponent(pagePath[1]));
      if (!target) return notFound('page');
      if (method === 'GET') return json(pageJson(target));
      if (method === 'PUT') {
        const version = Number((body['version'] as { number?: number })?.number ?? 0);
        // Confluence refuses an update written against a version that has
        // moved on. The card layer turns this into "changed since this was
        // drafted", which is a beat the demo should be able to show.
        if (version !== target.version + 1) {
          return json(
            {
              statusCode: 409,
              message: `Version must be incremented on update. Current version is ${target.version}.`,
            },
            409,
          );
        }
        const value = (body['body'] as { value?: string })?.value;
        target.body = String(value ?? target.body);
        target.title = String(body['title'] ?? target.title);
        target.version = version;
        target.updated = stamp();
        persist();
        return json(pageJson(target));
      }
    }

    return notFound(`${method} ${pathname}`);
  }

  /** Site or gateway path, or null for a host this fake does not serve. */
  function pathOf(url: string): string | null {
    if (url.startsWith(site)) return url.slice(site.length);
    const gateway = GATEWAY.exec(url);
    if (gateway) return url.slice(gateway[0].length);
    return null;
  }

  /** One step and, before it, every step it requires that is still open.
   *  `pending` breaks a cycle in a hand-edited fixture. */
  function applyStepWithRequires(id: string, pending: Set<string>): boolean {
    const step = store.steps.find((s) => s.id === id);
    if (!step || store.appliedStepIds.includes(id) || pending.has(id)) return false;
    pending.add(id);
    for (const required of step.requires ?? []) applyStepWithRequires(required, pending);
    for (const change of step.changes) applyChange(change);
    store.appliedStepIds.push(id);
    return true;
  }

  return {
    fetchImpl: (url, init) => route(url, init),
    reset(): void {
      rmSync(opts.statePath, { force: true });
      store = seed();
    },
    steps(): DemoStep[] {
      return store.steps.map((s) => ({
        id: s.id,
        label: s.label,
        applied: store.appliedStepIds.includes(s.id),
      }));
    },
    applyStep(id: string): boolean {
      const applied = applyStepWithRequires(id, new Set());
      if (applied) persist();
      return applied;
    },
  };
}

/** Request bodies arrive as the JSON string the client wrote. */
function parseBody(body: unknown): Record<string, unknown> {
  if (typeof body !== 'string' || !body) return {};
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
