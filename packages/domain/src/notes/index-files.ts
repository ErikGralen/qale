import { typeForDir } from './frontmatter.js';
import { lifecycleValueLabel } from './lifecycle.js';
import { OKF_VERSION } from './slug.js';

/**
 * OKF `index.md` rendering (§8) — the directory-map orientation layer. These are
 * PURE string builders: the application layer reads the vault index, projects
 * each note's `summary` to an OKF `description` (OKF alignment, phase 3),
 * and hands the shaped data here. Nothing in this module touches the filesystem.
 *
 * Links are written vault-root-relative (the vault root IS the OKF bundle root),
 * which is both what an OKF consumer resolves as bundle-relative and exactly the
 * path pm's own agent passes back to `vault_read` after reading the map.
 */

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
}

/** A folder's worth of entries, plus the copy the root map and folder header show. */
export interface IndexFolder {
  /** Folder name, e.g. "insights". */
  dir: string;
  /** Display label, e.g. "Insights". */
  label: string;
  /** One-line purpose of the folder, shown in the root map and folder header. */
  purpose: string;
  entries: IndexEntry[];
}

/** Collapse a value to a single clean line so it never breaks a markdown row. */
function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
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

function entryLine(entry: IndexEntry): string {
  const title = oneLine(entry.title) || entry.path;
  const desc = oneLine(entry.description);
  return desc ? `* [${title}](${entry.path}) — ${desc}` : `* [${title}](${entry.path})`;
}

/**
 * Render one folder's `index.md`. Entries group by lifecycle value when any
 * carry one (one section per group, §8), else a single flat list. Within a group
 * they are ordered by title so the file is stable across regenerations.
 */
export function renderFolderIndex(folder: IndexFolder): string {
  const anyLifecycle = folder.entries.some((e) => e.lifecycle != null && e.lifecycle !== '');
  const fm = `---\ndescription: ${oneLine(`${folder.label} — ${folder.purpose}`)}\n---\n`;
  const head = `\n# ${folder.label}\n\n${oneLine(folder.purpose)}\n`;

  if (folder.entries.length === 0) return `${fm}${head}`;

  const byTitle = (a: IndexEntry, b: IndexEntry): number =>
    oneLine(a.title).localeCompare(oneLine(b.title));

  if (!anyLifecycle) {
    const list = [...folder.entries].sort(byTitle).map(entryLine).join('\n');
    return `${fm}${head}\n${list}\n`;
  }

  const groups = new Map<string | null, IndexEntry[]>();
  for (const e of folder.entries) {
    const key = e.lifecycle != null && e.lifecycle !== '' ? e.lifecycle : null;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(e);
  }
  const heading = (v: string | null): string => lifecycleHeading(folder.dir, v);
  const sections = [...groups.keys()]
    .sort((a, b) => lifecycleRank(a) - lifecycleRank(b) || heading(a).localeCompare(heading(b)))
    .map((value) => {
      const list = groups.get(value)!.sort(byTitle).map(entryLine).join('\n');
      return `## ${heading(value)}\n\n${list}`;
    });
  return `${fm}${head}\n${sections.join('\n\n')}\n`;
}

/**
 * Render the root `index.md` — the compact whole-vault map (§8) stamped with
 * `okf_version` (§12). One line per non-empty folder, linking its own index.md,
 * so a session (or another OKF tool) can orient in a single read before drilling
 * into a folder map.
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
  const nonEmpty = folders.filter((f) => f.entries.length > 0);
  if (nonEmpty.length === 0) return `${fm}${intro}`;
  const rows = nonEmpty
    .map((f) => {
      const count = f.entries.length;
      return `* [${f.label}](${f.dir}/index.md) — ${oneLine(f.purpose)} (${count})`;
    })
    .join('\n');
  return `${fm}${intro}\n## Folders\n\n${rows}\n`;
}
