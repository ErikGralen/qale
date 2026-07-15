import { useMemo, useState, useRef, useEffect } from 'react';
import { useChat } from '@ai-sdk/react';
import { Button, Spinner } from '@pm/ui';
import { ArrowUp, Square, Wrench, Brain, ChevronDown, Star } from 'lucide-react';
import { IpcChatTransport } from '../lib/ipc-transport';
import { Markdown } from '../components/Markdown';
import { useApp } from '../state/app-state';
import { invoke } from '../lib/ipc';

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
    <button
      className="mt-2 flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-60"
      onClick={save}
      disabled={saved}
      title={citations.length ? `Cites ${citations.length} source(s)` : 'No citations — will be flagged as inference'}
    >
      <Star className="size-3.5" /> {saved ? 'Saved to Inbox' : 'Save as golden answer'}
    </button>
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
  scopeHint,
}: {
  sessionType?: 'chat' | 'ask' | 'after-meeting';
  initialPrompt?: string;
  /** Prepended to the first user message to scope the read (side chat). */
  scopeHint?: string;
}) {
  const proposesWrites = sessionType === 'after-meeting';
  const { openDoc, refreshProposals, openInbox, pendingCount } = useApp();
  const transport = useMemo(() => new IpcChatTransport(sessionType), [sessionType]);
  const { messages, sendMessage, status, stop, error } = useChat({ transport });
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentInitial = useRef(false);
  const firstMsg = useRef(true);

  const busy = status === 'submitted' || status === 'streaming';

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

  const submit = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    send(text);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 items-center px-5 text-sm font-medium text-muted-foreground" style={{ WebkitAppRegion: 'drag' } as never}>
        {sessionType === 'ask'
          ? 'Ask your product memory'
          : sessionType === 'after-meeting'
            ? 'After-Meeting'
            : 'Chat'}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-4 py-4">
          {messages.length === 0 && (
            <p className="mt-16 text-center text-sm text-muted-foreground">
              Ask about a decision, a customer, or what you know about a problem.
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
                      ? 'max-w-[85%] rounded-2xl bg-brand px-3.5 py-2 text-[15px] text-brand-foreground'
                      : 'w-full'
                  }
                >
                  {(message.parts as AnyPart[]).map((part, i) => {
                    if (part.type === 'text') {
                      return message.role === 'user' ? (
                        <span key={i} className="whitespace-pre-wrap">{part.text}</span>
                      ) : (
                        <Markdown key={i} content={part.text ?? ''} onOpenNote={openDoc} />
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
          {error && <div className="text-sm text-destructive">Error: {error.message}</div>}
        </div>
      </div>

      {proposesWrites && pendingCount > 0 && (
        <div className="mx-6 mb-2">
          <button
            className="mx-auto flex max-w-2xl w-full items-center gap-2 rounded-lg border border-brand/40 bg-brand/8 px-3 py-2 text-sm text-brand"
            onClick={openInbox}
          >
            <span className="font-medium">{pendingCount} proposal{pendingCount === 1 ? '' : 's'} to review</span>
            <span className="ml-auto">Open Inbox →</span>
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
            placeholder="Ask your product memory…"
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
