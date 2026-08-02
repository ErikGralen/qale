import { Button } from '@pm/ui';
import { CircleHelp } from 'lucide-react';
import type { AttentionItem } from '../../lib/attention';
import { timeAgo } from '../../lib/session-meta';
import { rowFocusClass, useQueueFocus } from './shared';

/**
 * A turn parked on a question. It is the one thing in the queue that can never
 * finish on its own, so it leads the Inbox — and it carries no dismiss: a
 * question is answered, not cleared, and the answering happens in the session.
 */
export function QuestionItem({
  item,
  focused,
  onFocus,
  onOpen,
}: {
  item: AttentionItem;
  focused: boolean;
  onFocus: () => void;
  onOpen: () => void;
}) {
  const ref = useQueueFocus<HTMLLIElement>(focused);
  return (
    <li
      ref={ref}
      tabIndex={-1}
      onClick={onFocus}
      onFocus={onFocus}
      className={`flex items-center gap-2 rounded-lg bg-card py-2 pr-2 pl-3 ${rowFocusClass(focused)}`}
    >
      <CircleHelp className="size-4 shrink-0 text-brand" aria-hidden />
      <button className="min-w-0 flex-1 text-left focus-visible:outline-none" onClick={onOpen}>
        <span className="block truncate text-sm font-medium">{item.label}</span>
        <span className="block text-xs text-muted-foreground">
          Waiting for your answer{item.when ? ` · ${timeAgo(item.when)}` : ''}
        </span>
      </button>
      <Button size="sm" variant="outline" onClick={onOpen}>
        Answer
      </Button>
    </li>
  );
}
