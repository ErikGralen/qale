import type { ConnectorHealth, FetchLike, VerifyResult } from '../types.js';

/**
 * Credential probe (integration plan §Auth): API tokens come in two kinds and
 * the user never has to know which they created —
 *  - UNSCOPED tokens authenticate against the site URL directly;
 *  - SCOPED tokens only work via https://api.atlassian.com/ex/{product}/{cloudId}.
 * We try the site first; on an auth-shaped refusal we resolve the cloudId from
 * the public /_edge/tenant_info endpoint and retry through the gateway. The
 * probe also decides the request bases every later call uses.
 *
 * BOTH products are probed (Jira via /myself, Confluence via the space list):
 * a token valid for only one product is a working connection for that product,
 * so overall health is 'ok' when EITHER authenticates — the per-product detail
 * lands in `products` for the Connections UI to render as partial.
 *
 * Health is deliberately two distinct failure states: 'auth-expired' (a server
 * answered and refused the credentials — token expired/revoked/wrong) vs.
 * 'unreachable' (no server answered — offline, DNS, site down). The Connections
 * UI copy differs, so the probe must never conflate them. Throttling (429) is
 * NEITHER: the server is answering and has not judged the token — see
 * {@link toHealth}.
 */

export interface AtlassianAuth {
  siteUrl: string;
  email: string;
  apiToken: string;
}

export interface ProbeResult extends VerifyResult {
  /** Request bases for the client when the probe succeeded via the gateway. */
  apiBases?: { jira: string; wiki: string };
  products?: { jira: ConnectorHealth; confluence: ConnectorHealth };
}

interface RawMyself {
  displayName?: string;
  emailAddress?: string;
}

/** One probed endpoint, classified. 'auth' = a server judged and refused the token. */
type Outcome =
  | { kind: 'ok'; json?: unknown }
  | { kind: 'auth' }
  | { kind: 'throttled' }
  | { kind: 'error'; status: number }
  | { kind: 'network' };

/** A probe is interactive (the user just pasted a token) — one respectful
 *  Retry-After wait is fine, but never sit out a long throttle window. */
const THROTTLE_WAIT_CAP_MS = 5_000;

async function probeEndpoint(url: string, headers: Record<string, string>, fetchImpl: FetchLike): Promise<Outcome> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(url, { headers });
    } catch {
      return { kind: 'network' };
    }
    if (res.status === 429) {
      if (attempt > 0) return { kind: 'throttled' };
      const seconds = Number(res.headers.get('Retry-After'));
      await sleep(Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, THROTTLE_WAIT_CAP_MS) : 1_000);
      continue;
    }
    if (res.ok) return { kind: 'ok', json: await res.json().catch(() => undefined) };
    if (res.status === 401 || res.status === 403) return { kind: 'auth' };
    return { kind: 'error', status: res.status };
  }
}

/**
 * 'throttled' maps to 'ok' deliberately: after the respectful retry the server
 * is STILL just rate-limiting — it answered (so not 'unreachable') and never
 * judged the token (so not 'auth-expired'). 'ok' is the least-alarming honest
 * state; the next probe re-judges for real, and the client's own 429 backoff
 * covers the data path meanwhile.
 */
function toHealth(o: Outcome): ConnectorHealth {
  if (o.kind === 'ok' || o.kind === 'throttled') return 'ok';
  if (o.kind === 'auth') return 'auth-expired';
  return 'unreachable';
}

/** Sharpest evidence wins when a product was probed on both site and gateway. */
const RANK: Record<Outcome['kind'], number> = { ok: 4, throttled: 3, auth: 2, error: 1, network: 0 };
function best(site: Outcome, gateway: Outcome | null): Outcome {
  if (!gateway) return site;
  return RANK[gateway.kind] > RANK[site.kind] ? gateway : site;
}

function identityOf(jira: Outcome, fallbackEmail: string): { displayName: string; email?: string } | null {
  if (jira.kind !== 'ok') return null;
  const me = jira.json as RawMyself | undefined;
  return { displayName: me?.displayName ?? fallbackEmail, email: me?.emailAddress };
}

export async function probeAtlassian(auth: AtlassianAuth, fetchImpl: FetchLike): Promise<ProbeResult> {
  const site = auth.siteUrl.replace(/\/$/, '');
  const headers = {
    Authorization: `Basic ${Buffer.from(`${auth.email}:${auth.apiToken}`).toString('base64')}`,
    Accept: 'application/json',
  };

  // 1. Unscoped token: both products answer on the site directly.
  const jiraSite = await probeEndpoint(`${site}/rest/api/3/myself`, headers, fetchImpl);
  const wikiSite = await probeEndpoint(`${site}/wiki/rest/api/space?limit=1`, headers, fetchImpl);
  if (jiraSite.kind === 'ok' || wikiSite.kind === 'ok') {
    const identity = identityOf(jiraSite, auth.email);
    return {
      ok: true,
      health: 'ok',
      ...(identity ? { identity } : {}),
      site: { url: site, tokenKind: 'unscoped' },
      products: { jira: toHealth(jiraSite), confluence: toHealth(wikiSite) },
    };
  }
  if (jiraSite.kind === 'network' && wikiSite.kind === 'network') {
    return {
      ok: false,
      health: 'unreachable',
      site: { url: site },
      products: { jira: 'unreachable', confluence: 'unreachable' },
      error: `could not reach ${site}`,
    };
  }

  // 2. Scoped token: an auth-shaped refusal from the site may just mean the
  //    token only works via the api.atlassian.com gateway — resolve the cloudId
  //    (public endpoint, no auth) and retry BOTH products with the same Basic
  //    credentials. A non-auth refusal (5xx, throttle) skips this: the gateway
  //    can't rehabilitate a token the site never rejected.
  let gwJira: Outcome | null = null;
  let gwWiki: Outcome | null = null;
  if (jiraSite.kind === 'auth' || wikiSite.kind === 'auth') {
    let cloudId: string | undefined;
    try {
      const tenant = await fetchImpl(`${site}/_edge/tenant_info`, { headers: { Accept: 'application/json' } });
      if (tenant.ok) cloudId = ((await tenant.json()) as { cloudId?: string }).cloudId;
    } catch {
      // The site answered but the gateway path didn't — treat as network
      // trouble, not bad credentials: the token was never actually judged there.
      return {
        ok: false,
        health: 'unreachable',
        site: { url: site },
        products: { jira: toHealth(jiraSite), confluence: toHealth(wikiSite) },
        error: 'could not reach api.atlassian.com',
      };
    }
    if (cloudId) {
      const jiraBase = `https://api.atlassian.com/ex/jira/${cloudId}`;
      const wikiBase = `https://api.atlassian.com/ex/confluence/${cloudId}`;
      gwJira = await probeEndpoint(`${jiraBase}/rest/api/3/myself`, headers, fetchImpl);
      gwWiki = await probeEndpoint(`${wikiBase}/wiki/rest/api/space?limit=1`, headers, fetchImpl);
      if (gwJira.kind === 'ok' || gwWiki.kind === 'ok') {
        const identity = identityOf(gwJira, auth.email);
        return {
          ok: true,
          health: 'ok',
          ...(identity ? { identity } : {}),
          site: { url: site, cloudId, tokenKind: 'scoped' },
          apiBases: { jira: jiraBase, wiki: wikiBase },
          products: { jira: toHealth(gwJira), confluence: toHealth(gwWiki) },
        };
      }
    }
  }

  // Neither path authenticated either product: report the sharpest evidence.
  const jiraFinal = best(jiraSite, gwJira);
  const wikiFinal = best(wikiSite, gwWiki);
  const products = { jira: toHealth(jiraFinal), confluence: toHealth(wikiFinal) } as const;

  // Still throttled everywhere: the servers are answering, the token unjudged —
  // soft ok, never a scary state (see toHealth).
  if (jiraFinal.kind === 'throttled' || wikiFinal.kind === 'throttled') {
    return { ok: true, health: 'ok', site: { url: site }, products };
  }
  if (jiraFinal.kind === 'auth' || wikiFinal.kind === 'auth') {
    return {
      ok: false,
      health: 'auth-expired',
      site: { url: site },
      products,
      error: 'Atlassian rejected the credentials — the API token may have expired.',
    };
  }
  const errored = [jiraFinal, wikiFinal].find((o): o is Extract<Outcome, { kind: 'error' }> => o.kind === 'error');
  return {
    ok: false,
    health: 'unreachable',
    site: { url: site },
    products,
    error: errored ? `Atlassian responded ${errored.status}` : `could not reach ${site}`,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
