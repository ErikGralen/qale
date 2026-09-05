import { useRef, useState } from 'react';
import { X } from 'lucide-react';

/**
 * Token/chip input for frontmatter string arrays. Chips remove via × (or
 * Backspace on an empty input); typing commits on Enter, comma, or blur.
 *
 * There is no suggestion list. The one vocabulary worth completing against was
 * tags, and tags are the agent's now: they read as chips in the Details fold
 * and are never typed here. What is left is a person's "Cares about" and
 * anything like it: the PO's own words about their own people.
 */
export function TagInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** Names the input for screen readers — the visual label sits outside it. */
  ariaLabel?: string;
}) {
  const [token, setToken] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const add = (raw: string) => {
    const tag = raw.trim();
    if (tag && !value.includes(tag)) onChange([...value, tag]);
    setToken('');
  };

  const remove = (tag: string) => onChange(value.filter((t) => t !== tag));

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (token.trim()) add(token);
    } else if (e.key === 'Backspace' && token === '' && value.length > 0) {
      remove(value[value.length - 1]!);
    } else if (e.key === 'Escape') {
      inputRef.current?.blur();
    }
  };

  return (
    <div
      className="flex flex-wrap items-center gap-1 rounded-md border border-transparent px-1 py-0.5 text-sm transition-colors hover:border-input focus-within:border-input focus-within:bg-card focus-within:ring-2 focus-within:ring-ring/40"
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((tag) => (
        <span
          key={tag}
          className="flex items-center gap-0.5 rounded-sm bg-brand/8 px-1.5 py-px text-xs font-medium text-brand"
        >
          <span>{tag}</span>
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
        aria-label={ariaLabel}
        onChange={(e) => setToken(e.target.value)}
        onBlur={() => {
          if (token.trim()) add(token);
        }}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
