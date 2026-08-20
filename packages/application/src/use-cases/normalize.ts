import {
  isNormalizable,
  normalizeFrontmatter,
  NORMALIZER_MARKERS,
  type Frontmatter,
} from '@qale/domain';
import { parseNote } from '@qale/markdown';
import type { UseCaseContext } from '../ports.js';
import { logError } from './proposals.js';

/**
 * The frontmatter normalization pass (OW4) — the pre-run twin of
 * {@link ./index-files.ts}.
 *
 * Same split, same reasoning: the deterministic part of getting a note into
 * shape happens by rule and writes straight to disk, because filling in a `type`
 * the folder already states is machinery and not authorship. What CANNOT be
 * derived — a summary that says what the note is about — is left as a marked
 * placeholder, and replacing it is the model's work, going through the ordinary
 * approval card like every other thing it writes.
 *
 * Cheap by construction. A note whose frontmatter already passes is read and not
 * written, so a settled workspace makes no writes and no commit at all; the rule
 * set is idempotent, so running the pass twice over its own output does nothing
 * the second time.
 */

export interface NormalizePassResult {
  /** Notes whose frontmatter was actually rewritten. */
  written: string[];
  /** Of those, the ones now carrying a marker for a session to pick up. */
  marked: string[];
}

/** The file's own date as "YYYY-MM-DD" — the fallback for a source's `captured`. */
function fileDateOf(ctx: UseCaseContext, path: string): string {
  const mtime = ctx.index.get(path)?.mtime;
  return mtime ? new Date(mtime).toISOString().slice(0, 10) : ctx.clock.now().slice(0, 10);
}

/**
 * Normalize a named set of notes. Paths that are not ours to touch (orientation
 * files, a runnable's folder, a session's scratch) are skipped before they are
 * even read.
 *
 * Best-effort per note: a file that cannot be written is logged and the rest of
 * the pass carries on. Unlike the index.md maps, a note that stays thin costs
 * one session turn, not the whole workspace's orientation, so a refusal here is
 * not worth failing the run that asked for it.
 */
export async function normalizeNoteFrontmatter(
  ctx: UseCaseContext,
  paths: Iterable<string>,
): Promise<NormalizePassResult> {
  const written: string[] = [];
  const marked: string[] = [];

  for (const path of paths) {
    if (!isNormalizable(path)) continue;
    try {
      const raw = await ctx.vault.readRaw(path);
      if (raw === null) continue;
      const parsed = parseNote(raw);
      const result = normalizeFrontmatter({
        path,
        // `malformed` is the one thing the parser knows and the shape doesn't:
        // a block it could not read comes through as `{}`, which is exactly what
        // an empty file looks like. Null keeps the two apart.
        frontmatter: parsed.malformed ? null : parsed.frontmatter,
        body: parsed.body,
        ...(parsed.rawFrontmatter === undefined ? {} : { rawFrontmatter: parsed.rawFrontmatter }),
        fileDate: fileDateOf(ctx, path),
      });
      if (result.filled.length === 0) continue;
      const note = await ctx.vault.writeNote(path, result.frontmatter as Frontmatter, parsed.body);
      ctx.index.reindex(note);
      written.push(path);
      if (result.filled.some((f) => (NORMALIZER_MARKERS as readonly string[]).includes(f))) {
        marked.push(path);
      }
    } catch (err) {
      logError(
        '[qale] frontmatter normalize skipped',
        path,
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (written.length > 0) {
    await ctx.git.commitPaths(
      written,
      `workspace: normalize frontmatter on ${written.length} note${written.length === 1 ? '' : 's'}`,
    );
  }
  return { written, marked };
}

/**
 * Every note the workspace knows about, which is every note a background session
 * can reach. Run before the librarian's tick hands over a worklist, so the run
 * meets notes that are already in shape.
 */
export async function normalizeVaultFrontmatter(ctx: UseCaseContext): Promise<NormalizePassResult> {
  return normalizeNoteFrontmatter(
    ctx,
    ctx.index.all().map((n) => n.path),
  );
}
