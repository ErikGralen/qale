import {
  BROKEN_FRONTMATTER_FIELD,
  NEEDS_SUMMARY_FIELD,
  NOTE_TYPES,
  typeForDir,
  type NoteType,
} from './frontmatter.js';
import { TYPE_RULES } from './invariant.js';
import {
  isReservedFile,
  isRunnableEntry,
  isRunnableResource,
  isSessionFile,
  slugFromPath,
  titleFromSlug,
} from './slug.js';

/**
 * Deterministic frontmatter normalization (OW4) — the pre-run half of the
 * `index.md` pass in {@link ./index-files.ts}.
 *
 * `index.md` is generated from the index and written straight to disk, because
 * a directory map is machinery rather than authorship. The same is true of a
 * note's own shape: a missing `type` on a file sitting in `sources/`, a summary
 * that was never written, a meeting whose date is right there in its filename.
 * Left alone, a session opens the note and spends its first turn noticing the
 * mess before it can start on the work it was asked to do.
 *
 * So the machine part happens first and by rule. This module FILLS only what the
 * file and its path already say, and where something should exist but cannot be
 * derived — a real summary, which is a reading job — it writes a placeholder and
 * MARKS it. The marker is a to-do the model picks up in the same run through the
 * normal propose/update path, not a mess it has to discover.
 *
 * Pure: no filesystem, no clock, no YAML. The caller parses the file, hands the
 * pieces in, and writes the result back (see @qale/application `normalize.ts`).
 */

export interface NormalizeInput {
  /** Vault-relative path, e.g. "sources/2026-07-30-nordkap-transcript.md". */
  path: string;
  /**
   * The file's parsed frontmatter, or null when it HAD a block that would not
   * parse. Null is not the same as empty: a file with no block at all gets `{}`
   * and is filled in; a broken one is preserved verbatim and marked.
   */
  frontmatter: Record<string, unknown> | null;
  /** The body, frontmatter stripped. */
  body: string;
  /** The block's text, verbatim. Only read when `frontmatter` is null. */
  rawFrontmatter?: string;
  /** The file's own date ("YYYY-MM-DD") — the last resort for a missing `captured`. */
  fileDate?: string;
}

export interface FrontmatterNormalization {
  /** What to write. The input object unchanged when `filled` is empty. */
  frontmatter: Record<string, unknown>;
  /**
   * The fields this pass wrote or removed, in the order it touched them. Empty
   * means the file already passes and must not be rewritten — that is the whole
   * of the idempotence contract, and the caller's cue to skip the write.
   */
  filled: string[];
}

/**
 * Types this pass never touches. Their files are written by machinery that
 * already fills them (a session receipt, a skill file the Skills view owns), and
 * two of them freeze `summary` outright, so a marker left on one could never be
 * cleared by the session it was addressed to.
 */
const UNTOUCHED: readonly NoteType[] = ['skill', 'agent', 'session'];

/**
 * Is this path one of ours to normalize at all? Generated orientation files
 * (`index.md`, `log.md`), a runnable's own folder, and a session's scratch files
 * are all excluded by path, before anything is parsed — the pass must never
 * write frontmatter into a file another part of the app regenerates.
 */
export function isNormalizable(path: string): boolean {
  if (isReservedFile(path)) return false;
  if (isRunnableEntry(path) || isRunnableResource(path)) return false;
  if (isSessionFile(path)) return false;
  return true;
}

/** `sources/2026-07-30-nordkap.md` → `2026-07-30`. Null when the name carries no date. */
function dateFromPath(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const m = /^(\d{4}-\d{2}-\d{2})-/.exec(name);
  return m?.[1] ?? null;
}

/** The body's first `# heading`, if it opens with one. */
function firstHeading(body: string): string | null {
  for (const line of body.split('\n')) {
    if (!line.trim()) continue;
    const m = /^#\s+(.*\S)\s*$/.exec(line);
    return m?.[1] ?? null;
  }
  return null;
}

/**
 * The comparison behind "does this heading say more than the filename does".
 * Case and punctuation are exactly what a slug throws away, so `# Nordkap Check
 * in` over `nordkap-check-in.md` is the same words twice and not worth a field.
 */
function sameWords(a: string, b: string): boolean {
  const fold = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return fold(a) === fold(b);
}

/**
 * The provisional summary, derived exactly the way FsVault's read-time coercion
 * already derives one. That equality is the point: normalizing a thin note
 * changes nothing the PM was being shown, it only makes the coercion real on
 * disk and marks it as owed a proper summary.
 */
function derivedSummary(path: string, body: string): string {
  for (const line of body.split('\n')) {
    const t = line
      .replace(/^#+\s*/, '')
      .replace(/^>\s*/, '')
      .trim();
    if (t) return t.slice(0, 200);
  }
  return titleFromSlug(slugFromPath(path));
}

/** Could a session's update card change this type's `summary`? */
function canReviseSummary(type: NoteType): boolean {
  const mutable = TYPE_RULES[type].mutableFields ?? 'all';
  return mutable === 'all' || mutable.includes('summary');
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The type this file is, by the workspace's existing conventions: an explicit
 * valid `type` wins, otherwise the folder names it. Null means neither answered,
 * and a file we cannot place is a file we do not stamp — a stray markdown file
 * at the vault root is not ours to retype.
 */
function resolveType(path: string, raw: Record<string, unknown>): NoteType | null {
  const declared = raw['type'];
  if (typeof declared === 'string' && (NOTE_TYPES as readonly string[]).includes(declared)) {
    return declared as NoteType;
  }
  return typeForDir(path.split('/')[0] ?? '');
}

/**
 * Normalize one note's frontmatter. Idempotent by construction: every rule below
 * either fills a field that is absent or retires a marker whose job is done, so
 * a second pass over its own output reports nothing to fill.
 *
 * The rules, in order:
 * 1. `type` from an explicit value, else from the folder.
 * 2. Broken YAML is kept verbatim under `broken_frontmatter` rather than guessed
 *    at, and the note is marked; a marker cleared by a session is swept away.
 * 3. `title` from the body's opening heading, but only when it says more than
 *    the filename already does.
 * 4. `summary` from the body's first line, marked `needs_summary` because a
 *    derived line is a placeholder, not a summary. The marker retires itself the
 *    moment the summary stops being the line we derived.
 * 5. Dates that the file itself states: a meeting's `date` and a source's
 *    `captured` from a `YYYY-MM-DD-` filename, and `captured` from the file's own
 *    date as a fallback, since "when this was captured" is a fact about the file.
 */
export function normalizeFrontmatter(input: NormalizeInput): FrontmatterNormalization {
  const raw = input.frontmatter ?? {};
  const unchanged: FrontmatterNormalization = { frontmatter: raw, filled: [] };
  if (!isNormalizable(input.path)) return unchanged;

  const type = resolveType(input.path, raw);
  if (!type || UNTOUCHED.includes(type)) return unchanged;

  const filled: string[] = [];
  // `type` first so a note that never had one reads like every other note.
  const { type: _dropped, ...rest } = raw;
  const next: Record<string, unknown> = { type, ...rest };
  if (raw['type'] !== type) filled.push('type');

  // 2. The block that would not parse. Kept whole: whatever was in there was
  // meant, and a pass that overwrote it would destroy the only copy outside git.
  const broken = input.frontmatter === null ? (input.rawFrontmatter ?? '').trim() : '';
  if (broken) {
    if (next[BROKEN_FRONTMATTER_FIELD] !== broken) {
      next[BROKEN_FRONTMATTER_FIELD] = broken;
      filled.push(BROKEN_FRONTMATTER_FIELD);
    }
  } else if (BROKEN_FRONTMATTER_FIELD in next && !str(next[BROKEN_FRONTMATTER_FIELD])) {
    // A card cannot delete a frontmatter key (the merge is shallow), so a session
    // clears the marker by blanking it and the next pass takes the field away.
    delete next[BROKEN_FRONTMATTER_FIELD];
    filled.push(BROKEN_FRONTMATTER_FIELD);
  }

  // 3. A heading that only repeats the filename is not worth a field.
  if (!str(next['title'])) {
    const heading = firstHeading(input.body);
    if (heading && !sameWords(heading, titleFromSlug(slugFromPath(input.path)))) {
      next['title'] = heading;
      filled.push('title');
    }
  }

  // 4. The summary, and the one thing this pass is honest about not knowing.
  const summary = str(next['summary']);
  const derived = derivedSummary(input.path, input.body);
  if (!summary) {
    next['summary'] = derived;
    filled.push('summary');
    if (canReviseSummary(type) && next[NEEDS_SUMMARY_FIELD] !== true) {
      next[NEEDS_SUMMARY_FIELD] = true;
      filled.push(NEEDS_SUMMARY_FIELD);
    }
  } else if (
    NEEDS_SUMMARY_FIELD in next &&
    (next[NEEDS_SUMMARY_FIELD] !== true || summary !== derived)
  ) {
    // Either the session cleared the flag, or it wrote a summary that is no
    // longer the line we derived — which is exactly what the flag was asking
    // for. Retiring it here means a session that forgets the second half of the
    // instruction still ends up with a clean note.
    delete next[NEEDS_SUMMARY_FIELD];
    filled.push(NEEDS_SUMMARY_FIELD);
  }

  // 5. Dates the file states about itself. Nothing here guesses when a meeting
  // happened from when its file was last written; only the filename may say so.
  if (type === 'meeting' && !str(next['date'])) {
    const date = dateFromPath(input.path);
    if (date) {
      next['date'] = date;
      filled.push('date');
    }
  }
  if (type === 'source' && !str(next['captured'])) {
    const date = dateFromPath(input.path) ?? input.fileDate;
    if (date) {
      next['captured'] = date;
      filled.push('captured');
    }
  }

  return filled.length > 0 ? { frontmatter: next, filled } : unchanged;
}
