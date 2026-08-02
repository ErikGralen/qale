import type Database from 'better-sqlite3';
import type { CreatePingInput, PingPayload, PingPort, PingRecord } from '@pm/application';
import { idHash } from './hash.js';

/**
 * Agent-ping queue — beside the proposals table in the per-vault AppDb, which
 * owns the connection. A ping is an agent-opened conversation waiting in the
 * Inbox; its status log (opened/dismissed) doubles as the proactivity eval signal.
 */
interface Row {
  id: string;
  key: string;
  title: string;
  body: string;
  evidence_json: string;
  skill: string;
  seed_prompt: string;
  target_path: string | null;
  payload_json: string | null;
  status: string;
  created: number;
  resolved: number | null;
}

export class PingStore implements PingPort {
  constructor(private readonly db: Database.Database) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pings (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        skill TEXT NOT NULL,
        seed_prompt TEXT NOT NULL,
        target_path TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created INTEGER NOT NULL,
        resolved INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_pings_status ON pings(status);
      CREATE INDEX IF NOT EXISTS idx_pings_key ON pings(key);
    `);
    // Suggestion payloads arrived after v1 — add the column to existing DBs.
    const cols = this.db.prepare('PRAGMA table_info(pings)').all() as { name: string }[];
    if (!cols.some((c) => c.name === 'payload_json')) {
      this.db.exec('ALTER TABLE pings ADD COLUMN payload_json TEXT');
    }
    // `session_type` became `skill` when session types were removed. Carry the
    // old column's values over rather than leaving a NOT NULL column unfilled.
    if (!cols.some((c) => c.name === 'skill')) {
      this.db.exec("ALTER TABLE pings ADD COLUMN skill TEXT NOT NULL DEFAULT 'librarian'");
      if (cols.some((c) => c.name === 'session_type')) {
        this.db.exec('UPDATE pings SET skill = session_type');
      }
    }
  }

  create(input: CreatePingInput, now: number): PingRecord {
    const row: Row = {
      id: `g_${now.toString(36)}_${Math.abs(idHash(input.key + input.title)).toString(36)}`,
      key: input.key,
      title: input.title,
      body: input.body,
      evidence_json: JSON.stringify(input.evidence),
      skill: input.skill,
      seed_prompt: input.seedPrompt,
      target_path: input.targetPath,
      payload_json: input.payload ? JSON.stringify(input.payload) : null,
      status: 'pending',
      created: now,
      resolved: null,
    };
    this.db
      .prepare(
        `INSERT INTO pings (id, key, title, body, evidence_json, skill, seed_prompt,
           target_path, payload_json, status, created, resolved)
         VALUES (@id, @key, @title, @body, @evidence_json, @skill, @seed_prompt,
           @target_path, @payload_json, @status, @created, @resolved)`,
      )
      .run(row);
    return this.toRecord(row);
  }

  list(status?: string): PingRecord[] {
    const rows = status
      ? (this.db.prepare('SELECT * FROM pings WHERE status = ? ORDER BY created DESC').all(status) as Row[])
      : (this.db.prepare('SELECT * FROM pings ORDER BY created DESC').all() as Row[]);
    return rows.map((r) => this.toRecord(r));
  }

  get(id: string): PingRecord | null {
    const row = this.db.prepare('SELECT * FROM pings WHERE id = ?').get(id) as Row | undefined;
    return row ? this.toRecord(row) : null;
  }

  setStatus(id: string, status: string, resolved: number | null): void {
    this.db.prepare('UPDATE pings SET status = ?, resolved = ? WHERE id = ?').run(status, resolved, id);
  }

  updatePayload(id: string, payload: PingPayload): void {
    this.db.prepare('UPDATE pings SET payload_json = ? WHERE id = ?').run(JSON.stringify(payload), id);
  }

  pendingCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS c FROM pings WHERE status = 'pending'").get() as {
      c: number;
    };
    return row.c;
  }

  hasRecent(key: string, since: number): boolean {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM pings
          WHERE key = ? AND (status = 'pending' OR resolved IS NULL OR resolved >= ?)`,
      )
      .get(key, since) as { c: number };
    return row.c > 0;
  }

  private toRecord(row: Row): PingRecord {
    return {
      id: row.id,
      key: row.key,
      title: row.title,
      body: row.body,
      evidence: JSON.parse(row.evidence_json),
      skill: row.skill,
      seedPrompt: row.seed_prompt,
      targetPath: row.target_path,
      payload: row.payload_json ? (JSON.parse(row.payload_json) as PingPayload) : null,
      status: row.status,
      created: row.created,
      resolved: row.resolved,
    };
  }
}
