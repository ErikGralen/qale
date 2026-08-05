import { useCallback, useEffect, useState } from 'react';
import { Button, Input, Spinner } from '@qale/ui';
import { BookOpen, CalendarDays, Check, Ticket } from 'lucide-react';
import {
  connections,
  type AuthFieldDTO,
  type ConnectionDTO,
  type ProviderDescriptorDTO,
} from '../../lib/connections';
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

  return (
    <Screen
      title="What may it read?"
      why="The memory is only as good as the material it can see, and most of yours already lives in these. Connect what you want now, or later in Settings."
      footer={
        // One button, labelled honestly. With nothing followed this screen IS
        // a skip, and dressing it as "Continue" beside a second "Skip" link
        // would be two ways past the same door.
        <Button
          data-opening-primary
          size="lg"
          variant={followedSomething ? 'default' : 'outline'}
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
            />
          ))
        )}
        {/* The sentence that decides whether anyone connects at all. */}
        <p className="pt-1 text-sm text-muted-foreground">
          Reading only. Nothing is ever written back to a ticket, a page or your calendar without
          you approving that exact change first.
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
 */
function ProviderRow({
  provider,
  connections: conns,
  onChanged,
  onSkip,
}: {
  provider: ProviderDescriptorDTO;
  connections: ConnectionDTO[];
  onChanged: () => Promise<void>;
  onSkip: () => void;
}) {
  const oauth = provider.authKind === 'oauth';
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connected = conns.length > 0;
  const ready = oauth || provider.fields.every((f) => values[f.key]?.trim());

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await connections.connect(provider.id, values);
      if (res.ok) {
        setValues({});
        setOpen(false);
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
            {connected
              ? conns.map((c) => c.identity ?? c.siteLabel).join(', ')
              : provider.id === 'google-calendar'
                ? 'Your meetings arrive as notes by themselves'
                : 'Tickets and pages you link stay current'}
          </div>
        </div>
        {connected ? (
          <span className="flex shrink-0 items-center gap-1 text-xs text-success">
            <Check className="size-3.5" aria-hidden /> Connected
          </span>
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

      {conns.map((conn) => (
        <FollowList key={conn.id} conn={conn} onChanged={onChanged} />
      ))}
    </div>
  );
}

/**
 * The second question, asked in place: which of these should it watch?
 *
 * Nothing is preselected. A PM with forty Jira projects would not thank us for
 * a helpful "all", and the sync it would kick off is real work against their
 * account. One tick is enough to move on, and Settings holds the same list, so
 * a hasty answer here costs nothing to change.
 */
function FollowList({ conn, onChanged }: { conn: ConnectionDTO; onChanged: () => Promise<void> }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  if (conn.containers.length === 0) return null;

  const toggle = async (id: string, followed: boolean) => {
    setBusyId(id);
    try {
      await connections.setFollow(conn.id, id, followed);
      await onChanged();
    } finally {
      setBusyId(null);
    }
  };

  const followed = conn.containers.filter((c) => c.followed).length;

  return (
    <div className="mt-3 border-t border-border/60 pt-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-dense font-medium text-muted-foreground">
          Which of these should it watch?
        </span>
        {followed === 0 && (
          // Said plainly rather than left as a green tick with nothing behind
          // it: connected and following nothing reads nothing at all.
          <span className="text-xs text-muted-foreground">Pick at least one</span>
        )}
      </div>
      <ul className="mt-1.5 flex max-h-52 flex-col overflow-y-auto">
        {conn.containers.map((c) => (
          <li key={c.id}>
            <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-accent/60">
              <input
                type="checkbox"
                checked={c.followed}
                disabled={busyId === c.id}
                onChange={() => void toggle(c.id, !c.followed)}
              />
              {c.kind === 'ticket' ? (
                <Ticket className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              ) : c.kind === 'calendar' ? (
                <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              ) : (
                <BookOpen className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <span className="min-w-0 flex-1 truncate text-sm">{c.name}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
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
