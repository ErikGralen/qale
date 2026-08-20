import { providerName, type LlmProvider } from '@qale/domain';

/**
 * Does this key work? (docs/onboarding.md ONB-5)
 *
 * The cheapest call each API has, which is a one-item model list and costs no
 * tokens, because the only question is whether the credential is accepted. It
 * lives in main beside the key store so both the opening and Settings can ask,
 * and so a key being checked never crosses into the renderer.
 *
 * A network failure is NOT a bad key, and saying so would send someone hunting
 * through their invite email for a typo that isn't there. The two are separate
 * answers here for exactly that reason.
 */
const VERIFY_TIMEOUT_MS = 12_000;

/** How each provider is asked, and how it carries the key. */
const PROBE: Record<LlmProvider, (key: string) => { url: string; headers: HeadersInit }> = {
  anthropic: (key) => ({
    url: 'https://api.anthropic.com/v1/models?limit=1',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
  }),
  // Google takes the key in the query string, not a header. Fine here: it is a
  // GET to Google's own API over TLS, and the URL is never logged.
  google: (key) => ({
    url: `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(key)}`,
    headers: {},
  }),
};

export async function verifyProviderKey(
  provider: LlmProvider,
  key: string,
): Promise<{ ok: boolean; error?: string }> {
  const trimmed = key.trim();
  if (!trimmed) return { ok: false, error: 'Paste your key first.' };
  const name = providerName(provider);
  const { url, headers } = PROBE[provider](trimmed);

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), VERIFY_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: abort.signal });
    if (res.ok) return { ok: true };
    // Google answers a bad key with 400 INVALID_ARGUMENT, Anthropic with 401.
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      return { ok: false, error: 'That key didn’t work. Check you copied all of it.' };
    }
    if (res.status === 429) {
      // The key is fine; the account is over its limit. Let them past: a rate
      // limit at this moment says nothing about the next hour.
      return { ok: true };
    }
    return { ok: false, error: `${name} answered ${res.status}. The key may still be fine.` };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      error: aborted
        ? 'That took too long. Check your connection and try again.'
        : `Couldn’t reach ${name} to check. Your connection may be down.`,
    };
  } finally {
    clearTimeout(timer);
  }
}
