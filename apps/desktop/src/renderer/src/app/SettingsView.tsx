import { useEffect, useState } from 'react';
import { Button, Input } from '@pm/ui';
import { Check, KeyRound, Boxes, Gauge } from 'lucide-react';
import type { ModelInfoDTO, ProposalStatsDTO, SettingsDTO } from '@pm/ipc';
import { invoke } from '../lib/ipc';

export function SettingsView() {
  const [settings, setSettings] = useState<SettingsDTO | null>(null);
  const [models, setModels] = useState<ModelInfoDTO[]>([]);
  const [stats, setStats] = useState<ProposalStatsDTO | null>(null);
  const [key, setKey] = useState('');
  const [savedKey, setSavedKey] = useState(false);
  const [atl, setAtl] = useState({ baseUrl: '', email: '', token: '' });
  const [savedAtl, setSavedAtl] = useState(false);

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

  const saveKey = async () => {
    if (!key.trim()) return;
    const s = await invoke['settings:setAnthropicKey'](key.trim());
    setSettings(s);
    setKey('');
    setSavedKey(true);
    await reload();
    setTimeout(() => setSavedKey(false), 2000);
  };

  const pickModel = async (id: string) => {
    const s = await invoke['settings:setModel'](id);
    setSettings(s);
  };

  const saveAtlassian = async () => {
    if (!atl.baseUrl || !atl.email || !atl.token) return;
    const s = await invoke['settings:setAtlassian'](atl);
    setSettings(s);
    setAtl({ baseUrl: '', email: '', token: '' });
    setSavedAtl(true);
    setTimeout(() => setSavedAtl(false), 2000);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 items-center px-5 text-sm font-medium text-muted-foreground" style={{ WebkitAppRegion: 'drag' } as never}>
        Settings
      </div>
      <div className="mx-auto w-full max-w-xl flex-1 space-y-8 overflow-y-auto px-8 py-4">
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-muted-foreground" />
            <h2 className="font-serif text-lg font-semibold">Anthropic API key</h2>
            {settings?.hasAnthropicKey && (
              <span className="flex items-center gap-1 text-xs text-brand">
                <Check className="size-3.5" /> set
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Stored encrypted with the OS keychain (safeStorage) and held in memory only for the agent
            — never written to the vault.
          </p>
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
          <h2 className="font-serif text-lg font-semibold">Model</h2>
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

        {stats && stats.accepted + stats.rejected > 0 && (
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <Gauge className="size-4 text-muted-foreground" />
              <h2 className="font-serif text-lg font-semibold">Approval telemetry</h2>
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
            <h2 className="font-serif text-lg font-semibold">Atlassian (Jira + Confluence)</h2>
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
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
