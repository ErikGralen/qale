import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { X, Plus, PanelLeft, PanelRight, House, Inbox, History, MessageSquare, FileCode, FileText, Folder, Hash, Settings, Wand2, Bot, ListTodo, Library, ArrowLeft, ArrowRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Spinner } from '@qale/ui';
import { ToolbarButton } from '../components/ToolbarButton';
import { NOTE_TYPE_ICON } from '../lib/note-icons';
import { useApp, type Tab } from '../state/app-state';

function iconFor(tab: Tab): LucideIcon {
  switch (tab.kind) {
    case 'home':
      return House;
    case 'doc':
      return tab.noteType ? (NOTE_TYPE_ICON[tab.noteType] ?? FileText) : FileText;
    case 'session':
      return MessageSquare;
    // Working material, not a note — a plain page icon, never a note-type one.
    case 'sessionFile':
      return FileCode;
    case 'chats':
      return History;
    case 'inbox':
      return Inbox;
    case 'todos':
      return ListTodo;
    case 'memory':
      return Library;
    case 'folder':
      return Folder;
    case 'context':
      return Hash;
    case 'settings':
      return Settings;
    case 'skills':
      return Wand2;
    case 'agents':
      return Bot;
    default:
      return FileText;
  }
}

// Clear the macOS traffic lights when the collapsed sidebar no longer does.
const isMac = navigator.userAgent.includes('Macintosh');

const MENU_WIDTH = 208;
/**
 * Gap between tabs — twice the 6px bottom flare (see `.qale-tab`), so neighbouring
 * curves meet without overlapping. Also how far neighbours shift during a drag.
 */
const TAB_GAP = 12;
/** Pointer must travel this far before a press becomes a drag. */
const DRAG_THRESHOLD = 4;
/** Dragging within this distance of the strip edge auto-scrolls. */
const EDGE_SCROLL_ZONE = 36;

function TabMenu({ tabId, x, y, onClose }: { tabId: string; x: number; y: number; onClose: () => void }) {
  const { tabs, closeTab, closeOtherTabs, closeAllTabs, closeTabsBefore, closeTabsAfter, reopenClosedTab } = useApp();
  const idx = tabs.findIndex((t) => t.id === tabId);
  const tab = tabs[idx];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!tab) return null;

  const run = (action: () => void) => () => {
    action();
    onClose();
  };

  const items: { label: string; action: () => void; disabled?: boolean; hint?: string; icon?: LucideIcon }[] = [
    { label: 'Close', action: () => closeTab(tab.id), hint: '⌘W' },
    { label: 'Close Other Tabs', action: () => closeOtherTabs(tab.id), disabled: tabs.length <= 1 },
    { label: 'Close All Tabs', action: closeAllTabs },
    { label: 'Close Tabs to the Left', action: () => closeTabsBefore(tab.id), disabled: idx === 0 },
    { label: 'Close Tabs to the Right', action: () => closeTabsAfter(tab.id), disabled: idx === tabs.length - 1 },
    { label: 'Reopen Closed Tab', action: reopenClosedTab, hint: '⇧⌘T' },
  ];

  return (
    <>
      <div
        className="fixed inset-0 z-50"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        role="menu"
        aria-label={`Tab actions for ${tab.title}`}
        className="fixed z-50 rounded-md border border-border bg-card py-1 shadow-md"
        style={{
          width: MENU_WIDTH,
          left: Math.min(x, window.innerWidth - MENU_WIDTH - 8),
          top: Math.min(y, window.innerHeight - items.length * 30 - 16),
        }}
      >
        {items.map((item) => (
          <button
            key={item.label}
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-dense hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
            onClick={run(item.action)}
            disabled={item.disabled}
          >
            {item.icon && <item.icon className="size-3.5 text-muted-foreground" aria-hidden />}
            {item.label}
            {item.hint && <span className="ml-auto text-xs text-muted-foreground">{item.hint}</span>}
          </button>
        ))}
      </div>
    </>
  );
}

/**
 * A tab label that fades out when it doesn't fit, instead of ending in an
 * ellipsis. The mask only belongs on labels that actually overflow — applied
 * unconditionally it would dim the last letter of titles with room to spare —
 * so the element measures itself and flags `data-clipped` for the stylesheet.
 */
function TabTitle({ title }: { title: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [clipped, setClipped] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Tabs share the strip width, so a label's box changes when any tab opens,
    // closes, or the window resizes — watch the element rather than the list.
    const measure = () => setClipped(el.scrollWidth > el.clientWidth + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [title]);

  return (
    <span ref={ref} className="qale-tab-title min-w-0 flex-1 overflow-hidden whitespace-nowrap" data-clipped={clipped || undefined}>
      {title}
    </span>
  );
}

/** Mutable per-drag bookkeeping; positions are in scroller content coordinates so mid-drag auto-scroll doesn't invalidate them. */
interface DragDetails {
  id: string;
  index: number;
  pointerId: number;
  startClientX: number;
  startContentX: number;
  lastClientX: number;
  rects: { left: number; width: number }[];
  moved: boolean;
  lastTarget: number;
  raf: number;
}

/** Render-facing drag snapshot: dragged tab follows the pointer, neighbours shift by `width + gap`. */
interface DragState {
  id: string;
  index: number;
  dx: number;
  target: number;
  width: number;
}

/** What the strip needs to draw the right rail's toggle, mirroring the sidebar's. */
interface RightPanelToggle {
  open: boolean;
  /** False on tabs with no rail at all — the button stays, disabled. */
  available: boolean;
  /** What it opens, in the tooltip's words: "session files", "the session". */
  name: string;
  /** Session files waiting behind a hidden rail; 0 elsewhere. */
  count: number;
  onToggle: () => void;
}

/**
 * The tab strip — documents and sessions interchangeably (PLAN-V2 §3.3).
 * Navigation is browser-style: each tab carries its own history, and the
 * back/forward cluster on the left walks the active tab's trail (⌘←/⌘→).
 * Fully keyboard-operable: roving tabindex, ←/→ move focus, ⌥←/→ reorder,
 * ↵/space activate, ⌫ closes, ⌘W closes the active tab (shell shortcut).
 * Right-click for close actions. Tabs reorder by pointer drag. Tabs share
 * the strip width Chrome-style — squeezing toward an icon-only minimum as more
 * open rather than scrolling; only past that floor does it scroll (vertical
 * wheel, edge fades) and keep the active tab in view.
 */
export function TabStrip({
  sidebarOpen,
  onToggleSidebar,
  rightPanel,
}: {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  rightPanel: RightPanelToggle;
}) {
  const { tabs, activeTabId, setActiveTab, closeTab, moveTab, openHome, sessions, goBack, goForward, canGoBack, canGoForward } = useApp();
  const [menu, setMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [fades, setFades] = useState({ left: false, right: false });
  const scrollerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragDetails | null>(null);

  const updateFades = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setFades((f) => (f.left === left && f.right === right ? f : { left, right }));
  }, []);

  useEffect(() => {
    updateFades();
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(updateFades);
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateFades, tabs.length]);

  // Vertical wheel scrolls the strip horizontally; native listener because
  // React's synthetic wheel can't preventDefault (passive on the root).
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Keep the active tab in view — smooth unless the user prefers reduced motion.
  useEffect(() => {
    if (!activeTabId) return;
    const el = document.getElementById(`tab-${activeTabId}`);
    if (!el) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  }, [activeTabId, tabs.length]);

  /** Recompute drag position/target from the last pointer x and current scroll. */
  const applyDrag = useCallback(() => {
    const d = dragRef.current;
    const scroller = scrollerRef.current;
    if (!d || !d.moved || !scroller) return;
    const own = d.rects[d.index];
    if (!own) return;
    const sRect = scroller.getBoundingClientRect();
    const contentX = d.lastClientX - sRect.left + scroller.scrollLeft;
    const dx = contentX - d.startContentX;
    const centers = d.rects.map((r) => r.left + r.width / 2);
    const draggedCenter = own.left + own.width / 2 + dx;
    let target = d.index;
    if (dx > 0) {
      for (let j = d.index + 1; j < centers.length; j++) if (draggedCenter > (centers[j] ?? Infinity)) target = j;
    } else {
      for (let j = d.index - 1; j >= 0; j--) if (draggedCenter < (centers[j] ?? -Infinity)) target = j;
    }
    d.lastTarget = target;
    setDrag({ id: d.id, index: d.index, dx, target, width: own.width });
  }, []);

  /** rAF loop: holding a dragged tab near either edge scrolls the strip. */
  const edgeScrollStep = useCallback(() => {
    const d = dragRef.current;
    const scroller = scrollerRef.current;
    if (!d || !d.moved || !scroller) return;
    const sRect = scroller.getBoundingClientRect();
    let delta = 0;
    if (d.lastClientX < sRect.left + EDGE_SCROLL_ZONE) delta = -Math.ceil((sRect.left + EDGE_SCROLL_ZONE - d.lastClientX) / 4);
    else if (d.lastClientX > sRect.right - EDGE_SCROLL_ZONE) delta = Math.ceil((d.lastClientX - (sRect.right - EDGE_SCROLL_ZONE)) / 4);
    if (delta !== 0) {
      const before = scroller.scrollLeft;
      scroller.scrollLeft += delta;
      if (scroller.scrollLeft !== before) applyDrag();
    }
    d.raf = requestAnimationFrame(edgeScrollStep);
  }, [applyDrag]);

  const endDrag = useCallback(
    (commit: boolean) => {
      const d = dragRef.current;
      if (!d) return;
      cancelAnimationFrame(d.raf);
      dragRef.current = null;
      // moveTab and setDrag(null) land in the same commit: transforms clear
      // exactly as layout takes over, so the drop is seamless.
      if (commit && d.moved) moveTab(d.id, d.lastTarget);
      setDrag(null);
    },
    [moveTab],
  );

  const onTabPointerDown = (e: React.PointerEvent<HTMLDivElement>, tab: Tab, index: number) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    setActiveTab(tab.id);
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const sRect = scroller.getBoundingClientRect();
    const rects = tabs.map((t) => {
      const r = document.getElementById(`tab-${t.id}`)?.getBoundingClientRect();
      return r
        ? { left: r.left - sRect.left + scroller.scrollLeft, width: r.width }
        : { left: 0, width: 0 };
    });
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      id: tab.id,
      index,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startContentX: e.clientX - sRect.left + scroller.scrollLeft,
      lastClientX: e.clientX,
      rects,
      moved: false,
      lastTarget: index,
      raf: 0,
    };
  };

  const onTabPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    d.lastClientX = e.clientX;
    if (!d.moved) {
      if (Math.abs(e.clientX - d.startClientX) < DRAG_THRESHOLD) return;
      d.moved = true;
      d.raf = requestAnimationFrame(edgeScrollStep);
    }
    applyDrag();
  };

  const moveFocus = (from: number, dir: 1 | -1) => {
    const next = tabs[(from + dir + tabs.length) % tabs.length];
    if (next) document.getElementById(`tab-${next.id}`)?.focus();
  };

  return (
    <div
      className={`relative flex h-10 items-stretch bg-sidebar ${!sidebarOpen && isMac ? 'pl-[70px]' : ''}`}
      style={{ WebkitAppRegion: 'drag' } as never}
    >
      {/* Sidebar toggle sits apart from the paired nav arrows so the two read as
          distinct jobs — no divider needed. */}
      <div className="flex shrink-0 items-center gap-0.5 pr-1 pl-1.5" style={{ WebkitAppRegion: 'no-drag' } as never}>
        <ToolbarButton
          icon={PanelLeft}
          label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          keys={['⌘', '\\']}
          onClick={onToggleSidebar}
          aria-expanded={sidebarOpen}
        />
        {/* Browser-style history for the ACTIVE tab. Disabled ≠ hidden: the
            cluster keeps its place so the strip never reflows on navigation. */}
        <ToolbarButton icon={ArrowLeft} label="Back" keys={['⌘', '←']} onClick={goBack} disabled={!canGoBack} />
        <ToolbarButton icon={ArrowRight} label="Forward" keys={['⌘', '→']} onClick={goForward} disabled={!canGoForward} />
      </div>
      <div className="relative min-w-0 flex-1">
        <div
          ref={scrollerRef}
          onScroll={updateFades}
          // pt-1 gives the tabs a shoulder of strip above them (browser-style)
          // instead of butting into the window edge; px-1.5 is exactly the flare
          // width, so the first and last curves land inside the scroll box.
          className="flex h-full items-stretch gap-3 overflow-x-auto overscroll-x-contain px-1.5 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
          aria-label="Open tabs"
        >
          {tabs.map((tab, i) => {
            const Icon = iconFor(tab);
            const active = tab.id === activeTabId;
            const dragged = drag?.id === tab.id;
            let style: CSSProperties | undefined;
            if (drag) {
              if (dragged) {
                style = { transform: `translateX(${drag.dx}px)` };
              } else {
                const shiftWidth = drag.width + TAB_GAP;
                if (drag.index < drag.target && i > drag.index && i <= drag.target) style = { transform: `translateX(${-shiftWidth}px)` };
                else if (drag.target < drag.index && i >= drag.target && i < drag.index) style = { transform: `translateX(${shiftWidth}px)` };
              }
            }
            return (
              <div
                key={tab.id}
                id={`tab-${tab.id}`}
                // pr-6 is the close button's lane, held open whether or not the
                // X is painted: the label always stops short of it, so nothing
                // shifts on hover and the X never lands on top of the title.
                className={`qale-tab group relative flex h-full min-w-[56px] max-w-[208px] flex-1 basis-0 items-center gap-1.5 pr-6 pl-2.5 text-dense outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset ${
                  active ? 'z-10 font-medium text-foreground' : 'text-foreground/75 hover:text-foreground'
                } ${
                  dragged
                    ? 'cursor-grabbing shadow-sm'
                    : drag
                      ? 'cursor-default transition-transform duration-150 ease-out motion-reduce:transition-none'
                      : 'cursor-default'
                }`}
                data-active={active || undefined}
                style={{ WebkitAppRegion: 'no-drag', ...style } as never}
                onPointerDown={(e) => onTabPointerDown(e, tab, i)}
                onPointerMove={onTabPointerMove}
                onPointerUp={() => endDrag(true)}
                onPointerCancel={() => endDrag(false)}
                onAuxClick={(e) => {
                  if (e.button === 1) closeTab(tab.id);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ x: e.clientX, y: e.clientY, tabId: tab.id });
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setActiveTab(tab.id);
                  } else if (e.key === 'Backspace' || e.key === 'Delete') {
                    e.preventDefault();
                    closeTab(tab.id);
                  } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && e.altKey) {
                    e.preventDefault();
                    moveTab(tab.id, i + (e.key === 'ArrowRight' ? 1 : -1));
                    requestAnimationFrame(() => document.getElementById(`tab-${tab.id}`)?.focus());
                  } else if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    moveFocus(i, 1);
                  } else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    moveFocus(i, -1);
                  }
                }}
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
              >
                {(() => {
                  // Session tabs carry their live status: spinning while the
                  // agent works, an ink-blue dot once it needs the PO.
                  const s = tab.kind === 'session' && tab.sessionId ? sessions.find((x) => x.id === tab.sessionId) : undefined;
                  if (s?.running) return <Spinner className="size-3.5 shrink-0 text-muted-foreground" aria-label="running" />;
                  return <Icon className="size-3.5 shrink-0 opacity-70" aria-hidden />;
                })()}
                <TabTitle title={tab.title} />
                {tab.kind === 'session' &&
                  tab.sessionId &&
                  (() => {
                    const s = sessions.find((x) => x.id === tab.sessionId);
                    return s && !s.running && (s.pendingCards > 0 || s.unread) ? (
                      <span className="size-1.5 shrink-0 rounded-full bg-brand" aria-label="needs you" />
                    ) : null;
                  })()}
                {/* Close button sits in the reserved lane rather than in flow,
                    so it never forces the strip to scroll. Shown on hover and
                    on the active tab — the one you're most likely to close —
                    and it fades in over dead space, never over the title. */}
                <button
                  className={`absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-foreground/70 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${
                    active ? 'opacity-100' : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  tabIndex={-1}
                  aria-label={`Close ${tab.title}`}
                  title="Close tab (⌘W)"
                >
                  <X className="size-3" />
                </button>
              </div>
            );
          })}
        </div>
        {fades.left && (
          <div aria-hidden className="pointer-events-none absolute top-0 bottom-px left-0 z-20 w-8 bg-gradient-to-r from-sidebar to-transparent" />
        )}
        {fades.right && (
          <div aria-hidden className="pointer-events-none absolute top-0 right-0 bottom-px z-20 w-8 bg-gradient-to-l from-sidebar to-transparent" />
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5 px-1.5" style={{ WebkitAppRegion: 'no-drag' } as never}>
        {/* Mirrors the sidebar toggle at the far end of the strip: same button
            vocabulary, the same key with ⇧. Hidden with files behind it, the
            button carries the workspace's "there's something here" dot, so a
            fan-out writing into a shut rail is never silent. */}
        <span className="relative inline-flex">
          <ToolbarButton
            icon={PanelRight}
            label={
              rightPanel.open
                ? `Hide ${rightPanel.name}`
                : rightPanel.count > 0
                  ? `Show ${rightPanel.name} (${rightPanel.count})`
                  : `Show ${rightPanel.name}`
            }
            keys={['⇧', '⌘', '\\']}
            onClick={rightPanel.onToggle}
            disabled={!rightPanel.available}
            aria-expanded={rightPanel.available && rightPanel.open}
          />
          {!rightPanel.open && rightPanel.count > 0 && (
            <span
              aria-hidden
              className="pointer-events-none absolute top-1 right-1 size-1.5 rounded-full bg-brand"
            />
          )}
        </span>
        {/* Browser geometry, browser behaviour: the new tab opens on Home —
            this app's new-tab page, and the one screen that leads anywhere. */}
        <ToolbarButton
          icon={Plus}
          label="New tab"
          keys={['⌘', 'T']}
          onClick={() => openHome({ newTab: true, foreground: true })}
        />
      </div>
      {/* Bottom hairline lives above the inactive tabs (browser-style) but below the
          z-raised active tab, whose background bridges it into the content area. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-border" />
      {menu && <TabMenu tabId={menu.tabId} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
    </div>
  );
}
