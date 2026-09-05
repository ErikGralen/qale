import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import type {
  Connector,
  ConnectorProvider,
  ExternalContainer,
  PullResult,
  ShallowChange,
} from '@qale/connectors';
import type { SyncContainerRow, SyncItemRow, SyncStore } from '@qale/vault';
import type { UseCaseContext } from '@qale/application';
import { JIRA_CONVENTIONS, parseRunnable } from '@qale/sessions';
import { firstLookInstruction, SyncService } from '../src/main/services/sync-service.js';
import { createFirstLookKick } from '../src/main/services/first-look-kick.js';
import { followReceipt } from '../src/renderer/src/lib/follow-receipt.js';

/**
 * The first look (docs/first-look-debrief.md): connecting a system ends in one
 * session that says what it read, instead of ending at consent.
 *
 * Everything worth testing here is about NOT asking twice, so these are all
 * negative cases dressed as positive ones. The arming test is the only one that
 * proves the knock happens at all; the other four prove it happens once, and
 * never to somebody who was already syncing before this existed.
 *
 * The next group is the kick that chases the confirm, which is about WHEN the
 * knock happens rather than whether. The last is what the confirm itself says
 * back, which is where the promise is either kept or dropped.
 */

const TICKET = {
  kind: 'ticket',
  external_id: 'NORD-1',
  container: 'NORD',
  title: 'Rewrite the checkout',
  state: 'In Progress',
  state_category: 'in_progress',
  remote_updated: '2026-08-20T09:00:00.000Z',
  url: 'https://tavla.atlassian.net/browse/NORD-1',
} as const satisfies ShallowChange;

/** A connector over two containers, with a switch for making the pull fail. */
function fakeConnector(state: { fail: boolean }): Connector {
  return {
    id: 'tracker',
    providers: { ticket: 'tracker', wikipage: 'tracker' },
    listContainers: async (): Promise<ExternalContainer[]> => [
      { kind: 'ticket', id: 'NORD', name: 'Nordkap Platform' },
      { kind: 'wikipage', id: 'KRAN', name: 'Kranelund' },
    ],
    pullChanges: async (container: ExternalContainer): Promise<PullResult> => {
      if (state.fail) throw new Error('the site is down');
      if (container.kind !== 'ticket') return { changes: [], highWaterMark: null };
      return { changes: [{ ...TICKET }], highWaterMark: TICKET.remote_updated };
    },
    verifyAuth: async () => ({ ok: true, health: 'ok' as const }),
  } as unknown as Connector;
}

function fakeProvider(state: { fail: boolean }): ConnectorProvider<unknown> {
  return {
    id: 'tracker',
    label: 'Tracker',
    authSchema: z.object({ apiToken: z.string().min(1) }),
    authFields: [{ key: 'apiToken', label: 'API token', secret: true }],
    renewFieldKeys: ['apiToken'],
    create: () => fakeConnector(state),
  } as unknown as ConnectorProvider<unknown>;
}

/**
 * Enough store for the arming rule, and `lastSync` is the field the whole
 * feature turns on, so this one really moves it: `setHighWater` stamps it
 * exactly as the real store does, which is what makes "the second tick is not a
 * first read" a fact rather than an assumption.
 */
function fakeStore(seed: Partial<SyncContainerRow>[] = []): SyncStore {
  const containers = new Map<string, SyncContainerRow>();
  const rows = new Map<string, SyncItemRow>();
  const meta = new Map<string, string>();
  for (const row of seed) {
    containers.set(`tracker:${row.containerId}`, {
      provider: 'tracker',
      followed: true,
      highWater: null,
      lastSync: null,
      ...row,
    } as SyncContainerRow);
  }
  return {
    getMeta: (key: string) => meta.get(key) ?? null,
    setMeta: (key: string, value: string) => void meta.set(key, value),
    listContainers: (provider?: string) =>
      [...containers.values()].filter((c) => !provider || c.provider === provider),
    followedContainers: (provider: string) =>
      [...containers.values()].filter((c) => c.provider === provider && c.followed),
    // Unfollowed on insert, exactly as the real store does it: a catalogue
    // refresh only ever adds rows nobody has asked to read yet.
    upsertContainer: (provider: string, kind: string, containerId: string, name: string) => {
      const key = `${provider}:${containerId}`;
      containers.set(key, {
        ...(containers.get(key) ?? { followed: false, highWater: null, lastSync: null }),
        provider,
        kind,
        containerId,
        name,
      } as SyncContainerRow);
    },
    setFollow: (provider: string, containerId: string, followed: boolean) => {
      const row = containers.get(`${provider}:${containerId}`);
      if (row) containers.set(`${provider}:${containerId}`, { ...row, followed });
    },
    setHighWater: (provider: string, containerId: string, mark: string | null, at: number) => {
      const row = containers.get(`${provider}:${containerId}`);
      if (row)
        containers.set(`${provider}:${containerId}`, { ...row, highWater: mark, lastSync: at });
    },
    upsertItem: (row: SyncItemRow) => rows.set(row.externalId, row),
    countByContainer: (provider: string, containerId: string) =>
      [...rows.values()].filter((r) => r.provider === provider && r.container === containerId)
        .length,
    itemByExternalId: (_provider: string, externalId: string) => rows.get(externalId) ?? null,
    itemsByKind: (kind: string) => [...rows.values()].filter((r) => r.kind === kind),
  } as unknown as SyncStore;
}

const fakeContext = (): UseCaseContext =>
  ({
    vault: { readNote: async () => null, exists: async () => false },
    index: { all: () => [], reindex: () => {} },
    git: { commitPaths: async () => {} },
  }) as unknown as UseCaseContext;

const settings = {
  getConnection: (id: string) =>
    id === 'tracker' ? { providerId: 'tracker', fields: { apiToken: 't-1' } } : null,
  getGoogle: () => null,
} as never;

function service(store: SyncStore, state = { fail: false }): SyncService {
  return new SyncService(
    () => fakeContext(),
    () => store,
    settings,
    {} as never,
    () => {},
    [fakeProvider(state)],
  );
}

/** Two containers, both followed, neither ever pulled: a fresh connect. */
const freshFollows = () => [
  { kind: 'ticket', containerId: 'NORD', name: 'Nordkap Platform' },
  { kind: 'wikipage', containerId: 'KRAN', name: 'Kranelund' },
];

test('a connection that has just read for the first time owes one debrief', async () => {
  const store = fakeStore(freshFollows());
  const sync = service(store);
  await sync.tick();

  const reads = sync.firstLookReads();
  assert.equal(reads.length, 1);
  const read = reads[0]!;
  assert.equal(read.connectionId, 'tracker');
  assert.equal(read.providerLabel, 'Tracker');
  // Names and counts come off the store, so the session quotes what the
  // workspace actually holds rather than what the tick happened to see.
  assert.deepEqual(
    read.containers.map((c) => [c.name, c.count]),
    [
      ['Nordkap Platform', 1],
      ['Kranelund', 0],
    ],
  );
});

test('a workspace that was already syncing is never debriefed about it', async () => {
  // The upgrade case, and the one that would be loudest if it went wrong: every
  // existing workspace would be knocked on at the next tick.
  const store = fakeStore([
    { kind: 'ticket', containerId: 'NORD', name: 'Nordkap Platform', lastSync: 1 },
    { kind: 'wikipage', containerId: 'KRAN', name: 'Kranelund', lastSync: 1 },
  ]);
  const sync = service(store);
  await sync.tick();
  assert.deepEqual(sync.firstLookReads(), []);
});

test('following a second project later is not a first read', async () => {
  const store = fakeStore(freshFollows());
  const sync = service(store);
  await sync.tick();
  sync.markFirstLookDone('tracker');

  // A project added months on: it has never been pulled, but the connection has.
  store.upsertContainer('tracker', 'ticket', 'BERG', 'Bergman & Falk');
  store.setFollow('tracker', 'BERG', true);
  await sync.tick();
  assert.deepEqual(sync.firstLookReads(), []);
});

test('a read that failed halfway is retried rather than reported', async () => {
  const store = fakeStore(freshFollows());
  const state = { fail: true };
  const sync = service(store, state);
  await sync.tick();
  assert.deepEqual(sync.firstLookReads(), [], 'half a site is not a first look');

  state.fail = false;
  await sync.tick();
  assert.equal(sync.firstLookReads().length, 1, 'the tick that got through reports it');
});

test('the knock is owed once, and stamping it is what settles that', async () => {
  const store = fakeStore(freshFollows());
  const sync = service(store);
  await sync.tick();
  assert.equal(sync.firstLookReads().length, 1);

  sync.markFirstLookDone('tracker');
  assert.deepEqual(sync.firstLookReads(), []);
  // And no later tick brings it back. This is the guard that has to hold across
  // a relaunch, which is why it lives in the store and not in memory.
  await sync.tick();
  assert.deepEqual(sync.firstLookReads(), []);
});

test('a site with nothing in it is closed out quietly, not knocked about', async () => {
  const store = fakeStore([{ kind: 'wikipage', containerId: 'KRAN', name: 'Kranelund' }]);
  const sync = service(store);
  await sync.tick();
  assert.deepEqual(sync.firstLookReads(), []);
  // Closed out for good: an empty site does not become news on the next tick.
  await sync.tick();
  assert.deepEqual(sync.firstLookReads(), []);
});

const TRACKER_READ = {
  connectionId: 'tracker',
  providerLabel: 'Jira + Confluence',
  siteLabel: 'tavla.atlassian.net',
  containers: [
    { id: 'NORD', kind: 'ticket', name: 'Nordkap Platform', count: 214, provider: 'jira' },
    { id: 'KRAN', kind: 'wikipage', name: 'Kranelund', count: 1, provider: 'confluence' },
    { id: 'BERG', kind: 'ticket', name: 'Bergman & Falk', count: 0, provider: 'jira' },
  ],
};

test('the instruction hands over the names and the numbers', () => {
  const said = firstLookInstruction([TRACKER_READ]);
  assert.match(said, /A connection has finished its first read/);
  assert.match(said, /Jira \+ Confluence connection on tavla\.atlassian\.net/);
  assert.match(said, /- Nordkap Platform \(NORD\): 214 tickets/);
  // Singular where it is one, because "1 pages" reads as a bug in the counting.
  assert.match(said, /- Kranelund \(KRAN\): 1 page$/m);
  // A container that holds nothing is not a row: there is nothing to say about it.
  assert.doesNotMatch(said, /Bergman/);
  // The debrief itself is named rather than repeated: that behaviour is copy the
  // PM can edit, and two copies of it would drift.
  assert.match(said, /"First look" section of the skill/);
});

/**
 * The conventions write-up (docs/easier-tickets.md E-25). A connection's first
 * read is the one moment the evidence is all there, so the house shape is
 * written up then, once, as a card the PM can correct.
 */
test('the first read is also told to write up how the team uses its tools', () => {
  const said = firstLookInstruction([TRACKER_READ]);
  assert.match(said, /Before the knock, write up how this team uses its tools/);
  // It runs whether or not they want a walkthrough, so it cannot sit behind
  // beat one's "propose nothing".
  assert.match(said, /whether or not they want a walkthrough/);
  assert.match(said, /this write-up is the exception/);
  // One file per system, each named with what it is written from.
  assert.match(said, /`skills\/jira\/SKILL\.md`, written from Nordkap Platform \(NORD\)/);
  assert.match(said, /`skills\/confluence\/SKILL\.md`, written from Kranelund \(KRAN\)/);
  assert.match(said, /`title: How we use Jira`/);
  assert.match(said, /`title: How we use Confluence`/);
  // A container with nothing in it is not evidence of anything.
  assert.doesNotMatch(said, /Bergman/);
  // One proposal per file, and it is how the run asks. Rules asked one at a time
  // land silently, which is the thing this replaces.
  assert.match(said, /One proposal per file, and it is how you ask/);
  assert.match(said, /Never ask about conventions one rule at a time/);
});

/**
 * The headings are quoted from the shipped template, never typed again: the
 * write-up has to land in the shape the file keeps, and renaming a heading in
 * `defaults.ts` must not leave the kickoff pointing at the old one.
 */
test('the write-up is given the shipped headings, in file order', () => {
  const said = firstLookInstruction([TRACKER_READ]);
  const jira = parseRunnable(JIRA_CONVENTIONS, 'jira').body;
  const headings = [...jira.matchAll(/^## (.+)$/gm)].map((m) => m[1]!.trim());
  assert.deepEqual(headings, [
    'When you draft a ticket',
    'When you comment',
    'Standing instructions',
  ]);
  assert.match(said, new RegExp(headings.map((h) => `"${h}"`).join(', ')));
  // The last one stays empty: it is where a rule stated in a chat lands.
  assert.match(said, /Leave the last heading empty/);
});

/** No tracker, no conventions: a calendar has no house shape to write up, and a
 *  container the connector mirrors nowhere is not evidence either. */
test('a first look with nothing to draft for says nothing about conventions', () => {
  const calendarOnly = firstLookInstruction([
    {
      connectionId: 'google',
      providerLabel: 'Google Calendar',
      siteLabel: 'erik@leveret.io',
      containers: [
        { id: 'primary', kind: 'calendar', name: 'Work', count: 62, provider: 'google-calendar' },
      ],
    },
  ]);
  assert.doesNotMatch(calendarOnly, /write up how this team uses its tools/);
  assert.match(calendarOnly, /"First look" section of the skill/);
  const unmirrored = firstLookInstruction([
    { ...TRACKER_READ, containers: [{ id: 'NORD', kind: 'ticket', name: 'Nordkap', count: 9 }] },
  ]);
  assert.doesNotMatch(unmirrored, /write up how this team uses its tools/);
});

/**
 * CM-5: two connections made in the same onboarding are one haul to the PM, so
 * one kickoff carries both. Two knocks would be the app asking the same opening
 * question twice in five minutes.
 */
test('every read that is owed rides in one instruction', () => {
  const said = firstLookInstruction([
    TRACKER_READ,
    {
      connectionId: 'google',
      providerLabel: 'Google Calendar',
      siteLabel: 'erik@leveret.io',
      containers: [{ id: 'primary', kind: 'calendar', name: 'Work', count: 62 }],
    },
  ]);
  assert.match(said, /2 connections have finished their first read/);
  assert.match(said, /Jira \+ Confluence connection on tavla\.atlassian\.net/);
  assert.match(said, /Google Calendar connection on erik@leveret\.io/);
  assert.match(said, /- Work \(primary\): 62 events/);
  // One closing line, not one per read: it is one first look over the lot.
  assert.equal(said.match(/This is a first look\./g)?.length, 1);
});

/**
 * The knock always happens now, and what changes for a workspace that has
 * already been told about the product is one line in the kickoff (2026-08-31).
 * Skipping the session instead broke the promise the follow picker makes.
 */
test('a workspace that already told it is knocked on, with one line saying so', () => {
  assert.doesNotMatch(firstLookInstruction([TRACKER_READ]), /skip the interview/);
  const said = firstLookInstruction([TRACKER_READ], true);
  assert.match(said, /already holds the product picture, so skip the interview/);
  // The rest is unchanged: same names, same numbers, same pointer at the section
  // that holds the branch.
  assert.match(said, /- Nordkap Platform \(NORD\): 214 tickets/);
  assert.match(said, /"First look" section of the skill/);
});

/**
 * The kick that chases the confirm (docs/first-look-debrief.md FD-2). The picker
 * sends one `setFollow` per container, and the maintenance pass is what fires
 * the debrief, so what is tested here is: one confirm buys one pass, an unfollow
 * buys none, and a pass that said nothing gets exactly one more try.
 *
 * Real timers on a 5ms delay. The decision is about ordering, not about a clock,
 * and a fake clock would only test the fake.
 */
const settle = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms));

test('one confirm is one maintenance pass, however many containers it followed', async () => {
  let passes = 0;
  const kick = createFirstLookKick({
    delayMs: 5,
    pass: async () => void passes++,
    stillOwed: () => false,
  });
  kick.follow(true);
  kick.follow(true);
  kick.follow(true);
  await settle();
  assert.equal(passes, 1);
});

test('turning a follow off knocks on nobody', async () => {
  let passes = 0;
  const kick = createFirstLookKick({
    delayMs: 5,
    pass: async () => void passes++,
    stillOwed: () => false,
  });
  kick.follow(false);
  await settle();
  assert.equal(passes, 0);
});

test('a pass that was already past the first look is tried once more, and only once', async () => {
  // The one gap the wait cannot cover: `runMaintenance` joins a pass in flight
  // rather than queueing behind it, so a kick can resolve with nothing said.
  let passes = 0;
  const kick = createFirstLookKick({
    delayMs: 5,
    pass: async () => void passes++,
    stillOwed: () => true,
  });
  kick.follow(true);
  await settle();
  assert.equal(passes, 2, 'one retry, and no loop when the read stays owed');
});

test('a kick that has not fired yet can be dropped', async () => {
  let passes = 0;
  const kick = createFirstLookKick({
    delayMs: 5,
    pass: async () => void passes++,
    stillOwed: () => false,
  });
  kick.follow(true);
  kick.cancel();
  await settle();
  assert.equal(passes, 0);
});

/**
 * The receipt the confirm ends in (docs/closing-beat.md, FD-1's 2026-08-31
 * amendment). One rule holds all four cases: the line is only written where the
 * promise it repeats can be kept.
 */

test('a first follow that started a read says so, and says the knock is coming', () => {
  assert.equal(
    followReceipt({ firstFollow: true, started: 2 }, true),
    'Reading these now. When it has something to say, it knocks on Home.',
  );
});

test('with no model key the receipt stops at the read', () => {
  const line = followReceipt({ firstFollow: true, started: 2 }, false);
  assert.equal(line, 'Reading these now. They stay current as notes in your workspace.');
  assert.ok(!line?.includes('Home'), 'no debrief runs, so no knock is promised');
});

test('a reopened picker promised nothing, so it owes no receipt', () => {
  assert.equal(followReceipt({ firstFollow: false, started: 1 }, true), null);
});

test('a confirm that started no read is not a landing', () => {
  assert.equal(followReceipt({ firstFollow: true, started: 0 }, true), null);
});
