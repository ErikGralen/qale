import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { computePosition, flip, offset, shift } from '@floating-ui/dom';
import { AlertTriangle, ArrowUpRight, BookOpen, Clock } from 'lucide-react';
import type { StateCategory } from '@qale/ipc';
import {
  connections,
  openExternalRef,
  providerLabelOf,
  refMetaCached,
  type AtRiskLinkDTO,
  type ExternalRefMetaDTO,
} from '../lib/connections';
import { relativeTime } from '../lib/dates';
import { navFromEvent, type NavOpts } from '../lib/nav';

/**
 * External-reference chips — `[[PAY-142]]` rendered as delivery truth, not a
 * bare link. A ticket chip shows the key plus a state pill (colored by the
 * normalized state_category, labelled with the provider's RAW workflow word);
 * a wikipage chip shows its title. Hovering any chip (or the same reference
 * inside the TipTap editor) raises one shared hover card with title, assignee,
 * last change, freshness, and the open-in-provider link.
 *
 * Offline / expired-token honesty: chips render from the local mirror with a
 * quiet amber clock when the data may be behind — never a broken state, never
 * an error.
 */

/** Pill tone per normalized category. The raw provider label is what the PO
 *  reads; the category only picks the color — logic never branches on `state`. */
const PILL_TONE: Record<StateCategory, string> = {
  open: 'bg-muted text-muted-foreground',
  in_progress: 'bg-brand/12 text-brand',
  blocked: 'bg-warning/15 text-warning',
  done: 'bg-success/12 text-success',
};

/** The pill's full class string — shared with the editor node view, which
 *  builds plain DOM and can't render <StatePill>. */
export function pillClass(category: StateCategory): string {
  return `inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-micro font-medium whitespace-nowrap ${PILL_TONE[category]}`;
}

/** The pill on an ambiguous reference: same geometry as a state pill, amber,
 *  and it counts trackers rather than naming a state there isn't one of. */
export const AMBIGUOUS_PILL_CLASS =
  'self-center inline-flex items-center rounded-full bg-warning/15 px-1.5 py-px text-micro font-medium whitespace-nowrap text-warning';

export function StatePill({
  state,
  category,
  className = '',
}: {
  state: string;
  category: StateCategory;
  className?: string;
}) {
  return (
    <span className={`${pillClass(category)} ${className}`}>
      {category === 'blocked' && <AlertTriangle className="size-2.5 shrink-0" aria-hidden />}
      {state}
    </span>
  );
}

/** Quiet may-be-behind hint (Amber Flag: never color-alone — the word lives on
 *  the hover card this icon invites). Screen readers get real text; an
 *  aria-label on a bare svg is unreliably announced. */
function StaleDot() {
  return (
    <span className="inline-flex shrink-0 self-center">
      <Clock className="size-3 text-warning/80" aria-hidden />
      <span className="sr-only">may be behind, showing the local copy</span>
    </span>
  );
}

/** The type badge on a chip — the state pill's neutral sibling, same geometry
 *  so a row of chips keeps one silhouette whichever pill it carries. */
function KindPill({ label }: { label: string }) {
  return <span className={`${pillClass('open')} self-center font-normal`}>{label}</span>;
}

/** "Jira and Linear", "Jira, Linear and Asana" — a list a person reads aloud. */
export function namedList(items: readonly string[]): string {
  const names = items.map(providerLabelOf);
  if (names.length < 2) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function ExternalRefChip({
  target,
  alias,
  onOpen,
  kind,
}: {
  /** Wikilink target — "tickets/jira/PAY-142", "wikipages/…", or a bare key. */
  target: string;
  alias?: string | null;
  /** Route to the mirror note when it exists (⌘click → new tab); absent chips open the provider URL. */
  onOpen?: (path: string, opts?: NavOpts) => void;
  /**
   * Name the object on the chip itself, e.g. "Confluence page". A ticket key
   * announces its own kind — "PAY-142" could be nothing else — but a page title
   * is an ordinary human phrase, so "Enterprise Onboarding" reads as a note, a
   * theme, or a heading unless the chip says otherwise. On approval surfaces,
   * where the PO is deciding whether something may leave the workspace, it must
   * say otherwise. Passed in rather than read off the mirror, so an unsynced
   * connection still names what it is. Suppressed when a state pill already
   * types the reference.
   */
  kind?: string | null;
}) {
  const [meta, setMeta] = useState<ExternalRefMetaDTO | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void refMetaCached(target).then((m) => alive && setMeta(m));
    return () => {
      alive = false;
    };
  }, [target]);

  // Two trackers hold this id, so there is no one item to open (PD-11). The
  // chip stays a chip, says which trackers, and does nothing on click: the
  // hover card explains it and only the author can say which one was meant.
  if (meta?.ambiguousProviders) {
    return (
      <span
        data-external-ref={target}
        tabIndex={0}
        className="inline-flex max-w-full items-baseline gap-1 rounded-sm bg-muted px-1 py-px font-medium text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span className="truncate">{meta.externalId}</span>
        <span className={AMBIGUOUS_PILL_CLASS}>{meta.ambiguousProviders.length} trackers</span>
      </span>
    );
  }

  const label =
    meta?.kind === 'ticket'
      ? meta.externalId
      : // The last segment, not the part after a fixed prefix: a mirror sits
        // under its provider ("wikipages/confluence/…") once PD-10 has run.
        (meta?.title ?? alias ?? target.split('/').pop() ?? target);

  return (
    <button
      type="button"
      data-external-ref={target}
      className="inline-flex max-w-full items-baseline gap-1 rounded-sm bg-brand/8 px-1 py-px font-medium text-brand transition-colors hover:bg-brand/15 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      onClick={(e) => {
        e.stopPropagation();
        const opts = navFromEvent(e);
        void openExternalRef(target, meta ?? null, onOpen && ((path) => onOpen(path, opts)));
      }}
    >
      {meta?.kind === 'wikipage' && (
        <BookOpen className="size-3 shrink-0 self-center opacity-70" aria-hidden />
      )}
      <span className="truncate">{label}</span>
      {/* One pill slot, one job: saying what this reference is. A live state
          answers that for a ticket, so the kind pill yields to it. */}
      {meta?.kind === 'ticket' && meta.state && meta.stateCategory ? (
        <StatePill state={meta.state} category={meta.stateCategory} className="self-center" />
      ) : (
        kind && <KindPill label={kind} />
      )}
      {meta?.stale && <StaleDot />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// At-risk surfacing — markers in the owning views, never Inbox rows
// ---------------------------------------------------------------------------

/** The current at-risk external items (blocked tickets, stale dependents). */
export function useAtRisk(): AtRiskLinkDTO[] {
  const [risks, setRisks] = useState<AtRiskLinkDTO[]>([]);
  useEffect(() => {
    let alive = true;
    void connections
      .atRisk()
      .then((r) => alive && setRisks(r))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return risks;
}

/** Date prefixes shift when the demo vault is re-dated; match note identity on
 *  the date-free tail so risk links survive a refresh. */
function looseSlug(path: string): string {
  return path
    .replace(/\.md$/, '')
    .replace(/\/\d{4}-\d{2}-\d{2}-/, '/')
    .toLowerCase();
}

/** The risk touching one vault note, if any. */
export function riskFor(risks: AtRiskLinkDTO[], path: string): AtRiskLinkDTO | undefined {
  const target = looseSlug(path);
  return risks.find((r) => r.linked.some((l) => looseSlug(l) === target));
}

/**
 * The in-row at-risk marker (a todo row, a meeting header): amber, icon + word
 * — never color alone. Hover raises the shared card; click opens the ticket.
 */
export function AtRiskMarker({
  risk,
  onOpen,
}: {
  risk: AtRiskLinkDTO;
  onOpen?: (path: string) => void;
}) {
  return (
    <button
      type="button"
      data-external-ref={risk.slug}
      className="inline-flex shrink-0 items-center gap-1 rounded bg-warning/15 px-1.5 py-0.5 text-xs font-medium text-warning transition-colors hover:bg-warning/25 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      onClick={(e) => {
        e.stopPropagation();
        void refMetaCached(risk.slug).then((m) => openExternalRef(risk.slug, m, onOpen));
      }}
      title={`${risk.externalId}: ${risk.delta}${risk.changedBy ? `, by ${risk.changedBy}` : ''}`}
    >
      <AlertTriangle className="size-3" aria-hidden />
      {risk.externalId} {risk.reason === 'blocked' ? 'blocked' : 'changed'}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Shared hover card — one layer for every surface (chips, editor atoms)
// ---------------------------------------------------------------------------

const SHOW_DELAY_MS = 300;
const HIDE_GRACE_MS = 160;

/**
 * Mount once at the app root. Delegated hover/focus on `[data-external-ref]`
 * raises the card, so React chips and the TipTap wikilink node view share one
 * implementation (the editor only has to stamp the attribute).
 *
 * Keyboard contract: the card is purely informational. Everything it can do —
 * open the note, open at the host — is exactly what Enter on the chip itself
 * already does, so its buttons stay out of the tab order (a transient layer
 * must never capture focus and then vanish under it). Focusing a chip shows
 * the card; Escape dismisses it.
 */
export function ExternalRefHoverLayer({ onOpen }: { onOpen: (path: string) => void }) {
  const [state, setState] = useState<{ anchor: HTMLElement; meta: ExternalRefMetaDTO } | null>(
    null,
  );
  const cardRef = useRef<HTMLDivElement>(null);
  const showTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    const clearTimers = () => {
      if (showTimer.current) window.clearTimeout(showTimer.current);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      showTimer.current = null;
      hideTimer.current = null;
    };

    const scheduleShow = (anchor: HTMLElement) => {
      clearTimers();
      const target = anchor.getAttribute('data-external-ref');
      if (!target) return;
      showTimer.current = window.setTimeout(() => {
        void refMetaCached(target).then((meta) => {
          // The anchor may have left the DOM while we looked the meta up.
          if (meta && anchor.isConnected) setState({ anchor, meta });
        });
      }, SHOW_DELAY_MS);
    };

    const scheduleHide = () => {
      if (showTimer.current) window.clearTimeout(showTimer.current);
      hideTimer.current = window.setTimeout(() => setState(null), HIDE_GRACE_MS);
    };

    const over = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-external-ref]');
      if (el instanceof HTMLElement) scheduleShow(el);
      else if (cardRef.current?.contains(e.target as Node)) {
        // Moving onto the card keeps it open.
        if (hideTimer.current) window.clearTimeout(hideTimer.current);
      } else if (state) scheduleHide();
    };

    const focusIn = (e: FocusEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-external-ref]');
      if (el instanceof HTMLElement) scheduleShow(el);
      else if (!cardRef.current?.contains(e.target as Node)) scheduleHide();
    };

    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setState(null);
    };

    document.addEventListener('mouseover', over);
    document.addEventListener('focusin', focusIn);
    document.addEventListener('keydown', key);
    return () => {
      clearTimers();
      document.removeEventListener('mouseover', over);
      document.removeEventListener('focusin', focusIn);
      document.removeEventListener('keydown', key);
    };
  }, [state]);

  useEffect(() => {
    if (!state || !cardRef.current) return;
    const card = cardRef.current;
    void computePosition(state.anchor, card, {
      strategy: 'fixed',
      placement: 'bottom-start',
      middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    }).then(({ x, y }) => {
      card.style.left = `${x}px`;
      card.style.top = `${y}px`;
      card.style.opacity = '1';
    });
  }, [state]);

  if (!state) return null;
  const m = state.meta;

  // The ambiguous card has one job: say why the chip does nothing, and how to
  // fix it. There is no item behind it, so it shows none of an item's fields.
  if (m.ambiguousProviders) {
    return createPortal(
      <div
        ref={cardRef}
        role="tooltip"
        className="fixed z-50 w-80 rounded-lg border border-border bg-popover p-3 text-popover-foreground opacity-0 shadow-md transition-opacity duration-150 motion-reduce:transition-none"
        style={{ left: 0, top: 0 }}
      >
        <div className="text-sm leading-snug font-medium">{m.externalId}</div>
        <p className="mt-1 text-xs text-muted-foreground">
          {namedList(m.ambiguousProviders)} each hold this id, so the link names no one item. Write
          the tracker into the link, like{' '}
          <code className="text-foreground/75">
            [[{m.kind === 'ticket' ? 'tickets' : 'wikipages'}/{m.ambiguousProviders[0]}/
            {m.externalId}]]
          </code>
          .
        </p>
      </div>,
      document.body,
    );
  }

  const host = (() => {
    try {
      return new URL(m.url).host;
    } catch {
      return null;
    }
  })();

  return createPortal(
    <div
      ref={cardRef}
      role="tooltip"
      className="fixed z-50 w-80 rounded-lg border border-border bg-popover p-3 text-popover-foreground opacity-0 shadow-md transition-opacity duration-150 motion-reduce:transition-none"
      style={{ left: 0, top: 0 }}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm leading-snug font-medium text-balance">{m.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {m.kind === 'ticket' ? (
              <>
                <span className="font-medium text-foreground/75">{m.externalId}</span>
                {m.state && m.stateCategory && (
                  <StatePill state={m.state} category={m.stateCategory} />
                )}
              </>
            ) : (
              <span className="inline-flex items-center gap-1">
                <BookOpen className="size-3" aria-hidden />
                {m.containerName ? `${m.containerName} page` : 'Page'}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
        {m.kind === 'ticket' && (
          <span>{m.assignee ? `Assigned to ${m.assignee}` : 'Unassigned'}</span>
        )}
        <span>
          {m.lastChange?.by ? `Changed by ${m.lastChange.by}` : 'Updated'}
          {m.lastChange?.from && m.lastChange?.to && (
            <span className="text-foreground/70">
              {': '}
              {m.lastChange.from} → {m.lastChange.to}
            </span>
          )}
          , {relativeTime(m.lastChange?.at ?? m.remoteUpdated)}
        </span>
        {m.stale && (
          <span className="inline-flex items-center gap-1 font-medium text-warning">
            <Clock className="size-3" aria-hidden />
            {m.health === 'auth-expired'
              ? 'Showing the local copy: the connection needs a new token'
              : `Showing the local copy, synced ${relativeTime(m.syncedAt)}`}
          </span>
        )}
      </div>

      <div className="mt-2.5 flex items-center gap-2 border-t border-border/60 pt-2">
        {m.notePath && (
          <button
            tabIndex={-1}
            className="rounded bg-brand/8 px-1.5 py-0.5 text-xs font-medium text-brand transition-colors hover:bg-brand/15 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={() => {
              onOpen(m.notePath!);
              setState(null);
            }}
          >
            Open the note
          </button>
        )}
        {m.url && (
          <a
            href={m.url}
            target="_blank"
            rel="noreferrer"
            tabIndex={-1}
            className="inline-flex items-center gap-0.5 rounded text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Open {host ? `at ${host}` : 'in browser'}
            <ArrowUpRight className="size-3" aria-hidden />
          </a>
        )}
      </div>
    </div>,
    document.body,
  );
}
