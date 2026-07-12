import { useMemo, useState, useRef, useEffect } from 'react';
import { useChat } from '@ai-sdk/react';
import { Button, Spinner } from '@pm/ui';
import { ArrowUp, Square, Wrench, Brain, ChevronDown } from 'lucide-react';
import { IpcChatTransport } from '../lib/ipc-transport';
import { Markdown } from '../components/Markdown';
import { useApp } from '../state/app-state';

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
      >
        <Brain className="size-3.5" />
        <span className="font-medium">Reasoning</span>
        <ChevronDown className={`ml-auto size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="whitespace-pre-wrap px-2 pb-2 text-muted-foreground">{text}</div>}
    </div>
  );
}

function ToolPart({ part }: { part: AnyPart }) {
  const name = part.type.startsWith('tool-') ? part.type.slice(5) : part.toolName ?? 'tool';
  const done = part.state === 'output-available' || part.output !== undefined;
  return (
    <div className="my-1 flex items-start gap-1.5 rounded-md border border-border/60 bg-card px-2 py-1 text-xs">
      {done ? <Wrench className="mt-0.5 size-3.5 text-brand" /> : <Spinner className="mt-0.5 size-3.5" />}
      <div className="min-w-0 flex-1">
        <span className="font-mono font-medium">{name}</span>
        {part.errorText && <div className="text-destructive">{part.errorText}</div>}
        {done && typeof part.output === 'string' && (
          <pre className="mt-0.5 max-h-32 overflow-y-auto whitespace-pre-wrap text-muted-foreground">
            {part.output.slice(0, 800)}
          </pre>
        )}
      </div>
    </div>
  );
}

export function ChatView({
  sessionType = 'chat',
  initialPrompt,
}: {
  sessionType?: 'chat' | 'ask' | 'triage' | 'ingest-transcript';
  initialPrompt?: string;
}) {
  const proposesWrites = sessionType === 'triage' || sessionType === 'ingest-transcript';
  const { openNote, refreshProposals, showReview, pendingCount } = useApp();
  const transport = useMemo(() => new IpcChatTransport(sessionType), [sessionType]);
  const { messages, sendMessage, status, stop, error } = useChat({ transport });
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentInitial = useRef(false);

  const busy = status === 'submitted' || status === 'streaming';

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, status]);

  // Auto-send the initial prompt once (e.g. triage kickoff).
  useEffect(() => {
    if (initialPrompt && !sentInitial.current) {
      sentInitial.current = true;
      void sendMessage({ text: initialPrompt });
    }
  }, [initialPrompt, sendMessage]);

  // After a proposing turn settles, refresh the review queue.
  useEffect(() => {
    if (status === 'ready' && proposesWrites) void refreshProposals();
  }, [status, proposesWrites, refreshProposals]);

  const submit = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    void sendMessage({ text });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 items-center px-5 text-sm font-medium text-muted-foreground" style={{ WebkitAppRegion: 'drag' } as never}>
        {sessionType === 'ask'
          ? 'Ask the brain'
          : sessionType === 'triage'
            ? 'Triage'
            : sessionType === 'ingest-transcript'
              ? 'Ingest transcript'
              : 'Chat'}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-4 py-4">
          {messages.length === 0 && (
            <p className="mt-16 text-center text-sm text-muted-foreground">
              Ask about onboarding, a theme, or what you know about a customer.
            </p>
          )}
          {messages.map((message) => (
            <div key={message.id} className={message.role === 'user' ? 'flex justify-end' : ''}>
              <div
                className={
                  message.role === 'user'
                    ? 'max-w-[85%] rounded-2xl bg-brand px-3.5 py-2 text-[15px] text-brand-foreground'
                    : 'w-full'
                }
              >
                {(message.parts as AnyPart[]).map((part, i) => {
                  if (part.type === 'text') {
                    return message.role === 'user' ? (
                      <span key={i} className="whitespace-pre-wrap">{part.text}</span>
                    ) : (
                      <Markdown key={i} content={part.text ?? ''} onOpenNote={openNote} />
                    );
                  }
                  if (part.type === 'reasoning') return <ReasoningPart key={i} text={part.text ?? ''} />;
                  if (part.type.startsWith('tool-') || part.type === 'dynamic-tool')
                    return <ToolPart key={i} part={part} />;
                  return null;
                })}
              </div>
            </div>
          ))}
          {error && <div className="text-sm text-destructive">Error: {error.message}</div>}
        </div>
      </div>

      {proposesWrites && pendingCount > 0 && (
        <div className="mx-6 mb-2">
          <button
            className="mx-auto flex max-w-2xl w-full items-center gap-2 rounded-lg border border-brand/40 bg-brand/8 px-3 py-2 text-sm text-brand"
            onClick={showReview}
          >
            <span className="font-medium">{pendingCount} proposal{pendingCount === 1 ? '' : 's'} to review</span>
            <span className="ml-auto">Open review queue →</span>
          </button>
        </div>
      )}

      <div className="px-6 pb-5">
        <div className="mx-auto flex max-w-2xl items-end gap-2 rounded-xl border border-border bg-card p-2 shadow-sm">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Ask the brain…"
            rows={1}
            className="max-h-40 flex-1 resize-none bg-transparent px-1.5 py-1 text-[15px] outline-none"
          />
          {busy ? (
            <Button size="icon-sm" variant="outline" onClick={() => stop()}>
              <Square className="size-3.5" />
            </Button>
          ) : (
            <Button size="icon-sm" onClick={submit} disabled={!input.trim()}>
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
