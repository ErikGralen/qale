import { useState } from 'react';

/**
 * The note's display name — an input styled as the page h1. Commits on blur or
 * Enter (which hands focus to the body); Escape reverts. A fresh untitled note
 * arrives with the title selected, so typing replaces it immediately.
 */
export function TitleEditor({
  value,
  autoFocus,
  onCommit,
}: {
  value: string;
  autoFocus: boolean;
  onCommit: (title: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <input
      className="mb-1 w-full rounded-md bg-transparent font-serif text-2xl font-semibold tracking-tight placeholder:text-muted-foreground/40 focus-visible:outline-none"
      value={draft}
      placeholder="Untitled"
      autoFocus={autoFocus}
      onFocus={(e) => {
        if (autoFocus) e.currentTarget.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
      onBlur={() => {
        const next = draft.trim();
        if (next && next !== value) onCommit(next);
        else setDraft(value);
      }}
      aria-label="Note title"
    />
  );
}
