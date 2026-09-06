import {
  documentFolderPurpose,
  FOLDER_PURPOSE_OF_FIELD,
  isFolderIndex,
  isVoicePath,
  NOTE_TYPE_META,
  refToSlug,
  titleFromSlug,
  VOICES_DIR,
  renderFolderIndex,
  renderRootIndex,
  type IndexEntry,
  type IndexFolder,
  type IndexLink,
  type IndexSubfolder,
  type NoteType,
} from '@qale/domain';
import type { IndexedNote, UseCaseContext } from '../ports.js';
import { workspaceNameOf } from './vault.js';

/**
 * OKF `index.md` generation (alignment phase 1), the librarian's orientation
 * pass. Reads the live index, groups notes by folder, and writes a per-folder
 * `index.md` map plus a root `index.md` stamped with `okf_version`. Every
 * note's `summary` is projected to an OKF `description` here (Phase 3, option
 * A: `summary` stays the internal source of truth, `description` is the
 * emitted boundary field).
 *
 * Idempotent: a folder's map is only rewritten when its content actually
 * changes, so an unchanged tick makes no write and no commit. Reserved files are
 * never re-indexed (the indexer skips them), so writing them can't loop back in.
 * The meetings map reads the clock, but only the month of it (IM-4), so the
 * file changes when a note changes and once at the turn of the month.
 */

/** One-line purpose per folder, shown in the root map and each folder header. */
const FOLDER_PURPOSE: Record<NoteType, string> = {
  source: 'the raw layer — transcripts, articles, threads, cited by derived notes',
  meeting: 'meeting pages: prep, notes, and processed summaries',
  decision: 'the append-only decision spine',
  insight: 'analyses over the raw layer, each citing its evidence',
  customer: 'customer hubs — who they are and where they stand',
  research: 'what Qale worked out: the case for a problem, a competitor scan, the product picture',
  person: 'people the work touches and what they were last told',
  session: 'session receipts — the replayable audit trail',
  skill: 'the written instructions the agent follows when you hand work over',
  agent: 'self-starting agents — what fires on workspace events, and when',
  todo: 'tracked commitments — the PO’s own and what they are waiting on',
  note: 'the documents you write: scratch notes, briefs, PRDs, specs',
  ticket: 'mirrored tracker items, never edited locally',
  wikipage: 'mirrored living documents, never edited locally',
};

/**
 * Folders whose contents are audit trail, not knowledge to orient over: session
 * receipts accrete on every run, so mapping them would churn the index.md on
 * every session for no retrieval gain.
 */
const SKIP_DIRS = new Set<string>([NOTE_TYPE_META.session.dir]);

/**
 * The voices (SK-6). They are filed as skill notes, so without this they would
 * be mapped as skills, and the map is what a session reads to orient itself: a
 * file listed as work the agent can hand itself is a file it will try to run.
 */
const VOICES_PURPOSE = 'how a draft sounds — tone and wording, applied when something is drafted';

/** The Documents folder, with its trailing slash. */
export const DOCUMENTS_PREFIX = `${NOTE_TYPE_META.note.dir}/`;

function str(fm: Record<string, unknown>, key: string): string | undefined {
  return typeof fm[key] === 'string' ? (fm[key] as string) : undefined;
}

/**
 * A wikilink in frontmatter (`[[people/sara-lindqvist]]`) as the title and path
 * of the note it points at. A link to nothing keeps its bare target as the
 * title, so the line still says who, and never prints `[[...]]`.
 */
function resolveLink(ctx: UseCaseContext, ref: string | undefined): IndexLink | undefined {
  const target = refToSlug(ref);
  if (!target) return undefined;
  const path = ctx.index.resolve(target);
  const note = path ? ctx.index.get(path) : null;
  return note ? { title: note.title, path: note.path } : { title: target };
}

/** One note as a map line, with the fields its type's renderer reads. */
function entryOf(ctx: UseCaseContext, n: IndexedNote): IndexEntry {
  const fm = n.frontmatter;
  const entry: IndexEntry = {
    path: n.path,
    title: n.title,
    // Phase 3: the note's `summary` IS the OKF `description` at this boundary.
    description: n.summary,
    lifecycle: n.lifecycle,
  };
  if (n.type === 'meeting') {
    const date = str(fm, 'date');
    const series = str(fm, 'series');
    const customer = resolveLink(ctx, str(fm, 'customer'));
    if (date !== undefined) entry.date = date;
    if (series !== undefined) entry.series = series;
    if (customer) entry.customer = customer;
  }
  if (n.type === 'todo') {
    const due = str(fm, 'due');
    const owner = resolveLink(ctx, str(fm, 'owner'));
    if (due !== undefined) entry.due = due;
    if (owner) entry.owner = owner;
  }
  return entry;
}

/** "insights" → "Insights"; multi-word dirs never occur, but stay safe. */
function labelFor(dir: string): string {
  return dir.charAt(0).toUpperCase() + dir.slice(1);
}

/** Is this one of the PM's documents? The folder says it. */
export function isDocument(n: IndexedNote): boolean {
  return n.type === 'note' && n.path.startsWith(DOCUMENTS_PREFIX);
}

/** The folder a path sits in, relative to `notes/`. "" is the top level. */
export function documentFolderOf(path: string): string {
  const rest = path.slice(DOCUMENTS_PREFIX.length);
  const cut = rest.lastIndexOf('/');
  return cut === -1 ? '' : rest.slice(0, cut);
}

/** One field of an existing folder map's frontmatter, read off the raw text. */
function fieldOf(raw: string | null, key: string): string | undefined {
  if (!raw) return undefined;
  const block = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!block) return undefined;
  const line = block[1]!.split(/\r?\n/).find((l) => l.startsWith(`${key}:`));
  if (!line) return undefined;
  const value = line
    .slice(key.length + 1)
    .trim()
    .replace(/^(["'])(.*)\1$/, '$2')
    .trim();
  return value || undefined;
}

/**
 * The `description` and `purpose_of` lines of an existing folder map. The
 * description is where a Documents folder's purpose lives (the stub writes it,
 * the folder-purpose pass fills it in), and `purpose_of` says what that pass
 * was shown when it wrote. Both are read back rather than invented, so both
 * survive a regeneration.
 */
export function folderMetaOf(raw: string | null): {
  description?: string;
  purposeOf?: string;
} {
  const description = fieldOf(raw, 'description');
  const purposeOf = fieldOf(raw, FOLDER_PURPOSE_OF_FIELD);
  const out: { description?: string; purposeOf?: string } = {};
  if (description !== undefined) out.description = description;
  if (purposeOf !== undefined) out.purposeOf = purposeOf;
  return out;
}

/**
 * The Documents tree (IM-5): `notes/` and every folder under it, each as its
 * own map. A folder exists when a document is in it or its `index.md` is on
 * disk, the same rule the Documents screen uses, so an empty folder still gets
 * a row in its parent and a map of its own.
 */
async function collectDocumentFolders(
  ctx: UseCaseContext,
  all: IndexedNote[],
): Promise<IndexFolder[]> {
  const docs = all.filter(isDocument);
  const keys = new Set<string>();
  const add = (key: string): void => {
    if (!key) return;
    const parts = key.split('/');
    for (let i = 1; i <= parts.length; i++) keys.add(parts.slice(0, i).join('/'));
  };
  for (const d of docs) add(documentFolderOf(d.path));
  for (const f of await ctx.vault.list()) {
    if (f.path.startsWith(DOCUMENTS_PREFIX) && isFolderIndex(f.path)) {
      add(documentFolderOf(f.path));
    }
  }

  const purposes = new Map<string, string>();
  const markers = new Map<string, string>();
  for (const key of keys) {
    const meta = folderMetaOf(await ctx.vault.readRaw(`${DOCUMENTS_PREFIX}${key}/index.md`));
    purposes.set(key, meta.description ?? documentFolderPurpose(titleFromSlug(key)));
    if (meta.purposeOf) markers.set(key, meta.purposeOf);
  }

  const countIn = (key: string): number =>
    docs.filter((d) => d.path.startsWith(`${DOCUMENTS_PREFIX}${key}/`)).length;
  const childrenOf = (key: string): IndexSubfolder[] => {
    const depth = key === '' ? 1 : key.split('/').length + 1;
    const prefix = key === '' ? '' : `${key}/`;
    return [...keys]
      .filter((k) => k.startsWith(prefix) && k.split('/').length === depth)
      .map((k) => ({
        dir: `${DOCUMENTS_PREFIX}${k}`,
        label: titleFromSlug(k),
        purpose: purposes.get(k)!,
        count: countIn(k),
      }));
  };
  const entriesAt = (key: string): IndexEntry[] =>
    docs.filter((d) => documentFolderOf(d.path) === key).map((d) => entryOf(ctx, d));

  const folders: IndexFolder[] = [];
  if (docs.length > 0 || keys.size > 0) {
    folders.push({
      dir: NOTE_TYPE_META.note.dir,
      label: labelFor(NOTE_TYPE_META.note.dir),
      purpose: FOLDER_PURPOSE.note,
      entries: entriesAt(''),
      subfolders: childrenOf(''),
    });
  }
  for (const key of [...keys].sort()) {
    const marker = markers.get(key);
    folders.push({
      dir: `${DOCUMENTS_PREFIX}${key}`,
      label: titleFromSlug(key),
      purpose: purposes.get(key)!,
      entries: entriesAt(key),
      subfolders: childrenOf(key),
      ...(marker ? { purposeOf: marker } : {}),
    });
  }
  return folders;
}

/** Build the shaped folder data the domain renderers consume. */
async function collectFolders(ctx: UseCaseContext): Promise<IndexFolder[]> {
  const all = ctx.index.all();
  const folders: IndexFolder[] = [];
  for (const type of Object.keys(NOTE_TYPE_META) as NoteType[]) {
    const meta = NOTE_TYPE_META[type];
    if (SKIP_DIRS.has(meta.dir)) continue;
    if (type === 'note') {
      folders.push(...(await collectDocumentFolders(ctx, all)));
      continue;
    }
    const notes = all.filter((n) => n.type === type && (type !== 'skill' || !isVoicePath(n.path)));
    if (notes.length === 0) continue;
    folders.push({
      dir: meta.dir,
      label: labelFor(meta.dir),
      purpose: FOLDER_PURPOSE[type],
      entries: notes.map((n) => entryOf(ctx, n)),
    });
  }
  const voices = all.filter((n) => isVoicePath(n.path));
  if (voices.length > 0) {
    folders.push({
      dir: VOICES_DIR,
      label: labelFor(VOICES_DIR),
      purpose: VOICES_PURPOSE,
      entries: voices.map((n) => entryOf(ctx, n)),
    });
  }
  return folders;
}

export interface IndexGenResult {
  /** Paths whose index.md content changed and was rewritten. */
  written: string[];
}

/**
 * Regenerate the vault's `index.md` orientation files. Returns the paths that
 * actually changed (empty when everything was already current).
 *
 * A map that cannot be written is NOT best-effort, whatever the maintenance pass
 * around it can absorb. These files are how anything orients before it retrieves,
 * so a folder silently missing its map is retrieval quietly getting worse on
 * exactly the workspaces big enough to need it, and the failure would show up
 * as thinner answers rather than as an error. So every map is attempted, what did
 * land is still committed (a partial refresh beats a stale one), and then the
 * refusals are raised by name. The maintenance pass logs that at error level.
 */
export async function generateIndexFiles(ctx: UseCaseContext): Promise<IndexGenResult> {
  const folders = await collectFolders(ctx);
  const workspaceName = workspaceNameOf(ctx.vault.root()) ?? 'workspace';
  const today = ctx.clock.now().slice(0, 10);

  const targets: { path: string; content: string }[] = [
    { path: 'index.md', content: renderRootIndex(folders, workspaceName) },
    ...folders.map((f) => ({
      path: `${f.dir}/index.md`,
      content: renderFolderIndex(f, { today }),
    })),
  ];

  const written: string[] = [];
  const refused: string[] = [];
  for (const t of targets) {
    const existing = await ctx.vault.readRaw(t.path);
    if (existing === t.content) continue;
    try {
      await ctx.vault.writeRaw(t.path, t.content);
      written.push(t.path);
    } catch (err) {
      refused.push(`${t.path} (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  if (written.length > 0) {
    await ctx.git.commitPaths(written, 'librarian: refresh index.md orientation maps');
  }
  if (refused.length > 0) {
    throw new Error(`index.md maps could not be written: ${refused.join('; ')}`);
  }
  return { written };
}
