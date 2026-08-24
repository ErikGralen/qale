import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarClock,
  Check,
  FileUp,
  Inbox,
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
import { requestCapture } from '../lib/capture-event';
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
 */

/**
 * Is the card on the page? Home asks before drawing its own day-one
 * invitation, which teaches the same move: two cards saying "drop a
 * transcript" is one card too many, and the row here says it with the rest of
 * the sequence around it.
 */
export function firstStepsShowing(settings: SettingsDTO | null): boolean {
  return !!settings && !settings.onboarding.dismissed;
}

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

/** Ticked rows sink; the order otherwise is the order they unblock each other. */
function rank(r: Row): number {
  return r.done ? 1 : 0;
}

export function FirstSteps() {
  const { settings, patchOnboarding, openSettings, openInbox, openSession, openFolder, tree } =
    useApp();
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

  const rows = useMemo<Row[]>(() => {
    if (!settings || !onboarding) return [];
    return buildRows(settings, onboarding, providers, {
      hasMeetings,
      openSettings: (section) => openSettings(section),
      openInbox: () => openInbox(),
      openMeetings: () => openFolder('meetings'),
      addMaterial: () => requestCapture(),
      ask: () => openSession('ask'),
      // The interview, not a file to edit (docs/product-understanding.md U-4).
      // It opens in its own tab and starts talking, because the whole lesson of
      // this row is that you say it out loud and it drafts.
      //
      // The skill takes any topic (SK-11), so the topic is what this hands in:
      // the first prompt IS the argument, and the tab is named for it.
      learnProduct: () =>
        openSession('tell-qale', {
          initialPrompt: 'Let me tell you about the product.',
          title: 'Tell Qale about the product',
          fresh: true,
        }),
    });
  }, [
    settings,
    onboarding,
    providers,
    hasMeetings,
    openSettings,
    openInbox,
    openFolder,
    openSession,
  ]);

  const remaining = rows.filter((r) => !r.done).length;
  const finished = rows.length > 0 && remaining === 0;

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
          </li>
        ))}
      </ul>
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
    openInbox: () => void;
    openMeetings: () => void;
    addMaterial: () => void;
    ask: () => void;
    learnProduct: () => void;
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
      // First, and the one that unblocks most of the others: the workspace
      // starts empty, so until something real is in it the rest can't happen.
      id: 'transcript',
      label: 'Drop in a meeting transcript',
      hint: 'A .txt, .md or .vtt export, or just paste the text',
      icon: FileUp,
      done: !!stamped.transcript,
      line: stamped.transcript?.line,
      go: go.addMaterial,
      cta: 'Add',
    },
    {
      // "Suggestion", not "card" (clarity review area 10): before the first
      // one exists, "card" is an internal word pointing at nothing.
      id: 'proposal',
      label: 'Approve or reject its first suggestion',
      hint: 'After it reads something, suggestions wait in the Inbox',
      icon: Inbox,
      done: !!stamped.proposal,
      line: stamped.proposal?.line,
      go: go.openInbox,
      cta: 'Inbox',
    },
    {
      id: 'prep',
      label: 'Get a meeting prepped for you',
      // Two honest hints, because the move is different depending on whether
      // there is a meeting to be briefed on at all.
      hint: go.hasMeetings
        ? 'Open one and ask for a brief, or let it prep the next one itself'
        : 'Connect a calendar, or add a meeting, and it briefs you before the next one',
      icon: CalendarClock,
      done: !!stamped.prep,
      line: stamped.prep?.line,
      go: go.hasMeetings ? go.openMeetings : () => go.openSettings('connections'),
      cta: go.hasMeetings ? 'Meetings' : 'Connect',
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
      hint: 'It asks, you talk, and it writes down what you said',
      icon: PenLine,
      // The row this replaced asked people to edit a skill file by hand. Anyone
      // who did that has still told it about their product, so their tick
      // stands.
      done: !!stamped.understanding || !!stamped['about-us'],
      line: stamped.understanding?.line ?? stamped['about-us']?.line,
      go: go.learnProduct,
      cta: 'Start',
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
    hint: 'Your meetings arrive as notes by themselves',
    half: 'Connected, but no calendar picked yet',
    line: 'Your calendar is in, so meetings arrive on their own',
  },
  atlassian: {
    label: 'Connect Jira or Confluence',
    icon: Ticket,
    hint: 'Tickets and pages you link stay current',
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
