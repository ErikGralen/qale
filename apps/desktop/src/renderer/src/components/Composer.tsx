import { useLayoutEffect, type ReactNode } from 'react';
import { ArrowUp } from 'lucide-react';
import { Button } from '@qale/ui';

/**
 * One composer vocabulary for the whole app: the session composer and the docked
 * Ask bars on browse pages share this shell, this input, and this send
 * affordance, so asking a question looks and behaves the same everywhere.
 */
export const COMPOSER_SHELL =
  'relative mx-auto flex w-full max-w-2xl flex-col gap-1 rounded-xl border border-border bg-card p-2 shadow-sm transition-colors focus-within:border-foreground/20';

/**
 * The textarea: full width on its own line, one line tall until `useAutoGrow`
 * grows it. Nothing sits beside the text, so a long question never wraps around
 * a control.
 *
 * The placeholder sets in `foreground/70` (6.1:1 on card) rather than the Stone
 * every other placeholder in the app uses (5.3:1 — both clear AA). Stone is the
 * metadata voice, and on an empty composer the placeholder is not metadata: it
 * is the invitation, the only content in the bar and the largest text in it. A
 * step closer to ink reads as an open field; Stone reads as a greyed-out one.
 */
export const COMPOSER_INPUT =
  'min-h-8 w-full resize-none bg-transparent px-2 py-1 text-body leading-6 outline-none placeholder:text-foreground/70 disabled:opacity-50';

/**
 * The control strip under the text: leads (skill picker, scope) on the left,
 * send on the right. One row, so no control ever sits diagonally opposite
 * another.
 */
export const COMPOSER_ROW = 'flex items-center gap-1.5';

/**
 * What `@` and `#` do, held on the control strip while the field is still empty
 * and faded out the moment there is a question. It lives here rather than in
 * the placeholder because a placeholder should read as a sentence you answer,
 * not as a syntax manual you parse — and because a hint inside the placeholder
 * disappears exactly when you start typing and might want it.
 *
 * It fades rather than unmounts, so the strip never changes height and the send
 * button never shifts under the cursor.
 */
export function MentionHint({ show }: { show: boolean }) {
  return (
    <span
      aria-hidden
      className={`ml-0.5 min-w-0 truncate text-xs text-muted-foreground transition-opacity duration-150 motion-reduce:transition-none ${show ? 'opacity-100' : 'opacity-0'}`}
    >
      <span className="font-medium text-foreground/70">@</span> note
      <span className="px-1.5 text-muted-foreground/70">·</span>
      <span className="font-medium text-foreground/70">#</span> context
    </span>
  );
}

/**
 * Grow the textarea with its content up to `max` px, then scroll inside it.
 * Without this a `rows={1}` composer silently scrolls a one-line window as soon
 * as the question runs long — you can't see what you're about to send.
 */
export function useAutoGrow(
  ref: React.RefObject<HTMLTextAreaElement | null>,
  value: string,
  max = 160,
): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [ref, value, max]);
}

/**
 * A keycap in a hint line. One vocabulary for every keyboard hint in the app:
 * the composer's `↵ ask · ⇧↵ new line`, the question card's `1–3 pick`. Lives
 * here because hints and composers travel together.
 */
export function Key({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-border bg-muted px-1 text-xs">{children}</kbd>;
}

/**
 * Send. Ink-blue arrives only once there is something to send — an inactive
 * control never wears the accent (DESIGN §6), so the resting state is a muted
 * fill rather than a washed-out primary.
 */
export function SendButton({
  ready,
  onClick,
  label = 'Ask',
  hint = '↵',
}: {
  ready: boolean;
  onClick: () => void;
  /** Verb for the tooltip and screen readers. */
  label?: string;
  /** Keystroke shown after the verb. */
  hint?: string;
}) {
  return (
    <Button
      size="icon-sm"
      variant={ready ? 'default' : 'secondary'}
      className="ml-auto shrink-0 disabled:opacity-100 disabled:[&_svg]:opacity-60"
      onClick={onClick}
      disabled={!ready}
      aria-label={label}
      title={`${label} (${hint})`}
    >
      <ArrowUp className="size-4" />
    </Button>
  );
}
