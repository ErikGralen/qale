import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGE_BANDS,
  COUNT_BANDS,
  DURATION_BANDS,
  KNOWN_SKILLS,
  TELEMETRY_ENVS,
  TELEMETRY_EVENTS,
  TELEMETRY_EVENT_IDS,
  TELEMETRY_IDENTITY,
  TELEMETRY_NEVER,
  TELEMETRY_PROCESSOR,
  ageBand,
  countBand,
  durationBand,
  filterTelemetryProps,
  skillWord,
  telemetryAllows,
  telemetryEvent,
} from '@qale/ipc';
import {
  TELEMETRY_ENV,
  TELEMETRY_ENV_IS_KNOWN,
  Telemetry,
  type TelemetryFacts,
  type TelemetrySink,
} from '../src/main/telemetry.js';

/**
 * The consent screen makes a short list of promises. Each one is a test here,
 * because the screen renders the allowlist and the sender reads it, and the
 * only thing that keeps those two honest is that nothing can get past the
 * filter that the screen did not name.
 */

const FACTS: TelemetryFacts = Object.freeze({
  appVersion: '0.1.0',
  platform: 'darwin',
  arch: 'arm64',
  packaged: true,
});

const INSTALL_ID = '6f1c2a7e-0b44-4b6f-9d21-8c3a5e77b1aa';

interface Sent {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
}

function recorder(shutdown: () => unknown = () => Promise.resolve()): {
  sink: TelemetrySink;
  sent: Sent[];
} {
  const sent: Sent[] = [];
  return {
    sent,
    sink: {
      capture: (payload) => {
        sent.push(payload);
      },
      shutdown,
    },
  };
}

/** The sender builds its client in an async start(), so let the queue drain. */
function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** A sender in the state the real one is in by the time a PM does anything. */
function live(): { telemetry: Telemetry; sent: Sent[] } {
  const { sink, sent } = recorder();
  const telemetry = new Telemetry(FACTS, sink);
  telemetry.bind(INSTALL_ID);
  telemetry.setConsent(true, true);
  return { telemetry, sent };
}

const props = (s: Sent | undefined): Record<string, unknown> => s?.properties ?? {};

// ---------------------------------------------------------------------------
// The list itself
// ---------------------------------------------------------------------------

test('an event nobody put on the list is refused, consent or not', () => {
  for (const stranger of ['note.opened', 'app.crashed.v2', '', 'session']) {
    assert.equal(telemetryAllows(true, stranger), false, stranger);
    assert.equal(telemetryEvent(stranger), undefined, stranger);
    // And it cannot smuggle properties through either.
    assert.deepEqual(filterTelemetryProps(stranger, { view: 'home' }), {});
  }
});

test('every event on the list is refused when consent is off', () => {
  assert.ok(TELEMETRY_EVENT_IDS.length > 0);
  for (const id of TELEMETRY_EVENT_IDS) {
    assert.equal(telemetryAllows(false, id), false, id);
    assert.equal(telemetryAllows(true, id), true, id);
  }
});

test('a property nobody named is dropped from an event that is otherwise fine', () => {
  assert.deepEqual(
    filterTelemetryProps('view.opened', {
      view: 'doc',
      // Everything a careless caller might add later:
      title: 'Nordkap pricing call',
      notePath: 'meetings/2026-07-17-nordkap.md',
      email: 'ada.lovelace@northwind.example',
    }),
    { view: 'doc' },
  );
});

test('a word outside its list is dropped, and so is a flag that is not a boolean', () => {
  assert.deepEqual(
    filterTelemetryProps('session.finished', {
      // A PM's own skill name is their material, so only our words pass.
      skill: 'nordkap-weekly',
      trigger: 'manual',
      duration: 'ages',
      failed: 'yes',
      cards: '2-5',
    }),
    { trigger: 'manual', cards: '2-5' },
  );
  // A missing value loses itself rather than the event.
  assert.deepEqual(filterTelemetryProps('view.opened', { view: undefined }), {});
  assert.deepEqual(filterTelemetryProps('view.opened', undefined), {});
});

test('the one free-text property is truncated to the length the list declares', () => {
  const spec = telemetryEvent('app.crashed');
  const stack = spec?.props['stack'];
  assert.equal(stack?.kind, 'scrubbedText');
  const max = stack?.kind === 'scrubbedText' ? stack.max : 0;
  const filtered = filterTelemetryProps('app.crashed', { stack: 'x'.repeat(max + 5_000) });
  assert.equal((filtered['stack'] as string).length, max);
});

test('free text exists in exactly one event, and every event says what it is', () => {
  for (const event of TELEMETRY_EVENTS) {
    assert.ok(event.says.length > 0, event.id);
    for (const [key, shape] of Object.entries(event.props)) {
      if (shape.kind === 'scrubbedText') {
        assert.equal(event.id, 'app.crashed', `free text in ${event.id}.${key}`);
      }
      if (shape.kind === 'word') {
        assert.ok(shape.values.length > 0, `${event.id}.${key} has no words`);
      }
    }
  }
});

test('a band answers "a few or hundreds" and never says how many', () => {
  assert.equal(countBand(0), '0');
  assert.equal(countBand(1), '1');
  assert.equal(countBand(5), '2-5');
  assert.equal(countBand(6), '6-20');
  assert.equal(countBand(100), '21-100');
  assert.equal(countBand(101), '100+');
  // Nonsense lands somewhere real rather than leaking a raw number.
  assert.equal(countBand(Number.NaN), '0');
  assert.equal(countBand(-3), '0');
  for (const n of [0, 1, 4, 19, 99, 5_000]) assert.ok(COUNT_BANDS.includes(countBand(n) as never));

  assert.equal(durationBand(0), '<5s');
  assert.equal(durationBand(4_999), '<5s');
  assert.equal(durationBand(5_000), '5-30s');
  assert.equal(durationBand(120_000), '2-10m');
  assert.equal(durationBand(600_000), '10m+');
  for (const ms of [0, 6_000, 90_000, 10 ** 9]) {
    assert.ok(DURATION_BANDS.includes(durationBand(ms) as never));
  }

  assert.equal(ageBand(0), '<1m');
  assert.equal(ageBand(60_000), '<1h');
  assert.equal(ageBand(3_600_000), '<1d');
  assert.equal(ageBand(86_400_000), '<1w');
  assert.equal(ageBand(604_800_000), '1w+');
  for (const ms of [0, 61_000, 10 ** 10]) assert.ok(AGE_BANDS.includes(ageBand(ms) as never));
});

test('a skill we did not write folds to custom', () => {
  assert.equal(skillWord('librarian'), 'librarian');
  assert.equal(skillWord('nordkap-weekly'), 'custom');
  assert.equal(skillWord(''), 'custom');
  assert.equal(skillWord(null), 'custom');
  assert.equal(skillWord(undefined), 'custom');
  // Which is what the session event will actually accept.
  for (const name of ['librarian', 'nordkap-weekly', null]) {
    assert.deepEqual(filterTelemetryProps('session.finished', { skill: skillWord(name) }), {
      skill: skillWord(name),
    });
    assert.ok(KNOWN_SKILLS.includes(skillWord(name) as never));
  }
});

test('the screen says who we are, where it goes, and what never leaves', () => {
  assert.match(TELEMETRY_IDENTITY, /name/i);
  assert.match(TELEMETRY_IDENTITY, /email/i);
  assert.match(TELEMETRY_PROCESSOR, /PostHog/);
  assert.match(TELEMETRY_PROCESSOR, /Europe/i);
  assert.ok(TELEMETRY_NEVER.length > 0);
  for (const line of TELEMETRY_NEVER) assert.ok(line.trim().length > 0);
});

// ---------------------------------------------------------------------------
// The sender
// ---------------------------------------------------------------------------

test('a build with no token and no sink has no sender at all', () => {
  // The token is read once, at import, so this reads the same env the module did.
  assert.equal(new Telemetry(FACTS).configured, Boolean(process.env['QALE_POSTHOG_KEY']));
  assert.equal(new Telemetry(FACTS, recorder().sink).configured, true);
});

test('an event nobody put on the list never reaches the sink', async () => {
  const { telemetry, sent } = live();
  telemetry.send('note.opened', { notePath: 'meetings/nordkap.md' });
  await settle();
  assert.deepEqual(sent, []);
});

test('nothing is sent until the consent screen has been answered', async () => {
  const { sink, sent } = recorder();
  const telemetry = new Telemetry(FACTS, sink);
  telemetry.bind(INSTALL_ID);
  // Consent is on by default for a beta invite, but nobody has seen the screen.
  telemetry.setConsent(true, false);
  telemetry.send('view.opened', { view: 'home' });
  await settle();
  assert.deepEqual(sent, [], 'sent before anyone was asked');

  telemetry.setConsent(true, true);
  await settle();
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.event, 'view.opened');
  assert.equal(props(sent[0])['view'], 'home');
});

test('an answer of no drops what was waiting, so it can never arrive later', async () => {
  const { sink, sent } = recorder();
  const telemetry = new Telemetry(FACTS, sink);
  telemetry.bind(INSTALL_ID);
  telemetry.setConsent(true, false);
  telemetry.send('view.opened', { view: 'home' });
  telemetry.send('app.launched', { firstRun: true });

  telemetry.setConsent(false, true);
  await settle();
  assert.deepEqual(sent, []);

  // And a change of heart later starts from empty, not from the backlog.
  telemetry.setConsent(true, true);
  await settle();
  assert.deepEqual(sent, []);
});

test('turning consent off stops a sender that was already sending', async () => {
  const { telemetry, sent } = live();
  telemetry.send('view.opened', { view: 'home' });
  await settle();
  assert.equal(sent.length, 1);

  telemetry.setConsent(false, true);
  telemetry.send('view.opened', { view: 'inbox' });
  await settle();
  assert.equal(sent.length, 1, 'kept sending after consent was withdrawn');
});

test('nothing is sent before an install id arrives', async () => {
  const { sink, sent } = recorder();
  const telemetry = new Telemetry(FACTS, sink);
  telemetry.setConsent(true, true);
  telemetry.send('app.launched', { firstRun: true });
  await settle();
  assert.deepEqual(sent, [], 'sent with nobody attached to it');

  telemetry.bind(INSTALL_ID);
  await settle();
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.distinctId, INSTALL_ID);
});

test('the backlog is bounded, so a long first run cannot grow without end', async () => {
  const { sink, sent } = recorder();
  const telemetry = new Telemetry(FACTS, sink);
  telemetry.bind(INSTALL_ID);
  telemetry.setConsent(true, false);
  for (let i = 0; i < 150; i++) telemetry.send('view.opened', { view: 'home' });
  telemetry.setConsent(true, true);
  await settle();
  assert.equal(sent.length, 100);
});

test('every event that goes out carries an env stamp that is one of ours', async () => {
  const { telemetry, sent } = live();
  telemetry.send('view.opened', { view: 'home' });
  telemetry.send('material.added', { kind: 'transcript', count: '1', startedSession: true });
  await settle();
  assert.equal(sent.length, 2);
  for (const one of sent) {
    const p = props(one);
    assert.equal(p['env'], TELEMETRY_ENV);
    assert.ok(TELEMETRY_ENVS.includes(p['env'] as never), String(p['env']));
    // A missing stamp must never be able to read as real.
    assert.notEqual(p['env'], undefined);
    assert.equal((p['$set'] as Record<string, unknown>)['env'], TELEMETRY_ENV);
    // The build's own facts ride along; none of them are the PM's.
    assert.equal(p['appVersion'], FACTS.appVersion);
    assert.equal(p['platform'], FACTS.platform);
    assert.equal(p['arch'], FACTS.arch);
    assert.equal(p['packaged'], FACTS.packaged);
  }
  assert.equal(TELEMETRY_ENV_IS_KNOWN, true);
});

test('a caller cannot forge the env stamp, on the event or on the person', async () => {
  const { telemetry, sent } = live();
  telemetry.describe({ env: 'beta-eu' as never });
  telemetry.send('view.opened', { view: 'home', env: 'beta-eu' });
  await settle();
  const p = props(sent[0]);
  assert.equal(p['env'], TELEMETRY_ENV);
  assert.equal((p['$set'] as Record<string, unknown>)['env'], TELEMETRY_ENV);
});

test('the sender filters properties too, not just the caller', async () => {
  const { telemetry, sent } = live();
  telemetry.send('view.opened', {
    view: 'doc',
    notePath: 'meetings/2026-07-17-nordkap.md',
    title: 'Pricing with Kranelund',
  });
  await settle();
  const p = props(sent[0]);
  assert.equal(p['view'], 'doc');
  assert.equal('notePath' in p, false);
  assert.equal('title' in p, false);
  assert.equal(JSON.stringify(p).includes('Kranelund'), false);
});

test('the distinct id is the install id', async () => {
  const { telemetry, sent } = live();
  telemetry.send('view.opened', { view: 'home' });
  await settle();
  assert.equal(sent[0]?.distinctId, INSTALL_ID);
});

test('a dev build stamps itself, in the id as well as in the event', async () => {
  // The stamp is read once, at import, so a dev sender needs its own copy of
  // the module. The query is only there to get past the module cache.
  const before = process.env['QALE_POSTHOG_DEV'];
  process.env['QALE_POSTHOG_DEV'] = '1';
  try {
    const dev = (await import('../src/main/telemetry.js?dev=1')) as typeof import('../src/main/telemetry.js');
    assert.equal(dev.TELEMETRY_ENV, 'dev');
    assert.equal(dev.TELEMETRY_ENV_IS_KNOWN, true);
    const { sink, sent } = recorder();
    const telemetry = new dev.Telemetry(FACTS, sink);
    telemetry.bind(INSTALL_ID);
    telemetry.setConsent(true, true);
    telemetry.send('view.opened', { view: 'home' });
    await settle();
    assert.equal(sent[0]?.distinctId, `dev-${INSTALL_ID}`);
    assert.equal(props(sent[0])['env'], 'dev');
  } finally {
    if (before === undefined) delete process.env['QALE_POSTHOG_DEV'];
    else process.env['QALE_POSTHOG_DEV'] = before;
  }
});

test('only the person properties we named survive, and they go out under $set', async () => {
  const { telemetry, sent } = live();
  telemetry.describe({
    // The two that are meant to be there (TEL-4).
    name: 'Ada Lovelace',
    email: 'ada.lovelace@northwind.example',
    notes: '21-100',
    hasKey: true,
    // And everything that is not.
    ...({
      workspace: 'Northwind Product',
      vaultPath: '/Users/ada/Product Notes',
      lastNote: 'meetings/pricing-call.md',
    } as Record<string, never>),
  });
  telemetry.send('view.opened', { view: 'home' });
  await settle();
  const set = props(sent[0])['$set'] as Record<string, unknown>;
  assert.equal(set['name'], 'Ada Lovelace');
  assert.equal(set['email'], 'ada.lovelace@northwind.example');
  assert.equal(set['notes'], '21-100');
  assert.equal(set['hasKey'], true);
  assert.deepEqual(
    Object.keys(set).filter((k) => ['workspace', 'vaultPath', 'lastNote'].includes(k)),
    [],
  );
  const blob = JSON.stringify(set);
  assert.equal(blob.includes('/Users/ada'), false);
  assert.equal(blob.includes('pricing-call.md'), false);
});

test('a crash is scrubbed before it is sent', async () => {
  const { telemetry, sent } = live();
  const error = new Error(
    'save failed for /Users/ada/Product Notes/meetings/pricing-call.md as ada.lovelace@northwind.example with key sk-ant-api03-9f2c4b7e1d6a8035ce41ffb2',
  );
  error.stack = [
    `Error: ${error.message}`,
    '    at save (/Users/ada/qale/apps/desktop/src/main/notes.ts:42:9)',
    '    at handle (/Users/ada/Product Notes/meetings/pricing-call.md:1:1)',
  ].join('\n');
  telemetry.crash('main', error);
  await settle();

  assert.equal(sent.length, 1);
  const p = props(sent[0]);
  assert.equal(sent[0]?.event, 'app.crashed');
  assert.equal(p['origin'], 'main');
  const text = `${String(p['name'])}\n${String(p['message'])}\n${String(p['stack'])}`;
  for (const leak of [
    '/Users/ada',
    'Product Notes',
    'pricing-call.md',
    'ada.lovelace@northwind.example',
    'sk-ant-api03-9f2c4b7e1d6a8035ce41ffb2',
  ]) {
    assert.equal(text.includes(leak), false, `crash leaked ${leak}`);
  }
  // The scrubber ran, and there is still something worth reading.
  assert.ok(text.includes('<path>'));
  assert.ok(text.includes('<email>'));
  assert.ok(text.includes('save failed for'));
});

test('a crash from something that is not an Error still sends, and still scrubs', async () => {
  const { telemetry, sent } = live();
  telemetry.crash('promise', '/Users/ada/Product Notes/plan.md went missing');
  await settle();
  const p = props(sent[0]);
  assert.equal(p['origin'], 'promise');
  assert.equal(String(p['message']).includes('/Users/ada'), false);
});

test('a crash stack is cut to the length the list declares', async () => {
  const { telemetry, sent } = live();
  const spec = telemetryEvent('app.crashed');
  const shape = spec?.props['stack'];
  const max = shape?.kind === 'scrubbedText' ? shape.max : 0;
  const error = new Error('deep');
  error.stack = ['Error: deep', ...Array.from({ length: 300 }, (_, i) => `    at step${i} (bundle:1:1)`)].join('\n');
  assert.ok(error.stack.length > max, 'fixture is not long enough to be cut');
  telemetry.crash('renderer', error);
  await settle();
  assert.equal(String(props(sent[0])['stack']).length, max);
});

test('an origin we did not name is dropped rather than sent', async () => {
  const { telemetry, sent } = live();
  // Not reachable through the typed API, but the filter is the guard that holds.
  telemetry.send('app.crashed', { origin: 'gpu-process', message: 'boom' });
  await settle();
  const p = props(sent[0]);
  assert.equal('origin' in p, false);
  assert.equal(p['message'], 'boom');
});

test('a quit is never held up by a sink that fails', async () => {
  const { sink, sent } = recorder(() => Promise.reject(new Error('offline')));
  const telemetry = new Telemetry(FACTS, sink);
  telemetry.bind(INSTALL_ID);
  telemetry.setConsent(true, true);
  telemetry.send('view.opened', { view: 'home' });
  await settle();
  assert.equal(sent.length, 1);
  // Resolves rather than rejecting, and does not wait on the failure.
  await telemetry.shutdown();
  // A second one is a no-op, not a second flush.
  await telemetry.shutdown();
});

test('a quit is never held up by a sink that never answers', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sink } = recorder(() => new Promise(() => {}));
  const telemetry = new Telemetry(FACTS, sink);
  telemetry.bind(INSTALL_ID);
  telemetry.setConsent(true, true);
  telemetry.send('view.opened', { view: 'home' });
  await settle();

  let done = false;
  const quitting = telemetry.shutdown().then(() => {
    done = true;
  });
  await settle();
  assert.equal(done, false, 'gave up before the flush had a chance');
  // The declared bound, and no longer: 1.5s inside the 5s teardown watchdog.
  t.mock.timers.tick(1_500);
  await quitting;
  assert.equal(done, true);
});
