import {
  NOTE_TYPE_META,
  byHeat,
  computeHeat,
  isFolderIndex,
  refToSlug,
  SESSION_FILES_DIR,
  type NoteType,
} from '@pm/domain';
import type { GitCommit, IndexedNote, UseCaseContext } from '../ports.js';
import { reconcileIndex, rebuildIndex } from './reconcile.js';

export interface VaultInfo {
  path: string;
  name: string;
  /** The vault folder IS a git repo root — version history is on. */
  git: boolean;
  /** git is installed, so history CAN be enabled even when `git` is false. */
  gitAvailable: boolean;
  noteCount: number;
}

async function vaultInfo(ctx: UseCaseContext): Promise<VaultInfo> {
  const available = await ctx.git.available();
  const isRepo = available && (await ctx.git.isRepo());
  const root = ctx.vault.root();
  return {
    path: root,
    name: root.split('/').filter(Boolean).pop() ?? root,
    git: isRepo,
    gitAvailable: available,
    noteCount: ctx.index.count(),
  };
}

/** Open (or re-open) a workspace: scaffold folders, reconcile the index. */
export async function openVault(ctx: UseCaseContext): Promise<VaultInfo> {
  await ctx.vault.ensureScaffold();
  // Session working files must never be committed (Sessions v2 invariant 1).
  // Done on open, not just on init: workspaces predate the feature, and a vault
  // that missed the seed would start versioning scratch on the next commit.
  if (await ctx.git.isRepo().catch(() => false)) {
    await ctx.git.ensureIgnored([`${SESSION_FILES_DIR}/`]).catch(() => undefined);
  }
  await reconcileIndex(ctx.vault, ctx.index);
  return vaultInfo(ctx);
}

/** The current vault's info without re-reconciling (for `vault:current`). */
export async function getVaultInfo(ctx: UseCaseContext): Promise<VaultInfo> {
  return vaultInfo(ctx);
}

/**
 * Turn the open vault into a git repo (consent-gated in the UI): init, then
 * commit every existing note so there's a baseline to diff against. A no-op if
 * it's already a repo root.
 */
export async function initVaultGit(ctx: UseCaseContext): Promise<VaultInfo> {
  if (!(await ctx.git.available())) throw new Error('git is not installed');
  if (!(await ctx.git.isRepo())) {
    await ctx.git.init();
    const files = await ctx.vault.list();
    const paths = ['.gitignore', ...files.map((f) => f.path)];
    await ctx.git.commitPaths(paths, 'pm: initialize workspace history');
  }
  return vaultInfo(ctx);
}

export interface NoteVersion {
  commit: GitCommit;
  /** File contents at that commit (frontmatter + body, raw). */
  raw: string;
}

/** Commits that touched this note, newest first. */
export async function getNoteHistory(ctx: UseCaseContext, path: string): Promise<GitCommit[]> {
  if (!ctx.vault.contain(path)) return [];
  return ctx.git.history(path);
}

/** The note's raw contents at a specific commit (for the history viewer). */
export async function getNoteVersion(
  ctx: UseCaseContext,
  path: string,
  hash: string,
): Promise<string | null> {
  if (!ctx.vault.contain(path)) return null;
  return ctx.git.fileAt(path, hash);
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

export interface ThemeHeatRow {
  note: IndexedNote;
  count: number;
  newest: string | null;
}

/**
 * Themes (the durable hubs where insights accrete) ranked by evidence heat —
 * count + newest evidence date. Evidence dates come from each referenced note's
 * `date`/`captured` via the index.
 */
export function getThemesByHeat(ctx: UseCaseContext): ThemeHeatRow[] {
  const themes = ctx.index.listByType('theme').filter((n) => !isFolderIndex(n.path));
  const rows = themes.map((note) => {
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

/**
 * One note with no links, and enough context to answer it honestly. "Has no
 * links" is a symptom with several causes, and they do NOT share an answer: a
 * mirror of an upstream Jira issue is unconnected because nobody has said what
 * it serves yet, a scratch pad is unconnected because it hasn't been worked
 * yet, and only a workspace-owned page nothing cites is the hygiene case. The
 * sweep classifies before it offers, so "Delete" is never proposed for a note
 * whose truth lives somewhere else.
 */
export interface OrphanCandidate {
  path: string;
  title: string;
  type: NoteType;
  /** True when the note mirrors an upstream record — a local delete is a lie,
   *  not a cleanup, and the next sync would undo it anyway. */
  external: boolean;
  /** Plain-text keys worth hunting for besides the title. A ticket's full title
   *  ("PAY-5 · Webhook delivery retries…") never appears in prose; "PAY-5" does. */
  aliases: string[];
  /** Upstream state, verbatim, for a mirror ("In Progress"). Display only. */
  detail: string | null;
}

export interface MaintenanceReport {
  /** Notes with no inbound and no outbound links (candidates for adoption). */
  orphans: OrphanCandidate[];
  /** Links whose target does not resolve (link repair candidates). */
  danglingLinks: { from: string; target: string }[];
}

/** Note types whose content is a projection of an external system of record. */
const MIRROR_TYPES = new Set<NoteType>(['ticket', 'wikipage']);

/**
 * Types the sweep never reports as unlinked. A calendar-mirrored meeting is
 * unlinked for as long as nobody has written about it, which for an upcoming
 * one is simply the normal state of the world — and its lifecycle belongs to
 * the before/after-meeting flow, on the meeting page, not to link hygiene.
 */
const NEVER_ORPHAN = new Set<NoteType>(['skill', 'meeting']);

function str(fm: Record<string, unknown>, key: string): string | null {
  const v = fm[key];
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

/**
 * Classify one unlinked note, or return null when it isn't a finding at all.
 * The only suppression is deliberate: a mirror the upstream system has already
 * closed, which nobody ever cited, is history — surfacing it as maintenance
 * work asks the PO to tidy something that is already over.
 */
function classifyOrphan(n: IndexedNote): OrphanCandidate | null {
  const fm = n.frontmatter;
  const external = MIRROR_TYPES.has(n.type) || str(fm, 'provider') !== null;
  if (!external) {
    return { path: n.path, title: n.title, type: n.type, external: false, aliases: [], detail: null };
  }
  if (fm['state_category'] === 'done') return null;
  // The human half of "PAY-5 · Webhook delivery retries with backoff" — prose
  // cites one or the other, never the composed title.
  const tail = n.title.includes('·') ? n.title.split('·').slice(1).join('·').trim() : null;
  const aliases = [str(fm, 'external_id'), tail].filter((a): a is string => a !== null && a !== n.title);
  return { path: n.path, title: n.title, type: n.type, external: true, aliases, detail: str(fm, 'state') };
}

/** Librarian maintenance scan (PLAN-V2 §3.5): orphans + dangling links. */
export function getMaintenanceReport(ctx: UseCaseContext): MaintenanceReport {
  const all = ctx.index.all().filter((n) => !isFolderIndex(n.path));
  const orphans: OrphanCandidate[] = [];
  const danglingLinks: { from: string; target: string }[] = [];
  for (const n of all) {
    const hasOut = n.links.length > 0;
    const hasIn = ctx.index.backlinks(n.slug).length > 0;
    if (!hasOut && !hasIn && !NEVER_ORPHAN.has(n.type)) {
      const finding = classifyOrphan(n);
      if (finding) orphans.push(finding);
    }
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
  /**
   * Skill files the pack no longer ships. Deleted outright: a retired file keeps
   * its triggered binding, so leaving one behind means a dropped transcript
   * fires both it and the skill that replaced it. Pre-alpha, local edits to a
   * retired skill are not preserved.
   */
  retired: string[] = [],
): Promise<{ written: number; removed: number }> {
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
  let removed = 0;
  for (const file of retired) {
    if (!(await ctx.vault.exists(file))) continue;
    await ctx.vault.remove(file);
    ctx.index.removeByPath(file);
    committed.push(file);
    removed++;
  }
  if (committed.length > 0) await ctx.git.commitPaths(committed, 'skills: seed defaults');
  return { written, removed };
}

