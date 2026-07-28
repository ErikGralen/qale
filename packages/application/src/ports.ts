import type {
  Frontmatter,
  LinkOrigin,
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
  /** Canonical link type (docs/typed-links.md); absent = untyped. */
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
  status: string | null;
  mtime: number;
  frontmatter: Record<string, unknown>;
  links: LinkRecord[];
}

export interface BacklinkRow {
  fromPath: string;
  /** Canonical link type of the inbound edge; absent = untyped. */
  type?: string;
  reversed?: boolean;
  origin?: LinkOrigin;
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
  /**
   * Replace only the body, preserving the file's raw frontmatter block
   * byte-for-byte. The write path for body-only edits: coerced/fallback
   * in-memory frontmatter must never round-trip to disk.
   */
  writeBody(relPath: string, body: string): Promise<Note>;
  writeRaw(relPath: string, content: string): Promise<void>;
  /** Write a non-markdown asset (dropped image, etc.), creating parent dirs. */
  writeBinary(relPath: string, data: Uint8Array): Promise<void>;
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
  sessionType: string | null;
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
  /** The session TYPE (skill name) that produced this card — for auto-apply policy. */
  sessionType?: string;
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
  pendingCount(): number;
  stats(): ProposalStats;
}

/**
 * A structured suggestion attached to a ping — the librarian's prepared answer
 * to its own finding, so the Inbox offers one-tap resolutions instead of
 * opening a conversation. Items resolve independently; the ping retires when
 * every item is fixed or skipped.
 */
export interface PingLinkChoiceItem {
  /** Stable per-item id within the ping. */
  id: string;
  /** Note whose body carries the dangling link. */
  from: string;
  /** The dangling wikilink target text. */
  target: string;
  /** Ranked "did you mean…?" candidates. */
  options: { slug: string; title: string }[];
  resolution?: { action: 'fixed'; slug: string } | { action: 'skipped' };
}

/**
 * Why a note has no links — the cause decides which answers are honest.
 * - `external` — a mirror of an upstream record (Jira issue, Confluence page).
 *   The workspace does not own it, so it is never locally deletable; the real
 *   finding is that nothing in the workspace mentions it at all.
 * - `capture` — a raw dump that names people, customers and themes in prose
 *   without linking any of them. The answer is a Process-Note session, not tidying.
 * - `stray` — workspace-owned, cites nothing, cited by nothing. The hygiene case,
 *   and the only one where offering to delete the note makes sense.
 */
export type OrphanKind = 'external' | 'capture' | 'stray';

export interface PingOrphanItem {
  id: string;
  /** The unlinked note. */
  path: string;
  title: string;
  kind: OrphanKind;
  /** Upstream state for a mirror ("In Progress") — display only. */
  detail?: string | null;
  /** Notes that mention this orphan as plain text — link-it-there options.
   *  `term` is the text that actually matched (a ticket's key, not its title). */
  mentions: { host: string; hostTitle: string; line: string; term?: string }[];
  /** Existing notes THIS note names in prose but never links — the evidence
   *  that a dump is full of signal the memory hasn't absorbed. */
  names?: { slug: string; title: string }[];
  resolution?:
    | { action: 'fixed'; host: string }
    | { action: 'skipped' }
    /** Handed to a Process-Note session — the work moved to a conversation. */
    | { action: 'processing' };
}

export type PingPayload =
  | { kind: 'link-choices'; items: PingLinkChoiceItem[] }
  | { kind: 'orphans'; items: PingOrphanItem[] };

/**
 * An agent-initiated finding ("noticed X — here's a prepared answer"). Pings
 * live in app.db beside proposals; the payload carries one-tap suggestions,
 * `seedPrompt` seeds the chat-about-this escape hatch, dismissing is cheap
 * and logged.
 */
export interface PingRecord {
  id: string;
  /** Stable dedupe key (e.g. `broken-links`, `orphans`) — one live ping per finding. */
  key: string;
  title: string;
  body: string;
  evidence: { ref: string; label?: string; resolved: boolean }[];
  sessionType: string;
  seedPrompt: string;
  targetPath: string | null;
  /** One-tap suggestions; null when the finding genuinely needs a conversation. */
  payload: PingPayload | null;
  status: string;
  created: number;
  resolved: number | null;
}

export interface CreatePingInput {
  key: string;
  title: string;
  body: string;
  evidence: { ref: string; label?: string; resolved: boolean }[];
  sessionType: string;
  seedPrompt: string;
  targetPath: string | null;
  payload?: PingPayload | null;
}

/** Agent-ping store (app.db) — the durable queue of agent-opened conversations. */
export interface PingPort {
  create(input: CreatePingInput, now: number): PingRecord;
  list(status?: string): PingRecord[];
  get(id: string): PingRecord | null;
  setStatus(id: string, status: string, resolved: number | null): void;
  /** Persist per-item resolution state as the PO works through a suggestion. */
  updatePayload(id: string, payload: PingPayload): void;
  pendingCount(): number;
  /** True if a ping with this key is pending or was resolved after `since` (dedupe). */
  hasRecent(key: string, since: number): boolean;
}

/**
 * One-shot, non-streaming text completion for background judgments (the
 * librarian's contradiction checks). Deliberately narrow — no tools, no
 * session, no history — so the application layer can ask a single question
 * without importing an agent. Absent when no model is configured; callers
 * must skip silently, never queue retries loudly.
 */
export interface CompletionPort {
  complete(input: { system: string; prompt: string }): Promise<string>;
}

/**
 * Durable check ledger (app.db) — remembers what background sweeps already
 * judged, keyed by finding + revision, so an unchanged decision/page pair is
 * never re-judged (no LLM spend per tick) and a dismissed finding stays quiet
 * until its inputs actually change.
 */
export interface CheckLedgerPort {
  get(key: string): string | null;
  set(key: string, value: string, now: number): void;
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
  /** Agent-ping queue; absent in contexts that don't surface an Inbox (tests, scripts). */
  pings?: PingPort;
  /** Present only when an outbound integration (Atlassian) is configured. */
  outbound?: OutboundPort;
  /** One-shot LLM completions for background judgments; absent when no key is set. */
  completions?: CompletionPort;
  /** Sweep check ledger; absent in contexts that never run background sweeps. */
  checks?: CheckLedgerPort;
}

export type { Note, SearchHit, ThemeStance, NoteType, Frontmatter };
