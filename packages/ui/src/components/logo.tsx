import { cn } from '../lib/utils';

/**
 * pm mark — a small brain/knot glyph suggesting the "product brain" that
 * compounds. Uses currentColor so callers set the tone with `text-brand` etc.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('size-6', className)}
      aria-hidden
    >
      <path d="M12 4.2c-2.4 0-3.6 1.5-3.6 3 0 .5-.4.6-.8.9-1 .6-1.6 1.6-1.6 2.8 0 .9.4 1.6 1 2.1-.2.4-.3.9-.3 1.4 0 1.7 1.4 3 3.2 3 .8.9 1.9.9 2.1.9" />
      <path d="M12 4.2c2.4 0 3.6 1.5 3.6 3 0 .5.4.6.8.9 1 .6 1.6 1.6 1.6 2.8 0 .9-.4 1.6-1 2.1.2.4.3.9.3 1.4 0 1.7-1.4 3-3.2 3-.8.9-1.9.9-2.1.9" />
      <path d="M12 4.6v14.8" />
    </svg>
  );
}
