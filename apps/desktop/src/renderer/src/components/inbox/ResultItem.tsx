import { useEffect, useRef } from 'react';
import { Button } from '@pm/ui';
import { X } from 'lucide-react';
import type { SessionOverview } from '../../state/app-state';
import { sessionLabel, timeAgo } from '../../lib/session-meta';

/** A session that finished with nothing to approve — read it and it clears. */
export function ResultItem({
  session,
  focused,
  onFocus,
  onOpen,
  onClear,
}: {
  session: SessionOverview;
  focused: boolean;
  onFocus: () => void;
  onOpen: () => void;
  onClear: () => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [focused]);
  const verb = session.sessionType === 'ask' ? 'answered' : 'finished';
  return (
    <li
      ref={ref}
      onClick={onFocus}
      className={`group flex items-center gap-2 rounded-lg bg-card py-2 pr-2 pl-3 ring-1 transition-shadow ${
        focused ? 'ring-2 ring-ring/60' : 'ring-foreground/10'
      }`}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
      <button className="min-w-0 flex-1 text-left focus-visible:outline-none" onClick={onOpen}>
        <span className="block truncate text-sm font-medium">{session.title}</span>
        <span className="block text-xs text-muted-foreground">
          {sessionLabel(session.sessionType)} {verb} · {timeAgo(session.updated)}
        </span>
      </button>
      <Button size="sm" variant="outline" onClick={onOpen}>
        {session.sessionType === 'ask' ? 'Read answer' : 'Open'}
      </Button>
      <button
        className="rounded p-1 text-muted-foreground opacity-0 group-focus-within:opacity-70 group-hover:opacity-70 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={onClear}
        aria-label={`Mark "${session.title}" as seen`}
        title="Mark as seen"
      >
        <X className="size-3.5" />
      </button>
    </li>
  );
}
