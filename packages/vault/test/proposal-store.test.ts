import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ProposalStore } from '../src/proposal-store.js';

// better-sqlite3 in this workspace is rebuilt for Electron's ABI; skip under a
// plain-node runner that can't load it rather than failing the whole suite.
const skip = (() => {
  try {
    new Database(':memory:').close();
    return false;
  } catch (e) {
    return (
      (e as NodeJS.ErrnoException).code === 'ERR_DLOPEN_FAILED' &&
      'better-sqlite3 built for a different ABI'
    );
  }
})();

const CARD = {
  kind: 'note',
  sessionId: 's1',
  targetPath: 'notes/tagging-convention.md',
  baseHash: null,
  payload: { path: 'notes/tagging-convention.md' },
  rationale: 'You asked for this in chat.',
  evidence: [],
  inference: false,
};

test('a card knows the PM asked for it, and the answer survives a read back', { skip }, () => {
  const store = new ProposalStore(new Database(':memory:'));

  const asked = store.create({ ...CARD, asked: true }, 1);
  const guessed = store.create({ ...CARD, targetPath: 'notes/other.md', inference: true }, 2);

  assert.equal(store.get(asked.id)?.asked, true);
  assert.equal(store.get(asked.id)?.inference, false);
  // The default is the honest one: a card that claimed nothing claims nothing.
  assert.equal(store.get(guessed.id)?.asked, false);
  assert.equal(store.get(guessed.id)?.inference, true);
});

/**
 * The column landed after v1, so every workspace already out there opens a table
 * without it. The migration has to be the thing that runs before the first read,
 * or the app comes up to an Inbox that throws on a card written last week.
 */
test('a queue written before the column reads back as asking nothing', { skip }, () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE proposals (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      session_id TEXT NOT NULL,
      skill TEXT,
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
    INSERT INTO proposals (id, kind, session_id, target_path, payload_json, rationale,
      evidence_json, inference, status, created)
    VALUES ('p_old', 'note', 's0', 'notes/old.md', '{}', 'from before', '[]', 1, 'pending', 1);
  `);

  const store = new ProposalStore(db);

  assert.equal(store.get('p_old')?.asked, false);
  assert.equal(store.get('p_old')?.inference, true);
  // And the migrated table still takes new cards on the new column.
  const fresh = store.create({ ...CARD, asked: true }, 2);
  assert.equal(store.get(fresh.id)?.asked, true);
});
