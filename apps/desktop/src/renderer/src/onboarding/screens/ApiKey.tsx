import { useState } from 'react';
import { Button, Input, Spinner } from '@qale/ui';
import { Check } from 'lucide-react';
import { invoke } from '../../lib/ipc';
import { useApp } from '../../state/app-state';
import { Screen, SkipLink } from '../Opening';

/**
 * Screen 4 (ONB-5). The key from the invite, checked before it is saved.
 *
 * The check is the whole point of this screen existing separately from
 * Settings: a mistyped key that saves quietly fails twenty minutes later,
 * inside a session, as "the agent didn't work" — and nobody connects that back
 * to a paste from setup. One cheap call here turns that into an inline line
 * next to the field.
 *
 * A verify that cannot reach Anthropic is NOT a bad key, and main keeps the two
 * answers apart; a network failure lets the key through with what it said.
 */
export function ApiKey({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const { refreshSettings } = useApp();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    const value = key.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      const check = await invoke['settings:verifyAnthropicKey'](value);
      if (!check.ok) {
        setError(check.error ?? 'That key didn’t work.');
        return;
      }
      await invoke['settings:setAnthropicKey'](value);
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
      title="Paste your key"
      why="The key from your invite email. It stays on this computer, locked in its keychain, and is never written into your workspace."
      footer={
        <>
          <Button data-opening-primary size="lg" disabled={busy || !key.trim() || saved} onClick={() => void save()}>
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
      }
    >
      <div className="space-y-2">
        <Input
          type="password"
          value={key}
          autoFocus
          spellCheck={false}
          placeholder="sk-ant-…"
          aria-label="Anthropic API key"
          onChange={(e) => {
            setKey(e.target.value);
            setError(null);
          }}
        />
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            We check it here so a typo fails now, not in the middle of your first meeting.
          </p>
        )}
      </div>
    </Screen>
  );
}
