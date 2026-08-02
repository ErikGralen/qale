import Database from 'better-sqlite3';
import { ProposalStore } from './proposal-store.js';
import { PingStore } from './ping-store.js';
import { AskStore } from './ask-store.js';
import { CheckLedgerStore } from './check-ledger.js';
import { SyncStore } from './sync-store.js';

/**
 * Primary app state (PLAN §3.5): one `app-<vault>.db` per vault root, never
 * dropped or rebuilt. A single connection serves the proposal queue, the
 * agent-ping queue, the parked-question queue and the sweep check ledger — they
 * always open and close together.
 */
export class AppDb {
  private readonly db: Database.Database;
  readonly proposals: ProposalStore;
  readonly pings: PingStore;
  readonly asks: AskStore;
  readonly checks: CheckLedgerStore;
  readonly sync: SyncStore;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.proposals = new ProposalStore(this.db);
    this.pings = new PingStore(this.db);
    this.asks = new AskStore(this.db);
    this.checks = new CheckLedgerStore(this.db);
    this.sync = new SyncStore(this.db);
  }

  close(): void {
    this.db.close();
  }
}
