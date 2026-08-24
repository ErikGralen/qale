import { useEffect, useMemo, useRef, useState } from 'react';
// The slot parser only, straight from its own file: the renderer draws a box
// where the agent package parsed one, and @qale/agent's index is main-only.
import { parseSlots, type Slot } from '@qale/agent/slots';
import type { AskRequestDTO } from '@qale/ipc';
import { Button } from '@qale/ui';
import { SquarePen } from 'lucide-react';
import { Key, useAutoGrow } from '../components/Composer';
import { Markdown } from '../components/Markdown';
import { stripFrontmatter } from '../lib/frontmatter';
import { invoke } from '../lib/ipc';
import type { NavOpts } from '../lib/nav';
import { isMarkdownFile } from '../lib/session-files';
import { useApp } from '../state/app-state';

/**
 * The one reader behind both places a session's working file can be read: the
 * right rail's preview and the full-width tab. Same renderer in both, so a file
 * never looks like two different things depending on where it opened.
 *
 * These files are written for the PM to READ — a brief, a per-item extraction —
 * so markdown is rendered, not dumped as source. Rendering is not editing: the
 * file stays read-only, keeps its "not part of your memory" strip, and gets no
 * properties block, so nothing here suggests it is a note.
 *
 * One file breaks that rule, and only while it is asked for: a round the session
 * parked on with `request_comments` (docs/brainstorm-skill.md). Its slot fences
 * become boxes, a general box sits at the foot of it, and Send hands the lot
 * back to the waiting turn. The moment the round settles it is an ordinary
 * read-only file again.
 *
 * The boxes are drawn in the TAB only. The rail is too narrow to write a
 * paragraph in, but it must not show the questions as the raw fences either —
 * a code block where a question belongs reads as debris. So the rail passes
 * `answering` too, plus `writeInTab`: each question becomes a row that says
 * what was asked and opens the tab to answer it.
 */

/**
 * One working file's text. `version` (the file's mtime) is a dependency on
 * purpose: a fan-out that rewrites the file the PM is reading must update under
 * them rather than go quietly stale behind an open preview.
 *
 * `undefined` = still reading · `null` = gone.
 */
function useSessionFileText(
  sessionId: string,
  path: string,
  version?: number,
): string | null | undefined {
  const [text, setText] = useState<string | null | undefined>(undefined);

  // Only a NEW file clears to the skeleton; a rewrite of the open one swaps its
  // text in place, so live growth doesn't strobe the pane.
  useEffect(() => setText(undefined), [sessionId, path]);

  useEffect(() => {
    let cancelled = false;
    invoke['sessions:fileText'](sessionId, path)
      .then((t) => {
        if (!cancelled) setText(t);
      })
      .catch(() => {
        if (!cancelled) setText(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, path, version]);

  return text;
}

/** Loading placeholder shaped like the prose it replaces — no spinner parked in
 *  the middle of content. */
function ReadingSkeleton() {
  return (
    <div className="flex flex-col gap-2.5" role="status" aria-label="Opening file">
      {[38, 96, 88, 72, 94, 60].map((w, i) => (
        <div
          key={i}
          className={`animate-pulse rounded bg-muted motion-reduce:animate-none ${i === 0 ? 'h-3.5' : 'h-2.5'}`}
          style={{ width: `${w}%`, animationDelay: `${i * 90}ms` }}
        />
      ))}
    </div>
  );
}

/**
 * The file's content, in whatever form suits it: rendered markdown for the
 * briefs and extractions sessions actually write, monospace source for anything
 * else (json, csv, a stray log) where the characters are the point.
 */
export function SessionFileBody({
  sessionId,
  path,
  version,
  className = '',
  answering,
  writeInTab,
  onGone,
}: {
  sessionId: string;
  path: string;
  version?: number;
  className?: string;
  /** The comment request this file is the round for: boxes instead of fences. */
  answering?: AskRequestDTO | null;
  /** Set by the rail: the questions are read-only here, and this opens the tab
   *  that can answer them. */
  writeInTab?: () => void;
  /** Rendered under the "this file is gone" message — a way back to the list. */
  onGone?: React.ReactNode;
}) {
  const { openDoc } = useApp();
  const text = useSessionFileText(sessionId, path, version);
  const body = typeof text === 'string' ? stripFrontmatter(text).trim() : '';
  // Parsed here rather than inside the form, because a round that no longer
  // parses has to fall all the way back to plain reading. Half a form is worse
  // than none: a box the parked request has no id for takes an answer nobody
  // will ever read.
  const slots = useMemo(() => {
    if (!answering?.comments || !isMarkdownFile(path) || !body) return null;
    const parsed = parseSlots(body);
    return 'error' in parsed || parsed.slots.length === 0 ? null : parsed.slots;
  }, [answering, body, path]);

  if (text === undefined)
    return (
      <div className={className}>
        <ReadingSkeleton />
      </div>
    );

  if (text === null) {
    return (
      <div className={`flex flex-col items-start gap-3 ${className}`}>
        <p className="text-dense leading-relaxed text-muted-foreground">
          This file is gone. Session files are working material, and nothing keeps them.
        </p>
        {onGone}
      </div>
    );
  }

  if (!isMarkdownFile(path)) {
    return (
      <pre
        className={`overflow-x-auto font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-foreground/90 ${className}`}
      >
        {text}
      </pre>
    );
  }

  if (!body) {
    return (
      <p className={`text-dense leading-relaxed text-muted-foreground ${className}`}>
        Empty so far. The session has the file open but hasn't written to it yet.
      </p>
    );
  }

  if (answering && slots) {
    return (
      <div className={className}>
        {writeInTab ? (
          <CommentsPreview request={answering} body={body} slots={slots} writeInTab={writeInTab} />
        ) : (
          <CommentsForm request={answering} body={body} slots={slots} />
        )}
      </div>
    );
  }

  return (
    <div className={className}>
      {/* Wikilinks resolve: a working file citing [[customers/nordkap]] is one
          click from the note it read, which is half of why it's readable. */}
      <Markdown content={body} onOpenNote={(p, opts) => void openDoc(p, opts)} />
    </div>
  );
}

/**
 * What the model asked at each slot, keyed by id. Taken from the parked request
 * rather than from the file: that is the text it will be answered against, and
 * it is already flattened to one line.
 */
function usePrompts(request: AskRequestDTO): Map<string, string> {
  return useMemo(
    () => new Map((request.comments?.slots ?? []).map((s) => [s.id, s.prompt ?? ''])),
    [request],
  );
}

/**
 * The document split at the fences: prose, slot, prose, slot. Each piece of
 * prose is its own Markdown render, which is also why a slot never lands
 * mid-sentence: the model writes them between blocks. Both readers split it the
 * same way and differ only in what they put where a fence was.
 */
function splitAtSlots(
  body: string,
  slots: readonly Slot[],
  renderSlot: (slot: Slot) => React.ReactNode,
  onOpenNote: (path: string, opts?: NavOpts) => void,
): React.ReactNode[] {
  const pieces: React.ReactNode[] = [];
  let cursor = 0;
  for (const slot of slots) {
    const before = body.slice(cursor, slot.start);
    if (before.trim()) {
      pieces.push(<Markdown key={`text-${cursor}`} content={before} onOpenNote={onOpenNote} />);
    }
    pieces.push(renderSlot(slot));
    cursor = slot.end;
  }
  const tail = body.slice(cursor);
  if (tail.trim()) {
    pieces.push(<Markdown key="text-tail" content={tail} onOpenNote={onOpenNote} />);
  }
  return pieces;
}

/**
 * The round as the rail shows it: the same prose, and at every slot the
 * question it asked, as a row that opens the tab where it can be answered. No
 * boxes — a paragraph cannot be written in a third of the window — but no raw
 * fences either, and no question the PM has to go looking for.
 */
function CommentsPreview({
  request,
  body,
  slots,
  writeInTab,
}: {
  request: AskRequestDTO;
  body: string;
  slots: readonly Slot[];
  writeInTab: () => void;
}) {
  const { openDoc } = useApp();
  const prompts = usePrompts(request);

  return (
    <div>
      {splitAtSlots(
        body,
        slots,
        (slot) => (
          <button
            key={`slot-${slot.id}`}
            className="my-4 flex w-full items-start gap-1.5 rounded-xl border border-brand/25 bg-brand/5 px-3 py-2.5 text-left transition-colors hover:bg-brand/10 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={writeInTab}
            title="Open in a tab to answer this"
          >
            <SquarePen className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden />
            <span className="min-w-0">
              <span className="block text-dense leading-snug font-medium text-foreground">
                {prompts.get(slot.id) || slot.prompt || 'What do you think?'}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Open in a tab to answer
              </span>
            </span>
          </button>
        ),
        (p, opts) => void openDoc(p, opts),
      )}
    </div>
  );
}

/**
 * The round, with a box wherever the session left a slot. The document around
 * the boxes still renders as prose: what makes this shape work is that every
 * question sits under the paragraph it is about, so answering it costs no
 * scrolling and no remembering.
 *
 * Drafts are local and stay local until Send. The file's text is re-read on
 * every mtime change, so a session that rewrote something else in the folder
 * must not take what the PM has half-typed with it. The drafts are keyed by
 * slot id, so they survive the text swapping underneath them.
 */
function CommentsForm({
  request,
  body,
  slots,
}: {
  request: AskRequestDTO;
  body: string;
  slots: readonly Slot[];
}) {
  const { openDoc, resolveAsk, sessions, openChat } = useApp();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState('');
  const [busy, setBusy] = useState(false);

  const prompts = usePrompts(request);

  const written = (id: string): string => drafts[id]?.trim() ?? '';
  const anything = slots.some((s) => written(s.id)) || !!general.trim();

  const send = () => {
    if (busy || !anything) return;
    setBusy(true);
    const answers: Record<string, string> = {};
    for (const slot of slots) {
      const text = written(slot.id);
      if (text) answers[slot.id] = text;
    }
    const rest = general.trim();
    void resolveAsk(request, null, { answers, ...(rest ? { general: rest } : {}) });
    // Sent means done with this file: back to the chat, where the agent
    // resumes and the reply will show up.
    const session = sessions.find((s) => s.id === request.sessionId);
    if (session) openChat({ id: session.id, title: session.title });
  };

  const skip = () => {
    if (busy) return;
    setBusy(true);
    // A dismissal is answers and comments both absent, the same shape a skipped
    // question card sends. The agent is told to decide for itself and say so.
    void resolveAsk(request, null);
  };

  const pieces = splitAtSlots(
    body,
    slots,
    (slot) => (
      <CommentBox
        key={`slot-${slot.id}`}
        label={prompts.get(slot.id) || slot.prompt || 'What do you think?'}
        value={drafts[slot.id] ?? ''}
        disabled={busy}
        onChange={(value) => setDrafts((prev) => ({ ...prev, [slot.id]: value }))}
      />
    ),
    (p, opts) => void openDoc(p, opts),
  );

  return (
    <div
      onKeyDown={(e) => {
        // ⌘↵ sends from any box, the way it sends a message from the composer.
        // ↵ alone is a new line here: these are paragraphs, not a form field.
        if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
        e.preventDefault();
        send();
      }}
    >
      {pieces}

      {/* Always there, and provided by the app rather than by the model: a
          reaction to the whole draft ("this is all too detailed") needs
          somewhere to land whether or not the session thought to ask. */}
      <CommentBox
        label="Anything else?"
        placeholder="What you make of the whole thing…"
        value={general}
        disabled={busy}
        onChange={setGeneral}
      />

      <div className="sticky bottom-0 mt-5 flex items-center gap-2 border-t border-border bg-background/95 py-2.5 backdrop-blur">
        <p className="hidden min-w-0 truncate text-xs text-muted-foreground sm:block" aria-hidden>
          <Key>⌘↵</Key> send · empty boxes are fine
        </p>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            title="Leave this round to the agent: it carries on and says what it assumed"
            onClick={skip}
          >
            Skip
          </Button>
          {/* Nothing typed is a skip in all but name, so the accent only arrives
              once there is something to send (DESIGN §6). */}
          <Button
            size="sm"
            variant={anything ? 'default' : 'secondary'}
            disabled={busy || !anything}
            onClick={send}
          >
            Send
          </Button>
        </span>
      </div>
    </div>
  );
}

/** One box: what the session asked, then room to answer it in your own words. */
function CommentBox({
  label,
  placeholder = 'Your take…',
  value,
  disabled,
  onChange,
}: {
  label: string;
  placeholder?: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(ref, value, 240);

  return (
    <div className="my-4 rounded-xl border border-brand/25 bg-brand/5 px-3 py-2.5">
      {/* The label wraps the box, so what the session asked IS the field's
          name: a screen reader reads the question, then lands in the answer. */}
      <label className="block">
        <span className="flex items-start gap-1.5 text-dense leading-snug font-medium text-foreground">
          <SquarePen className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden />
          <span className="min-w-0">{label}</span>
        </span>
        <textarea
          ref={ref}
          value={value}
          disabled={disabled}
          rows={1}
          placeholder={placeholder}
          className="mt-1.5 w-full resize-none rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    </div>
  );
}
