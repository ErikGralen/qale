import type Database from 'better-sqlite3';
import type { ActivityPort } from '@qale/application';
import type { ActivityRecord, CreateActivityInput } from '@qale/domain';
import { idHash } from './hash.js';

/**
 * The Activity log: one row per write the policy let through without a card
 * (docs/easier-tickets.md E-9), plus one per note the summary pass labelled
 * (docs/background-system.md ticket 3). Lives in the per-vault AppDb beside the
 * proposal queue, because it is the same kind of state: primary, never rebuilt,
 * and the only proof the silence was earned.
 *
 * Append-only from the agent's side. `reverted` is the one field that changes,
 * and only the PM putting the row back changes it.
 *
 * A pass row has no proposal and no session. Both columns are NOT NULL in
 * databases that already exist, so an absent one is stored as the empty string
 * and read back as null. That keeps the table as it stands, with no migration.
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
      CREATE INDEX IF NOT EXISTS idx_activity_proposal ON activity(proposal_id);
    `);
  }

  record(input: CreateActivityInput, now: number): ActivityRecord {
    // What the id is made unique by. A pass has no proposal, so the path it
    // wrote stands in: two rows from one pass name two different notes.
    const seed = input.proposalId ?? input.path ?? input.line;
    const id = `a_${now.toString(36)}_${Math.abs(idHash(seed)).toString(36)}`;
    const row: Row = {
      id,
      proposal_id: input.proposalId ?? '',
      action: input.action,
      line: input.line,
      reason: input.reason,
      path: input.path,
      session_id: input.sessionId ?? '',
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

  /**
   * The newest learned row per file (docs/learning-how-you-work.md ticket 13).
   *
   * `MAX(at)` with the columns beside it: SQLite answers with the row that holds
   * the maximum, so each file's line is its newest one. A row that was put back
   * is left out, because the file no longer says what it says.
   */
  latestLearned(): { path: string; line: string; at: number }[] {
    return this.db
      .prepare(
        `SELECT path, line, MAX(at) AS at FROM activity
          WHERE action IN ('learned', 'remembered') AND path IS NOT NULL AND reverted IS NULL
          GROUP BY path`,
      )
      .all() as { path: string; line: string; at: number }[];
  }

  /**
   * The row one card left. The newest wins: a card approved, put back and
   * approved again writes a second row, and the last one is the live handle.
   */
  forProposal(proposalId: string): ActivityRecord | null {
    if (!proposalId) return null;
    const row = this.db
      .prepare('SELECT * FROM activity WHERE proposal_id = ? ORDER BY at DESC LIMIT 1')
      .get(proposalId) as Row | undefined;
    return row ? this.toRecord(row) : null;
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
      proposalId: row.proposal_id || null,
      action: row.action as ActivityRecord['action'],
      line: row.line,
      reason: row.reason,
      path: row.path,
      sessionId: row.session_id || null,
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
