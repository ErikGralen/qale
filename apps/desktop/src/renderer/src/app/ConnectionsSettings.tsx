import { useEffect, useState } from 'react';
import { Button, Input } from '@qale/ui';
import { BookOpen, CalendarDays, Check, KeyRound, Plus, Ticket } from 'lucide-react';
import { AtlassianTokenHelp } from '../components/AtlassianTokenHelp';
import { FollowPicker } from '../components/FollowPicker';
import { Setting } from '../components/Setting';
import { relativeTime } from '../lib/dates';
import { followReceipt } from '../lib/follow-receipt';
import { siteUrlPreview } from '../lib/site-url';
import { useApp } from '../state/app-state';
import {
  connections,
  type AuthFieldDTO,
  type ConnectionContainerDTO,
  type ConnectionDTO,
  type ProviderDescriptorDTO,
} from '../lib/connections';

/**
 * Settings → Connections: external systems as quiet infrastructure. Connect a
 * provider by pasting credentials (fields rendered from the connector's auth
 * schema — the UI never hardcodes a provider), verify on save with an inline
 * result, then follow the projects/spaces worth watching. Health is a quiet
 * per-container "synced 4h ago" line; an expired token is a calm inline
 * "paste a new one" affordance — never a modal, never an error toast.
 * Multiple connections (and multiple sites of one provider) are first-class.
 */

export function ConnectionsSettings() {
  const [providers, setProviders] = useState<ProviderDescriptorDTO[]>([]);
  const [conns, setConns] = useState<ConnectionDTO[]>([]);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const reload = async () => {
    try {
      const [p, c] = await Promise.all([connections.providers(), connections.list()]);
      setProviders(p);
      setConns(c);
      setLoadFailed(false);
    } catch {
      // An IPC failure is not "nothing connected" — say so quietly instead of
      // showing the connect form over connections that may well exist.
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  return (
    <Setting
      title="Connected systems"
      description="Where your delivery truth lives: tickets and pages from followed projects stay readable here, and anything you link from a note keeps itself up to date. Reading never asks, and writing always goes through a proposal. What comes in becomes notes like any other, so it goes to your model provider with the rest when the agent works."
    >
      {loadFailed ? (
        <p className="text-sm text-muted-foreground">
          Couldn’t load connections.{' '}
          <button
            className="font-medium text-brand hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={() => void reload()}
          >
            Try again
          </button>
        </p>
      ) : loading ? null : (
        // First paint waits for list() — never flash the connect form at
        // someone who is already connected.
        <>
          {conns.map((conn) => (
            <ConnectionCard key={conn.id} conn={conn} providers={providers} onChanged={reload} />
          ))}

          {adding || conns.length === 0 ? (
            <ConnectForm
              providers={providers}
              onDone={() => {
                setAdding(false);
                void reload();
              }}
              onCancel={conns.length > 0 ? () => setAdding(false) : undefined}
            />
          ) : (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus className="size-3.5" /> Add a connection
            </Button>
          )}
        </>
      )}
    </Setting>
  );
}

/** Quiet health words for a container row — never jargon, never an error. */
function containerHealth(c: ConnectionContainerDTO, connHealth: ConnectionDTO['health']): string {
  if (!c.followed) return '';
  if (c.lastSync === null) return 'first sync pending';
  const synced = `synced ${relativeTime(c.lastSync)}`;
  return connHealth === 'ok' ? synced : `showing local data · ${synced}`;
}

/** One connection can bundle two systems (Jira + Confluence): a container's
 *  `kind` says which. Named for what a person picks from, not the storage
 *  word ("wikipage"). */
const KIND_GROUP_LABEL: Record<ConnectionContainerDTO['kind'], string> = {
  ticket: 'Jira projects',
  wikipage: 'Confluence spaces',
  calendar: 'Calendars',
};

function ConnectionCard({
  conn,
  providers,
  onChanged,
}: {
  conn: ConnectionDTO;
  providers: ProviderDescriptorDTO[];
  onChanged: () => Promise<void>;
}) {
  const { settings, openHome } = useApp();
  const provider = providers.find((p) => p.id === conn.providerId);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busyContainer, setBusyContainer] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  /**
   * A connection reading nothing is an unfinished connection, so it opens on
   * the same recommendation card the opening uses (FL-2) rather than on a flat
   * list of everything on the site. Once something is followed this settles
   * back into the per-row toggles, which is the right surface for maintenance:
   * one box, one immediate effect, no confirm to hunt for.
   */
  const [picking, setPicking] = useState(
    () => conn.containers.length > 0 && !conn.containers.some((c) => c.followed),
  );
  /**
   * The closing beat for this visit (docs/closing-beat.md). The confirm used to
   * leave somebody sitting in Settings with a row of toggles and no word about
   * what had started. The receipt says what is running; the door beside it goes
   * back to Home, which is where the debrief knocks. It lives here rather than
   * in the picker because the confirm is what collapses the picker.
   */
  const [receipt, setReceipt] = useState<string | null>(null);

  const toggleFollow = async (c: ConnectionContainerDTO) => {
    setBusyContainer(c.id);
    try {
      await connections.setFollow(conn.id, c.id, !c.followed);
      await onChanged();
    } finally {
      setBusyContainer(null);
    }
  };

  // A manual pull for the impatient moment before a meeting; the scheduler
  // keeps its own rhythm either way.
  const syncNow = async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await connections.syncNow();
      if (!res.ok) setSyncError(res.error ?? 'Couldn’t sync just now. Local data stays available.');
      await onChanged();
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-sm font-medium">{conn.providerLabel}</span>
        <span className="text-sm text-muted-foreground">{conn.siteLabel}</span>
        {conn.identity && <span className="text-xs text-muted-foreground">as {conn.identity}</span>}
        <span className="ml-auto flex items-baseline gap-2 text-xs text-muted-foreground tabular-nums">
          {conn.health === 'ok' &&
            conn.lastSync !== null &&
            `synced ${relativeTime(conn.lastSync)}`}
          {conn.health === 'unreachable' && 'offline, showing local data'}
          {conn.health !== 'auth-expired' && (
            <button
              className="rounded font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              onClick={() => void syncNow()}
              disabled={syncing}
            >
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          )}
        </span>
      </div>
      {syncError && <p className="mt-1 text-xs text-muted-foreground">{syncError}</p>}

      {conn.health === 'auth-expired' && provider && (
        <TokenRenewal conn={conn} provider={provider} onChanged={onChanged} />
      )}

      {picking ? (
        <FollowPicker
          conn={conn}
          onChanged={onChanged}
          onDone={(outcome) => {
            setPicking(false);
            setReceipt(followReceipt(outcome, settings?.hasApiKey ?? false));
          }}
        />
      ) : (
        <>
          {receipt && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-3">
              <p className="text-sm text-muted-foreground">{receipt}</p>
              <button
                className="rounded px-1.5 py-0.5 text-sm font-medium text-brand transition-colors hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                onClick={() => openHome()}
              >
                Back to Home
              </button>
            </div>
          )}
          <ContainerGroups conn={conn} busyContainer={busyContainer} onToggle={toggleFollow} />
        </>
      )}
      {conn.providerId === 'google-calendar' ? (
        <p className="mt-1.5 text-xs text-muted-foreground">
          Meetings on followed calendars appear as meeting notes by themselves: dates, people and
          series stay true to the calendar; your notes on them stay yours.
        </p>
      ) : (
        <p className="mt-1.5 text-xs text-muted-foreground">
          Followed projects feed <code className="font-mono">[[</code> linking and status chips.
          Anything you link from a note is watched closely, wherever it lives.
        </p>
      )}

      <div className="mt-2 flex items-center justify-end gap-2">
        {!picking && conn.containers.length > 0 && (
          <button
            className="mr-auto rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={() => {
              setReceipt(null);
              setPicking(true);
            }}
          >
            Change what it reads
          </button>
        )}
        {confirmRemove ? (
          <>
            <span className="text-xs text-destructive">
              Disconnect {conn.siteLabel}?{' '}
              {conn.providerId === 'google-calendar'
                ? 'Meeting notes stay in your workspace.'
                : 'Linked tickets keep their last-known state.'}
            </span>
            <Button
              size="sm"
              variant="destructive"
              disabled={removing}
              onClick={async () => {
                setRemoving(true);
                try {
                  await connections.disconnect(conn.id);
                  await onChanged();
                } finally {
                  setRemoving(false);
                }
              }}
            >
              {removing ? 'Disconnecting…' : 'Disconnect'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmRemove(false)}
              disabled={removing}
            >
              Cancel
            </Button>
          </>
        ) : (
          <button
            className="rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={() => setConfirmRemove(true)}
          >
            Disconnect…
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * A connection's containers, split by kind. "Jira + Confluence" is one
 * connection with two systems inside it, so a flat list reads as one pile —
 * the kind icon alone was not enough to tell a project from a space at a
 * glance. A labelled group per kind is; a connection with only one kind
 * (Google Calendar) skips the label, since there is nothing to tell apart.
 */
function ContainerGroups({
  conn,
  busyContainer,
  onToggle,
}: {
  conn: ConnectionDTO;
  busyContainer: string | null;
  onToggle: (c: ConnectionContainerDTO) => void;
}) {
  const kinds = Array.from(new Set(conn.containers.map((c) => c.kind)));
  const labelled = kinds.length > 1;

  return (
    <div className="mt-2 flex flex-col gap-2.5">
      {kinds.map((kind) => (
        <div key={kind}>
          {labelled && (
            <div className="flex items-center gap-1.5 px-0.5 pb-1 text-2xs font-semibold tracking-wide text-muted-foreground/70 uppercase">
              <KindIcon kind={kind} />
              {KIND_GROUP_LABEL[kind]}
            </div>
          )}
          <ul className="flex flex-col divide-y divide-border/60">
            {conn.containers
              .filter((c) => c.kind === kind)
              .map((c) => (
                <li key={c.id} className="flex items-center gap-2.5 py-1.5">
                  {!labelled && <KindIcon kind={c.kind} />}
                  <span className="min-w-0 flex-1 truncate text-sm">{c.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {containerHealth(c, conn.health)}
                  </span>
                  <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={c.followed}
                      disabled={busyContainer === c.id}
                      onChange={() => onToggle(c)}
                      aria-label={`Follow ${c.name}`}
                    />
                    Follow
                  </label>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function KindIcon({ kind }: { kind: ConnectionContainerDTO['kind'] }) {
  const Icon = kind === 'ticket' ? Ticket : kind === 'calendar' ? CalendarDays : BookOpen;
  return <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />;
}

/**
 * The calm expired-token path: one inline row on the connection card. The
 * mirror keeps serving local data meanwhile — this is maintenance, not a fire.
 */
function TokenRenewal({
  conn,
  provider,
  onChanged,
}: {
  conn: ConnectionDTO;
  provider: ProviderDescriptorDTO;
  onChanged: () => Promise<void>;
}) {
  const oauth = provider.authKind === 'oauth';
  const fields = provider.fields.filter((f) => provider.renewFieldKeys.includes(f.key));
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Enter and the Update button obey the same guard — no empty submits.
  const ready = !busy && fields.every((f) => values[f.key]?.trim());

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await connections.renewAuth(conn.id, values);
      if (res.ok) {
        setValues({});
        await onChanged();
      } else {
        setError(res.error ?? 'That token didn’t verify. Check it and try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 rounded-md bg-warning/10 px-3 py-2">
      <p className="flex items-center gap-1.5 text-sm text-warning">
        <KeyRound className="size-3.5 shrink-0" aria-hidden />
        {oauth
          ? `The ${provider.label} connection expired. Reconnect to resume syncing. Everything keeps working from local data meanwhile.`
          : `The token for ${conn.siteLabel} expired. Paste a new one to resume syncing. Everything keeps working from local data meanwhile.`}
      </p>
      <div className="mt-1.5 flex gap-2">
        {fields.map((f) => (
          <Input
            key={f.key}
            type={f.secret ? 'password' : 'text'}
            value={values[f.key] ?? ''}
            placeholder={f.placeholder ?? f.label}
            aria-label={f.label}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && ready && void submit()}
          />
        ))}
        <Button size="sm" onClick={() => void submit()} disabled={oauth ? busy : !ready}>
          {busy
            ? oauth
              ? 'Waiting for the browser…'
              : 'Checking…'
            : oauth
              ? 'Reconnect'
              : 'Update'}
        </Button>
        {oauth && busy && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void connections.cancelOAuth();
            }}
          >
            Cancel
          </Button>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** Connect a provider: generic fields from its auth schema, verified on save
 *  with the result inline — success names who you are and where. */
function ConnectForm({
  providers,
  onDone,
  onCancel,
}: {
  providers: ProviderDescriptorDTO[];
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [providerId, setProviderId] = useState<string | null>(
    providers.length === 1 ? providers[0]!.id : null,
  );
  const provider = providers.find((p) => p.id === (providerId ?? providers[0]?.id));
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState<string | null>(null);

  useEffect(() => {
    // Providers load async; with exactly one there is nothing to pick.
    if (providerId === null && providers.length === 1) setProviderId(providers[0]!.id);
  }, [providers, providerId]);

  if (providers.length === 0) return null;

  const submit = async () => {
    if (!provider) return;
    setBusy(true);
    setError(null);
    try {
      const res = await connections.connect(provider.id, values);
      if (res.ok) {
        setConnected(
          res.identity && res.identity !== res.siteLabel
            ? `Connected as ${res.identity} (${res.siteLabel})`
            : `Connected as ${res.identity ?? res.siteLabel}`,
        );
        setValues({});
        // Let the confirmation land before the card takes over.
        window.setTimeout(onDone, 1200);
      } else {
        setError(res.error ?? 'Couldn’t verify those details. Check them and try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const oauth = provider?.authKind === 'oauth';
  const ready = oauth || (provider?.fields.every((f) => values[f.key]?.trim()) ?? false);

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      {providers.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {providers.map((p) => (
            <button
              key={p.id}
              onClick={() => setProviderId(p.id)}
              className={`rounded-md border px-2.5 py-1 text-sm transition-colors ${
                provider?.id === p.id
                  ? 'border-brand bg-brand/8 text-brand'
                  : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
      {provider && (
        <div className="flex flex-col gap-2">
          {providers.length === 1 && <div className="text-sm font-medium">{provider.label}</div>}
          {oauth ? (
            <p className="text-sm text-muted-foreground">
              Sign in with Google in your browser. The app only ever reads your calendar, and
              meetings show up here as notes by themselves.
            </p>
          ) : (
            provider.fields.map((f) => (
              <AuthFieldInput
                key={f.key}
                field={f}
                value={values[f.key] ?? ''}
                onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
                onEnter={() => !busy && ready && void submit()}
              />
            ))
          )}
          {provider.id === 'atlassian' && !oauth && <AtlassianTokenHelp />}
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => void submit()} disabled={busy || !ready}>
              {busy
                ? oauth
                  ? 'Waiting for the browser…'
                  : 'Verifying…'
                : oauth
                  ? `Connect with Google`
                  : 'Connect'}
            </Button>
            {oauth && busy && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void connections.cancelOAuth();
                }}
              >
                Stop waiting
              </Button>
            )}
            {onCancel && !busy && (
              <Button size="sm" variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            )}
            {connected && (
              <span className="flex items-center gap-1 text-xs text-success">
                <Check className="size-3.5" aria-hidden /> {connected}
              </span>
            )}
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}

function AuthFieldInput({
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
  // Confirm what a pasted address resolves to instead of leaving the person
  // to guess the right shape (clarity review: Atlassian site URL confusion).
  const preview = /url$/i.test(field.key) ? siteUrlPreview(value) : null;
  return (
    <div className="flex flex-col gap-0.5">
      <Input
        type={field.secret ? 'password' : 'text'}
        value={value}
        placeholder={field.placeholder ?? field.label}
        aria-label={field.label}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onEnter()}
      />
      {preview ? (
        <p className="px-1 text-xs text-muted-foreground">
          We’ll connect to <span className="font-medium text-foreground">{preview}</span>
        </p>
      ) : (
        field.hint && <p className="px-1 text-xs text-muted-foreground">{field.hint}</p>
      )}
    </div>
  );
}
