import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import type { Connector, ConnectorProvider, ExecuteResult } from '@qale/connectors';
import {
  makeOutbound,
  outboundConnections,
  type OutboundConnection,
} from '../src/main/services/outbound-service.js';

/**
 * Outbound dispatch routes on the payload's provider and nothing else
 * (docs/provider-decoupling.md PD-5). The old shape fell through to Atlassian,
 * so a card addressed to a provider nobody serves was handed to the connector
 * that happened to be there.
 */

interface Call {
  connector: string;
  payload: unknown;
}

function fakeConnector(id: string, providers: Record<string, string>, calls: Call[]): Connector {
  return {
    id,
    providers,
    execute: async (payload: unknown): Promise<ExecuteResult> => {
      calls.push({ connector: id, payload });
      return { externalId: 'PAY-142', url: 'https://tavla.atlassian.net/browse/PAY-142' };
    },
  } as unknown as Connector;
}

function fakeProvider(id: string, connector: Connector): ConnectorProvider<unknown> {
  return {
    id,
    label: id,
    authSchema: z.object({ apiToken: z.string().min(1) }),
    authFields: [{ key: 'apiToken', label: 'API token', secret: true }],
    renewFieldKeys: ['apiToken'],
    create: () => connector,
  } as unknown as ConnectorProvider<unknown>;
}

test('a jira payload goes to the connector that claims jira', async () => {
  const calls: Call[] = [];
  const atlassian = fakeConnector('atlassian', { ticket: 'jira', wikipage: 'confluence' }, calls);
  const google = fakeConnector('google-calendar', { calendar: 'google-calendar' }, calls);
  const port = makeOutbound([{ connector: atlassian }, { connector: google }])!;

  const result = await port.execute({ provider: 'jira', action: 'comment_ticket' });

  assert.equal(result.externalId, 'PAY-142');
  assert.deepEqual(
    calls.map((c) => c.connector),
    ['atlassian'],
  );
});

test('an unclaimed provider fails the card and reaches no connector', async () => {
  const calls: Call[] = [];
  const port = makeOutbound([
    { connector: fakeConnector('atlassian', { ticket: 'jira' }, calls) },
  ])!;

  await assert.rejects(
    () => port.execute({ provider: 'linear', action: 'create_ticket' }),
    /No connection can deliver to linear\./,
  );
  // The point of the ticket: no fallthrough to whoever is connected.
  assert.deepEqual(calls, []);
});

test('a calendar write asks for the write scope first', async () => {
  const order: string[] = [];
  const connection: OutboundConnection = {
    connector: {
      id: 'google-calendar',
      providers: { calendar: 'google-calendar' },
      execute: async () => {
        order.push('execute');
        return { externalId: 'evt-1', url: 'https://calendar.google.com/event?eid=evt-1' };
      },
    } as unknown as Connector,
    ensureWriteAccess: async () => void order.push('consent'),
  };
  const port = makeOutbound([connection])!;

  await port.execute({ provider: 'google-calendar', action: 'create_event' });

  assert.deepEqual(order, ['consent', 'execute']);
});

test('nothing connected means no port at all', () => {
  assert.equal(makeOutbound([]), undefined);
});

test('the connections come from the registry and the stored credentials', () => {
  const calls: Call[] = [];
  const linear = fakeConnector('linear', { ticket: 'linear' }, calls);
  const settings = {
    getConnection: (connectionId: string) =>
      connectionId === 'linear' ? { providerId: 'linear', fields: { apiToken: 'lin-1' } } : null,
    getGoogle: () => null,
  };
  const google = { getAccessToken: async () => 'tok', ensureWriteScope: async () => {} };

  const built = outboundConnections(settings, google, [
    fakeProvider('linear', linear),
    fakeProvider('atlassian', fakeConnector('atlassian', { ticket: 'jira' }, calls)),
  ]);

  // Only the provider with a credential is there, and it claims its own string.
  assert.deepEqual(
    built.map((c) => c.connector.id),
    ['linear'],
  );
  assert.equal(makeOutbound(built) !== undefined, true);
});
