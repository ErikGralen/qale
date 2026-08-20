import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input, Spinner } from '@qale/ui';
import { CalendarDays, Check, Ticket } from 'lucide-react';
import {
  connections,
  type AuthFieldDTO,
  type ConnectionDTO,
  type ProviderDescriptorDTO,
} from '../../lib/connections';
import { FollowPicker } from '../../components/FollowPicker';
import { useApp } from '../../state/app-state';
import { Screen, SkipLink } from '../Opening';

/**
 * Screen 5 (ONB-11). What the memory may read: Jira + Confluence, and Google
 * Calendar.
 *
 * This screen exists because connections were the most buried thing in the
 * app, and a memory with nothing to read is the most common shape of a
 * disappointing first week. It is a first-run frame over the machinery
 * Settings → Connections already uses — the same provider descriptors, the
 * same `connections` client, the same verify — with the settings chrome
 * stripped and one thing added: the follow question, asked in the same breath
 * as the connect.
 *
 * That second question is not a detail. Nothing is followed by default, so a
 * connection with no projects, spaces or calendars picked reads absolutely
 * nothing. Connecting is not the finish line, and a screen that stopped at
 * "connected" would be quietly lying about what just happened.
 */
export function Connections({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const { patchOnboarding, refreshSettings } = useApp();
  const [providers, setProviders] = useState<ProviderDescriptorDTO[]>([]);
  const [conns, setConns] = useState<ConnectionDTO[]>([]);
  const [loading, setLoading] = useState(true);
  // Which providers still have their "what should it watch?" list open. The
  // footer needs to know: an open list is an unfinished one, and Continue
  // sitting there lit up is how you walk past the connection you meant to set
  // up next.
  const [picking, setPicking] = useState<Record<string, boolean>>({});

  const reload = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([connections.providers(), connections.list()]);
      setProviders(p);
      setConns(c);
    } catch {
      // A read that fails is not "nothing connected"; leave what we have and
      // let the skip carry them past. This screen never blocks the flow.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** A skip is per provider, so First steps can ask about one without the other. */
  const skipProvider = (providerId: string) => {
    void patchOnboarding({ skipped: `connections:${providerId}` });
  };

  const followedSomething = conns.some((c) => c.containers.some((k) => k.followed));
  const midPick = Object.values(picking).some(Boolean);

  return (
    <Screen
      title="What may it read?"
      why="The memory is only as good as the material it can see, and most of yours already lives in these. Connect what you want now, or later in Settings."
      footer={
        // One button, labelled honestly. With nothing followed this screen IS
        // a skip, and dressing it as "Continue" beside a second "Skip" link
        // would be two ways past the same door.
        //
        // While a list is open the card's own Done is the next step, so
        // Continue steps back. "Not now" never does — that is the way out of
        // any half-finished state, including this one.
        <Button
          data-opening-primary
          size="lg"
          variant={followedSomething ? 'default' : 'outline'}
          disabled={followedSomething && midPick}
          onClick={followedSomething ? onNext : onSkip}
        >
          {followedSomething ? 'Continue' : 'Not now'}
        </Button>
      }
    >
      <div className="space-y-2">
        {loading ? (
          <div className="h-24" />
        ) : (
          providers.map((provider) => (
            <ProviderRow
              key={provider.id}
              provider={provider}
              connections={conns.filter((c) => c.providerId === provider.id)}
              onChanged={async () => {
                await reload();
                // A Google connect also yields an address that means "you" —
                // the identity from screen 2 picks it up through selfEmails.
                await refreshSettings();
              }}
              onSkip={() => skipProvider(provider.id)}
              onPicking={(open) => setPicking((prev) => ({ ...prev, [provider.id]: open }))}
            />
          ))
        )}
        {/* The sentence that decides whether anyone connects at all, and the
            thing it does not promise (OW10). "Reading only" is about writes;
            it says nothing about where what was read then goes. */}
        <p className="pt-1 text-sm text-muted-foreground">
          Reading only. Nothing is ever written back to a ticket, a page or your calendar without
          you approving that exact change first. What it reads becomes notes in your workspace, and
          from there it can go to your model provider with the rest when the agent works.
        </p>
      </div>
    </Screen>
  );
}

/**
 * One provider: connect it, then pick what it watches. The two halves are one
 * row on purpose — the follow choice belongs to the same moment as the connect,
 * and a screen that sent people to Settings for the second half would lose most
 * of them between the two.
 *
 * The card has a finish, though. Connecting opens the watch list; Done closes
 * it and the card settles back into one line saying what it now watches. Left
 * permanently open, a finished connection reads as an unfinished one, and the
 * only forward-looking button on screen belongs to the whole screen rather
 * than to the thing you were in the middle of.
 */
function ProviderRow({
  provider,
  connections: conns,
  onChanged,
  onSkip,
  onPicking,
}: {
  provider: ProviderDescriptorDTO;
  connections: ConnectionDTO[];
  onChanged: () => Promise<void>;
  onSkip: () => void;
  onPicking: (open: boolean) => void;
}) {
  const oauth = provider.authKind === 'oauth';
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connected = conns.length > 0;
  const ready = oauth || provider.fields.every((f) => values[f.key]?.trim());
  const followedNames = conns.flatMap((c) =>
    c.containers.filter((k) => k.followed).map((k) => k.name),
  );
  const hasContainers = conns.some((c) => c.containers.length > 0);

  // Open on arrival only for a connection left with nothing followed — coming
  // back to a card that reads nothing, the unanswered question is the point.
  const [picking, setPicking] = useState(
    () => connected && hasContainers && followedNames.length === 0,
  );
  const showPicker = picking && connected && hasContainers;
  // Through a ref: the parent hands us a fresh closure every render, and a
  // plain dependency on it would report the same state back on every one.
  const report = useRef(onPicking);
  report.current = onPicking;
  useEffect(() => report.current(showPicker), [showPicker]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await connections.connect(provider.id, values);
      if (res.ok) {
        setValues({});
        setOpen(false);
        setPicking(true);
        await onChanged();
      } else {
        // Inline, and the skip stays right there: a provider that will not
        // verify must never trap anyone on screen five of seven.
        setError(res.error ?? 'Couldn’t verify those details. Check them and try again.');
      }
    } catch {
      setError('Couldn’t reach it just now. You can connect this later in Settings.');
    } finally {
      setBusy(false);
    }
  };

  /** Giving up on the browser tab: stop waiting, and record the skip. */
  const abandon = () => {
    void connections.cancelOAuth();
    setBusy(false);
    onSkip();
  };

  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-border">
      <div className="flex items-center gap-3">
        <ProviderIcon id={provider.id} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{provider.label}</div>
          <div className="text-sm text-balance text-muted-foreground">
            {!connected
              ? provider.id === 'google-calendar'
                ? 'Your meetings arrive as notes by themselves'
                : 'Tickets and pages you link stay current'
              : showPicker || !hasContainers
                ? conns.map((c) => c.identity ?? c.siteLabel).join(', ')
                : // Settled: say what it watches, not who you signed in as.
                  // A green tick over nothing is the lie this screen exists
                  // to avoid telling.
                  watchLine(followedNames)}
          </div>
        </div>
        {connected ? (
          <div className="flex shrink-0 items-center gap-3">
            <span className="flex items-center gap-1 text-xs text-success">
              <Check className="size-3.5" aria-hidden /> Connected
            </span>
            {hasContainers && !showPicker && (
              <Button size="sm" variant="ghost" onClick={() => setPicking(true)}>
                Change
              </Button>
            )}
          </div>
        ) : open && !oauth ? null : (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            disabled={busy}
            onClick={() => (oauth ? void submit() : setOpen(true))}
          >
            {busy ? (
              <>
                <Spinner className="size-3.5" /> Waiting for the browser…
              </>
            ) : (
              'Connect'
            )}
          </Button>
        )}
        {oauth && busy && <SkipLink onClick={abandon}>Stop waiting</SkipLink>}
      </div>

      {open && !connected && !oauth && (
        <div className="mt-3 flex flex-col gap-2">
          {provider.fields.map((f) => (
            <AuthField
              key={f.key}
              field={f}
              value={values[f.key] ?? ''}
              onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
              onEnter={() => ready && !busy && void submit()}
            />
          ))}
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={busy || !ready} onClick={() => void submit()}>
              {busy ? (
                <>
                  <Spinner className="size-3.5" /> Checking…
                </>
              ) : (
                'Connect'
              )}
            </Button>
            <SkipLink
              onClick={() => {
                setOpen(false);
                onSkip();
              }}
            >
              Not this one
            </SkipLink>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      {showPicker &&
        conns.map((conn) => (
          /* The recommendation card owns its own confirm: ticking is not
             following, and the writes happen in one deliberate gesture. It is
             always live, even with nothing ticked — someone who wants nothing
             watched yet must be able to close this, and the card above says so
             plainly once they do. */
          <FollowPicker
            key={conn.id}
            conn={conn}
            onChanged={onChanged}
            onDone={() => setPicking(false)}
          />
        ))}
    </div>
  );
}

/** "Watching Qale" — two names, then a count, so the line stays one line. */
function watchLine(names: string[]): string {
  if (names.length === 0) return 'Connected, watching nothing yet';
  if (names.length <= 2) return `Watching ${names.join(' and ')}`;
  return `Watching ${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
}

function ProviderIcon({ id }: { id: string }) {
  const Icon = id === 'google-calendar' ? CalendarDays : Ticket;
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent">
      <Icon className="size-4 text-muted-foreground" aria-hidden />
    </span>
  );
}

function AuthField({
  field,
  value,
  onChange,
  onEnter,
}: {
  field: AuthFieldDTO;
  value: string;
  onChange: (v: string) => void;
  onEnter: () => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <Input
        type={field.secret ? 'password' : 'text'}
        value={value}
        placeholder={field.placeholder ?? field.label}
        aria-label={field.label}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            // The frame's global Enter would fire the screen's Continue and
            // walk past a half-filled form; this field owns the key instead.
            e.stopPropagation();
            onEnter();
          }
        }}
      />
      {field.hint && <p className="px-1 text-xs text-muted-foreground">{field.hint}</p>}
    </div>
  );
}
