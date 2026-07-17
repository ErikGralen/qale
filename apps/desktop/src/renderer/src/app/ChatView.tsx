import { useMemo, useState, useRef, useEffect } from 'react';
import { useChat } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { Button, Spinner } from '@pm/ui';
import { AlertTriangle, ArrowUp, Check, Square, Wrench, Brain, ChevronDown, MessageSquarePlus, RotateCcw, Star } from 'lucide-react';
import { IpcChatTransport } from '../lib/ipc-transport';
import { Markdown } from '../components/Markdown';
import { useApp } from '../state/app-state';
import { invoke } from '../lib/ipc';
import { useChatMentions } from './ChatMentions';

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
  output?: unknown;
  errorText?: string;
}

function ReasoningPart({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1 rounded-md border border-border/60 bg-muted/40 text-xs">
      <button
        className="flex w-full items-center gap-1.5 px-2 py-1 text-muted-foreground"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <Brain className="size-3.5" />
        <span className="font-medium">Reasoning</span>
        <ChevronDown className={`ml-auto size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="whitespace-pre-wrap px-2 pb-2 text-muted-foreground">{text}</div>}
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

/**
 * Tool activity — one quiet line while running, expandable receipt when done.
 * The raw output stays one click away instead of scrolling past as a log dump.
 */
function ToolPart({ part }: { part: AnyPart }) {
  const [open, setOpen] = useState(false);
  const name = part.type.startsWith('tool-') ? part.type.slice(5) : part.toolName ?? 'tool';
  const done = part.state === 'output-available' || part.output !== undefined;
  const hasOutput = done && typeof part.output === 'string' && part.output.length > 0;
  return (
    <div className="my-1 rounded-md border border-border/60 bg-card text-xs">
      <button
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left"
        onClick={() => hasOutput && setOpen((o) => !o)}
        aria-expanded={open}
        disabled={!hasOutput}
      >
        {done ? <Wrench className="size-3.5 shrink-0 text-brand" /> : <Spinner className="size-3.5 shrink-0" />}
        <span className="font-mono font-medium">{name}</span>
        {!done && <span className="text-muted-foreground">running…</span>}
        {hasOutput && (
          <ChevronDown className={`ml-auto size-3.5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
        )}
      </button>
      {part.errorText && <div className="px-2 pb-1.5 text-destructive">{part.errorText}</div>}
      {open && hasOutput && (
        <pre className="max-h-48 overflow-y-auto border-t border-border/60 px-2 py-1.5 whitespace-pre-wrap text-muted-foreground">
          {(part.output as string).slice(0, 2000)}
        </pre>
      )}
    </div>
  );
}

const EMPTY_HINT: Record<string, string> = {
  ask: 'Ask about a decision, a customer, or a problem — answers cite their sources, or say "I don\'t know".',
  chat: 'A free-form chat over the workspace. Nothing is written without an approval card.',
};

interface ChatViewProps {
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
  const proposesWrites = sessionType !== 'chat' && sessionType !== 'ask';
  const { openDoc, refreshProposals, openInbox, openSettings, pendingCount, activeTabId, keepTab, markSessionSeen, sessions, setSessionLifecycle, tree } = useApp();
  const [needsKey, setNeedsKey] = useState(false);
  const onSessionIdRef = useRef(onSessionId);
  onSessionIdRef.current = onSessionId;
  const currentSessionId = useRef(initialSessionId);
  // State copy of the bound id so the header's lifecycle control re-renders.
  const [boundSessionId, setBoundSessionId] = useState(initialSessionId);
  const transport = useMemo(
    () =>
      new IpcChatTransport(sessionType, initialSessionId, (id) => {
        currentSessionId.current = id;
        setBoundSessionId(id);
        onSessionIdRef.current?.(id);
      }),
    [sessionType, initialSessionId],
  );
  const { messages, sendMessage, status, stop, error } = useChat({ transport, messages: initialMessages });
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mentions = useChatMentions(tree, inputRef, input, setInput);

  // A draft in the composer commits the tab — a preview replacement must not
  // eat an unsent message. Sent messages promote via onSessionId → bindTabSession.
  useEffect(() => {
    if (input && activeTabId) keepTab(activeTabId);
  }, [input, activeTabId, keepTab]);
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

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
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

  // After a proposing turn settles, refresh the Inbox.
  useEffect(() => {
    if (status === 'ready' && proposesWrites) void refreshProposals();
  }, [status, proposesWrites, refreshProposals]);

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

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-4 py-4">
          {messages.length === 0 && !busy && (
            <p className="mt-16 text-center text-sm text-muted-foreground">
              {EMPTY_HINT[sessionType] ?? 'The session reads its skill file, then works — every write becomes a card.'}
            </p>
          )}
          {messages.map((message, mi) => {
            const answerText = (message.parts as AnyPart[])
              .filter((p) => p.type === 'text')
              .map((p) => p.text ?? '')
              .join('\n');
            const prevUser = [...messages.slice(0, mi)].reverse().find((m) => m.role === 'user');
            const question = prevUser
              ? (prevUser.parts as AnyPart[]).filter((p) => p.type === 'text').map((p) => p.text).join(' ')
              : '';
            const canGolden =
              sessionType === 'ask' && message.role === 'assistant' && status === 'ready' && answerText.trim().length > 0;
            return (
              <div key={message.id} className={message.role === 'user' ? 'flex justify-end' : ''}>
                <div
                  className={
                    message.role === 'user'
                      ? 'max-w-[85%] rounded-2xl bg-secondary px-3.5 py-2 text-[15px] text-secondary-foreground'
                      : 'w-full'
                  }
                >
                  {(message.parts as AnyPart[]).map((part, i) => {
                    if (part.type === 'text') {
                      return message.role === 'user' ? (
                        <span key={i} className="whitespace-pre-wrap">{part.text}</span>
                      ) : (
                        <Markdown key={i} content={linkifyNotePaths(part.text ?? '')} onOpenNote={openDoc} />
                      );
                    }
                    if (part.type === 'reasoning') return <ReasoningPart key={i} text={part.text ?? ''} />;
                    if (part.type.startsWith('tool-') || part.type === 'dynamic-tool')
                      return <ToolPart key={i} part={part} />;
                    return null;
                  })}
                  {canGolden && <GoldenButton question={question} answer={answerText} />}
                </div>
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

      {proposesWrites && pendingCount > 0 && (
        <div className="mx-6 mb-2">
          <button
            className="mx-auto flex max-w-2xl w-full items-center gap-2 rounded-lg border border-brand/40 bg-brand/8 px-3 py-2 text-sm text-brand hover:bg-brand/12 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={() => openInbox()}
          >
            <span className="font-medium">{pendingCount} proposal{pendingCount === 1 ? '' : 's'} to review</span>
            <span className="ml-auto">Open Inbox →</span>
          </button>
        </div>
      )}

      <div className="px-6 pb-5">
        <div className="relative mx-auto flex max-w-2xl items-end gap-2 rounded-xl border border-border bg-card p-2 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
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
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            onClick={mentions.refresh}
            onBlur={mentions.close}
            placeholder={backgroundBusy ? 'Waiting for the running turn to finish…' : 'Ask your product memory… (@ note, # context)'}
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
