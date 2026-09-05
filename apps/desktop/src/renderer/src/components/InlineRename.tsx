import { useRef, useState } from 'react';

/**
 * Rename in place: the text on the row becomes an input, and the input is the
 * whole gesture. Enter or a click elsewhere keeps the new name, Escape puts the
 * old one back. Same rules as the note page's title, so a rename reads the same
 * wherever it starts.
 *
 * Nothing is saved unless the name changed. A blank name is no name, so it
 * counts as no change.
 */
export function InlineRename({
  value,
  label,
  className,
  commitUnchanged = false,
  onCommit,
  onDone,
}: {
  value: string;
  /** What a screen reader calls the input, e.g. "Rename Q3 brief". */
  label: string;
  className?: string;
  /**
   * Commit even when the name did not change. A row that is being CREATED needs
   * it: the name it opens with is a suggestion, and keeping it is a real answer.
   */
  commitUnchanged?: boolean;
  /** The new name, trimmed. Never called with the old one, unless
   *  `commitUnchanged` says the old one counts. */
  onCommit: (name: string) => void;
  /** The edit is over, kept or not. Put the plain text back. */
  onDone: () => void;
}) {
  const [draft, setDraft] = useState(value);
  // Escape has to beat the blur it causes: the blur handler still holds the
  // typed draft at that moment, so a flag is what tells the two apart.
  const cancelled = useRef(false);

  return (
    <input
      autoFocus
      aria-label={label}
      value={draft}
      className={
        className ??
        'w-full rounded-md border border-border bg-background px-1.5 py-0.5 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
      }
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
      onBlur={() => {
        const next = draft.trim();
        if (!cancelled.current && next && (commitUnchanged || next !== value)) onCommit(next);
        onDone();
      }}
    />
  );
}
