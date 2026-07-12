import { useEffect, useState } from 'react';
import { Button, Input } from '@pm/ui';
import { Check, KeyRound, Boxes } from 'lucide-react';
import type { ModelInfoDTO, SettingsDTO } from '@pm/ipc';
import { invoke } from '../lib/ipc';

export function SettingsView() {
  const [settings, setSettings] = useState<SettingsDTO | null>(null);
  const [models, setModels] = useState<ModelInfoDTO[]>([]);
  const [key, setKey] = useState('');
  const [savedKey, setSavedKey] = useState(false);
  const [atl, setAtl] = useState({ baseUrl: '', email: '', token: '' });
  const [savedAtl, setSavedAtl] = useState(false);

  const reload = async () => {
    const [s, m] = await Promise.all([invoke['settings:get'](), invoke['models:list']()]);
    setSettings(s);
    setModels(m);
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
            Read-only tracker seam for the Ask session. Create an <em>unscoped</em> API token. Stored
            encrypted (safeStorage).
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
