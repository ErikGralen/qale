/**
 * The date shift that makes the demo read as "now".
 *
 * `vault-dev/` is written around a fictional today, {@link ANCHOR}. Everything
 * that copies it slides every date forward by (real today − anchor), so the
 * upcoming meeting stays upcoming, the overdue todo stays overdue and the stale
 * insight stays proportionally stale. Two callers need exactly that logic:
 * `scripts/refresh-demo.ts` and the demo build's Reset (docs/demo-mode.md DM-9).
 * It lives here so they cannot drift apart.
 *
 * Two rules constrain this file, and both come from the script:
 *
 * - **Node builtins only.** The script runs under bare `node scripts/refresh-demo.ts`
 *   with type stripping and no bundler, and imports this file by relative path
 *   with an explicit `.ts` extension. A third-party import, or an import of a
 *   file that has one, would stop the script dead.
 * - **No Electron, no app state.** What is written here is file text and dates.
 *   Who owns the files is the caller's business.
 */
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * The fictional "today" the canonical `vault-dev/` scenario is written around.
 * If the source is ever re-dated to a different centre, this moves with it.
 */
export const ANCHOR = '2026-07-17';

/**
 * Frontmatter keys whose scalar value is a date to slide. These never hold
 * wikilinks, so shifting their date tokens cannot corrupt a link.
 * `remote_updated` (ticket and wikipage mirrors) is a full ISO timestamp; only
 * its date part shifts, the time of day stays.
 */
export const DATE_KEYS: readonly string[] = [
  'date',
  'due',
  'captured',
  'updated',
  'last_told',
  'resolved',
  'started',
  'ended',
  'remote_updated',
];

/**
 * Frontmatter string keys that hold human prose (never wikilinks): their date
 * tokens shift too, so a summary like "SSO date 2026-07-28" stays consistent.
 */
export const PROSE_KEYS: readonly string[] = ['summary', 'title'];

const DATE_RE = /\d{4}-\d{2}-\d{2}/g;

/**
 * A skill and an agent are folders: `skills/<name>/SKILL.md` is the runnable and
 * its slug is the FOLDER, while anything else beside it is the skill's own
 * material — never indexed, never a note, so it has no frontmatter to validate.
 * Mirrors the slug rule in `../notes`; restated rather than imported so this
 * file keeps its "node builtins only" promise.
 */
const RUNNABLE_ENTRY_RE = /^(?:skills|agents)\/[^/]+\/(?:SKILL|AGENT)\.md$/i;
const RUNNABLE_FOLDER_RE = /^(?:skills|agents)\/[^/]+\/.+$/;

export const FRONTMATTER_RE = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
export const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

/** Is this a skill's own material rather than the runnable itself? */
export function isRunnableResource(rel: string): boolean {
  return RUNNABLE_FOLDER_RE.test(rel) && !RUNNABLE_ENTRY_RE.test(rel);
}

/** The slug a file is linkable by: a runnable's entry file answers to its folder. */
export function slugOf(rel: string): string {
  const slug = rel.replace(/\.md$/, '');
  return RUNNABLE_ENTRY_RE.test(rel) ? slug.slice(0, slug.lastIndexOf('/')) : slug;
}

/** Throw unless `s` is a YYYY-MM-DD date. */
export function assertISODate(label: string, s: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`${label} must be YYYY-MM-DD, got "${s}"`);
}

/** Whole-day difference a→b, computed in UTC so DST never skews it. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round(
    (Date.UTC(by ?? 0, (bm ?? 1) - 1, bd ?? 1) - Date.UTC(ay ?? 0, (am ?? 1) - 1, ad ?? 1)) /
      86_400_000,
  );
}

/** Slide a single YYYY-MM-DD string by `offset` days. */
export function shiftDate(iso: string, offset: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + offset);
  return dt.toISOString().slice(0, 10);
}

/**
 * Shift every YYYY-MM-DD in a run of prose, but hide wikilinks first so a slug's
 * date is never touched — files aren't renamed, so links must stay byte-exact.
 * The \x00 sentinel can't occur in markdown, so restoration is unambiguous.
 */
export function shiftProse(text: string, offset: number): { out: string; count: number } {
  const links: string[] = [];
  const masked = text.replace(WIKILINK_RE, (m) => {
    links.push(m);
    return `\x00${links.length - 1}\x00`;
  });
  let count = 0;
  const out = masked
    .replace(DATE_RE, (tok) => {
      count++;
      return shiftDate(tok, offset);
    })
    .replace(/\x00(\d+)\x00/g, (_, i) => links[Number(i)] ?? '');
  return { out, count };
}

/** Shift the date-valued frontmatter fields and bare prose dates in one file. */
export function shiftFile(raw: string, offset: number): { text: string; fm: number; body: number } {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    const { out, count } = shiftProse(raw, offset);
    return { text: out, fm: 0, body: count };
  }
  const fmBlock = match[1] ?? '';
  const rest = raw.slice(match[0].length);

  let fmCount = 0;
  const shiftedFm = fmBlock
    .split('\n')
    .map((line) => {
      const key = line.match(/^\s*([A-Za-z_]+):/)?.[1];
      if (!key) return line; // continuation / array-item line — leave alone
      if (DATE_KEYS.includes(key)) {
        return line.replace(DATE_RE, (tok) => {
          fmCount++;
          return shiftDate(tok, offset);
        });
      }
      if (PROSE_KEYS.includes(key)) {
        const { out, count } = shiftProse(line, offset);
        fmCount += count;
        return out;
      }
      return line; // ref/array keys (sources, evidence, customer, …) untouched
    })
    .join('\n');

  const { out: shiftedBody, count: bodyCount } = shiftProse(rest, offset);
  return { text: `---\n${shiftedFm}\n---\n${shiftedBody}`, fm: fmCount, body: bodyCount };
}

/** Every file under `dir`, recursively. */
export function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(p));
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

/** Bare slug set for wikilink resolution: both `dir/name` and basename `name`. */
export function buildSlugIndex(root: string, files: string[]): Set<string> {
  const slugs = new Set<string>();
  for (const f of files) {
    if (!f.endsWith('.md')) continue;
    const rel = slugOf(relative(root, f).replace(/\\/g, '/'));
    slugs.add(rel);
    slugs.add(rel.split('/').pop() ?? rel);
  }
  return slugs;
}

/**
 * Blank out fenced code blocks, keeping the line count, so a link inside one is
 * never read as a reference.
 *
 * This matches the app: the wikilink plugin walks mdast `text` nodes, and a
 * fence is a `code` node, so `[[tickets/KEY]]` in a fence is never indexed and
 * never shows as a backlink. The shape blocks in the spec and weekly-update
 * skills are exactly that — a template shown to the model, in a fence.
 */
export function stripFences(text: string): string {
  let inFence = false;
  return text
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return '';
      }
      return inFence ? '' : line;
    })
    .join('\n');
}

/** Every wikilink target in `text`, aliases, anchors and `type::` prefixes stripped. */
export function extractLinks(text: string): string[] {
  const out: string[] = [];
  for (const m of stripFences(text).matchAll(WIKILINK_RE)) {
    let target = (m[1] ?? '').split('|')[0]?.split('#')[0]?.trim() ?? '';
    const sep = target.indexOf('::');
    if (sep > 0 && target.slice(sep + 2).trim()) target = target.slice(sep + 2).trim();
    if (target) out.push(target);
  }
  return out;
}

/**
 * Per-vault app DB filename: the first 12 hex chars of sha256(absolute vault
 * root). VaultService names the file with this same function, so a reset can
 * never clear the wrong DB (or none) by deriving the name a second way.
 */
export function appDbBasename(vaultRoot: string): string {
  return `app-${createHash('sha256').update(vaultRoot).digest('hex').slice(0, 12)}.db`;
}

/**
 * Copy the canonical vault to a fresh target. A session's working folder is
 * per-run scratch, so the folder is recreated empty rather than carried over.
 * The caller has already made sure `target` is safe to write.
 */
export function copyVault(source: string, target: string): void {
  cpSync(source, target, {
    recursive: true,
    filter: (src) => !src.split(sep).includes('sessions') || src.endsWith(`${sep}sessions`),
  });
  mkdirSync(join(target, 'sessions'), { recursive: true });
}

export interface ShiftResult {
  filesTouched: number;
  fm: number;
  body: number;
}

/**
 * Slide every date in every note under `root` by `offset` days. `write: false`
 * counts what would change and writes nothing, which is what the script's dry
 * run reports.
 */
export function shiftVaultDates(root: string, offset: number, write = true): ShiftResult {
  const result: ShiftResult = { filesTouched: 0, fm: 0, body: 0 };
  const mdFiles = walkFiles(root).filter(
    (f) => f.endsWith('.md') && !f.split(sep).includes('sessions'),
  );
  for (const f of mdFiles) {
    const { text, fm, body } = shiftFile(readFileSync(f, 'utf8'), offset);
    if (fm + body === 0) continue;
    result.filesTouched++;
    result.fm += fm;
    result.body += body;
    if (write) writeFileSync(f, text);
  }
  return result;
}

export interface VaultValidation {
  /** `<file>  →  [[<target>]]` for every wikilink that resolves to nothing. */
  unresolved: string[];
  /** Notes with no `type:` in their frontmatter. */
  untyped: string[];
  /** How many markdown files were read. */
  noteCount: number;
}

/** Check the copy: frontmatter present, and every wikilink resolves. */
export function validateVault(root: string): VaultValidation {
  const allFiles = walkFiles(root);
  const slugs = buildSlugIndex(root, allFiles);
  const unresolved: string[] = [];
  const untyped: string[] = [];
  let noteCount = 0;
  for (const f of allFiles) {
    if (!f.endsWith('.md')) continue;
    noteCount++;
    const rel = relative(root, f).replace(/\\/g, '/');
    if (rel.startsWith('sessions/')) continue;
    const raw = readFileSync(f, 'utf8');
    const fmMatch = raw.match(FRONTMATTER_RE);
    // A skill's own material (anything beside its SKILL.md) is not a note: it is
    // never indexed and only ever read by the path its skill names, so it has no
    // frontmatter to check.
    if (!isRunnableResource(rel) && (!fmMatch || !/^\s*type:/m.test(fmMatch[1] ?? '')))
      untyped.push(rel);
    for (const link of extractLinks(raw)) {
      if (/^https?:\/\//.test(link)) continue;
      // A skill writes `[[people/…]]` to show the agent the shape of a link it
      // should emit. The ellipsis can never be part of a real slug, so it is a
      // placeholder in prose, not a broken reference.
      if (link.includes('…')) continue;
      if (!slugs.has(link)) unresolved.push(`${rel}  →  [[${link}]]`);
    }
  }
  return { unresolved, untyped, noteCount };
}

/** The six todo lanes, counted the way the Todos view counts them. */
export function todoLanes(root: string, today: string): Record<string, number> {
  const lanes: Record<string, number> = {
    overdue: 0,
    today: 0,
    upcoming: 0,
    someday: 0,
    waiting: 0,
    closed: 0,
  };
  for (const f of readdirSync(join(root, 'todos'))) {
    if (!f.endsWith('.md')) continue;
    const fm = readFileSync(join(root, 'todos', f), 'utf8').match(FRONTMATTER_RE)?.[1] ?? '';
    // Accept the legacy `status:` key too, exactly as the frontmatter parser does.
    // A date may be quoted either way, or not at all. Accepting only `"` read
    // every single-quoted due as no due, and put a live todo in Someday.
    const commitment = fm.match(/^\s*(?:commitment|status):\s*['"]?([\w-]+)['"]?/m)?.[1] ?? 'open';
    const due = fm.match(/^\s*due:\s*['"]?(\d{4}-\d{2}-\d{2})['"]?/m)?.[1] ?? null;
    const owner = /^\s*owner:\s*\S/m.test(fm);
    if (commitment !== 'open') lanes['closed']!++;
    else if (owner) lanes['waiting']!++;
    else if (!due) lanes['someday']!++;
    else if (due < today) lanes['overdue']!++;
    else if (due === today) lanes['today']!++;
    else lanes['upcoming']!++;
  }
  return lanes;
}
