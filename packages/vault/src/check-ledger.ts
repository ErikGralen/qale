import type Database from 'better-sqlite3';
import type { CheckLedgerPort } from '@qale/application';

/**
 * Sweep check ledger — beside the proposals in the per-vault AppDb. One row per
 * background finding (`page-drift:<page>:<decision>` → what state it is in at
 * which revision), so the librarian never hands the agent an unchanged finding
 * twice and a declined card stays quiet until its inputs really change. Primary
 * state: never dropped, tiny by construction (one row per finding, upserted in
 * place).
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
      { value: string } | undefined;
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

  list(prefix: string): { key: string; value: string }[] {
    // LIKE with the wildcard appended — the keys are namespaced by a literal
    // prefix ("capture-nudge:"), never a pattern, so nothing here is escaped.
    return this.db
      .prepare('SELECT key, value FROM sweep_checks WHERE key LIKE ? ORDER BY key')
      .all(`${prefix}%`) as { key: string; value: string }[];
  }

  remove(key: string): void {
    this.db.prepare('DELETE FROM sweep_checks WHERE key = ?').run(key);
  }
}
