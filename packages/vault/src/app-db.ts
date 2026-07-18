import Database from 'better-sqlite3';
import { ProposalStore } from './proposal-store.js';
import { PingStore } from './ping-store.js';

/**
 * Primary app state (PLAN §3.5): one `app-<vault>.db` per vault root, never
 * dropped or rebuilt. A single connection serves both the proposal queue and
 * the agent-ping queue — they always open and close together.
 */
export class AppDb {
  private readonly db: Database.Database;
  readonly proposals: ProposalStore;
  readonly pings: PingStore;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.proposals = new ProposalStore(this.db);
    this.pings = new PingStore(this.db);
  }

  close(): void {
    this.db.close();
  }
}
