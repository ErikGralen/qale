import type Database from 'better-sqlite3';
import type { AskPort, AskRecord, CreateAskInput } from '@qale/application';

/**
 * The parked-question queue (QM ticket 9). Lives in the per-vault AppDb beside
 * the proposals, because a question waiting on the PM is the same kind of thing
 * as a card waiting on the PM: made by a session, settled by a person, and worse
 * than useless if quitting the app loses it.
 *
 * One difference from {@link ProposalStore}, and it is the whole schema: there
 * is no status column and no accept/reject log. A row exists while the question
 * is unanswered and is removed when it settles, so "is this still waiting" is
 * the row's existence rather than a value in it, and answering the same question
 * twice is harmless without anything having to check.
 */
interface Row {
  id: string;
  session_id: string;
  questions_json: string;
  /** The round file a comment request parked on; null for a question card. */
  comments_json: string | null;
  skill: string | null;
  outbound: number;
  unattended: number;
  created: number;
}

export class AskStore implements AskPort {
  constructor(private readonly db: Database.Database) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS asks (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        questions_json TEXT NOT NULL,
        comments_json TEXT,
        skill TEXT,
        outbound INTEGER NOT NULL DEFAULT 0,
        unattended INTEGER NOT NULL DEFAULT 0,
        created INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_asks_session ON asks(session_id);
    `);
    // Who started the run arrived after the first version of this table. A
    // workspace that already has questions waiting keeps them: they default to
    // 0, which reads as "a person was there", and a question that is owed an
    // answer is the safe way to be wrong.
    const cols = this.db.prepare('PRAGMA table_info(asks)').all() as { name: string }[];
    if (!cols.some((c) => c.name === 'unattended')) {
      this.db.exec('ALTER TABLE asks ADD COLUMN unattended INTEGER NOT NULL DEFAULT 0');
    }
    // Comment requests arrived after both of those. A row without this column
    // is a question card, which is what NULL reads as.
    if (!cols.some((c) => c.name === 'comments_json')) {
      this.db.exec('ALTER TABLE asks ADD COLUMN comments_json TEXT');
    }
  }

  create(input: CreateAskInput, now: number): AskRecord {
    const row: Row = {
      id: input.id,
      session_id: input.sessionId,
      questions_json: JSON.stringify(input.questions),
      comments_json: input.comments == null ? null : JSON.stringify(input.comments),
      skill: input.skill ?? null,
      outbound: input.outbound ? 1 : 0,
      unattended: input.unattended ? 1 : 0,
      created: now,
    };
    // Upsert on the id, which is derived from the session and the questions: a
    // turn that asks the same thing again after a skip is the same question, and
    // a second row for it would be a second card on one session.
    this.db
      .prepare(
        `INSERT INTO asks (id, session_id, questions_json, comments_json, skill, outbound, unattended, created)
         VALUES (@id, @session_id, @questions_json, @comments_json, @skill, @outbound, @unattended, @created)
         ON CONFLICT(id) DO UPDATE SET
           questions_json = excluded.questions_json,
           comments_json = excluded.comments_json,
           skill = excluded.skill,
           outbound = excluded.outbound,
           unattended = excluded.unattended,
           created = excluded.created`,
      )
      .run(row);
    return this.toRecord(row);
  }

  list(): AskRecord[] {
    const rows = this.db.prepare('SELECT * FROM asks ORDER BY created ASC').all() as Row[];
    return rows.map((r) => this.toRecord(r));
  }

  get(id: string): AskRecord | null {
    const row = this.db.prepare('SELECT * FROM asks WHERE id = ?').get(id) as Row | undefined;
    return row ? this.toRecord(row) : null;
  }

  forSession(sessionId: string): AskRecord | null {
    // Newest wins: a session parks on one question at a time, and if an older
    // row ever survived a crash the live one is the one the PM is looking at.
    const row = this.db
      .prepare('SELECT * FROM asks WHERE session_id = ? ORDER BY created DESC LIMIT 1')
      .get(sessionId) as Row | undefined;
    return row ? this.toRecord(row) : null;
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM asks WHERE id = ?').run(id);
  }

  private toRecord(row: Row): AskRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      questions: JSON.parse(row.questions_json),
      ...(row.comments_json ? { comments: JSON.parse(row.comments_json) } : {}),
      skill: row.skill,
      outbound: row.outbound === 1,
      unattended: row.unattended === 1,
      created: row.created,
    };
  }
}
