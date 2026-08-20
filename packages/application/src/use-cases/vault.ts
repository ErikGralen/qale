import {
  NOTE_TYPE_META,
  byHeat,
  computeHeat,
  isFolderIndex,
  isReservedFile,
  refToSlug,
  SESSION_FILES_DIR,
  type NoteType,
} from '@qale/domain';
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
  /** Windows only: the folder is deep enough that files inside it break MAX_PATH. */
  pathTooDeep: boolean;
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
  // iCloud for Windows writes one word, no space: C:\Users\ada\iCloudDrive.
  { match: 'iclouddrive', name: 'iCloud Drive' },
  { match: 'dropbox', suffixed: true, name: 'Dropbox' },
  { match: 'google drive', suffixed: true, name: 'Google Drive' },
  // macOS files-provider layout: ~/Library/CloudStorage/GoogleDrive-me@acme.com
  { match: 'googledrive', suffixed: true, name: 'Google Drive' },
  // Google Drive for desktop on Windows is the one sync root that is not a
  // folder under the user profile: it mounts a virtual DRIVE (G: by default,
  // and the letter is the user's to change), so the give-away is not a folder
  // named after the service at all. Every file on that drive sits under either
  // "My Drive" or "Shared drives", so those two segments are the check.
  // `G:\My Drive\qale` has nothing else in it that says Google.
  { match: 'my drive', name: 'Google Drive' },
  { match: 'shared drives', name: 'Google Drive' },
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

/**
 * The name we call a workspace: the last segment of its folder path.
 *
 * The argument is an ABSOLUTE OS path, not a vault path, so it is the one place
 * in this layer where a backslash is a separator and not a character. Splitting
 * on `/` alone turned `C:\Users\erik\Qale` into its own whole self, and the
 * workspace switcher, the root `index.md` and the window title all read back a
 * full disk path where a name belongs. Not `basename()`: this package is
 * deliberately free of `node:` imports (its tsconfig sets `types: []`), and the
 * same both-separators split already sits a few lines up in
 * {@link detectSyncedFolder}.
 *
 * `filter(Boolean)` drops the empty leading segment and any trailing slash, so a
 * path written with one still names the folder rather than nothing.
 */
export function workspaceNameOf(root: string): string | null {
  return root.split(/[/\\]/).filter(Boolean).pop() ?? null;
}

/**
 * How much room every file INSIDE a workspace needs, in characters, and where
 * the number comes from. The longest paths the app mints, measured:
 *
 * - **Dropped material**, which is the worst case. A session's folder is
 *   `sessions/.files/<uuid>/`: 16 + 36 + 1 = 53 characters before the session has
 *   written anything, because the id is a `randomUUID`. Arriving material goes in
 *   `material/` (9) under a name taken from the file the PM dropped, capped at 72
 *   (`MATERIAL_NAME_CAP` in the arrival handler, which points back here). Total:
 *   **134**.
 * - A session's own working files: the same 53, plus the conventional
 *   `per-item/<name>.md` (9 + a model-chosen name of roughly a slug's length + 3)
 *   = about 113.
 * - A session receipt: `sessions/` 9 + `YYYY-MM-DD-` 11 + a 48-character slug +
 *   `-` + 8 characters of session id + `.md` = 80.
 * - Any ordinary note: the longest folder is `attachments/` at 12, plus the same
 *   `YYYY-MM-DD-` 11 and a 48-character slug and `.md` = 74.
 * - Git's own store, which lives in the same folder: a pack file is
 *   `.git/objects/pack/pack-<40 hex>.pack`, 68.
 *
 * Two caps do the real work here and both exist partly for this: `slugify`'s
 * 48 characters and the arrival handler's 72. Without them a note named after a
 * long meeting title, or a file dropped with a 200-character name, would have no
 * upper bound at all and no budget could be honest.
 *
 * 140 covers every line above with a little room, and is what
 * {@link WINDOWS_ROOT_LIMIT} is derived from.
 */
const VAULT_PATH_BUDGET = 140;

/**
 * The longest fully-qualified path Windows accepts without long-path support
 * turned on. `MAX_PATH` is 260 INCLUDING the terminating NUL, so 259 characters
 * of actual path. Long-path support exists (a registry key plus a manifest
 * opt-in) but we cannot count on it: it is off by default on most machines, it
 * is a machine-wide setting the user may not be able to change, and plenty of
 * other software on the same folder still breaks with it on.
 */
const WINDOWS_MAX_PATH = 259;

/**
 * The longest workspace root that still leaves every file inside it reachable on
 * Windows: 259 minus the budget above, minus the separator between them.
 */
export const WINDOWS_ROOT_LIMIT = WINDOWS_MAX_PATH - VAULT_PATH_BUDGET - 1;

/**
 * Is this workspace root so deep that ordinary notes inside it would break the
 * Windows path limit?
 *
 * Worth catching where the folder is CHOSEN, because it is unfixable afterwards
 * in the only way that matters: the failure does not arrive as "this path is too
 * long", it arrives months later as one session that cannot write its working
 * file, or a note that saves in one folder and not another, and no error message
 * would point at the workspace being three folders too deep.
 *
 * Decided by the shape of the path rather than by the platform, so it is one
 * pure function with no `process` in it, testable from any machine, and correct
 * for the case that actually matters: only a Windows path can hit a Windows
 * limit. A drive-letter root (`C:\…`) or a UNC share (`\\server\share\…`) is a
 * Windows path; anything starting at `/` is not, and no length of posix path is
 * a problem worth a warning.
 */
export function isWindowsPathTooDeep(root: string): boolean {
  const windows = /^[a-z]:[/\\]/i.test(root) || root.startsWith('\\\\');
  return windows && root.replace(/[/\\]+$/, '').length > WINDOWS_ROOT_LIMIT;
}

async function vaultInfo(ctx: UseCaseContext): Promise<VaultInfo> {
  const available = await ctx.git.available();
  const isRepo = available && (await ctx.git.isRepo());
  const root = ctx.vault.root();
  return {
    path: root,
    name: workspaceNameOf(root) ?? root,
    git: isRepo,
    gitAvailable: available,
    syncedBy: detectSyncedFolder(root),
    pathTooDeep: isWindowsPathTooDeep(root),
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
    await ctx.git.commitPaths(paths, 'qale: initialize workspace history');
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
  rows.sort((a, b) =>
    byHeat({ count: a.count, newest: a.newest }, { count: b.count, newest: b.newest }),
  );
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
 * several causes that do NOT share an answer: a scratch pad is unconnected
 * because nobody has worked it yet, a page nothing cites is the hygiene case.
 * Which one this is only shows in the note itself, so the librarian reads it
 * before offering anything.
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
 * Workspace machinery: files that make the workspace run rather than pages that
 * hold what the team knows. A skill file, an agent file, a session receipt and a
 * todo are all written and read through their own surface, and nobody has ever
 * had a reason to link one. So "nothing links it" says nothing about them, and
 * neither does "it links nothing": that is simply what these files look like.
 * A fresh workspace ships with two agent files, and reporting those as the
 * hygiene problem of the day is the whole finding set on day one.
 */
const MACHINERY_TYPES = new Set<NoteType>(['skill', 'agent', 'session', 'todo']);

/**
 * Types the sweep never reports as unlinked: the machinery above, plus meetings.
 * A calendar-mirrored meeting is unlinked for as long as nobody has written
 * about it, which for an upcoming one is simply the normal state of the world,
 * and its lifecycle belongs to the meeting's own flow, on the meeting page, not
 * to link hygiene.
 */
const NEVER_ORPHAN = new Set<NoteType>([...MACHINERY_TYPES, 'meeting']);

/**
 * True for the machinery types. Also what keeps them out of the librarian's
 * "similar existing pages" hints: a broken link never meant a skill file.
 * Meetings are deliberately NOT machinery here. They are real pages people link
 * on purpose, and a mistyped meeting link is exactly the case those hints help.
 */
export function isWorkspaceMachinery(type: NoteType): boolean {
  return MACHINERY_TYPES.has(type);
}

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

/**
 * A link pointing at an orientation map (`notes/index`, the root `index`). The
 * maps are real files the app generates and tells agents to read, and they are
 * deliberately never indexed, so nothing can ever resolve one. A scan that did
 * not know that reported every mention of one as a broken link, forever, with
 * no repair that would have fixed it.
 */
function isOrientationTarget(target: string): boolean {
  return isReservedFile(`${target.replace(/\.md$/, '')}.md`);
}

/**
 * Librarian maintenance scan (PLAN-V2 §3.5): orphans + dangling links.
 *
 * Machinery is out of both halves. It was already exempt from "nothing links
 * it"; leaving its OUTBOUND links in was what let the workspace feed on its own
 * exhaust. A session receipt lists what the run read, as wikilinks, and a run
 * reads orientation maps — so every session filed four or five broken links for
 * the next librarian pass to look at, and each of those passes filed a receipt
 * of its own. The scan is for what the team wrote, not for what the app leaves
 * behind.
 */
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
    if (isWorkspaceMachinery(n.type)) continue;
    for (const link of n.links) {
      if (isOrientationTarget(link.target)) continue;
      if (!ctx.index.resolve(link.target))
        danglingLinks.push({ from: n.path, target: link.target });
    }
  }
  return { orphans, danglingLinks };
}
