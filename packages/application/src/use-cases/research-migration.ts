import {
  isReservedFile,
  NOTE_TYPE_META,
  retargetWikilinks,
  SCHEMA_BY_TYPE,
  typeForDir,
  type NoteType,
} from '@qale/domain';
import { parseNote, serializeNote } from '@qale/markdown';
import type { UseCaseContext } from '../ports.js';
import { logError, recordActivityRow } from './proposals.js';

/**
 * The one-time move from `themes/` and `understanding/` into `research/`
 * (docs/memory-types.md MT-8).
 *
 * A theme was a note the agent wanted to write and had nowhere else to put. So
 * was an understanding page. Both are research pages now: one folder, one type,
 * one shelf. A workspace made before that change still holds the old folders,
 * and this pass moves them the first time the workspace opens.
 *
 * What moves, and how:
 *
 * - `themes/<name>.md` becomes `research/<name>.md`. The frontmatter says
 *   `type: research`, `evidence` becomes `sources`, and `stance` leaves the
 *   frontmatter for the first line of the body ("Stance: committed."). A
 *   `wont-do` theme was a decision by nature, so its line also names the
 *   decision that pointed at it, when there is one. Every other field stays.
 * - `understanding/<name>.md` becomes `research/<name>.md` with
 *   `type: research`. `what-goes-here.md` explained the folder, and the folder
 *   is gone, so the file goes with it.
 * - Every `[[themes/x]]` and `[[understanding/x]]` link in the workspace now
 *   reads `[[research/x]]`, typed links included.
 * - A decision's `theme:` back-pointer is folded into its `sources`. An
 *   insight's is dropped: its schema has no `sources` to take it.
 *
 * One commit for the whole move, and one Activity row. Running it on a
 * workspace that has already moved does nothing at all: no write, no commit, no
 * row. The folder maps (`research/index.md`) are not written here; the
 * orientation pass regenerates them on the maintenance tick that follows.
 */

/** The folder themes used to live in. Not a note type any more, so spelled here. */
export const OLD_THEMES_DIR = 'themes';

/** The folder the understanding pages used to live in. */
export const OLD_UNDERSTANDING_DIR = 'understanding';

/** The one file in `understanding/` that was about the folder, not the product. */
const WHAT_GOES_HERE = `${OLD_UNDERSTANDING_DIR}/what-goes-here.md`;

const RESEARCH_DIR: string = NOTE_TYPE_META.research.dir;

/** How the folder maps and the git commit name the move. */
export const RESEARCH_MIGRATION_COMMIT = 'workspace: move themes and understanding into research';

export interface ResearchMigrationResult {
  /** Old paths of the themes that moved. */
  themes: string[];
  /** Old paths of the understanding pages that moved. */
  understanding: string[];
  /** Other files rewritten: a link that now points at research, a folded `theme:` field. */
  rewritten: string[];
  /** Files that could not move because `research/` already had a page by that name. */
  left: string[];
  /** Every path the move touched, in the order git was handed them. */
  changed: string[];
}

const NOTHING: ResearchMigrationResult = {
  themes: [],
  understanding: [],
  rewritten: [],
  left: [],
  changed: [],
};

/** `themes/x.md` → `x.md`; null for `themes/index.md`, `themes/deep/x.md`, or another folder. */
function directChild(path: string, dir: string): string | null {
  const prefix = `${dir}/`;
  if (!path.startsWith(prefix)) return null;
  const rest = path.slice(prefix.length);
  if (rest.includes('/') || !rest.toLowerCase().endsWith('.md') || isReservedFile(path))
    return null;
  return rest;
}

/**
 * Where a link into the old folders points now. Null leaves the link alone. A
 * link may carry the `.md`, so the suffix is kept as it was written.
 */
function retarget(target: string): string | null {
  for (const dir of [OLD_THEMES_DIR, OLD_UNDERSTANDING_DIR]) {
    if (target.startsWith(`${dir}/`)) return `${RESEARCH_DIR}/${target.slice(dir.length + 1)}`;
  }
  return null;
}

/** A frontmatter value that may be one ref or a list of them, as a list. */
function refList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return typeof value === 'string' && value.trim() ? [value] : [];
}

/** `a` then whatever in `b` is not already there. */
function mergeRefs(a: unknown, b: unknown): string[] {
  const out = refList(a);
  for (const ref of refList(b)) if (!out.includes(ref)) out.push(ref);
  return out;
}

/** The stance as a person says it. `wont-do` is the one that is not a word. */
function stanceWords(stance: string): string {
  return stance === 'wont-do' ? "won't do" : stance;
}

/**
 * The stance line, placed as the first line of the body: under the H1 when the
 * body opens with one, at the top otherwise.
 */
function withStanceLine(body: string, line: string): string {
  const trimmed = body.replace(/^\n+/, '');
  const nl = trimmed.indexOf('\n');
  const heading = nl === -1 ? trimmed : trimmed.slice(0, nl);
  if (!/^#\s/.test(heading)) return `${line}\n\n${trimmed}`;
  const rest = nl === -1 ? '' : trimmed.slice(nl + 1).replace(/^\n+/, '');
  return `${heading}\n\n${line}\n\n${rest}`;
}

/** Does this note type carry a `sources` list to fold a `theme:` ref into? */
function typeHasSources(type: NoteType | null): boolean {
  return type !== null && 'sources' in SCHEMA_BY_TYPE[type].shape;
}

/** The note type a file claims, or the one its folder gives it. */
function typeOf(path: string, frontmatter: Record<string, unknown>): NoteType | null {
  const claimed = frontmatter['type'];
  if (typeof claimed === 'string' && claimed in SCHEMA_BY_TYPE) return claimed as NoteType;
  return typeForDir(path.slice(0, path.indexOf('/')));
}

/**
 * The one pass over the rest of the workspace: links into the old folders are
 * retargeted, and a `theme:` field on a record is folded into its `sources` or
 * dropped. Returns the file as it should read, or null when nothing changed.
 */
function rewriteOther(path: string, raw: string): string | null {
  const relinked = retargetWikilinks(raw, retarget);
  const parsed = parseNote(relinked);
  if (parsed.malformed || !('theme' in parsed.frontmatter)) {
    return relinked === raw ? null : relinked;
  }
  const { theme, ...rest } = parsed.frontmatter;
  const frontmatter: Record<string, unknown> = rest;
  if (typeHasSources(typeOf(path, parsed.frontmatter))) {
    frontmatter['sources'] = mergeRefs(rest['sources'], theme);
  }
  return serializeNote(frontmatter, parsed.body);
}

/**
 * A theme as a research page. Fields keep their order; `stance` leaves for the
 * body, and `evidence` takes the `sources` name (merged, when both were set).
 */
function themeAsResearch(raw: string, decidedIn: string[]): string {
  const relinked = retargetWikilinks(raw, retarget);
  const parsed = parseNote(relinked);
  // Frontmatter nobody can read is frontmatter nobody should rewrite. The file
  // still moves, and the normalizer fills `type` from the folder later.
  if (parsed.malformed) return relinked;
  const frontmatter: Record<string, unknown> = {};
  let stance: string | null = null;
  for (const [key, value] of Object.entries(parsed.frontmatter)) {
    if (key === 'type') frontmatter['type'] = 'research';
    else if (key === 'stance') stance = typeof value === 'string' ? value : null;
    // `sources` takes the place of whichever of the two came first. What it
    // holds is settled below: the page's own sources, then the evidence.
    else if (key === 'evidence' || key === 'sources') frontmatter['sources'] = [];
    else frontmatter[key] = value;
  }
  if (!('type' in frontmatter)) frontmatter['type'] = 'research';
  if ('sources' in frontmatter) {
    frontmatter['sources'] = mergeRefs(
      parsed.frontmatter['sources'],
      parsed.frontmatter['evidence'],
    );
  }
  let body = parsed.body;
  if (stance) {
    const decided =
      stance === 'wont-do' && decidedIn.length > 0
        ? ` Decided in ${decidedIn.map((slug) => `[[${slug}]]`).join(', ')}.`
        : '';
    body = withStanceLine(body, `Stance: ${stanceWords(stance)}.${decided}`);
  }
  return serializeNote(frontmatter, body);
}

/** An understanding page as a research page: the type changes, nothing else. */
function understandingAsResearch(raw: string): string {
  const relinked = retargetWikilinks(raw, retarget);
  const parsed = parseNote(relinked);
  if (parsed.malformed) return relinked;
  return serializeNote({ ...parsed.frontmatter, type: 'research' }, parsed.body);
}

/**
 * Which decisions pointed at which theme, by the theme's old slug. Read before
 * anything moves, because the `theme:` field is folded away in the same pass.
 */
async function decisionsByTheme(
  ctx: UseCaseContext,
  paths: string[],
): Promise<Map<string, string[]>> {
  const byTheme = new Map<string, string[]>();
  const decisionsDir = NOTE_TYPE_META.decision.dir;
  for (const path of paths) {
    if (!path.startsWith(`${decisionsDir}/`)) continue;
    const raw = await ctx.vault.readRaw(path);
    if (raw === null) continue;
    const theme = parseNote(raw).frontmatter['theme'];
    if (typeof theme !== 'string') continue;
    const slug = theme
      .replace(/^\[\[|\]\]$/g, '')
      .split(/[#|]/)[0]
      ?.trim()
      .replace(/\.md$/, '');
    if (!slug) continue;
    const list = byTheme.get(slug) ?? [];
    list.push(path.replace(/\.md$/, ''));
    byTheme.set(slug, list);
  }
  return byTheme;
}

/**
 * Move one file into `research/`, transformed. Refuses when a page by that name
 * is already there: two files that disagree have no honest winner, and picking
 * one deletes somebody's writing. The caller reports the path as `left`.
 */
async function moveInto(
  ctx: UseCaseContext,
  from: string,
  name: string,
  transform: (raw: string) => string,
  result: ResearchMigrationResult,
): Promise<boolean> {
  const target = `${RESEARCH_DIR}/${name}`;
  const raw = await ctx.vault.readRaw(from);
  if (raw === null) return false;
  if (await ctx.vault.exists(target)) {
    result.left.push(from);
    return false;
  }
  await ctx.vault.writeRaw(target, transform(raw));
  await ctx.vault.remove(from);
  ctx.index.removeByPath(from);
  const note = await ctx.vault.readNote(target);
  if (note) ctx.index.reindex(note);
  result.changed.push(from, target);
  return true;
}

/** Take away one file the old folder no longer needs, if it is there. */
async function dropFile(ctx: UseCaseContext, path: string, result: ResearchMigrationResult) {
  if (!(await ctx.vault.exists(path))) return;
  await ctx.vault.remove(path);
  ctx.index.removeByPath(path);
  result.changed.push(path);
}

/** The Activity line: what moved, counted, in the app's own words. */
export function researchMigrationLine(themes: number, understanding: number): string {
  const parts: string[] = [];
  if (themes > 0) parts.push(`${themes} theme${themes === 1 ? '' : 's'}`);
  if (understanding > 0) {
    parts.push(`${understanding} understanding page${understanding === 1 ? '' : 's'}`);
  }
  return `I moved ${parts.join(' and ')} into Research.`;
}

/** Why the move needed no card, in the policy's words. */
export const RESEARCH_MIGRATION_REASON =
  'The pages say what they said. Only the folder and the links to it changed.';

/**
 * Run the move, once. See the file comment for what it does. Safe to call on
 * every open: a workspace without the old folders returns at once.
 */
export async function migrateThemesToResearch(
  ctx: UseCaseContext,
): Promise<ResearchMigrationResult> {
  const files = (await ctx.vault.list()).map((f) => f.path);
  const themes = files.filter((p) => directChild(p, OLD_THEMES_DIR) !== null);
  const understanding = files.filter(
    (p) => p !== WHAT_GOES_HERE && directChild(p, OLD_UNDERSTANDING_DIR) !== null,
  );
  const oldFolders = [OLD_THEMES_DIR, OLD_UNDERSTANDING_DIR];
  const present: string[] = [];
  for (const dir of oldFolders) {
    if (files.some((p) => p.startsWith(`${dir}/`)) || (await ctx.vault.exists(dir))) {
      present.push(dir);
    }
  }
  if (present.length === 0) return NOTHING;

  const result: ResearchMigrationResult = {
    themes: [],
    understanding: [],
    rewritten: [],
    left: [],
    changed: [],
  };
  const decided = await decisionsByTheme(ctx, files);

  for (const from of themes) {
    const name = directChild(from, OLD_THEMES_DIR)!;
    const slug = from.replace(/\.md$/, '');
    const moved = await moveInto(
      ctx,
      from,
      name,
      (raw) => themeAsResearch(raw, decided.get(slug) ?? []),
      result,
    );
    if (moved) result.themes.push(from);
  }
  for (const from of understanding) {
    const name = directChild(from, OLD_UNDERSTANDING_DIR)!;
    const moved = await moveInto(ctx, from, name, understandingAsResearch, result);
    if (moved) result.understanding.push(from);
  }

  // The rest of the workspace: links follow the pages, and the back-pointer
  // field goes. Skipped: what just moved, what was left behind, and the
  // orientation maps, which the next tick regenerates.
  const skip = new Set([...result.changed, ...result.left]);
  for (const path of files) {
    if (skip.has(path) || isReservedFile(path)) continue;
    if (oldFolders.some((d) => path.startsWith(`${d}/`))) continue;
    const raw = await ctx.vault.readRaw(path);
    if (raw === null) continue;
    const next = rewriteOther(path, raw);
    if (next === null) continue;
    await ctx.vault.writeRaw(path, next);
    const note = await ctx.vault.readNote(path);
    if (note) ctx.index.reindex(note);
    result.rewritten.push(path);
    result.changed.push(path);
  }

  // The old folders, once nothing of the PM's is left in them. A file that
  // could not move keeps its folder, index and all, so nothing is stranded.
  const leftIn = (dir: string) => result.left.some((p) => p.startsWith(`${dir}/`));
  if (!leftIn(OLD_UNDERSTANDING_DIR)) {
    await dropFile(ctx, WHAT_GOES_HERE, result);
    await dropFile(ctx, `${OLD_UNDERSTANDING_DIR}/index.md`, result);
  }
  if (!leftIn(OLD_THEMES_DIR)) await dropFile(ctx, `${OLD_THEMES_DIR}/index.md`, result);
  for (const dir of present) {
    if (leftIn(dir) || !ctx.vault.removeDir) continue;
    await ctx.vault.removeDir(dir).catch((err) => logError('[qale] could not remove', dir, err));
  }

  if (result.changed.length === 0) return result;
  await ctx.git.commitPaths(result.changed, RESEARCH_MIGRATION_COMMIT);
  if (result.themes.length + result.understanding.length > 0) {
    // No put-back on this row. The Activity undo restores one note from one
    // commit, and this commit moved a whole folder; putting one page back would
    // leave the rest moved and the links pointing at it. `path` is null for the
    // same reason, and a null commit is what the view reads as not revertable.
    await recordActivityRow(
      ctx,
      {
        proposalId: null,
        action: 'updated',
        line: researchMigrationLine(result.themes.length, result.understanding.length),
        reason: RESEARCH_MIGRATION_REASON,
        path: null,
        sessionId: null,
        skill: null,
      },
      'restore',
    );
  }
  return result;
}
