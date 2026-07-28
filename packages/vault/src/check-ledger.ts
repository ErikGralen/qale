import type Database from 'better-sqlite3';
import type { CheckLedgerPort } from '@pm/application';

/**
 * Sweep check ledger — beside proposals/pings in the per-vault AppDb. One row
 * per background finding (`page-drift:<page>:<decision>` → revision judged),
 * so the librarian never re-spends an LLM judgment on an unchanged pair and a
 * dismissed finding stays quiet until its inputs really change. Primary state:
 * never dropped, tiny by construction (one row per pair, upserted in place).
 */
export class CheckLedgerStore implements CheckLedgerPort {
  constructor(private readonly db: Database.Database) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sweep_checks (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated INTEGER NOT NULL
      );
    `);
  }

  get(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM sweep_checks WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  set(key: string, value: string, now: number): void {
    this.db
      .prepare(
        `INSERT INTO sweep_checks (key, value, updated) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated = excluded.updated`,
      )
      .run(key, value, now);
  }
}
