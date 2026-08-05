/**
 * Does this Anthropic key work? (docs/onboarding.md ONB-5)
 *
 * The cheapest call the API has — a one-item model list, which costs no tokens
 * — because the only question is whether the credential is accepted. It lives
 * in main beside the key store so both the opening and Settings can ask, and so
 * a key being checked never crosses into the renderer.
 *
 * A network failure is NOT a bad key, and saying so would send someone hunting
 * through their invite email for a typo that isn't there. The two are separate
 * answers here for exactly that reason.
 */
const VERIFY_URL = 'https://api.anthropic.com/v1/models?limit=1';
const VERIFY_TIMEOUT_MS = 12_000;

export async function verifyAnthropicKey(key: string): Promise<{ ok: boolean; error?: string }> {
  const trimmed = key.trim();
  if (!trimmed) return { ok: false, error: 'Paste the key from your invite first.' };

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), VERIFY_TIMEOUT_MS);
  try {
    const res = await fetch(VERIFY_URL, {
      headers: { 'x-api-key': trimmed, 'anthropic-version': '2023-06-01' },
      signal: abort.signal,
    });
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'That key didn’t work. Check you copied all of it.' };
    }
    if (res.status === 429) {
      // The key is fine; the account is over its limit. Let them past — a rate
      // limit at this moment says nothing about the next hour.
      return { ok: true };
    }
    return { ok: false, error: `Anthropic answered ${res.status}. The key may still be fine.` };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      error: aborted
        ? 'That took too long. Check your connection and try again.'
        : 'Couldn’t reach Anthropic to check. Your connection may be down.',
    };
  } finally {
    clearTimeout(timer);
  }
}
