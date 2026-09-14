import { FileText, Image as ImageIcon, X } from 'lucide-react';
import type { ArrivalItemInputDTO } from '@qale/ipc';
import { readableAs } from '@qale/domain';
import { attachmentName } from '../lib/attachments';

/**
 * The files a composer is holding, one chip each, above the text.
 *
 * They sit inside the composer because that is what they are part of: a
 * question with a file beside it, not a separate errand. Nothing is written
 * anywhere until send, so the X is the whole undo.
 *
 * One tab stop per file, and it is the remove button, so a file added by
 * mistake comes back off with Tab and Enter. The name is inside the button's
 * label ("Remove notes.md"), so a screen reader hears which file it is about
 * to take out.
 */
export function Attachments({
  items,
  onRemove,
}: {
  items: ArrivalItemInputDTO[];
  /** Take one file back out, by its index. */
  onRemove: (index: number) => void;
}) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1 px-1 pt-0.5 pb-1">
      {items.map((item, i) => {
        const name = attachmentName(item);
        const Icon = readableAs(name) === 'image' ? ImageIcon : FileText;
        return (
          <li
            key={`${name}-${i}`}
            className="flex h-7 min-w-0 max-w-56 items-center gap-1.5 rounded-lg bg-muted pr-1 pl-2 text-xs"
          >
            <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-mono text-foreground/80" title={name}>
              {name}
            </span>
            <button
              type="button"
              onClick={() => onRemove(i)}
              aria-label={`Remove ${name}`}
              title={`Remove ${name}`}
              className="shrink-0 rounded p-0.5 text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none"
            >
              <X className="size-3.5" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
