import { useMemo, useState, useRef, useEffect } from 'react';
import { useChat } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { Button, Spinner } from '@pm/ui';
import { AlertTriangle, ArrowUp, Check, Square, Wrench, Brain, ChevronDown, MessageSquarePlus, RotateCcw, Star } from 'lucide-react';
import { IpcChatTransport } from '../lib/ipc-transport';
import { Markdown } from '../components/Markdown';
import { SessionReview } from '../components/inbox/SessionReview';
import { SpawnCard } from '../components/inbox/SpawnCard';
import { useApp } from '../state/app-state';
import { invoke } from '../lib/ipc';
import { useChatMentions } from './ChatMentions';
import { SkillPicker } from './SkillPicker';

/**
 * Wrap bare note-path citations (decisions/adopt-workos.md) in wikilinks so they
 * render clickable. Skips paths already inside wikilinks or markdown link parens
 * (those are preceded by `[` / `(`, which the prefix class excludes).
 */
function linkifyNotePaths(text: string): string {
  return text.replace(/(^|[\s,;:])([a-z][\w-]*\/[\w./-]+\.md)\b/gim, '$1[[$2]]');
}

/** Pull citation refs from an answer: wikilinks, bare note paths, and URLs. */
function extractCitations(text: string): string[] {
  const refs = new Set<string>();
  for (const m of text.matchAll(/\[\[([^\]]+)\]\]/g)) refs.add(`[[${m[1]!.split('|')[0]!.split('#')[0]!.trim()}]]`);
  for (const m of text.matchAll(/(?:^|[\s(])([a-z][\w-]*\/[\w./-]+\.md)/gim)) refs.add(`[[${m[1]!.replace(/\.md$/, '')}]]`);
  for (const m of text.matchAll(/https?:\/\/[^\s)]+/g)) refs.add(m[0]!);
  return [...refs];
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

/** Past-tense verb + monospace detail for one tool step in the expanded trail. */
function stepLabel(part: AnyPart): { verb: string; detail?: string } {
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
      return { verb: 'Listed notes', detail: [str('type'), str('status')].filter(Boolean).join('/') || undefined };
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
    case 'files_write':
    case 'write_result':
      return { verb: 'Wrote', detail: str('path') };
    case 'files_edit':
      return { verb: 'Edited', detail: str('path') };
    case 'files_read':
      return { verb: 'Read session file', detail: str('path') };
    case 'files_list':
      return { verb: 'Listed session files' };
    case 'advance_checkpoint':
      return { verb: 'Advanced checkpoint' };
    default:
      if (name.startsWith('propose_'))
        return { verb: `Proposed a ${name.slice(8).replace(/_/g, ' ')}`, detail: str('path') ?? str('title') };
      if (name.startsWith('draft_'))
        return { verb: `Drafted a ${name.slice(6).replace(/_/g, ' ')}`, detail: str('title') ?? str('summary') };
      return { verb: name, detail: str('path') ?? str('query') ?? str('name') };
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

/** One tool step inside the expanded trail — raw receipt stays one click away. */
function ToolStep({ part }: { part: AnyPart }) {
  const [open, setOpen] = useState(false);
  const { verb, detail } = stepLabel(part);
  const done = part.state === 'output-available' || part.state === 'output-error' || part.output !== undefined;
  const hasOutput = typeof part.output === 'string' && part.output.length > 0;
  return (
    <div>
      <button
        className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
        onClick={() => hasOutput && setOpen((o) => !o)}
        aria-expanded={open}
        disabled={!hasOutput}
      >
        {done ? <Wrench className="size-3 shrink-0" /> : <Spinner className="size-3 shrink-0" />}
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
    if (part.errorText || part.state === 'output-error') failed++;
  }
  const bits: string[] = [];
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
        <span className="truncate font-medium">{live ? liveLabel(parts[parts.length - 1]) : 'Reasoning'}</span>
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

/** Turn an approved ask answer into a golden-answer insight card (PLAN-V2 §4). */
function GoldenButton({ question, answer }: { question: string; answer: string }) {
  const { openInbox, refreshProposals } = useApp();
  const [saved, setSaved] = useState(false);
  const citations = useMemo(() => extractCitations(answer), [answer]);
  const save = async () => {
    await invoke['golden:save']({ question: question || answer.slice(0, 80), answer, sources: citations });
    setSaved(true);
    await refreshProposals();
    openInbox();
  };
  return (
    <div className="mt-2 flex items-center gap-2">
      <button
        className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-60"
        onClick={save}
        disabled={saved}
      >
        <Star className="size-3.5" /> {saved ? 'Saved to Inbox' : 'Save as golden answer'}
      </button>
      {!saved &&
        (citations.length > 0 ? (
          <span className="text-xs text-muted-foreground">cites {citations.length} source{citations.length === 1 ? '' : 's'}</span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-warning">
            <AlertTriangle className="size-3" /> no citations — will be flagged as inference
          </span>
        ))}
    </div>
  );
}

const EMPTY_HINT: Record<string, string> = {
  ask: 'Ask about a decision, a customer, or a theme — answers cite their sources, or say "I don\'t know".',
  chat: 'A conversation with your memory. Pick a skill (or let the agent load one) when it turns into work — nothing is written without an approval card.',
};

interface ChatViewProps {
  /**
   * The skill to invoke on the first turn (Sessions v2 Part 4). Not a mode: the
   * session is the same session either way, and a second skill can arrive after
   * this one. The entry-point buttons and Landing tiles pass it and read exactly
   * as they did — they just mean "start a session and invoke this" now.
   */
  sessionType?: string;
  /** Stored conversation to reopen — its transcript replays before the chat mounts. */
  sessionId?: string;
  /** Fired when the main process assigns this conversation its id (first turn). */
  onSessionId?: (sessionId: string) => void;
  /** Shows a "New chat" button in the header wired to this. */
  onNewChat?: () => void;
  initialPrompt?: string;
  /** Prepended to the first user message to scope the read (side chat). */
  scopeHint?: string;
}

/**
 * Loads the stored transcript (if any) before mounting the live chat, so
 * reopening yesterday's conversation shows its history and keeps going in the
 * same pi session. If the session has a turn running in the background (kicked
 * off, tab closed, reopened), the view shows the transcript so far with a
 * working banner and refreshes itself when the run settles.
 */
export function ChatView({ sessionId, ...props }: ChatViewProps) {
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

  // Opening the conversation counts as seeing it.
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
        <Spinner className="size-4" /> Opening the conversation…
      </div>
    );
  }
  return (
    <ChatSession
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

function ChatSession({
  sessionType = 'chat',
  initialSessionId,
  initialMessages,
  onSessionId,
  onNewChat,
  initialPrompt,
  scopeHint,
  backgroundStreamId,
  onOwnStream,
}: Omit<ChatViewProps, 'sessionId'> & {
  initialSessionId?: string;
  initialMessages: UIMessage[];
  /** Set while a turn runs in the background (started elsewhere / before reopen). */
  backgroundStreamId?: string;
  onOwnStream?: (busy: boolean) => void;
}) {
  // A skill can arrive mid-conversation and start proposing (Sessions v2), so
  // "does this session type write?" is no longer a thing to know up front.
  // SessionReview renders nothing when there are no cards; let the cards decide.
  const { openDoc, refreshProposals, openSettings, markSessionSeen, sessions, setSessionLifecycle, tree, spawnRequests } =
    useApp();
  const [needsKey, setNeedsKey] = useState(false);
  const onSessionIdRef = useRef(onSessionId);
  onSessionIdRef.current = onSessionId;
  const currentSessionId = useRef(initialSessionId);
  // State copy of the bound id so the header's lifecycle control re-renders.
  const [boundSessionId, setBoundSessionId] = useState(initialSessionId);
  // The skill the PM picked for the NEXT message. A ref because the transport
  // is built once and reads it at send time; the state copy drives the chip.
  const [pickedSkill, setPickedSkill] = useState<string | null>(null);
  const pickedSkillRef = useRef<string | null>(null);
  const pickSkill = (name: string | null) => {
    pickedSkillRef.current = name;
    setPickedSkill(name);
  };
  const transport = useMemo(
    () =>
      new IpcChatTransport(
        sessionType,
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
    [sessionType, initialSessionId],
  );
  const { messages, sendMessage, status, stop, error } = useChat({ transport, messages: initialMessages });
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mentions = useChatMentions(tree, inputRef, input, setInput);

  const sentInitial = useRef(false);
  const firstMsg = useRef(initialMessages.length === 0);

  const busy = status === 'submitted' || status === 'streaming';
  const waitingFirstToken =
    status === 'submitted' || (busy && messages[messages.length - 1]?.role === 'user');
  // A run this view didn't start (background). Own streams handle themselves.
  const backgroundBusy = !!backgroundStreamId && !busy;
  // The stored row for this conversation (once it exists) — drives Mark done/Reopen.
  const overview = boundSessionId ? sessions.find((s) => s.id === boundSessionId) : undefined;

  // Tell the wrapper when this view's own composer drives the stream, so the
  // background-settle refresh doesn't remount a live conversation.
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
    if (!text || busy || backgroundBusy) return;
    setInput('');
    send(text);
    setPickedSkill(null);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 items-center border-b border-border px-5 text-sm font-medium text-muted-foreground">
        {sessionType === 'ask'
          ? 'Ask your product memory'
          : sessionType === 'chat'
            ? 'Chat'
            : sessionType.replace(/(^|\s|-)\w/g, (c) => c.toUpperCase()).replace(/-/g, ' ')}
        <span className="ml-auto flex items-center gap-1">
          {overview && !busy && !backgroundBusy && (
            overview.lifecycle === 'active' ? (
              <button
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                onClick={() => void setSessionLifecycle(overview.id, 'done')}
                title="Mark this conversation done — it leaves the active list (a new message reopens it)"
              >
                <Check className="size-3.5" /> Mark done
              </button>
            ) : (
              <button
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                onClick={() => void setSessionLifecycle(overview.id, 'active')}
                title="Put this conversation back on the active list"
              >
                <RotateCcw className="size-3.5" /> Reopen
              </button>
            )
          )}
          {onNewChat && (
            <button
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              onClick={onNewChat}
              title="Start a new conversation"
            >
              <MessageSquarePlus className="size-3.5" /> New chat
            </button>
          )}
        </span>
      </div>

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
              {EMPTY_HINT[sessionType] ?? 'The session reads its skill file, then works — every write becomes a card.'}
            </p>
          )}
          {messages.map((message, mi) => {
            const parts = message.parts as AnyPart[];
            const answerText = parts
              .filter((p) => p.type === 'text')
              .map((p) => p.text ?? '')
              .join('\n');
            const prevUser = [...messages.slice(0, mi)].reverse().find((m) => m.role === 'user');
            const question = prevUser
              ? (prevUser.parts as AnyPart[]).filter((p) => p.type === 'text').map((p) => p.text).join(' ')
              : '';
            const canGolden =
              sessionType === 'ask' && message.role === 'assistant' && status === 'ready' && answerText.trim().length > 0;
            if (message.role === 'user') {
              return (
                <div key={message.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl bg-secondary px-3.5 py-2 text-[15px] whitespace-pre-wrap text-secondary-foreground">
                    {parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n')}
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
                {answer && <Markdown content={linkifyNotePaths(answer.text ?? '')} onOpenNote={openDoc} />}
                {canGolden && <GoldenButton question={question} answer={answerText} />}
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
                The agent is still working on this — the conversation updates when it finishes.
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

          {/* A fan-out waiting on approval. Above the proposal cards: nothing
              else in this conversation can move until it settles. */}
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
            <span>No Anthropic API key yet — chats can’t answer until one is set.</span>
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
        <div className="relative mx-auto flex max-w-2xl items-end gap-2 rounded-xl border border-border bg-card p-2 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
          {mentions.menu}
          <SkillPicker picked={pickedSkill} onPick={pickSkill} disabled={backgroundBusy} />
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              mentions.refresh();
            }}
            onKeyDown={(e) => {
              if (mentions.onKeyDown(e)) return;
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            onClick={mentions.refresh}
            onBlur={mentions.close}
            placeholder={
              backgroundBusy
                ? 'Waiting for the running turn to finish…'
                : pickedSkill
                  ? `What should ${pickedSkill} work on?`
                  : 'Ask your product memory… (@ note, # context)'
            }
            rows={1}
            disabled={backgroundBusy}
            className="max-h-40 flex-1 resize-none bg-transparent px-1.5 py-1 text-[15px] outline-none disabled:opacity-50"
          />
          {busy ? (
            <Button size="icon-sm" variant="outline" onClick={() => stop()} aria-label="Stop">
              <Square className="size-3.5" />
            </Button>
          ) : (
            <Button size="icon-sm" onClick={submit} disabled={!input.trim() || backgroundBusy} aria-label="Send">
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
