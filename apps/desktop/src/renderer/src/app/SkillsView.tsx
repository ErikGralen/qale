import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Plus, Sparkles, TriangleAlert, ChevronRight, Wand2 } from 'lucide-react';
import type { AgentDTO, SkillDTO } from '@qale/ipc';
import {
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@qale/ui';
import { useApp } from '../state/app-state';
import { invoke } from '../lib/ipc';
import { navFromEvent } from '../lib/nav';
import { relativeTime } from '../lib/dates';
import { PageHeader } from '../components/PageHeader';
import { NoteEditor } from '../components/NoteEditor';
import { CanChips } from '../components/RunnableConfig';
import { AgentSwitch } from '../components/AgentSwitch';
import { AgentLifeSigns, AgentBlockedNotice } from '../components/AgentLifeSigns';
import { askSelectionSeed } from '../lib/agent-nudges';
import {
  DEFAULT_SKILLS_TAB,
  MOMENTS,
  SKILLS_TABS,
  skillsTabLabel,
  tabForFile,
  type Moment,
  type SkillsTab,
} from '../lib/skills-tabs';

/**
 * The Skills page: one page, five tabs, everything the workspace configures the
 * agent with (SK-12).
 *
 * It was two pages and a shelf machinery that read `starts:` off the files. The
 * five tabs replace both, and each one answers a different question:
 *
 *   Skills       work you run
 *   House rules  what is always in force
 *   Moments      what the product fires by itself
 *   Voices       how a draft sounds
 *   Agents       what runs on a clock, and the only off switches
 *
 * Which tab a file lands on is decided once, in `lib/skills-tabs`, so a file
 * cannot show up twice and none can fall through. Tabs are Settings' tabs: the
 * active one lives on the view (deep links aim at it, and leaving the page and
 * coming back returns you to it), and anything broken behind a closed tab puts
 * a dot on that tab, because a tab must never be a place a failure hides.
 */

/**
 * The file behind a moment. Matched through `tabForFile` rather than on the
 * name alone, so a voice called "arrival" can never be picked up as one: the
 * two live in different address spaces and this is where that would leak.
 */
function momentFile(skills: SkillDTO[], moment: Moment): SkillDTO | undefined {
  return skills.find((s) => tabForFile(s) === 'moments' && s.name === moment.name);
}

/** One row's error list, in the flag voice. Pinned, never quiet. */
function RowErrors({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-col gap-1 rounded-md bg-destructive/8 px-2.5 py-1.5">
      {errors.map((e, i) => (
        <li key={i} className="flex items-start gap-1.5 text-xs text-destructive">
          <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span>{e}</span>
        </li>
      ))}
    </ul>
  );
}

/** The count of broken files, said the same way everywhere. */
function IssueFlag({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-destructive">
      <TriangleAlert className="size-3" aria-hidden />
      {count} issue{count === 1 ? '' : 's'}
    </span>
  );
}

const ROW =
  'group flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset focus-visible:outline-none';

const LIST =
  'flex flex-col divide-y divide-border overflow-hidden rounded-xl bg-card ring-1 ring-border';

/**
 * A file the whole row opens. The Skills, Moments and Voices tabs all use it:
 * the row is a door, and the file behind it is the editor for everything.
 * `above` is the one line the tab adds, and it is always code-owned — a
 * moment's trigger, never anything the file claims about itself.
 */
function FileRow({ file, above, meta }: { file: SkillDTO; above?: string; meta?: ReactNode }) {
  const { openDoc } = useApp();
  return (
    <li>
      <button
        className={ROW}
        onClick={(e) => void openDoc(file.path, navFromEvent(e))}
        title={`Open ${file.title}`}
      >
        <div className="min-w-0 flex-1">
          {above && (
            <p className="text-xs font-medium text-brand">
              {above} <span aria-hidden>→</span>
            </p>
          )}
          <div className="flex items-baseline gap-2">
            <span className="truncate text-sm font-semibold text-foreground">{file.title}</span>
            <IssueFlag count={file.errors.length} />
          </div>
          <p className="mt-0.5 text-dense text-muted-foreground">{file.summary}</p>
          {meta}
          <RowErrors errors={file.errors} />
        </div>
        <ChevronRight
          className="mt-0.5 size-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground"
          aria-hidden
        />
      </button>
    </li>
  );
}

/** A skill's own meta line: what it may do, and whether anything ever ran it. */
function SkillMeta({ skill }: { skill: SkillDTO }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      <CanChips can={skill.can} />
      <span className="text-xs text-muted-foreground/70">
        {skill.lastUsedMs ? `Used ${relativeTime(skill.lastUsedMs)}` : 'Not used yet'}
      </span>
    </div>
  );
}

/**
 * A moment whose file is not in the workspace. It cannot be a quiet gap: the
 * product still fires at that moment, and the session it starts would be one
 * with no instructions.
 */
function MissingMoment({ moment }: { moment: Moment }) {
  return (
    <li className="flex items-start gap-1.5 px-3 py-2.5 text-xs text-destructive">
      <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
      <span>
        {moment.when}, Qale runs <span className="font-mono">{moment.name}</span>, and that file is
        not here. It comes back the next time this workspace opens.
      </span>
    </li>
  );
}

/**
 * An agent row, folded in from the deleted Agents page. The switch is real: off
 * is written into the file's frontmatter and stops the sweep, it does not just
 * hide the row. The whole row is still the door, so the title button's ::after
 * stretches over it and the switch sits above that on its own `relative`.
 */
function AgentRow({ agent }: { agent: AgentDTO }) {
  const { openDoc, setAgentEnabled } = useApp();
  return (
    <li className="group relative flex items-start gap-3 px-4 py-3 transition-colors hover:bg-accent/50">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <button
            className="truncate rounded text-sm font-semibold text-foreground after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring/50 focus-visible:after:ring-inset"
            onClick={(e) => void openDoc(agent.path, navFromEvent(e))}
            title={`Open ${agent.title}`}
          >
            {agent.title}
          </button>
          <IssueFlag count={agent.errors.length} />
        </div>
        <p className="mt-0.5 text-dense text-muted-foreground">{agent.summary}</p>
        <AgentLifeSigns agent={agent} className="mt-1" />
        <AgentBlockedNotice agent={agent} className="mt-2" />
      </div>

      <span className="relative mt-0.5">
        <AgentSwitch
          enabled={agent.enabled}
          label={agent.title}
          onToggle={(enabled) => void setAgentEnabled(agent.id, enabled)}
        />
      </span>
      <ChevronRight
        className="mt-0.5 size-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground"
        aria-hidden
      />
    </li>
  );
}

/**
 * The House rules tab: the one document, edited where it is listed. No list and
 * no row, because there is only ever one of them — a list of one is a click
 * that tells you nothing.
 *
 * The same editor every note uses, not a second implementation of one. The full
 * page (title, history, delete) is one click away for the rare time it is
 * wanted.
 */
function HouseRulesPanel({ file }: { file: SkillDTO | undefined }) {
  const { docData, loadDoc, saveNote, openDoc, openSession, search } = useApp();
  const path = file?.path;

  useEffect(() => {
    if (path) void loadDoc(path);
  }, [path, loadDoc]);

  if (!file || !path) {
    return (
      <p className="text-dense text-muted-foreground">
        The house rules file is not in this workspace. It comes back the next time this workspace
        opens.
      </p>
    );
  }

  // Three states, said apart: not read yet, read and unreadable, here.
  const loaded = docData[path];
  const note = loaded?.note;

  return (
    <div>
      <p className="mb-3 text-dense text-muted-foreground">
        Every session reads this before it starts: which language things come out in, how a note is
        written, where it lands, and the rules you have given Qale yourself. It is always in
        force. Edit a line and the next session works the new way.
      </p>
      <RowErrors errors={file.errors} />

      {/* pl-8 on top of the panel's own px-6 makes the 56px left gutter the
          block handle (+ ⋮⋮) needs. Without it the handle lands outside the
          scroll container and is clipped away. */}
      {note ? (
        <div className="border-t border-border pt-4 pl-8">
          <NoteEditor
            key={path}
            body={note.body}
            onSave={(body) => saveNote(path, body)}
            onOpenNote={openDoc}
            searchNotes={search}
            onAsk={(text) =>
              openSession('ask', {
                initialPrompt: askSelectionSeed(path, text),
                title: `Ask: ${file.title}`,
                fresh: true,
              })
            }
          />
        </div>
      ) : (
        <p className="text-dense text-muted-foreground">
          {loaded ? 'This file could not be read.' : 'Reading the house rules…'}
        </p>
      )}

      <p className="mt-3 text-xs text-muted-foreground/70">
        <button
          className="rounded font-medium text-brand underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={(e) => void openDoc(path, navFromEvent(e))}
        >
          Open as a page
        </button>{' '}
        for its history.
      </p>
    </div>
  );
}

/** One option in the New-skill menu: what the thing should do. */
function CreateOption({
  label,
  detail,
  onClick,
}: {
  label: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      className="w-full rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      onClick={onClick}
    >
      <span className="block text-sm font-medium text-foreground">{label}</span>
      <span className="block text-xs text-muted-foreground">{detail}</span>
    </button>
  );
}

/** A name box: the one question left once the kind is chosen. */
function NameStep({
  placeholder,
  hint,
  busy,
  onCreate,
  onCancel,
}: {
  placeholder: string;
  hint: string;
  busy: boolean;
  onCreate: (title: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  return (
    <div className="flex flex-col gap-2 p-1">
      <p className="px-1 text-xs text-muted-foreground">{hint}</p>
      <Input
        autoFocus
        className="h-8 text-sm"
        placeholder={placeholder}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && title.trim()) onCreate(title.trim());
          else if (e.key === 'Escape') onCancel();
        }}
        aria-label={placeholder}
      />
      <div className="flex items-center gap-1.5">
        <Button size="sm" disabled={busy || !title.trim()} onClick={() => onCreate(title.trim())}>
          Create
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * New skill (SK-13). One question first: what should it do? The four answers
 * are the four things this page holds that a person can add, and each one goes
 * somewhere different. Nobody ever sees a frontmatter key; the flow writes it.
 *
 * A name is asked for only where a name is an address that can never change: a
 * skill's folder and a voice's filename are what the runtime resolves and what
 * every stored receipt cites. A house rule is a bullet in a document and a
 * moment already exists, so neither needs one.
 *
 * An anchored menu, not a wizard: this is one small decision made beside the
 * button that raised it.
 */
type CreateStep = 'menu' | 'name-skill' | 'name-voice' | 'moment';

function NewSkill({ onTab }: { onTab: (tab: SkillsTab) => void }) {
  const { skills, openDoc, refreshSkills } = useApp();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<CreateStep>('menu');
  const [busy, setBusy] = useState(false);

  const close = useCallback(() => {
    setOpen(false);
    setStep('menu');
  }, []);

  const create = useCallback(
    async (channel: 'skills:create' | 'voices:create', title: string, tab: SkillsTab) => {
      if (busy) return;
      setBusy(true);
      try {
        const { path } = await invoke[channel](title);
        await refreshSkills();
        close();
        onTab(tab);
        void openDoc(path);
      } finally {
        setBusy(false);
      }
    },
    [busy, close, onTab, openDoc, refreshSkills],
  );

  const moments = MOMENTS.map((m) => ({ moment: m, file: momentFile(skills, m) }));

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setStep('menu');
      }}
    >
      <PopoverTrigger asChild>
        <Button size="sm">
          <Plus className="size-3.5" /> New skill
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-1.5">
        {step === 'menu' && (
          <div className="flex flex-col">
            <p className="px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
              What should it do?
            </p>
            <CreateOption
              label="Something I’ll ask for"
              detail="Work you hand over, like the weekly update."
              onClick={() => setStep('name-skill')}
            />
            <CreateOption
              label="A rule Qale always follows"
              detail="One line in the house rules, in force everywhere."
              onClick={() => {
                close();
                onTab('house-rules');
              }}
            />
            <CreateOption
              label="How I sound"
              detail="A voice, applied when something is drafted."
              onClick={() => setStep('name-voice')}
            />
            <CreateOption
              label="Do more at a moment"
              detail="Add to what Qale already does when something happens."
              onClick={() => setStep('moment')}
            />
          </div>
        )}

        {step === 'name-skill' && (
          <NameStep
            placeholder="What should it be called?"
            hint="Name it. Short, lowercase."
            busy={busy}
            onCreate={(title) => void create('skills:create', title, 'skills')}
            onCancel={close}
          />
        )}

        {step === 'name-voice' && (
          <NameStep
            placeholder="Who is it for, or how does it sound?"
            hint="A voice sets tone and language. It never decides what a draft says."
            busy={busy}
            onCreate={(title) => void create('voices:create', title, 'voices')}
            onCancel={close}
          />
        )}

        {step === 'moment' && (
          <div className="flex flex-col">
            <p className="px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
              Which moment? Its instructions are yours to add to.
            </p>
            {moments.map(({ moment, file }) => (
              <CreateOption
                key={moment.name}
                label={moment.when}
                detail={file ? file.title : 'This file is not in the workspace yet.'}
                onClick={() => {
                  close();
                  onTab('moments');
                  if (file) void openDoc(file.path);
                }}
              />
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function SkillsView({ viewKey, section }: { viewKey: string; section?: SkillsTab }) {
  const { skills, agents, openSession, setSkillsTab } = useApp();
  const active = section ?? DEFAULT_SKILLS_TAB;

  const byTitle = useCallback((a: SkillDTO, b: SkillDTO) => a.title.localeCompare(b.title), []);

  // One derivation for every list on the page. A file the workspace holds is on
  // exactly one of these, and `tabForFile` is what decides which.
  const runnables = useMemo(
    () => [...skills].filter((s) => tabForFile(s) === 'skills').sort(byTitle),
    [skills, byTitle],
  );
  const voices = useMemo(
    () => [...skills].filter((s) => tabForFile(s) === 'voices').sort(byTitle),
    [skills, byTitle],
  );
  const houseRules = useMemo(() => skills.find((s) => tabForFile(s) === 'house-rules'), [skills]);
  // The roster leads, not the folder: the trigger is the fact, and a file that
  // is not there has to say so rather than leave the list one row shorter.
  const moments = useMemo(
    () => MOMENTS.map((m) => ({ moment: m, file: momentFile(skills, m) })),
    [skills],
  );

  const counts: Record<SkillsTab, number | undefined> = {
    skills: runnables.length || undefined,
    'house-rules': undefined,
    moments: moments.length,
    voices: voices.length || undefined,
    agents: agents.length || undefined,
  };

  // A dot on the tab that holds a broken file. Filing something behind a tab
  // costs nothing only while a failure behind it can still shout.
  const flagged: Partial<Record<SkillsTab, string>> = {};
  for (const s of skills) {
    if (s.errors.length > 0) flagged[tabForFile(s)] = 'Something here needs fixing';
  }
  if (agents.some((a) => a.errors.length > 0)) flagged.agents = 'Something here needs fixing';
  else if (agents.some((a) => a.status === 'blocked')) flagged.agents = 'An agent cannot run';

  const errorCount = skills.reduce((n, s) => n + (s.errors.length > 0 ? 1 : 0), 0);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={Wand2}
        crumbs={[{ label: 'Skills' }]}
        label={skillsTabLabel(active)}
        meta={counts[active]}
      >
        {errorCount > 0 && (
          <span className="flex items-center gap-1 text-xs font-medium text-destructive">
            <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
            {errorCount} to fix
          </span>
        )}
        <NewSkill onTab={(tab) => setSkillsTab(viewKey, tab)} />
      </PageHeader>

      <Tabs
        value={active}
        onValueChange={(v) => setSkillsTab(viewKey, v as SkillsTab)}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        {/* The 5px under the list is what the underline needs: the line variant
            draws it 5px below the trigger, so without the room it lands past
            the hairline the strip carries. */}
        <div className="shrink-0 border-b border-border px-4 pb-[5px]">
          <TabsList variant="line" className="h-9 gap-1 p-0">
            {SKILLS_TABS.map((t) => (
              <TabsTrigger
                key={t.id}
                value={t.id}
                title={flagged[t.id]}
                className="gap-1.5 px-2 text-[0.8125rem]"
              >
                <t.icon className="size-3.5" aria-hidden />
                {t.label}
                {flagged[t.id] && (
                  <>
                    <span className="size-1.5 shrink-0 rounded-full bg-warning" aria-hidden />
                    <span className="sr-only">, needs attention</span>
                  </>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="w-full max-w-2xl">
            {/* The one sentence that says what the whole page is. */}
            <p className="mb-4 text-dense text-muted-foreground">
              Skills are work you run, house rules are always in force, moments fire when the
              product acts, voices shape a draft, and agents run on clocks.
            </p>

            <TabsContent value="skills">
              {runnables.length === 0 ? (
                <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                  <div className="flex size-12 items-center justify-center rounded-full bg-brand/10">
                    <Wand2 className="size-6 text-brand" aria-hidden />
                  </div>
                  <h2 className="text-lg font-semibold">No skills yet</h2>
                  <p className="max-w-sm text-sm text-muted-foreground">
                    Write one yourself with New skill, or ask the librarian to draft one for you.
                  </p>
                </div>
              ) : (
                <>
                  <p className="mb-2 text-dense text-muted-foreground">
                    Run one from the composer, or let the agent pick it up when a session turns into
                    that work. Deleting a skill is how you stop asking for it.
                  </p>
                  <ul className={LIST}>
                    {runnables.map((s) => (
                      <FileRow key={s.path} file={s} meta={<SkillMeta skill={s} />} />
                    ))}
                  </ul>
                </>
              )}
            </TabsContent>

            <TabsContent value="house-rules">
              <HouseRulesPanel file={houseRules} />
            </TabsContent>

            <TabsContent value="moments">
              <p className="mb-2 text-dense text-muted-foreground">
                What Qale does the moment something happens. These cannot be switched off, and what
                fires them lives in the app, not in the file. The instructions are yours to edit.
                Each row below says when it fires.
              </p>
              <ul className={LIST}>
                {moments.map(({ moment, file }) =>
                  file ? (
                    <FileRow key={moment.name} file={file} above={moment.when} />
                  ) : (
                    <MissingMoment key={moment.name} moment={moment} />
                  ),
                )}
              </ul>
            </TabsContent>

            <TabsContent value="voices">
              <p className="mb-2 text-dense text-muted-foreground">
                A voice is how a draft sounds: which words, how long, how formal. It is applied when
                something is drafted, and it never decides what the draft says. Switch it from the
                dropdown in the draft panel.
              </p>
              {voices.length === 0 ? (
                <p className="px-1 py-8 text-center text-sm text-muted-foreground">
                  No voices yet. Add one with New skill.
                </p>
              ) : (
                <ul className={LIST}>
                  {voices.map((v) => (
                    <FileRow key={v.path} file={v} />
                  ))}
                </ul>
              )}
            </TabsContent>

            <TabsContent value="agents">
              <p className="mb-2 text-dense text-muted-foreground">
                Agents start themselves, on a clock the app keeps. Everything they produce waits in
                the Inbox for your approval. These are the only switches on this page.
              </p>
              {agents.length === 0 ? (
                <p className="px-1 py-8 text-center text-sm text-muted-foreground">
                  No agents yet. The built-in ones are seeded when a workspace opens.
                </p>
              ) : (
                <ul className={LIST}>
                  {agents.map((a) => (
                    <AgentRow key={a.id} agent={a} />
                  ))}
                </ul>
              )}
            </TabsContent>

            <p className="mt-7 flex items-center gap-1.5 pb-4 text-xs text-muted-foreground/70">
              <Sparkles className="size-3" aria-hidden />
              Every skill is a file you can read and edit. Ask the{' '}
              <button
                className="rounded font-medium text-brand underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                onClick={() =>
                  openSession('librarian', { initialPrompt: 'Help me write or adjust a skill.' })
                }
              >
                librarian
              </button>{' '}
              to draft one for you.
            </p>
          </div>
        </div>
      </Tabs>
    </div>
  );
}
