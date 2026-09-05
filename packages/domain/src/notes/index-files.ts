import { typeForDir } from './frontmatter.js';
import { lifecycleValueLabel } from './lifecycle.js';
import { OKF_VERSION } from './slug.js';

/**
 * OKF `index.md` rendering (§8), the directory-map orientation layer. These are
 * PURE string builders: the application layer reads the vault index, projects
 * each note's `summary` to an OKF `description` (OKF alignment, phase 3),
 * resolves the links a line shows, and hands the shaped data here. Nothing in
 * this module touches the filesystem or the clock.
 *
 * Links are written vault-root-relative (the vault root IS the OKF bundle root),
 * which is both what an OKF consumer resolves as bundle-relative and exactly the
 * path Qale's own agent passes back to `vault_read` after reading the map.
 *
 * One entry point, `renderFolderIndex`, and it branches on what the folder is
 * (docs/index-maps.md IM-1, IM-2, IM-5):
 *
 * - meetings group by month, newest first, with the date on every line;
 * - todos keep the commitment groups, and the open ones sort by due date;
 * - a Documents folder lists its subfolders first, then its documents;
 * - every other folder groups by lifecycle, or renders one flat list.
 */

/** A note another line points at, already resolved: the title and the path. */
export interface IndexLink {
  title: string;
  /** Vault-relative path. Absent when the link did not resolve to a note. */
  path?: string;
}

/** One note's line in a folder index. `description` is the projected `summary`. */
export interface IndexEntry {
  /** Vault-relative path, e.g. "insights/acme-wants-scim.md". */
  path: string;
  title: string;
  description: string;
  /**
   * The note's lifecycle value, when its type carries a lifecycle at all: a
   * decision's `standing`, a customer's `relationship`, a source's `processing`.
   * Drives the grouping, and the folder's own type names the sections.
   */
  lifecycle?: string | null;
  /**
   * The meeting's day, as written in the note. Only `YYYY-MM-DD` counts as a
   * date; anything else is rendered as undated.
   */
  date?: string;
  /** The todo's due day, as written. Same rule as `date`. */
  due?: string;
  /** The meeting's customer, resolved from its wikilink. */
  customer?: IndexLink;
  /** The todo's owner, resolved from its wikilink. */
  owner?: IndexLink;
  /** The meeting's series slug, when it belongs to one. */
  series?: string;
}

/** One subfolder's row in a Documents folder map. */
export interface IndexSubfolder {
  /** Vault-relative folder path, e.g. "notes/specs". */
  dir: string;
  /** Display label, e.g. "Specs". */
  label: string;
  /** The folder's one-line purpose. */
  purpose: string;
  /** Documents inside it, subfolders included. */
  count: number;
}

/** A folder's worth of entries, plus the copy the root map and folder header show. */
export interface IndexFolder {
  /** Vault-relative folder path, e.g. "insights" or "notes/specs". */
  dir: string;
  /** Display label, e.g. "Insights". */
  label: string;
  /** One-line purpose of the folder, shown in the root map and folder header. */
  purpose: string;
  entries: IndexEntry[];
  /**
   * Set on a Documents folder (`notes/` and every folder under it): the folders
   * directly inside it. An empty list still marks the folder as a Documents
   * folder, whose `description` is the purpose itself, so the application
   * layer can read it back and keep it across regenerations.
   */
  subfolders?: IndexSubfolder[];
  /**
   * The `purpose_of` marker of a Documents folder (IM-7): what the model was
   * shown when it wrote the purpose, as one short hash per document. The
   * folder-purpose pass writes it, the application layer reads it back off the
   * file, and it is re-emitted here so it survives every regeneration.
   */
  purposeOf?: string;
}

/** What the renderer knows about the day it runs. */
export interface RenderOptions {
  /**
   * Today as `YYYY-MM-DD`. Only the month matters: the meetings map lists this
   * month and the two before it in full and collapses older months (IM-4), so
   * the file is the same on every day of one month.
   */
  today?: string;
}

/** Collapse a value to a single clean line so it never breaks a markdown row. */
function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** The wording a new Documents folder gets as its purpose until somebody writes one. */
export function documentFolderPurpose(title: string): string {
  return `${title}, a folder of your documents`;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The value when it is a real day, else null: `due: next Friday` is undated. */
export function dayOf(value: string | undefined): string | null {
  return value !== undefined && DAY.test(value) ? value : null;
}

/**
 * Section order within a folder index: the buckets that still want something
 * first (so "what needs attention" reads top-down), then the settled ones, then
 * the lifecycle-less bucket. One flat list across every lifecycle, since a
 * folder only ever holds one of them. Values the workspace doesn't privilege
 * still group, they just sort after the known ones.
 */
const LIFECYCLE_ORDER = [
  'new',
  'active',
  'open',
  'exploring',
  'committed',
  'prospect',
  'watching',
  'processed',
  'done',
  'stale',
  'superseded',
  'dropped',
  'churned',
  'wont-do',
];

function lifecycleRank(value: string | null): number {
  if (value === null) return LIFECYCLE_ORDER.length + 1;
  const i = LIFECYCLE_ORDER.indexOf(value);
  return i === -1 ? LIFECYCLE_ORDER.length : i;
}

/** The section heading for one lifecycle value, in the folder type's own words. */
function lifecycleHeading(dir: string, value: string | null): string {
  if (!value) return 'Unfiled';
  return lifecycleValueLabel(typeForDir(dir), value);
}

const byTitle = (a: IndexEntry, b: IndexEntry): number =>
  oneLine(a.title).localeCompare(oneLine(b.title));

/** `[title](path)` when the link resolved, else the bare title. */
function linkText(link: IndexLink): string {
  const title = oneLine(link.title);
  return link.path ? `[${title}](${link.path})` : title;
}

/** The link and description part every line ends with. */
function entryTail(entry: IndexEntry): string {
  const title = oneLine(entry.title) || entry.path;
  const desc = oneLine(entry.description);
  return desc ? `[${title}](${entry.path}) — ${desc}` : `[${title}](${entry.path})`;
}

function entryLine(entry: IndexEntry): string {
  return `* ${entryTail(entry)}`;
}

/** Group entries by a key, keeping the first-seen order of keys. */
function groupBy<K>(entries: IndexEntry[], keyOf: (e: IndexEntry) => K): Map<K, IndexEntry[]> {
  const groups = new Map<K, IndexEntry[]>();
  for (const e of entries) {
    const key = keyOf(e);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(e);
  }
  return groups;
}

function frontmatterOf(folder: IndexFolder): string {
  const description =
    folder.subfolders !== undefined
      ? oneLine(folder.purpose)
      : oneLine(`${folder.label} — ${folder.purpose}`);
  const marker = folder.purposeOf ? `purpose_of: ${oneLine(folder.purposeOf)}\n` : '';
  return `---\ndescription: ${description}\n${marker}---\n`;
}

function headOf(folder: IndexFolder): string {
  return `\n# ${folder.label}\n\n${oneLine(folder.purpose)}\n`;
}

/**
 * Render one folder's `index.md`. Entries group by lifecycle value when any
 * carry one (one section per group, §8), else a single flat list. Within a group
 * they are ordered by title so the file is stable across regenerations.
 */
export function renderFolderIndex(folder: IndexFolder, options: RenderOptions = {}): string {
  const fm = frontmatterOf(folder);
  const head = headOf(folder);
  const type = typeForDir(folder.dir);

  if (folder.subfolders !== undefined) return `${fm}${head}${renderDocumentsBody(folder)}`;
  if (folder.entries.length === 0) return `${fm}${head}`;
  if (type === 'meeting') return `${fm}${head}\n${renderMeetingSections(folder, options)}\n`;
  return `${fm}${head}\n${renderLifecycleBody(folder)}\n`;
}

/**
 * The default body: one section per lifecycle value, or a flat list when
 * nothing carries one. A todo folder's Open section is the exception (IM-2):
 * it sorts by due date and puts the due day and the owner on the line.
 */
function renderLifecycleBody(folder: IndexFolder): string {
  const anyLifecycle = folder.entries.some((e) => e.lifecycle != null && e.lifecycle !== '');
  if (!anyLifecycle) return [...folder.entries].sort(byTitle).map(entryLine).join('\n');

  const groups = groupBy(folder.entries, (e) =>
    e.lifecycle != null && e.lifecycle !== '' ? e.lifecycle : null,
  );
  const heading = (v: string | null): string => lifecycleHeading(folder.dir, v);
  const openTodos = typeForDir(folder.dir) === 'todo';
  return [...groups.keys()]
    .sort((a, b) => lifecycleRank(a) - lifecycleRank(b) || heading(a).localeCompare(heading(b)))
    .map((value) => {
      const entries = groups.get(value)!;
      const list =
        openTodos && value === 'open'
          ? entries.sort(byDueThenTitle).map(openTodoLine).join('\n')
          : entries.sort(byTitle).map(entryLine).join('\n');
      return `## ${heading(value)}\n\n${list}`;
    })
    .join('\n\n');
}

/** Due date ascending, undated last, title breaks the tie. */
function byDueThenTitle(a: IndexEntry, b: IndexEntry): number {
  const da = dayOf(a.due);
  const db = dayOf(b.due);
  if (da !== null && db !== null) return da.localeCompare(db) || byTitle(a, b);
  if (da !== null) return -1;
  if (db !== null) return 1;
  return byTitle(a, b);
}

/** `* due 2026-07-16 · [Sara Lindqvist](people/sara-lindqvist.md) — [title](path) — summary` */
function openTodoLine(entry: IndexEntry): string {
  const due = dayOf(entry.due);
  const parts = [due ? `due ${due}` : 'undated'];
  if (entry.owner) parts.push(linkText(entry.owner));
  return `* ${parts.join(' · ')} — ${entryTail(entry)}`;
}

/** The first month the meetings map still lists in full: two months before today's. */
function fullWindowStart(today: string | undefined): string | null {
  const day = dayOf(today);
  if (day === null) return null;
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const index = year * 12 + (month - 1) - 2;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

/**
 * Meetings by month, newest first (IM-1). This month, the two before it and
 * every month after it are listed in full; older months collapse to one line
 * that says how many meetings they hold and where to look (IM-4). Meetings with
 * no date sit under "Undated" at the end.
 */
function renderMeetingSections(folder: IndexFolder, options: RenderOptions): string {
  const groups = groupBy(folder.entries, (e) => dayOf(e.date)?.slice(0, 7) ?? null);
  const undated = groups.get(null);
  groups.delete(null);
  const windowStart = fullWindowStart(options.today);

  const sections = [...groups.keys()]
    .sort((a, b) => (b! < a! ? -1 : b! > a! ? 1 : 0))
    .map((month) => {
      const entries = groups.get(month)!;
      if (windowStart !== null && month! < windowStart) {
        const n = entries.length;
        return `## ${month} (${n} ${n === 1 ? 'meeting' : 'meetings'}, use vault_list since/until)`;
      }
      const list = entries.sort(byDateDescThenTitle).map(meetingLine).join('\n');
      return `## ${month}\n\n${list}`;
    });
  if (undated) {
    const list = undated.sort(byTitle).map(meetingLine).join('\n');
    sections.push(`## Undated\n\n${list}`);
  }
  return sections.join('\n\n');
}

function byDateDescThenTitle(a: IndexEntry, b: IndexEntry): number {
  return (dayOf(b.date) ?? '').localeCompare(dayOf(a.date) ?? '') || byTitle(a, b);
}

/**
 * `* 2026-07-14 [title](path) — summary (customer: [Nordkap](customers/nordkap.md)) (series: nordkap-checkin)`
 * The customer is a path link like every other link in a map, never `[[...]]`.
 */
function meetingLine(entry: IndexEntry): string {
  const day = dayOf(entry.date);
  let line = day ? `* ${day} ${entryTail(entry)}` : `* ${entryTail(entry)}`;
  if (entry.customer) line += ` (customer: ${linkText(entry.customer)})`;
  if (entry.series) line += ` (series: ${oneLine(entry.series)})`;
  return line;
}

/**
 * A Documents folder (IM-5): the subfolders first, each with its purpose, its
 * recursive count and a link to its own map, then the documents at this level.
 * No subfolders means the plain list the folder always had.
 */
function renderDocumentsBody(folder: IndexFolder): string {
  const subfolders = [...(folder.subfolders ?? [])].sort((a, b) => a.label.localeCompare(b.label));
  const docs = [...folder.entries].sort(byTitle).map(entryLine).join('\n');
  if (subfolders.length === 0) return docs ? `\n${docs}\n` : '';
  const rows = subfolders
    .map((s) => `* [${oneLine(s.label)}](${s.dir}/index.md) — ${oneLine(s.purpose)} (${s.count})`)
    .join('\n');
  const sections = [`## Folders\n\n${rows}`];
  if (docs) sections.push(`## Documents\n\n${docs}`);
  return `\n${sections.join('\n\n')}\n`;
}

/** Entries in this folder and in every folder under it. */
function recursiveCount(folders: IndexFolder[], dir: string): number {
  return folders
    .filter((f) => f.dir === dir || f.dir.startsWith(`${dir}/`))
    .reduce((n, f) => n + f.entries.length, 0);
}

/**
 * Render the root `index.md`: the compact whole-vault map (§8) stamped with
 * `okf_version` (§12). One line per non-empty top-level folder, linking its own
 * index.md, so a session (or another OKF tool) can orient in a single read
 * before drilling into a folder map. A Documents subfolder is reached through
 * `notes/index.md`, so the root lists `notes` once, with everything under it
 * counted.
 */
export function renderRootIndex(folders: IndexFolder[], workspaceName: string): string {
  const fm =
    `---\nokf_version: "${OKF_VERSION}"\n` +
    `description: ${oneLine(`Map of the ${workspaceName} workspace — one line per folder.`)}\n---\n`;
  const intro =
    `\n# ${workspaceName}\n\n` +
    'This workspace is an Open Knowledge Format bundle. Each folder has an `index.md` ' +
    'mapping its notes with one-line descriptions; read the relevant folder map to ' +
    'orient before opening notes.\n';
  const rows = folders
    .filter((f) => !f.dir.includes('/'))
    .map((f) => ({ folder: f, count: recursiveCount(folders, f.dir) }))
    .filter((r) => r.count > 0)
    .map(
      ({ folder, count }) =>
        `* [${folder.label}](${folder.dir}/index.md) — ${oneLine(folder.purpose)} (${count})`,
    );
  if (rows.length === 0) return `${fm}${intro}`;
  return `${fm}${intro}\n## Folders\n\n${rows.join('\n')}\n`;
}
