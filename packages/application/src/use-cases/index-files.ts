import {
  NOTE_TYPE_META,
  renderFolderIndex,
  renderRootIndex,
  type IndexEntry,
  type IndexFolder,
  type NoteType,
} from '@pm/domain';
import type { UseCaseContext } from '../ports.js';

/**
 * OKF `index.md` generation (Phase 1 of docs/okf-alignment.md) — the librarian's
 * orientation pass. Reads the live index, groups notes by folder, and writes a
 * per-folder `index.md` map plus a root `index.md` stamped with `okf_version`.
 * Every note's `summary` is projected to an OKF `description` here (Phase 3,
 * option A: `summary` stays the internal source of truth, `description` is the
 * emitted boundary field).
 *
 * Idempotent: a folder's map is only rewritten when its content actually
 * changes, so an unchanged tick makes no write and no commit. Reserved files are
 * never re-indexed (the indexer skips them), so writing them can't loop back in.
 */

/** One-line purpose per folder — shown in the root map and each folder header. */
const FOLDER_PURPOSE: Record<NoteType, string> = {
  source: 'raw captured material — transcripts, articles, threads, cited by derived notes',
  meeting: 'meeting pages: prep, notes, and processed summaries',
  decision: 'the append-only decision spine',
  insight: 'analyses over the raw layer, each citing its evidence',
  customer: 'customer hubs — who they are and where they stand',
  theme: 'the durable things worth solving — problems, pains, opportunities',
  person: 'people the work touches and what they were last told',
  session: 'session receipts — the replayable audit trail',
  skill: 'session types, voices, and filing rules that configure the workspace',
  todo: 'tracked commitments — the PO’s own and what they are waiting on',
  note: 'authored notes that do not fit another folder',
  ticket: 'mirrored tracker items (Jira), never edited locally',
  wikipage: 'mirrored living documents (Confluence), never edited locally',
};

/**
 * Folders whose contents are audit trail, not knowledge to orient over: session
 * receipts accrete on every run, so mapping them would churn the index.md on
 * every session for no retrieval gain.
 */
const SKIP_DIRS = new Set<string>([NOTE_TYPE_META.session.dir]);

/** Build the shaped folder data the domain renderers consume. */
function collectFolders(ctx: UseCaseContext): IndexFolder[] {
  const all = ctx.index.all();
  const folders: IndexFolder[] = [];
  for (const type of Object.keys(NOTE_TYPE_META) as NoteType[]) {
    const meta = NOTE_TYPE_META[type];
    if (SKIP_DIRS.has(meta.dir)) continue;
    const notes = all.filter((n) => n.type === type);
    if (notes.length === 0) continue;
    const entries: IndexEntry[] = notes.map((n) => ({
      path: n.path,
      title: n.title,
      // Phase 3: the note's `summary` IS the OKF `description` at this boundary.
      description: n.summary,
      status: n.status,
    }));
    folders.push({ dir: meta.dir, label: labelFor(meta.dir), purpose: FOLDER_PURPOSE[type], entries });
  }
  return folders;
}

/** "insights" → "Insights"; multi-word dirs never occur, but stay safe. */
function labelFor(dir: string): string {
  return dir.charAt(0).toUpperCase() + dir.slice(1);
}

export interface IndexGenResult {
  /** Paths whose index.md content changed and was rewritten. */
  written: string[];
}

/**
 * Regenerate the vault's `index.md` orientation files. Returns the paths that
 * actually changed (empty when everything was already current). Best-effort by
 * contract — the caller runs it inside the librarian maintenance pass and
 * swallows errors, exactly like the ping sweep.
 */
export async function generateIndexFiles(ctx: UseCaseContext): Promise<IndexGenResult> {
  const folders = collectFolders(ctx);
  const workspaceName = ctx.vault.root().split('/').filter(Boolean).pop() ?? 'workspace';

  const targets: { path: string; content: string }[] = [
    { path: 'index.md', content: renderRootIndex(folders, workspaceName) },
    ...folders.map((f) => ({ path: `${f.dir}/index.md`, content: renderFolderIndex(f) })),
  ];

  const written: string[] = [];
  for (const t of targets) {
    const existing = await ctx.vault.readRaw(t.path);
    if (existing === t.content) continue;
    await ctx.vault.writeRaw(t.path, t.content);
    written.push(t.path);
  }
  if (written.length > 0) {
    await ctx.git.commitPaths(written, 'librarian: refresh index.md orientation maps');
  }
  return { written };
}
