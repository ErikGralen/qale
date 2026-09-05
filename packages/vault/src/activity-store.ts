import type Database from 'better-sqlite3';
import type { ActivityPort } from '@qale/application';
import type { ActivityRecord, CreateActivityInput } from '@qale/domain';
import { idHash } from './hash.js';

/**
 * The Activity log: one row per write the policy let through without a card
 * (docs/easier-tickets.md E-9). Lives in the per-vault AppDb beside the proposal
 * queue, because it is the same kind of state: primary, never rebuilt, and the
 * only proof the silence was earned.
 *
 * Append-only from the agent's side. `reverted` is the one field that changes,
 * and only the PM putting the row back changes it.
 */
interface Row {
  id: string;
  proposal_id: string;
  action: string;
  line: string;
  reason: string;
  path: string | null;
  session_id: string;
  skill: string | null;
  at: number;
  revert_commit: string | null;
  revert_undo: string;
  reverted: number | null;
}

export class ActivityStore implements ActivityPort {
  constructor(private readonly db: Database.Database) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS activity (
        id TEXT PRIMARY KEY,
        proposal_id TEXT NOT NULL,
        action TEXT NOT NULL,
        line TEXT NOT NULL,
        reason TEXT NOT NULL,
        path TEXT,
        session_id TEXT NOT NULL,
        skill TEXT,
        at INTEGER NOT NULL,
        revert_commit TEXT,
        revert_undo TEXT NOT NULL,
        reverted INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_activity_at ON activity(at);
    `);
  }

  record(input: CreateActivityInput, now: number): ActivityRecord {
    const id = `a_${now.toString(36)}_${Math.abs(idHash(input.proposalId)).toString(36)}`;
    const row: Row = {
      id,
      proposal_id: input.proposalId,
      action: input.action,
      line: input.line,
      reason: input.reason,
      path: input.path,
      session_id: input.sessionId,
      skill: input.skill,
      at: now,
      revert_commit: input.revert.commit,
      revert_undo: input.revert.undo,
      reverted: null,
    };
    this.db
      .prepare(
        `INSERT OR REPLACE INTO activity (id, proposal_id, action, line, reason, path, session_id,
           skill, at, revert_commit, revert_undo, reverted)
         VALUES (@id, @proposal_id, @action, @line, @reason, @path, @session_id,
           @skill, @at, @revert_commit, @revert_undo, @reverted)`,
      )
      .run(row);
    return this.toRecord(row);
  }

  list(limit = 200): ActivityRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM activity ORDER BY at DESC LIMIT ?')
      .all(limit) as Row[];
    return rows.map((r) => this.toRecord(r));
  }

  get(id: string): ActivityRecord | null {
    const row = this.db.prepare('SELECT * FROM activity WHERE id = ?').get(id) as Row | undefined;
    return row ? this.toRecord(row) : null;
  }

  markReverted(id: string, at: number): void {
    this.db.prepare('UPDATE activity SET reverted = ? WHERE id = ?').run(at, id);
  }

  private toRecord(row: Row): ActivityRecord {
    return {
      id: row.id,
      proposalId: row.proposal_id,
      action: row.action as ActivityRecord['action'],
      line: row.line,
      reason: row.reason,
      path: row.path,
      sessionId: row.session_id,
      skill: row.skill,
      at: row.at,
      revert: {
        commit: row.revert_commit,
        undo: row.revert_undo === 'delete' ? 'delete' : 'restore',
      },
      reverted: row.reverted,
    };
  }
}
