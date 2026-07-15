import type {
  Frontmatter,
  Note,
  NoteType,
  SearchHit,
  ProblemStance,
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

/** A persisted proposal row (app.db — primary state, never dropped, PLAN §3.5). */
export interface ProposalRecord {
  id: string;
  kind: string;
  sessionId: string;
  targetPath: string | null;
  /** Content hash of the target at proposal time — for staleness detection. */
  baseHash: string | null;
  payload: unknown;
  rationale: string;
  evidence: { ref: string; label?: string; resolved: boolean }[];
  inference: boolean;
  status: string;
  created: number;
  resolved: number | null;
}

export interface CreateProposalInput {
  kind: string;
  sessionId: string;
  targetPath: string | null;
  baseHash: string | null;
  payload: unknown;
  rationale: string;
  evidence: { ref: string; label?: string; resolved: boolean }[];
  inference: boolean;
}

/** Card telemetry — the kill-criteria metric + future eval signal (PLAN-V2 §4). */
export interface ProposalStats {
  pending: number;
  accepted: number;
  rejected: number;
  stale: number;
  /** Cards accepted with an edit before approval. */
  edited: number;
  /** Mean time-to-approve for accepted cards, milliseconds (null if none). */
  avgApproveMs: number | null;
  /** Approval rate = accepted / (accepted + rejected), null if none resolved. */
  approvalRate: number | null;
  byType: Record<string, { accepted: number; rejected: number }>;
}

/** Proposal store (app.db) — the durable proposal queue + accept/reject log. */
export interface ProposalPort {
  create(input: CreateProposalInput, now: number): ProposalRecord;
  list(status?: string): ProposalRecord[];
  get(id: string): ProposalRecord | null;
  setStatus(id: string, status: string, resolved: number | null): void;
  setEditDistance(id: string, distance: number): void;
  pendingCount(): number;
  stats(): ProposalStats;
}

/** The deterministic result of an outbound write — the link is from the API. */
export interface OutboundResult {
  url: string;
  ref?: string;
}

/**
 * Outbound port (PLAN-V2 §3.4) — the seam the card-application layer calls on
 * approval to write to Jira/Confluence. Implemented in the composition root over
 * the Atlassian client; absent when no integration is configured.
 */
export interface OutboundPort {
  createJiraIssue(input: { projectKey: string; issueType?: string; summary: string; body: string }): Promise<OutboundResult>;
  addJiraComment(input: { issueKey: string; body: string }): Promise<OutboundResult>;
  updateConfluencePage(input: { pageId: string; body: string }): Promise<OutboundResult>;
}

export interface UseCaseContext {
  vault: VaultPort;
  index: IndexPort;
  git: GitPort;
  clock: Clock;
  proposals: ProposalPort;
  /** Present only when an outbound integration (Atlassian) is configured. */
  outbound?: OutboundPort;
}

export type { Note, SearchHit, ProblemStance, NoteType, Frontmatter };
