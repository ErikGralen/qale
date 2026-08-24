import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppDb } from '../src/app-db.js';

/**
 * The container catalogue's memory (docs/product-understanding.md FL-3): when a
 * container was first listed, and what the PM has already been asked about it.
 * Both are what keeps a quiet offer from turning into a monthly nag.
 */

async function openDb(): Promise<AppDb> {
  const dir = await mkdtemp(join(tmpdir(), 'pm-sync-store-'));
  return new AppDb(join(dir, 'app.db'));
}

// better-sqlite3 in this workspace is rebuilt for Electron's ABI; skip under a
// plain-node runner that can't load it rather than failing the whole suite.
const skip = await (async () => {
  try {
    (await openDb()).close();
    return false;
  } catch (e) {
    return (
      (e as NodeJS.ErrnoException).code === 'ERR_DLOPEN_FAILED' &&
      'better-sqlite3 built for a different ABI'
    );
  }
})();

test('first_seen is stamped once and never moves', { skip }, async () => {
  const db = await openDb();
  db.sync.upsertContainer('atlassian', 'wikipage', 'DESIGN', 'Design', 1000);
  // A later catalogue refresh renames it; the date it turned up must not follow.
  db.sync.upsertContainer('atlassian', 'wikipage', 'DESIGN', 'Design System', 9000);
  const row = db.sync.listContainers('atlassian')[0]!;
  assert.equal(row.name, 'Design System');
  assert.equal(row.firstSeen, 1000);
  assert.equal(row.offerState, null);
  db.close();
});

test('only pending, unfollowed containers are offers', { skip }, async () => {
  const db = await openDb();
  db.sync.upsertContainer('atlassian', 'wikipage', 'PAYRD', 'Payments Redesign', 1000);
  db.sync.upsertContainer('atlassian', 'wikipage', 'DESIGN', 'Design', 1000);
  db.sync.upsertContainer('atlassian', 'ticket', 'OPS', 'Ops', 1000);
  db.sync.setOfferState('atlassian', 'PAYRD', 'pending');
  db.sync.setOfferState('atlassian', 'DESIGN', 'declined');
  db.sync.setOfferState('atlassian', 'OPS', 'pending');
  // Following one answers its question, whatever it was waiting on.
  db.sync.setFollow('atlassian', 'OPS', true);

  assert.deepEqual(
    db.sync.pendingOffers('atlassian').map((r) => r.containerId),
    ['PAYRD'],
  );
  // A decline is remembered, so nothing can raise it again.
  db.sync.setOfferState('atlassian', 'PAYRD', 'offered');
  assert.deepEqual(db.sync.pendingOffers('atlassian'), []);
  db.close();
});

test('two providers can mint one key without colliding', { skip }, async () => {
  const db = await openDb();
  const item = (provider: string, url: string) => ({
    provider,
    kind: 'ticket' as const,
    externalId: 'PAY-142',
    container: 'PAY',
    title: 'SAML SSO',
    state: 'Open',
    stateCategory: 'open',
    assignee: null,
    version: null,
    remoteUpdated: '2026-08-20T09:00:00.000Z',
    url,
    notePath: null,
    startAt: null,
    endAt: null,
    allDay: false,
    eventStatus: null,
    attendees: null,
    recurringId: null,
  });
  db.sync.upsertItem(item('atlassian', 'https://tavla.atlassian.net/browse/PAY-142'));
  db.sync.upsertItem(item('linear', 'https://linear.app/tavla/issue/PAY-142'));

  // Named, each connection gets its own ticket back…
  assert.match(db.sync.itemByExternalId('atlassian', 'PAY-142')!.url, /atlassian/);
  assert.match(db.sync.itemByExternalId('linear', 'PAY-142')!.url, /linear/);
  assert.equal(db.sync.itemByExternalId('jira', 'PAY-142'), null);
  // …and the surfaces handed a bare key see both, rather than one at random.
  assert.deepEqual(
    db.sync.itemsByExternalId('PAY-142').map((r) => r.provider),
    ['atlassian', 'linear'],
  );

  // The binding is per connection too: moving one mirror must not move the other.
  db.sync.setNotePath('linear', 'PAY-142', 'tickets/linear/PAY-142.md');
  assert.equal(db.sync.itemByExternalId('atlassian', 'PAY-142')!.notePath, null);
  assert.equal(
    db.sync.itemByExternalId('linear', 'PAY-142')!.notePath,
    'tickets/linear/PAY-142.md',
  );
  db.close();
});

test('sync meta survives as the drift check stamp', { skip }, async () => {
  const db = await openDb();
  assert.equal(db.sync.getMeta('drift-check:atlassian'), null);
  db.sync.setMeta('drift-check:atlassian', '1000');
  db.sync.setMeta('drift-check:atlassian', '2000');
  assert.equal(db.sync.getMeta('drift-check:atlassian'), '2000');
  db.close();
});
