import {
  isReservedFile,
  NOTE_TYPE_META,
  PRODUCT_PICTURE_PATHS,
  retargetWikilinks,
} from '@qale/domain';
import { parseNote, serializeNote } from '@qale/markdown';
import type { UseCaseContext } from '../ports.js';
import { recordActivityRow } from './proposals.js';

/**
 * The one-time move of the three company pages from `research/` into `about/`
 * (docs/learning-how-you-work.md, ticket 16).
 *
 * `research/` came to hold two different things: what Qale worked out for
 * itself (the case for a problem, a competitor scan) and what is true about the
 * PM and the company (the product, how it is built, who owns what). The second
 * kind is a fact, not a piece of reasoning, so it gets its own shelf. This
 * reverses part of the 2026-09-06 fold (docs/memory-types.md, MT-3).
 *
 * What moves, and how:
 *
 * - `research/product.md`, `research/technical.md` and `research/organization.md`
 *   become `about/<same name>.md` with `type: about`. Every other field stays.
 * - Every `[[research/product]]` link in the workspace now reads
 *   `[[about/product]]`, typed links and aliases included. Only those three
 *   targets are touched, so a link to another research page is left alone.
 *
 * One commit for the whole move, and one Activity row. A workspace that holds
 * none of the three does nothing at all: no write, no commit, no row. The
 * folder maps are not written here; the orientation pass regenerates them on
 * the maintenance tick that follows.
 *
 * The shelf may grow later (a teams page, a customers overview), so this pass
 * moves what `PRODUCT_PICTURE_PATHS` names today and nothing else.
 */

/** The folder the three pages used to live in. */
const RESEARCH_DIR: string = NOTE_TYPE_META.research.dir;

/** The folder they live in now. */
const ABOUT_DIR: string = NOTE_TYPE_META.about.dir;

/** How the git commit names the move. */
export const ABOUT_MIGRATION_COMMIT = 'workspace: move the product pages into about';

/** Old path → new path, for the three pages. `about/product.md` is the target
 *  because the type owns the folder; the file name never changes. */
const MOVES: readonly { from: string; to: string; name: string }[] = PRODUCT_PICTURE_PATHS.map(
  (to) => {
    const name = to.slice(ABOUT_DIR.length + 1);
    return { from: `${RESEARCH_DIR}/${name}`, to, name: name.replace(/\.md$/i, '') };
  },
);

export interface AboutMigrationResult {
  /** Old paths of the pages that moved. */
  moved: string[];
  /** Other files rewritten because a link in them pointed at a moved page. */
  rewritten: string[];
  /** Pages that could not move because `about/` already had one by that name. */
  left: string[];
  /** Every path the move touched, in the order git was handed them. */
  changed: string[];
}

const NOTHING: AboutMigrationResult = { moved: [], rewritten: [], left: [], changed: [] };

/**
 * Where a link to one of the three points now. Null leaves the link alone. A
 * link may carry the `.md`, so the suffix is kept as it was written.
 */
function retarget(target: string): string | null {
  const bare = target.replace(/\.md$/i, '');
  const move = MOVES.find((m) => bare === `${RESEARCH_DIR}/${m.name}`);
  if (!move) return null;
  return target === bare ? `${ABOUT_DIR}/${move.name}` : `${ABOUT_DIR}/${move.name}.md`;
}

/** One of the three as an about page: the type changes, nothing else. */
function asAboutPage(raw: string): string {
  const relinked = retargetWikilinks(raw, retarget);
  const parsed = parseNote(relinked);
  // Frontmatter nobody can read is frontmatter nobody should rewrite. The file
  // still moves, and the normalizer fills `type` from the folder later.
  if (parsed.malformed) return relinked;
  return serializeNote({ ...parsed.frontmatter, type: 'about' }, parsed.body);
}

/** The Activity line: which pages moved, in the app's own words. */
export function aboutMigrationLine(names: readonly string[]): string {
  const list =
    names.length === 1
      ? names[0]!
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]!}`;
  return `I moved ${list} from Research to About.`;
}

/** Why the move needed no card, in the policy's words. */
export const ABOUT_MIGRATION_REASON =
  'The pages say what they said. Only the folder and the links to it changed.';

/**
 * Run the move, once. See the file comment for what it does. Safe to call on
 * every open: a workspace without the three pages returns at once.
 */
export async function migrateProductPagesToAbout(
  ctx: UseCaseContext,
): Promise<AboutMigrationResult> {
  const files = (await ctx.vault.list()).map((f) => f.path);
  const present = MOVES.filter((m) => files.includes(m.from));
  if (present.length === 0) return NOTHING;

  const result: AboutMigrationResult = { moved: [], rewritten: [], left: [], changed: [] };
  const names: string[] = [];

  for (const move of present) {
    const raw = await ctx.vault.readRaw(move.from);
    if (raw === null) continue;
    // Two pages that disagree have no honest winner, and picking one deletes
    // somebody's writing. The one already in `about/` stays, and the caller
    // reports the other as `left`.
    if (await ctx.vault.exists(move.to)) {
      result.left.push(move.from);
      continue;
    }
    await ctx.vault.writeRaw(move.to, asAboutPage(raw));
    await ctx.vault.remove(move.from);
    ctx.index.removeByPath(move.from);
    const note = await ctx.vault.readNote(move.to);
    if (note) ctx.index.reindex(note);
    result.moved.push(move.from);
    result.changed.push(move.from, move.to);
    names.push(move.name);
  }

  // The rest of the workspace: links follow the pages. Skipped: what just
  // moved, what was left behind, and the orientation maps, which the next tick
  // regenerates.
  const skip = new Set([...result.changed, ...result.left]);
  for (const path of files) {
    if (skip.has(path) || isReservedFile(path)) continue;
    const raw = await ctx.vault.readRaw(path);
    if (raw === null) continue;
    const next = retargetWikilinks(raw, retarget);
    if (next === raw) continue;
    await ctx.vault.writeRaw(path, next);
    const note = await ctx.vault.readNote(path);
    if (note) ctx.index.reindex(note);
    result.rewritten.push(path);
    result.changed.push(path);
  }

  if (result.changed.length === 0) return result;
  await ctx.git.commitPaths(result.changed, ABOUT_MIGRATION_COMMIT);
  if (names.length > 0) {
    // No put-back on this row. The Activity undo restores one note from one
    // commit, and this commit moved three pages and every link to them; putting
    // one page back would leave the rest moved and the links pointing at it.
    // `path` is null for the same reason, and a null commit is what the view
    // reads as not revertable.
    await recordActivityRow(
      ctx,
      {
        proposalId: null,
        action: 'updated',
        line: aboutMigrationLine(names),
        reason: ABOUT_MIGRATION_REASON,
        path: null,
        sessionId: null,
        skill: null,
      },
      'restore',
    );
  }
  return result;
}
