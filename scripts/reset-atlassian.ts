/**
 * Converge the live Atlassian demo site to the Rota baseline, the scripted
 * counterpart of docs/jira-demo-setup.md. One command both seeds a fresh site
 * and resets it after a demo run; it always drives toward the same desired
 * state, so run it as often as you like.
 *
 * What it converges:
 *  - Jira `SCH`, `APP` and `PLT`: the cast issues exist (two epics In Progress
 *    with their stories, the platform tasks, the staff-app filler),
 *    descriptions and statuses match, every issue carries its one area label,
 *    both epics are assigned to you, and comment threads are reset to the
 *    seeds. Issues NOT in the cast, such as the swap-notification story the
 *    after-meeting demo creates live, are DELETED (skip with --keep-extras).
 *  - Confluence: the "Product" space exists; "Roadmap H2" and "Product weekly
 *    update" are rewritten to their canonical bodies from
 *    vault-dev/wikipages/confluence/, which un-does the roadmap re-order and
 *    the weekly-update appends. Extra pages are listed but never deleted.
 *  - The runtime vault (.vault-dev): the canonical scenario ships with STATIC
 *    mirrors (tickets/jira/SCH-231.md, fake rota.atlassian.net URLs, made-up
 *    page ids) so the demo works offline. Against a live site those are wrong:
 *    the keys don't exist and outbound/librarian cards would target dead ids.
 *    So the script renames the static ticket mirrors to the live keys, rewrites
 *    every [[SCH-231]] link and prose mention across the vault, swaps the fake
 *    host for the real site, and re-points the wikipage external_ids. The
 *    canonical vault-dev/ is NEVER touched. After each `pnpm refresh-demo` the
 *    static ids are back, so re-run this script (that order: refresh, then
 *    reset). --no-reconcile skips it; --vault=path targets a different copy.
 *
 * Dates: the canonical scenario is anchored on 2026-07-17 (see
 * scripts/refresh-demo.ts). Every date token in summaries, descriptions,
 * comments and page bodies is slid by (today − anchor) so the live site tells
 * the same story as the refreshed .vault-dev. Run both the same day.
 *
 * What stays manual (once, ~10 min, see docs/jira-demo-setup.md):
 *  - the free Jira+Confluence site and the API token;
 *  - the three projects themselves: SCH (Scheduling), APP (Staff app) and PLT
 *    (Platform). The REST API cannot create a project on a free site, so the
 *    script only verifies them and names the ones that are missing. Their
 *    workflows need the plain "To Do" / "In Progress" / "Done" statuses, which
 *    is what every default template gives you.
 *
 *   pnpm reset-atlassian --site=rota-demo.atlassian.net --email=you@x --token=... --save
 *   pnpm reset-atlassian                  # creds from .atlassian-demo.json / env
 *   pnpm reset-atlassian --dry            # print the plan, write nothing
 *   pnpm reset-atlassian --keep-extras    # don't delete non-cast issues
 *   pnpm reset-atlassian --today=2026-09-01 --anchor=2026-07-17
 *
 * Credentials resolve flags → env (ATLASSIAN_SITE / ATLASSIAN_EMAIL /
 * ATLASSIAN_TOKEN) → .atlassian-demo.json (gitignored; --save writes it,
 * mode 600). Both unscoped and scoped tokens work: like the app's probe, an
 * auth refusal on the site retries via the api.atlassian.com gateway.
 */
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import {
  ANCHOR,
  CAST,
  CAST_LINKS,
  DATE_RE,
  FRONTMATTER_RE,
  PAGES,
  PROJECT_KEYS,
  PROJECT_NAMES,
  SPACE_KEY,
  SPACE_NAME,
  STATIC_HOST,
  STATIC_PAGE_IDS,
  STATIC_TICKETS,
  markdownToStorage,
} from './lib/atlassian-cast.ts';
import type { CastIssue } from './lib/atlassian-cast.ts';

const CREDS_FILE = '.atlassian-demo.json';

// ---------------------------------------------------------------------------
// Args & credentials
// ---------------------------------------------------------------------------

interface Args {
  site?: string;
  email?: string;
  token?: string;
  anchor: string;
  today: string;
  dry: boolean;
  keepExtras: boolean;
  save: boolean;
  vault: string;
  reconcile: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    anchor: ANCHOR,
    today: new Date().toISOString().slice(0, 10),
    dry: false,
    keepExtras: false,
    save: false,
    vault: '.vault-dev',
    reconcile: true,
  };
  for (const a of argv) {
    if (a === '--dry' || a === '--dry-run') args.dry = true;
    else if (a === '--keep-extras') args.keepExtras = true;
    else if (a === '--save') args.save = true;
    else if (a === '--no-reconcile') args.reconcile = false;
    else if (a.startsWith('--vault=')) args.vault = a.slice(8);
    else if (a.startsWith('--site=')) args.site = a.slice(7);
    else if (a.startsWith('--email=')) args.email = a.slice(8);
    else if (a.startsWith('--token=')) args.token = a.slice(8);
    else if (a.startsWith('--anchor=')) args.anchor = a.slice(9);
    else if (a.startsWith('--today=')) args.today = a.slice(8);
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

interface Creds {
  siteUrl: string;
  email: string;
  apiToken: string;
}

function resolveCreds(args: Args, credsPath: string): Creds {
  let file: Partial<Creds> = {};
  if (existsSync(credsPath)) {
    try {
      file = JSON.parse(readFileSync(credsPath, 'utf8'));
    } catch {
      throw new Error(`${credsPath} exists but is not valid JSON — fix or delete it.`);
    }
  }
  const site = args.site ?? process.env['ATLASSIAN_SITE'] ?? file.siteUrl;
  const email = args.email ?? process.env['ATLASSIAN_EMAIL'] ?? file.email;
  const token = args.token ?? process.env['ATLASSIAN_TOKEN'] ?? file.apiToken;
  if (!site || !email || !token) {
    throw new Error(
      'Missing Atlassian credentials. Pass --site/--email/--token (add --save to remember them ' +
        `in ${CREDS_FILE}), or set ATLASSIAN_SITE / ATLASSIAN_EMAIL / ATLASSIAN_TOKEN.`,
    );
  }
  const trimmed = site.trim().replace(/\/+$/, '');
  return {
    siteUrl: /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
    email: email.trim(),
    apiToken: token.trim(),
  };
}

// ---------------------------------------------------------------------------
// Date shifting — same semantics as refresh-demo.ts (UTC day maths).
// ---------------------------------------------------------------------------

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

function shiftDates(text: string, offset: number): string {
  return text.replace(DATE_RE, (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + offset);
    return dt.toISOString().slice(0, 10);
  });
}

// ---------------------------------------------------------------------------
// Minimal Atlassian REST client: 429 backoff, scoped-token gateway fallback,
// plain-language errors with the response body attached for debugging.
// ---------------------------------------------------------------------------

class Api {
  private readonly creds: Creds;
  private jiraBase: string;
  private wikiBase: string;

  // node runs this via type stripping, so no TS parameter properties here.
  constructor(creds: Creds) {
    this.creds = creds;
    this.jiraBase = creds.siteUrl;
    this.wikiBase = creds.siteUrl;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Basic ${Buffer.from(`${this.creds.email}:${this.creds.apiToken}`).toString('base64')}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
  }

  /** Scoped tokens only answer via the api.atlassian.com gateway (see the
   *  app's probe.ts) — on an auth refusal, resolve the cloudId and re-route. */
  async connect(): Promise<{ accountId: string; displayName: string }> {
    let res = await this.raw(`${this.jiraBase}/rest/api/3/myself`);
    if (res.status === 401 || res.status === 403) {
      const tenant = await this.raw(`${this.creds.siteUrl}/_edge/tenant_info`);
      const cloudId = tenant.ok
        ? ((await tenant.json()) as { cloudId?: string }).cloudId
        : undefined;
      if (cloudId) {
        this.jiraBase = `https://api.atlassian.com/ex/jira/${cloudId}`;
        this.wikiBase = `https://api.atlassian.com/ex/confluence/${cloudId}`;
        res = await this.raw(`${this.jiraBase}/rest/api/3/myself`);
      }
    }
    if (!res.ok) {
      throw new Error(
        res.status === 401 || res.status === 403
          ? 'Atlassian rejected the credentials — check the email/token pair (and token expiry).'
          : `Could not verify credentials (HTTP ${res.status}).`,
      );
    }
    const me = (await res.json()) as { accountId: string; displayName?: string };
    return { accountId: me.accountId, displayName: me.displayName ?? this.creds.email };
  }

  private async raw(url: string, init?: RequestInit): Promise<Response> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(url, {
        ...init,
        headers: { ...this.headers(), ...(init?.headers ?? {}) },
      });
      if (res.status !== 429) return res;
      const seconds = Number(res.headers.get('Retry-After'));
      await new Promise((r) =>
        setTimeout(r, Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000),
      );
    }
    throw new Error('Atlassian is rate-limiting — try again in a minute.');
  }

  /** `path` starting with /wiki routes to Confluence, everything else to Jira. */
  async request<T = unknown>(path: string, init?: RequestInit): Promise<T> {
    const base = path.startsWith('/wiki') ? this.wikiBase : this.jiraBase;
    const res = await this.raw(`${base}${path}`, init);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(
        `${init?.method ?? 'GET'} ${path} → HTTP ${res.status}: ${text.slice(0, 400)}`,
      );
      (err as Error & { status: number; body: string }).status = res.status;
      (err as Error & { status: number; body: string }).body = text;
      throw err;
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }

  siteUrl(): string {
    return this.creds.siteUrl;
  }
}

// Markdown → ADF. Deliberately tiny: the cast descriptions and comments are
// plain paragraphs. The storage-XHTML side lives in scripts/lib/atlassian-cast.ts,
// so the fixture builder converts the canonical page bodies the same way.
// ---------------------------------------------------------------------------

/** Plain-paragraph ADF — the cast descriptions and comments carry no markup. */
function textToAdf(text: string): object {
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

/** Flatten an ADF doc back to plain text for equality checks. */
function adfToText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === 'text') return n.text ?? '';
  const inner = (n.content ?? []).map(adfToText);
  return n.type === 'doc' ? inner.join('\n\n') : inner.join('');
}

/** Whitespace-insensitive equality — remote round-trips normalize whitespace. */
function sameText(a: string, b: string): boolean {
  const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
  return norm(a) === norm(b);
}

/** Storage-XHTML equality, tolerant of the whitespace Confluence reshuffles. */
function sameStorage(a: string, b: string): boolean {
  const norm = (s: string): string => s.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();
  return norm(a) === norm(b);
}

// ---------------------------------------------------------------------------
// Jira convergence
// ---------------------------------------------------------------------------

interface LiveIssue {
  key: string;
  summary: string;
  status: string;
  issueType: string;
  description: string;
  assigneeId: string | null;
  labels: string[];
}

/** Every issue in the three cast projects, oldest first. One query: the extras
 *  sweep and the summary lookup both want the whole set at once. */
async function listProjectIssues(api: Api): Promise<LiveIssue[]> {
  const issues: LiveIssue[] = [];
  let nextPageToken: string | undefined;
  do {
    const page = await api.request<{
      issues?: {
        key: string;
        fields?: {
          summary?: string;
          status?: { name?: string };
          issuetype?: { name?: string };
          description?: unknown;
          assignee?: { accountId?: string } | null;
          labels?: string[];
        };
      }[];
      nextPageToken?: string;
    }>('/rest/api/3/search/jql', {
      method: 'POST',
      body: JSON.stringify({
        jql: `project IN (${PROJECT_KEYS.join(', ')}) ORDER BY created ASC`,
        fields: ['summary', 'status', 'issuetype', 'description', 'assignee', 'labels'],
        maxResults: 100,
        ...(nextPageToken ? { nextPageToken } : {}),
      }),
    });
    for (const raw of page.issues ?? []) {
      issues.push({
        key: raw.key,
        summary: raw.fields?.summary ?? '',
        status: raw.fields?.status?.name ?? '',
        issueType: raw.fields?.issuetype?.name ?? '',
        description: adfToText(raw.fields?.description),
        assigneeId: raw.fields?.assignee?.accountId ?? null,
        labels: raw.fields?.labels ?? [],
      });
    }
    nextPageToken = page.nextPageToken;
  } while (nextPageToken);
  return issues;
}

/** Some company-managed templates still require the legacy "Epic Name" custom
 *  field; on that exact failure, retry with every complained-about customfield
 *  set to the summary (Epic Name is a string field, so this converges). */
async function createIssue(
  api: Api,
  member: CastIssue,
  description: string,
  parentKey: string | null,
): Promise<string> {
  const fields: Record<string, unknown> = {
    project: { key: member.project },
    issuetype: { name: member.issueType },
    summary: member.summary,
    description: textToAdf(description),
    labels: [member.label],
    ...(parentKey ? { parent: { key: parentKey } } : {}),
  };
  try {
    const out = await api.request<{ key: string }>('/rest/api/3/issue', {
      method: 'POST',
      body: JSON.stringify({ fields }),
    });
    return out.key;
  } catch (err) {
    const body = (err as Error & { body?: string }).body ?? '';
    const requiredCustomFields = [...body.matchAll(/"(customfield_\d+)"/g)].map((m) => m[1]);
    if (!requiredCustomFields.length) throw err;
    for (const cf of requiredCustomFields) fields[cf] = member.summary;
    const out = await api.request<{ key: string }>('/rest/api/3/issue', {
      method: 'POST',
      body: JSON.stringify({ fields }),
    });
    return out.key;
  }
}

async function transitionTo(api: Api, key: string, targetStatus: string): Promise<boolean> {
  const data = await api.request<{ transitions?: { id: string; to?: { name?: string } }[] }>(
    `/rest/api/3/issue/${key}/transitions`,
  );
  const match = (data.transitions ?? []).find(
    (t) => (t.to?.name ?? '').toLowerCase() === targetStatus.toLowerCase(),
  );
  if (!match) return false;
  await api.request(`/rest/api/3/issue/${key}/transitions`, {
    method: 'POST',
    body: JSON.stringify({ transition: { id: match.id } }),
  });
  return true;
}

/** Rewrite the thread only when it deviates from the seeds — an unnecessary
 *  delete/re-post bumps the issue's `updated`, which re-syncs the mirror and
 *  makes every pending card drafted against it refuse once. */
async function resetComments(
  api: Api,
  key: string,
  seeds: string[],
  offset: number,
): Promise<boolean> {
  const expected = seeds.map((s) => shiftDates(s, offset));
  const data = await api.request<{ comments?: { id: string; body?: unknown }[] }>(
    `/rest/api/3/issue/${key}/comment?maxResults=100`,
  );
  const live = data.comments ?? [];
  if (
    live.length === expected.length &&
    live.every((c, i) => sameText(adfToText(c.body), expected[i]))
  ) {
    return false;
  }
  for (const c of live) {
    await api.request(`/rest/api/3/issue/${key}/comment/${c.id}`, { method: 'DELETE' });
  }
  for (const body of expected) {
    await api.request(`/rest/api/3/issue/${key}/comment`, {
      method: 'POST',
      body: JSON.stringify({ body: textToAdf(body) }),
    });
  }
  return true;
}

async function convergeJira(
  api: Api,
  accountId: string,
  cast: CastIssue[],
  offset: number,
  opts: { dry: boolean; keepExtras: boolean },
): Promise<Map<string, string>> {
  // Precondition: the three projects are the manual step. A free site's REST
  // API cannot create one, so name every missing key in a single message.
  const missing: string[] = [];
  for (const key of PROJECT_KEYS) {
    try {
      await api.request(`/rest/api/3/project/${key}`);
    } catch {
      missing.push(`${key} (${PROJECT_NAMES[key]})`);
    }
  }
  if (missing.length) {
    throw new Error(
      `Jira project(s) not found: ${missing.join(', ')}. Create them once by hand ` +
        '(docs/jira-demo-setup.md §3), then re-run.',
    );
  }
  // Every status the cast asks for has to exist in that project's workflow.
  // The defaults ("To Do", "In Progress", "Done") do, but a hand-built board
  // may not, and a missing one only shows up as an issue stuck in the wrong
  // column halfway through a demo.
  for (const key of PROJECT_KEYS) {
    const statusData = await api.request<{ statuses?: { name?: string }[] }[]>(
      `/rest/api/3/project/${key}/statuses`,
    );
    const have = new Set(
      statusData.flatMap((t) => (t.statuses ?? []).map((s) => (s.name ?? '').toLowerCase())),
    );
    const want = [...new Set(cast.filter((m) => m.project === key).map((m) => m.status))];
    const absent = want.filter((s) => !have.has(s.toLowerCase()));
    if (absent.length) {
      throw new Error(
        `The ${key} workflow has no ${absent.map((s) => `"${s}"`).join(' / ')} status. ` +
          'Add it by hand (docs/jira-demo-setup.md §3.2; the REST API cannot edit a ' +
          'company-managed workflow), then re-run.',
      );
    }
  }

  const live = await listProjectIssues(api);
  const bySummary = new Map(live.map((i) => [i.summary, i]));
  const castSummaries = new Set(cast.map((m) => m.summary));
  const keyBySummary = new Map<string, string>();

  // Extras first (the demo-created swap-notification story, edited-summary
  // strays): delete, so a renamed cast member is recreated cleanly below.
  const extras = live.filter((i) => !castSummaries.has(i.summary));
  for (const extra of extras) {
    console.log(
      `  − delete ${extra.key} "${extra.summary}"${opts.keepExtras ? ' (skipped: --keep-extras)' : ''}`,
    );
    if (!opts.dry && !opts.keepExtras) {
      await api.request(`/rest/api/3/issue/${extra.key}?deleteSubtasks=true`, { method: 'DELETE' });
    }
  }

  // Epics first so their stories can point at them.
  const ordered = [...cast].sort(
    (a, b) => Number(b.issueType === 'Epic') - Number(a.issueType === 'Epic'),
  );
  for (const member of ordered) {
    const description = shiftDates(member.description, offset);
    const existing = bySummary.get(member.summary);
    let key = existing?.key;
    const fixed: string[] = [];
    if (!existing) {
      console.log(
        `  + create ${member.project} ${member.issueType} "${member.summary}" → ${member.status}`,
      );
      if (opts.dry) continue;
      const parentKey = member.parent
        ? (keyBySummary.get(member.parent) ?? bySummary.get(member.parent)?.key ?? null)
        : null;
      key = await createIssue(api, member, description, parentKey);
    } else if (!opts.dry) {
      // Converge the fields the drafted-against-stale demo edits, plus the area
      // label the conventions skill names. Never touch a clean issue: every
      // gratuitous write bumps `updated` and stales pending cards on the next
      // sync, so the patch is built first and sent only if it holds something.
      const patch: Record<string, unknown> = {};
      if (!sameText(existing.description, description)) {
        patch['description'] = textToAdf(description);
        fixed.push('description');
      }
      if (existing.labels.length !== 1 || existing.labels[0] !== member.label) {
        patch['labels'] = [member.label];
        fixed.push(`label → ${member.label}`);
      }
      if (Object.keys(patch).length) {
        await api.request(`/rest/api/3/issue/${key}`, {
          method: 'PUT',
          body: JSON.stringify({ fields: patch }),
        });
      }
    }
    if (!key) continue;
    keyBySummary.set(member.summary, key);
    if (!opts.dry) {
      if ((existing?.status ?? 'To Do').toLowerCase() !== member.status.toLowerCase()) {
        const ok = await transitionTo(api, key, member.status);
        fixed.push(`status → ${member.status}`);
        if (!ok) {
          console.warn(
            `  ⚠ no transition to "${member.status}" from "${existing?.status ?? 'To Do'}" on ${key} — ` +
              'check the workflow (Kanban default is all-to-all).',
          );
        }
      }
      if (member.assignSelf && existing?.assigneeId !== accountId) {
        await api.request(`/rest/api/3/issue/${key}/assignee`, {
          method: 'PUT',
          body: JSON.stringify({ accountId }),
        });
        fixed.push('assignee');
      }
      if (await resetComments(api, key, member.comments ?? [], offset)) fixed.push('comments');
      if (existing) {
        console.log(
          fixed.length
            ? `  ~ reset ${existing.key} "${member.summary}" (${fixed.join(', ')})`
            : `  = ${existing.key} "${member.summary}" already matches`,
        );
      }
    } else if (existing) {
      console.log(
        `  = keep ${existing.key} "${member.summary}" (status ${existing.status} → ${member.status})`,
      );
    }
  }

  // Typed issue links: the Fortnox connector reads "is blocked by" the platform
  // token store, the one cross-project dependency in the scenario. Sync mirrors
  // it into ticket frontmatter and the app renders it on both notes.
  for (const link of CAST_LINKS) {
    const inwardKey = keyBySummary.get(link.inward);
    const outwardKey = keyBySummary.get(link.outward);
    if (!inwardKey || !outwardKey) continue;
    if (opts.dry) {
      console.log(`  = link ${inwardKey} ${link.type.toLowerCase()} ${outwardKey} (dry)`);
      continue;
    }
    if (await ensureIssueLink(api, link.type, inwardKey, outwardKey)) {
      console.log(`  + link ${inwardKey} ${link.type.toLowerCase()} ${outwardKey}`);
    } else {
      console.log(`  = link ${inwardKey} ${link.type.toLowerCase()} ${outwardKey} already exists`);
    }
  }
  return keyBySummary;
}

/**
 * Create `inwardKey —type→ outwardKey` (for "Blocks": inward blocks outward)
 * unless it already exists — the reset must be idempotent. Returns true when a
 * link was created.
 */
async function ensureIssueLink(
  api: Api,
  typeName: string,
  inwardKey: string,
  outwardKey: string,
): Promise<boolean> {
  const issue = await api.request<{
    fields?: { issuelinks?: { type?: { name?: string }; outwardIssue?: { key?: string } }[] };
  }>(`/rest/api/3/issue/${inwardKey}?fields=issuelinks`);
  const exists = (issue.fields?.issuelinks ?? []).some(
    (l) => l.type?.name === typeName && l.outwardIssue?.key === outwardKey,
  );
  if (exists) return false;
  await api.request('/rest/api/3/issueLink', {
    method: 'POST',
    body: JSON.stringify({
      type: { name: typeName },
      inwardIssue: { key: inwardKey },
      outwardIssue: { key: outwardKey },
    }),
  });
  return true;
}

// ---------------------------------------------------------------------------
// Confluence convergence
// ---------------------------------------------------------------------------

/** What reconciliation needs to know about a live page. */
interface PageLive {
  id: string;
  version?: number;
  remoteUpdated?: string;
}

async function convergeConfluence(
  api: Api,
  offset: number,
  dry: boolean,
): Promise<Map<string, PageLive>> {
  const metaByTitle = new Map<string, PageLive>();
  const spaces = await api.request<{ results?: { id: string; key?: string; name?: string }[] }>(
    '/wiki/api/v2/spaces?limit=250',
  );
  let space = (spaces.results ?? []).find((s) => s.name === SPACE_NAME || s.key === SPACE_KEY);
  if (!space) {
    console.log(`  + create space "${SPACE_NAME}" (key ${SPACE_KEY})`);
    if (dry) return metaByTitle;
    const created = await api.request<{ id?: string; key?: string }>('/wiki/rest/api/space', {
      method: 'POST',
      body: JSON.stringify({ key: SPACE_KEY, name: SPACE_NAME }),
    });
    space = { id: String(created.id ?? ''), key: created.key, name: SPACE_NAME };
    if (!space.id) throw new Error('Space created but no id returned — re-run the script.');
  }

  const livePages = await api.request<{ results?: { id: string; title?: string }[] }>(
    `/wiki/api/v2/spaces/${space.id}/pages?limit=100`,
  );
  const byTitle = new Map((livePages.results ?? []).map((p) => [p.title ?? '', p]));

  for (const pageDef of PAGES) {
    const mdPath = join(
      import.meta.dirname,
      '..',
      'vault-dev',
      'wikipages',
      'confluence',
      pageDef.file,
    );
    const md = shiftDates(readFileSync(mdPath, 'utf8').replace(FRONTMATTER_RE, '').trim(), offset);
    const body = markdownToStorage(md);
    const existing = byTitle.get(pageDef.title);
    if (!existing) {
      console.log(`  + create page "${pageDef.title}"`);
      if (!dry) {
        const created = await api.request<{
          id?: string;
          version?: { number?: number; createdAt?: string };
        }>('/wiki/api/v2/pages', {
          method: 'POST',
          body: JSON.stringify({
            spaceId: space.id,
            status: 'current',
            title: pageDef.title,
            body: { representation: 'storage', value: body },
          }),
        });
        if (created.id) {
          metaByTitle.set(pageDef.title, {
            id: String(created.id),
            ...(created.version?.number ? { version: created.version.number } : {}),
            ...(created.version?.createdAt ? { remoteUpdated: created.version.createdAt } : {}),
          });
        }
      }
      continue;
    }
    // Rewrite ONLY when the live body deviates from canonical: a gratuitous
    // version bump re-syncs the mirror, re-judges drift pairs, and makes any
    // pending fix card refuse once with "changed since this was drafted".
    const current = await api.request<{
      version?: { number?: number; createdAt?: string };
      body?: { storage?: { value?: string } };
    }>(`/wiki/api/v2/pages/${existing.id}?body-format=storage`);
    if (sameStorage(current.body?.storage?.value ?? '', body)) {
      console.log(
        `  = page "${pageDef.title}" already canonical (v${current.version?.number ?? '?'})`,
      );
      metaByTitle.set(pageDef.title, {
        id: String(existing.id),
        ...(current.version?.number ? { version: current.version.number } : {}),
        ...(current.version?.createdAt ? { remoteUpdated: current.version.createdAt } : {}),
      });
      continue;
    }
    console.log(`  ~ rewrite page "${pageDef.title}" to canonical body`);
    if (!dry) {
      const nextVersion = (current.version?.number ?? 1) + 1;
      const updated = await api.request<{ version?: { number?: number; createdAt?: string } }>(
        `/wiki/api/v2/pages/${existing.id}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            id: existing.id,
            status: 'current',
            title: pageDef.title,
            body: { representation: 'storage', value: body },
            version: { number: nextVersion, message: 'demo reset' },
          }),
        },
      );
      metaByTitle.set(pageDef.title, {
        id: String(existing.id),
        version: updated.version?.number ?? nextVersion,
        ...(updated.version?.createdAt ? { remoteUpdated: updated.version.createdAt } : {}),
      });
    } else {
      metaByTitle.set(pageDef.title, { id: String(existing.id) });
    }
  }

  const canonical = new Set(PAGES.map((p) => p.title));
  const extras = (livePages.results ?? []).filter((p) => p.title && !canonical.has(p.title));
  if (extras.length) {
    console.log(
      `  · ${extras.length} other page(s) left untouched: ${extras.map((p) => `"${p.title}"`).join(', ')}`,
    );
  }
  return metaByTitle;
}

// ---------------------------------------------------------------------------
// Runtime-vault reconciliation — the static mirrors ship with fictional ids
// so the demo works offline; against a live site they'd render dead keys and
// wrong URLs in the Tickets view, and outbound/librarian cards would target
// ids that 404. Rename the mirrors to the live keys and rewrite every stale
// token across the vault. Only the runtime copy is touched — refresh-demo
// restores the static set from canonical vault-dev/ whenever wanted.
// ---------------------------------------------------------------------------

function walkMd(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'sessions') continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMd(p));
    else if (entry.isFile() && p.endsWith('.md')) out.push(p);
  }
  return out;
}

function reconcileVault(
  vaultRoot: string,
  siteUrl: string,
  ticketKeys: Map<string, string>,
  pages: Map<string, PageLive>,
  dry: boolean,
): void {
  if (!existsSync(join(vaultRoot, 'notes'))) {
    console.log(
      `  · ${vaultRoot} not found (or not a vault) — run \`pnpm refresh-demo\` first, then re-run this.`,
    );
    return;
  }

  const replacements: [RegExp, string][] = [];
  const renames: [string, string][] = [];
  for (const [staticKey, summary] of Object.entries(STATIC_TICKETS)) {
    const live = ticketKeys.get(summary);
    if (!live || live === staticKey) continue;
    replacements.push([new RegExp(`\\b${staticKey}\\b`, 'g'), live]);
    // Mirrors live under their provider folder (docs/provider-decoupling.md
    // PD-10): tickets/jira/SCH-231.md.
    renames.push([
      join(vaultRoot, 'tickets', 'jira', `${staticKey}.md`),
      join(vaultRoot, 'tickets', 'jira', `${live}.md`),
    ]);
  }
  for (const [staticId, title] of Object.entries(STATIC_PAGE_IDS)) {
    const live = pages.get(title);
    if (!live || live.id === staticId) continue;
    replacements.push([new RegExp(`\\b${staticId}\\b`, 'g'), live.id]);
  }
  const liveHost = siteUrl.replace(/^https?:\/\//i, '');
  if (liveHost !== STATIC_HOST) {
    replacements.push([new RegExp(STATIC_HOST.replace(/\./g, '\\.'), 'g'), liveHost]);
  }
  if (!replacements.length) {
    console.log('  · nothing to reconcile (static ids already match the live site).');
    return;
  }

  // Rename mirror files first so links rewritten below resolve. A live-keyed
  // mirror already present (from a real sync) wins over the stale static one.
  for (const [from, to] of renames) {
    if (!existsSync(from)) continue;
    if (existsSync(to)) {
      console.log(
        `  − drop stale static mirror ${from.split(sep).slice(-2).join('/')} (live mirror exists)`,
      );
      if (!dry) rmSync(from);
    } else {
      console.log(
        `  ~ rename ${from.split(sep).slice(-2).join('/')} → ${to.split(sep).slice(-2).join('/')}`,
      );
      if (!dry) renameSync(from, to);
    }
  }

  let touched = 0;
  for (const file of walkMd(vaultRoot)) {
    const raw = readFileSync(file, 'utf8');
    let next = raw;
    for (const [re, to] of replacements) next = next.replace(re, to);
    if (next !== raw) {
      touched++;
      if (!dry) writeFileSync(file, next);
    }
  }
  console.log(`  ~ rewrote stale ids/host in ${touched} file(s).`);

  // Pin the wikipage mirrors' version/remote_updated to the LIVE values: the
  // static frontmatter says v12, so the first sync would rewrite the mirror and
  // stale any card drafted in between. With live values, an unchanged page
  // syncs as unchanged.
  for (const pageDef of PAGES) {
    const live = pages.get(pageDef.title);
    if (!live?.version) continue;
    const mirrorPath = join(vaultRoot, 'wikipages', 'confluence', pageDef.file);
    if (!existsSync(mirrorPath)) continue;
    const raw = readFileSync(mirrorPath, 'utf8');
    let next = raw.replace(/^version: .*$/m, `version: ${live.version}`);
    if (live.remoteUpdated) {
      next = next.replace(/^remote_updated: .*$/m, `remote_updated: "${live.remoteUpdated}"`);
    }
    if (next !== raw && !dry) writeFileSync(mirrorPath, next);
  }
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  for (const [label, v] of [
    ['--anchor', args.anchor],
    ['--today', args.today],
  ] as const) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${label} must be YYYY-MM-DD, got "${v}"`);
  }
  const credsPath = resolve(join(import.meta.dirname, '..', CREDS_FILE));
  const creds = resolveCreds(args, credsPath);
  if (args.save && !args.dry) {
    writeFileSync(credsPath, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 });
    console.log(`Saved credentials to ${CREDS_FILE} (gitignored).`);
  }

  const offset = daysBetween(args.anchor, args.today);
  console.log(
    `Anchor ${args.anchor} → today ${args.today} (offset ${offset >= 0 ? '+' : ''}${offset} days)` +
      `${args.dry ? '  (dry run — no writes)' : ''}`,
  );

  const api = new Api(creds);
  const me = await api.connect();
  console.log(`Connected to ${creds.siteUrl} as ${me.displayName}\n`);

  console.log(`Jira · projects ${PROJECT_KEYS.join(', ')}`);
  const keys = await convergeJira(api, me.accountId, CAST, offset, {
    dry: args.dry,
    keepExtras: args.keepExtras,
  });

  console.log(`\nConfluence · space ${SPACE_NAME}`);
  const pageIds = await convergeConfluence(api, offset, args.dry);

  if (keys.size) {
    console.log('\nLive issue keys:');
    for (const [summary, key] of keys) console.log(`  ${key}  ${summary}`);
  }

  // resolve() keeps an absolute --vault= as-is; relative paths anchor at repo root.
  const vaultRoot = resolve(join(import.meta.dirname, '..'), args.vault);
  if (args.reconcile) {
    console.log(`\nVault reconciliation · ${args.vault}`);
    reconcileVault(vaultRoot, creds.siteUrl, keys, pageIds, args.dry);
  }

  console.log(
    `\n✓ ${creds.siteUrl} matches the demo baseline.` +
      `\n  Next: in the app, follow ${PROJECT_KEYS.join(' + ')} + ${SPACE_KEY} (or Settings → sync now) to refresh mirrors.` +
      '\n  refresh-demo restores the static ids, so when demoing live, always refresh first, then re-run this.',
  );
}

main().catch((err: Error) => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
