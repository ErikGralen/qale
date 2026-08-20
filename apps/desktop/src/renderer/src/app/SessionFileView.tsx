import { useApp } from '../state/app-state';
import { relativeTime } from '../lib/dates';
import { navFromEvent } from '../lib/nav';
import { fileIconFor, formatBytes } from '../lib/session-files';
import { PageHeader } from '../components/PageHeader';
import { SessionFileBody } from './SessionFileReader';

/**
 * One session working file at full width (Sessions v2 Part 1) — the ⌘click /
 * "open in a tab" escape hatch from the rail's preview, for a long transcript
 * that wants the whole window.
 *
 * Deliberately NOT a note: read-only, no editor, no properties block, and a
 * strip that says what it is. If a session file opened looking like a note, the
 * PM would edit it and reasonably expect that to mean something — it would mean
 * nothing, and the file may be gone tomorrow.
 */
export function SessionFileView({ sessionId, path }: { sessionId: string; path: string }) {
  const { sessionFiles, sessions, openChat } = useApp();
  const meta = sessionFiles[sessionId]?.find((f) => f.path === path);
  const session = sessions.find((s) => s.id === sessionId);
  const Icon = fileIconFor(path);
  const cut = path.lastIndexOf('/');
  const dir = cut === -1 ? '' : path.slice(0, cut);
  const name = path.slice(cut + 1);

  return (
    <div className="flex h-full flex-col">
      {/* Same location bar as a note wears — the session it belongs to, then
          the file. The crumb is the way back to the session that wrote it, and
          a nested file gets its folder as a second crumb rather than a path
          glued onto the name. */}
      <PageHeader
        icon={Icon}
        crumbs={[
          ...(session
            ? [
                {
                  label: session.title,
                  onClick: (e: React.MouseEvent<HTMLButtonElement>) =>
                    openChat({ id: session.id, title: session.title }, navFromEvent(e)),
                  title: `Open ${session.title}`,
                },
              ]
            : []),
          ...(dir ? [{ label: dir }] : []),
        ]}
        label={name}
        labelTitle={name}
      />
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground">
        <span className="truncate">
          Session file · not part of your memory · read-only, and safe to delete
        </span>
        {meta && (
          <span className="ml-auto shrink-0 tabular-nums">
            {formatBytes(meta.bytes)} · written {relativeTime(meta.mtime)}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-5 py-6">
        <SessionFileBody
          sessionId={sessionId}
          path={path}
          version={meta?.mtime}
          className="mx-auto w-full max-w-[68ch]"
        />
      </div>
    </div>
  );
}
