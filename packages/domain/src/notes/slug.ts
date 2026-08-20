import { normalizeLinkType } from './link-types.js';

/**
 * Slug / path / wikilink helpers. A slug is the vault-relative path without the
 * `.md` extension (e.g. `signals/2026-07-12-gong-sso`). Wikilinks target slugs,
 * possibly by their shortest unique tail (Obsidian shortest-path).
 */

export function slugFromPath(path: string): string {
  const slug = path.replace(/\.md$/i, '');
  // A runnable folder's entry file IS the runnable, so its slug is the FOLDER
  // (`skills/spec-review`, never `skills/spec-review/SKILL`). That is what keeps
  // the name a skill is invoked by — the last slug segment — identical in both
  // layouts, so every caller that reads a name off a slug works unchanged.
  return isRunnableEntry(path) ? slug.slice(0, slug.lastIndexOf('/')) : slug;
}

/**
 * Folder hub pages (`<dir>/index.md`) are navigation, not content — every
 * content listing (views, sweeps, agent listings) excludes them via this ONE
 * predicate.
 */
export function isFolderIndex(path: string): boolean {
  return path.endsWith('/index.md');
}

/**
 * Reserved filenames the OKF spec (§3.1) sets aside for orientation, not
 * content: `index.md` (directory map, §8) and `log.md` (update history, §9).
 * They may appear at the vault root (bare `index.md`) or inside any folder, so
 * this matches on the basename — unlike {@link isFolderIndex}, which only knows
 * folder hubs. Reserved files are exempt from the `type`-required rule and never
 * indexed as concept notes: they are read by path, not searched or listed.
 */
export const RESERVED_BASENAMES = ['index.md', 'log.md'] as const;

export function isReservedFile(path: string): boolean {
  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  return (RESERVED_BASENAMES as readonly string[]).includes(base);
}

/**
 * A skill and an agent are FOLDERS. `skills/spec-review/SKILL.md` holds the
 * instructions; anything beside it (`checklist.md`, `examples/`) is the skill's
 * own material. Three loading tiers fall out of that, which is the whole point:
 * name + summary are always in the prompt, the entry file loads when the skill
 * is used, and a sibling only loads when the instructions name its path and the
 * agent reads it. Nothing beside the entry file is ever indexed, listed or
 * searched, so a long reference table costs nothing until it is asked for.
 *
 * Every runnable gets a folder, including the ones carrying nothing extra: one
 * layout beats two, and a skill that grows a file later doesn't have to move.
 */
export const RUNNABLE_DIRS = ['skills', 'agents'] as const;

/** The entry file each folder WRITES. Reads tolerate either (see {@link isRunnableEntry}). */
export const RUNNABLE_ENTRY: Record<string, string> = { skills: 'SKILL.md', agents: 'AGENT.md' };

const ENTRY_BASENAMES = Object.values(RUNNABLE_ENTRY).map((f) => f.toLowerCase());

/** `skills/spec-review/checklist.md` → dir `skills`, name `spec-review`. Null when not inside one. */
function insideRunnableFolder(path: string): { dir: string; name: string; rest: string } | null {
  const parts = path.split('/');
  if (parts.length < 3) return null;
  const [dir, name, ...rest] = parts;
  if (!dir || !name || !(RUNNABLE_DIRS as readonly string[]).includes(dir)) return null;
  return { dir, name, rest: rest.join('/') };
}

/**
 * Is this the file that IS the runnable? Either reserved basename counts in
 * either folder: a hand-made `agents/x/SKILL.md` should resolve rather than
 * sit inert, and indexing has to agree with resolution or a file would list
 * under one name and run under another.
 */
export function isRunnableEntry(path: string): boolean {
  const inside = insideRunnableFolder(path);
  return !!inside && ENTRY_BASENAMES.includes(inside.rest.toLowerCase());
}

/**
 * A file beside the entry — the skill's own material. Never indexed (so it
 * cannot show up as a second skill, in search, or in the prompt's skill index),
 * only ever read by the path its skill's instructions name.
 */
export function isRunnableResource(path: string): boolean {
  const inside = insideRunnableFolder(path);
  return !!inside && !ENTRY_BASENAMES.includes(inside.rest.toLowerCase());
}

/** The name a runnable file is invoked by, in either layout. Null when it is neither. */
export function runnableNameFromPath(path: string): string | null {
  const inside = insideRunnableFolder(path);
  if (inside) return isRunnableEntry(path) ? inside.name : null;
  const parts = path.split('/');
  const [dir, file] = parts;
  if (parts.length !== 2 || !dir || !file || !(RUNNABLE_DIRS as readonly string[]).includes(dir))
    return null;
  return file.toLowerCase().endsWith('.md') && !isReservedFile(path) ? slugFromPath(file) : null;
}

/** Where a runnable of this name is WRITTEN: `skills` + `spec-review` → `skills/spec-review/SKILL.md`. */
export function runnableEntryPath(dir: string, name: string): string {
  return `${dir}/${name}/${RUNNABLE_ENTRY[dir] ?? RUNNABLE_ENTRY['skills']}`;
}

/**
 * Where a retired runnable's own copy is KEPT: `skills/ask/SKILL.md` becomes
 * `skills/ask/RETIRED-SKILL.md`. Same folder, one rename, and it is out of
 * force — the name no longer matches an entry basename, so nothing indexes it,
 * lists it or resolves an invocation to it. Deliberately not a delete: what the
 * PM wrote in there is theirs.
 */
export function retiredEntryPath(dir: string, name: string): string {
  return `${dir}/${name}/RETIRED-${RUNNABLE_ENTRY[dir] ?? RUNNABLE_ENTRY['skills']}`;
}

/**
 * Every path a runnable called `name` could live at, in RESOLUTION order:
 * `skills/` before `agents/` (a customised copy beats the agent file of the
 * same name — the precedence the runtime has always had), and inside each
 * folder the entry file before the legacy flat file, so a migrated vault reads
 * the new layout and a half-migrated one still finds the old.
 */
export function runnableCandidates(name: string): string[] {
  return RUNNABLE_DIRS.flatMap((dir) => [
    runnableEntryPath(dir, name),
    `${dir}/${name}/${dir === 'skills' ? RUNNABLE_ENTRY['agents'] : RUNNABLE_ENTRY['skills']}`,
    `${dir}/${name}.md`,
  ]);
}

/**
 * Both layouts of ONE runnable file, canonical first. Callers that must catch a
 * file whichever pass a vault is on — seeding a default, deleting a retired one
 * — walk this instead of guessing. Any other path is returned as itself.
 */
export function runnableForms(path: string): string[] {
  const inside = insideRunnableFolder(path);
  if (inside && isRunnableEntry(path)) {
    return [runnableEntryPath(inside.dir, inside.name), `${inside.dir}/${inside.name}.md`];
  }
  const name = runnableNameFromPath(path);
  const dir = path.split('/')[0] ?? '';
  return name ? [runnableEntryPath(dir, name), path] : [path];
}

/** The OKF spec version this workspace conforms to — stamped in the root index.md (§12). */
export const OKF_VERSION = '0.2';

/**
 * Where a session's own working files live (Sessions v2 Part 1).
 * `sessions/2026-07-28-synthesis-a1b2c3.md` is the session's git-tracked, indexed
 * *face*; `sessions/.files/a1b2c3/` is its untracked *body* — the relationship is
 * legible from the filesystem alone.
 *
 * The leading dot is what keeps it out of the memory: both doors into the index
 * skip any segment starting with `.` — the `FsVault.walk` that scans, and the
 * watcher that reports live edits — so nothing under here is indexed, searched,
 * retrieved, linkable or counted in freshness (invariant 1). `notIndexable` says
 * the same thing again where rows are written, because when only the scan knew
 * the rule, a drop left a phantom `input.md` note behind. It is also seeded into
 * the vault's `.gitignore`.
 */
export const SESSION_FILES_DIR = 'sessions/.files';

/** Is this vault-relative path inside some session's working files? */
export function isSessionFile(path: string): boolean {
  const p = path.replace(/^\.?\//, '');
  return p === SESSION_FILES_DIR || p.startsWith(`${SESSION_FILES_DIR}/`);
}

/**
 * Is this file a note — something the workspace indexes, lists, searches and
 * lets a wikilink point at? Three kinds of file are not: orientation
 * (`index.md`, `log.md`), a skill's own material beside its entry file, and a
 * session's working files.
 *
 * The single sentence for the whole app, because it was being said in several
 * places and only most of them were being asked. The scan skipped a session's
 * `input.md` and the watcher skipped it, and it still turned up in the index as
 * an unlinked note for the librarian to worry about, because SOMETHING wrote a
 * row directly. So the rule now also sits on the index itself, where every
 * write has to pass it whatever door it came through.
 */
export function isIndexableNote(path: string): boolean {
  return !isReservedFile(path) && !isRunnableResource(path) && !isSessionFile(path);
}

/** The final path segment (basename without extension). */
export function basename(slug: string): string {
  const s = slugFromPath(slug);
  const idx = s.lastIndexOf('/');
  return idx === -1 ? s : s.slice(idx + 1);
}

/**
 * Split a `type::target#heading|alias` wikilink inner text.
 * The type is optional; a malformed type prefix (empty side, unusable token)
 * degrades to an untyped link on the full text — a type never fails a parse.
 * Known inverse spellings canonicalize (`blocked-by::X` → type `blocks`,
 * `reversed`: the semantic edge runs target → source).
 */
export function normalizeLinkTarget(raw: string): {
  target: string;
  anchor?: string;
  alias?: string;
  linkType?: string;
  reversed?: boolean;
} {
  let rest = raw.trim();
  let alias: string | undefined;
  const pipe = rest.indexOf('|');
  if (pipe !== -1) {
    alias = rest.slice(pipe + 1).trim();
    rest = rest.slice(0, pipe).trim();
  }
  let anchor: string | undefined;
  const hash = rest.indexOf('#');
  if (hash !== -1) {
    anchor = rest.slice(hash + 1).trim();
    rest = rest.slice(0, hash).trim();
  }
  let linkType: string | undefined;
  let reversed: boolean | undefined;
  const sep = rest.indexOf('::');
  if (sep !== -1) {
    const typed = normalizeLinkType(rest.slice(0, sep));
    const after = rest.slice(sep + 2).trim();
    if (typed && after) {
      linkType = typed.type;
      if (typed.reversed) reversed = true;
      rest = after;
    }
  }
  return { target: slugFromPath(rest), anchor, alias, linkType, reversed };
}

const TITLE_CASE = /[-_]+/g;

/**
 * Words a title keeps lowercase unless they lead or close it. Without this,
 * "defer-scim-to-q3" reads "Defer Scim To Q3" — machine-made, and visibly not
 * how the PO wrote it down.
 */
const SMALL_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'but',
  'by',
  'for',
  'from',
  'in',
  'into',
  'nor',
  'of',
  'on',
  'or',
  'per',
  'the',
  'to',
  'via',
  'vs',
  'with',
]);

/**
 * Acronyms and wordmarks a slug flattens to lowercase. A derived title is the
 * app speaking a note's name back to the PO, and a PO who writes "SCIM" never
 * reads "Scim" as their own word. Deliberately narrow: this vocabulary, not a
 * general dictionary — an unknown token stays plain title case.
 */
const WORDMARKS: Record<string, string> = {
  api: 'API',
  arr: 'ARR',
  b2b: 'B2B',
  b2c: 'B2C',
  crm: 'CRM',
  csv: 'CSV',
  eu: 'EU',
  gdpr: 'GDPR',
  ios: 'iOS',
  kpi: 'KPI',
  mrr: 'MRR',
  mvp: 'MVP',
  nda: 'NDA',
  nps: 'NPS',
  oauth: 'OAuth',
  okr: 'OKR',
  pdf: 'PDF',
  pii: 'PII',
  poc: 'PoC',
  qa: 'QA',
  qbr: 'QBR',
  rfc: 'RFC',
  roi: 'ROI',
  saas: 'SaaS',
  saml: 'SAML',
  scim: 'SCIM',
  sdk: 'SDK',
  seo: 'SEO',
  sla: 'SLA',
  slo: 'SLO',
  sso: 'SSO',
  ui: 'UI',
  url: 'URL',
  ux: 'UX',
};

/** Derive a human title from a slug's basename when no explicit title exists. */
export function titleFromSlug(slug: string): string {
  const name = basename(slug).replace(/^\d{4}-\d{2}-\d{2}-/, '');
  const words = name.replace(TITLE_CASE, ' ').trim().split(' ').filter(Boolean);
  return words
    .map((word, i) => {
      const lower = word.toLowerCase();
      const mark = WORDMARKS[lower];
      if (mark) return mark;
      if (i > 0 && i < words.length - 1 && SMALL_WORDS.has(lower)) return lower;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

const ASCII_FOLD: Record<string, string> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  ð: 'd',
  þ: 'th',
  đ: 'd',
  ł: 'l',
};

/** Transliterate diacritics to plain ASCII ('möte med åsa' → 'mote med asa'). */
export function asciiFold(text: string): string {
  return text.replace(/[^\x00-\x7f]/g, (ch) => {
    const mapped = ASCII_FOLD[ch] ?? ASCII_FOLD[ch.toLowerCase()];
    if (mapped !== undefined) return mapped;
    const stripped = ch.normalize('NFD').replace(/\p{M}+/gu, '');
    return stripped === ch ? ch : stripped;
  });
}

/**
 * The DOS device names, which are still filenames Windows refuses in 2026.
 * `CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9` and `LPT1`-`LPT9` are not names at
 * all there: they address the console, the printer port and the serial ports, so
 * `type CON` reads the keyboard. The rule is case-insensitive and survives an
 * extension, so `con.md`, `NUL.md` and `Com3.md` all fail the same way, and they
 * fail at `CreateFile`, so the write throws before a byte lands.
 *
 * Some of these are ordinary words a PM types without thinking. "Con" is half of
 * "pros and cons" and a Swedish abbreviation; "aux" is what an audio input is
 * called; "prn" is a real Jira project key somewhere. A title of exactly that one
 * word is rare but it is not exotic, and the failure it causes is a note that
 * cannot be saved with no explanation the user could act on.
 */
const DOS_DEVICE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * One path segment (a filename or a folder name) that Windows will actually
 * accept. Two rules, both of which bite on Windows only and neither of which
 * changes an ordinary name:
 *
 * 1. **A reserved device name gets a trailing underscore before its extension**
 *    (`con.md` becomes `con_.md`). The underscore is inside `slugify`'s own
 *    character class, so the result is still a legal slug and running this twice
 *    changes nothing, which matters: slugs are compared against path
 *    segments that were minted the same way (the wikipage sync matcher, link
 *    repair), and a transform that moved on every pass would stop those matching.
 *
 * 2. **Trailing dots and spaces are removed.** Windows strips them silently when
 *    it creates the file, so `notes/summary. .md` is written and then read back
 *    as `notes/summary.md`: the file we think we wrote and the file on disk have
 *    different names, the index keys a row nothing will ever resolve to, and the
 *    note is invisible in the app while sitting in the folder. Doing the strip
 *    ourselves means one name, everywhere, and it is the name we chose.
 *
 * Applied on every platform on purpose. A vault is a folder of markdown people
 * carry between machines, put in a git repo and clone onto a laptop that is not
 * the one that wrote it, so a name minted on a Mac has to be a name Windows can
 * hold. The characters Windows forbids outright (`: ? * " < > |` and control
 * characters) never reach here: `slugify` has already dropped everything outside
 * `[\w\s-]`.
 */
export function windowsSafeName(name: string): string {
  const trimmed = name.replace(/[. ]+$/, '');
  const dot = trimmed.indexOf('.');
  const stem = dot === -1 ? trimmed : trimmed.slice(0, dot);
  if (!DOS_DEVICE_NAMES.test(stem)) return trimmed;
  return `${stem}_${dot === -1 ? '' : trimmed.slice(dot)}`;
}

/** Lowercase-kebab of a title/summary line. Not a filename on its own: see {@link slugify}. */
function kebab(text: string): string {
  return asciiFold(text.toLowerCase())
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 48)
    .replace(/-+$/, '');
}

/**
 * Lowercase-kebab, filename-safe slug of a title/summary line.
 *
 * This is where a bare filename or folder name is minted: a person page
 * (`people/<slug>.md`), a skill folder (`skills/<slug>/SKILL.md`), a mirrored
 * wiki page (`wikipages/<slug>.md`), a retitled note that never carried a date.
 * The Windows name rules go HERE rather than at each of those call sites, where
 * the next one added would forget them.
 */
export function slugify(text: string): string {
  return windowsSafeName(kebab(text));
}

/**
 * A YYYY-MM-DD-slugified filename from a summary line, for capture.
 *
 * Deliberately built on the raw kebab rather than on {@link slugify}: the date
 * prefix already makes a reserved device name impossible (`2026-08-12-con` is
 * just a name), so running the guard again could only add an underscore to a
 * filename that was never in danger, and every note captured on a Mac would
 * differ from the same note before this rule existed for no reason at all.
 */
export function fileSlug(text: string, date: string): string {
  return `${date}-${kebab(text) || 'note'}`;
}
