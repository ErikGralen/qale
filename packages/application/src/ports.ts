import type {
  Frontmatter,
  Note,
  NoteType,
  SearchHit,
  ThemeStance,
} from '@pm/domain';

/**
 * Ports — the boundaries the application layer depends on. Infra packages
 * (@pm/vault) implement them; the composition root (main) injects concrete
 * instances. Nothing here imports infra (PLAN §3.1).
 */

export interface FileListing {
  path: string;
  mtime: number;
}

export interface LinkRecord {
  target: string;
  anchor?: string;
  alias?: string;
  line?: number;
}

/** A note as stored in the derived index (metadata + links, no full body). */
export interface IndexedNote {
  path: string;
  slug: string;
  type: NoteType;
  layer: string;
  title: string;
  summary: string;
  status: string | null;
  mtime: number;
  frontmatter: Record<string, unknown>;
  links: LinkRecord[];
}

export interface BacklinkRow {
  fromPath: string;
  line?: number;
}

/** Filesystem vault — raw + parsed reads/writes, hard path containment. */
export interface VaultPort {
  root(): string;
  /** Create the standard folder layout if missing. */
  ensureScaffold(): Promise<void>;
  /** Parse + validate a note; returns null if missing or invalid. */
  readNote(relPath: string): Promise<Note | null>;
  readRaw(relPath: string): Promise<string | null>;
  /** Write frontmatter + body, creating parent dirs. Returns the written Note. */
  writeNote(relPath: string, frontmatter: Frontmatter, body: string): Promise<Note>;
  writeRaw(relPath: string, content: string): Promise<void>;
  remove(relPath: string): Promise<void>;
  exists(relPath: string): Promise<boolean>;
  /** Every `.md` file under the vault. */
  list(): Promise<FileListing[]>;
  /** Absolute path if `relPath` resolves inside the vault, else null. */
  contain(relPath: string): string | null;
}

/** Derived SQLite index — FTS + links + metadata. Fully rebuildable. */
export interface IndexPort {
  reindex(note: Note): void;
  removeByPath(path: string): void;
  get(path: string): IndexedNote | null;
  all(): IndexedNote[];
  listByType(type: NoteType): IndexedNote[];
  search(query: string, limit: number): SearchHit[];
  backlinks(slug: string): BacklinkRow[];
  /** Resolve a wikilink target to an existing note path (Obsidian shortest-path). */
  resolve(target: string): string | null;
  count(): number;
  clear(): void;
}

/** Git layer — path-scoped commits only, never `add -A` (PLAN §3.5). */
export interface GitPort {
  available(): Promise<boolean>;
  isRepo(): Promise<boolean>;
  init(): Promise<void>;
  commitPaths(paths: string[], message: string): Promise<void>;
}

/** Injected clock — domain/use-cases stay pure of the ambient system clock. */
export interface Clock {
  now(): string;
}

export interface UseCaseContext {
  vault: VaultPort;
  index: IndexPort;
  git: GitPort;
  clock: Clock;
}

export type { Note, SearchHit, ThemeStance, NoteType, Frontmatter };
