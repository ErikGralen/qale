import { useMemo } from 'react';
import { noteTypeLabel } from '@qale/domain';
import { Check, CornerDownRight } from 'lucide-react';
import type { NoteRefDTO } from '@qale/ipc';
import { useApp } from '../state/app-state';
import { navFromEvent } from '../lib/nav';
import { TagChip } from '../components/TagChip';
import { formatRefDate } from '../lib/contexts';
import type { Selection } from '../lib/selection';

/** "[[decisions/foo]]" → "decisions/foo" (null for external refs). */
function refSlug(ref: string): string | null {
  const m = /^\[\[([^\]]+)\]\]$/.exec(ref.trim());
  return m?.[1] ?? null;
}

/** Chips a row shows before it stops counting. The rail must never grow wide
 *  enough to push the title into an ellipsis; two is what fits. */
const MAX_CHIPS = 2;

/**
 * Shared note listing — smart views, folder browse pages, context pages.
 * Dense rows on hairline separators (cards were the clutter): the title is the
 * row, and it gets the whole line. Everything else (context chips, the date) is
 * metadata that sits in a fixed rail on the right and never takes width from
 * the title. Decisions show their supersedes-chain so the spine is readable
 * in-list.
 *
 * There is no summary line. A browse page is for *finding*, and a one-line
 * fragment cut mid-sentence never finished a thought — it only halved the
 * number of titles in view. The summary is still searched by the page filter,
 * and it rides the row as its tooltip.
 *
 * Rows use the stretched-button pattern: the row is one big button, chips and
 * chain links float above it and stay independently clickable.
 *
 * With a `selection` the rows grow a checkbox, which is the ONLY thing that
 * selects: a plain click still opens the note, selection or not, so the page
 * never turns into a mode where clicking does something else than it did a
 * second ago. Shift is the one shortcut on the row itself, and only once
 * something is selected — there is a range to extend by then.
 */
export function NoteList({
  rows,
  empty,
  showType = false,
  omitTag,
  selection,
}: {
  rows: NoteRefDTO[];
  empty: string;
  showType?: boolean;
  /** Suppress this context chip on rows — the page already IS that context. */
  omitTag?: string;
  /** Makes the rows selectable. Every row shown here must be in its ordering. */
  selection?: Selection;
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
    buttons[
      Math.min(buttons.length - 1, Math.max(0, idx + (e.key === 'ArrowDown' ? 1 : -1)))
    ]?.focus();
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
        const picked = selection?.isSelected(n.path) ?? false;
        const tags = (n.tags ?? []).filter((t) => t !== omitTag);
        const overflow = tags.slice(MAX_CHIPS);
        return (
          <li
            key={n.path}
            className={`group relative ${picked ? 'bg-brand/8' : 'hover:bg-accent/40'} ${superseded || cancelled ? 'opacity-65' : ''}`}
          >
            <button
              data-note-row
              className="absolute inset-0 w-full cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset focus-visible:outline-none"
              onClick={(e) => {
                // Shift on an armed list extends the range. ⌘⇧click keeps its
                // browser meaning (open in a focused new tab), so it is checked
                // first and never gets read as a selection gesture.
                if (selection?.active && e.shiftKey && !e.metaKey && !e.ctrlKey) {
                  selection.toggle(n.path, { range: true });
                  return;
                }
                void openDoc(n.path, navFromEvent(e));
              }}
              onAuxClick={(e) => e.button === 1 && void openDoc(n.path, navFromEvent(e))}
              aria-label={n.title}
              // The summary left the row, so it waits here: one hover, no
              // cost to the line. (`aria-label` still names the row.)
              title={n.summary || undefined}
            />
            <div className="pointer-events-none relative flex items-start gap-2 px-2 py-2">
              {selection && (
                <span className="pointer-events-auto flex h-5 shrink-0 items-center">
                  <button
                    role="checkbox"
                    aria-checked={picked}
                    aria-label={`Select ${n.title}`}
                    title={picked ? 'Deselect (⇧ picks a range)' : 'Select (⇧ picks a range)'}
                    className={`flex size-4 items-center justify-center rounded-[4px] border transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${
                      picked
                        ? 'border-brand bg-brand text-brand-foreground'
                        : 'border-input bg-card hover:border-brand'
                    } ${picked || selection.active ? '' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      selection.toggle(n.path, { range: e.shiftKey });
                    }}
                  >
                    {picked && <Check className="size-3" aria-hidden />}
                  </button>
                </span>
              )}
              {/* The title. It wraps to a second line rather than truncate:
                  a decision's title is a whole sentence, and half of one is
                  not something you can recognise at a glance. */}
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                  className={`line-clamp-2 text-sm font-medium text-pretty ${cancelled ? 'line-through' : ''}`}
                >
                  {n.title}
                </span>
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

              {/* The metadata rail: one line tall, on the title's first line,
                  never wider than what it holds. */}
              <div className="flex h-5 shrink-0 items-center gap-1.5">
                {showType && (
                  <span className="text-xs text-muted-foreground">{noteTypeLabel(n.type)}</span>
                )}
                {superseded && <span className="text-xs text-muted-foreground">superseded</span>}
                {cancelled && <span className="text-xs text-muted-foreground">cancelled</span>}
                {tags.slice(0, MAX_CHIPS).map((t) => (
                  <span key={t} className="pointer-events-auto">
                    <TagChip tag={t} />
                  </span>
                ))}
                {overflow.length > 0 && (
                  <span
                    className="pointer-events-auto text-xs text-muted-foreground tabular-nums"
                    title={overflow.map((t) => `#${t}`).join(' ')}
                  >
                    +{overflow.length}
                  </span>
                )}
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatRefDate(n)}
                </span>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
