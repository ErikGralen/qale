import { useEffect, useRef, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * The shared listbox rendered inside a suggestion popup (slash menu, wikilink
 * autocomplete). Fully controlled: the owning extension keeps `selectedIndex`
 * so keyboard (in the editor) and mouse share one cursor. Items with a `group`
 * are sectioned under quiet headers in first-appearance order.
 */
export interface SuggestionMenuItem {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Right-aligned secondary text (e.g. the note type, a shortcut). */
  hint?: string;
  group?: string;
  /** Inline trailing adornment after the label (e.g. a ticket's state pill). */
  trailing?: ReactNode;
}

export function SuggestionMenu({
  items,
  selectedIndex,
  onSelect,
  onHover,
  emptyLabel,
  header,
  footer,
}: {
  items: SuggestionMenuItem[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onHover: (index: number) => void;
  emptyLabel: string;
  /** Context above the list (e.g. the relationship a `[[type::` query holds). */
  header?: ReactNode;
  /** Quiet key hint pinned under the list; survives the empty state. */
  footer?: ReactNode;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (items.length === 0) {
    return (
      <>
        {header}
        <p className="px-2 py-1.5 text-sm text-muted-foreground">{emptyLabel}</p>
        {footer}
      </>
    );
  }

  // Preserve item order while sectioning; group is optional and contiguous.
  const sections: {
    group: string | undefined;
    entries: { item: SuggestionMenuItem; index: number }[];
  }[] = [];
  items.forEach((item, index) => {
    const last = sections[sections.length - 1];
    if (last && last.group === item.group) last.entries.push({ item, index });
    else sections.push({ group: item.group, entries: [{ item, index }] });
  });

  return (
    <>
      {header}
      <div ref={listRef} role="listbox" aria-label="Suggestions">
        {sections.map((section, si) => (
          <div key={section.group ?? `section-${si}`} role={section.group ? 'group' : undefined}>
            {section.group && (
              <div className="px-2 pt-1.5 pb-0.5 text-xs font-medium text-muted-foreground first:pt-1">
                {section.group}
              </div>
            )}
            {section.entries.map(({ item, index }) => (
              <button
                key={item.id}
                id={`suggestion-item-${index}`}
                role="option"
                aria-selected={index === selectedIndex}
                tabIndex={-1}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-75 ${
                  index === selectedIndex ? 'bg-accent text-accent-foreground' : ''
                }`}
                // mousedown beats the editor's blur; selection happens without
                // the editor ever losing focus.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(index);
                }}
                onMouseEnter={() => onHover(index)}
              >
                <item.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.trailing}
                {item.hint && (
                  <span className="shrink-0 text-xs text-muted-foreground">{item.hint}</span>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>
      {footer}
    </>
  );
}
