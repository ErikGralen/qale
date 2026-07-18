import {
  NOTE_TYPE_META,
  byHeat,
  computeHeat,
  isFolderIndex,
  refToSlug,
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
 * `date`/`captured` via the index.
 */
export function getProblemsByHeat(ctx: UseCaseContext): ProblemHeatRow[] {
  const problems = ctx.index.listByType('problem').filter((n) => !isFolderIndex(n.path));
  const rows = problems.map((note) => {
    const evidence = Array.isArray(note.frontmatter['evidence'])
      ? (note.frontmatter['evidence'] as string[])
      : [];
    const dates = evidence.map((ref) => {
      const slug = refToSlug(ref);
      const path = slug ? ctx.index.resolve(slug) : null;
      const rec = path ? ctx.index.get(path) : null;
      const fm = rec?.frontmatter ?? {};
      const d = fm['date'] ?? fm['captured'];
      return typeof d === 'string' ? d : null;
    });
    const heat = computeHeat(dates);
    return { note, count: heat.count, newest: heat.newest };
  });
  rows.sort((a, b) => byHeat({ count: a.count, newest: a.newest }, { count: b.count, newest: b.newest }));
  return rows;
}

export interface NoteQuery {
  types?: NoteType[];
  status?: string;
  /** Notes touched (mtime) within the last N days. */
  recentDays?: number;
  /** Notes whose `customer` frontmatter ref resolves to this slug. */
  customer?: string;
  limit?: number;
}

/**
 * Smart-view queries (PLAN-V2 §3.3) — structured filters over the files table,
 * no user-facing query syntax. Powers the left-panel saved views.
 */
export function queryNotes(ctx: UseCaseContext, q: NoteQuery): IndexedNote[] {
  const cutoff = q.recentDays ? Date.now() - q.recentDays * 24 * 60 * 60 * 1000 : null;
  let rows = ctx.index.all().filter((n) => !isFolderIndex(n.path));
  if (q.types) rows = rows.filter((n) => q.types!.includes(n.type));
  if (q.status) rows = rows.filter((n) => n.status === q.status);
  if (cutoff !== null) rows = rows.filter((n) => n.mtime >= cutoff);
  if (q.customer) {
    rows = rows.filter((n) => {
      const c = n.frontmatter['customer'];
      return typeof c === 'string' && (refToSlug(c)?.endsWith(q.customer!) ?? false);
    });
  }
  rows.sort((a, b) => b.mtime - a.mtime);
  return q.limit ? rows.slice(0, q.limit) : rows;
}

export interface MaintenanceReport {
  /** Notes with no inbound and no outbound links (candidates for adoption). */
  orphans: { path: string; title: string }[];
  /** Links whose target does not resolve (link repair candidates). */
  danglingLinks: { from: string; target: string }[];
}

/** Librarian maintenance scan (PLAN-V2 §3.5): orphans + dangling links. */
export function getMaintenanceReport(ctx: UseCaseContext): MaintenanceReport {
  const all = ctx.index.all().filter((n) => !isFolderIndex(n.path));
  const orphans: { path: string; title: string }[] = [];
  const danglingLinks: { from: string; target: string }[] = [];
  for (const n of all) {
    const hasOut = n.links.length > 0;
    const hasIn = ctx.index.backlinks(n.slug).length > 0;
    if (!hasOut && !hasIn && n.type !== 'skill') orphans.push({ path: n.path, title: n.title });
    for (const link of n.links) {
      if (!ctx.index.resolve(link.target)) danglingLinks.push({ from: n.path, target: link.target });
    }
  }
  return { orphans, danglingLinks };
}

/**
 * Seed the built-in skill pack into `skills/` if absent (PLAN-V2 §3.2). Content is
 * passed in so the application layer stays free of the sessions package. Existing
 * files are never overwritten — editing a skill is how you customise it.
 */
export async function ensureDefaultSkills(
  ctx: UseCaseContext,
  skills: { file: string; content: string }[],
): Promise<{ written: number }> {
  let written = 0;
  const committed: string[] = [];
  for (const skill of skills) {
    if (await ctx.vault.exists(skill.file)) continue;
    await ctx.vault.writeRaw(skill.file, skill.content);
    const note = await ctx.vault.readNote(skill.file);
    if (note) ctx.index.reindex(note);
    committed.push(skill.file);
    written++;
  }
  if (committed.length > 0) await ctx.git.commitPaths(committed, 'skills: seed defaults');
  return { written };
}

