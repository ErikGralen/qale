import {
  NOTE_TYPE_META,
  byHeat,
  computeHeat,
  isFolderIndex,
  refToSlug,
  runnableForms,
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
  /** Name of the sync service whose folder this vault sits in, or null. */
  syncedBy: string | null;
  noteCount: number;
}

/** macOS puts every files-provider sync root under this one folder. */
const FILE_PROVIDER_DIR = 'cloudstorage';

/**
 * Folder-sync services, by the segment their root leaves in a path. Matched
 * whole-segment and case-insensitively, with `suffixed` for the ones that append
 * an account ("OneDrive - Acme", "Dropbox (Personal)"). `Sync` alone is far too
 * common a folder name to claim, so Sync.com is matched on its own app-drive
 * segment only.
 */
const SYNC_ROOTS: { match: string; suffixed?: boolean; name: string }[] = [
  // The iCloud Drive container. Also how "Desktop & Documents in iCloud" shows
  // up once the path is canonical: ~/Documents is a symlink into here.
  { match: 'mobile documents', name: 'iCloud Drive' },
  { match: 'com~apple~clouddocs', name: 'iCloud Drive' },
  { match: 'icloud drive', name: 'iCloud Drive' },
  { match: 'dropbox', suffixed: true, name: 'Dropbox' },
  { match: 'google drive', suffixed: true, name: 'Google Drive' },
  // macOS files-provider layout: ~/Library/CloudStorage/GoogleDrive-me@acme.com
  { match: 'googledrive', suffixed: true, name: 'Google Drive' },
  { match: 'onedrive', suffixed: true, name: 'OneDrive' },
  { match: 'sync.com', name: 'Sync.com' },
  { match: 'pcloud drive', name: 'pCloud' },
  { match: 'pclouddrive', name: 'pCloud' },
  { match: 'nextcloud', name: 'Nextcloud' },
];

/**
 * Which sync service, if any, owns the folder a workspace lives in.
 *
 * Path-shaped on purpose: the failure we are warning about (their sync client
 * and this app writing the same files at the same time) is decided by where the
 * folder is, and a segment check costs nothing on open. The path arrives
 * canonical — `FsVault` realpaths its root — so a symlink into a synced
 * container is caught too.
 */
export function detectSyncedFolder(path: string): string | null {
  let prev = '';
  for (const seg of path.split(/[/\\]/)) {
    const s = seg.trim().toLowerCase();
    if (!s) continue;
    for (const root of SYNC_ROOTS) {
      if (s === root.match) return root.name;
      if (!root.suffixed) continue;
      // "OneDrive - Acme", "Dropbox (Personal)": an account, not a new folder.
      if (s.startsWith(`${root.match} `)) return root.name;
      // "GoogleDrive-me@acme.com". Only inside the files-provider folder, where
      // the suffix can only be an account: elsewhere a hyphen is just a name,
      // and "dropbox-notes" is somebody's own folder.
      if (prev === FILE_PROVIDER_DIR && s.startsWith(`${root.match}-`)) return root.name;
    }
    prev = s;
  }
  return null;
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
    syncedBy: detectSyncedFolder(root),
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
  /** Match the type's lifecycle value, e.g. `"superseded"` on decisions. */
  lifecycle?: string;
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
  if (q.lifecycle) rows = rows.filter((n) => n.lifecycle === q.lifecycle);
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
 * One workspace-owned note with no links. "Has no links" is a symptom with
 * several causes that do NOT share an answer — a scratch pad is unconnected
 * because nobody has worked it yet, a page nothing cites is the hygiene case —
 * so the sweep classifies before it offers anything.
 */
export interface OrphanCandidate {
  path: string;
  title: string;
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

/**
 * A projection of an upstream record — a Jira issue, a Confluence page, a
 * calendar event. Never a maintenance finding: the workspace doesn't own it,
 * can't delete it, and an open ticket nobody has written about yet is the
 * normal state of a tracker, not a defect. Link it when something here has a
 * reason to; until then there is no action to offer.
 */
function isMirror(n: IndexedNote): boolean {
  const provider = n.frontmatter['provider'];
  return MIRROR_TYPES.has(n.type) || (typeof provider === 'string' && provider.trim().length > 0);
}

/** Librarian maintenance scan (PLAN-V2 §3.5): orphans + dangling links. */
export function getMaintenanceReport(ctx: UseCaseContext): MaintenanceReport {
  const all = ctx.index.all().filter((n) => !isFolderIndex(n.path));
  const orphans: OrphanCandidate[] = [];
  const danglingLinks: { from: string; target: string }[] = [];
  for (const n of all) {
    const hasOut = n.links.length > 0;
    const hasIn = ctx.index.backlinks(n.slug).length > 0;
    if (!hasOut && !hasIn && !NEVER_ORPHAN.has(n.type) && !isMirror(n)) {
      orphans.push({ path: n.path, title: n.title });
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
  /** Whichever layout a vault is on, the same runnable counts as present. */
  const present = async (file: string): Promise<string | null> => {
    for (const form of runnableForms(file)) if (await ctx.vault.exists(form)) return form;
    return null;
  };

  let written = 0;
  const committed: string[] = [];
  for (const skill of skills) {
    // Both forms, not just the folder one: a workspace whose migration has not
    // run yet holds the PM's edits under the flat name, and seeding a pristine
    // copy beside it would shadow their file with ours.
    if (await present(skill.file)) continue;
    await ctx.vault.writeRaw(skill.file, skill.content);
    const note = await ctx.vault.readNote(skill.file);
    if (note) ctx.index.reindex(note);
    committed.push(skill.file);
    written++;
  }
  let removed = 0;
  for (const file of retired) {
    // Same reason in reverse: a retired file that migrated into a folder is
    // still retired, and must not keep firing because its path changed.
    for (const form of runnableForms(file)) {
      if (!(await ctx.vault.exists(form))) continue;
      await ctx.vault.remove(form);
      ctx.index.removeByPath(form);
      committed.push(form);
      removed++;
    }
  }
  if (committed.length > 0) await ctx.git.commitPaths(committed, 'skills: seed defaults');
  return { written, removed };
}

