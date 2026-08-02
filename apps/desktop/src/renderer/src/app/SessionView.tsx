import { useMemo, useState, useRef, useEffect } from 'react';
import { useChat } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { Button, Spinner } from '@pm/ui';
import {
  AlertTriangle,
  Check,
  Square,
  Wrench,
  Brain,
  ChevronDown,
  FileText,
  History,
  MessageSquarePlus,
  RotateCcw,
  Wand2,
} from 'lucide-react';
import type { NoteRefDTO } from '@pm/ipc';
import { parseKickoff, type Kickoff } from '@pm/sessions';
import { IpcChatTransport } from '../lib/ipc-transport';
import { navFromEvent, type NavOpts } from '../lib/nav';
import { noteTypeIcon } from '../lib/note-icons';
import { HeaderAction, HeaderActions, PageHeader } from '../components/PageHeader';
import { Markdown } from '../components/Markdown';
import { SessionReview } from '../components/inbox/SessionReview';
import { SpawnCard } from '../components/inbox/SpawnCard';
import { QuestionCard } from '../components/inbox/QuestionCard';
import { useApp } from '../state/app-state';
import { invoke } from '../lib/ipc';
import { useChatMentions } from './ChatMentions';
import { SkillPicker } from './SkillPicker';
import {
  COMPOSER_INPUT,
  COMPOSER_ROW,
  COMPOSER_SHELL,
  MentionHint,
  SendButton,
  useAutoGrow,
} from '../components/Composer';

/**
 * Wrap bare note-path citations (decisions/adopt-workos.md) in wikilinks so they
 * render clickable. Skips paths already inside wikilinks or markdown link parens
 * (those are preceded by `[` / `(`, which the prefix class excludes).
 */
function linkifyNotePaths(text: string): string {
  return text.replace(/(^|[\s,;:])([a-z][\w-]*\/[\w./-]+\.md)\b/gim, '$1[[$2]]');
}

/** Rewrite prose only — a fenced block is data (a proposal payload, a diff) and
 *  stays exactly as written, paths and all. */
function outsideCode(text: string, rewrite: (chunk: string) => string): string {
  return text
    .split(/(```[\s\S]*?```)/)
    .map((chunk, i) => (i % 2 === 1 ? chunk : rewrite(chunk)))
    .join('');
}

/**
 * What the PM sent, as markdown: the paths and `[[mentions]]` in it become
 * links that open the page, which is the whole point of citing a file in a
 * message. Markdown folds single newlines, so the line breaks they typed are
 * made explicit first.
 */
function messageMarkdown(text: string): string {
  return outsideCode(text, (chunk) =>
    linkifyNotePaths(chunk).replace(/(?<=\S)\n(?!\n)/g, '  \n'),
  );
}

interface AnyPart {
  type: string;
  text?: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

function isActivityPart(part: AnyPart): boolean {
  return part.type === 'reasoning' || part.type.startsWith('tool-') || part.type === 'dynamic-tool';
}

function isToolPart(part: AnyPart): boolean {
  return part.type.startsWith('tool-') || part.type === 'dynamic-tool';
}

function toolNameOf(part: AnyPart): string {
  return part.type.startsWith('tool-') ? part.type.slice(5) : part.toolName ?? 'tool';
}

function toolInputOf(part: AnyPart): Record<string, unknown> {
  return typeof part.input === 'object' && part.input !== null ? (part.input as Record<string, unknown>) : {};
}

/**
 * A step the agent gave up on. The bridge turns pi's `isError` result into a
 * `tool-output-error` chunk, which useChat lands on the part as that state plus
 * an `errorText`; either one is enough to call it failed.
 */
function isFailedStep(part: AnyPart): boolean {
  return part.state === 'output-error' || part.errorText !== undefined;
}

/**
 * Past tenses that don't take the -ed → -ing rule, plus the vague fallback:
 * "Tried a step" says more than "Tried working" would.
 */
const GERUNDS: Record<string, string> = {
  Read: 'reading',
  Wrote: 'writing',
  Ran: 'running',
  Worked: 'a step',
};

/**
 * The third tense. A failed step reads "Tried reading", never "Read", so a run
 * that tried three times and gave up can't be mistaken for a run that did three
 * things. Derived from the past-tense verb rather than a third column in the
 * table below, so a new tool still only needs one entry.
 */
function triedVerb(verb: string): string {
  const [head = '', ...rest] = verb.split(' ');
  const gerund = GERUNDS[head] ?? (head.endsWith('ed') ? `${head.slice(0, -2)}ing` : head).toLowerCase();
  return ['Tried', gerund, ...rest].join(' ');
}

/** Past-tense verb + monospace detail for one tool step in the expanded trail. */
function stepLabel(part: AnyPart): { verb: string; detail?: string } {
  const label = doneLabel(part);
  return isFailedStep(part) ? { ...label, verb: triedVerb(label.verb) } : label;
}

/** The verb table: one entry per tool, past tense, plain and sentence case. */
function doneLabel(part: AnyPart): { verb: string; detail?: string } {
  const name = toolNameOf(part);
  const input = toolInputOf(part);
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : undefined);
  switch (name) {
    case 'vault_read':
      return { verb: 'Read', detail: str('path') };
    case 'search_vault':
      return { verb: 'Searched', detail: str('query') && `“${str('query')}”` };
    case 'vault_grep':
      return { verb: 'Scanned for', detail: str('pattern') && `“${str('pattern')}”` };
    case 'vault_list':
      return { verb: 'Listed notes', detail: [str('type'), str('lifecycle')].filter(Boolean).join('/') || undefined };
    case 'jira_search':
      return { verb: 'Searched Jira', detail: str('jql') ?? str('query') };
    case 'jira_get_issue':
      return { verb: 'Read Jira issue', detail: str('key') ?? str('issueKey') };
    case 'confluence_search':
      return { verb: 'Searched Confluence', detail: str('query') ?? str('cql') };
    case 'confluence_get_page':
      return { verb: 'Read Confluence page', detail: str('title') ?? str('id') };
    case 'use_skill':
      return { verb: 'Loaded skill', detail: str('name') };
    case 'spawn':
      return { verb: 'Ran subagents' };
    case 'ask_user': {
      const questions = Array.isArray(input.questions) ? (input.questions as { header?: string }[]) : [];
      return { verb: 'Raised a question', detail: questions.map((q) => q.header).filter(Boolean).join(', ') || undefined };
    }
    // Only ever visible on a session a person started, where the tool is a
    // no-op: a scheduled run that ends quietly leaves no session to open.
    case 'end_quietly':
      return { verb: 'Asked to end quietly' };
    case 'files_write':
    case 'write_result':
      return { verb: 'Wrote', detail: str('path') };
    case 'files_edit':
      return { verb: 'Edited', detail: str('path') };
    case 'files_read':
      return { verb: 'Read session file', detail: str('path') };
    case 'files_list':
      return { verb: 'Listed session files' };
    // Retired tool. Kept for replay only: transcripts filed before checkpoints
    // were removed still contain these calls, and an old session must not
    // render a raw tool name.
    case 'advance_checkpoint':
      return { verb: 'Advanced checkpoint' };
    default:
      if (name.startsWith('propose_'))
        return { verb: `Proposed a ${name.slice(8).replace(/_/g, ' ')}`, detail: str('path') ?? str('title') };
      if (name.startsWith('draft_'))
        return { verb: `Drafted a ${name.slice(6).replace(/_/g, ' ')}`, detail: str('title') ?? str('summary') };
      // A tool shipped without an entry above. Vague beats wrong: the PM should
      // never be shown a raw tool name (`draft_calendar_rsvp`), and a machine
      // name in the detail slot would be the same leak by another door.
      return { verb: 'Worked' };
  }
}

/** Present-tense label for the step currently running, shown on the collapsed row. */
function liveLabel(part: AnyPart | undefined): string {
  if (!part || part.type === 'reasoning') return 'Thinking…';
  const name = toolNameOf(part);
  const input = toolInputOf(part);
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : undefined);
  switch (name) {
    case 'vault_read':
      return str('path') ? `Reading ${str('path')}` : 'Reading the memory…';
    case 'search_vault':
      return str('query') ? `Searching “${str('query')}”` : 'Searching the memory…';
    case 'vault_grep':
      return str('pattern') ? `Scanning for “${str('pattern')}”` : 'Scanning the memory…';
    case 'vault_list':
      return 'Listing notes…';
    case 'spawn':
      return 'Running subagents…';
    case 'ask_user':
      return 'Waiting on your answer…';
    case 'files_write':
    case 'files_edit':
    case 'write_result':
      return str('path') ? `Writing ${str('path')}` : 'Writing a session file…';
    case 'files_read':
    case 'files_list':
      return 'Reading its own notes…';
    case 'jira_search':
    case 'jira_get_issue':
      return 'Checking Jira…';
    case 'confluence_search':
    case 'confluence_get_page':
      return 'Checking Confluence…';
    default:
      if (name.startsWith('propose_') || name.startsWith('draft_')) return 'Drafting a card…';
      return 'Working…';
  }
}

/** Seconds as the PM would say them: `8s`, `47s`, `2m 5s`. */
function humanSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/**
 * How long the run has been going, in whole seconds, so a slow step looks slow
 * instead of looking frozen. Nothing on the parts carries a clock (an AI SDK
 * tool part is state, input, output and nothing else), so it is measured here,
 * from the moment the block went live. The reading freezes when the run
 * settles and the interval is torn down with it: nothing ticks while nothing
 * is running. A replayed transcript never went live in this mount, so it
 * reports no time rather than a made-up one.
 */
function useElapsed(live: boolean): number | null {
  const startedAt = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  useEffect(() => {
    // Settled: take the final reading and stop. The start stays put, so a turn
    // that dips out of the working phase to narrate and then picks up another
    // tool keeps counting the one run rather than restarting.
    if (!live) {
      if (startedAt.current !== null) setElapsed(Math.round((Date.now() - startedAt.current) / 1000));
      return;
    }
    const started = (startedAt.current ??= Date.now());
    const tick = () => setElapsed(Math.round((Date.now() - started) / 1000));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [live]);
  return elapsed;
}

/** One tool step inside the expanded trail — raw receipt stays one click away. */
function ToolStep({ part }: { part: AnyPart }) {
  const [open, setOpen] = useState(false);
  const { verb, detail } = stepLabel(part);
  const done = part.state === 'output-available' || part.state === 'output-error' || part.output !== undefined;
  const hasOutput = typeof part.output === 'string' && part.output.length > 0;
  const failed = isFailedStep(part);
  return (
    <div>
      <button
        className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
        onClick={() => hasOutput && setOpen((o) => !o)}
        aria-expanded={open}
        disabled={!hasOutput}
      >
        {/* The glyph carries the same three states as the verb: spinning,
            done, gave up. */}
        {!done ? (
          <Spinner className="size-3 shrink-0" />
        ) : failed ? (
          <AlertTriangle className="size-3 shrink-0 text-destructive" />
        ) : (
          <Wrench className="size-3 shrink-0" />
        )}
        <span className="shrink-0 font-medium">{verb}</span>
        {detail && <span className="truncate font-mono">{detail}</span>}
        {hasOutput && (
          <ChevronDown
            className={`ml-auto size-3 shrink-0 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
          />
        )}
      </button>
      {part.errorText && <div className="px-1.5 pb-1 text-destructive">{part.errorText}</div>}
      {open && hasOutput && (
        <pre className="mt-0.5 mb-1 max-h-48 overflow-y-auto rounded-md bg-muted/40 px-2 py-1.5 whitespace-pre-wrap text-muted-foreground">
          {(part.output as string).slice(0, 2000)}
        </pre>
      )}
    </div>
  );
}

/**
 * The whole working phase of an assistant turn — reasoning, vault reads,
 * searches, mid-work narration — folded into one quiet row. Collapsed it reads
 * as provenance ("Reasoning · 7 sources · 4 searches"); while streaming it
 * narrates the current step; expanded it shows the chronological trail.
 */
function ActivityBlock({ parts, live }: { parts: AnyPart[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  const elapsed = useElapsed(live);
  const sources = new Set<string>();
  let searches = 0;
  let actions = 0;
  let failed = 0;
  for (const part of parts) {
    if (!isToolPart(part)) continue;
    const name = toolNameOf(part);
    const input = toolInputOf(part);
    if (name === 'vault_read' && typeof input.path === 'string') sources.add(input.path);
    else if (name === 'jira_get_issue' || name === 'confluence_get_page') sources.add(`${name}:${JSON.stringify(input)}`);
    else if (['search_vault', 'vault_grep', 'vault_list', 'jira_search', 'confluence_search'].includes(name)) searches++;
    else actions++;
    if (isFailedStep(part)) failed++;
  }
  // Under a second is noise, and a replayed transcript has no reading at all.
  const clock = elapsed !== null && elapsed >= 1 ? humanSeconds(elapsed) : null;
  // The clock follows the label, so the label drops its trailing ellipsis to
  // make room for it: "Working…" alone, "Working for 12s" with a clock.
  const step = liveLabel(parts[parts.length - 1]);
  const running = clock ? step.replace(/…$/, '') : step;
  const bits: string[] = [];
  // How long it took, first: it is the thing the PM was watching a second ago.
  if (!live && clock) bits.push(`worked for ${clock}`);
  if (sources.size > 0) bits.push(`${sources.size} source${sources.size === 1 ? '' : 's'}`);
  if (searches > 0) bits.push(`${searches} search${searches === 1 ? '' : 'es'}`);
  if (actions > 0) bits.push(`${actions} action${actions === 1 ? '' : 's'}`);
  return (
    <div className="my-1 text-xs">
      <button
        className="flex max-w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {live ? <Spinner className="size-3.5 shrink-0" /> : <Brain className="size-3.5 shrink-0" />}
        <span className="truncate font-medium">{live ? running : 'Reasoning'}</span>
        {/* The running row's own clock ("Working for 12s"), so a step that is
            taking a while reads as slow rather than as stuck. */}
        {live && clock && <span className="shrink-0">for {clock}</span>}
        {!live && bits.length > 0 && <span className="shrink-0">· {bits.join(' · ')}</span>}
        {failed > 0 && (
          <span className="shrink-0 text-destructive">· {failed} failed</span>
        )}
        <ChevronDown
          className={`size-3.5 shrink-0 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="mt-1 ml-2 flex flex-col border-l border-border pl-3">
          {parts.map((part, i) => {
            if (part.type === 'reasoning' || part.type === 'text')
              return (
                <div key={i} className="px-1.5 py-1 leading-relaxed whitespace-pre-wrap text-muted-foreground">
                  {part.text}
                </div>
              );
            return <ToolStep key={i} part={part} />;
          })}
        </div>
      )}
    </div>
  );
}

/**
 * A turn the app composed rather than the PM typed: a skill invoked on a page,
 * from Process on a note, Brief me on a meeting, or the receipt after material
 * lands. Printing the instruction verbatim ("Run the arrival skill on
 * sources/…: read the capture, search the memory…") put a paragraph of machine
 * prose in a bubble the PM never wrote, and buried the two things they wanted:
 * WHICH skill is working, and on WHAT. So the row says exactly that — the skill
 * by its human title, the page as a link that opens it — and keeps the wording
 * one click away, for when the question is what it was actually asked to do.
 */
function RunRow({
  kickoff,
  note,
  skillTitle,
  onOpen,
}: {
  kickoff: Kickoff;
  /** The target's tree entry, when the path is one the workspace knows. */
  note?: NoteRefDTO;
  skillTitle: string;
  onOpen: (path: string, opts?: NavOpts) => void;
}) {
  const [open, setOpen] = useState(false);
  const TargetIcon = note ? noteTypeIcon(note.type) : FileText;
  const instruction = kickoff.instruction
    ? kickoff.instruction.charAt(0).toUpperCase() + kickoff.instruction.slice(1)
    : '';
  return (
    <div className="rounded-xl border border-border bg-secondary/40 px-3 py-2 text-sm">
      <div className="flex items-center gap-1.5">
        <Wand2 className="size-3.5 shrink-0 text-brand" aria-hidden />
        <span className="shrink-0 font-medium">{skillTitle}</span>
        {kickoff.target && (
          <>
            <span className="shrink-0 text-muted-foreground">on</span>
            <a
              href="#"
              className="flex min-w-0 items-center gap-1 text-brand underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              title={note?.title ? `${note.title} — ${kickoff.target}` : kickoff.target}
              onClick={(e) => {
                e.preventDefault();
                onOpen(kickoff.target!, navFromEvent(e));
              }}
              onAuxClick={(e) => {
                if (e.button !== 1) return;
                e.preventDefault();
                onOpen(kickoff.target!, navFromEvent(e));
              }}
            >
              <TargetIcon className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{note?.title ?? kickoff.target}</span>
            </a>
          </>
        )}
        {instruction && (
          <button
            className="ml-auto flex shrink-0 items-center gap-1 rounded-md px-1 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
          >
            Instructions
            <ChevronDown
              className={`size-3 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
            />
          </button>
        )}
      </div>
      {open && instruction && (
        <p className="mt-2 border-t border-border pt-2 text-xs leading-relaxed text-muted-foreground">
          {instruction}
        </p>
      )}
    </div>
  );
}

/** What a blank session says before the first message. */
const EMPTY_HINT =
  'A session with your memory. Pick a skill (or let the agent load one) when it turns into work — nothing is written without an approval card.';

interface SessionViewProps {
  /**
   * The skill to invoke on the first turn (Sessions v2 Part 4). Not a mode: the
   * session is the same session either way, and a second skill can arrive after
   * this one. The entry-point buttons and Landing tiles pass it and read exactly
   * as they did — they just mean "start a session and invoke this" now.
   */
  skill?: string;
  /** Stored session to reopen — its transcript replays before the live view mounts. */
  sessionId?: string;
  /** Fired when the main process assigns this session its id (first turn). */
  onSessionId?: (sessionId: string) => void;
  /** Shows a "New session" button in the header wired to this. */
  onNewSession?: () => void;
  initialPrompt?: string;
  /** Prepended to the first user message to scope the read (side session). */
  scopeHint?: string;
  /**
   * Rendered inside a surface that already states where you are (the note's
   * session corner). Drops this view's own header rather than stacking a second
   * 40px rail under the panel's.
   */
  embedded?: boolean;
}

/**
 * Loads the stored transcript (if any) before mounting the live view, so
 * reopening yesterday's session shows its history and keeps going in the
 * same pi session. If the session has a turn running in the background (kicked
 * off, tab closed, reopened), the view shows the transcript so far with a
 * working banner and refreshes itself when the run settles.
 */
export function SessionView({ sessionId, ...props }: SessionViewProps) {
  // The id this view mounted with; later binds re-render the parent but must
  // not reset the live useChat state.
  const initialSessionId = useRef(sessionId).current;
  const [history, setHistory] = useState<UIMessage[] | null>(initialSessionId ? null : []);
  const [reloadKey, setReloadKey] = useState(0);
  const { sessions, markSessionSeen } = useApp();

  const overview = initialSessionId ? sessions.find((s) => s.id === initialSessionId) : undefined;
  const backgroundRunning = !!overview?.running;
  // True while THIS view's composer drives the stream — its useChat already
  // renders the live turn, so the settle refresh must not remount it.
  const ownStream = useRef(false);
  const wasRunning = useRef(backgroundRunning);

  // Opening the session counts as seeing it.
  useEffect(() => {
    if (initialSessionId) markSessionSeen(initialSessionId);
  }, [initialSessionId, markSessionSeen]);

  useEffect(() => {
    if (!initialSessionId) return;
    let cancelled = false;
    invoke['chats:history'](initialSessionId)
      .then((h) => {
        if (!cancelled) setHistory((h.messages as UIMessage[]) ?? []);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [initialSessionId, reloadKey]);

  // A background run settled while this tab watched — replay the full transcript.
  useEffect(() => {
    if (wasRunning.current && !backgroundRunning && !ownStream.current && initialSessionId) {
      setHistory(null);
      setReloadKey((k) => k + 1);
      markSessionSeen(initialSessionId);
    }
    wasRunning.current = backgroundRunning;
  }, [backgroundRunning, initialSessionId, markSessionSeen]);

  if (history === null) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" /> Opening the session…
      </div>
    );
  }
  return (
    <SessionThread
      {...props}
      key={reloadKey}
      initialSessionId={initialSessionId}
      initialMessages={history}
      backgroundStreamId={backgroundRunning ? overview?.streamId : undefined}
      onOwnStream={(busy) => {
        ownStream.current = busy;
      }}
    />
  );
}

function SessionThread({
  skill,
  initialSessionId,
  initialMessages,
  onSessionId,
  onNewSession,
  initialPrompt,
  scopeHint,
  embedded,
  backgroundStreamId,
  onOwnStream,
}: Omit<SessionViewProps, 'sessionId'> & {
  initialSessionId?: string;
  initialMessages: UIMessage[];
  /** Set while a turn runs in the background (started elsewhere / before reopen). */
  backgroundStreamId?: string;
  onOwnStream?: (busy: boolean) => void;
}) {
  // A skill can arrive mid-session and start proposing (Sessions v2), so
  // "does this session type write?" is no longer a thing to know up front.
  // SessionReview renders nothing when there are no cards; let the cards decide.
  const {
    openDoc,
    openChats,
    refreshProposals,
    openSettings,
    markSessionSeen,
    sessions,
    setSessionLifecycle,
    tree,
    spawnRequests,
    askRequests,
    skills,
  } = useApp();
  const [needsKey, setNeedsKey] = useState(false);
  const onSessionIdRef = useRef(onSessionId);
  onSessionIdRef.current = onSessionId;
  const currentSessionId = useRef(initialSessionId);
  // State copy of the bound id so the header's lifecycle control re-renders.
  const [boundSessionId, setBoundSessionId] = useState(initialSessionId);
  // The skill the PM picked for the NEXT message. A ref because the transport
  // is built once and reads it at send time; the state copy drives the chip.
  const [pickedSkill, setPickedSkill] = useState<string | null>(null);
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const pickedSkillRef = useRef<string | null>(null);
  const pickSkill = (name: string | null) => {
    pickedSkillRef.current = name;
    setPickedSkill(name);
  };
  const transport = useMemo(
    () =>
      new IpcChatTransport(
        skill,
        initialSessionId,
        (id) => {
          currentSessionId.current = id;
          setBoundSessionId(id);
          onSessionIdRef.current?.(id);
        },
        () => {
          // One turn, not a mode: the pick is consumed as the message goes.
          const name = pickedSkillRef.current ?? undefined;
          pickedSkillRef.current = null;
          return name;
        },
      ),
    [skill, initialSessionId],
  );
  const { messages, sendMessage, status, stop, error } = useChat({ transport, messages: initialMessages });
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mentions = useChatMentions(tree, inputRef, input, setInput);
  // Titles + glyphs for the pages a run names, so a kickoff row can say
  // "Prep a meeting on Nordkap weekly" instead of restating the path.
  const noteByPath = useMemo(
    () => new Map((tree?.groups ?? []).flatMap((g) => g.notes).map((n) => [n.path, n])),
    [tree],
  );
  useAutoGrow(inputRef, input);

  const sentInitial = useRef(false);
  const firstMsg = useRef(initialMessages.length === 0);

  const busy = status === 'submitted' || status === 'streaming';
  const waitingFirstToken =
    status === 'submitted' || (busy && messages[messages.length - 1]?.role === 'user');
  // A run this view didn't start (background). Own streams handle themselves.
  const backgroundBusy = !!backgroundStreamId && !busy;
  // The turn is parked on a question card. The composer can't move the
  // session while it is: a message sent now is silently dropped, and the
  // answer belongs in the card that is holding the run.
  const askPending = !!boundSessionId && !!askRequests[boundSessionId];
  // The stored row for this session (once it exists) — drives Mark done/Reopen.
  const overview = boundSessionId ? sessions.find((s) => s.id === boundSessionId) : undefined;

  // Tell the wrapper when this view's own composer drives the stream, so the
  // background-settle refresh doesn't remount a live session.
  useEffect(() => {
    onOwnStream?.(busy);
  }, [busy, onOwnStream]);

  // A turn settling while the PO is right here counts as seen.
  useEffect(() => {
    if (status === 'ready' && currentSessionId.current) markSessionSeen(currentSessionId.current);
  }, [status, markSessionSeen]);

  // Follow the stream only while the PO is at the bottom — scrolling up to
  // reread must not get yanked back down by the next chunk.
  const atBottom = useRef(true);
  useEffect(() => {
    if (atBottom.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, status]);

  const send = (raw: string) => {
    let text = raw;
    if (firstMsg.current && scopeHint) text = `${scopeHint}\n\n${raw}`;
    firstMsg.current = false;
    void sendMessage({ text });
  };

  // Auto-send the initial prompt once (e.g. After-Meeting kickoff).
  useEffect(() => {
    if (initialPrompt && !sentInitial.current) {
      sentInitial.current = true;
      send(initialPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  // After a settled turn, refresh the Inbox — any session may now have proposed.
  useEffect(() => {
    if (status === 'ready') void refreshProposals();
  }, [status, refreshProposals]);

  // Surface the missing-key state BEFORE the first send, not as a failed turn.
  useEffect(() => {
    void invoke['settings:get']()
      .then((s) => setNeedsKey(!s.hasAnthropicKey))
      .catch(() => setNeedsKey(false));
  }, []);
  useEffect(() => {
    // A streaming turn proves the key works — clear a stale banner.
    if (status === 'streaming') setNeedsKey(false);
  }, [status]);

  const submit = () => {
    const text = input.trim();
    if (!text || busy || backgroundBusy || askPending) return;
    setInput('');
    send(text);
    setPickedSkill(null);
  };

  return (
    <div className="flex h-full flex-col">
      {!embedded && (
        // A session states its location exactly as a note does: glyph, the list
        // it belongs to, then its own name — quiet, truncating, tooltipped. The
        // title here is a whole sentence the PO typed, so it gets the smallest
        // type in the app, never the loudest. It names itself once it has a
        // name; before the first turn it is simply a new session.
        <PageHeader
          icon={History}
          crumbs={[{ label: 'Sessions', onClick: (e) => openChats(navFromEvent(e)) }]}
          label={overview?.title || 'New session'}
          labelTitle={overview?.title || undefined}
          meta={overview?.lifecycle === 'done' ? 'done' : undefined}
        >
          <HeaderActions>
            {overview &&
              !busy &&
              !backgroundBusy &&
              (overview.lifecycle === 'active' ? (
                <HeaderAction
                  icon={Check}
                  label="Mark done"
                  title="Mark this session done — it leaves the active list (a new message reopens it)"
                  onClick={() => void setSessionLifecycle(overview.id, 'done')}
                />
              ) : (
                <HeaderAction
                  icon={RotateCcw}
                  label="Reopen"
                  title="Put this session back on the active list"
                  onClick={() => void setSessionLifecycle(overview.id, 'active')}
                />
              ))}
            {onNewSession && (
              <HeaderAction icon={MessageSquarePlus} label="New session" onClick={onNewSession} />
            )}
          </HeaderActions>
        </PageHeader>
      )}

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-6"
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        <div className="mx-auto flex max-w-2xl flex-col gap-4 py-4">
          {messages.length === 0 && !busy && (
            <p className="mt-16 text-center text-sm text-muted-foreground">
              {EMPTY_HINT}
            </p>
          )}
          {messages.map((message, mi) => {
            const parts = message.parts as AnyPart[];
            if (message.role === 'user') {
              const text = parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
              // A skill the PM invoked from a button reads as a run, not as
              // something they said. Anything they actually typed stays a message.
              const kickoff = parseKickoff(text);
              if (kickoff) {
                return (
                  <RunRow
                    key={message.id}
                    kickoff={kickoff}
                    {...(kickoff.target && noteByPath.get(kickoff.target)
                      ? { note: noteByPath.get(kickoff.target)! }
                      : {})}
                    skillTitle={skills.find((s) => s.name === kickoff.skill)?.title ?? kickoff.skill}
                    onOpen={openDoc}
                  />
                );
              }
              return (
                <div key={message.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl bg-secondary px-3.5 py-2 text-secondary-foreground">
                    <Markdown content={messageMarkdown(text)} onOpenNote={openDoc} />
                  </div>
                </div>
              );
            }
            // The working phase (reasoning, tool calls, mid-work narration)
            // folds into one ActivityBlock; only the final text renders as the
            // answer. While streaming, a trailing text is treated as the answer
            // until a later tool call proves it was narration.
            let lastTextIdx = -1;
            for (let i = parts.length - 1; i >= 0; i--) {
              if (parts[i]!.type === 'text') {
                lastTextIdx = i;
                break;
              }
            }
            const activity = parts.filter(
              (p, i) => isActivityPart(p) || (p.type === 'text' && i !== lastTextIdx),
            );
            const answer = lastTextIdx >= 0 ? parts[lastTextIdx]! : undefined;
            const isLastMessage = mi === messages.length - 1;
            const live =
              busy && isLastMessage && activity.length > 0 && isActivityPart(parts[parts.length - 1]!);
            return (
              <div key={message.id} className="w-full">
                {activity.length > 0 && <ActivityBlock parts={activity} live={live} />}
                {answer && (
                  <Markdown
                    content={outsideCode(answer.text ?? '', linkifyNotePaths)}
                    onOpenNote={openDoc}
                  />
                )}
              </div>
            );
          })}
          {waitingFirstToken && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-3.5" /> Reading the memory…
            </div>
          )}
          {backgroundBusy && (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              <Spinner className="size-3.5 shrink-0" />
              <span className="flex-1">
                The agent is still working on this — the session updates when it finishes.
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => backgroundStreamId && void invoke['agent:abort'](backgroundStreamId)}
              >
                <Square className="size-3" /> Stop
              </Button>
            </div>
          )}
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-destructive">
              The session hit an error: {error.message}. Your messages are still here — send again to retry.
            </div>
          )}

          {/* The turn is parked on a question. First of everything below the
              transcript: the agent is holding its whole reading open waiting
              for this, and nothing else here can move until it settles. */}
          {boundSessionId && askRequests[boundSessionId] && (
            <QuestionCard request={askRequests[boundSessionId]!} />
          )}

          {/* A fan-out waiting on approval. Above the proposal cards: nothing
              else in this session can move until it settles. */}
          {boundSessionId && spawnRequests[boundSessionId] && (
            <SpawnCard request={spawnRequests[boundSessionId]!} />
          )}

          {/* The cards this session proposed — approvable right here, so the PO
              never has to hop to the Inbox to close out a meeting. */}
          {boundSessionId && <SessionReview sessionId={boundSessionId} />}
        </div>
      </div>

      {needsKey && (
        <div className="mx-6 mb-2">
          <div className="mx-auto flex max-w-2xl items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
            <span>No Anthropic API key yet — sessions can’t answer until one is set.</span>
            <button
              className="ml-auto shrink-0 font-medium underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              onClick={() => openSettings()}
            >
              Open Settings
            </button>
          </div>
        </div>
      )}

      <div className="px-6 pb-5">
        <div className={COMPOSER_SHELL}>
          {mentions.menu}
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              mentions.refresh();
            }}
            onKeyDown={(e) => {
              if (mentions.onKeyDown(e)) return;
              // `/` on an empty composer opens the skill menu — the same
              // keyboard vocabulary as `@` for notes and `#` for contexts.
              if (e.key === '/' && input.length === 0) {
                e.preventDefault();
                setSkillMenuOpen(true);
                return;
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            onClick={mentions.refresh}
            onBlur={mentions.close}
            placeholder={
              askPending
                ? 'Answer the question above to carry on…'
                : backgroundBusy
                  ? 'Waiting for the running turn to finish…'
                  : pickedSkill
                    ? `What should “${skills.find((s) => s.name === pickedSkill)?.title ?? pickedSkill}” work on?`
                    : 'Ask your product memory…'
            }
            rows={1}
            disabled={backgroundBusy || askPending}
            className={COMPOSER_INPUT}
          />
          <div className={COMPOSER_ROW}>
            <SkillPicker
              picked={pickedSkill}
              onPick={pickSkill}
              onClosed={() => inputRef.current?.focus()}
              open={skillMenuOpen}
              onOpenChange={setSkillMenuOpen}
              disabled={backgroundBusy || askPending}
            />
            <MentionHint show={!input.trim() && !backgroundBusy && !askPending} />
            {busy ? (
              <Button
                size="icon-sm"
                variant="outline"
                className="ml-auto"
                onClick={() => stop()}
                aria-label="Stop"
              >
                <Square className="size-3.5" />
              </Button>
            ) : (
              <SendButton
                ready={!!input.trim() && !backgroundBusy && !askPending}
                onClick={submit}
                label="Send"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
