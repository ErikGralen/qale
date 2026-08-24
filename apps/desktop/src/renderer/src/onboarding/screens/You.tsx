import { useState } from 'react';
import { Button, Input } from '@qale/ui';
import { invoke } from '../../lib/ipc';
import { useApp } from '../../state/app-state';
import { Screen } from '../Opening';

/**
 * Screen 2 (ONB-3). Name and work email, into the identity the rest of the app
 * already reads — the same two fields Settings → You edits.
 *
 * Not skippable, but both fields may be left empty: an empty submit is a
 * deliberate "rather not say", and the app falls back to calling you "You".
 * What it cannot do without the email is tell your own promises from everyone
 * else's, which is what the line under the fields says.
 *
 * Come back to it and the fields hold what was saved, so this is where a typo
 * in your own address gets fixed. Which is also why the write always names the
 * address list: clearing the field has to clear it, or a wrong one could never
 * be taken back out from here.
 */
export function You({ onNext }: { onNext: () => void }) {
  const { refreshSettings, settings } = useApp();
  const identity = settings?.identity;
  const [name, setName] = useState(identity?.name ?? '');
  const [email, setEmail] = useState(identity?.aliases[0] ?? '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const address = email.trim().toLowerCase();
      await invoke['settings:setIdentity']({
        name: name.trim() || null,
        aliases: address ? [address] : [],
      });
      await refreshSettings();
    } catch {
      // Never a dead end: a settings write that fails must not strand someone
      // on screen two of seven. The same fields wait in Settings.
    } finally {
      setBusy(false);
      onNext();
    }
  };

  return (
    <Screen
      title="Who are you?"
      why="Meetings arrive with a list of addresses. This is how the memory knows which one is you, and which promises in a transcript are yours to keep."
      footer={
        <Button data-opening-primary size="lg" disabled={busy} onClick={() => void save()}>
          Continue
        </Button>
      }
    >
      <div className="space-y-3">
        <label className="block space-y-1.5">
          <span className="text-dense font-medium text-muted-foreground">Your name</span>
          <Input
            value={name}
            autoFocus
            // No sample name here: a stranger's name in the field is the first
            // thing they read, and the label already says what goes in it.
            placeholder="Shown as “You” until you set it"
            autoComplete="name"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-dense font-medium text-muted-foreground">Your work email</span>
          <Input
            type="email"
            value={email}
            placeholder="you@company.com"
            autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
          />
          <span className="block text-xs text-muted-foreground">
            Any other addresses you get invites at can go in Settings later. Connecting a calendar
            adds its own.
          </span>
        </label>
        {/* The empty submit is designed in (a deliberate "rather not say"), but
            nothing on the screen said so — the polite reader felt forced and
            the suspicious one stalled (clarity review area 2). */}
        <p className="text-sm text-muted-foreground">
          Both are optional. Nothing here is sent anywhere; it stays in your settings.
        </p>
      </div>
    </Screen>
  );
}
