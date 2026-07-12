import Database from 'better-sqlite3';
import type { CreateProposalInput, ProposalPort, ProposalRecord } from '@pm/application';

/**
 * Primary app state (PLAN §3.5): `app.db` is a SEPARATE file from the derived
 * index — it is never dropped or rebuilt. Holds the proposal queue + the
 * accept/reject/edit log (the core eval signal, PLAN §6.12).
 */
interface Row {
  id: string;
  kind: string;
  session_id: string;
  target_path: string | null;
  base_hash: string | null;
  payload_json: string;
  rationale: string;
  evidence_json: string;
  inference: number;
  status: string;
  created: number;
  resolved: number | null;
}

export class ProposalStore implements ProposalPort {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
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
        status TEXT NOT NULL DEFAULT 'pending',
        created INTEGER NOT NULL,
        resolved INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
    `);
  }

  create(input: CreateProposalInput, now: number): ProposalRecord {
    const id = `p_${now.toString(36)}_${Math.abs(hash(JSON.stringify(input.payload))).toString(36)}`;
    const row: Row = {
      id,
      kind: input.kind,
      session_id: input.sessionId,
      target_path: input.targetPath,
      base_hash: input.baseHash,
      payload_json: JSON.stringify(input.payload),
      rationale: input.rationale,
      evidence_json: JSON.stringify(input.evidence),
      inference: input.inference ? 1 : 0,
      status: 'pending',
      created: now,
      resolved: null,
    };
    this.db
      .prepare(
        `INSERT INTO proposals (id, kind, session_id, target_path, base_hash, payload_json,
           rationale, evidence_json, inference, status, created, resolved)
         VALUES (@id, @kind, @session_id, @target_path, @base_hash, @payload_json,
           @rationale, @evidence_json, @inference, @status, @created, @resolved)`,
      )
      .run(row);
    return this.toRecord(row);
  }

  list(status?: string): ProposalRecord[] {
    const rows = status
      ? (this.db.prepare('SELECT * FROM proposals WHERE status = ? ORDER BY created DESC').all(status) as Row[])
      : (this.db.prepare('SELECT * FROM proposals ORDER BY created DESC').all() as Row[]);
    return rows.map((r) => this.toRecord(r));
  }

  get(id: string): ProposalRecord | null {
    const row = this.db.prepare('SELECT * FROM proposals WHERE id = ?').get(id) as Row | undefined;
    return row ? this.toRecord(row) : null;
  }

  setStatus(id: string, status: string, resolved: number | null): void {
    this.db.prepare('UPDATE proposals SET status = ?, resolved = ? WHERE id = ?').run(status, resolved, id);
  }

  pendingCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS c FROM proposals WHERE status = 'pending'").get() as {
      c: number;
    };
    return row.c;
  }

  close(): void {
    this.db.close();
  }

  private toRecord(row: Row): ProposalRecord {
    return {
      id: row.id,
      kind: row.kind,
      sessionId: row.session_id,
      targetPath: row.target_path,
      baseHash: row.base_hash,
      payload: JSON.parse(row.payload_json),
      rationale: row.rationale,
      evidence: JSON.parse(row.evidence_json),
      inference: row.inference === 1,
      status: row.status,
      created: row.created,
      resolved: row.resolved,
    };
  }
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
