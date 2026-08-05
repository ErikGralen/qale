import { useEffect, useState } from 'react';
import { Markdown } from '../components/Markdown';
import { stripFrontmatter } from '../lib/frontmatter';
import { invoke } from '../lib/ipc';
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
  onGone,
}: {
  sessionId: string;
  path: string;
  version?: number;
  className?: string;
  /** Rendered under the "this file is gone" message — a way back to the list. */
  onGone?: React.ReactNode;
}) {
  const { openDoc } = useApp();
  const text = useSessionFileText(sessionId, path, version);

  if (text === undefined) return <div className={className}><ReadingSkeleton /></div>;

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
      <pre className={`overflow-x-auto font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-foreground/90 ${className}`}>
        {text}
      </pre>
    );
  }

  const body = stripFrontmatter(text).trim();
  if (!body) {
    return (
      <p className={`text-dense leading-relaxed text-muted-foreground ${className}`}>
        Empty so far. The session has the file open but hasn't written to it yet.
      </p>
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
