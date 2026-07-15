import {
  NOTE_TYPE_META,
  byHeat,
  computeHeat,
  computeHealth,
  computeFreshness,
  type Frontmatter,
  type NoteType,
} from '@pm/domain';
import type { IndexedNote, UseCaseContext } from '../ports.js';
import { reconcileIndex, rebuildIndex } from './reconcile.js';

export interface VaultInfo {
  path: string;
  name: string;
  git: boolean;
  noteCount: number;
}

/** Open (or re-open) a workspace: scaffold folders, reconcile the index. */
export async function openVault(ctx: UseCaseContext): Promise<VaultInfo> {
  await ctx.vault.ensureScaffold();
  await reconcileIndex(ctx.vault, ctx.index);
  const isRepo = (await ctx.git.available()) && (await ctx.git.isRepo());
  const root = ctx.vault.root();
  return {
    path: root,
    name: root.split('/').filter(Boolean).pop() ?? root,
    git: isRepo,
    noteCount: ctx.index.count(),
  };
}

export async function rebuild(ctx: UseCaseContext): Promise<{ indexed: number }> {
  return rebuildIndex(ctx.vault, ctx.index);
}

export interface VaultTreeGroup {
  dir: string;
  type: NoteType;
  layer: string;
  notes: IndexedNote[];
}

/** The workspace tree grouped by note type/folder, each group sorted newest-first. */
export function getVaultTree(ctx: UseCaseContext): VaultTreeGroup[] {
  const all = ctx.index.all();
  const groups: VaultTreeGroup[] = [];
  for (const type of Object.keys(NOTE_TYPE_META) as NoteType[]) {
    const meta = NOTE_TYPE_META[type];
    const notes = all.filter((n) => n.type === type).sort((a, b) => b.mtime - a.mtime);
    if (notes.length > 0) {
      groups.push({ dir: meta.dir, type, layer: meta.layer, notes });
    }
  }
  return groups;
}

export interface ProblemHeatRow {
  note: IndexedNote;
  count: number;
  newest: string | null;
}

/**
 * Problems (the durable hubs that absorbed themes) ranked by evidence heat —
 * count + newest evidence date. Evidence dates come from each referenced note's
 * `date`/`captured`/`last_verified` via the index.
 */
export function getProblemsByHeat(ctx: UseCaseContext): ProblemHeatRow[] {
  const problems = ctx.index.listByType('problem');
  const rows = problems.map((note) => {
    const evidence = Array.isArray(note.frontmatter['evidence'])
      ? (note.frontmatter['evidence'] as string[])
      : [];
    const dates = evidence.map((ref) => {
      const path = ctx.index.resolve(stripBrackets(ref));
      const rec = path ? ctx.index.get(path) : null;
      const fm = rec?.frontmatter ?? {};
      const d = fm['date'] ?? fm['last_verified'] ?? fm['captured'];
      return typeof d === 'string' ? d : null;
    });
    const heat = computeHeat(dates);
    return { note, count: heat.count, newest: heat.newest };
  });
  rows.sort((a, b) => byHeat({ count: a.count, newest: a.newest }, { count: b.count, newest: b.newest }));
  return rows;
}

/** Overall workspace health — share of live, tracked claims still fresh. */
export function getWorkspaceHealth(ctx: UseCaseContext) {
  const all = ctx.index.all().map((n) => n.frontmatter as Frontmatter);
  return computeHealth(all, ctx.clock.now());
}

export interface StaleRow {
  note: IndexedNote;
  ageDays: number | null;
  freshForDays: number | null;
}

/** Live, tracked notes that are past their decay window (for the nightly sweep). */
export function getStaleNotes(ctx: UseCaseContext): StaleRow[] {
  const now = ctx.clock.now();
  const rows: StaleRow[] = [];
  for (const n of ctx.index.all()) {
    const f = computeFreshness(n.frontmatter as Frontmatter, now);
    if (f.stale) rows.push({ note: n, ageDays: f.ageDays, freshForDays: f.freshForDays });
  }
  rows.sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0));
  return rows;
}

/**
 * Deterministic `index.md` per folder (PLAN-V2 §3.1): title + one-liner per entry,
 * progressive disclosure for humans and agents alike. Rewritten in place; never a
 * vector-DB second copy to drift. Skips empty folders and the derived sessions dir.
 */
export async function refreshFolderIndexes(ctx: UseCaseContext): Promise<{ written: number }> {
  const all = ctx.index.all();
  let written = 0;
  for (const type of Object.keys(NOTE_TYPE_META) as NoteType[]) {
    const meta = NOTE_TYPE_META[type];
    const notes = all
      .filter((n) => n.type === type && !n.path.endsWith('/index.md'))
      .sort((a, b) => a.title.localeCompare(b.title));
    if (notes.length === 0) continue;
    const lines = notes.map((n) => `- [[${n.slug}|${n.title}]] — ${n.summary}`);
    const body = `# ${capitalize(meta.dir)}\n\n${notes.length} ${type}${notes.length === 1 ? '' : 's'}.\n\n${lines.join('\n')}\n`;
    const path = `${meta.dir}/index.md`;
    await ctx.vault.writeRaw(path, body);
    written++;
  }
  return { written };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function stripBrackets(ref: string): string {
  return ref.replace(/^\[\[/, '').replace(/\]\]$/, '');
}
