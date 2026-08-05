import { Button } from '@qale/ui';
import { X } from 'lucide-react';
import type { SessionOverview } from '../../state/app-state';
import { timeAgo } from '../../lib/session-meta';
import { rowFocusClass, useQueueFocus } from './shared';

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
  const ref = useQueueFocus<HTMLLIElement>(focused);
  return (
    <li
      ref={ref}
      tabIndex={-1}
      onClick={onFocus}
      onFocus={onFocus}
      className={`group flex items-center gap-2 rounded-lg bg-card py-2 pr-2 pl-3 ${rowFocusClass(focused)}`}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
      <button className="min-w-0 flex-1 text-left focus-visible:outline-none" onClick={onOpen}>
        <span className="block truncate text-sm font-medium">{session.title}</span>
        <span className="block text-xs text-muted-foreground">
          Finished · {timeAgo(session.updated)}
        </span>
      </button>
      <Button size="sm" variant="outline" onClick={onOpen}>
        Open
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
