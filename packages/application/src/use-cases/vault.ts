import { NOTE_TYPE_META, byHeat, computeHeat, type NoteType } from '@pm/domain';
import type { IndexedNote, UseCaseContext } from '../ports.js';
import { reconcileIndex, rebuildIndex } from './reconcile.js';

export interface VaultInfo {
  path: string;
  name: string;
  git: boolean;
  noteCount: number;
}

/** Open (or re-open) a vault: scaffold folders, reconcile the index. */
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

/** The vault tree grouped by note type/folder, each group sorted newest-first. */
export function getVaultTree(ctx: UseCaseContext): VaultTreeGroup[] {
  const all = ctx.index.all();
  const groups: VaultTreeGroup[] = [];
  for (const type of Object.keys(NOTE_TYPE_META) as NoteType[]) {
    const meta = NOTE_TYPE_META[type];
    const notes = all
      .filter((n) => n.type === type)
      .sort((a, b) => b.mtime - a.mtime);
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
 * Themes ranked by evidence heat (count + newest evidence date). The evidence
 * dates come from each referenced signal's `captured` field via the index.
 */
export function getThemesByHeat(ctx: UseCaseContext): ThemeHeatRow[] {
  const themes = ctx.index.listByType('theme');
  const rows = themes.map((note) => {
    const evidence = Array.isArray(note.frontmatter['evidence'])
      ? (note.frontmatter['evidence'] as string[])
      : [];
    const dates = evidence.map((ref) => {
      const path = ctx.index.resolve(stripBrackets(ref));
      const rec = path ? ctx.index.get(path) : null;
      const captured = rec?.frontmatter['captured'];
      return typeof captured === 'string' ? captured : null;
    });
    const heat = computeHeat(dates);
    return { note, count: heat.count, newest: heat.newest };
  });
  rows.sort((a, b) => byHeat({ count: a.count, newest: a.newest }, { count: b.count, newest: b.newest }));
  return rows;
}

function stripBrackets(ref: string): string {
  return ref.replace(/^\[\[/, '').replace(/\]\]$/, '');
}
