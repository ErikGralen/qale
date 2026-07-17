import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AtSign, Hash } from 'lucide-react';
import type { VaultTreeDTO } from '@pm/ipc';
import { collectContexts, contentNotes } from '../lib/contexts';

/**
 * `@` and `#` autocomplete for the chat composer. `@` references a note by its
 * wikilink slug (`[[people/tom-devlin]]`) so the agent resolves the exact page;
 * `#` inserts a context tag (`#pricing`) from the vocabulary already in use.
 * The inserted forms match the citation/wikilink conventions the agent reads.
 */

interface Candidate {
  /** Text spliced into the composer (trigger included, no trailing space). */
  insert: string;
  label: string;
  hint: string;
  /** Lowercased haystack the query filters against. */
  match: string;
}

interface ActiveToken {
  trigger: '@' | '#';
  /** Index of the trigger char in the composer value. */
  start: number;
  query: string;
}

const MAX_ITEMS = 8;

/** The token being typed: a `@`/`#` at a word boundary with no space after it. */
function detect(value: string, caret: number): ActiveToken | null {
  const before = value.slice(0, caret);
  const m = before.match(/(?:^|\s)([@#])([\w./-]*)$/);
  if (!m) return null;
  const trigger = m[1] as '@' | '#';
  const query = m[2] ?? '';
  return { trigger, query, start: caret - query.length - 1 };
}

export function useChatMentions(
  tree: VaultTreeDTO | null,
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
  value: string,
  setValue: (v: string) => void,
) {
  const [active, setActive] = useState<ActiveToken | null>(null);
  const [index, setIndex] = useState(0);
  // A pending caret to restore after an insertion re-renders the textarea.
  const pendingCaret = useRef<number | null>(null);

  const notes = useMemo<Candidate[]>(
    () =>
      contentNotes(tree).map((n) => ({
        insert: `[[${n.slug}]]`,
        label: n.title,
        hint: n.type,
        match: `${n.title} ${n.slug}`.toLowerCase(),
      })),
    [tree],
  );
  const contexts = useMemo<Candidate[]>(
    () =>
      collectContexts(tree).map((c) => ({
        insert: `#${c.tag}`,
        label: c.tag,
        hint: `${c.count} note${c.count === 1 ? '' : 's'}`,
        match: c.tag.toLowerCase(),
      })),
    [tree],
  );

  const items = useMemo<Candidate[]>(() => {
    if (!active) return [];
    const pool = active.trigger === '@' ? notes : contexts;
    const q = active.query.toLowerCase();
    return (q ? pool.filter((c) => c.match.includes(q)) : pool).slice(0, MAX_ITEMS);
  }, [active, notes, contexts]);

  // Keep the highlighted row in range as the list shrinks/grows.
  useEffect(() => {
    setIndex((i) => (items.length ? Math.min(i, items.length - 1) : 0));
  }, [items.length]);

  // Restore the caret after an insertion updates `value`.
  useLayoutEffect(() => {
    if (pendingCaret.current == null) return;
    const el = textareaRef.current;
    if (el) {
      el.selectionStart = el.selectionEnd = pendingCaret.current;
    }
    pendingCaret.current = null;
  }, [value, textareaRef]);

  const refresh = () => {
    const el = textareaRef.current;
    if (!el) return;
    setActive(detect(el.value, el.selectionStart ?? el.value.length));
  };

  const choose = (item: Candidate) => {
    if (!active) return;
    const end = active.start + 1 + active.query.length;
    const next = `${value.slice(0, active.start)}${item.insert} ${value.slice(end)}`;
    pendingCaret.current = active.start + item.insert.length + 1;
    setValue(next);
    setActive(null);
    setIndex(0);
  };

  const open = active !== null && items.length > 0;

  /** Intercepts navigation/commit keys while the menu is open. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open) return false;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => (i + 1) % items.length);
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => (i - 1 + items.length) % items.length);
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      choose(items[index]!);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setActive(null);
      return true;
    }
    return false;
  };

  const menu = open ? (
    <div className="absolute bottom-full left-0 z-20 mb-2 w-80 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-md">
      <ul className="max-h-64 overflow-y-auto py-1">
        {items.map((item, i) => (
          <li key={item.insert}>
            <button
              type="button"
              className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm ${
                i === index ? 'bg-accent text-accent-foreground' : 'text-foreground'
              }`}
              // Keep focus on the textarea; mousedown fires before blur.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(item);
              }}
              onMouseEnter={() => setIndex(i)}
            >
              {active?.trigger === '#' ? (
                <Hash className="size-3.5 shrink-0 text-brand" />
              ) : (
                <AtSign className="size-3.5 shrink-0 text-brand" />
              )}
              <span className="flex-1 truncate">{item.label}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{item.hint}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  ) : null;

  return { menu, onKeyDown, refresh, close: () => setActive(null) };
}
