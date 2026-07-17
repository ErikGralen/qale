import { useRef, useState } from 'react';
import { X } from 'lucide-react';

export interface TagSuggestion {
  tag: string;
  count: number;
}

/**
 * Token/chip input for frontmatter string arrays. Chips remove via × (or
 * Backspace on an empty input); typing commits on Enter, comma, or blur.
 * When `suggestions` is provided, a prefix-filtered dropdown of the existing
 * vocabulary opens on focus — pick with arrows + Enter or the mouse. Novel
 * values are always allowed; `normalize` shapes them (e.g. kebab-case tags).
 */
export function TagInput({
  value,
  onChange,
  suggestions,
  normalize,
  onTagClick,
  placeholder,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  suggestions?: TagSuggestion[];
  normalize?: (raw: string) => string;
  onTagClick?: (tag: string) => void;
  placeholder?: string;
}) {
  const [token, setToken] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = (suggestions ?? [])
    .filter((s) => !value.includes(s.tag))
    .filter((s) => s.tag.toLowerCase().startsWith(token.trim().toLowerCase()))
    .slice(0, 8);
  const showList = open && suggestions !== undefined && matches.length > 0;

  const add = (raw: string) => {
    const tag = (normalize ?? ((s: string) => s.trim()))(raw);
    if (tag && !value.includes(tag)) onChange([...value, tag]);
    setToken('');
    setHighlight(-1);
  };

  const remove = (tag: string) => onChange(value.filter((t) => t !== tag));

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (showList && highlight >= 0) add(matches[highlight]!.tag);
      else if (token.trim()) add(token);
    } else if (e.key === 'Backspace' && token === '' && value.length > 0) {
      remove(value[value.length - 1]!);
    } else if (e.key === 'ArrowDown' && showList) {
      e.preventDefault();
      setHighlight((h) => (h + 1) % matches.length);
    } else if (e.key === 'ArrowUp' && showList) {
      e.preventDefault();
      setHighlight((h) => (h <= 0 ? matches.length - 1 : h - 1));
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setHighlight(-1);
      } else {
        inputRef.current?.blur();
      }
    }
  };

  return (
    <div className="relative">
      <div
        className="flex flex-wrap items-center gap-1 rounded-md border border-transparent px-1 py-0.5 text-sm transition-colors hover:border-input focus-within:border-input focus-within:bg-card focus-within:ring-2 focus-within:ring-ring/40"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-0.5 rounded-sm bg-brand/8 px-1.5 py-px text-xs font-medium text-brand"
          >
            {onTagClick ? (
              <button className="cursor-pointer hover:underline" onClick={() => onTagClick(tag)}>
                #{tag}
              </button>
            ) : (
              <span>{tag}</span>
            )}
            <button
              className="rounded-sm p-px text-brand/60 hover:bg-brand/15 hover:text-brand"
              onClick={() => remove(tag)}
              aria-label={`Remove ${tag}`}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="min-w-16 flex-1 bg-transparent py-px text-sm outline-none placeholder:text-muted-foreground/50"
          value={token}
          placeholder={value.length === 0 ? placeholder : undefined}
          role={suggestions !== undefined ? 'combobox' : undefined}
          aria-expanded={showList}
          aria-activedescendant={highlight >= 0 ? `tag-option-${highlight}` : undefined}
          onChange={(e) => {
            setToken(e.target.value);
            setHighlight(-1);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            if (token.trim()) add(token);
            setOpen(false);
            setHighlight(-1);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      {showList && (
        <div
          className="absolute top-full left-0 z-10 mt-1 min-w-48 rounded-md border border-border bg-popover py-1 shadow-md"
          role="listbox"
        >
          {matches.map((s, i) => (
            <button
              key={s.tag}
              id={`tag-option-${i}`}
              role="option"
              aria-selected={i === highlight}
              className={`flex w-full items-center gap-3 px-2.5 py-1 text-left text-sm ${
                i === highlight ? 'bg-accent' : 'hover:bg-accent/60'
              }`}
              // mousedown beats the input's blur, which would commit the raw token
              onMouseDown={(e) => {
                e.preventDefault();
                add(s.tag);
              }}
              onMouseEnter={() => setHighlight(i)}
            >
              <span className="text-brand">#{s.tag}</span>
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">{s.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
