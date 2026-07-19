import { useEffect, useState } from 'react';
import { Button, Input, useTheme } from '@pm/ui';
import { Check, Copy, Eye, EyeOff, FolderOpen, KeyRound, Boxes, Gauge, CalendarClock, Play, Server, Sun, Moon, Monitor } from 'lucide-react';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
import type { ModelInfoDTO, ProposalStatsDTO, SettingsDTO } from '@pm/ipc';
import { invoke } from '../lib/ipc';
import { useApp } from '../state/app-state';
import { useToast } from '../components/toast';

export function SettingsView() {
  const { vault, openVaultDialog, activeTabId, keepTab } = useApp();
  const { theme, setTheme } = useTheme();
  const toast = useToast();
  const [settings, setSettings] = useState<SettingsDTO | null>(null);
  const [models, setModels] = useState<ModelInfoDTO[]>([]);
  const [stats, setStats] = useState<ProposalStatsDTO | null>(null);
  const [key, setKey] = useState('');
  const [savedKey, setSavedKey] = useState(false);
  const [atl, setAtl] = useState({ baseUrl: '', email: '', token: '' });
  const [savedAtl, setSavedAtl] = useState(false);

  // Unsaved input commits the tab — a preview replacement must not eat a
  // half-typed key. Everything else here saves instantly, so it can stay preview.
  useEffect(() => {
    if ((key || atl.baseUrl || atl.email || atl.token) && activeTabId) keepTab(activeTabId);
  }, [key, atl, activeTabId, keepTab]);

  const reload = async () => {
    const [s, m, st] = await Promise.all([
      invoke['settings:get'](),
      invoke['models:list'](),
      invoke['proposals:stats']().catch(() => null),
    ]);
    setSettings(s);
    setModels(m);
    setStats(st);
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

  const saveAtlassian = () =>
    trySave('Saving the Atlassian credentials', async () => {
      if (!atl.baseUrl || !atl.email || !atl.token) return;
      const s = await invoke['settings:setAtlassian'](atl);
      setSettings(s);
      setAtl({ baseUrl: '', email: '', token: '' });
      setSavedAtl(true);
      setTimeout(() => setSavedAtl(false), 2000);
    });

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 items-center border-b border-border px-5 text-sm font-medium text-muted-foreground">
        Settings
      </div>
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
                <div key={sc.sessionType} className="rounded-lg border border-border bg-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium capitalize">{sc.sessionType.replace('-', ' ')}</span>
                    <label className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={sc.enabled}
                        onChange={(e) => setSchedule(sc.sessionType, { enabled: e.target.checked })}
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
                      onChange={(e) => setSchedule(sc.sessionType, { dayOfWeek: Number(e.target.value) })}
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
                      onChange={(e) => setSchedule(sc.sessionType, { hour: Number(e.target.value) })}
                    >
                      {Array.from({ length: 24 }, (_, h) => (
                        <option key={h} value={h}>
                          {String(h).padStart(2, '0')}:00
                        </option>
                      ))}
                    </select>
                    <Button size="sm" variant="outline" className="ml-auto" onClick={() => runNow(sc.sessionType)}>
                      <Play className="size-3.5" /> {ran === sc.sessionType ? 'Running…' : 'Dry-run'}
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
              <input
                type="number"
                value={settings.mcp.port}
                onChange={(e) => setMcp({ port: Number(e.target.value) })}
                className="w-20 rounded-md border border-input bg-card px-1.5 py-1 text-xs"
              />
            </div>
            {settings.mcp.enabled && settings.mcp.token && (
              <McpConnection port={settings.mcp.port} token={settings.mcp.token} />
            )}
          </section>
        )}

        {stats && stats.accepted + stats.rejected > 0 && (
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <Gauge className="size-4 text-muted-foreground" />
              <h2 className="text-base font-semibold">Approval telemetry</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              Verification cost — the north-star metric. Trending down at stable accuracy is the goal.
            </p>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <Stat label="Approval rate" value={stats.approvalRate !== null ? `${Math.round(stats.approvalRate * 100)}%` : '—'} />
              <Stat label="Avg to approve" value={stats.avgApproveMs !== null ? `${Math.round(stats.avgApproveMs / 1000)}s` : '—'} />
              <Stat label="Edited before approve" value={`${stats.edited}`} />
            </div>
            <div className="mt-1 flex flex-col gap-1">
              {Object.entries(stats.byType).map(([kind, t]) => {
                const total = t.accepted + t.rejected;
                return (
                  <div key={kind} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="w-20 capitalize">{kind}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-brand" style={{ width: `${total ? (t.accepted / total) * 100 : 0}%` }} />
                    </div>
                    <span className="tabular-nums">
                      {t.accepted}/{total}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <Boxes className="size-4 text-muted-foreground" />
            <h2 className="text-base font-semibold">Atlassian (Jira + Confluence)</h2>
            {settings?.hasAtlassianCreds && (
              <span className="flex items-center gap-1 text-xs text-brand">
                <Check className="size-3.5" /> connected
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Tracker seam for Ask (read) and outbound drafts (write on approval). Create an{' '}
            <em>unscoped</em> API token. Stored encrypted (safeStorage).
          </p>
          <div className="flex flex-col gap-2">
            <Input
              value={atl.baseUrl}
              onChange={(e) => setAtl((a) => ({ ...a, baseUrl: e.target.value }))}
              placeholder="https://your-domain.atlassian.net"
            />
            <Input
              value={atl.email}
              onChange={(e) => setAtl((a) => ({ ...a, email: e.target.value }))}
              placeholder="you@company.com"
            />
            <div className="flex gap-2">
              <Input
                type="password"
                value={atl.token}
                onChange={(e) => setAtl((a) => ({ ...a, token: e.target.value }))}
                placeholder="Atlassian API token (unscoped)"
              />
              <Button size="sm" onClick={saveAtlassian} disabled={!atl.baseUrl || !atl.email || !atl.token}>
                {savedAtl ? 'Saved' : 'Connect'}
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-2.5">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
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
