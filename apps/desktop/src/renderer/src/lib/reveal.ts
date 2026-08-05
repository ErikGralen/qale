import { isFolderIndex } from '@qale/domain';
import type { NoteType, VaultTreeDTO } from '@qale/ipc';

/**
 * Progressive reveal — the UI is exactly as big as the memory. The librarian
 * files every type from day one, but a type only *surfaces* (sidebar rail,
 * Memory shelves) once the workspace actually holds one. Earned stays earned:
 * a revealed type never hides again, even if its notes are later deleted —
 * the memory accretes, and so does the instrument.
 *
 * View-only state (never a vault write), persisted per workspace like the pin
 * set. On the first launch against an existing workspace everything present is
 * grandfathered in silently — only growth *after* that carries the "new" mark.
 */

/** Always on the instrument, even before the memory holds anything: the
 *  between-meetings loop starts with a meeting and a scratch note. */
export const CORE_TYPES: readonly NoteType[] = ['meeting', 'note'];

/**
 * Types with first-class homes (Skills footer, Todos view, the Sessions rail),
 * never shelved. A session receipt in particular is a record the user never
 * authors: it stays linkable and searchable, but it is not a kind of note the
 * memory asks them to keep track of.
 */
export const HOMED_TYPES: readonly NoteType[] = ['skill', 'agent', 'todo', 'session'];

const REVEALED_KEY = 'qale.revealed.v1';
const REVEAL_SEEN_KEY = 'qale.revealSeen.v1';

/** Every type the workspace currently holds at least one real note of. */
export function contentTypes(tree: VaultTreeDTO): NoteType[] {
  return tree.groups
    .filter((g) => !HOMED_TYPES.includes(g.type) && g.notes.some((n) => !isFolderIndex(n.path)))
    .map((g) => g.type);
}

function load(key: string, vaultPath: string): NoteType[] | null {
  try {
    const raw = localStorage.getItem(`${key}:${vaultPath}`);
    if (raw == null) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is NoteType => typeof t === 'string') : null;
  } catch {
    return null;
  }
}

function persist(key: string, vaultPath: string, types: readonly NoteType[]) {
  try {
    localStorage.setItem(`${key}:${vaultPath}`, JSON.stringify(types));
  } catch {
    /* ignore quota */
  }
}

/** `null` means this workspace has never been opened since the feature landed. */
export const loadRevealed = (vaultPath: string): NoteType[] | null => load(REVEALED_KEY, vaultPath);
export const persistRevealed = (vaultPath: string, types: readonly NoteType[]): void =>
  persist(REVEALED_KEY, vaultPath, types);
export const loadRevealSeen = (vaultPath: string): NoteType[] =>
  load(REVEAL_SEEN_KEY, vaultPath) ?? [];
export const persistRevealSeen = (vaultPath: string, types: readonly NoteType[]): void =>
  persist(REVEAL_SEEN_KEY, vaultPath, types);
