import Database from 'better-sqlite3';
import { unlinkSync } from 'node:fs';
import {
  basename as slugBasename,
  isIndexableNote,
  lifecycleValue,
  refToSlug,
  type Note,
  type NoteType,
  type SearchHit,
} from '@qale/domain';
import { noteTitle } from '@qale/domain';
import { extractLinks } from '@qale/markdown';
import type {
  BacklinkRow,
  IndexedNote,
  IndexPort,
  LinkRecord,
  SchemaMiss,
} from '@qale/application';

/**
 * The derived index (PLAN §3.5): a fully-rebuildable SQLite store with files +
 * links + FTS5. Opened WAL + busy_timeout on every connection. Backlinks are
 * `links WHERE target resolves here`; wikilink resolution is exact slug, else
 * unique basename — an ambiguous basename stays unresolved.
 */

/** Bump when the table shapes change — migrate() drops and lets reconcile rebuild. */
const SCHEMA_VERSION = 5;

/** Frontmatter ref key → canonical edge type (+ reversed for inverse keys). */
const FRONTMATTER_EDGE_KEYS: [key: string, type: string, reversed: boolean][] = [
  ['evidence', 'evidence', false],
  ['sources', 'source', false],
  ['transcript', 'transcript', false],
  ['supersedes', 'supersedes', false],
  ['superseded_by', 'supersedes', true],
  ['problem', 'problem', false],
  ['customer', 'customer', false],
  ['source_meeting', 'source', false],
  ['reads', 'reads', false],
  ['writes', 'writes', false],
];

interface FileRow {
  path: string;
  slug: string;
  name: string;
  type: string;
  layer: string;
  title: string;
  summary: string;
  /** The note type's lifecycle value, whatever that lifecycle is named. */
  lifecycle: string | null;
  /** 1 when the file has any text below the frontmatter. */
  has_body: number;
  mtime: number;
  frontmatter_json: string;
  /** JSON {type, error} when the file did not fit the type it claims; else null. */
  schema_miss_json: string | null;
}

export class SqliteIndex implements IndexPort {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = this.openWithPragmas(dbPath);
    try {
      this.migrate();
    } catch (err) {
      // A corrupt file (bad header, truncated page) throws here, before
      // verifyIntegrity ever gets to run its self-heal — the index is fully
      // rebuildable, so recover by starting the file over rather than leaving
      // the vault permanently unable to open its own index.
      console.error(
        '[qale] index migration failed, rebuilding the index file:',
        err instanceof Error ? err.message : err,
      );
      this.db.close();
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          unlinkSync(`${dbPath}${suffix}`);
        } catch {
          // Sidecar files don't always exist; a missing one is not a failure.
        }
      }
      this.db = this.openWithPragmas(dbPath);
      this.migrate();
    }
    this.verifyIntegrity();
  }

  private openWithPragmas(dbPath: string): Database.Database {
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');
    return db;
  }

  private migrate(): void {
    // The index is fully rebuildable, so schema changes are a version bump +
    // drop, never an ALTER migration: an old `links` shape is torn down and the
    // next reconcile repopulates everything (files emptied = no mtime skips).
    const version = this.db.pragma('user_version', { simple: true }) as number;
    if (version < SCHEMA_VERSION) {
      this.db.exec(
        'DROP TABLE IF EXISTS links; DROP TABLE IF EXISTS files; DROP TABLE IF EXISTS notes_fts;',
      );
      this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        layer TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        lifecycle TEXT,
        has_body INTEGER NOT NULL DEFAULT 0,
        mtime INTEGER NOT NULL,
        frontmatter_json TEXT NOT NULL,
        schema_miss_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_files_type ON files(type);
      CREATE INDEX IF NOT EXISTS idx_files_name ON files(name);

      CREATE TABLE IF NOT EXISTS links (
        source_path TEXT NOT NULL,
        target_slug TEXT NOT NULL,
        target_path TEXT,
        anchor TEXT,
        alias TEXT,
        type TEXT,
        reversed INTEGER NOT NULL DEFAULT 0,
        origin TEXT NOT NULL DEFAULT 'body',
        line INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_path);
      CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_path);
      CREATE INDEX IF NOT EXISTS idx_links_slug ON links(target_slug);

      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        path UNINDEXED,
        title,
        summary,
        body,
        tokenize = 'porter unicode61'
      );
    `);
  }

  private verifyIntegrity(): void {
    try {
      const row = this.db.pragma('integrity_check', { simple: true });
      if (row !== 'ok') this.clear();
    } catch {
      this.clear();
    }
  }

  reindex(note: Note): void {
    // The floor under every caller. Orientation files, a skill's own material
    // and a session's scratch are not notes, and a row for one of them is a
    // phantom: it lists, it searches, and the librarian reports it as an
    // unlinked note nobody can do anything about. The scan and the watcher both
    // check this before they call, and one of them was still getting past it —
    // so the rule lives where the row is written, and a row that got in under an
    // older build is dropped on the way past rather than left to rot.
    if (!isIndexableNote(note.path)) {
      this.removeByPath(note.path);
      return;
    }
    const tx = this.db.transaction((n: Note) => {
      const name = slugBasename(n.slug);
      const row: FileRow = {
        path: n.path,
        slug: n.slug,
        name,
        type: n.type,
        layer: n.layer,
        title: noteTitle(n),
        summary: n.frontmatter.summary,
        lifecycle: lifecycleValue(n.type, n.frontmatter as Record<string, unknown>),
        // "Is there anything in this note?" — asked by the lists, which never
        // carry a body. Stored, not recomputed: the alternative is reading every
        // file again to answer it.
        has_body: n.body.trim().length > 0 ? 1 : 0,
        mtime: n.mtime,
        frontmatter_json: JSON.stringify(n.frontmatter),
        // Carried so the librarian's scan can see it: the scan is synchronous
        // and reads only the index, so a fact that stays in the reading layer
        // is a fact nothing can ever act on.
        schema_miss_json: n.schemaMiss ? JSON.stringify(n.schemaMiss) : null,
      };
      this.db
        .prepare(
          `INSERT INTO files (path, slug, name, type, layer, title, summary, lifecycle, has_body, mtime, frontmatter_json, schema_miss_json)
           VALUES (@path, @slug, @name, @type, @layer, @title, @summary, @lifecycle, @has_body, @mtime, @frontmatter_json, @schema_miss_json)
           ON CONFLICT(path) DO UPDATE SET
             slug=@slug, name=@name, type=@type, layer=@layer, title=@title,
             summary=@summary, lifecycle=@lifecycle, has_body=@has_body, mtime=@mtime,
             frontmatter_json=@frontmatter_json, schema_miss_json=@schema_miss_json`,
        )
        .run(row);

      // Rewrite this note's outbound links, resolving each target now.
      this.db.prepare('DELETE FROM links WHERE source_path = ?').run(n.path);
      const insertLink = this.db.prepare(
        `INSERT INTO links (source_path, target_slug, target_path, anchor, alias, type, reversed, origin, line)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const links = this.extractLinksFromFrontmatterAndBody(n);
      for (const link of links) {
        const targetPath = this.resolve(link.target);
        insertLink.run(
          n.path,
          link.target,
          targetPath,
          link.anchor ?? null,
          link.alias ?? null,
          link.type ?? null,
          link.reversed ? 1 : 0,
          link.origin ?? 'body',
          link.line ?? null,
        );
      }

      // Resolve any previously-dangling inbound links now that this note exists.
      this.db
        .prepare(
          `UPDATE links SET target_path = @path
           WHERE target_path IS NULL AND (target_slug = @slug OR target_slug = @name)`,
        )
        .run({ path: n.path, slug: n.slug, name });

      // FTS row (delete + insert in the same tx).
      this.db.prepare('DELETE FROM notes_fts WHERE path = ?').run(n.path);
      this.db
        .prepare('INSERT INTO notes_fts (path, title, summary, body) VALUES (?, ?, ?, ?)')
        .run(n.path, row.title, row.summary, n.body);
    });
    tx(note);
  }

  /**
   * Links come from three origins (docs/typed-links.md): body wikilinks (typed
   * or not), frontmatter refs (the KEY is the type — `superseded_by` is the
   * reversed spelling of `supersedes`), and, on tickets, the provider's own
   * relationships (`parent`/`links` written by sync) as `synced` edges.
   */
  private extractLinksFromFrontmatterAndBody(note: Note): LinkRecord[] {
    const links: LinkRecord[] = extractLinks(note.body).map((l) => ({
      target: l.target,
      anchor: l.anchor,
      alias: l.alias,
      type: l.linkType,
      reversed: l.reversed,
      origin: 'body' as const,
      line: l.line,
    }));
    const fm = note.frontmatter as Record<string, unknown>;
    for (const [key, type, reversed] of FRONTMATTER_EDGE_KEYS) {
      const val = fm[key];
      const arr = Array.isArray(val) ? val : typeof val === 'string' ? [val] : [];
      for (const raw of arr) {
        if (typeof raw !== 'string' || /^https?:\/\//i.test(raw)) continue;
        const target = refToSlug(raw);
        if (target) links.push({ target, type, reversed, origin: 'frontmatter' });
      }
    }
    if (note.type === 'ticket') {
      const parent = fm['parent'];
      if (typeof parent === 'string' && parent) {
        links.push({ target: refToSlug(parent) ?? parent, type: 'part-of', origin: 'synced' });
      }
      const provider = fm['links'];
      for (const entry of Array.isArray(provider) ? provider : []) {
        const e = entry as { type?: unknown; key?: unknown; reversed?: unknown };
        if (typeof e.type !== 'string' || typeof e.key !== 'string' || !e.key) continue;
        links.push({
          target: e.key,
          type: e.type,
          reversed: e.reversed === true,
          origin: 'synced',
        });
      }
    }
    return links;
  }

  removeByPath(path: string): void {
    const tx = this.db.transaction((p: string) => {
      this.db.prepare('DELETE FROM files WHERE path = ?').run(p);
      this.db.prepare('DELETE FROM links WHERE source_path = ?').run(p);
      this.db.prepare('UPDATE links SET target_path = NULL WHERE target_path = ?').run(p);
      this.db.prepare('DELETE FROM notes_fts WHERE path = ?').run(p);
    });
    tx(path);
  }

  get(path: string): IndexedNote | null {
    const row = this.db.prepare('SELECT * FROM files WHERE path = ?').get(path) as
      FileRow | undefined;
    return row ? this.toIndexed(row) : null;
  }

  all(): IndexedNote[] {
    const rows = this.db.prepare('SELECT * FROM files ORDER BY mtime DESC').all() as FileRow[];
    return rows.map((r) => this.toIndexed(r));
  }

  listByType(type: NoteType): IndexedNote[] {
    const rows = this.db
      .prepare('SELECT * FROM files WHERE type = ? ORDER BY mtime DESC')
      .all(type) as FileRow[];
    return rows.map((r) => this.toIndexed(r));
  }

  search(query: string, limit: number): SearchHit[] {
    const match = toFtsQuery(query);
    if (!match) return [];
    try {
      const rows = this.db
        .prepare(
          `SELECT f.path AS path, f.slug AS slug, f.type AS type, f.title AS title, f.summary AS summary,
                  snippet(notes_fts, 3, '«', '»', '…', 12) AS snippet,
                  bm25(notes_fts) AS score
             FROM notes_fts
             JOIN files f ON f.path = notes_fts.path
            WHERE notes_fts MATCH ?
            ORDER BY score
            LIMIT ?`,
        )
        .all(match, limit) as (Omit<SearchHit, 'score'> & { score: number })[];
      // bm25 returns lower = better; normalize to a positive relevance.
      return rows.map((r) => ({ ...r, score: -r.score }));
    } catch {
      return [];
    }
  }

  backlinks(slug: string): BacklinkRow[] {
    const path = this.resolve(slug);
    const rows = this.db
      .prepare(
        `SELECT source_path AS fromPath, type, MAX(reversed) AS reversed, origin, MIN(line) AS line FROM links
          WHERE target_path = ? OR target_slug = ? OR target_slug = ?
          GROUP BY source_path, type, reversed
          ORDER BY source_path`,
      )
      .all(path ?? ' ', slug, slugBasename(slug)) as {
      fromPath: string;
      type: string | null;
      reversed: number;
      origin: string;
      line: number | null;
    }[];
    // One row per (source, relationship): the same source can legitimately be
    // both `evidence` and a plain mention; repeats of ONE relationship collapse.
    return rows.map((r) => ({
      fromPath: r.fromPath,
      type: r.type ?? undefined,
      reversed: r.reversed === 1 ? true : undefined,
      origin: (r.origin ?? 'body') as BacklinkRow['origin'],
      line: r.line ?? undefined,
    }));
  }

  resolve(target: string): string | null {
    const clean = target.replace(/\.md$/, '');
    const exact = this.db.prepare('SELECT path FROM files WHERE slug = ?').get(clean) as
      { path: string } | undefined;
    if (exact) return exact.path;
    const name = slugBasename(clean);
    const byName = this.db.prepare('SELECT path FROM files WHERE name = ?').all(name) as {
      path: string;
    }[];
    return byName.length === 1 ? byName[0]!.path : null;
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM files').get() as { c: number };
    return row.c;
  }

  clear(): void {
    this.db.exec('DELETE FROM files; DELETE FROM links; DELETE FROM notes_fts;');
  }

  close(): void {
    this.db.close();
  }

  private toIndexed(row: FileRow): IndexedNote {
    const links = this.db
      .prepare(
        'SELECT target_slug, anchor, alias, type, reversed, origin, line FROM links WHERE source_path = ?',
      )
      .all(row.path) as {
      target_slug: string;
      anchor: string | null;
      alias: string | null;
      type: string | null;
      reversed: number;
      origin: string;
      line: number | null;
    }[];
    return {
      path: row.path,
      slug: row.slug,
      type: row.type as NoteType,
      layer: row.layer,
      title: row.title,
      summary: row.summary,
      lifecycle: row.lifecycle,
      hasBody: row.has_body === 1,
      mtime: row.mtime,
      frontmatter: JSON.parse(row.frontmatter_json) as Record<string, unknown>,
      ...(row.schema_miss_json
        ? { schemaMiss: JSON.parse(row.schema_miss_json) as SchemaMiss }
        : {}),
      links: links.map((l) => ({
        target: l.target_slug,
        anchor: l.anchor ?? undefined,
        alias: l.alias ?? undefined,
        type: l.type ?? undefined,
        reversed: l.reversed === 1 ? true : undefined,
        origin: (l.origin ?? 'body') as LinkRecord['origin'],
        line: l.line ?? undefined,
      })),
    };
  }
}

/** Build a safe FTS5 MATCH string: prefix-match each alphanumeric term. */
function toFtsQuery(query: string): string {
  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0)
    .map((t) => `"${t}"*`);
  return terms.join(' ');
}
