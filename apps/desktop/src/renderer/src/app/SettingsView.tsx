import { useEffect, useState } from 'react';
import { Button, Input, useTheme } from '@qale/ui';
import { Check, Copy, Eye, EyeOff, FolderOpen, KeyRound, CalendarClock, LifeBuoy, Play, Send, Server, Settings, Sun, Moon, Monitor, UserRound, X } from 'lucide-react';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Where a bug report goes. Deliberately the one and only place it is written
 * down. The mailbox has to exist before the first build goes out: a report that
 * bounces is worse than no button.
 */
const SUPPORT_EMAIL = 'support@qale.ai';
/** Shown to the user and used in the report subject. */
const APP_NAME = 'Qale';
/** The install line for missing git is platform-specific; nothing else here is. */
const isMac = navigator.userAgent.includes('Macintosh');
import {
  TELEMETRY_IDENTITY,
  TELEMETRY_PROCESSOR,
  type ModelInfoDTO,
  type SettingsDTO,
} from '@qale/ipc';
import { invoke } from '../lib/ipc';
import { useApp } from '../state/app-state';
import { useToast } from '../components/toast';
import { PageHeader } from '../components/PageHeader';
import { TelemetryDetails } from '../components/TelemetryDetails';
import { ConnectionsSettings } from './ConnectionsSettings';

export function SettingsView() {
  const { vault, openVaultDialog, skills } = useApp();
  const { theme, setTheme } = useTheme();
  const toast = useToast();
  const [settings, setSettings] = useState<SettingsDTO | null>(null);
  const [models, setModels] = useState<ModelInfoDTO[]>([]);
  const [key, setKey] = useState('');
  const [savedKey, setSavedKey] = useState(false);

  const reload = async () => {
    const [s, m] = await Promise.all([invoke['settings:get'](), invoke['models:list']()]);
    setSettings(s);
    setModels(m);
  };

  useEffect(() => {
    void reload();
  }, []);

  // Every mutator funnels through this: a failed save must say so — the
  // button quietly staying "Save" reads as success.
  const trySave = async (what: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      toast(`${what} failed: ${err instanceof Error ? err.message : 'the settings write was rejected.'}`);
    }
  };

  const saveKey = () =>
    trySave('Saving the API key', async () => {
      if (!key.trim()) return;
      const s = await invoke['settings:setAnthropicKey'](key.trim());
      setSettings(s);
      setKey('');
      setSavedKey(true);
      await reload();
      setTimeout(() => setSavedKey(false), 2000);
    });

  const pickModel = (id: string) =>
    trySave('Switching the model', async () => {
      setSettings(await invoke['settings:setModel'](id));
    });

  const [ran, setRan] = useState<string | null>(null);
  const setSchedule = (type: string, patch: { dayOfWeek?: number; hour?: number; enabled?: boolean }) =>
    trySave('Updating the schedule', async () => {
      setSettings(await invoke['settings:setSchedule'](type, patch));
    });
  const runNow = (type: string) =>
    trySave('Starting the run', async () => {
      await invoke['schedule:runNow'](type);
      setRan(type);
      setTimeout(() => setRan(null), 2500);
    });

  const setMcp = (patch: { enabled?: boolean; port?: number }) =>
    trySave('Updating the MCP server', async () => {
      setSettings(await invoke['settings:setMcp'](patch));
    });

  const [copiedDiagnostics, setCopiedDiagnostics] = useState(false);
  const [reportNote, setReportNote] = useState<string | null>(null);
  const say = (line: string) => {
    setReportNote(line);
    setTimeout(() => setReportNote(null), 15000);
  };

  const copyDiagnostics = () =>
    trySave('Copying the diagnostics', async () => {
      await navigator.clipboard.writeText(await invoke['diagnostics:report']());
      setCopiedDiagnostics(true);
      setTimeout(() => setCopiedDiagnostics(false), 2500);
      say('Copied. Paste it into an email or a message to us.');
    });

  /**
   * The details always go on the clipboard first, and the email carries only a
   * skeleton and the version. Two reasons: a mailto link long enough to hold a
   * log tail gets cut by some mail apps, and a truncated report is worse than
   * none; and if this machine has no email app set up, nothing opens and the
   * user is told nothing, so the copy has to have already happened.
   */
  const reportProblem = () =>
    trySave('Starting the report', async () => {
      const report = await invoke['diagnostics:report']();
      // The copy is the only part that can fail on its own, and the email is
      // worth opening either way: a report with no diagnostics still reaches
      // us. The line at the end says which of the two the user got.
      let copied = true;
      try {
        await navigator.clipboard.writeText(report);
      } catch {
        copied = false;
      }
      const subject = `${APP_NAME} ${settings?.appVersion ?? ''}: problem report`;
      const body = [
        'What happened:',
        '',
        '',
        'What you expected instead:',
        '',
        '',
        `Version: ${settings?.appVersion ?? 'unknown'}`,
        '',
        'Diagnostics (pasted from the clipboard):',
        '',
      ].join('\n');
      window.open(
        `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
      );
      say(
        copied
          ? `The diagnostics are copied, and an email to ${SUPPORT_EMAIL} should be waiting. Paste them at the bottom of it. If no email opened, write to that address yourself: the diagnostics are already on your clipboard.`
          : `An email to ${SUPPORT_EMAIL} should be waiting, but the diagnostics would not copy. Send it anyway and we will ask.`,
      );
    });

  return (
    <div className="flex h-full flex-col">
      <PageHeader icon={Settings} label="Settings" />
      <div className="mx-auto w-full max-w-xl flex-1 space-y-8 overflow-y-auto px-8 py-4">
        <section className="space-y-2">
          <h2 className="text-base font-semibold">Appearance</h2>
          <div className="flex gap-2">
            {([['light', Sun, 'Light'], ['system', Monitor, 'System'], ['dark', Moon, 'Dark']] as const).map(([value, Icon, label]) => (
              <button
                key={value}
                onClick={() => setTheme(value)}
                className={`flex flex-1 flex-col items-center gap-1.5 rounded-lg border py-3 text-xs font-medium transition-colors ${
                  theme === value ? 'border-brand bg-brand/8 text-brand' : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <UserRound className="size-4 text-muted-foreground" />
            <h2 className="text-base font-semibold">You</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Invites carry an address, not a name. This is how you appear in a meeting’s participants
            — and which addresses the app recognises as you instead of as someone to file.
          </p>
          <IdentityCard
            identity={settings?.identity ?? null}
            onSave={(patch) =>
              trySave('Saving your details', async () => {
                setSettings(await invoke['settings:setIdentity'](patch));
              })
            }
          />
        </section>

        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <FolderOpen className="size-4 text-muted-foreground" />
            <h2 className="text-base font-semibold">Workspace</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            The folder of markdown this app reads and writes. Switching reopens the app on the new
            folder — open notes and sessions close, nothing is moved or deleted.
          </p>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{vault?.name ?? '—'}</div>
              <div className="truncate font-mono text-xs text-muted-foreground" title={vault?.path}>
                {vault?.path ?? 'No workspace open'}
              </div>
            </div>
            <Button size="sm" variant="outline" className="shrink-0" onClick={openVaultDialog}>
              Switch…
            </Button>
          </div>
          {/* The standing version of Home's notices: dismissible there, always
              here, so "what happened to version history?" has an answer. */}
          {vault?.syncedBy && (
            <p className="rounded-md bg-warning/10 px-2 py-1.5 text-sm text-warning">
              {vault.syncedBy} is syncing this folder too. When two programs write the same files at
              once, edits can go missing and search can stop working. A plain folder on this computer
              is safer.
            </p>
          )}
          {vault && !vault.gitAvailable && (
            <p className="rounded-md bg-warning/10 px-2 py-1.5 text-sm text-warning">
              Git isn't installed on this computer, so nothing keeps earlier versions of a note and
              there is no way to undo what the agent wrote.{' '}
              {isMac ? (
                <>
                  To turn it on, run <code className="whitespace-nowrap">xcode-select --install</code>{' '}
                  in Terminal, then reopen the workspace.
                </>
              ) : (
                'To turn it on, install git, then reopen the workspace.'
              )}
            </p>
          )}
        </section>

        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-muted-foreground" />
            <h2 className="text-base font-semibold">Anthropic API key</h2>
            {settings?.hasAnthropicKey && (
              <span className="flex items-center gap-1 text-xs text-brand">
                <Check className="size-3.5" /> set
              </span>
            )}
          </div>
          {settings?.secretsUnreadable && (
            <p className="rounded-md bg-warning/10 px-2 py-1.5 text-sm text-warning">
              Your saved keys can't be read anymore — the OS keychain was reset or changed. Re-enter
              them below to keep the agent working.
            </p>
          )}
          {settings && !settings.secretsEncrypted ? (
            <p className="rounded-md bg-warning/10 px-2 py-1.5 text-sm text-warning">
              No OS keychain available on this system — keys are stored obfuscated, not encrypted.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Stored encrypted with the OS keychain (safeStorage) and held in memory only for the agent
              — never written to the vault.
            </p>
          )}
          <div className="flex gap-2">
            <Input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk-ant-…"
              onKeyDown={(e) => e.key === 'Enter' && saveKey()}
            />
            <Button size="sm" onClick={saveKey} disabled={!key.trim()}>
              {savedKey ? 'Saved' : 'Save'}
            </Button>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Model</h2>
          {models.length === 0 ? (
            <p className="text-sm text-muted-foreground">Set an API key to see available models.</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              What new sessions start on. You can move a single session to a different model from
              the box you type in.
            </p>
          )}
          {models.length > 0 && (
            <div className="flex flex-col gap-1">
              {models.map((m) => {
                const active = settings?.modelId === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => pickModel(m.id)}
                    className={`flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                      active ? 'border-brand bg-brand/8' : 'border-border hover:bg-accent'
                    }`}
                  >
                    <span className="font-medium">{m.label}</span>
                    <span className="font-mono text-xs text-muted-foreground">{m.id}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {settings && settings.schedules.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <CalendarClock className="size-4 text-muted-foreground" />
              <h2 className="text-base font-semibold">Scheduled sessions</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              Run while the app is open; missed slots catch up on launch. Dry-run first — everything
              lands in the Inbox as cards, nothing is sent.
            </p>
            {settings.schedules.map((sc) => {
              return (
                <div key={sc.skill} className="rounded-lg border border-border bg-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    {/* The skill's own name, not its filename — one vocabulary
                        wherever a skill is offered. */}
                    <span className="font-medium">
                      {skills.find((s) => s.name === sc.skill)?.title ?? sc.skill.replace(/-/g, ' ')}
                    </span>
                    <label className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={sc.enabled}
                        onChange={(e) => setSchedule(sc.skill, { enabled: e.target.checked })}
                      />
                      Enabled
                    </label>
                  </div>
                  <div className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                    Runs every
                    <select
                      className="rounded-md border border-input bg-card px-1.5 py-1 text-sm"
                      value={sc.dayOfWeek}
                      aria-label="Day of week"
                      onChange={(e) => setSchedule(sc.skill, { dayOfWeek: Number(e.target.value) })}
                    >
                      {DAYS.map((d, i) => (
                        <option key={d} value={i}>
                          {d}
                        </option>
                      ))}
                    </select>
                    at
                    <select
                      className="rounded-md border border-input bg-card px-1.5 py-1 text-sm tabular-nums"
                      value={sc.hour}
                      aria-label="Hour"
                      onChange={(e) => setSchedule(sc.skill, { hour: Number(e.target.value) })}
                    >
                      {Array.from({ length: 24 }, (_, h) => (
                        <option key={h} value={h}>
                          {String(h).padStart(2, '0')}:00
                        </option>
                      ))}
                    </select>
                    <Button size="sm" variant="outline" className="ml-auto" onClick={() => runNow(sc.skill)}>
                      <Play className="size-3.5" /> {ran === sc.skill ? 'Running…' : 'Dry-run'}
                    </Button>
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {settings && (
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <Server className="size-4 text-muted-foreground" />
              <h2 className="text-base font-semibold">MCP server (localhost)</h2>
              {settings.mcp.running && (
                <span className="flex items-center gap-1 text-xs text-brand">
                  <Check className="size-3.5" /> running
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Expose the memory to your own Claude/Cursor via three tools —{' '}
              <code>ask_product</code>, <code>log_decision</code>, <code>draft_writeback</code> — all
              routed through the same approval cards. Token-gated; localhost only.
            </p>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={settings.mcp.enabled} onChange={(e) => setMcp({ enabled: e.target.checked })} />
                enabled
              </label>
              <span className="text-xs text-muted-foreground">port</span>
              <McpPortInput port={settings.mcp.port} onCommit={(port) => setMcp({ port })} />
            </div>
            {settings.mcp.enabled && settings.mcp.token && (
              <McpConnection port={settings.mcp.port} token={settings.mcp.token} />
            )}
          </section>
        )}

        <ConnectionsSettings />

        {settings && (
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <Send className="size-4 text-muted-foreground" />
              <h2 className="text-base font-semibold">What leaves your machine</h2>
            </div>
            {/* The same switch, the same words and the same folded list as the
                setup screen, from the same allowlist — a promise kept in two
                places has to be one promise (docs/onboarding.md ONB-6). */}
            <p className="text-sm text-muted-foreground">
              Nothing you or the agent wrote. Only whether the app worked, and who it stopped
              working for.
            </p>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-primary"
                checked={settings.onboarding.telemetry}
                onChange={(e) =>
                  trySave('Saving that choice', async () => {
                    setSettings(await invoke['settings:setOnboarding']({ telemetry: e.target.checked }));
                  })
                }
              />
              <span>
                Send usage and crash reports
                {/* Who the reports are tied to stays out in the open here too. */}
                <span className="mt-0.5 block text-muted-foreground">{TELEMETRY_IDENTITY}.</span>
              </span>
            </label>
            <TelemetryDetails />
            <p className="text-sm text-muted-foreground">{TELEMETRY_PROCESSOR}</p>
          </section>
        )}

        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <LifeBuoy className="size-4 text-muted-foreground" />
            <h2 className="text-base font-semibold">Version and help</h2>
            <span className="ml-auto font-mono text-xs text-muted-foreground">
              {APP_NAME} {settings?.appVersion ?? '…'}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            If something goes wrong, send us what the app knows about itself: version numbers, how
            many notes it has open, whether your keys can be read, and the last few lines of its own
            log. Nothing you have written is in there, and neither is your name, your folder or your
            keys.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={copyDiagnostics}>
              {copiedDiagnostics ? <Check className="size-3.5 text-brand" /> : <Copy className="size-3.5" />}
              {copiedDiagnostics ? 'Copied' : 'Copy diagnostics'}
            </Button>
            <Button size="sm" variant="outline" onClick={reportProblem}>
              Report a problem
            </Button>
          </div>
          {reportNote && <p className="text-sm text-muted-foreground">{reportNote}</p>}
        </section>
      </div>
    </div>
  );
}

/**
 * Your name, and every address that means you. The connected accounts are
 * already known (a calendar grant carries its own address) and show as read-only
 * — aliases exist for the ones they can't know, e.g. an invite that reached a
 * second work address. Commits on blur/Enter, not per keystroke.
 */
function IdentityCard({
  identity,
  onSave,
}: {
  identity: SettingsDTO['identity'] | null;
  onSave: (patch: { name?: string | null; aliases?: string[] }) => void;
}) {
  const [name, setName] = useState(identity?.name ?? '');
  const [alias, setAlias] = useState('');
  useEffect(() => setName(identity?.name ?? ''), [identity?.name]);

  const connected = (identity?.emails ?? []).filter((e) => !(identity?.aliases ?? []).includes(e));
  const aliases = identity?.aliases ?? [];

  const commitName = () => {
    const next = name.trim();
    if (next !== (identity?.name ?? '')) onSave({ name: next || null });
  };
  const addAlias = () => {
    const next = alias.trim().toLowerCase();
    if (!next || aliases.includes(next)) {
      setAlias('');
      return;
    }
    onSave({ aliases: [...aliases, next] });
    setAlias('');
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-3">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="qale-identity-name">
          Your name
        </label>
        <Input
          id="qale-identity-name"
          value={name}
          placeholder="Shown as “You” until you set it"
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          className="h-8"
        />
      </div>
      <div className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">Addresses that are you</span>
        <div className="flex flex-wrap items-center gap-1">
          {connected.length === 0 && aliases.length === 0 && (
            <span className="text-xs text-muted-foreground/70">
              None yet — connect a calendar below, or add one here.
            </span>
          )}
          {connected.map((e) => (
            <span
              key={e}
              className="rounded-sm bg-accent px-1.5 py-px text-xs"
              title="From a connected account"
            >
              {e}
            </span>
          ))}
          {aliases.map((e) => (
            <span key={e} className="flex items-center gap-1 rounded-sm bg-accent px-1.5 py-px text-xs">
              {e}
              <button
                className="text-muted-foreground/70 hover:text-destructive"
                onClick={() => onSave({ aliases: aliases.filter((a) => a !== e) })}
                aria-label={`Remove ${e}`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            value={alias}
            placeholder="another@address.com"
            onChange={(e) => setAlias(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addAlias()}
            className="h-8"
            aria-label="Add another address"
          />
          <Button size="sm" variant="outline" className="shrink-0" onClick={addAlias} disabled={!alias.trim()}>
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The port commits on blur/Enter, not per keystroke — typing "3000" must not
 * persist (and rebind the server to) ports 3, 30 and 300 along the way.
 */
function McpPortInput({ port, onCommit }: { port: number; onCommit: (port: number) => void }) {
  const [draft, setDraft] = useState(String(port));
  useEffect(() => setDraft(String(port)), [port]);
  const commit = () => {
    const n = Number(draft);
    if (Number.isInteger(n) && n >= 1024 && n <= 65535) {
      if (n !== port) onCommit(n);
    } else {
      setDraft(String(port));
    }
  };
  return (
    <input
      type="number"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
      aria-label="MCP server port"
      className="w-20 rounded-md border border-input bg-card px-1.5 py-1 text-xs"
    />
  );
}

/** MCP connection details — the bearer token stays masked until revealed. */
function McpConnection({ port, token }: { port: number; token: string }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-muted/60 p-3 font-mono text-xs">
      <div>
        <span className="text-muted-foreground">url </span>
        http://127.0.0.1:{port}/mcp
      </div>
      <div className="flex items-center gap-2">
        <span className="truncate">
          <span className="text-muted-foreground">header </span>
          Authorization: Bearer {revealed ? token : '••••••••••••'}
        </span>
        <button
          className="ml-auto shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => setRevealed((r) => !r)}
          aria-label={revealed ? 'Hide token' : 'Reveal token'}
          title={revealed ? 'Hide token' : 'Reveal token'}
        >
          {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
        <button
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={copy}
          aria-label="Copy token"
          title="Copy token"
        >
          {copied ? <Check className="size-3.5 text-brand" /> : <Copy className="size-3.5" />}
        </button>
      </div>
    </div>
  );
}
