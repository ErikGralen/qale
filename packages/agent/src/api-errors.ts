/**
 * What the PM reads when the model provider says no, and whether it is theirs
 * to fix.
 *
 * The raw thing is an HTTP status followed by a JSON body:
 * `400 {"type":"error","error":{"type":"invalid_request_error","message":"Your
 * credit balance is too low…"}}`. Putting that on screen tells somebody who did
 * not build this app nothing about what to do next, and the two failures that
 * actually happen in the wild (an empty account, a bad key) both have exactly
 * one fix each. So the handful we can recognise get said in a sentence, and
 * everything else falls back to the provider's own message with the envelope
 * peeled off.
 *
 * `blocking` is the other half, and it is what decides whether the app is
 * allowed to interrupt. An empty account and a rejected key stop EVERY session
 * until somebody goes and does something, including the ones nobody is watching:
 * the 3am tidy, the brief before a 9am meeting. Being overloaded or rate limited
 * looks identical from here and is the opposite kind of thing, because the fix
 * is to wait. Only the first kind earns a notification.
 *
 * Two providers now, and this reads the provider off the refusal rather than
 * being told. Anthropic and Google word the same four failures differently
 * enough to tell apart ("invalid x-api-key" against "API key not valid",
 * "credit balance" against "RESOURCE_EXHAUSTED"), and a sentence that sends
 * somebody to the wrong billing page is worse than one that names no page at
 * all. Nothing has to be threaded through the bridge, the history and the
 * runtime to get it right.
 */

export interface ProviderFault {
  /** One sentence: what happened, and what to do about it. */
  text: string;
  /** The fix is the PM's, and nothing gets through until they make it. */
  blocking: boolean;
}

/** The provider's `error.message`, or the raw string when it isn't one of those. */
function providerMessage(raw: string): string {
  const brace = raw.indexOf('{');
  if (brace >= 0) {
    try {
      const body = JSON.parse(raw.slice(brace)) as {
        error?: { message?: string };
        message?: string;
      };
      const message = body.error?.message ?? body.message;
      if (message) return message;
    } catch {
      // Not JSON after all: fall through to the raw text.
    }
  }
  return raw.trim();
}

export function providerFault(raw: string): ProviderFault {
  const message = providerMessage(raw ?? '');
  if (!message) {
    return {
      text: 'The model provider refused the request and said nothing about why.',
      blocking: false,
    };
  }
  const low = message.toLowerCase();

  // Out of money. Anthropic says so in prose; Google says the project has no
  // billing account, or that a free-tier quota is spent for good.
  if (low.includes('credit balance')) {
    return {
      text: 'Anthropic turned the request down: this account is out of credit. Top it up at console.anthropic.com (Plans & Billing), and everything that has been waiting will run again.',
      blocking: true,
    };
  }
  if (low.includes('billing_not_active') || (low.includes('billing') && low.includes('project'))) {
    return {
      text: 'Google turned the request down: this project has no active billing. Turn it on at aistudio.google.com, and everything that has been waiting will run again.',
      blocking: true,
    };
  }

  // A key the provider will not accept. Both of them stop everything until it
  // is fixed, and the fix is the same field in Settings either way.
  if (low.includes('invalid x-api-key') || low.includes('authentication_error')) {
    return {
      text: 'Anthropic did not accept the API key. Check it in Settings, and sessions will answer again.',
      blocking: true,
    };
  }
  if (
    low.includes('api key not valid') ||
    low.includes('api_key_invalid') ||
    low.includes('permission_denied')
  ) {
    return {
      text: 'Google did not accept the API key. Check it in Settings, and sessions will answer again.',
      blocking: true,
    };
  }
  if (low.includes('invalid api key')) {
    return {
      text: 'The API key was not accepted. Check it in Settings, and sessions will answer again.',
      blocking: true,
    };
  }

  // Too much, too fast. The fix is to wait, so none of these interrupt anybody.
  if (low.includes('rate limit')) {
    return {
      text: 'Anthropic is rate limiting this key. Wait a moment and send your message again.',
      blocking: false,
    };
  }
  if (low.includes('resource_exhausted') || low.includes('quota')) {
    return {
      text: 'Google is rate limiting this key. Wait a moment and send your message again.',
      blocking: false,
    };
  }
  // Google's wording contains Anthropic's, so it has to be asked first:
  // "The model is overloaded" against a bare "Overloaded".
  if (low.includes('model is overloaded') || low.includes('unavailable')) {
    return {
      text: 'Google is overloaded right now. Send your message again in a moment.',
      blocking: false,
    };
  }
  if (low.includes('overloaded')) {
    return {
      text: 'Anthropic is overloaded right now. Send your message again in a moment.',
      blocking: false,
    };
  }
  return { text: message, blocking: false };
}

/** Just the sentence, for the paths that only render it. */
export function apiErrorText(raw: string): string {
  return providerFault(raw).text;
}
