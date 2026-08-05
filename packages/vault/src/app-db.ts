import Database from 'better-sqlite3';
import { ProposalStore } from './proposal-store.js';
import { AskStore } from './ask-store.js';
import { CheckLedgerStore } from './check-ledger.js';
import { SyncStore } from './sync-store.js';

/**
 * Primary app state (PLAN §3.5): one `app-<vault>.db` per vault root, never
 * dropped or rebuilt. A single connection serves the proposal queue, the
 * parked-question queue, the sweep check ledger and the sync engine's state.
 * They always open and close together.
 */
export class AppDb {
  private readonly db: Database.Database;
  readonly proposals: ProposalStore;
  readonly asks: AskStore;
  readonly checks: CheckLedgerStore;
  readonly sync: SyncStore;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    // The ping queue became real librarian sessions, so a workspace upgrading
    // into this build would otherwise carry a table of findings nothing reads
    // and nobody can answer.
    this.db.exec('DROP TABLE IF EXISTS pings');
    this.proposals = new ProposalStore(this.db);
    this.asks = new AskStore(this.db);
    this.checks = new CheckLedgerStore(this.db);
    this.sync = new SyncStore(this.db);
  }

  close(): void {
    this.db.close();
  }
}
