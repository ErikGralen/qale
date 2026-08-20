import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChevronRight, MoreHorizontal } from 'lucide-react';
import { cn } from '@qale/ui';

/**
 * The one header every view wears (docs, sessions, Inbox, Todos, folders,
 * Settings…). It is a location bar, not a page title: a 40px chrome rail that
 * says where you are in the smallest type the app uses, then gets out of the
 * way. The tab strip above it already carries the loud name; a second loud
 * title on every screen is noise, and a session — whose title is a whole
 * sentence the PO typed — turns that noise into a wall.
 *
 * Anatomy, left to right:
 *   [type glyph]  parent › parent ›  leaf  · meta        [actions]
 *
 * Rules that keep it consistent:
 *   - One geometry: h-10, px-4, hairline bottom. Never a taller "hero" header.
 *   - Crumbs are muted and clickable; the leaf is the only near-ink text.
 *   - `meta` is counts and state, always muted, always after a `·`.
 *   - Actions live in the right cluster: icon-only `HeaderAction`s for the
 *     standing ones, at most one labelled `<Button size="sm">` for the
 *     contextual primary, `HeaderMenu` for the rare and the destructive.
 */
export interface PageCrumb {
  label: string;
  /** Omit for a crumb that only names an ancestor without navigating to it. */
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  title?: string;
}

export function PageHeader({
  icon: Icon,
  iconClassName,
  crumbs,
  label,
  labelClassName,
  /** Full text for the tooltip when the leaf truncates (paths, session titles). */
  labelTitle,
  meta,
  children,
}: {
  icon?: LucideIcon;
  iconClassName?: string;
  crumbs?: PageCrumb[];
  label: ReactNode;
  labelClassName?: string;
  labelTitle?: string;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-4">
      <nav aria-label="Location" className="flex min-w-0 items-center gap-1 text-xs">
        {Icon && (
          <Icon
            className={cn('size-3.5 shrink-0 text-muted-foreground', iconClassName)}
            aria-hidden
          />
        )}
        {crumbs?.map((crumb) =>
          crumb.onClick ? (
            <span key={crumb.label} className="flex shrink-0 items-center gap-1">
              <button
                className="rounded px-1 py-0.5 font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                onClick={crumb.onClick}
                title={crumb.title ?? `Open ${crumb.label}`}
              >
                {crumb.label}
              </button>
              <ChevronRight className="size-3 text-muted-foreground/50" aria-hidden />
            </span>
          ) : (
            <span key={crumb.label} className="flex shrink-0 items-center gap-1">
              <span className="px-1 py-0.5 font-medium text-muted-foreground">{crumb.label}</span>
              <ChevronRight className="size-3 text-muted-foreground/50" aria-hidden />
            </span>
          ),
        )}
        <span
          className={cn('truncate font-medium text-foreground/80', labelClassName)}
          title={labelTitle}
        >
          {label}
        </span>
        {meta !== undefined && meta !== null && meta !== false && (
          <span className="shrink-0 text-muted-foreground tabular-nums">· {meta}</span>
        )}
      </nav>
      {/* Actions hold their width; the location truncates. Never the reverse —
          a header that shortens "Inbox" to "In…" to fit a hint has its
          priorities backwards. Anything long in here (a keyboard hint) caps
          its own width and hides at narrow viewports. */}
      {children && (
        <div className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">{children}</div>
      )}
    </div>
  );
}

/**
 * A standing header action: glyph only, name in the tooltip and the accessible
 * name. Labelled buttons in the header compete with the location it states —
 * reserve those for the one contextual action a view is offering right now.
 */
export function HeaderAction({
  icon: Icon,
  label,
  title,
  onClick,
  pressed,
  iconClassName,
}: {
  icon: LucideIcon;
  /** The action's name — the accessible name, and the tooltip unless `title` says more. */
  label: string;
  /** A longer tooltip for an action whose consequence isn't obvious from its name. */
  title?: string;
  onClick: () => void;
  /** Renders the button as a toggle (pin), not a command. */
  pressed?: boolean;
  iconClassName?: string;
}) {
  return (
    <button
      className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      onClick={onClick}
      aria-label={label}
      title={title ?? label}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
    >
      <Icon className={cn('size-4', iconClassName)} />
    </button>
  );
}

/** Groups the icon-only actions tighter than the labelled ones sit. */
export function HeaderActions({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-0.5 pl-1">{children}</div>;
}

export interface HeaderMenuItem {
  label: string;
  icon: LucideIcon;
  action: () => void;
  danger?: boolean;
}

/**
 * Overflow for a view's occasional and destructive actions, kept out of the
 * header's resting state. Fixed-positioned to escape the header's flow (same
 * approach as the tab strip's context menu).
 */
export function HeaderMenu({
  items,
  label = 'More actions',
}: {
  items: HeaderMenuItem[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const toggle = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
    setOpen((o) => !o);
  };

  return (
    <>
      <button
        ref={btnRef}
        className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none aria-expanded:bg-accent aria-expanded:text-foreground"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
      >
        <MoreHorizontal className="size-4" />
      </button>
      {open && pos && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setOpen(false)} />
          <div
            role="menu"
            aria-label={label}
            className="fixed z-50 min-w-44 rounded-lg border border-border bg-card py-1 shadow-md"
            style={{ top: pos.top, right: pos.right }}
          >
            {items.map((item) => (
              <button
                key={item.label}
                role="menuitem"
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-dense focus-visible:outline-none ${
                  item.danger
                    ? 'text-destructive hover:bg-destructive/10 focus-visible:bg-destructive/10'
                    : 'hover:bg-accent focus-visible:bg-accent'
                }`}
                onClick={() => {
                  item.action();
                  setOpen(false);
                }}
              >
                <item.icon className="size-3.5" aria-hidden />
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
