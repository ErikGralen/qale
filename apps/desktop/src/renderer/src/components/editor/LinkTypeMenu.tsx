import { useEffect, useMemo, useRef, useState } from 'react';
import { kebabLinkType, linkTypeLabel, linkTypeOptions, normalizeLinkType, type LinkTypeOption, type NoteType } from '@pm/domain';
import { Check, Minus } from 'lucide-react';

/**
 * The relationship picker for one link (docs/typed-links.md): which types the
 * enum offers is filtered by what the link POINTS AT — a person link never
 * offers "supersedes" — and both directions of an asymmetric type are listed,
 * because "blocks" and "blocked by" are different claims.
 *
 * The filter box doubles as free-text entry: the vocabulary is deliberately
 * hybrid, so anything you type that isn't in the enum is offered verbatim
 * ("waiting on" → `waiting-on::`). Free-text types index and display; they
 * just don't drive behavior. Clearing back to an untyped link is always the
 * first row — typing is optional, forever.
 */
export function LinkTypeMenu({
  targetType,
  targetLabel,
  current,
  onPick,
  onClose,
}: {
  /** Note type of the link's target; `null` = unknown, so offer everything. */
  targetType: NoteType | null;
  /** What the link points at, named in the menu's header. */
  targetLabel: string;
  current: { type: string; reversed: boolean } | null;
  onPick: (option: { type: string; reversed: boolean } | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = linkTypeOptions(targetType).filter(
      (o) => !q || o.label.toLowerCase().includes(q) || o.token.includes(kebabLinkType(q)),
    );
    const rows: { key: string; label: string; option: LinkTypeOption | null; custom?: boolean }[] = matches.map(
      (o) => ({ key: `${o.token}-${String(o.reversed)}`, label: o.label, option: o }),
    );
    // Free text: anything typed that no enum row already covers.
    const free = normalizeLinkType(query);
    if (free && !matches.some((o) => o.token === kebabLinkType(query))) {
      rows.push({
        key: '__free',
        label: linkTypeLabel(free.type, free.reversed),
        option: { ...free, token: kebabLinkType(query), label: query },
        custom: true,
      });
    }
    if (current) rows.unshift({ key: '__none', label: 'No relationship', option: null });
    return rows;
  }, [query, targetType, current]);

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const pick = (i: number) => {
    const row = rows[i];
    if (row) onPick(row.option);
  };

  return (
    <div className="w-60">
      <div className="px-2 pt-1.5 pb-1 text-xs text-muted-foreground">
        This note <span className="text-foreground">…</span> {targetLabel}
      </div>
      <input
        ref={inputRef}
        className="mb-1 h-7 w-full rounded-md border border-input bg-transparent px-2 text-sm placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
        placeholder="Relationship, or type your own…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (rows.length) setIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            pick(index);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
        aria-label="Relationship"
      />
      <div ref={listRef} role="listbox" aria-label="Relationships" className="max-h-64 overflow-y-auto">
        {rows.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">No relationship matches.</p>}
        {rows.map((row, i) => {
          const active =
            row.option !== null && current?.type === row.option.type && current.reversed === row.option.reversed;
          return (
            <button
              key={row.key}
              role="option"
              aria-selected={i === index}
              tabIndex={-1}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-75 ${
                i === index ? 'bg-accent text-accent-foreground' : ''
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(i);
              }}
              onMouseEnter={() => setIndex(i)}
            >
              {row.option === null ? (
                <Minus className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              ) : (
                <span className="w-3.5 shrink-0" aria-hidden />
              )}
              <span className="min-w-0 flex-1 truncate">{row.label}</span>
              {row.custom && <span className="shrink-0 text-xs text-muted-foreground">custom</span>}
              {active && <Check className="size-3.5 shrink-0" aria-hidden />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
