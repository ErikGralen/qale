import type { Connector, ConnectorProvider, ProviderReadTool } from './types.js';

/**
 * Stored credential fields, and what gets built from them. Three callers build
 * on the same settings map (sync, outbound and the agent's reads), so the
 * normalization lives here once: two readings of one stored token would be two
 * different clients.
 */

/** A bare host is what people paste; the client needs a scheme. */
export function withScheme(siteUrl: string): string {
  const trimmed = siteUrl.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** A field that holds an address, by its key. The one generic fact this file
 *  knows about credential fields, and it only uses it to add a scheme. */
export const URL_FIELD_RE = /url$/i;

/**
 * The provider's declared credential fields, and only those, ready to store: a
 * URL typed as a bare host gets its scheme here, once, so the stored value and
 * the value a client is built from are the same string.
 */
export function collectFields(
  provider: ConnectorProvider<unknown>,
  values: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of provider.authFields) {
    const value = values[field.key] ?? '';
    out[field.key] = URL_FIELD_RE.test(field.key) ? withScheme(value) : value;
  }
  return out;
}

/** A bound connector from stored fields, or null when the fields are not a
 *  credential the provider accepts (half-entered, or hand-edited on disk). */
export function connectorFrom(
  provider: ConnectorProvider<unknown>,
  fields: Record<string, string>,
): Connector | null {
  const parsed = provider.authSchema.safeParse(collectFields(provider, fields));
  return parsed.success ? provider.create(parsed.data) : null;
}

/** The provider's agent-facing reads from stored fields. Empty when the
 *  provider offers none, or when the fields are not a credential it accepts. */
export function readToolsFrom(
  provider: ConnectorProvider<unknown>,
  fields: Record<string, string>,
): ProviderReadTool[] {
  if (!provider.readTools) return [];
  const parsed = provider.authSchema.safeParse(collectFields(provider, fields));
  return parsed.success ? provider.readTools(parsed.data) : [];
}
