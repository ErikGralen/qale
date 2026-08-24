import {
  connectorFrom,
  CONNECTOR_PROVIDERS,
  type Connector,
  type ConnectorProvider,
} from '@qale/connectors';
import type { OutboundPort } from '@qale/application';

/** What the Google branch needs: a token supplier plus the incremental-consent
 *  step run just before the first write (the "Google asks now" moment). */
export interface GoogleOutboundAuth {
  getAccessToken(): Promise<string>;
  ensureWriteScope(): Promise<void>;
}

/** One live connection the outbound port can deliver through. */
export interface OutboundConnection {
  connector: Connector;
  /** Run right before a write reaches this connection. Only OAuth connections
   *  have one: the write scope is asked for at push time, never up front. */
  ensureWriteAccess?: () => Promise<void>;
}

/** What the outbound builder reads out of settings. */
export interface OutboundSettings {
  getConnection(
    connectionId: string,
  ): { providerId: string; fields: Record<string, string> } | null;
  getGoogle(): { refreshToken: string } | null;
}

const GOOGLE_PROVIDER = 'google-calendar';

/**
 * The live connections, one per registered provider that has a credential
 * (docs/provider-decoupling.md PD-5). Google is the exception, and the only
 * one: its credential is a browser grant in its own settings slot, and its
 * connector takes a live-token callback rather than pasted fields.
 */
export function outboundConnections(
  settings: OutboundSettings,
  google: GoogleOutboundAuth,
  registry: readonly ConnectorProvider<unknown>[] = CONNECTOR_PROVIDERS,
): OutboundConnection[] {
  const out: OutboundConnection[] = [];
  for (const provider of registry) {
    if (provider.id === GOOGLE_PROVIDER) {
      if (!settings.getGoogle()) continue;
      out.push({
        connector: provider.create({ getAccessToken: () => google.getAccessToken() }),
        ensureWriteAccess: () => google.ensureWriteScope(),
      });
      continue;
    }
    const stored = settings.getConnection(provider.id);
    const connector = stored ? connectorFrom(provider, stored.fields) : null;
    if (connector) out.push({ connector });
  }
  return out;
}

/**
 * The outbound seam (PLAN-V2 §3.4): ONE dispatch site. The card-application
 * layer hands the stored payload to a connector's `execute`, which re-validates
 * it (legacy shapes normalize in the same parse) and routes by provider/action.
 *
 * The routing table is the connectors' own `providers` record: Atlassian claims
 * `jira` and `confluence`, Google Calendar claims `google-calendar`, and a new
 * connector claims its provider by declaring it. A payload whose provider
 * nobody claims fails the card. It is never handed to the connector that
 * happens to be there.
 *
 * Constructed only when something is connected, and invoked ONLY by the
 * card-acceptance path on approval, never by an agent tool.
 */
export function makeOutbound(connections: readonly OutboundConnection[]): OutboundPort | undefined {
  const byProvider = new Map<string, OutboundConnection>();
  for (const connection of connections)
    for (const provider of Object.values(connection.connector.providers))
      if (provider) byProvider.set(provider, connection);
  if (byProvider.size === 0) return undefined;

  return {
    execute: async (payload) => {
      const provider = (payload as { provider?: string } | null)?.provider;
      const connection = provider ? byProvider.get(provider) : undefined;
      if (!connection) {
        throw new Error(
          `No connection can deliver to ${provider ?? 'that system'}. Connect one in Settings.`,
        );
      }
      // Incremental consent, right before the write the provider is about to receive.
      await connection.ensureWriteAccess?.();
      return connection.connector.execute(payload);
    },
  };
}
