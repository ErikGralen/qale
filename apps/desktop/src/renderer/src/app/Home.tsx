import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import {
  CalendarClock,
  ChevronRight,
  CircleHelp,
  FileClock,
  FileUp,
  FolderOpen,
  FolderTree,
  House,
  Inbox,
  Layers,
  ListTodo,
  MessageSquare,
  Mic,
  PenLine,
  Search,
  SquarePen,
  TriangleAlert,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@qale/ui';
import { isFolderIndex } from '@qale/domain';
import type { NoteRefDTO } from '@qale/ipc';
import { useApp } from '../state/app-state';
import { useChatMentions } from './ChatMentions';
import { SkillPicker } from './SkillPicker';
import { PageHeader } from '../components/PageHeader';
import { NewWorkspace } from '../components/NewWorkspace';
import {
  COMPOSER_INPUT,
  COMPOSER_ROW,
  COMPOSER_SHELL,
  MentionHint,
  SendButton,
  useAutoGrow,
} from '../components/Composer';
import { FirstSteps, firstStepsShowing } from '../onboarding/FirstSteps';
import { contentNotes } from '../lib/contexts';
import { isBulkPaste, requestCapture } from '../lib/capture-event';
import { navFromEvent, type NavOpts } from '../lib/nav';
import { localDateStr } from '../lib/dates';
import {
  homeRows,
  type AttentionKind,
  type AttentionRow,
  type AttentionTarget,
  type AttentionTone,
} from '../lib/attention';

/**
 * Home — the gateway (⇧⌘H, ⌘T, the sidebar's first row, and what an empty
 * workbench falls back to).
 *
 * Shaped for the ninety seconds between meetings, in one column, in reading
 * order: who and when you are (with the two creation verbs at hand) → what is
 * actually waiting on you → the bar that asks, with its starter verbs touching
 * it (they seed the bar; apart they read as unrelated furniture). The work
 * still comes first in reading order, but the bar is the page's centerpiece:
 * the waiting list is a quiet flat list, the starters are borderless chips
 * centered under the bar, and the composer is the only card on the page — one
 * open field on a page of ink. Nothing below the fold, no dashboard, no
 * metrics: every line is either an action or a fact with a destination.
 */
export function Home() {
  const { vault, openVaultDialog } = useApp();
  // The composer's text lives out here because two things write it: the PO
  // typing, and a starter below the bar handing it a first sentence.
  const [ask, setAsk] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  if (!vault) return <NoWorkspace onOpen={openVaultDialog} />;

  /** Load a starter into the bar and hand the PO the caret after it — the
   *  starter opens the sentence, it never sends it. */
  const seed = (text: string) => {
    setAsk(text);
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader icon={House} label="Home" meta={vault.name} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[640px] flex-col gap-6 px-8 pt-[clamp(48px,13vh,144px)] pb-16">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
            <Greeting />
            <QuickActions />
          </div>
          <Notices />
          {/* Above the waiting list on purpose: on day one there is nothing
              waiting, and these are the moves that change that. It takes
              itself off the page once they are done (ONB-8). */}
          <FirstSteps />
          <Waiting />
          {/* Extra air on top of the column gap: the pause before the page's
              centerpiece is part of what makes it the centerpiece. */}
          <div className="mt-4 flex flex-col gap-3">
            <HomeComposer ask={ask} setAsk={setAsk} inputRef={inputRef} />
            <Starters onPick={seed} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** A clock the page can render against: re-reads the time every `ms`, so a Home
 *  tab left open past noon still greets the afternoon and "in 20m" keeps counting. */
function useNow(ms = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

function greetingFor(hour: number): string {
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * The one display-face moment in the app (DESIGN §3: Fraunces for content and
 * landing moments, never for chrome). The line under it is the day, plus the
 * one fact that changes how the day is read — how many meetings are in it.
 */
function Greeting() {
  const { people, tree } = useApp();
  const now = useNow();
  const date = new Date(now);

  const first = people?.self.name?.trim().split(/\s+/)[0];
  const greeting = greetingFor(date.getHours());
  const today = localDateStr(date);

  const meetingsToday = useMemo(
    () => meetingNotes(tree).filter((n) => n.date?.slice(0, 10) === today).length,
    [tree, today],
  );

  return (
    <div className="space-y-1">
      <h1 className="font-serif text-greeting leading-tight font-semibold tracking-tight text-balance">
        {first ? `${greeting}, ${first}` : greeting}
      </h1>
      <p className="text-sm text-muted-foreground">
        {date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
        {meetingsToday > 0 && (
          <>
            <span className="px-1.5 text-muted-foreground/60">·</span>
            {meetingsToday} meeting{meetingsToday === 1 ? '' : 's'} today
          </>
        )}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick actions — the two creation verbs, always in the same corner
// ---------------------------------------------------------------------------

/**
 * New note and Add material, opposite the greeting. These are the app's two
 * ways of putting something *in* (the bar below only asks), and they sit up
 * here rather than inside the composer strip so a new user sees both verbs
 * before they ever focus the bar. Same instruments as ⌘N and ⇧⌘N — the
 * buttons are the visible half of those shortcuts.
 */
function QuickActions() {
  const { captureNote, openDoc } = useApp();

  const newNote = async () => {
    // Mirrors App's ⌘N: a blank note straight into the editor.
    const note = await captureNote({ body: '', summary: 'Untitled' });
    await openDoc(note.path);
  };

  return (
    <div className="mt-1 flex shrink-0 items-center gap-1.5">
      <Button variant="outline" size="sm" title="New note (⌘N)" onClick={() => void newNote()}>
        <SquarePen className="size-3.5 text-muted-foreground" aria-hidden /> New note
      </Button>
      <Button
        variant="outline"
        size="sm"
        title="Add a transcript, link or screenshot (⇧⌘N)"
        onClick={() => requestCapture()}
      >
        <FileUp className="size-3.5 text-muted-foreground" aria-hidden /> Add material
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composer — the front door for questions
// ---------------------------------------------------------------------------

/**
 * The app's front door for questions: the same composer shell as the session and the
 * browse pages. Typing asks the memory; a pasted transcript or screenshot
 * still routes to capture (material is material wherever it lands), but the
 * standing "put something in" affordances live in QuickActions above, so the
 * strip here stays about the question. Nothing is written anywhere either way
 * — the question opens a session, the paste opens the capture card.
 *
 * The skill picker is the same instrument as the session composer's: without a
 * pick the question opens an Ask, with one it opens that skill instead. The
 * verb chips at the foot of the page are the shortcut for a skill with nothing
 * to say to it; this is the same start with a first sentence attached.
 */
function HomeComposer({
  ask,
  setAsk,
  inputRef,
}: {
  ask: string;
  setAsk: (text: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const { tree, skills, openSession } = useApp();
  const [pickedSkill, setPickedSkill] = useState<string | null>(null);
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const mentions = useChatMentions(tree, inputRef, ask, setAsk);
  useAutoGrow(inputRef, ask);

  const run = () => {
    const q = ask.trim();
    if (!q) return;
    setAsk('');
    // One start, not a mode: the pick is spent on the session it opens, so the
    // bar you come back to is the plain front door again.
    setPickedSkill(null);
    openSession(pickedSkill ?? 'ask', { initialPrompt: q });
  };

  return (
    <div className={COMPOSER_SHELL}>
      {mentions.menu}
      <textarea
        ref={inputRef}
        value={ask}
        autoFocus
        onChange={(e) => {
          setAsk(e.target.value);
          mentions.refresh();
        }}
        onKeyDown={(e) => {
          if (mentions.onKeyDown(e)) return;
          // `/` on an empty composer opens the skill menu — the same keyboard
          // vocabulary as `@` for notes and `#` for contexts.
          if (e.key === '/' && ask.length === 0) {
            e.preventDefault();
            setSkillMenuOpen(true);
            return;
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            run();
          } else if (e.key === 'Escape' && ask) {
            e.stopPropagation();
            setAsk('');
          }
        }}
        onPaste={(e) => {
          const image = Array.from(e.clipboardData.files).find((f) => f.type.startsWith('image/'));
          if (image) {
            e.preventDefault();
            const reader = new FileReader();
            reader.onload = () =>
              requestCapture({
                files: [
                  {
                    name: image.name || 'pasted-image.png',
                    dataBase64: String(reader.result).split(',')[1] ?? '',
                  },
                ],
              });
            reader.readAsDataURL(image);
            return;
          }
          // A wall of text pasted into an empty bar is material, not a question.
          const text = e.clipboardData.getData('text/plain');
          if (!ask.trim() && isBulkPaste(text)) {
            e.preventDefault();
            requestCapture({ text });
          }
        }}
        onClick={mentions.refresh}
        onBlur={mentions.close}
        placeholder={
          pickedSkill
            ? `What should “${skills.find((s) => s.name === pickedSkill)?.title ?? pickedSkill}” work on?`
            : 'Ask the memory, or paste a transcript to file it'
        }
        aria-label="Ask the memory"
        // Two lines deep at rest — unlike the docked bars, this field is the
        // page's centerpiece, and the extra line is what says so. `useAutoGrow`
        // never shrinks below the rows floor.
        rows={2}
        className={COMPOSER_INPUT}
      />
      <div className={COMPOSER_ROW}>
        <SkillPicker
          picked={pickedSkill}
          onPick={setPickedSkill}
          onClosed={() => inputRef.current?.focus()}
          open={skillMenuOpen}
          onOpenChange={setSkillMenuOpen}
        />
        {/* The lead carries its own word already; the hint steps aside as soon
            as a skill is picked so the strip never runs two deep. */}
        <MentionHint show={!ask.trim() && !pickedSkill} />
        <SendButton ready={!!ask.trim()} onClick={run} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Starters — what to ask, not what is wrong
// ---------------------------------------------------------------------------

/** All meeting notes in the workspace (index files aren't meetings). */
function meetingNotes(tree: ReturnType<typeof useApp>['tree']): NoteRefDTO[] {
  const group = tree?.groups.find((g) => g.type === 'meeting');
  return (group?.notes ?? []).filter(
    (n) => !isFolderIndex(n.path) && n.eventStatus !== 'cancelled',
  );
}

interface Starter {
  /** What the row reads. A trailing `…` means the sentence wants finishing. */
  label: string;
  /** What lands in the bar, when that differs from the label — an unfinished
   *  starter loads without its ellipsis and with the space already typed. */
  text?: string;
}

interface Category {
  id: string;
  /** The verb, in the PO's own vocabulary. */
  label: string;
  icon: LucideIcon;
  starters: Starter[];
}

/**
 * The five verbs the memory answers to, each opening onto the sentences that
 * verb actually starts.
 *
 * These are deliberately not the skill catalogue. A skill name answers "what
 * does this workspace have installed"; a PO between meetings is asking "what
 * can I get out of this right now", and the honest answer is a sentence, not a
 * noun. The session that runs is still chosen the same way it is for anything
 * typed into the bar — the starter only writes the first line.
 */
const CATEGORIES: Category[] = [
  {
    id: 'draft',
    label: 'Draft',
    icon: PenLine,
    starters: [
      { label: "Draft this week's update" },
      { label: 'Summarise where we landed for the exec team' },
      { label: 'Write a customer note about what shipped' },
      { label: 'Draft a one-pager for…', text: 'Draft a one-pager for ' },
      { label: 'Write up a decision we just made' },
    ],
  },
  {
    id: 'analyse',
    label: 'Analyse',
    icon: Layers,
    starters: [
      { label: 'Find the pattern across recent interviews' },
      { label: 'What actually changed this week?' },
      { label: 'What is the evidence behind…', text: 'What is the evidence behind ' },
      { label: 'Is this one loud account or a real pattern?' },
      { label: 'Compare what two customers are asking for' },
    ],
  },
  {
    id: 'recall',
    label: 'Look up',
    icon: Search,
    starters: [
      { label: 'What did we decide about…', text: 'What did we decide about ' },
      { label: 'What have we told this customer so far?' },
      { label: 'Where did this claim come from?' },
      { label: 'Who asked for this, and when?' },
      { label: 'What is still unanswered?' },
    ],
  },
  {
    id: 'prep',
    label: 'Prep',
    icon: CalendarClock,
    starters: [
      { label: 'Brief me for my next meeting' },
      { label: 'What should I ask in this interview?' },
      { label: 'What is unresolved with…', text: 'What is unresolved with ' },
      { label: 'What did we promise them last time?' },
      { label: 'What has changed since we last spoke?' },
    ],
  },
  {
    id: 'tidy',
    label: 'Tidy',
    icon: FolderTree,
    starters: [
      { label: 'File the notes I dumped in' },
      { label: 'What has gone stale?' },
      { label: 'Find broken links and orphaned notes' },
      { label: 'Which decisions have been superseded?' },
      { label: 'Which commitments are slipping?' },
    ],
  },
];

/**
 * The verb row directly under the composer — centered beneath the bar so the
 * chips read as part of the composer block, not a stray list item at the
 * margin. Borderless: five quiet words, not five more cards.
 *
 * The chips stay put and act as tabs. Opening a category stacks its sentences
 * as quiet centered rows below the row — no card, no header, no chrome; the
 * active chip is the label and pressing it (or Escape) folds the stack away.
 * Picking a starter loads it into the bar above, folds the stack, and stops
 * there — nothing is opened, nothing is sent, and the PO edits a sentence they
 * can see rather than watching a session start on a guess. Last on the page,
 * so the stack grows downward into free space instead of shoving the waiting
 * list around.
 */
function Starters({ onPick }: { onPick: (text: string) => void }) {
  const { tree } = useApp();
  const [openId, setOpenId] = useState<string | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const open = CATEGORIES.find((c) => c.id === openId) ?? null;

  /** Closing returns the focus to the chip that opened, so the keyboard never
   *  lands back at the top of the page. */
  const close = () => {
    setOpenId(null);
    requestAnimationFrame(() => {
      rowRef.current?.querySelector<HTMLButtonElement>(`[data-cat="${openId}"]`)?.focus();
    });
  };

  // Day one has nothing for these to read: "Draft this week's update" against
  // an empty memory is a promise the workspace can't keep yet. The capture
  // invitation above is the only move, so it gets the space to itself.
  if (contentNotes(tree).length === 0) return null;

  return (
    <div
      className="flex flex-col gap-1.5"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          close();
        }
      }}
    >
      <div ref={rowRef} className="flex flex-wrap justify-center gap-1">
        {CATEGORIES.map((c, i) => (
          <button
            key={c.id}
            data-cat={c.id}
            // Each chip rises in behind the one before it — the only motion on
            // the page, and purely an entrance: the resting state is already
            // visible, so a skipped animation still renders the row.
            className={`flex h-8 shrink-0 animate-in items-center gap-1.5 rounded-lg px-2.5 text-dense font-medium fill-mode-both duration-300 ease-out fade-in slide-in-from-bottom-1 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:animate-none ${
              openId === c.id
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground transition-colors hover:bg-accent hover:text-foreground motion-reduce:transition-none'
            }`}
            style={{ animationDelay: `${i * 45}ms` }}
            aria-expanded={openId === c.id}
            onClick={() => setOpenId(openId === c.id ? null : c.id)}
          >
            <c.icon className="size-3.5 shrink-0 opacity-70" aria-hidden />
            <span>{c.label}</span>
          </button>
        ))}
      </div>
      {open && (
        // Keyed by category so switching tabs re-runs the entrance — otherwise
        // the swap is an instant text change with no cue that anything moved.
        <ul
          key={open.id}
          className="flex animate-in flex-col items-center duration-200 ease-out fade-in slide-in-from-top-1 motion-reduce:animate-none"
        >
          {open.starters.map((s) => (
            <li key={s.label} className="max-w-full">
              <button
                className="max-w-full truncate rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none"
                onClick={() => {
                  setOpenId(null);
                  onPick(s.text ?? s.label);
                }}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notices — what this machine or this folder takes away from the app
// ---------------------------------------------------------------------------

const isMac = navigator.userAgent.includes('Macintosh');
const isWindows = navigator.userAgent.includes('Windows');
/** Where the Windows installer lives. Opens in the browser, like every link here. */
const GIT_FOR_WINDOWS = 'https://git-scm.com/download/win';

/**
 * Dismissed notices, per workspace: `qale.homeNotices.v1:<workspace path>` → ids.
 * View-only state, like the Inbox's review asks — the answer is "I know, leave
 * me alone", which is about this person and this machine, not about the memory,
 * so it never goes near the workspace itself.
 */
const NOTICE_KEY = 'qale.homeNotices.v1';

function dismissedNotices(vaultPath: string): string[] {
  try {
    const raw = localStorage.getItem(`${NOTICE_KEY}:${vaultPath}`);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function persistDismissedNotice(vaultPath: string, id: string): void {
  try {
    const next = [...new Set([...dismissedNotices(vaultPath), id])];
    localStorage.setItem(`${NOTICE_KEY}:${vaultPath}`, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
}

interface Notice {
  id: string;
  title: string;
  body: ReactNode;
}

/** The one-line fix, kept on one line: a command broken across a wrap is a
 *  command someone retypes wrong. */
function Command({ children }: { children: string }) {
  return <code className="font-mono text-[0.95em] whitespace-nowrap">{children}</code>;
}

/**
 * The two facts that quietly change what this workspace can do: no git (no
 * history, no undo) and a folder someone else's sync client is also writing to.
 *
 * Said once, here, because Home is the page everyone lands on and the only
 * other mention of either lives inside dialogs most people never open. A row,
 * not a modal: neither is an emergency, both may be a deliberate choice, and
 * dismissing sticks for this workspace. Settings keeps the standing version for
 * anyone who dismissed and later wondered.
 */
function Notices() {
  const { vault } = useApp();
  const path = vault?.path ?? '';
  const [dismissed, setDismissed] = useState<string[]>(() => (path ? dismissedNotices(path) : []));
  useEffect(() => setDismissed(path ? dismissedNotices(path) : []), [path]);

  if (!vault) return null;

  const notices: Notice[] = [];
  if (!vault.gitAvailable) {
    notices.push({
      id: 'no-git',
      title: 'No version history on this computer',
      body: (
        <>
          Git isn't installed, so nothing keeps earlier versions of a note and there is no way to
          undo what the agent wrote.{' '}
          {isMac ? (
            <>
              To turn it on, run <Command>xcode-select --install</Command> in Terminal, then reopen
              the workspace.
            </>
          ) : isWindows ? (
            <>
              To turn it on, install{' '}
              <a
                href={GIT_FOR_WINDOWS}
                target="_blank"
                rel="noreferrer"
                className={`rounded-sm font-medium underline underline-offset-2 ${FOCUS_RING}`}
              >
                Git for Windows
              </a>
              , then reopen the workspace.
            </>
          ) : (
            'To turn it on, install git, then reopen the workspace.'
          )}
        </>
      ),
    });
  }
  // Windows only, and never dismissed by the platform check: `pathTooDeep` is
  // false everywhere else, so this costs a macOS reader nothing.
  if (vault.pathTooDeep) {
    notices.push({
      id: 'deep-path',
      title: 'This folder sits too deep for Windows',
      body: 'Windows cannot open a file whose full path is longer than 260 characters, so notes and session files in here can fail to save. Make a workspace nearer the top of the drive, like C:\\Qale, and move these files into it.',
    });
  }
  if (vault.syncedBy) {
    notices.push({
      id: 'synced-folder',
      title: 'This workspace is in a synced folder',
      body: `${vault.syncedBy} is syncing this folder too, and when two programs write the same files at once, edits can go missing and search can stop working. A plain folder on this computer is safer.`,
    });
  }

  const shown = notices.filter((n) => !dismissed.includes(n.id));
  if (shown.length === 0) return null;

  const dismiss = (id: string) => {
    setDismissed((ids) => [...ids, id]);
    persistDismissedNotice(path, id);
  };

  return (
    <div className="flex flex-col gap-2">
      {shown.map((n) => (
        <div
          key={n.id}
          className="flex items-start gap-2.5 rounded-xl bg-warning/8 px-3.5 py-3 ring-1 ring-warning/20"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{n.title}</div>
            <div className="mt-0.5 text-sm text-muted-foreground">{n.body}</div>
          </div>
          <button
            className="-mr-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none"
            onClick={() => dismiss(n.id)}
            aria-label="Dismiss"
            title="Dismiss"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Waiting — Home's view of the one attention list
// ---------------------------------------------------------------------------

const TONE_CLASS: Record<AttentionTone, string> = {
  brand: 'text-brand',
  warning: 'text-warning',
  muted: 'text-muted-foreground',
};

/** One glyph per kind of attention — the same vocabulary the rest of the app
 *  uses for these places. */
const KIND_ICON: Record<AttentionKind, LucideIcon> = {
  question: CircleHelp,
  card: Inbox,
  result: MessageSquare,
  meeting: CalendarClock,
  review: FileClock,
  capture: Mic,
  todo: ListTodo,
};

/** How many rows Home will show before it stops — the rest live in the views
 *  they belong to, and a list you scroll is not a ninety-second read. */
const MAX_ROWS = 4;

/**
 * Home's "Waiting on you": `homeRows` over the app's one attention list — the
 * top four, with cards, unfiled meetings and due commitments each behind one
 * door. Home computes no count of its own; every number here is a filter over
 * the same list the sidebar badge and the Inbox read (lib/attention.ts).
 */
function Waiting() {
  const {
    tree,
    settings,
    attention,
    openInbox,
    openTodos,
    openDoc,
    openChat,
    openFolder,
    dismissCapture,
    undoCapture,
  } = useApp();
  const now = useNow();
  /**
   * The series that just went quiet, if one did. Dismissing two meetings from
   * the same recurring sync stops it asking for good, which is a bigger thing
   * than the click looked like — so the row's place says what happened and
   * offers the way back, until the PO leaves the page.
   */
  const [muted, setMuted] = useState<{ path: string; series: string } | null>(null);
  /** Whether the folded group of empty meetings is open. Nothing else folds. */
  const [unfolded, setUnfolded] = useState(false);

  const rows = useMemo(() => homeRows(attention, MAX_ROWS, now), [attention, now]);

  /** The row's destination, in this app's navigation verbs. */
  const openRow = (target: AttentionTarget, opts?: NavOpts) => {
    switch (target.open) {
      case 'doc':
        return void openDoc(target.path, opts);
      case 'session':
        return openChat({ id: target.sessionId, title: target.title }, opts);
      case 'inbox':
        return openInbox(opts);
      case 'todos':
        return openTodos(opts);
      case 'folder':
        return openFolder(target.dir, opts);
      case 'capture':
        // The row IS the way to fill the meeting: the tray opens already
        // attached to it, so nothing has to be picked twice.
        return requestCapture({ aim: { kind: 'meeting', path: target.path, title: target.title } });
      case 'expand':
        // Not a place. The group unfolds where it stands, so the meetings it
        // holds are read and dealt with without leaving the page.
        return setUnfolded((v) => !v);
    }
  };

  /** Wave off one empty meeting for good. */
  const dismiss = (path: string) => {
    void dismissCapture(path).then((series) => series && setMuted({ path, series }));
  };

  // Day one is about the PO's own material: a fresh workspace still ships the
  // skill pack and its folder index files, and neither is something they wrote.
  const empty = contentNotes(tree).length === 0;

  // Day one: the memory has nothing to wait on, so the space teaches the one
  // move that starts everything instead of sitting blank. Unless First steps
  // is above, which teaches the same move with the rest of the sequence around
  // it — then this would be the second card on the page saying it.
  if (empty && !firstStepsShowing(settings)) {
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-3.5">
        <button
          className="flex w-full items-start gap-3 text-left focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={() => requestCapture()}
        >
          <FileUp className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Start with a meeting you already have</span>
            <span className="mt-0.5 block text-sm text-muted-foreground">
              Drop a transcript anywhere in the window. The memory files it and proposes the
              follow-ups as cards you approve.
            </span>
          </span>
          <span className="mt-0.5 shrink-0 text-xs text-muted-foreground tabular-nums">⇧⌘N</span>
        </button>
      </div>
    );
  }

  if (rows.length === 0 && !muted) return null;

  // A flat list, not a panel: the rows sit straight on the paper with a hover
  // pill for affordance, so the composer below stays the only card on the
  // page. The negative margin lets the pill breathe past the text column while
  // the content keeps the greeting's left edge.
  return (
    <div>
      <h2 className="mb-1 text-dense font-semibold text-muted-foreground">Waiting on you</h2>
      <ul className="-mx-2.5">
        {rows.map((row) => (
          <Fragment key={row.id}>
            <WaitingRow
              row={row}
              unfolded={unfolded}
              openRow={openRow}
              openDoc={openDoc}
              dismiss={dismiss}
            />
            {row.children &&
              unfolded &&
              row.children.map((child) => (
                <WaitingRow
                  key={child.id}
                  row={child}
                  nested
                  unfolded={unfolded}
                  openRow={openRow}
                  openDoc={openDoc}
                  dismiss={dismiss}
                />
              ))}
          </Fragment>
        ))}
        {muted && (
          <li className="flex items-center gap-2.5 px-2.5 py-2">
            <Mic className="size-4 shrink-0 text-muted-foreground/50" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
              Okay, no more reminders for this series.
            </span>
            <button
              className="shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none"
              onClick={() => {
                void undoCapture(muted.path, muted.series);
                setMuted(null);
              }}
            >
              Undo
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}

/** The shared shape of a waiting row: icon, sentence, short fact, chevron. */
const ROW_SHELL =
  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 hover:bg-accent motion-reduce:transition-none';
const FOCUS_RING = 'focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none';

/**
 * One row of the waiting list.
 *
 * Most rows are a single button: one thing to look at, one place it goes. An
 * empty-meeting row is two things at once — the meeting, and the move that
 * fills it — so it is a plain element carrying the click, with the meeting's
 * name and the "add a transcript" fact as real buttons inside it. That keeps
 * both reachable by keyboard, which a link nested in a button could not be.
 */
function WaitingRow({
  row,
  nested,
  unfolded,
  openRow,
  openDoc,
  dismiss,
}: {
  row: AttentionRow;
  nested?: boolean;
  unfolded: boolean;
  openRow: (target: AttentionTarget, opts?: NavOpts) => void;
  openDoc: (path: string, opts?: NavOpts) => unknown;
  dismiss: (path: string) => void;
}) {
  const Icon = KIND_ICON[row.kind];
  // One named meeting can be waved off; the group standing for several cannot,
  // because it is not about any one of them.
  const waveOff = row.target.open === 'capture' ? row.target.path : null;
  const group = !!row.children;
  const open = (e: MouseEvent<HTMLElement>) => openRow(row.target, navFromEvent(e));

  const icon = <Icon className={`size-4 shrink-0 ${TONE_CLASS[row.tone]}`} aria-hidden />;
  // The trailing slot is the dismiss on a row that can be waved off, so the
  // column stays one column and the chevrons on the other rows keep their line.
  // A group's chevron points down at what it holds, and turns when it opens.
  const chevron = (
    <ChevronRight
      className={`size-3.5 shrink-0 text-muted-foreground/50 transition-transform duration-150 motion-reduce:transition-none ${
        waveOff ? 'invisible' : ''
      } ${group ? (unfolded ? '-rotate-90' : 'rotate-90') : ''}`}
      aria-hidden
    />
  );

  return (
    <li className={`group/row relative ${nested ? 'pl-6' : ''}`}>
      {row.link ? (
        <div
          className={`${ROW_SHELL} cursor-pointer`}
          onClick={open}
          onAuxClick={(e: MouseEvent<HTMLDivElement>) => e.button === 1 && open(e)}
        >
          {icon}
          <span className="min-w-0 flex-1 truncate text-sm">
            {row.link.before}
            <button
              className={`rounded-sm text-brand underline-offset-2 hover:underline ${FOCUS_RING}`}
              onClick={(e: MouseEvent<HTMLButtonElement>) => {
                e.stopPropagation();
                void openDoc(row.link!.path, navFromEvent(e));
              }}
            >
              {row.link.text}
            </button>
            {row.link.after}
          </span>
          <button
            className={`shrink-0 rounded-sm text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline ${FOCUS_RING}`}
            onClick={(e: MouseEvent<HTMLButtonElement>) => {
              e.stopPropagation();
              open(e);
            }}
          >
            {row.meta}
          </button>
          {chevron}
        </div>
      ) : (
        <button
          className={`${ROW_SHELL} ${FOCUS_RING}`}
          onClick={open}
          onAuxClick={(e: MouseEvent<HTMLButtonElement>) => e.button === 1 && open(e)}
          aria-expanded={group ? unfolded : undefined}
        >
          {icon}
          <span className="min-w-0 flex-1 truncate text-sm">{row.label}</span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {group && unfolded ? 'hide' : row.meta}
          </span>
          {chevron}
        </button>
      )}
      {waveOff && (
        /* Quiet but always there — a control you can only find by hovering is a
           control most people never find. */
        <button
          className={`absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md p-1 text-muted-foreground/40 transition-colors duration-150 hover:bg-accent hover:text-foreground group-hover/row:text-muted-foreground motion-reduce:transition-none ${FOCUS_RING}`}
          onClick={() => dismiss(waveOff)}
          aria-label="Don’t ask about this meeting again"
          title="Don’t ask about this meeting again"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// No workspace
// ---------------------------------------------------------------------------

function NoWorkspace({ onOpen }: { onOpen: () => void }) {
  // Two doors, same as the opening: start a fresh folder, or point at one that
  // already exists. Starting one is the commoner answer here, so it is the
  // form that unfolds in place rather than another OS picker.
  const [creating, setCreating] = useState(false);
  return (
    <div className="flex h-full flex-col">
      <PageHeader icon={House} label="Home" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[640px] flex-col justify-center gap-6 px-8 py-12">
          <div className="space-y-1.5">
            <h1 className="font-serif text-greeting leading-tight font-semibold tracking-tight text-balance">
              Your product memory, one workspace deep
            </h1>
            <p className="text-body text-muted-foreground">
              Meetings go in; approved decisions, updates and answers come out. Everything is plain
              markdown in a folder you own, and nothing is ever written without your approval.
            </p>
          </div>
          {creating ? (
            <NewWorkspace onCancel={() => setCreating(false)} />
          ) : (
            <div className="flex items-center gap-3 rounded-xl bg-card p-4 ring-1 ring-border">
              <FolderOpen className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">Pick a folder to work in</div>
                <div className="text-sm text-muted-foreground">
                  Start a new one, or open a folder of markdown you already have — an existing
                  Obsidian vault included.
                </div>
              </div>
              <Button size="sm" onClick={() => setCreating(true)}>
                New workspace…
              </Button>
              <Button size="sm" variant="outline" onClick={onOpen}>
                Open…
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
