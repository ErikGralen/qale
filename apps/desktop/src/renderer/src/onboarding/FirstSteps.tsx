import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarClock,
  Check,
  ChevronRight,
  ClipboardCheck,
  FileUp,
  KeyRound,
  MessageSquare,
  PenLine,
  Plug,
  Ticket,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { ConnectionProgress, OnboardingDTO, SettingsDTO } from '@qale/ipc';
import { connections, type ProviderDescriptorDTO } from '../lib/connections';
import { MEETING_TOOLS, firstStepsTally, stepRank } from '../lib/first-steps';
import { requestCapture } from '../lib/capture-event';
import { invoke } from '../lib/ipc';
import type { SettingsSection } from '../lib/settings-sections';
import { useApp } from '../state/app-state';

/**
 * First steps (docs/onboarding.md ONB-8) — the second half of onboarding.
 *
 * Real tasks that teach the product by having it do its job, each checked off
 * by the real event rather than by clicking "next". Nothing here is a tour: if
 * a row is ticked, the thing actually happened, and the line under it says
 * what.
 *
 * It is also where skipped setup waits, which is why "finish onboarding" is
 * never a separate mode — just an unchecked row. The connect rows in
 * particular are a second chance rather than a nag: most people skip them in
 * the opening because on day one they have no reason to trust a new app with
 * their work systems, and the honest answer to that is to ask again once the
 * product has proved itself on a transcript.
 *
 * The rows stand in an arc (docs/critical-mass.md CM-6): the calendar puts a
 * month of meetings on the shelf, the backlog drop fills them in, the trackers
 * add the work around them, and the last row briefs a meeting from all of it.
 * Each step makes the next one better. None of them blocks another.
 */

interface Row {
  id: string;
  label: string;
  /** What it teaches, or what is still missing — one line, never two. */
  hint: string;
  icon: LucideIcon;
  done: boolean;
  /** What happened, once it is done. */
  line?: string;
  go: () => void;
  cta: string;
}

/**
 * Ticked rows sink; the rest stand in the arc (docs/critical-mass.md CM-6),
 * where each step makes the next one better. It is a suggestion of order, not a
 * lock: no row blocks another, and someone who starts in the middle loses
 * nothing.
 */
function rank(r: Row): number {
  return (r.done ? 100 : 0) + stepRank(r.id);
}

/** The row that folds open into "where do your meetings live". */
const BACKLOG_ROW = 'transcript';

export function FirstSteps() {
  const {
    settings,
    patchOnboarding,
    openSettings,
    openSession,
    openCalendar,
    openChat,
    openChats,
    proposals,
    tree,
    askRequests,
    sessions,
  } = useApp();
  const onboarding = settings?.onboarding;
  /** A meeting to be briefed on has to exist before that row can go anywhere. */
  const hasMeetings = !!tree?.groups.find((g) => g.type === 'meeting')?.notes.length;
  /**
   * The registered connectors, for the connect rows. Asked for once; the rows
   * fall back to the ids in the settings DTO until the answer lands, so the
   * card never draws one row short and then grows.
   */
  const [providers, setProviders] = useState<ProviderDescriptorDTO[]>([]);
  useEffect(() => {
    let live = true;
    connections
      .providers()
      .then((p) => {
        if (live) setProviders(p);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  /**
   * An interview already waiting on an answer. A connection's first read ends
   * in one (docs/first-look-debrief.md), and that session has read the whole
   * synced index, so this row must open THAT one rather than a blank second
   * conversation about the same thing. Two doors, one session.
   */
  const waitingInterview = useMemo(() => {
    for (const request of Object.values(askRequests)) {
      if (request.skill !== 'tell-qale') continue;
      const session = sessions.find((s) => s.id === request.sessionId);
      if (session) return { id: session.id, title: session.title };
    }
    return null;
  }, [askRequests, sessions]);

  /**
   * The newest session still holding a card. That is where a proposal is
   * decided now, so the row opens it rather than a queue of its own.
   */
  const waitingCard = useMemo(() => {
    const card = [...proposals]
      .filter((p) => p.status === 'pending')
      .sort((a, b) => b.created - a.created)[0];
    if (!card) return null;
    const session = sessions.find((s) => s.id === card.sessionId);
    return { id: card.sessionId, title: session?.title ?? 'Session' };
  }, [proposals, sessions]);

  const rows = useMemo<Row[]>(() => {
    if (!settings || !onboarding) return [];
    return buildRows(settings, onboarding, providers, {
      hasMeetings,
      openSettings: (section) => openSettings(section),
      openProposal: () => (waitingCard ? openChat(waitingCard) : openChats()),
      // The Calendar is its own screen now (E-12), so the row that wants a
      // meeting to brief goes there, not into the folder underneath it.
      openCalendar: () => openCalendar(),
      addSource: () => requestCapture(),
      ask: () => openSession('ask'),
      // The interview, not a file to edit (docs/product-understanding.md U-4).
      // It opens in its own tab and starts talking, because the whole lesson of
      // this row is that you say it out loud and it drafts.
      //
      // The skill takes any topic (SK-11), so the topic is what this hands in:
      // the first prompt IS the argument, and the tab is named for it.
      learnProduct: () =>
        waitingInterview
          ? openChat(waitingInterview)
          : openSession('tell-qale', {
              initialPrompt: 'Let me tell you about the product.',
              title: 'Tell Qale about the product',
              fresh: true,
            }),
      waiting: !!waitingInterview,
    });
  }, [
    settings,
    onboarding,
    providers,
    hasMeetings,
    waitingCard,
    waitingInterview,
    openSettings,
    openCalendar,
    openChats,
    openSession,
    openChat,
  ]);

  const remaining = rows.filter((r) => !r.done).length;
  const finished = rows.length > 0 && remaining === 0;

  /** What the workspace holds, for the card's last showing (CM-7). */
  const tally = finished ? firstStepsTally(tree) : null;

  /**
   * Everything done: the card shows once with every row ticked — that glance
   * is the whole reward — and retires itself when the PO leaves the page. The
   * elapsed-time guard is for StrictMode's development double-mount, which
   * would otherwise retire the card before anyone had a chance to see it.
   */
  const mountedAt = useRef(Date.now());
  useEffect(() => {
    if (!finished) return;
    const shownAt = mountedAt.current;
    return () => {
      if (Date.now() - shownAt > 1000) void patchOnboarding({ dismissed: true });
    };
  }, [finished, patchOnboarding]);

  if (!onboarding || onboarding.dismissed || rows.length === 0) return null;

  const sorted = [...rows].sort((a, b) => rank(a) - rank(b));

  return (
    <div className="rounded-xl bg-card p-1.5 ring-1 ring-border">
      <div className="flex items-center gap-2 px-2.5 pt-1.5 pb-1">
        <h2 className="text-dense font-semibold text-muted-foreground">First steps</h2>
        <span className="text-xs text-muted-foreground/70 tabular-nums">
          {remaining === 0 ? 'All done' : `${remaining} left`}
        </span>
        <button
          className="-mr-1 ml-auto rounded-md p-1 text-muted-foreground/50 transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none"
          onClick={() => void patchOnboarding({ dismissed: true })}
          aria-label="Put these away"
          title="Put these away"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      {/* The last showing says what the steps built instead of that they are
          done (CM-7). The ticks answered "what is left", and nothing is left;
          the counts answer the question that replaced it. Read off the tree as
          it renders, so the sentence is true when it is read, and never again
          after the card retires. */}
      {tally ? (
        <p className="px-2.5 pt-1 pb-2.5 text-sm text-muted-foreground">{tally}</p>
      ) : (
        <ul>
          {sorted.map((row) => (
            <li key={row.id}>
              <button
                className="group/step flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none"
                onClick={row.go}
              >
                {row.done ? (
                  <Check className="size-4 shrink-0 text-success" aria-hidden />
                ) : (
                  <row.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate text-sm ${row.done ? 'text-muted-foreground line-through decoration-muted-foreground/40' : ''}`}
                  >
                    {row.label}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {row.done ? row.line : row.hint}
                  </span>
                </span>
                {!row.done && (
                  <span className="shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors group-hover/step:text-foreground">
                    {row.cta}
                  </span>
                )}
              </button>
              {row.id === BACKLOG_ROW && !row.done && <ToolGuides />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * "Where do your meetings live?" (docs/critical-mass.md CM-1).
 *
 * The row asks for last month's meetings, and the honest objection to that ask
 * is "I don't have a folder of transcripts". Usually they do, in whatever tool
 * recorded the meetings, and they have never had a reason to look. So the row
 * folds open into the short version per tool, and the last option is for the
 * people who have nothing recorded anywhere: their own notes still count.
 *
 * Folded by default, because someone who already has the folder should not have
 * to read past six tools to drop it in.
 */
function ToolGuides() {
  const [open, setOpen] = useState(false);
  const [tool, setTool] = useState<string | null>(null);
  /**
   * Which tools have been reported. One event per tool per sitting: opening
   * the same guide twice is the same fact, and what we want to know is which
   * tools people use, not how often they click.
   */
  const reported = useRef(new Set<string>());

  const pick = (id: string): void => {
    setTool((current) => (current === id ? null : id));
    if (reported.current.has(id)) return;
    reported.current.add(id);
    // Fire and forget. Whether it goes anywhere is the consent switch's call,
    // main-side, which is the only place that knows the answer.
    void invoke['telemetry:meetingTool'](id).catch(() => undefined);
  };

  const guide = MEETING_TOOLS.find((t) => t.id === tool);

  return (
    <div className="pr-2.5 pb-1.5 pl-9">
      <button
        className="flex items-center gap-1 rounded text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <ChevronRight
          className={`size-3 transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
          aria-hidden
        />
        Where do your meetings live?
      </button>
      {open && (
        <div className="mt-1.5">
          <div className="flex flex-wrap gap-1">
            {MEETING_TOOLS.map((t) => (
              <button
                key={t.id}
                onClick={() => pick(t.id)}
                aria-pressed={tool === t.id}
                className={`rounded-md px-2 py-0.5 text-xs ring-1 transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none ${
                  tool === t.id
                    ? 'bg-accent text-foreground ring-border'
                    : 'text-muted-foreground ring-transparent hover:bg-accent hover:text-foreground'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {guide && <p className="mt-1.5 text-xs text-muted-foreground">{guide.guide}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * The rows, and the rule for each one being done.
 *
 * Some of them are derived from live state rather than from a stamped
 * checklist: the key, and every connection. That is deliberate — it means a
 * key added from Settings months later still ticks its row, and it means the
 * "only if skipped in the opening" rule needs no bookkeeping at all: anyone who
 * did it during setup already has the fact, so the row is simply done.
 */
function buildRows(
  settings: SettingsDTO,
  onboarding: OnboardingDTO,
  providers: ProviderDescriptorDTO[],
  go: {
    hasMeetings: boolean;
    openSettings: (section: SettingsSection) => void;
    openProposal: () => void;
    openCalendar: () => void;
    addSource: () => void;
    ask: () => void;
    learnProduct: () => void;
    /** An interview is already open and waiting on an answer. */
    waiting: boolean;
  },
): Row[] {
  const stamped = onboarding.checklist;

  const rows: Row[] = [
    {
      id: 'key',
      label: 'Add your API key',
      hint: 'Nothing can run without it',
      icon: KeyRound,
      done: settings.hasApiKey,
      line: 'Your key is in, so sessions can run',
      go: () => go.openSettings('agent'),
      cta: 'Settings',
    },
    {
      // The ask is the backlog, not the next meeting (CM-1). One transcript
      // proves the loop works; a month of them makes the memory worth asking.
      // The folder trick is said out loud because nobody tries it unless told,
      // and notes are named because their old notes count as a source too (CM-4).
      id: 'transcript',
      label: "Add last month's meetings",
      hint: 'Transcripts, notes, exports. Drop the whole folder in one go.',
      icon: FileUp,
      done: !!stamped.transcript,
      line: stamped.transcript?.line,
      go: go.addSource,
      cta: 'Add',
    },
    {
      // "Proposal", not "card" (clarity review area 10): before the first
      // one exists, "card" is an internal word pointing at nothing.
      id: 'proposal',
      label: 'Decide on a proposal',
      hint: 'Nothing is written to your workspace until you say yes',
      icon: ClipboardCheck,
      done: !!stamped.proposal,
      line: stamped.proposal?.line,
      go: go.openProposal,
      cta: 'Open',
    },
    {
      id: 'prep',
      label: 'Prep for a meeting',
      // Last, because it is the row that pays for the others: the brief is
      // drawn from everything the workspace has read by then, which is why the
      // arc puts the reading first. Two honest hints, because the move is
      // different depending on whether there is a meeting to be briefed on.
      hint: go.hasMeetings
        ? 'It briefs you from everything it has read so far'
        : 'Connect a calendar, or add a meeting, and it briefs you before the next one',
      icon: CalendarClock,
      done: !!stamped.prep,
      line: stamped.prep?.line,
      go: go.hasMeetings ? go.openCalendar : () => go.openSettings('connections'),
      cta: go.hasMeetings ? 'Calendar' : 'Connect',
    },
    {
      id: 'ask',
      label: 'Ask your memory something',
      hint: 'It answers from your notes, with the receipts',
      icon: MessageSquare,
      done: !!stamped.ask,
      line: stamped.ask?.line,
      go: go.ask,
      cta: 'Ask',
    },
    {
      id: 'understanding',
      label: 'Tell it about your product',
      // Two hints, because the move is different once a connection's first read
      // has already asked (docs/first-look-debrief.md): that session has read
      // the whole index, and this row opens it rather than starting a blank one.
      hint: go.waiting
        ? 'It read your projects and has a question waiting'
        : 'It asks, you talk, and it writes down what you said',
      icon: PenLine,
      // The row this replaced asked people to edit a skill file by hand. Anyone
      // who did that has still told it about their product, so their tick
      // stands.
      done: !!stamped.understanding || !!stamped['about-us'],
      line: stamped.understanding?.line ?? stamped['about-us']?.line,
      go: go.learnProduct,
      cta: go.waiting ? 'Open' : 'Start',
    },
  ];

  // One row per registered connector, in the order Settings lists them. The
  // progress comes from the settings DTO, which carries an entry per provider.
  const listed: { id: string; label: string }[] = providers.length
    ? providers.map((p) => ({ id: p.id, label: p.label }))
    : Object.keys(onboarding.connections).map((id) => ({ id, label: id }));
  for (const provider of listed) {
    rows.push(
      connectRow(provider, onboarding.connections[provider.id] ?? 'none', () =>
        go.openSettings('connections'),
      ),
    );
  }

  return rows;
}

/**
 * What a connector's row says. A provider with no entry still gets a row, built
 * from its own label, so a new connector needs no edit here. The entries exist
 * because a label alone cannot say what the connection buys you, and these two
 * lines are the ones people have been reading.
 */
const CONNECT_COPY: Record<
  string,
  { label: string; icon: LucideIcon; hint: string; half: string; line: string }
> = {
  'google-calendar': {
    label: 'Connect your calendar',
    icon: CalendarClock,
    hint: 'Your meetings appear, a month back and two ahead',
    half: 'Connected, but no calendar picked yet',
    line: 'Your calendar is in, so meetings arrive on their own',
  },
  atlassian: {
    label: 'Connect Jira or Confluence',
    icon: Ticket,
    hint: 'It reads your projects, then tells you what it found',
    half: 'Connected, but no project or space picked yet',
    line: 'Jira and Confluence are in, so linked work stays current',
  },
};

/** One connect row. Half-done is not done: connected with nothing followed
 *  reads nothing, and a green tick over that would be the quiet kind of lie. */
function connectRow(
  provider: { id: string; label: string },
  progress: ConnectionProgress,
  go: () => void,
): Row {
  const copy = CONNECT_COPY[provider.id] ?? {
    label: `Connect ${provider.label}`,
    icon: Plug,
    hint: 'What it reads there stays current in your workspace',
    half: 'Connected, but nothing picked to read yet',
    line: `${provider.label} is in, so linked work stays current`,
  };
  return {
    id: `connect:${provider.id}`,
    label: copy.label,
    hint: progress === 'connected' ? copy.half : copy.hint,
    icon: copy.icon,
    done: progress === 'following',
    line: copy.line,
    go,
    cta: 'Connect',
  };
}
