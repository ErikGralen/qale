import type Database from 'better-sqlite3';
import type { EventAttendee, EventStatus } from '@qale/domain';

/**
 * Sync engine state (Area C) — beside the proposals in the per-vault AppDb.
 * Four tables:
 *
 * - `sync_containers`: every container the connector has ever listed, plus the
 *   follow flag and the per-container high-water mark. Primary state: the mark
 *   is what makes pulls incremental; losing it only costs a full re-pull
 *   (upserts are idempotent), but keeping it here means restarts don't re-pull.
 *   For calendars the mark is Google's opaque `syncToken`, not a timestamp.
 * - `sync_items`: the SHALLOW mirror index (key, title, state — no bodies).
 *   Feeds `[[` autocomplete, reference chips, and (for events) agenda surfaces
 *   and capture-matching. Deep-tracked items ALSO get a full mirror note in the
 *   vault; `note_path` records that promotion (for events: the meeting note).
 * - `sync_series`: recurring-event id → the meeting `series` slug, derived once
 *   when a recurrence is first seen so later title drift can't move a series.
 * - `sync_tracked`: items pulled BY ID rather than by container — the ticket a
 *   note links, the one an agent was asked to watch, the one blocking something
 *   we already hold. Without this, following a project is the only way anything
 *   syncs, and `[[INFRA-88]]` in a note does nothing unless you follow INFRA.
 */

/**
 * Where a container sits in the drift check (docs/product-understanding.md
 * FL-3). Null is the ordinary state: nothing to say about it.
 *
 * - `pending` — new since the last check and full of this person's own work, so
 *   worth one quiet question. Waiting for the librarian to carry it.
 * - `offered` — the question has been asked; never asked again from here.
 * - `declined` — they said no. That answer is permanent, the same posture the
 *   capture-nudge dismissal takes: a "not this one" that comes back next month
 *   is not a memory, it is a nag.
 */
export type ContainerOfferState = 'pending' | 'offered' | 'declined';

export interface SyncContainerRow {
  provider: string;
  kind: 'ticket' | 'wikipage' | 'calendar';
  containerId: string;
  name: string;
  followed: boolean;
  highWater: string | null;
  /** ms epoch of the last successful pull; null before the first. */
  lastSync: number | null;
  /** ms epoch of the first catalogue refresh that listed it. */
  firstSeen: number | null;
  offerState: ContainerOfferState | null;
}

export interface SyncItemRow {
  provider: string;
  kind: 'ticket' | 'wikipage' | 'event';
  externalId: string;
  container: string;
  title: string;
  state: string | null;
  stateCategory: string | null;
  assignee: string | null;
  version: number | null;
  remoteUpdated: string;
  url: string;
  /** Vault path of the full mirror note, once deep-tracked. */
  notePath: string | null;
  // Event fields (kind = 'event'; null for tickets/wikipages).
  /** RFC3339 with offset, or bare "YYYY-MM-DD" for all-day. */
  startAt: string | null;
  endAt: string | null;
  allDay: boolean;
  eventStatus: EventStatus | null;
  attendees: EventAttendee[] | null;
  recurringId: string | null;
}

/**
 * Why an item is tracked. Ordering matters in one place only: an explicit
 * gesture (`link`, `agent`) outranks `blocker`, so auto-discovery can never
 * downgrade something the user asked for — see {@link SyncStore.track}.
 */
export type TrackSource = 'link' | 'agent' | 'blocker';

export interface SyncTrackedRow {
  provider: string;
  kind: 'ticket' | 'wikipage';
  externalId: string;
  source: TrackSource;
  addedAt: number;
}

/** Same idempotent ALTER TABLE treatment, for the container catalogue. */
const SYNC_CONTAINER_MIGRATIONS: [column: string, decl: string][] = [
  ['first_seen', 'INTEGER'],
  ['offer_state', 'TEXT'],
];

/** Columns added after first release — applied via idempotent ALTER TABLE so
 *  existing per-vault app.db files upgrade in place. */
const SYNC_ITEM_MIGRATIONS: [column: string, decl: string][] = [
  ['start_at', 'TEXT'],
  ['end_at', 'TEXT'],
  ['all_day', 'INTEGER NOT NULL DEFAULT 0'],
  ['event_status', 'TEXT'],
  ['attendees', 'TEXT'],
  ['recurring_id', 'TEXT'],
];

export class SyncStore {
  constructor(private readonly db: Database.Database) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_containers (
        provider TEXT NOT NULL,
        kind TEXT NOT NULL,
        container_id TEXT NOT NULL,
        name TEXT NOT NULL,
        followed INTEGER NOT NULL DEFAULT 0,
        high_water TEXT,
        last_sync INTEGER,
        PRIMARY KEY (provider, container_id)
      );
      CREATE TABLE IF NOT EXISTS sync_items (
        provider TEXT NOT NULL,
        kind TEXT NOT NULL,
        external_id TEXT NOT NULL,
        container TEXT NOT NULL,
        title TEXT NOT NULL,
        state TEXT,
        state_category TEXT,
        assignee TEXT,
        version INTEGER,
        remote_updated TEXT NOT NULL,
        url TEXT NOT NULL,
        note_path TEXT,
        PRIMARY KEY (provider, external_id)
      );
      CREATE INDEX IF NOT EXISTS sync_items_container ON sync_items (provider, container);
      CREATE TABLE IF NOT EXISTS sync_series (
        provider TEXT NOT NULL,
        recurring_id TEXT NOT NULL,
        slug TEXT NOT NULL,
        PRIMARY KEY (provider, recurring_id)
      );
      CREATE TABLE IF NOT EXISTS sync_tracked (
        provider TEXT NOT NULL,
        kind TEXT NOT NULL,
        external_id TEXT NOT NULL,
        source TEXT NOT NULL,
        added_at INTEGER NOT NULL,
        PRIMARY KEY (provider, external_id)
      );
      CREATE INDEX IF NOT EXISTS sync_tracked_source ON sync_tracked (provider, source);
      CREATE TABLE IF NOT EXISTS sync_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    for (const [table, migrations] of [
      ['sync_items', SYNC_ITEM_MIGRATIONS],
      ['sync_containers', SYNC_CONTAINER_MIGRATIONS],
    ] as const) {
      const have = new Set(
        (this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
          (c) => c.name,
        ),
      );
      for (const [column, decl] of migrations) {
        if (!have.has(column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
      }
    }
  }

  listContainers(provider?: string): SyncContainerRow[] {
    const rows = provider
      ? this.db
          .prepare('SELECT * FROM sync_containers WHERE provider = ? ORDER BY kind, name')
          .all(provider)
      : this.db.prepare('SELECT * FROM sync_containers ORDER BY provider, kind, name').all();
    return (rows as RawContainer[]).map(toContainerRow);
  }

  followedContainers(provider: string): SyncContainerRow[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM sync_containers WHERE provider = ? AND followed = 1 ORDER BY kind, name',
      )
      .all(provider);
    return (rows as RawContainer[]).map(toContainerRow);
  }

  /**
   * Remember a listed container (name refresh); never clobbers follow/mark.
   * `first_seen` is stamped on insert and never touched again — it is what lets
   * the drift check tell a space that appeared this week from the thirty-nine
   * that were there when the token was pasted.
   */
  upsertContainer(
    provider: string,
    kind: string,
    containerId: string,
    name: string,
    now = Date.now(),
  ): void {
    this.db
      .prepare(
        `INSERT INTO sync_containers (provider, kind, container_id, name, first_seen) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(provider, container_id) DO UPDATE SET
           name = excluded.name,
           kind = excluded.kind,
           first_seen = COALESCE(sync_containers.first_seen, excluded.first_seen)`,
      )
      .run(provider, kind, containerId, name, now);
  }

  setFollow(provider: string, containerId: string, followed: boolean): void {
    this.db
      .prepare('UPDATE sync_containers SET followed = ? WHERE provider = ? AND container_id = ?')
      .run(followed ? 1 : 0, provider, containerId);
  }

  /**
   * Where this container sits in the drift check (FL-3). Following one clears
   * the offer state to null: the question has been answered by the follow, and
   * a row that is followed AND remembered as declined would only ever confuse
   * whatever reads it next.
   */
  setOfferState(provider: string, containerId: string, state: ContainerOfferState | null): void {
    this.db
      .prepare('UPDATE sync_containers SET offer_state = ? WHERE provider = ? AND container_id = ?')
      .run(state, provider, containerId);
  }

  /** Containers waiting to be offered, in catalogue order. */
  pendingOffers(provider: string): SyncContainerRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM sync_containers
         WHERE provider = ? AND offer_state = 'pending' AND followed = 0
         ORDER BY kind, name`,
      )
      .all(provider);
    return (rows as RawContainer[]).map(toContainerRow);
  }

  /**
   * Small durable facts about syncing itself, next to the containers they are
   * about: when the drift check last ran, and nothing else so far. A stamp like
   * that belongs beside the follows rather than in the note-check ledger — it
   * is a fact about this site, not about the workspace's notes.
   */
  getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM sync_meta WHERE key = ?').get(key) as
      { value: string } | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO sync_meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  setHighWater(provider: string, containerId: string, mark: string | null, lastSync: number): void {
    this.db
      .prepare(
        'UPDATE sync_containers SET high_water = ?, last_sync = ? WHERE provider = ? AND container_id = ?',
      )
      .run(mark, lastSync, provider, containerId);
  }

  upsertItem(item: SyncItemRow): void {
    this.db
      .prepare(
        `INSERT INTO sync_items
           (provider, kind, external_id, container, title, state, state_category, assignee, version, remote_updated, url, note_path,
            start_at, end_at, all_day, event_status, attendees, recurring_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider, external_id) DO UPDATE SET
           kind = excluded.kind, container = excluded.container, title = excluded.title,
           state = excluded.state, state_category = excluded.state_category,
           assignee = excluded.assignee, version = excluded.version,
           remote_updated = excluded.remote_updated, url = excluded.url,
           note_path = COALESCE(excluded.note_path, sync_items.note_path),
           start_at = excluded.start_at, end_at = excluded.end_at, all_day = excluded.all_day,
           event_status = excluded.event_status, attendees = excluded.attendees,
           recurring_id = excluded.recurring_id`,
      )
      .run(
        item.provider,
        item.kind,
        item.externalId,
        item.container,
        item.title,
        item.state,
        item.stateCategory,
        item.assignee,
        item.version,
        item.remoteUpdated,
        item.url,
        item.notePath,
        item.startAt,
        item.endAt,
        item.allDay ? 1 : 0,
        item.eventStatus,
        item.attendees ? JSON.stringify(item.attendees) : null,
        item.recurringId,
      );
  }

  /** Series slug for a recurrence, minting (and persisting) it on first sight. */
  seriesSlug(provider: string, recurringId: string, mint: () => string): string {
    const row = this.db
      .prepare('SELECT slug FROM sync_series WHERE provider = ? AND recurring_id = ?')
      .get(provider, recurringId) as { slug: string } | undefined;
    if (row) return row.slug;
    const slug = mint();
    this.db
      .prepare('INSERT OR IGNORE INTO sync_series (provider, recurring_id, slug) VALUES (?, ?, ?)')
      .run(provider, recurringId, slug);
    return slug;
  }

  /** Events overlapping [fromIso, toIso) — agenda surfaces and capture-matching.
   *  String comparison works because RFC3339-with-offset and YYYY-MM-DD both
   *  sort chronologically per calendar (mixed-zone edge slop is acceptable). */
  eventsBetween(provider: string, fromIso: string, toIso: string): SyncItemRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM sync_items
         WHERE provider = ? AND kind = 'event' AND start_at IS NOT NULL AND start_at < ? AND COALESCE(end_at, start_at) >= ?
         ORDER BY start_at`,
      )
      .all(provider, toIso, fromIso);
    return (rows as RawItem[]).map(toItemRow);
  }

  setNotePath(provider: string, externalId: string, notePath: string | null): void {
    this.db
      .prepare('UPDATE sync_items SET note_path = ? WHERE provider = ? AND external_id = ?')
      .run(notePath, provider, externalId);
  }

  /**
   * One item, by the connection that holds it. The provider is half the key on
   * purpose: two trackers can mint the same ticket key (a Jira PAY-142 and a
   * Linear PAY-142), and a lookup on the id alone answers with whichever row
   * sqlite reaches first.
   */
  itemByExternalId(provider: string, externalId: string): SyncItemRow | null {
    const row = this.db
      .prepare(
        'SELECT * FROM sync_items WHERE provider = ? AND external_id = ? COLLATE NOCASE LIMIT 1',
      )
      .get(provider, externalId) as RawItem | undefined;
    return row ? toItemRow(row) : null;
  }

  /**
   * Every connection's row for one external id, in provider order — for the read
   * surfaces that are handed a bare key and no connection (a reference chip, a
   * hover card). Two rows mean two providers mint that key; PD-11 decides what a
   * link does about it, and until then the caller takes the first.
   */
  itemsByExternalId(externalId: string): SyncItemRow[] {
    const rows = this.db
      .prepare('SELECT * FROM sync_items WHERE external_id = ? COLLATE NOCASE ORDER BY provider')
      .all(externalId);
    return (rows as RawItem[]).map(toItemRow);
  }

  itemsByKind(kind: 'ticket' | 'wikipage' | 'event'): SyncItemRow[] {
    const rows = this.db.prepare('SELECT * FROM sync_items WHERE kind = ?').all(kind);
    return (rows as RawItem[]).map(toItemRow);
  }

  countByContainer(provider: string, containerId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM sync_items WHERE provider = ? AND container = ?')
      .get(provider, containerId) as { n: number };
    return row.n;
  }

  /**
   * Prefix/substring search over key + title (autocomplete). Events are
   * excluded — meetings link by note path, not by opaque event id.
   *
   * Ranking is the whole reason a big followed project is liveable: a key the
   * user is part-way through typing wins outright, then live work beats
   * finished work, then recency. Sorting by `external_id` (as this once did)
   * puts a bug closed in 2019 above the open ticket you're assigned to, purely
   * because it has a lower number. Note the deliberate absence of an "archived"
   * flag — staleness is computed from state and date, never a stored state
   * somebody has to maintain.
   */
  searchItems(query: string, limit: number): SyncItemRow[] {
    const bare = query.replace(/[%_]/g, '');
    const q = `%${bare}%`;
    const rows = this.db
      .prepare(
        `SELECT * FROM sync_items
         WHERE kind IN ('ticket', 'wikipage')
           AND (external_id LIKE ? COLLATE NOCASE OR title LIKE ? COLLATE NOCASE)
         ORDER BY
           CASE WHEN external_id LIKE ? COLLATE NOCASE THEN 0 ELSE 1 END,
           CASE WHEN state_category = 'done' THEN 1 ELSE 0 END,
           remote_updated DESC
         LIMIT ?`,
      )
      .all(q, q, `${bare}%`, limit);
    return (rows as RawItem[]).map(toItemRow);
  }

  // ---------------------------------------------------------------------------
  // Tracked items — pulled by id, across container boundaries.
  // ---------------------------------------------------------------------------

  /**
   * Start (or re-affirm) tracking. `blocker` never overwrites an explicit
   * `link`/`agent` source, so auto-discovery can't quietly demote something the
   * user asked for — which matters because we refuse to harvest blockers *from*
   * an auto-added item (that's what keeps discovery to one hop).
   */
  track(
    provider: string,
    kind: 'ticket' | 'wikipage',
    externalId: string,
    source: TrackSource,
    addedAt: number,
  ): void {
    this.db
      .prepare(
        `INSERT INTO sync_tracked (provider, kind, external_id, source, added_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(provider, external_id) DO UPDATE SET
           kind = excluded.kind,
           source = CASE WHEN excluded.source = 'blocker' THEN sync_tracked.source ELSE excluded.source END`,
      )
      .run(provider, kind, externalId, source, addedAt);
  }

  untrack(provider: string, externalId: string): void {
    this.db
      .prepare('DELETE FROM sync_tracked WHERE provider = ? AND external_id = ? COLLATE NOCASE')
      .run(provider, externalId);
  }

  listTracked(provider: string): SyncTrackedRow[] {
    const rows = this.db
      .prepare('SELECT * FROM sync_tracked WHERE provider = ? ORDER BY added_at')
      .all(provider);
    return (rows as RawTracked[]).map((r) => ({
      provider: r.provider,
      kind: r.kind as SyncTrackedRow['kind'],
      externalId: r.external_id,
      source: r.source as TrackSource,
      addedAt: r.added_at,
    }));
  }

  /** Null when untracked — also the "is this tracked at all?" test. */
  trackedSource(provider: string, externalId: string): TrackSource | null {
    const row = this.db
      .prepare(
        'SELECT source FROM sync_tracked WHERE provider = ? AND external_id = ? COLLATE NOCASE',
      )
      .get(provider, externalId) as { source: string } | undefined;
    return (row?.source as TrackSource) ?? null;
  }

  countTrackedBySource(provider: string, source: TrackSource): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM sync_tracked WHERE provider = ? AND source = ?')
      .get(provider, source) as { n: number };
    return row.n;
  }
}

interface RawContainer {
  provider: string;
  kind: string;
  container_id: string;
  name: string;
  followed: number;
  high_water: string | null;
  last_sync: number | null;
  first_seen: number | null;
  offer_state: string | null;
}

interface RawTracked {
  provider: string;
  kind: string;
  external_id: string;
  source: string;
  added_at: number;
}

interface RawItem {
  provider: string;
  kind: string;
  external_id: string;
  container: string;
  title: string;
  state: string | null;
  state_category: string | null;
  assignee: string | null;
  version: number | null;
  remote_updated: string;
  url: string;
  note_path: string | null;
  start_at: string | null;
  end_at: string | null;
  all_day: number;
  event_status: string | null;
  attendees: string | null;
  recurring_id: string | null;
}

function toContainerRow(r: RawContainer): SyncContainerRow {
  return {
    provider: r.provider,
    kind: r.kind as SyncContainerRow['kind'],
    containerId: r.container_id,
    name: r.name,
    followed: r.followed === 1,
    highWater: r.high_water,
    lastSync: r.last_sync,
    firstSeen: r.first_seen ?? null,
    offerState: (r.offer_state as ContainerOfferState | null) ?? null,
  };
}

function toItemRow(r: RawItem): SyncItemRow {
  let attendees: EventAttendee[] | null = null;
  if (r.attendees) {
    try {
      attendees = JSON.parse(r.attendees) as EventAttendee[];
    } catch {
      attendees = null; // a corrupt row degrades to "no attendee data", never throws
    }
  }
  return {
    provider: r.provider,
    kind: r.kind as SyncItemRow['kind'],
    externalId: r.external_id,
    container: r.container,
    title: r.title,
    state: r.state,
    stateCategory: r.state_category,
    assignee: r.assignee,
    version: r.version,
    remoteUpdated: r.remote_updated,
    url: r.url,
    notePath: r.note_path,
    startAt: r.start_at ?? null,
    endAt: r.end_at ?? null,
    allDay: r.all_day === 1,
    eventStatus: (r.event_status as SyncItemRow['eventStatus']) ?? null,
    attendees,
    recurringId: r.recurring_id ?? null,
  };
}
