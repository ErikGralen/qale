import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { CONNECTOR_PROVIDERS, type Connector, type ConnectorProvider } from '@qale/connectors';
import {
  agentConnections,
  type AgentConnectionSettings,
} from '../src/main/services/agent-connections.js';

/**
 * What the agent runtime is handed (docs/provider-decoupling.md PD-8): prepared
 * capabilities per stored connection, never a credential and never a provider
 * name it has to recognize.
 */

const ATLASSIAN_FIELDS = {
  siteUrl: 'https://tavla.atlassian.net',
  email: 'ada@tavla.example',
  apiToken: 'tok-abcdefgh',
};

function settings(
  stored: Record<string, { providerId: string; fields: Record<string, string> }>,
): AgentConnectionSettings {
  return {
    listConnections: () =>
      Object.entries(stored).map(([connectionId, s]) => ({
        connectionId,
        providerId: s.providerId,
      })),
    getConnection: (connectionId) => stored[connectionId] ?? null,
  };
}

test('a stored Atlassian credential brings its four reads and can track', () => {
  const conns = agentConnections(
    settings({ atlassian: { providerId: 'atlassian', fields: ATLASSIAN_FIELDS } }),
  );

  assert.equal(conns.length, 1);
  assert.equal(conns[0]!.connectionId, 'atlassian');
  assert.deepEqual(
    conns[0]!.readTools.map((t) => t.name),
    ['jira_search', 'jira_get_issue', 'confluence_search', 'confluence_get_page'],
  );
  // `track_external` asks the sync engine for one item by key, which is what
  // `pullByKeys` is.
  assert.equal(conns[0]!.canTrack, true);
  assert.match(conns[0]!.fingerprint, /^[0-9a-f]{64}$/);
});

test('a new token is a new fingerprint, so live sessions rebuild', () => {
  const one = agentConnections(
    settings({ atlassian: { providerId: 'atlassian', fields: ATLASSIAN_FIELDS } }),
  );
  const two = agentConnections(
    settings({
      atlassian: { providerId: 'atlassian', fields: { ...ATLASSIAN_FIELDS, apiToken: 'tok-2' } },
    }),
  );
  assert.notEqual(one[0]!.fingerprint, two[0]!.fingerprint);
  // The token itself never travels to the runtime.
  assert.doesNotMatch(one[0]!.fingerprint, /tok-/);
});

test('nothing stored means no reads at all', () => {
  assert.deepEqual(agentConnections(settings({})), []);
});

test('a half-entered credential grants nothing', () => {
  const conns = agentConnections(
    settings({ atlassian: { providerId: 'atlassian', fields: { siteUrl: 'https://x' } } }),
  );
  // No client can be built from it, so there is nothing to read and nothing to
  // watch. A connection that grants neither is left out.
  assert.deepEqual(conns, []);
});

test('a provider with no reads still counts when it can track', () => {
  const tracker: ConnectorProvider<unknown> = {
    id: 'linear',
    label: 'Linear',
    authSchema: z.object({ apiToken: z.string().min(1) }),
    authFields: [{ key: 'apiToken', label: 'API token', secret: true }],
    renewFieldKeys: ['apiToken'],
    create: () =>
      ({ id: 'linear', providers: {}, pullByKeys: async () => [] }) as unknown as Connector,
  };
  const conns = agentConnections(
    settings({ linear: { providerId: 'linear', fields: { apiToken: 'k' } } }),
    [...CONNECTOR_PROVIDERS, tracker],
  );
  assert.equal(conns.length, 1);
  assert.deepEqual(conns[0]!.readTools, []);
  assert.equal(conns[0]!.canTrack, true);
});
