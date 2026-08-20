import type {
  Frontmatter,
  LinkOrigin,
  Note,
  NoteType,
  SchemaMiss,
  SearchHit,
  ThemeStance,
} from '@qale/domain';

/**
 * Ports — the boundaries the application layer depends on. Infra packages
 * (@qale/vault) implement them; the composition root (main) injects concrete
 * instances. Nothing here imports infra (PLAN §3.1).
 */

/**
 * Every `relPath` crossing these ports is a VAULT path, and a vault path is
 * always posix: segments joined with `/`, on macOS, Linux and Windows alike. It
 * is the app's note id, not a filesystem path that happens to be relative, and
 * everything downstream depends on that one spelling: the index keys rows by it,
 * wikilinks target it, git is handed it verbatim, `slugFromPath` /
 * `isFolderIndex` / `isReservedFile` and the type-from-folder inference all split
 * it on `/`. The adapter (`@qale/vault`) converts at the boundary, in
 * `toPosixPath`, so nothing above this line ever asks what platform it is on.
 */
export interface FileListing {
  path: string;
  mtime: number;
}

export interface LinkRecord {
  target: string;
  anchor?: string;
  alias?: string;
  /** Canonical link type; absent = untyped. */
  type?: string;
  /** True when the semantic edge runs target → source ("blocked by"). */
  reversed?: boolean;
  /** Where the edge came from: body wikilink, frontmatter ref, or provider sync. */
  origin?: LinkOrigin;
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
  /** The type's lifecycle value (a decision's `standing`, a todo's
   *  `commitment`, …), or null when the type carries no lifecycle. */
  lifecycle: string | null;
  /** Whether the file holds any text below its frontmatter. The lists never
   *  carry a body, and "is there anything in this note yet?" is a question they
   *  have to be able to answer without reading the file again. */
  hasBody: boolean;
  mtime: number;
  frontmatter: Record<string, unknown>;
  links: LinkRecord[];
  /** Set when the file did not fit the type it claims — see {@link SchemaMiss}. */
  schemaMiss?: SchemaMiss;
}

export interface BacklinkRow {
  fromPath: string;
  /** Canonical link type of the inbound edge; absent = untyped. */
  type?: string;
  reversed?: boolean;
  origin?: LinkOrigin;
  line?: number;
}

/**
 * What a write throws when the containment guard refuses it. Its own type,
 * because a refusal is not a failure of the same kind as everything else a write
 * can hit: a network blip or a locked file is bad luck and worth retrying, while
 * a refusal means OUR OWN path construction produced something outside the
 * workspace and will produce it again on every tick. Machinery that treats the
 * two alike — logs, moves on, advances a cursor — turns a bug into coverage that
 * quietly rots, which is the whole shape of the failure this type exists to stop.
 */
export class VaultBoundaryError extends Error {
  /** The path that was refused, as the caller asked for it. */
  readonly relPath: string;

  constructor(relPath: string) {
    super(`path escapes the workspace: ${relPath}`);
    this.name = 'VaultBoundaryError';
    this.relPath = relPath;
  }
}

/**
 * Whether an error is a containment refusal. Matched on `name` rather than
 * `instanceof`: the class crosses package and bundle chunk boundaries, and a
 * duplicated class object must not make a refusal look ordinary.
 */
export function isVaultBoundaryError(err: unknown): boolean {
  return err instanceof Error && err.name === 'VaultBoundaryError';
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
  /**
   * Replace only the body, preserving the file's raw frontmatter block
   * byte-for-byte. The write path for body-only edits: coerced/fallback
   * in-memory frontmatter must never round-trip to disk.
   */
  writeBody(relPath: string, body: string): Promise<Note>;
  writeRaw(relPath: string, content: string): Promise<void>;
  /** Write a non-markdown asset (dropped image, etc.), creating parent dirs. */
  writeBinary(relPath: string, data: Uint8Array): Promise<void>;
  /** Delete a file. Throws {@link VaultBoundaryError} if the path escapes. */
  remove(relPath: string): Promise<void>;
  exists(relPath: string): Promise<boolean>;
  /** Every `.md` file under the vault. */
  list(): Promise<FileListing[]>;
  /**
   * Vault-relative paths of the files directly inside `relPath`, sorted.
   * Unlike {@link list} this is not limited to `.md` and does not recurse: it
   * answers "what else is in this skill's folder", which is a question about
   * files the index deliberately knows nothing about.
   */
  listDir(relPath: string): Promise<string[]>;
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

/** One commit that touched a note (for the per-note history panel). */
export interface GitCommit {
  hash: string;
  /** ISO date of the commit. */
  date: string;
  message: string;
  author: string;
}

/** Git layer — path-scoped commits only, never `add -A` (PLAN §3.5). */
export interface GitPort {
  available(): Promise<boolean>;
  isRepo(): Promise<boolean>;
  init(): Promise<void>;
  /** Add any missing patterns to the vault's `.gitignore` (additive, idempotent). */
  ensureIgnored(patterns: string[]): Promise<void>;
  commitPaths(paths: string[], message: string): Promise<void>;
  /** Commits that touched `relPath`, newest first (empty if not a repo). */
  history(relPath: string): Promise<GitCommit[]>;
  /** File contents at a commit, or null if it didn't exist there. */
  fileAt(relPath: string, hash: string): Promise<string | null>;
}

/** Injected clock — domain/use-cases stay pure of the ambient system clock. */
export interface Clock {
  now(): string;
}

/** A persisted proposal row (app.db — primary state, never dropped, PLAN §3.5). */
export interface ProposalRecord {
  id: string;
  kind: string;
  sessionId: string;
  skill: string | null;
  targetPath: string | null;
  /** Content hash of the target's body at proposal time. Not a gate on applying
   *  the card (anchoring decides that) — it is how the review can say the note
   *  moved underneath a card that still fits. */
  baseHash: string | null;
  payload: unknown;
  rationale: string;
  evidence: { ref: string; label?: string; resolved: boolean }[];
  inference: boolean;
  /** The PM asked for this in the conversation, so there is no note to cite.
   *  Optional: added after v1, and rows written before it carry nothing. */
  asked?: boolean;
  status: string;
  created: number;
  resolved: number | null;
}

export interface CreateProposalInput {
  kind: string;
  sessionId: string;
  /** The skill in force when this card was produced — its provenance. */
  skill?: string;
  targetPath: string | null;
  baseHash: string | null;
  payload: unknown;
  rationale: string;
  evidence: { ref: string; label?: string; resolved: boolean }[];
  inference: boolean;
  /** The PM asked for this in the conversation (see `EvidenceBasis` in @qale/domain). */
  asked?: boolean;
}

/** Proposal store (app.db) — the durable proposal queue + accept/reject log. */
export interface ProposalPort {
  create(input: CreateProposalInput, now: number): ProposalRecord;
  list(status?: string): ProposalRecord[];
  get(id: string): ProposalRecord | null;
  setStatus(id: string, status: string, resolved: number | null): void;
  pendingCount(): number;
}

/**
 * A question a session parked on, waiting for the PM (QM ticket 9). Same rails
 * as a proposal — app.db, primary state, created by a session and settled by the
 * PM — with the one difference that a proposal keeps its accept/reject log and
 * this does not: a row exists if and only if the question is still unanswered.
 * Answering removes it, which is also what makes answering twice harmless.
 *
 * `questions` is opaque here for the same reason a proposal's payload is: the
 * shape belongs to the agent package, which imports this one.
 */
export interface AskRecord {
  /** Derived from the session and the questions, so re-asking is the same row. */
  id: string;
  sessionId: string;
  questions: unknown;
  /** The skill in force when it asked, so answering later resumes under it. */
  skill: string | null;
  /** Whether that skill was granted outbound by the trigger that fired it. */
  outbound: boolean;
  /**
   * Nobody was at the screen when it asked: a clock started the run, or the PM
   * handed material over and walked away. Half of what decides whether the
   * question is owed an answer; the other half is which agent asked.
   */
  unattended: boolean;
  created: number;
}

export interface CreateAskInput {
  id: string;
  sessionId: string;
  questions: unknown;
  skill?: string | null;
  outbound?: boolean;
  unattended?: boolean;
}

/**
 * Parked-question store (app.db) — what a question needs to survive a quit.
 * Absent in contexts with no vault open, where a question lives only as long as
 * the turn that asked it.
 */
export interface AskPort {
  /** Upsert: the same session asking the same thing again is the same question. */
  create(input: CreateAskInput, now: number): AskRecord;
  /** Every unanswered question, oldest first. */
  list(): AskRecord[];
  get(id: string): AskRecord | null;
  /** The one this session is parked on — a session asks one thing at a time. */
  forSession(sessionId: string): AskRecord | null;
  /** Settled: answered, skipped, or cancelled with the run. */
  remove(id: string): void;
}

/**
 * Durable check ledger (app.db) — remembers what background sweeps already saw,
 * keyed by finding + revision, so an unchanged finding is never handed to the
 * librarian twice and a card the PM declined stays quiet until the note or page
 * behind it really changes.
 */
export interface CheckLedgerPort {
  get(key: string): string | null;
  set(key: string, value: string, now: number): void;
  /** Every row whose key starts with `prefix` — how a set of remembered
   *  answers ("which nudges did the PO wave off") is read back whole. */
  list(prefix: string): { key: string; value: string }[];
  /** Forget one row. The undo behind a dismissal that was a misclick. */
  remove(key: string): void;
}

/** The deterministic result of an outbound write — the link is from the API. */
export interface OutboundResult {
  /** Provider id of the touched item (issue key like "PAY-171", page id). */
  externalId: string;
  url: string;
}

/**
 * Outbound port (PLAN-V2 §3.4) — the seam the card-application layer calls on
 * approval to write external systems. ONE dispatch site: the composition root
 * hands in the connector's `execute`, which re-validates the stored payload and
 * routes by provider/action. Absent when no integration is configured.
 */
export interface OutboundPort {
  execute(payload: unknown): Promise<OutboundResult>;
}

export interface UseCaseContext {
  vault: VaultPort;
  index: IndexPort;
  git: GitPort;
  clock: Clock;
  proposals: ProposalPort;
  /** Parked questions; absent in contexts where a question cannot outlive its turn. */
  asks?: AskPort;
  /** Present only when an outbound integration (Atlassian) is configured. */
  outbound?: OutboundPort;
  /** Sweep check ledger; absent in contexts that never run background sweeps. */
  checks?: CheckLedgerPort;
}

export type { Note, SchemaMiss, SearchHit, ThemeStance, NoteType, Frontmatter };
