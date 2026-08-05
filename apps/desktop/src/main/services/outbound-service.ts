import { atlassianConnector, googleCalendarConnector } from '@qale/connectors';
import type { OutboundPort } from '@qale/application';

/** What the Google branch needs: a token supplier plus the incremental-consent
 *  step run just before the first write (the "Google asks now" moment). */
export interface GoogleOutboundAuth {
  getAccessToken(): Promise<string>;
  ensureWriteScope(): Promise<void>;
}

/**
 * The outbound seam (PLAN-V2 §3.4): ONE dispatch site. The card-application
 * layer hands the stored payload to a connector's `execute`, which re-validates
 * it (legacy shapes normalize in the same parse) and routes by provider/action.
 * This composite picks the connector by the payload's provider, so a new
 * provider is a branch here, never a new code path in the accept layer.
 * Constructed only when something is connected, and invoked ONLY by the
 * card-acceptance path on approval — never by an agent tool.
 */
export function makeOutbound(
  atlassianCreds: { baseUrl: string; email: string; token: string } | null,
  googleAuth?: GoogleOutboundAuth | null,
): OutboundPort | undefined {
  const atlassian = atlassianCreds
    ? atlassianConnector.create({
        siteUrl: /^https?:\/\//i.test(atlassianCreds.baseUrl.trim())
          ? atlassianCreds.baseUrl.trim().replace(/\/+$/, '')
          : `https://${atlassianCreds.baseUrl.trim().replace(/\/+$/, '')}`,
        email: atlassianCreds.email,
        apiToken: atlassianCreds.token,
      })
    : null;
  const google = googleAuth
    ? googleCalendarConnector.create({ getAccessToken: googleAuth.getAccessToken })
    : null;
  if (!atlassian && !google) return undefined;

  return {
    execute: async (payload) => {
      const provider = (payload as { provider?: string } | null)?.provider;
      if (provider === 'google-calendar') {
        if (!google || !googleAuth) {
          throw new Error('Google Calendar isn’t connected. Connect it in Settings to push events.');
        }
        // Incremental consent, right before the write Google is about to receive.
        await googleAuth.ensureWriteScope();
        return google.execute(payload);
      }
      if (!atlassian) {
        throw new Error('no Atlassian integration configured (set it in Settings)');
      }
      return atlassian.execute(payload);
    },
  };
}
