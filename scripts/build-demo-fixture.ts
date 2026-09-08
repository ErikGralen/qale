/**
 * Bake the Rota cast into `demo/atlassian-fixture.json`, the seed the demo
 * build's fake Atlassian serves (docs/demo-mode.md DM-8).
 *
 * Two sources, both git-tracked, both already the truth for something else:
 *  - scripts/lib/atlassian-cast.ts — descriptions, statuses, labels, comment
 *    seeds, issue links, page titles. The same cast `pnpm reset-atlassian`
 *    pushes to the live demo site.
 *  - vault-dev/ — the static mirrors give each cast member its key
 *    (`tickets/jira/SCH-231.md`), its assignee and its last-updated stamp, and
 *    the wikipages give the canonical page bodies and version numbers. So the
 *    fake answers with exactly the ids the demo vault already names.
 *
 * A mirror that carries a comment thread wins over the cast's seeds: the
 * mirrors are what the demo shows before the first sync, and the fake should
 * not rewrite them the moment it runs.
 *
 * Dates stay anchored on 2026-07-17. Sliding them to the demo day is the
 * fake's job at load, so one fixture serves every demo day.
 *
 *   pnpm build-demo-fixture
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ANCHOR,
  CAST,
  CAST_LINKS,
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

const ROOT = join(import.meta.dirname, '..');
const VAULT = join(ROOT, 'vault-dev');
const OUT = join(ROOT, 'demo', 'atlassian-fixture.json');

const SITE_URL = `https://${STATIC_HOST}`;
/** The demo's own account. Every cast issue reports to it, so the footprint
 *  survey's `currentUser()` queries find all three projects. */
const SELF = {
  accountId: 'demo-pm',
  displayName: 'Demo user',
  emailAddress: 'demo@rota.example',
};

interface Comment {
  id: string;
  author: string;
  created: string;
  body: string;
}

/** What the static mirror knows that the cast does not. */
interface MirrorFacts {
  assignee: string | null;
  updated: string;
  parentKey?: string;
  comments: Comment[];
}

function field(frontmatter: string, name: string): string | undefined {
  const line = new RegExp(`^${name}:\\s*(.+)$`, 'm').exec(frontmatter);
  return line?.[1]?.trim().replace(/^['"]|['"]$/g, '');
}

/**
 * Comments as the static mirrors write them: `- **Author · 2026-07-16**: text`,
 * wrapped onto indented continuation lines, newest first. Returned oldest
 * first, which is the order Jira's thread has.
 */
function mirrorComments(body: string, key: string): Comment[] {
  const block = /## Recent comments\n([\s\S]*)$/.exec(body);
  if (!block?.[1]) return [];
  const out: Comment[] = [];
  for (const line of block[1].split('\n')) {
    const head = /^- \*\*(.+?) · (\d{4}-\d{2}-\d{2})\*\*:\s*(.*)$/.exec(line);
    if (head?.[1] && head[2]) {
      out.push({
        id: '',
        author: head[1],
        created: `${head[2]}T09:30:00.000Z`,
        body: (head[3] ?? '').trim(),
      });
      continue;
    }
    const last = out.at(-1);
    if (last && /^\s+\S/.test(line)) last.body = `${last.body} ${line.trim()}`.trim();
  }
  out.reverse();
  out.forEach((c, n) => {
    c.id = `${key.replace(/\D/g, '')}${n + 1}`;
  });
  return out;
}

function readMirror(key: string): MirrorFacts {
  const text = readFileSync(join(VAULT, 'tickets', 'jira', `${key}.md`), 'utf8');
  const frontmatter = FRONTMATTER_RE.exec(text)?.[0] ?? '';
  const body = text.replace(FRONTMATTER_RE, '');
  const parentKey = field(frontmatter, 'parent');
  return {
    assignee: field(frontmatter, 'assignee') ?? null,
    updated: field(frontmatter, 'remote_updated') ?? `${ANCHOR}T09:00:00.000Z`,
    ...(parentKey ? { parentKey } : {}),
    comments: mirrorComments(body, key),
  };
}

/** Comment stamps when only the cast has the thread: one a week apart, the
 *  newest landing on the day the issue last moved. */
function castComments(seeds: string[], updated: string, key: string): Comment[] {
  return seeds.map((body, n) => {
    const day = new Date(Date.parse(updated));
    day.setUTCDate(day.getUTCDate() - (seeds.length - 1 - n) * 7);
    return {
      id: `${key.replace(/\D/g, '')}${n + 1}`,
      author: SELF.displayName,
      created: `${day.toISOString().slice(0, 10)}T09:30:00.000Z`,
      body,
    };
  });
}

function daysBefore(iso: string, days: number): string {
  const dt = new Date(Date.parse(iso));
  dt.setUTCDate(dt.getUTCDate() - days);
  return dt.toISOString();
}

// --- issues ----------------------------------------------------------------

const keyOfSummary = new Map(
  Object.entries(STATIC_TICKETS).map(([key, summary]) => [summary, key]),
);
const keys = Object.keys(STATIC_TICKETS).sort();

const issues = keys.map((key, index) => {
  const summary = STATIC_TICKETS[key];
  const member = CAST.find((c) => c.summary === summary);
  if (!member)
    throw new Error(`No cast member for ${key} ("${summary}") — cast and mirrors drifted.`);
  const mirror = readMirror(key);
  const comments = mirror.comments.length
    ? mirror.comments
    : castComments(member.comments ?? [], mirror.updated, key);
  return {
    id: String(10_001 + index),
    key,
    projectKey: member.project,
    summary: member.summary,
    description: member.description,
    issueType: member.issueType,
    status: member.status,
    statusCategory: categoryOf(member.status),
    labels: [member.label],
    assignee: mirror.assignee,
    reporter: SELF.displayName,
    created: daysBefore(mirror.updated, 30),
    updated: mirror.updated,
    ...(mirror.parentKey ? { parentKey: mirror.parentKey } : {}),
    comments,
    links: [] as { type: string; key: string; outward: boolean }[],
  };
});

function categoryOf(status: string): 'new' | 'indeterminate' | 'done' {
  if (/^done$/i.test(status)) return 'done';
  if (/^(to do|backlog|open)$/i.test(status)) return 'new';
  return 'indeterminate';
}

// Both sides of every link, the way Jira reports it on each issue.
for (const link of CAST_LINKS) {
  const from = keyOfSummary.get(link.inward);
  const to = keyOfSummary.get(link.outward);
  if (!from || !to) throw new Error(`Link "${link.type}" names a summary no mirror has.`);
  issues.find((i) => i.key === from)?.links.push({ type: link.type, key: to, outward: true });
  issues.find((i) => i.key === to)?.links.push({ type: link.type, key: from, outward: false });
}

// --- pages -----------------------------------------------------------------

const idOfTitle = new Map(Object.entries(STATIC_PAGE_IDS).map(([id, title]) => [title, id]));

const pages = PAGES.map((pageDef) => {
  const id = idOfTitle.get(pageDef.title);
  if (!id) throw new Error(`No static page id for "${pageDef.title}".`);
  const source = readFileSync(join(VAULT, 'wikipages', 'confluence', pageDef.file), 'utf8');
  const frontmatter = FRONTMATTER_RE.exec(source)?.[0] ?? '';
  const updated = field(frontmatter, 'remote_updated') ?? `${ANCHOR}T09:00:00.000Z`;
  return {
    id,
    title: pageDef.title,
    spaceKey: SPACE_KEY,
    version: Number(field(frontmatter, 'version') ?? 1),
    body: markdownToStorage(source.replace(FRONTMATTER_RE, '').trim()),
    created: daysBefore(updated, 120),
    updated,
    webui: `/spaces/${SPACE_KEY}/pages/${id}`,
  };
});

// --- the fixture -----------------------------------------------------------

const fixture = {
  anchor: ANCHOR,
  siteUrl: SITE_URL,
  self: SELF,
  projects: PROJECT_KEYS.map((key, n) => ({
    id: String(10_000 + n),
    key,
    name: PROJECT_NAMES[key],
  })),
  spaces: [{ id: '65537', key: SPACE_KEY, name: SPACE_NAME }],
  issues,
  pages,
};

mkdirSync(join(ROOT, 'demo'), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(
  `Wrote ${OUT}: ${issues.length} issues, ${pages.length} pages, anchored ${ANCHOR}.`,
);
