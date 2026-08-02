import { useMemo } from 'react';
import { noteTypeLabel } from '@pm/domain';
import { CornerDownRight } from 'lucide-react';
import type { NoteRefDTO } from '@pm/ipc';
import { useApp } from '../state/app-state';
import { navFromEvent } from '../lib/nav';
import { TagChip } from '../components/TagChip';
import { formatRefDate } from '../lib/contexts';

/** "[[decisions/foo]]" → "decisions/foo" (null for external refs). */
function refSlug(ref: string): string | null {
  const m = /^\[\[([^\]]+)\]\]$/.exec(ref.trim());
  return m?.[1] ?? null;
}

/**
 * Shared note listing — smart views, folder browse pages, context pages.
 * Dense rows on hairline separators (cards were the clutter): title + date on
 * the first line, summary on the second, context chips inline. Decisions show
 * their supersedes-chain so the spine is readable in-list.
 *
 * Rows use the stretched-button pattern: the row is one big button, chips and
 * chain links float above it and stay independently clickable.
 */
export function NoteList({
  rows,
  empty,
  showType = false,
  omitTag,
}: {
  rows: NoteRefDTO[];
  empty: string;
  showType?: boolean;
  /** Suppress this context chip on rows — the page already IS that context. */
  omitTag?: string;
}) {
  const { openDoc, tree } = useApp();

  // Resolve supersedes-chain refs to titles for in-list display.
  const bySlug = useMemo(() => {
    const map = new Map<string, NoteRefDTO>();
    for (const g of tree?.groups ?? []) for (const n of g.notes) map.set(n.slug, n);
    return map;
  }, [tree]);

  if (rows.length === 0) return <p className="px-1 py-2 text-sm text-muted-foreground">{empty}</p>;

  const onListKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[data-note-row]')];
    const idx = buttons.findIndex((b) => b === document.activeElement);
    if (idx === -1) return;
    e.preventDefault();
    buttons[Math.min(buttons.length - 1, Math.max(0, idx + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  };

  return (
    <ul className="flex flex-col divide-y divide-border/70" onKeyDown={onListKeyDown}>
      {rows.map((n) => {
        const superseded = n.lifecycle === 'superseded';
        // A cancelled synced meeting stays visible (its notes may matter) but
        // reads as struck history, not an upcoming commitment.
        const cancelled = n.eventStatus === 'cancelled';
        const chain = n.supersedes ? refSlug(n.supersedes) : null;
        const chainNote = chain ? bySlug.get(chain) : undefined;
        return (
          <li key={n.path} className={`group relative hover:bg-accent/40 ${superseded || cancelled ? 'opacity-65' : ''}`}>
            <button
              data-note-row
              className="absolute inset-0 w-full cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset focus-visible:outline-none"
              onClick={(e) => void openDoc(n.path, navFromEvent(e))}
              onAuxClick={(e) => e.button === 1 && void openDoc(n.path, navFromEvent(e))}
              aria-label={n.title}
            />
            <div className="pointer-events-none relative flex flex-col gap-0.5 px-2 py-2">
              <div className="flex items-baseline gap-2">
                <span className={`min-w-0 truncate text-sm font-medium ${cancelled ? 'line-through' : ''}`}>{n.title}</span>
                {showType && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {noteTypeLabel(n.type)}
                  </span>
                )}
                {superseded && <span className="shrink-0 text-xs text-muted-foreground">superseded</span>}
                {cancelled && <span className="shrink-0 text-xs text-muted-foreground">cancelled</span>}
                <span className="ml-auto flex shrink-0 items-center gap-1.5">
                  {(n.tags ?? []).filter((t) => t !== omitTag).map((t) => (
                    <span key={t} className="pointer-events-auto">
                      <TagChip tag={t} />
                    </span>
                  ))}
                  <span className="text-xs text-muted-foreground tabular-nums">{formatRefDate(n)}</span>
                </span>
              </div>
              <div className="truncate text-dense text-muted-foreground">{n.summary}</div>
              {chain && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <CornerDownRight className="size-3 shrink-0" aria-hidden />
                  <span>supersedes</span>
                  {chainNote ? (
                    <button
                      className="pointer-events-auto truncate font-medium text-foreground/80 hover:text-brand focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                      onClick={(e) => void openDoc(chainNote.path, navFromEvent(e))}
                    >
                      {chainNote.title}
                    </button>
                  ) : (
                    <span className="truncate">{chain}</span>
                  )}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
