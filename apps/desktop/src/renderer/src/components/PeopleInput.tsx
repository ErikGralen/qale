import { useMemo, useRef, useState } from 'react';
import type { PersonCardDTO } from '@qale/ipc';
import { UserPlus } from 'lucide-react';
import { useApp } from '../state/app-state';
import { participantValue, resolveParticipant } from '../lib/people';
import { PersonAvatar, PersonChip } from './PersonChip';

/**
 * The people widget for frontmatter person lists (`participants`, `deciders`).
 * Reads as faces and names; edits by picking from the workspace's people, so a
 * pick writes a `[[people/…]]` LINK rather than another loose string — the
 * difference between a name on a page and a person the memory can reason about.
 * Free text is still allowed (someone you haven't filed yet); their chip then
 * offers to make the page.
 */
export function PeopleInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const { people, createPerson } = useApp();
  const [token, setToken] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Already-listed people don't come back as suggestions, whichever form they
  // were written in.
  const taken = useMemo(() => {
    const set = new Set<string>();
    for (const raw of value) {
      const p = resolveParticipant(raw, people);
      set.add(p.kind === 'person' ? p.person.slug : p.label.toLowerCase());
    }
    return set;
  }, [value, people]);

  const query = token.trim().toLowerCase();
  const matches = (people?.people ?? [])
    .filter((p) => !taken.has(p.slug))
    .filter(
      (p) =>
        !query ||
        p.name.toLowerCase().includes(query) ||
        (p.role?.toLowerCase().includes(query) ?? false) ||
        (p.email?.toLowerCase().includes(query) ?? false),
    )
    .slice(0, 6);
  // Offer to file a stranger only once the typed name isn't an existing person.
  const canCreate =
    query.length > 1 && !matches.some((p) => p.name.toLowerCase() === query) && !taken.has(query);
  const options: (PersonCardDTO | 'create')[] = [
    ...matches,
    ...(canCreate ? (['create'] as const) : []),
  ];
  const showList = open && options.length > 0;

  const commit = (next: string): void => {
    if (next && !value.includes(next)) onChange([...value, next]);
    setToken('');
    setHighlight(0);
  };

  const choose = async (option: PersonCardDTO | 'create'): Promise<void> => {
    if (option !== 'create') {
      commit(participantValue(option));
      return;
    }
    const name = token.trim();
    setToken('');
    try {
      const card = await createPerson({ name });
      commit(participantValue(card));
    } catch {
      // Filing failed (bad name, disk) — keep the person on the note as text
      // rather than silently dropping what was typed.
      commit(name);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const picked = showList ? options[highlight] : undefined;
      if (picked) void choose(picked);
      else if (token.trim()) commit(token.trim());
    } else if (e.key === 'Backspace' && token === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    } else if (e.key === 'ArrowDown' && showList) {
      e.preventDefault();
      setHighlight((h) => (h + 1) % options.length);
    } else if (e.key === 'ArrowUp' && showList) {
      e.preventDefault();
      setHighlight((h) => (h <= 0 ? options.length - 1 : h - 1));
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
      } else {
        inputRef.current?.blur();
      }
    }
  };

  return (
    <div className="relative">
      <div
        className="flex flex-wrap items-center gap-1 rounded-md border border-transparent px-1 py-0.5 transition-colors hover:border-input focus-within:border-input focus-within:bg-card focus-within:ring-2 focus-within:ring-ring/40"
        onClick={(e) => {
          // Clicking a chip opens its card; only the empty space focuses input.
          if (e.target === e.currentTarget) inputRef.current?.focus();
        }}
      >
        {value.map((raw, i) => (
          <PersonChip
            key={`${raw}-${i}`}
            value={raw}
            onRemove={() => onChange(value.filter((_, j) => j !== i))}
          />
        ))}
        <input
          ref={inputRef}
          className="min-w-20 flex-1 bg-transparent py-px text-sm outline-none placeholder:text-muted-foreground/50"
          value={token}
          placeholder={value.length === 0 ? placeholder : undefined}
          role="combobox"
          aria-expanded={showList}
          aria-activedescendant={showList ? `person-option-${highlight}` : undefined}
          onChange={(e) => {
            setToken(e.target.value);
            setHighlight(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // A half-typed name is still a participant — commit it as text
            // rather than losing it; its chip offers to file them properly.
            if (token.trim()) commit(token.trim());
            setOpen(false);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      {showList && (
        <div
          className="absolute top-full left-0 z-10 mt-1 max-h-72 min-w-64 overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-md"
          role="listbox"
        >
          {options.map((option, i) => (
            <button
              key={option === 'create' ? '__create' : option.slug}
              id={`person-option-${i}`}
              role="option"
              aria-selected={i === highlight}
              className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm ${
                i === highlight ? 'bg-accent' : 'hover:bg-accent/60'
              }`}
              // mousedown beats the input's blur, which would commit raw text
              onMouseDown={(e) => {
                e.preventDefault();
                void choose(option);
              }}
              onMouseEnter={() => setHighlight(i)}
            >
              {option === 'create' ? (
                <>
                  <UserPlus className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />
                  <span className="truncate">
                    Add <span className="font-medium">{token.trim()}</span> as a new person
                  </span>
                </>
              ) : (
                <>
                  <PersonAvatar person={option} />
                  <span className="min-w-0 flex-1 truncate">{option.name}</span>
                  {option.role && (
                    <span className="max-w-40 truncate text-xs text-muted-foreground">
                      {option.role}
                    </span>
                  )}
                </>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
