import type { ComponentProps, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@qale/ui';

/**
 * Keycap chips for a tooltip's shortcut hint. Rendered inside the dark tooltip
 * body, so each cap is a translucent inset of the background colour rather than
 * a full surface — quiet, legible, never louder than the label beside it.
 */
export function Kbd({ keys }: { keys: string[] }) {
  return (
    <span className="ml-1 flex items-center gap-0.5" aria-hidden>
      {keys.map((k, i) => (
        <kbd
          key={i}
          data-slot="kbd"
          className="min-w-[1.25em] rounded bg-background/15 px-1 py-px text-center font-sans text-xs leading-[1.35] font-medium text-background/90"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}

/**
 * The one icon-button vocabulary for the top chrome — sidebar header and tab
 * strip both use it, so every control shares a hover, focus, and press feel.
 * Wraps its own Radix tooltip: hover reveals what the button does and the
 * shortcut that skips it (operator-grade; the mouse is the slow path).
 */
export function ToolbarButton({
  icon: Icon,
  label,
  keys,
  side = 'bottom',
  active = false,
  className = '',
  ...props
}: {
  icon: LucideIcon;
  label: string;
  keys?: string[];
  side?: 'top' | 'bottom' | 'left' | 'right';
  active?: boolean;
} & ComponentProps<'button'>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          data-active={active || undefined}
          className={`inline-grid size-7 place-items-center rounded-md text-muted-foreground transition-[color,background-color,transform] duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none active:translate-y-px disabled:pointer-events-none disabled:opacity-30 data-active:bg-accent data-active:text-foreground ${className}`}
          style={{ WebkitAppRegion: 'no-drag' } as never}
          {...props}
        >
          <Icon className="size-4" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side={side} sideOffset={6}>
        {label}
        {keys && keys.length > 0 && <Kbd keys={keys} />}
      </TooltipContent>
    </Tooltip>
  );
}

/** Bare wrapper so non-button triggers (a tab, a chip) can carry the same tooltip. */
export function WithTooltip({
  label,
  keys,
  side = 'bottom',
  children,
}: {
  label: string;
  keys?: string[];
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} sideOffset={6}>
        {label}
        {keys && keys.length > 0 && <Kbd keys={keys} />}
      </TooltipContent>
    </Tooltip>
  );
}
