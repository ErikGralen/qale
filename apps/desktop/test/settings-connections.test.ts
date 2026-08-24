import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Connector credentials in one generic map (docs/provider-decoupling.md PD-3).
 * Two things have to hold at once: a second tracker can store its token beside
 * the first one, and a settings file written by the old single-slot build still
 * opens with its Atlassian connection intact.
 *
 * The suite fakes both halves of the OS: `app.getPath` points at a scratch
 * folder, and `safeStorage` seals with a prefix so a test can hand the service a
 * value that will NOT decrypt (a Deny on macOS, a settings file from another
 * Windows account) and check what survives it.
 */

/** The scratch userData the service under test reads and writes. */
let userData = '';
/** Off means "no OS secret store": the base64 fallback path. */
let encryptionAvailable = true;

const SEAL = 'sealed:';

mock.module('electron', {
  namedExports: {
    app: {
      getPath: () => userData,
      getLocale: () => 'en-US',
    },
    safeStorage: {
      isEncryptionAvailable: () => encryptionAvailable,
      encryptString: (value: string) => Buffer.from(`${SEAL}${value}`, 'utf8'),
      decryptString: (buf: Buffer) => {
        const text = buf.toString('utf8');
        if (!text.startsWith(SEAL)) throw new Error('cannot decrypt');
        return text.slice(SEAL.length);
      },
    },
  },
});

const { SettingsService } = await import('../src/main/services/settings-service.js');

/** What the fake keychain writes for a value the service can read back. */
const sealed = (value: string): string =>
  `enc:${Buffer.from(`${SEAL}${value}`, 'utf8').toString('base64')}`;
/** A stored secret from another machine: right shape, wrong keychain. */
const UNREADABLE = `enc:${Buffer.from('from another laptop', 'utf8').toString('base64')}`;

async function scratch(settingsJson?: object): Promise<string> {
  userData = await fs.mkdtemp(join(tmpdir(), 'qale-settings-'));
  encryptionAvailable = true;
  if (settingsJson)
    await fs.writeFile(join(userData, 'settings.json'), JSON.stringify(settingsJson), 'utf8');
  return userData;
}

async function loaded(): Promise<InstanceType<typeof SettingsService>> {
  const settings = new SettingsService();
  await settings.load();
  return settings;
}

/** The file as the next launch would read it. */
async function readFile(dir: string): Promise<{ raw: string; json: Record<string, unknown> }> {
  const raw = await fs.readFile(join(dir, 'settings.json'), 'utf8');
  return { raw, json: JSON.parse(raw) as Record<string, unknown> };
}

test('a connection round-trips, and nothing about it is stored in the clear', async () => {
  const dir = await scratch();
  const first = await loaded();
  await first.setConnection('atlassian', 'atlassian', {
    siteUrl: 'https://tavla.atlassian.net',
    email: 'ada@tavla.example',
    apiToken: 'tok-abcdefgh',
  });

  const { raw, json } = await readFile(dir);
  for (const value of ['https://tavla.atlassian.net', 'ada@tavla.example', 'tok-abcdefgh'])
    assert.ok(!raw.includes(value), `${value} is in the file in the clear`);
  const stored = (json['connections'] as Record<string, { fields: Record<string, string> }>)[
    'atlassian'
  ]!;
  assert.deepEqual(Object.keys(stored.fields).sort(), ['apiToken', 'email', 'siteUrl']);

  const next = await loaded();
  assert.deepEqual(next.getConnection('atlassian'), {
    providerId: 'atlassian',
    fields: {
      siteUrl: 'https://tavla.atlassian.net',
      email: 'ada@tavla.example',
      apiToken: 'tok-abcdefgh',
    },
  });
  assert.equal(next.secretsUnreadable(), false);
});

test('two connections live side by side, and one disconnects alone', async () => {
  await scratch();
  const settings = await loaded();
  await settings.setConnection('atlassian', 'atlassian', { apiToken: 'tok-abcdefgh' });
  await settings.setConnection('linear', 'linear', { apiToken: 'lin-12345678' });

  assert.deepEqual(settings.listConnections(), [
    { connectionId: 'atlassian', providerId: 'atlassian' },
    { connectionId: 'linear', providerId: 'linear' },
  ]);

  await settings.clearConnection('atlassian');
  const next = await loaded();
  assert.equal(next.getConnection('atlassian'), null);
  assert.equal(next.getConnection('linear')?.fields['apiToken'], 'lin-12345678');
});

test('with no OS secret store the fields still round-trip', async () => {
  const dir = await scratch();
  encryptionAvailable = false;
  const settings = await loaded();
  await settings.setConnection('atlassian', 'atlassian', { apiToken: 'tok-abcdefgh' });

  const { raw } = await readFile(dir);
  assert.ok(!raw.includes('tok-abcdefgh'));
  assert.equal((await loaded()).getConnection('atlassian')?.fields['apiToken'], 'tok-abcdefgh');
});

test('an old settings file migrates its Atlassian slot into the map', async () => {
  const dir = await scratch({
    vaultPath: '/Users/ada/Vault',
    anthropicKeyEnc: null,
    atlassian: {
      baseUrl: 'https://tavla.atlassian.net',
      email: 'ada@tavla.example',
      tokenEnc: sealed('tok-abcdefgh'),
    },
    schedules: [],
  });
  const settings = await loaded();

  assert.deepEqual(settings.getConnection('atlassian'), {
    providerId: 'atlassian',
    fields: {
      siteUrl: 'https://tavla.atlassian.net',
      email: 'ada@tavla.example',
      apiToken: 'tok-abcdefgh',
    },
  });
  // The address the connection signs in with still means "me".
  assert.deepEqual(settings.selfEmails(), ['ada@tavla.example']);

  // The old slot is gone from the file, and the token did not land in it in the
  // clear on the way past.
  const { raw, json } = await readFile(dir);
  assert.equal('atlassian' in json, false);
  assert.ok(!raw.includes('tok-abcdefgh'));
  assert.ok(json['connections']);
});

test('a token that will not decrypt survives the migration', async () => {
  const dir = await scratch({
    vaultPath: '/Users/ada/Vault',
    atlassian: {
      baseUrl: 'https://tavla.atlassian.net',
      email: 'ada@tavla.example',
      tokenEnc: UNREADABLE,
    },
    schedules: [],
  });
  const settings = await loaded();

  // Unreadable today is not the same as gone: the same file on the machine that
  // wrote it still has to connect.
  const { json } = await readFile(dir);
  const stored = (json['connections'] as Record<string, { fields: Record<string, string> }>)[
    'atlassian'
  ]!;
  assert.equal(stored.fields['apiToken'], UNREADABLE);

  assert.equal(settings.getConnection('atlassian'), null);
  assert.equal(settings.secretsUnreadable(), true);
});

