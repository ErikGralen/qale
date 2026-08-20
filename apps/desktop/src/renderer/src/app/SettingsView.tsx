import { useEffect, useState } from 'react';
import { Button, Input, Tabs, TabsContent, TabsList, TabsTrigger, useTheme } from '@qale/ui';
import { Check, Copy, Eye, EyeOff, Play, Settings, Sun, Moon, Monitor, X } from 'lucide-react';
import {
  LANGUAGE_NAMES,
  LANGUAGE_TAGS,
  LLM_PROVIDERS,
  LLM_PROVIDER_INFO,
  type LlmProvider,
} from '@qale/domain';

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
const isWindows = navigator.userAgent.includes('Windows');
/** Where the Windows installer lives. Opens in the browser, like every link here. */
const GIT_FOR_WINDOWS = 'https://git-scm.com/download/win';
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
import { NewWorkspace } from '../components/NewWorkspace';
import { ConnectionsSettings } from './ConnectionsSettings';
import { Setting, SettingNotice, SettingPanel } from '../components/Setting';
import {
  DEFAULT_SETTINGS_SECTION,
  SETTINGS_SECTIONS,
  settingsSectionLabel,
  type SettingsSection,
} from '../lib/settings-sections';

/**
 * Settings, in tabs. It was one column of eleven sections, and because each one
 * leads with a paragraph of copy that has to be there — what a key can reach,
 * what a scheduled run sends, what leaves the machine — the page ran to three
 * screens of prose with fourteen controls scattered through it. Finding the API
 * key meant reading.
 *
 * The tabs are the fix, and they only work if two things hold:
 *   - every panel is short (one to three settings), so a tab is one click to
 *     the whole answer and never the top of another scroll;
 *   - anything wrong behind a closed tab still says so, from the tab itself
 *     (`flagged` below). Hiding a missing key behind a tab would be exactly the
 *     silent failure the rest of the app is built to avoid.
 *
 * The active tab lives on the view, not in local state, so deep links can aim
 * at one (`openSettings('agent')` from the no-key notice) and so leaving the
 * tab and coming back puts you where you were.
 */
export function SettingsView({ viewKey, section }: { viewKey: string; section?: SettingsSection }) {
  const { vault, openVaultDialog, skills, setSettingsSection } = useApp();
  const { theme, setTheme } = useTheme();
  const toast = useToast();
  const [settings, setSettings] = useState<SettingsDTO | null>(null);
  const [models, setModels] = useState<ModelInfoDTO[]>([]);
  const [key, setKey] = useState('');
  const [savedKey, setSavedKey] = useState(false);
  /** The new-workspace form, folded away until asked for. */
  const [creating, setCreating] = useState(false);
  const active = section ?? DEFAULT_SETTINGS_SECTION;
  /** The chosen provider, for the copy that has to name a company or a key. */
  const providerInfo = LLM_PROVIDER_INFO[settings?.provider ?? 'anthropic'];

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
      toast(
        `${what} failed: ${err instanceof Error ? err.message : 'the settings write was rejected.'}`,
      );
    }
  };

  const saveKey = () =>
    trySave('Saving the API key', async () => {
      if (!key.trim() || !settings) return;
      const s = await invoke['settings:setProviderKey'](settings.provider, key.trim());
      setSettings(s);
      setKey('');
      setSavedKey(true);
      await reload();
      setTimeout(() => setSavedKey(false), 2000);
    });

  /**
   * Point the workspace at the other provider. The model list changes with it,
   * so the reload is not optional: leaving Claude's names on screen under a
   * Gemini key is the kind of wrong that only shows up in a session.
   */
  const pickProvider = (provider: LlmProvider) =>
    trySave('Switching the provider', async () => {
      if (provider === settings?.provider) return;
      setKey('');
      setSettings(await invoke['settings:setProvider'](provider));
      await reload();
    });

  const pickModel = (id: string) =>
    trySave('Switching the model', async () => {
      setSettings(await invoke['settings:setModel'](id));
    });

  const pickLanguage = (language: string) =>
    trySave('Changing the language', async () => {
      setSettings(await invoke['settings:setLanguage'](language));
    });

  const [ran, setRan] = useState<string | null>(null);
  const setSchedule = (
    type: string,
    patch: { dayOfWeek?: number; hour?: number; enabled?: boolean },
  ) =>
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

  /**
   * Which tabs are carrying something the PO has to deal with. Only the two the
   * page can know without opening the panel — a workspace that can't keep
   * history, and an agent that can't run — but those are the two that matter,
   * and a dot on the tab is what keeps a tab from being a place things hide.
   */
  const flagged: Partial<Record<SettingsSection, string>> = {};
  if (vault?.syncedBy || vault?.pathTooDeep || (vault && !vault.gitAvailable)) {
    flagged.workspace = 'This workspace needs attention';
  }
  if (settings && (!settings.hasApiKey || settings.secretsUnreadable)) {
    flagged.agent = settings.hasApiKey
      ? 'Your saved key can’t be read'
      : 'No API key yet, so nothing can run';
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={Settings}
        crumbs={[{ label: 'Settings' }]}
        label={settingsSectionLabel(active)}
      />
      <Tabs
        value={active}
        onValueChange={(v) => setSettingsSection(viewKey, v as SettingsSection)}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        {/* The strip carries the hairline, and the 5px of padding under the
            list is what the underline needs: the line variant draws it 5px
            below the trigger, so without the room it lands past the hairline
            (and a scroll container here would clip it away entirely). */}
        <div className="shrink-0 border-b border-border px-4 pb-[5px]">
          <TabsList variant="line" className="h-9 gap-1 p-0">
            {SETTINGS_SECTIONS.map((s) => (
              <TabsTrigger
                key={s.id}
                value={s.id}
                title={flagged[s.id]}
                className="gap-1.5 px-2 text-[0.8125rem]"
              >
                <s.icon className="size-3.5" aria-hidden />
                {s.label}
                {flagged[s.id] && (
                  <>
                    <span className="size-1.5 shrink-0 rounded-full bg-warning" aria-hidden />
                    <span className="sr-only">, needs attention</span>
                  </>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {/* Left-aligned, not centred: the panel has to start where its tab does,
            or the two read as separate pages on a wide window. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="w-full max-w-2xl">
            <TabsContent value="general">
              <SettingPanel>
                <Setting
                  title="Appearance"
                  description="Light and dark follow this app only, and System follows the computer."
                  control={
                    <div className="flex gap-1 rounded-lg border border-border p-0.5">
                      {(
                        [
                          ['light', Sun, 'Light'],
                          ['system', Monitor, 'System'],
                          ['dark', Moon, 'Dark'],
                        ] as const
                      ).map(([value, Icon, label]) => (
                        <button
                          key={value}
                          onClick={() => setTheme(value)}
                          aria-pressed={theme === value}
                          className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none ${
                            theme === value
                              ? 'bg-brand/8 text-brand'
                              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                          }`}
                        >
                          <Icon className="size-3.5" aria-hidden />
                          {label}
                        </button>
                      ))}
                    </div>
                  }
                />

                <Setting
                  title="Language"
                  description={
                    <>
                      <p>
                        What the agent writes in: notes, summaries, titles and its replies. A
                        Swedish meeting is still quoted in Swedish. Changing this only affects what
                        gets written from now on, and notes already written stay in the language
                        they are in.
                      </p>
                      {/* The half that is not a preference. Tags and folder names are how
                          notes group, and a vocabulary that forks by language stops grouping
                          (OW5), so the setting says out loud what it leaves alone. */}
                      <p>
                        Tags, folder names and note types stay in English whichever language you
                        pick. They are how notes are found and grouped, not something anyone reads.
                      </p>
                    </>
                  }
                  control={
                    <select
                      className="h-8 rounded-md border border-input bg-card px-2 text-sm"
                      value={settings?.language ?? 'en'}
                      aria-label="Workspace language"
                      onChange={(e) => pickLanguage(e.target.value)}
                    >
                      {LANGUAGE_TAGS.map((tag) => (
                        <option key={tag} value={tag}>
                          {LANGUAGE_NAMES[tag]}
                        </option>
                      ))}
                    </select>
                  }
                />
              </SettingPanel>
            </TabsContent>

            <TabsContent value="you">
              <SettingPanel>
                <Setting
                  title="Your details"
                  description="Invites carry an address, not a name. This is how you appear in a meeting’s participants, and which addresses the app recognises as you instead of as someone to file."
                >
                  <IdentityCard
                    identity={settings?.identity ?? null}
                    onSave={(patch) =>
                      trySave('Saving your details', async () => {
                        setSettings(await invoke['settings:setIdentity'](patch));
                      })
                    }
                  />
                </Setting>
              </SettingPanel>
            </TabsContent>

            <TabsContent value="workspace">
              <SettingPanel>
                <Setting
                  title="Workspace folder"
                  description="The folder of markdown this app reads and writes. Switching to another one, or starting a new one, reopens the app on that folder: open notes and sessions close, nothing is moved or deleted."
                >
                  <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{vault?.name ?? '—'}</div>
                      <div
                        className="truncate font-mono text-xs text-muted-foreground"
                        title={vault?.path}
                      >
                        {vault?.path ?? 'No workspace open'}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={openVaultDialog}
                    >
                      Switch…
                    </Button>
                    <Button
                      size="sm"
                      variant={vault ? 'outline' : 'default'}
                      className="shrink-0"
                      onClick={() => setCreating((v) => !v)}
                    >
                      New…
                    </Button>
                  </div>
                  {creating && (
                    <NewWorkspace
                      onCancel={() => setCreating(false)}
                      onCreated={(info) => {
                        setCreating(false);
                        toast(`Now working in ${info.name}.`);
                      }}
                    />
                  )}
                  {/* The standing version of Home's notices: dismissible there, always
                      here, so "what happened to version history?" has an answer. */}
                  {vault?.syncedBy && (
                    <SettingNotice>
                      {vault.syncedBy} is syncing this folder too. When two programs write the same
                      files at once, edits can go missing and search can stop working. A plain
                      folder on this computer is safer.
                    </SettingNotice>
                  )}
                  {vault?.pathTooDeep && (
                    <SettingNotice>
                      This folder sits too deep for Windows. It cannot open a file whose full path
                      is longer than 260 characters, so notes and session files in here can fail to
                      save. Make a workspace nearer the top of the drive, like C:\Qale, and move
                      these files into it.
                    </SettingNotice>
                  )}
                  {vault && !vault.gitAvailable && (
                    <SettingNotice>
                      Git isn't installed on this computer, so nothing keeps earlier versions of a
                      note and there is no way to undo what the agent wrote.{' '}
                      {isMac ? (
                        <>
                          To turn it on, run{' '}
                          <code className="whitespace-nowrap">xcode-select --install</code> in
                          Terminal, then reopen the workspace.
                        </>
                      ) : isWindows ? (
                        <>
                          To turn it on, install{' '}
                          <a
                            href={GIT_FOR_WINDOWS}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded font-medium underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                          >
                            Git for Windows
                          </a>
                          , then reopen the workspace.
                        </>
                      ) : (
                        'To turn it on, install git, then reopen the workspace.'
                      )}
                    </SettingNotice>
                  )}
                </Setting>
              </SettingPanel>
            </TabsContent>

            <TabsContent value="agent">
              <SettingPanel>
                {/* The choice comes first, because it decides what the key
                    field and the model list below both mean. One provider at a
                    time: an Anthropic key reaches Claude, a Gemini key reaches
                    Google, and nothing falls back from one to the other. */}
                <Setting
                  title="Model provider"
                  description="Whose models answer. Both are bring-your-own-key, and you can only be on one at a time. Your keys are both kept, so switching back needs no second paste."
                >
                  <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Provider">
                    {LLM_PROVIDERS.map((id) => {
                      const option = LLM_PROVIDER_INFO[id];
                      const on = settings?.provider === id;
                      const hasKey = settings?.storedKeys[id] ?? false;
                      return (
                        <button
                          key={id}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => pickProvider(id)}
                          className={`rounded-lg border p-3 text-left transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none ${
                            on ? 'border-brand bg-brand/8' : 'border-border hover:bg-accent'
                          }`}
                        >
                          <span className="flex items-center gap-1.5 text-sm font-medium">
                            {option.family}
                            {on && <Check className="size-3.5 text-brand" aria-hidden />}
                          </span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {option.name}
                            {hasKey ? ', key saved' : ', no key yet'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </Setting>

                <Setting
                  title={`${providerInfo.name} API key`}
                  badge={
                    settings?.hasApiKey && (
                      <span className="flex items-center gap-1 text-xs text-brand">
                        <Check className="size-3.5" aria-hidden /> set
                      </span>
                    )
                  }
                  description={
                    // Deliberately says nothing about a keychain. The store is the login
                    // keychain on a Mac and DPAPI on Windows, and neither name means
                    // anything to the person reading this. What they can act on is the
                    // same on both: keys are locked to this computer and this login, so
                    // settings that arrived from somewhere else cannot be unlocked here
                    // and the keys have to be typed again.
                    settings && !settings.secretsEncrypted
                      ? null
                      : // What the key DOES is the other half of where it is kept (OW10):
                        // it is the one thing in the app that sends your notes out.
                        `Encrypted by this computer, tied to your login, and held in memory only while the agent runs. It is never written into your workspace. It is also what sends notes out: when the agent works, the notes it reads go to ${providerInfo.name}.`
                  }
                >
                  {settings?.secretsUnreadable && (
                    <SettingNotice>
                      Your saved keys can't be unlocked on this computer anymore. That happens when
                      these settings came from another computer or another login, or when the
                      system's key store was reset. Re-enter them below to keep the agent working.
                    </SettingNotice>
                  )}
                  {settings && !settings.secretsEncrypted && (
                    <SettingNotice>
                      This system has no key store the app can use, so your keys are saved scrambled
                      rather than encrypted. Anyone who can read the settings file can get them
                      back.
                    </SettingNotice>
                  )}
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                      placeholder={providerInfo.keyPlaceholder}
                      aria-label={`${providerInfo.name} API key`}
                      onKeyDown={(e) => e.key === 'Enter' && saveKey()}
                    />
                    <Button size="sm" onClick={saveKey} disabled={!key.trim()}>
                      {savedKey ? 'Saved' : 'Save'}
                    </Button>
                  </div>
                </Setting>

                {/* The shortlist, not the catalogue. Each row says when to
                    reach for it, because a name and an id told nobody which
                    one to pick. */}
                <Setting
                  title="Model"
                  description="What new sessions start on. You can move a single session to another model from the box you type in."
                >
                  <div className="flex flex-col gap-1">
                    {models.map((m) => {
                      const on = settings?.modelId === m.id;
                      const note = providerInfo.models.find((o) => o.id === m.id)?.note;
                      return (
                        <button
                          key={m.id}
                          onClick={() => pickModel(m.id)}
                          aria-pressed={on}
                          className={`flex items-start gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none ${
                            on ? 'border-brand bg-brand/8' : 'border-border hover:bg-accent'
                          }`}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="font-medium">{m.label}</span>
                            {note && (
                              <span className="mt-0.5 block text-xs text-muted-foreground">
                                {note}
                              </span>
                            )}
                          </span>
                          {on && (
                            <Check className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </Setting>

                {settings && settings.schedules.length > 0 && (
                  <Setting
                    title="Scheduled sessions"
                    /* "Nothing is sent" only ever meant the outbound side. A scheduled
                       run still reads and still calls the model with nobody watching,
                       which is the part a schedule is easiest to be wrong about. */
                    description={`Run while the app is open, and missed slots catch up on launch. Dry-run first: everything lands in the Inbox as cards, and nothing goes out to Jira, Confluence or your calendar. A run still reads your notes and sends them to ${providerInfo.name}, even when you are not at the machine.`}
                  >
                    {settings.schedules.map((sc) => (
                      <div key={sc.skill} className="rounded-lg border border-border bg-card p-3">
                        <div className="flex items-center justify-between gap-2">
                          {/* The skill's own name, not its filename — one vocabulary
                              wherever a skill is offered. */}
                          <span className="text-sm font-medium">
                            {skills.find((s) => s.name === sc.skill)?.title ??
                              sc.skill.replace(/-/g, ' ')}
                          </span>
                          <label className="flex items-center gap-1.5 text-sm">
                            <input
                              type="checkbox"
                              className="size-4 accent-primary"
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
                            onChange={(e) =>
                              setSchedule(sc.skill, { dayOfWeek: Number(e.target.value) })
                            }
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
                            onChange={(e) =>
                              setSchedule(sc.skill, { hour: Number(e.target.value) })
                            }
                          >
                            {Array.from({ length: 24 }, (_, h) => (
                              <option key={h} value={h}>
                                {String(h).padStart(2, '0')}:00
                              </option>
                            ))}
                          </select>
                          <Button
                            size="sm"
                            variant="outline"
                            className="ml-auto"
                            onClick={() => runNow(sc.skill)}
                          >
                            <Play className="size-3.5" aria-hidden />{' '}
                            {ran === sc.skill ? 'Running…' : 'Dry-run'}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </Setting>
                )}
              </SettingPanel>
            </TabsContent>

            <TabsContent value="connections">
              <SettingPanel>
                <ConnectionsSettings />
              </SettingPanel>
            </TabsContent>

            <TabsContent value="advanced">
              <SettingPanel>
                {settings && (
                  <Setting
                    title="MCP server (localhost)"
                    badge={
                      settings.mcp.running && (
                        <span className="flex items-center gap-1 text-xs text-brand">
                          <Check className="size-3.5" aria-hidden /> running
                        </span>
                      )
                    }
                    description={
                      <>
                        Let your own Claude or Cursor reach this memory through three tools:{' '}
                        <code>ask_product</code>, <code>log_decision</code> and{' '}
                        <code>draft_writeback</code>. Writes go through the same approval cards, and
                        the server only listens on this machine and only answers with the token.
                        What that does not cover: whatever app you connect can read your notes, and
                        it sends them on to its own model.
                      </>
                    }
                  >
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          checked={settings.mcp.enabled}
                          onChange={(e) => setMcp({ enabled: e.target.checked })}
                        />
                        Enabled
                      </label>
                      <span className="text-xs text-muted-foreground">port</span>
                      <McpPortInput
                        port={settings.mcp.port}
                        onCommit={(port) => setMcp({ port })}
                      />
                    </div>
                    {settings.mcp.enabled && settings.mcp.token && (
                      <McpConnection port={settings.mcp.port} token={settings.mcp.token} />
                    )}
                  </Setting>
                )}
              </SettingPanel>
            </TabsContent>

            <TabsContent value="privacy">
              <SettingPanel>
                {settings && (
                  <Setting
                    title="What leaves your machine"
                    /* The same switch, the same words and the same folded list as the
                       setup screen, from the same allowlist — a promise kept in two
                       places has to be one promise (docs/onboarding.md ONB-6). */
                    description="Nothing you or the agent wrote. Only whether the app worked, and who it stopped working for."
                  >
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4 accent-primary"
                        checked={settings.onboarding.telemetry}
                        onChange={(e) =>
                          trySave('Saving that choice', async () => {
                            setSettings(
                              await invoke['settings:setOnboarding']({
                                telemetry: e.target.checked,
                              }),
                            );
                          })
                        }
                      />
                      <span>
                        Send usage and crash reports
                        {/* Who the reports are tied to stays out in the open here too. */}
                        <span className="mt-0.5 block text-muted-foreground">
                          {TELEMETRY_IDENTITY}.
                        </span>
                      </span>
                    </label>
                    <TelemetryDetails />
                    <p className="text-sm text-muted-foreground">{TELEMETRY_PROCESSOR}</p>
                  </Setting>
                )}

                <Setting
                  title="Version and help"
                  badge={
                    <span className="font-mono text-xs text-muted-foreground">
                      {APP_NAME} {settings?.appVersion ?? '…'}
                    </span>
                  }
                  description="If something goes wrong, send us what the app knows about itself: version numbers, how many notes it has open, whether your keys can be read, and the last few lines of its own log. Nothing you have written is in there, and neither is your name, your folder or your keys. It does carry the install id, and with usage reports on, that id is what links the report back to you."
                >
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={copyDiagnostics}>
                      {copiedDiagnostics ? (
                        <Check className="size-3.5 text-brand" aria-hidden />
                      ) : (
                        <Copy className="size-3.5" aria-hidden />
                      )}
                      {copiedDiagnostics ? 'Copied' : 'Copy diagnostics'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={reportProblem}>
                      Report a problem
                    </Button>
                  </div>
                  {reportNote && <p className="text-sm text-muted-foreground">{reportNote}</p>}
                </Setting>
              </SettingPanel>
            </TabsContent>
          </div>
        </div>
      </Tabs>
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
              None yet. Connect a calendar under Connections, or add one here.
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
            <span
              key={e}
              className="flex items-center gap-1 rounded-sm bg-accent px-1.5 py-px text-xs"
            >
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
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={addAlias}
            disabled={!alias.trim()}
          >
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
