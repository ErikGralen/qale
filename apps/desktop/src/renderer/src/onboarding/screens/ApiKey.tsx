import { useState } from 'react';
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
  Spinner,
  cn,
} from '@qale/ui';
import { Check, ChevronRight } from 'lucide-react';
import { LLM_PROVIDERS, LLM_PROVIDER_INFO, type LlmProvider } from '@qale/domain';
import { invoke } from '../../lib/ipc';
import { useApp } from '../../state/app-state';
import { Screen, SkipLink } from '../Opening';

/**
 * Screen 4 (ONB-5). Whose model answers, and the key that reaches it.
 *
 * Two questions on one screen because they are one decision: the choice IS
 * which key you already hold. Splitting them would make a screen whose only
 * content is two words, and then a second screen that cannot explain itself
 * without repeating the first.
 *
 * The key is checked before it is saved, and that check is the whole point of
 * this screen existing separately from Settings: a mistyped key that saves
 * quietly fails twenty minutes later, inside a session, as "the agent didn't
 * work", and nobody connects that back to a paste from setup. One cheap call
 * here turns it into an inline line next to the field.
 *
 * A verify that cannot reach the provider is NOT a bad key, and main keeps the
 * two answers apart; a network failure lets the key through with what it said.
 */
export function ApiKey({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const { refreshSettings, settings } = useApp();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  /**
   * Coming back to a key that is already in: the field would be empty (we never
   * read a stored key back out), and an empty field on a screen you have
   * finished reads as "it lost your key". So it says what it has, and asking
   * for the box again is a deliberate click.
   */
  const [replacing, setReplacing] = useState(false);

  const provider = settings?.provider ?? 'anthropic';
  const info = LLM_PROVIDER_INFO[provider];
  // `saved` holds this false through the tick: refreshSettings has already made
  // the key true, and the settled card must not replace the confirmation the
  // moment it appears.
  const stored = !saved && !replacing && (settings?.storedKeys[provider] ?? false);

  const pick = async (next: LlmProvider) => {
    if (next === provider || busy) return;
    setError(null);
    setReplacing(false);
    setKey('');
    await invoke['settings:setProvider'](next);
    await refreshSettings();
  };

  const save = async () => {
    const value = key.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      const check = await invoke['settings:verifyProviderKey'](provider, value);
      if (!check.ok) {
        setError(check.error ?? 'That key didn’t work.');
        return;
      }
      await invoke['settings:setProviderKey'](provider, value);
      await refreshSettings();
      setSaved(true);
      // Let the tick land before the screen changes under them.
      window.setTimeout(onNext, 700);
    } catch {
      setError('Couldn’t save that key. Try again, or add it later in Settings.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title={stored ? 'Your key' : 'Bring your own key'}
      why="Pick whose model answers, then paste the key. It stays on this computer, encrypted and tied to your login, and is never written into your workspace."
      footer={
        stored ? (
          <>
            <Button data-opening-primary size="lg" onClick={onNext}>
              Continue
            </Button>
            <SkipLink onClick={() => setReplacing(true)}>Use a different key</SkipLink>
          </>
        ) : (
          <>
            <Button
              data-opening-primary
              size="lg"
              disabled={busy || !key.trim() || saved}
              onClick={() => void save()}
            >
              {busy ? (
                <>
                  <Spinner className="size-4" /> Checking…
                </>
              ) : saved ? (
                <>
                  <Check className="size-4" aria-hidden /> That works
                </>
              ) : (
                'Continue'
              )}
            </Button>
            {!saved && <SkipLink onClick={onSkip}>Add it later</SkipLink>}
          </>
        )
      }
    >
      <div className="space-y-4">
        {/* The choice first, because it decides what the field below means.
            Two cards rather than a dropdown: there are two, and a dropdown
            would hide one of them behind a click. */}
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Model provider">
          {LLM_PROVIDERS.map((id) => {
            const option = LLM_PROVIDER_INFO[id];
            const on = id === provider;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => void pick(id)}
                className={`rounded-xl border p-4 text-left transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none ${
                  on ? 'border-brand bg-brand/8' : 'border-border bg-card hover:bg-accent'
                }`}
              >
                <span className="flex items-center gap-1.5 font-medium">
                  {option.family}
                  {on && <Check className="size-4 text-brand" aria-hidden />}
                </span>
                <span className="mt-0.5 block text-sm text-muted-foreground">
                  From {option.name}. Best is {option.models[0]!.label}.
                </span>
              </button>
            );
          })}
        </div>

        {stored ? (
          <p className="flex items-center gap-2 rounded-xl bg-card p-4 text-sm ring-1 ring-border">
            <Check className="size-4 shrink-0 text-success" aria-hidden />
            Your {info.name} key is saved on this computer.
          </p>
        ) : (
          <div className="space-y-2">
            <Input
              type="password"
              value={key}
              autoFocus
              spellCheck={false}
              placeholder={info.keyPlaceholder}
              aria-label={`${info.name} API key`}
              onChange={(e) => {
                setKey(e.target.value);
                setError(null);
              }}
            />
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Get one at{' '}
                <a
                  href={info.keyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded font-medium underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  {new URL(info.keyUrl).host}
                </a>
                . We make a quick check of the key here.
              </p>
            )}
            <KeyExplainer />
          </div>
        )}

        {/* The other half of "it stays on this computer" (OW10). The key stays;
            what the key does is send notes out. This is the screen where that
            is least surprising to read, so it is the screen that says it. */}
        <p className="text-sm text-muted-foreground">
          The key is how the agent reaches {info.name}. When it works, the notes it reads go there
          to get an answer back.
        </p>
      </div>
    </Screen>
  );
}

/**
 * What an API key even is, folded away (clarity review area 4). The screen
 * assumed everyone had held one; a first-timer is about to be sent through
 * account creation and billing on an unfamiliar site with no warning. Three
 * lines answer the questions they actually have, and stay provider-agnostic
 * on purpose: we recommend neither seller.
 */
function KeyExplainer() {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1 rounded text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none">
        <ChevronRight
          className={cn(
            'size-3.5 transition-transform motion-reduce:transition-none',
            open && 'rotate-90',
          )}
          aria-hidden
        />
        What is an API key?
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 space-y-2 rounded-xl bg-card p-4 text-sm text-muted-foreground ring-1 ring-border">
          <p>A pass to an AI service that the app uses on your behalf. It is not a password.</p>
          <p>
            To get one, you make an account at the link above and add a payment method. You pay the
            provider for what the app uses, not a subscription. Normal use costs a few dollars a
            month; heavy use costs more.
          </p>
          <p>
            If your company already has an account with the provider, ask whoever runs it for a key
            instead.
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
