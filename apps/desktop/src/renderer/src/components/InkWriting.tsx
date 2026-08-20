/**
 * The agent-at-work mark: three lines of ink writing themselves, looping.
 * One mark for one meaning — a session turn is running — so every surface
 * that waits on the agent waits with the same glyph instead of a stock
 * spinner. Styling and motion live in @qale/ui's globals (.qale-ink-writing);
 * colour comes from the surrounding text colour, ink blue where it means
 * "the agent is touching this".
 *
 * Decorative to a screen reader on purpose: the mark never stands alone, the
 * words beside it ("Reading the memory…", "… is working") carry the state.
 */
export function InkWriting({ small, className }: { small?: boolean; className?: string }) {
  return (
    <span
      className={`qale-ink-writing ${className ?? ''}`}
      data-size={small ? 'sm' : undefined}
      aria-hidden
    >
      <i />
      <i />
      <i />
    </span>
  );
}
