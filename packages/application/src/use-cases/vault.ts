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
import { createProposal } from './proposals.js';

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

export interface NoteQuery {
  types?: NoteType[];
  status?: string;
  /** Only freshness-tracked notes that are past their decay window. */
  stale?: boolean;
  /** Only freshness-tracked notes never verified. */
  unverified?: boolean;
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
  const now = ctx.clock.now();
  const cutoff = q.recentDays ? Date.now() - q.recentDays * 24 * 60 * 60 * 1000 : null;
  let rows = ctx.index.all().filter((n) => !n.path.endsWith('/index.md'));
  if (q.types) rows = rows.filter((n) => q.types!.includes(n.type));
  if (q.status) rows = rows.filter((n) => n.status === q.status);
  if (cutoff !== null) rows = rows.filter((n) => n.mtime >= cutoff);
  if (q.customer) {
    rows = rows.filter((n) => {
      const c = n.frontmatter['customer'];
      return typeof c === 'string' && stripBrackets(c).replace(/\.md$/, '').endsWith(q.customer!);
    });
  }
  if (q.stale || q.unverified) {
    rows = rows.filter((n) => {
      const f = computeFreshness(n.frontmatter as Frontmatter, now);
      return (q.stale && f.stale) || (q.unverified && f.unverified);
    });
  }
  rows.sort((a, b) => b.mtime - a.mtime);
  return q.limit ? rows.slice(0, q.limit) : rows;
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
 * The nightly (app-open) freshness sweep (PLAN-V2 §3.5, Phase 6): stale claims
 * become "needs re-verification" cards in the Inbox. A re-verify card echoes the
 * note's current content; approving it re-stamps `last_verified` (via the normal
 * accept path). Deduped against pending librarian cards so the sweep is idempotent.
 */
export async function runFreshnessSweep(ctx: UseCaseContext, limit = 20): Promise<{ created: number }> {
  const pending = ctx.proposals.list('pending');
  const alreadyCarded = new Set(
    pending.filter((p) => p.sessionId === 'librarian').map((p) => p.targetPath),
  );
  const stale = getStaleNotes(ctx).slice(0, limit);
  let created = 0;
  for (const row of stale) {
    if (alreadyCarded.has(row.note.path)) continue;
    const note = await ctx.vault.readNote(row.note.path);
    if (!note) continue;
    const sources = collectRefs(note.frontmatter as Record<string, unknown>);
    createProposal(ctx, {
      kind: 'note',
      sessionId: 'librarian',
      targetPath: note.path,
      baseHash: null,
      payload: {
        path: note.path,
        frontmatter: note.frontmatter as Record<string, unknown>,
        body: note.body,
        rationale: `Stale — last verified ${row.ageDays}d ago (clock ${row.freshForDays}d). Still true? Approve to re-verify.`,
      },
      rationale: `Stale ${note.type}: re-verify "${note.frontmatter.summary}"`,
      evidence: sources.map((r) => ({ ref: r, resolved: true })),
      inference: false,
    });
    created++;
  }
  return { created };
}

export interface MaintenanceReport {
  stale: number;
  /** Notes with no inbound and no outbound links (candidates for adoption). */
  orphans: { path: string; title: string }[];
  /** Links whose target does not resolve (link repair candidates). */
  danglingLinks: { from: string; target: string }[];
}

/** Librarian maintenance scan (PLAN-V2 §3.5): orphans + dangling links + stale. */
export function getMaintenanceReport(ctx: UseCaseContext): MaintenanceReport {
  const all = ctx.index.all().filter((n) => !n.path.endsWith('/index.md'));
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
  return { stale: getStaleNotes(ctx).length, orphans, danglingLinks };
}

function collectRefs(fm: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const key of ['evidence', 'sources']) {
    const v = fm[key];
    if (Array.isArray(v)) for (const r of v) if (typeof r === 'string') out.push(r);
  }
  return out;
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

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function stripBrackets(ref: string): string {
  return ref.replace(/^\[\[/, '').replace(/\]\]$/, '');
}
