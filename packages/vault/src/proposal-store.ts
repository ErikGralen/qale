import type Database from 'better-sqlite3';
import type { CreateProposalInput, ProposalPort, ProposalRecord } from '@qale/application';
import { idHash } from './hash.js';

/**
 * The proposal queue + its accept/reject log. Lives in the per-vault AppDb,
 * which owns the connection.
 */
interface Row {
  id: string;
  kind: string;
  session_id: string;
  skill: string | null;
  target_path: string | null;
  base_hash: string | null;
  payload_json: string;
  rationale: string;
  evidence_json: string;
  inference: number;
  asked: number;
  status: string;
  created: number;
  resolved: number | null;
}

export class ProposalStore implements ProposalPort {
  constructor(private readonly db: Database.Database) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS proposals (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        session_id TEXT NOT NULL,
        target_path TEXT,
        base_hash TEXT,
        payload_json TEXT NOT NULL,
        rationale TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        inference INTEGER NOT NULL DEFAULT 0,
        asked INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        created INTEGER NOT NULL,
        resolved INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
    `);
    // Columns added post-v1; guard for existing databases. `session_type` became
    // `skill` when session types were removed — carry its values over.
    const cols = this.db.prepare('PRAGMA table_info(proposals)').all() as { name: string }[];
    if (!cols.some((c) => c.name === 'skill')) {
      this.db.exec('ALTER TABLE proposals ADD COLUMN skill TEXT');
      if (cols.some((c) => c.name === 'session_type')) {
        this.db.exec('UPDATE proposals SET skill = session_type');
      }
    }
    // A card that rests on the PM's own words rather than on a note. Older rows
    // predate the distinction and default to 0, which is right: nothing back
    // then could tell "you asked for this" from "the agent worked it out".
    if (!cols.some((c) => c.name === 'asked')) {
      this.db.exec('ALTER TABLE proposals ADD COLUMN asked INTEGER NOT NULL DEFAULT 0');
    }
  }

  create(input: CreateProposalInput, now: number): ProposalRecord {
    const id = `p_${now.toString(36)}_${Math.abs(idHash(JSON.stringify(input.payload))).toString(36)}`;
    const row: Row = {
      id,
      kind: input.kind,
      session_id: input.sessionId,
      skill: input.skill ?? null,
      target_path: input.targetPath,
      base_hash: input.baseHash,
      payload_json: JSON.stringify(input.payload),
      rationale: input.rationale,
      evidence_json: JSON.stringify(input.evidence),
      inference: input.inference ? 1 : 0,
      asked: input.asked ? 1 : 0,
      status: 'pending',
      created: now,
      resolved: null,
    };
    this.db
      .prepare(
        `INSERT INTO proposals (id, kind, session_id, skill, target_path, base_hash, payload_json,
           rationale, evidence_json, inference, asked, status, created, resolved)
         VALUES (@id, @kind, @session_id, @skill, @target_path, @base_hash, @payload_json,
           @rationale, @evidence_json, @inference, @asked, @status, @created, @resolved)`,
      )
      .run(row);
    return this.toRecord(row);
  }

  list(status?: string): ProposalRecord[] {
    const rows = status
      ? (this.db
          .prepare('SELECT * FROM proposals WHERE status = ? ORDER BY created DESC')
          .all(status) as Row[])
      : (this.db.prepare('SELECT * FROM proposals ORDER BY created DESC').all() as Row[]);
    return rows.map((r) => this.toRecord(r));
  }

  get(id: string): ProposalRecord | null {
    const row = this.db.prepare('SELECT * FROM proposals WHERE id = ?').get(id) as Row | undefined;
    return row ? this.toRecord(row) : null;
  }

  setStatus(id: string, status: string, resolved: number | null): void {
    this.db
      .prepare('UPDATE proposals SET status = ?, resolved = ? WHERE id = ?')
      .run(status, resolved, id);
  }

  pendingCount(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS c FROM proposals WHERE status = 'pending'")
      .get() as {
      c: number;
    };
    return row.c;
  }

  private toRecord(row: Row): ProposalRecord {
    return {
      id: row.id,
      kind: row.kind,
      sessionId: row.session_id,
      skill: row.skill ?? null,
      targetPath: row.target_path,
      baseHash: row.base_hash,
      payload: JSON.parse(row.payload_json),
      rationale: row.rationale,
      evidence: JSON.parse(row.evidence_json),
      inference: row.inference === 1,
      asked: row.asked === 1,
      status: row.status,
      created: row.created,
      resolved: row.resolved,
    };
  }
}
