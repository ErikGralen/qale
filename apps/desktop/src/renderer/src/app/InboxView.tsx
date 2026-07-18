import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Badge } from '@pm/ui';
import { AlertTriangle, ArrowRight, Check, Inbox, Layers, MessageSquare, Pencil, Send, Trash2, Wrench, X } from 'lucide-react';
import type {
  AgentPingDTO,
  OutboundPayloadDTO,
  PingLinkChoiceItemDTO,
  PingOrphanItemDTO,
  ProposalDTO,
  ProposalStatsDTO,
  UpdatePayloadDTO,
} from '@pm/ipc';
import { normalizeLinkTarget } from '@pm/domain';
import { useApp, type SessionOverview } from '../state/app-state';
import { invoke } from '../lib/ipc';
import { sessionLabel, timeAgo } from '../lib/session-meta';

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

/**
 * Inline renderer for a short human sentence that may contain `[[wikilinks]]`
 * (e.g. a proposal's rationale). Each wikilink becomes a clickable link that
 * resolves and routes exactly like the read-view Markdown component — normalize
 * the raw target, resolve the slug to a note path over IPC, then open it. Plain
 * text passes through unchanged so the card's typography is preserved.
 */
function WikiText({ text, onOpen }: { text: string; onOpen: (path: string) => void }) {
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  WIKILINK_RE.lastIndex = 0;
  while ((match = WIKILINK_RE.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const { target, alias } = normalizeLinkTarget(match[1] ?? '');
    nodes.push(
      <button
        key={match.index}
        className="text-brand hover:underline"
        onClick={async (e) => {
          e.stopPropagation();
          const path = await invoke['note:resolveLink'](target);
          if (path) onOpen(path);
        }}
      >
        {alias ?? target}
      </button>,
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <>{nodes}</>;
}

/** Strip `[[wikilink]]` syntax to its bare label — for non-interactive contexts
 *  (e.g. a truncated preview already wrapped in a button). */
function stripWikilinks(text: string): string {
  return text.replace(WIKILINK_RE, (_full, inner: string) => {
    const { target, alias } = normalizeLinkTarget(inner);
    return alias ?? target;
  });
}

const KIND_LABEL: Record<string, string> = { note: 'new note', decision: 'decision', update: 'update', outbound: 'outbound draft' };

/** Sessions whose card group reads as a meeting review, not a generic pile. */
function isReviewGroup(sessionType: string | null): boolean {
  return sessionType === 'after-meeting' || sessionType === 'external-transcript';
}

/** The librarian's prepared fixes — mechanical repairs, rendered glance-and-go. */
function isLibrarianGroup(g: CardGroup): boolean {
  return g.sessionId === 'librarian';
}

/**
 * Narrative order for a meeting review — mirror how the PM thinks about what
 * just happened, stakes descending: the meeting summary sets context, decisions
 * are highest-stakes, then insights/todos; mechanical hub/ledger updates are
 * housekeeping; outbound (externally visible) is always its own last decision.
 */
function cardRank(p: ProposalDTO): number {
  if (p.kind === 'outbound') return 4;
  if (p.kind === 'update') return p.targetPath?.startsWith('meetings/') ? 0 : 3;
  if (p.kind === 'decision') return 1;
  return 2;
}

const HOUSEKEEPING_RANK = 3;

interface SentReceipt {
  id: string;
  target: string;
}

/** One session's pending cards, headed by the conversation that produced them. */
interface CardGroup {
  sessionId: string;
  sessionType: string | null;
  /** The stored conversation behind the cards — absent for librarian/seed cards. */
  session: SessionOverview | null;
  cards: ProposalDTO[];
  newest: number;
}

/** The flattened attention queue — what ↑↓ walks, in visual order. */
type QueueItem =
  | { kind: 'card'; proposal: ProposalDTO; group: CardGroup }
  | { kind: 'ping'; ping: AgentPingDTO }
  | { kind: 'result'; session: SessionOverview };

/**
 * The Inbox (PLAN-V2 §3.3) — home, not a dashboard: the single queue of
 * everything awaiting the PO. Approval cards arrive grouped by the session that
 * proposed them; agent pings ("noticed X — fix it together?") and sessions that
 * finished while the PO was away follow. Judged in seconds — by mouse or
 * entirely by keyboard — with a reachable zero. Running sessions never appear
 * here: they need nothing yet, and the sidebar rail carries them.
 */
export function InboxView() {
  const {
    proposals,
    sessions,
    pings,
    acceptProposal,
    rejectProposal,
    refreshProposals,
    openDoc,
    openChat,
    openPing,
    dismissPing,
    resolvePingItem,
    markSessionSeen,
  } = useApp();
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<{ accepted: number; rejected: number }>({ accepted: 0, rejected: 0 });
  const [sent, setSent] = useState<SentReceipt[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [stats, setStats] = useState<ProposalStatsDTO | null>(null);
  const [streak, setStreak] = useState(0);
  const [audit, setAudit] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);
  /** Failures from the keyboard one-tap path — surfaced above the Librarian
   * section, since the row-level error display belongs to the mouse path. */
  const [pingError, setPingError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const SPOT_AUDIT_EVERY = 5;

  const loadStats = () => void invoke['proposals:stats']().then(setStats).catch(() => setStats(null));
  useEffect(() => {
    void refreshProposals();
    loadStats();
  }, [refreshProposals]);

  const queue = useMemo(() => proposals.filter((p) => p.status === 'pending'), [proposals]);

  const groups = useMemo<CardGroup[]>(() => {
    const bySession = new Map<string, CardGroup>();
    for (const p of queue) {
      let g = bySession.get(p.sessionId);
      if (!g) {
        g = {
          sessionId: p.sessionId,
          sessionType: p.sessionType,
          session: sessions.find((s) => s.id === p.sessionId) ?? null,
          cards: [],
          newest: 0,
        };
        bySession.set(p.sessionId, g);
      }
      g.cards.push(p);
      g.newest = Math.max(g.newest, p.created);
    }
    // Meeting reviews get the narrative order (summary → decisions → insights →
    // housekeeping → outbound); render order MUST match this — focus indices
    // walk g.cards positionally.
    for (const g of bySession.values()) {
      if (isReviewGroup(g.sessionType)) {
        g.cards.sort((a, b) => cardRank(a) - cardRank(b) || a.created - b.created);
      }
    }
    return [...bySession.values()].sort((a, b) => b.newest - a.newest);
  }, [queue, sessions]);

  // The librarian is one presence, not two: its prepared fixes leave the
  // session pile and join its suggestions in the Librarian section below.
  const sessionGroups = useMemo(() => groups.filter((g) => !isLibrarianGroup(g)), [groups]);
  const librarianGroup = useMemo(() => groups.find(isLibrarianGroup) ?? null, [groups]);

  // Sessions that finished with nothing to approve — an answer waiting to be read.
  const results = useMemo(
    () => sessions.filter((s) => s.lifecycle === 'active' && s.unread && !s.running && s.pendingCards === 0),
    [sessions],
  );

  // Stakes descending: the PO's own sessions' output, finished sessions, then
  // the librarian — its fixes are still approvals ("need you"), but the
  // suggestion pings can always wait and never count.
  const items = useMemo<QueueItem[]>(
    () => [
      ...sessionGroups.flatMap((g) => g.cards.map((proposal): QueueItem => ({ kind: 'card', proposal, group: g }))),
      ...results.map((session): QueueItem => ({ kind: 'result', session })),
      ...(librarianGroup?.cards.map((proposal): QueueItem => ({ kind: 'card', proposal, group: librarianGroup })) ??
        []),
      ...pings.map((ping): QueueItem => ({ kind: 'ping', ping })),
    ],
    [sessionGroups, librarianGroup, pings, results],
  );

  useEffect(() => {
    setFocusIdx((i) => Math.min(i, Math.max(0, items.length - 1)));
  }, [items.length]);

  const bumpStreak = () =>
    setStreak((s) => {
      const next = s + 1;
      if (next % SPOT_AUDIT_EVERY === 0) setAudit(true);
      return next;
    });

  const setError = (id: string, message: string | null) =>
    setErrors((e) => {
      const next = { ...e };
      if (message === null) delete next[id];
      else next[id] = message;
      return next;
    });

  const onAccept = useCallback(
    async (p: ProposalDTO, edited?: unknown) => {
      setBusy(true);
      setError(p.id, null);
      try {
        const r = await acceptProposal(p.id, edited);
        if (r.ok) {
          setReceipt((x) => ({ ...x, accepted: x.accepted + 1 }));
          bumpStreak();
          if (p.kind === 'outbound') {
            const ob = p.payload as OutboundPayloadDTO;
            setSent((s) => [...s, { id: p.id, target: outboundTarget(ob) }]);
          }
        } else if (r.stale) {
          // The keyboard path can accept without ever seeing the preview's
          // stale banner — a stale refusal must speak, never no-op.
          setError(p.id, 'This card went stale — the note changed underneath it. Review the updated diff before applying.');
        } else {
          setError(p.id, r.error ?? 'Could not apply this card — the workspace rejected the write.');
        }
      } catch (err) {
        setError(p.id, err instanceof Error ? err.message : 'Something went wrong applying this card.');
      } finally {
        setBusy(false);
      }
      loadStats();
    },
    [acceptProposal],
  );

  const onReject = useCallback(
    async (p: ProposalDTO) => {
      setBusy(true);
      setError(p.id, null);
      try {
        await rejectProposal(p.id);
        setReceipt((x) => ({ ...x, rejected: x.rejected + 1 }));
        setStreak(0);
      } catch (err) {
        setError(p.id, err instanceof Error ? err.message : 'Something went wrong discarding this card.');
      } finally {
        setBusy(false);
      }
      loadStats();
    },
    [rejectProposal],
  );

  const acceptCards = useCallback(
    async (cards: ProposalDTO[]) => {
      setBusy(true);
      try {
        let local = streak;
        for (const p of cards) {
          // Anti-rubber-stamping: pause the batch for a spot-audit every N accepts.
          if (local > 0 && local % SPOT_AUDIT_EVERY === 0) {
            setAudit(true);
            break;
          }
          // Outbound never rides along in a batch — each send is its own decision.
          if (p.kind === 'outbound') continue;
          const r = await acceptProposal(p.id).catch((err: unknown) => {
            setError(p.id, err instanceof Error ? err.message : 'Failed — retry from the card.');
            return { ok: false as const };
          });
          if (r.ok) {
            local++;
            setReceipt((x) => ({ ...x, accepted: x.accepted + 1 }));
          }
        }
        setStreak(local);
      } finally {
        setBusy(false);
      }
      loadStats();
    },
    [acceptProposal, streak],
  );

  const openResult = useCallback(
    (s: SessionOverview) => {
      markSessionSeen(s.id);
      openChat({ id: s.id, sessionType: s.sessionType, title: s.title });
    },
    [markSessionSeen, openChat],
  );

  const openItemSession = useCallback(
    (item: QueueItem) => {
      if (item.kind === 'card' && item.group.session) {
        const s = item.group.session;
        openChat({ id: s.id, sessionType: s.sessionType, title: s.title });
      } else if (item.kind === 'ping') {
        void openPing(item.ping);
      } else if (item.kind === 'result') {
        openResult(item.session);
      }
    },
    [openChat, openPing, openResult],
  );

  const internalCount = queue.filter((p) => p.kind !== 'outbound').length;

  // Keyboard one-taps on the focused suggestion card: 1-9 applies that option
  // of its first open row, s skips the row. True to "nothing silent", a
  // failure surfaces as a banner instead of vanishing.
  const keySuggestion = (ping: AgentPingDTO, key: string): boolean => {
    const payload = ping.payload;
    if (!payload) return false;
    let itemId: string | null = null;
    let choice: string | undefined;
    if (payload.kind === 'link-choices') {
      const row = payload.items.find((i) => !i.resolution && i.options.length > 0);
      if (!row) return false;
      itemId = row.id;
      if (key !== 's') choice = row.options[Number(key) - 1]?.slug;
    } else {
      const row = payload.items.find((i) => !i.resolution && i.mentions.length > 0);
      if (!row) return false;
      itemId = row.id;
      if (key !== 's') choice = row.mentions[Number(key) - 1]?.host;
    }
    if (key !== 's' && !choice) return false;
    const action = key === 's' ? ({ action: 'skip' } as const) : ({ action: 'fix', choice: choice! } as const);
    void resolvePingItem(ping.id, itemId, action)
      .then(() => setPingError(null))
      .catch((err: unknown) =>
        setPingError(err instanceof Error ? err.message : 'Could not apply that suggestion — try the row itself.'),
      );
    return true;
  };

  // Full keyboard path: navigate, approve/open, dismiss without the mouse.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT') return;
    const current = items[focusIdx];
    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault();
      setFocusIdx((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault();
      setFocusIdx((i) => Math.max(i - 1, 0));
    } else if ((e.key === 'Enter' || e.key === 'a') && current && !busy) {
      e.preventDefault();
      if (current.kind === 'card') void onAccept(current.proposal);
      else openItemSession(current);
    } else if ((e.key === 'Backspace' || e.key === 'x') && current && !busy) {
      e.preventDefault();
      if (current.kind === 'card') void onReject(current.proposal);
      else if (current.kind === 'ping') void dismissPing(current.ping.id);
      else markSessionSeen(current.session.id);
    } else if (e.key === 'o' && current) {
      e.preventDefault();
      openItemSession(current);
    } else if (current?.kind === 'ping' && /^[1-9s]$/.test(e.key) && !busy) {
      if (keySuggestion(current.ping, e.key)) e.preventDefault();
    }
  };

  // Where each visual block starts in the flattened queue (for focus mapping).
  let cursor = 0;
  const groupStarts = sessionGroups.map((g) => {
    const start = cursor;
    cursor += g.cards.length;
    return start;
  });
  const resultStart = cursor;
  const librarianStart = resultStart + results.length;
  const pingStart = librarianStart + (librarianGroup?.cards.length ?? 0);
  /** Approvals and unread results — what the header count means by "need you". */
  const needCount = pingStart;
  const focusedSuggestion = (() => {
    const cur = items[focusIdx];
    return cur?.kind === 'ping' && cur.ping.payload ? cur.ping : null;
  })();

  return (
    <div className="flex h-full flex-col" onKeyDown={onKeyDown}>
      <div className="flex h-10 items-center gap-2 border-b border-border px-5 text-sm font-medium text-muted-foreground">
        <Inbox className="size-4" /> Inbox
        {needCount > 0 && (
          <span className="text-xs">· {needCount} need{needCount === 1 ? 's' : ''} you</span>
        )}
        {pings.length > 0 && (
          <span className="text-xs">· {pings.length} suggestion{pings.length === 1 ? '' : 's'}</span>
        )}
        {items.length > 0 && (
          <span className="ml-auto hidden text-xs text-muted-foreground lg:block">
            {focusedSuggestion
              ? '↑↓ navigate · 1–9 apply · s skip · ↵ chat · ⌫ dismiss'
              : '↑↓ navigate · ↵ approve/open · ⌫ dismiss · o open session'}
          </span>
        )}
        {internalCount > 1 && (
          <Button size="sm" variant="ghost" className={items.length > 0 ? '' : 'ml-auto'} onClick={() => void acceptCards(queue)} disabled={busy}>
            <Layers className="size-3.5" /> Accept all internal ({internalCount})
          </Button>
        )}
      </div>

      <div ref={listRef} className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-8 py-5 outline-none" tabIndex={0}>
        {audit && queue.length > 0 && (
          <div className="mb-3 flex items-center gap-3 rounded-lg border border-warning/40 bg-warning/8 px-3 py-2 text-sm">
            <AlertTriangle className="size-4 shrink-0 text-warning" />
            <span className="flex-1 text-foreground">
              You've approved {streak} in a row — take a closer look at this one before continuing.
            </span>
            <Button size="sm" variant="ghost" onClick={() => setAudit(false)}>
              Got it
            </Button>
          </div>
        )}

        {sent.length > 0 && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-success/30 bg-success/8 px-3 py-2 text-sm">
            <Send className="mt-0.5 size-4 shrink-0 text-success" />
            <div className="min-w-0 flex-1">
              <span className="font-medium text-foreground">Sent this session</span>
              <ul className="mt-0.5 text-muted-foreground">
                {sent.slice(-3).map((s) => (
                  <li key={s.id} className="truncate">{s.target}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {items.length === 0 ? (
          <div className="mt-16 flex flex-col items-center gap-3 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-brand/10">
              <Check className="size-6 text-brand" />
            </div>
            <h2 className="text-lg font-semibold">Inbox zero</h2>
            {(receipt.accepted > 0 || receipt.rejected > 0) && (
              <p className="text-sm text-muted-foreground">
                {receipt.accepted} accepted · {receipt.rejected} dismissed this session.
              </p>
            )}
            <p className="max-w-sm text-sm text-muted-foreground">
              Nothing needs you. Approval cards, finished sessions, and the librarian's prepared
              fixes land here — judged in seconds, nothing written silently.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {sessionGroups.map((g, gi) => {
              const review = isReviewGroup(g.sessionType);
              // The note the review is about — its meeting page (or source note).
              const anchor = review
                ? (g.cards.map((c) => c.targetPath).find((t) => t?.startsWith('meetings/')) ??
                   g.cards
                     .flatMap((c) => c.evidence)
                     .map((e) => e.ref.replace(/^\[\[/, '').replace(/\]\]$/, ''))
                     .find((r) => r.startsWith('meetings/') || r.startsWith('sources/')))
                : null;
              const hkStart = review ? g.cards.findIndex((c) => cardRank(c) === HOUSEKEEPING_RANK) : -1;
              const hkEnd = review
                ? (hkStart === -1 ? -1 : g.cards.findIndex((c, i) => i >= hkStart && cardRank(c) > HOUSEKEEPING_RANK))
                : -1;
              const hk = hkStart === -1 ? [] : g.cards.slice(hkStart, hkEnd === -1 ? undefined : hkEnd);
              const renderCard = (p: ProposalDTO, ci: number, compact: boolean) => {
                const idx = groupStarts[gi]! + ci;
                const shared = {
                  proposal: p,
                  busy,
                  focused: idx === focusIdx,
                  error: errors[p.id] ?? null,
                  onFocus: () => setFocusIdx(idx),
                  onAccept: (edited?: unknown) => onAccept(p, edited),
                  onReject: () => onReject(p),
                  onOpen: openDoc,
                };
                return compact ? <HousekeepingItem key={p.id} {...shared} /> : <CardItem key={p.id} {...shared} />;
              };
              return (
                <section key={g.sessionId} aria-label={groupLabel(g)}>
                  <div className="mb-1.5 flex items-baseline gap-2 px-0.5">
                    <h3 className="min-w-0 shrink-0 truncate text-sm font-semibold">{groupLabel(g)}</h3>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{timeAgo(g.newest)}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-1">
                      {g.cards.filter((c) => c.kind !== 'outbound').length > 1 && (
                        <Button size="sm" variant="ghost" onClick={() => void acceptCards(g.cards)} disabled={busy}>
                          <Check className="size-3.5" /> Approve all
                        </Button>
                      )}
                      {anchor && (
                        <button
                          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                          onClick={() => openDoc(anchor)}
                        >
                          {anchor.startsWith('meetings/') ? 'Open meeting' : 'Open source'}
                        </button>
                      )}
                      {g.session && (
                        <button
                          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                          onClick={() => openChat({ id: g.session!.id, sessionType: g.session!.sessionType, title: g.session!.title })}
                        >
                          Open session <ArrowRight className="size-3" />
                        </button>
                      )}
                    </span>
                  </div>
                  <ul className="flex flex-col gap-3">
                    {hk.length === 0
                      ? g.cards.map((p, ci) => renderCard(p, ci, false))
                      : [
                          ...g.cards.slice(0, hkStart).map((p, ci) => renderCard(p, ci, false)),
                          <li key="hk" className="flex flex-col gap-1.5">
                            <div className="mt-1 flex items-center gap-2 px-0.5">
                              <span className="text-xs font-medium text-muted-foreground">
                                Housekeeping · {hk.length} — ledgers & links, glance and go
                              </span>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="ml-auto"
                                onClick={() => void acceptCards(hk)}
                                disabled={busy}
                              >
                                <Check className="size-3.5" /> Approve all {hk.length}
                              </Button>
                            </div>
                            <ul className="flex flex-col gap-1.5">
                              {hk.map((p, i) => renderCard(p, hkStart + i, true))}
                            </ul>
                          </li>,
                          ...g.cards
                            .slice(hkStart + hk.length)
                            .map((p, i) => renderCard(p, hkStart + hk.length + i, false)),
                        ]}
                  </ul>
                </section>
              );
            })}

            {results.length > 0 && (
              <section aria-label="While you were away">
                <h3 className="mb-1.5 px-0.5 text-sm font-semibold">While you were away</h3>
                <ul className="flex flex-col gap-2">
                  {results.map((s, i) => (
                    <ResultItem
                      key={s.id}
                      session={s}
                      focused={resultStart + i === focusIdx}
                      onFocus={() => setFocusIdx(resultStart + i)}
                      onOpen={() => openResult(s)}
                      onClear={() => markSessionSeen(s.id)}
                    />
                  ))}
                </ul>
              </section>
            )}

            {(librarianGroup || pings.length > 0) && (
              <section aria-label="Librarian">
                {needCount === 0 && (
                  <p className="mb-3 flex items-center gap-2 px-0.5 text-sm text-muted-foreground">
                    <Check className="size-4 text-success" aria-hidden />
                    Nothing needs you — just the librarian's tidy-ups below, whenever suits.
                  </p>
                )}
                <div className="mb-1.5 flex items-baseline gap-2 px-0.5">
                  <h3 className="shrink-0 text-sm font-semibold">Librarian</h3>
                  <span className="min-w-0 truncate text-xs text-muted-foreground">
                    keeps the memory connected — a tap approves, nothing happens silently
                  </span>
                  {librarianGroup && librarianGroup.cards.length > 1 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto shrink-0"
                      onClick={() => void acceptCards(librarianGroup.cards)}
                      disabled={busy}
                    >
                      <Check className="size-3.5" /> Fix all {librarianGroup.cards.length}
                    </Button>
                  )}
                </div>
                {pingError && (
                  <div className="mb-1.5 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/8 px-3 py-1.5 text-sm text-destructive">
                    <span className="flex-1">{pingError}</span>
                    <Button size="sm" variant="ghost" onClick={() => setPingError(null)}>
                      Dismiss
                    </Button>
                  </div>
                )}
                <ul className="flex flex-col gap-1.5">
                  {librarianGroup?.cards.map((p, ci) => {
                    const idx = librarianStart + ci;
                    const shared = {
                      proposal: p,
                      busy,
                      focused: idx === focusIdx,
                      error: errors[p.id] ?? null,
                      onFocus: () => setFocusIdx(idx),
                      onAccept: (edited?: unknown) => onAccept(p, edited),
                      onReject: () => onReject(p),
                      onOpen: openDoc,
                    };
                    // Prepared fixes stay glance-and-go rows; anything richer
                    // (a note proposal, say) gets the full card.
                    return p.kind === 'update' ? (
                      <HousekeepingItem key={p.id} {...shared} />
                    ) : (
                      <CardItem key={p.id} {...shared} />
                    );
                  })}
                  {pings.map((ping, i) =>
                    ping.payload ? (
                      <SuggestionPing
                        key={ping.id}
                        ping={ping}
                        focused={pingStart + i === focusIdx}
                        onFocus={() => setFocusIdx(pingStart + i)}
                        onOpen={() => void openPing(ping)}
                        onDismiss={() => void dismissPing(ping.id)}
                      />
                    ) : (
                      <PingItem
                        key={ping.id}
                        ping={ping}
                        focused={pingStart + i === focusIdx}
                        onFocus={() => setFocusIdx(pingStart + i)}
                        onOpen={() => void openPing(ping)}
                        onDismiss={() => void dismissPing(ping.id)}
                      />
                    ),
                  )}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>

      {stats && stats.accepted + stats.rejected > 0 && (
        <div className="flex items-center gap-3 border-t border-border px-6 py-1.5 text-xs text-muted-foreground">
          {stats.approvalRate !== null && stats.accepted > 0 && (
            <span>approval {Math.round(stats.approvalRate * 100)}%</span>
          )}
          {stats.avgApproveMs !== null && <span>· ~{Math.round(stats.avgApproveMs / 1000)}s to approve</span>}
          <span>· {stats.edited} edited</span>
          <span className="ml-auto">
            {stats.accepted} accepted · {stats.rejected} dismissed all-time
          </span>
        </div>
      )}
    </div>
  );
}

function groupLabel(g: CardGroup): string {
  if (g.sessionId === 'librarian') return 'Librarian';
  if (g.sessionId === 'seed') return 'Demo session';
  const type = g.sessionType ? sessionLabel(g.sessionType) : null;
  const title = g.session?.title;
  if (type && title && title.toLowerCase() !== type.toLowerCase()) return `${type} — ${title}`;
  return type ?? title ?? 'Session';
}

/**
 * A librarian finding as one quiet row — the full story lives in the chat it
 * opens, not here. Dismissing is cheap; the finding stays quiet for a week.
 */
function PingItem({
  ping,
  focused,
  onFocus,
  onOpen,
  onDismiss,
}: {
  ping: AgentPingDTO;
  focused: boolean;
  onFocus: () => void;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [focused]);
  return (
    <li
      ref={ref}
      onClick={onFocus}
      className={`group flex items-center gap-2 rounded-lg bg-card py-1.5 pr-1.5 pl-3 ring-1 transition-shadow ${
        focused ? 'ring-2 ring-ring/60' : 'ring-foreground/10'
      }`}
    >
      <Wrench className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <button className="min-w-0 flex-1 truncate text-left text-sm focus-visible:outline-none" onClick={onOpen} title={ping.body}>
        {ping.title}
      </button>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{timeAgo(ping.created)}</span>
      <Button size="sm" variant="ghost" onClick={onOpen}>
        <MessageSquare className="size-3.5" /> Chat about this
      </Button>
      <button
        className="rounded p-1 text-muted-foreground opacity-0 group-focus-within:opacity-70 group-hover:opacity-70 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={onDismiss}
        aria-label={`Dismiss "${ping.title}"`}
        title="Dismiss — stays quiet for a week"
      >
        <X className="size-3.5" />
      </button>
    </li>
  );
}

/**
 * A ping that carries its own prepared answers (PLAN-V2 §3.5): each finding is
 * one row with one-tap choices — pick the right link target, wire an orphan
 * into the note that already mentions it, or skip. The tap IS the approval;
 * the card retires itself when every row is settled. Chat stays one click away.
 */
function SuggestionPing({
  ping,
  focused,
  onFocus,
  onOpen,
  onDismiss,
}: {
  ping: AgentPingDTO;
  focused: boolean;
  onFocus: () => void;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const { resolvePingItem, openDoc, deleteNote } = useApp();
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [focused]);

  const resolve = async (itemId: string, action: { action: 'fix'; choice: string } | { action: 'skip' }) => {
    setBusyItem(itemId);
    setError(null);
    try {
      await resolvePingItem(ping.id, itemId, action);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not apply that fix.');
    } finally {
      setBusyItem(null);
    }
  };

  const payload = ping.payload!;
  return (
    <li
      ref={ref}
      onClick={onFocus}
      className={`rounded-xl bg-card ring-1 transition-shadow ${focused ? 'ring-2 ring-ring/60' : 'ring-foreground/10'}`}
    >
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <Wrench className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={ping.body}>
          {ping.title}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{timeAgo(ping.created)}</span>
        <Button size="sm" variant="ghost" onClick={onOpen}>
          <MessageSquare className="size-3.5" /> Chat about this
        </Button>
        <button
          className="rounded p-1 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={onDismiss}
          aria-label={`Dismiss "${ping.title}"`}
          title="Dismiss — stays quiet for a week"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <ul className="flex flex-col gap-1 px-3 py-2.5">
        {payload.kind === 'link-choices'
          ? payload.items.map((item) => (
              <LinkChoiceRow
                key={item.id}
                item={item}
                busy={busyItem !== null}
                onOpen={openDoc}
                onFix={(slug) => void resolve(item.id, { action: 'fix', choice: slug })}
                onSkip={() => void resolve(item.id, { action: 'skip' })}
              />
            ))
          : payload.items.map((item) => (
              <OrphanRow
                key={item.id}
                item={item}
                busy={busyItem !== null}
                onOpen={openDoc}
                onFix={(host) => void resolve(item.id, { action: 'fix', choice: host })}
                onSkip={() => void resolve(item.id, { action: 'skip' })}
                onDelete={async () => {
                  await deleteNote(item.path);
                  await resolve(item.id, { action: 'skip' });
                }}
              />
            ))}
      </ul>

      {error && (
        <div className="mx-3 mb-2.5 rounded-md border border-destructive/40 bg-destructive/8 px-3 py-1.5 text-sm text-destructive">
          {error}
        </div>
      )}
    </li>
  );
}

/** Shared chip for the one-tap answers — the wikilink vocabulary, actionable. */
function ChoiceChip({
  label,
  title,
  disabled,
  onClick,
}: {
  label: string;
  title?: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="rounded bg-brand/8 px-1.5 py-0.5 font-mono text-xs text-brand hover:bg-brand/15 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {label}
    </button>
  );
}

function SkipButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button
      className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
      onClick={onClick}
      disabled={disabled}
    >
      Skip
    </button>
  );
}

/** One dangling link: the broken target, where it sits, and did-you-mean taps. */
function LinkChoiceRow({
  item,
  busy,
  onOpen,
  onFix,
  onSkip,
}: {
  item: PingLinkChoiceItemDTO;
  busy: boolean;
  onOpen: (path: string) => void;
  onFix: (slug: string) => void;
  onSkip: () => void;
}) {
  if (item.resolution) {
    const fixed = item.resolution.action === 'fixed';
    return (
      <li className="flex items-center gap-1.5 px-0.5 text-sm text-muted-foreground">
        {fixed ? <Check className="size-3.5 shrink-0 text-success" aria-hidden /> : <X className="size-3.5 shrink-0" aria-hidden />}
        <span className="font-mono text-xs">[[{item.target}]]</span>
        <span className="min-w-0 truncate">
          {fixed ? `now points at ${(item.resolution as { slug: string }).slug}` : 'skipped'}
        </span>
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg bg-muted/50 px-2 py-1.5 text-sm">
      <span className="rounded bg-destructive/8 px-1.5 py-0.5 font-mono text-xs text-destructive">[[{item.target}]]</span>
      <span className="text-xs text-muted-foreground">in</span>
      <button
        className="font-mono text-xs text-muted-foreground hover:text-foreground"
        onClick={() => onOpen(item.from)}
        title={`Open ${item.from}`}
      >
        {item.from.split('/').pop()}
      </button>
      <span className="text-xs text-muted-foreground">— did you mean</span>
      {item.options.map((o) => (
        <ChoiceChip key={o.slug} label={o.slug} title={o.title || o.slug} disabled={busy} onClick={() => onFix(o.slug)} />
      ))}
      {item.options.length === 0 && (
        <span className="text-xs text-muted-foreground italic">no close match — chat it through</span>
      )}
      <span className="ml-auto">
        <SkipButton disabled={busy} onClick={onSkip} />
      </span>
    </li>
  );
}

/** One orphan note: where it's already mentioned, as link-it-there taps. */
function OrphanRow({
  item,
  busy,
  onOpen,
  onFix,
  onSkip,
  onDelete,
}: {
  item: PingOrphanItemDTO;
  busy: boolean;
  onOpen: (path: string) => void;
  onFix: (host: string) => void;
  onSkip: () => void;
  onDelete?: () => void;
}) {
  const slug = item.path.replace(/\.md$/, '');
  if (item.resolution) {
    const fixed = item.resolution.action === 'fixed';
    return (
      <li className="flex items-center gap-1.5 px-0.5 text-sm text-muted-foreground">
        {fixed ? <Check className="size-3.5 shrink-0 text-success" aria-hidden /> : <X className="size-3.5 shrink-0" aria-hidden />}
        <span className="min-w-0 truncate">
          {item.title}{' '}
          {fixed
            ? `— linked from ${(item.resolution as { host: string }).host.replace(/\.md$/, '').split('/').pop()}`
            : '— skipped'}
        </span>
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg bg-muted/50 px-2 py-1.5 text-sm">
      <button
        className="min-w-0 truncate text-left font-medium hover:text-brand"
        onClick={() => onOpen(item.path)}
        title={`Open ${item.path}`}
      >
        {item.title}
      </button>
      {item.mentions.length > 0 ? (
        <>
          <span className="text-xs text-muted-foreground">— mentioned in</span>
          {item.mentions.map((m) => (
            <ChoiceChip
              key={m.host}
              label={m.host.replace(/\.md$/, '').split('/').pop() ?? m.host}
              title={`"${m.line.trim()}" — link ${slug} here`}
              disabled={busy}
              onClick={() => onFix(m.host)}
            />
          ))}
          <span className="text-xs text-muted-foreground">tap to link it there</span>
        </>
      ) : (
        <span className="text-xs text-muted-foreground italic">nothing mentions it</span>
      )}
      {onDelete && item.mentions.length === 0 && (
        <button
          className="rounded px-1.5 py-0.5 text-xs text-destructive/70 hover:bg-destructive/8 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
          onClick={onDelete}
          disabled={busy}
          title={`Delete ${item.path}`}
        >
          <span className="flex items-center gap-1"><Trash2 className="size-3" /> Delete</span>
        </button>
      )}
      <span className="ml-auto">
        <SkipButton disabled={busy} onClick={onSkip} />
      </span>
    </li>
  );
}

/** A session that finished with nothing to approve — read it and it clears. */
function ResultItem({
  session,
  focused,
  onFocus,
  onOpen,
  onClear,
}: {
  session: SessionOverview;
  focused: boolean;
  onFocus: () => void;
  onOpen: () => void;
  onClear: () => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [focused]);
  const verb = session.sessionType === 'ask' ? 'answered' : 'finished';
  return (
    <li
      ref={ref}
      onClick={onFocus}
      className={`group flex items-center gap-2 rounded-lg bg-card py-2 pr-2 pl-3 ring-1 transition-shadow ${
        focused ? 'ring-2 ring-ring/60' : 'ring-foreground/10'
      }`}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
      <button className="min-w-0 flex-1 text-left focus-visible:outline-none" onClick={onOpen}>
        <span className="block truncate text-sm font-medium">{session.title}</span>
        <span className="block text-xs text-muted-foreground">
          {sessionLabel(session.sessionType)} {verb} · {timeAgo(session.updated)}
        </span>
      </button>
      <Button size="sm" variant="outline" onClick={onOpen}>
        {session.sessionType === 'ask' ? 'Read answer' : 'Open'}
      </Button>
      <button
        className="rounded p-1 text-muted-foreground opacity-0 group-focus-within:opacity-70 group-hover:opacity-70 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={onClear}
        aria-label={`Mark "${session.title}" as seen`}
        title="Mark as seen"
      >
        <X className="size-3.5" />
      </button>
    </li>
  );
}

function outboundTarget(ob: OutboundPayloadDTO): string {
  const dest = ob.projectKey
    ? ` → ${ob.projectKey}`
    : ob.issueKey
      ? ` → ${ob.issueKey}`
      : ob.pageId
        ? ` → page ${ob.pageId}`
        : ob.audience
          ? ` → ${ob.audience}`
          : '';
  // "message · message → exec" reads as a stutter — collapse when they match.
  return ob.system === ob.action ? `${ob.system}${dest}` : `${ob.system} · ${ob.action}${dest}`;
}

interface CardItemProps {
  proposal: ProposalDTO;
  busy: boolean;
  focused: boolean;
  error: string | null;
  onFocus: () => void;
  onAccept: (edited?: unknown) => void;
  onReject: () => void;
  onOpen: (path: string) => void;
}

/**
 * The housekeeping tier of a meeting review — mechanical writes (last_told
 * bumps, hub links) rendered as one-line rows so the review reads as 2 real
 * cards + a batch, not six equal cards. Expands to the full card on demand.
 */
function HousekeepingItem(props: CardItemProps) {
  const { proposal, busy, focused, error, onFocus, onAccept, onReject, onOpen } = props;
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [focused]);

  if (expanded || error) return <CardItem {...props} />;

  const target = proposal.targetPath ?? (proposal.payload as { path?: string }).path ?? '';
  return (
    <li
      ref={ref}
      onClick={onFocus}
      className={`group flex items-center gap-2 rounded-lg bg-card py-1.5 pr-1.5 pl-3 ring-1 transition-shadow ${
        focused ? 'ring-2 ring-ring/60' : 'ring-foreground/10'
      }`}
    >
      <button
        className="min-w-0 flex-1 truncate text-left text-sm text-foreground/85 focus-visible:outline-none"
        onClick={() => setExpanded(true)}
        title="Show the full card"
      >
        {stripWikilinks(proposal.rationale)}
      </button>
      <button
        className="max-w-48 shrink-0 truncate font-mono text-xs text-muted-foreground hover:text-foreground"
        onClick={() => onOpen(target)}
        title={`Open ${target}`}
      >
        {target.split('/').pop()}
      </button>
      <button
        className="rounded p-1 text-muted-foreground opacity-0 group-focus-within:opacity-70 group-hover:opacity-70 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={() => setExpanded(true)}
        aria-label="Show the full card"
        title="Show the full card"
      >
        <Pencil className="size-3.5" />
      </button>
      <Button size="sm" variant="ghost" onClick={() => onAccept()} disabled={busy} aria-label="Approve">
        <Check className="size-3.5" />
      </Button>
      <Button size="sm" variant="ghost" onClick={onReject} disabled={busy} aria-label="Discard">
        <X className="size-3.5" />
      </Button>
    </li>
  );
}

function CardItem({
  proposal,
  busy,
  focused,
  error,
  onFocus,
  onAccept,
  onReject,
  onOpen,
}: CardItemProps) {
  const { previewProposal, openSession } = useApp();
  const [preview, setPreview] = useState<{ before: string; after: string; stale: boolean } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftBody, setDraftBody] = useState('');
  const [draftPatch, setDraftPatch] = useState<{ search: string; replace: string }[]>([]);
  const ref = useRef<HTMLLIElement>(null);

  useEffect(() => {
    let alive = true;
    void previewProposal(proposal.id).then((p) => alive && setPreview(p));
    return () => {
      alive = false;
    };
  }, [proposal.id, previewProposal]);

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [focused]);

  const outbound = proposal.kind === 'outbound' ? (proposal.payload as OutboundPayloadDTO) : null;
  const target = outbound
    ? outboundTarget(outbound)
    : proposal.targetPath ?? (proposal.payload as { path?: string }).path ?? '';
  const supersedes = (proposal.payload as { supersedes?: string }).supersedes;

  const startEdit = () => {
    if (proposal.kind === 'update') {
      setDraftPatch((proposal.payload as UpdatePayloadDTO).patch.map((p) => ({ ...p })));
    } else {
      setDraftBody((proposal.payload as { body?: string }).body ?? '');
    }
    setEditing(true);
  };

  // The escape hatch: talk the card through in a seeded chat. The card stays
  // pending — the conversation can end in approval here or a revised card.
  const discuss = () => {
    const prompt = [
      "I'm looking at a pending approval card and want to talk it through before deciding. Don't apply anything — the card stays pending until I act on it.",
      '',
      `Card: ${proposal.rationale}`,
      `Kind: ${KIND_LABEL[proposal.kind] ?? proposal.kind}`,
      target ? `Target: ${target}` : null,
      proposal.evidence.length > 0 ? `Evidence: ${proposal.evidence.map((e) => e.ref).join(', ')}` : null,
      '',
      'Proposed payload:',
      '```json',
      JSON.stringify(proposal.payload, null, 2).slice(0, 4000),
      '```',
      '',
      "Briefly explain why this was proposed and what approving would change, citing sources. Then ask what I'd like to adjust — if I want changes, propose a revised card.",
    ]
      .filter((line) => line !== null)
      .join('\n');
    openSession('chat', {
      initialPrompt: prompt,
      title: `About: ${target || proposal.rationale.slice(0, 40)}`,
      fresh: true,
    });
  };

  const approveEdited = () => {
    const edited =
      proposal.kind === 'update'
        ? { ...(proposal.payload as UpdatePayloadDTO), patch: draftPatch }
        : { ...(proposal.payload as unknown as Record<string, unknown>), body: draftBody };
    setEditing(false);
    onAccept(edited);
  };

  return (
    <li
      ref={ref}
      onClick={onFocus}
      className={`rounded-xl bg-card ring-1 transition-shadow ${
        focused ? 'ring-2 ring-ring/60' : 'ring-foreground/10'
      } ${outbound ? 'ring-brand/30' : ''}`}
    >
      {outbound && (
        <div className="flex items-center gap-2 rounded-t-xl border-b border-brand/20 bg-brand/6 px-4 py-2 text-sm">
          <Send className="size-4 shrink-0 text-brand" />
          <span className="font-medium text-foreground">
            Sends outside the workspace — {outbound.system}
            {outbound.audience ? ` · for ${outbound.audience}` : ''}
          </span>
          <span className="ml-auto truncate font-mono text-xs text-muted-foreground">{target}</span>
        </div>
      )}

      <div className="p-4">
        {/* The human sentence leads — what approving does. Kind and target are
            metadata below it, not the headline. */}
        <p className="mb-1 text-sm font-medium">
          <WikiText text={proposal.rationale} onOpen={onOpen} />
        </p>

        <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-xs text-muted-foreground">{KIND_LABEL[proposal.kind] ?? proposal.kind}</span>
          {!outbound && (
            <button
              className="truncate font-mono text-xs text-muted-foreground hover:text-foreground"
              onClick={() => onOpen(target)}
              title={`Open ${target}`}
            >
              {target}
            </button>
          )}
          {supersedes && <Badge variant="outline">supersedes {supersedes.split('/').pop()}</Badge>}
          {proposal.inference && (
            <Badge className="gap-1 bg-warning/15 text-warning" title="No citations — the agent inferred this without sources">
              <AlertTriangle className="size-3" /> inference
            </Badge>
          )}
        </div>

        {proposal.evidence.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {proposal.evidence.map((e) => {
              // Evidence refs are wikilink slugs, not file paths — resolve
              // through the index like every other link surface, or the tab
              // opens onto a note:get miss and skeletons forever.
              const { target, alias } = normalizeLinkTarget(e.ref.replace(/^\[\[/, '').replace(/\]\]$/, ''));
              return (
                <button
                  key={e.ref}
                  className="rounded bg-brand/8 px-1.5 py-0.5 font-mono text-xs text-brand hover:bg-brand/15"
                  onClick={async () => {
                    const path = await invoke['note:resolveLink'](target);
                    if (path) onOpen(path);
                  }}
                >
                  {alias ?? target}
                </button>
              );
            })}
          </div>
        )}

        {editing ? (
          <div className="mb-2 flex flex-col gap-2">
            {proposal.kind === 'update' ? (
              draftPatch.map((blk, i) => (
                <div key={i} className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">replaces:</span>
                  <pre className="max-h-24 overflow-y-auto rounded-lg bg-destructive/6 p-2 text-xs whitespace-pre-wrap text-muted-foreground">
                    {blk.search}
                  </pre>
                  <span className="text-xs font-medium text-muted-foreground">with:</span>
                  <textarea
                    value={blk.replace}
                    onChange={(e) =>
                      setDraftPatch((d) => d.map((b, j) => (j === i ? { ...b, replace: e.target.value } : b)))
                    }
                    rows={Math.min(10, blk.replace.split('\n').length + 1)}
                    className="w-full resize-y rounded-lg border border-input bg-background p-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  />
                </div>
              ))
            ) : (
              <textarea
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                rows={Math.min(16, draftBody.split('\n').length + 2)}
                autoFocus
                className="w-full resize-y rounded-lg border border-input bg-background p-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            )}
          </div>
        ) : (
          preview && (
            <button className="mb-2 block w-full text-left" onClick={() => setExpanded((x) => !x)}>
              <div
                className={`overflow-y-auto rounded-lg bg-muted/60 p-3 text-xs ${expanded ? 'max-h-96' : 'max-h-24'}`}
              >
                {proposal.kind === 'update' ? (
                  <DiffBlock before={preview.before} after={preview.after} />
                ) : (
                  <pre className="whitespace-pre-wrap">{preview.after}</pre>
                )}
              </div>
            </button>
          )
        )}

        {preview?.stale && (
          <div className="mb-2 rounded-md border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-destructive">
            The target changed since this was proposed — re-run the session to regenerate.
          </div>
        )}

        {error && (
          <div className="mb-2 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-destructive">
            <span className="flex-1">{error}</span>
            <Button size="sm" variant="outline" onClick={() => onAccept()} disabled={busy}>
              Retry
            </Button>
          </div>
        )}

        <div className="flex gap-2">
          {editing ? (
            <>
              <Button size="sm" onClick={approveEdited} disabled={busy || preview?.stale}>
                <Check className="size-3.5" /> {outbound ? 'Approve & send edited' : 'Approve edited'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" onClick={() => onAccept()} disabled={busy || preview?.stale}>
                {outbound ? <Send className="size-3.5" /> : <Check className="size-3.5" />}
                {outbound ? 'Approve & send' : 'Approve'}
              </Button>
              <Button size="sm" variant="outline" onClick={startEdit} disabled={busy || preview?.stale}>
                <Pencil className="size-3.5" /> Edit
              </Button>
              <Button size="sm" variant="outline" onClick={onReject} disabled={busy}>
                <X className="size-3.5" /> Discard
              </Button>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={discuss}>
                <MessageSquare className="size-3.5" /> Chat about this
              </Button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

type DiffRow = { kind: 'same' | 'add' | 'del'; text: string };

/** Longest-common-subsequence line diff — insertions no longer cascade. */
function diffLines(before: string, after: string): DiffRow[] {
  const b = before.split('\n');
  const a = after.split('\n');
  // Guard pathological sizes; the preview is judged in seconds, not scrolled for minutes.
  if (b.length * a.length > 250_000) {
    return a.map((text) => ({ kind: 'same' as const, text }));
  }
  const m = b.length;
  const n = a.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i]![j] = b[i] === a[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (b[i] === a[j]) {
      rows.push({ kind: 'same', text: a[j]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      rows.push({ kind: 'del', text: b[i]! });
      i++;
    } else {
      rows.push({ kind: 'add', text: a[j]! });
      j++;
    }
  }
  while (i < m) rows.push({ kind: 'del', text: b[i++]! });
  while (j < n) rows.push({ kind: 'add', text: a[j++]! });
  return rows;
}

function DiffBlock({ before, after }: { before: string; after: string }) {
  const rows = useMemo(() => diffLines(before, after), [before, after]);
  return (
    <div className="font-mono">
      {rows.map((r, i) => (
        <div
          key={i}
          className={
            r.kind === 'add'
              ? 'bg-success/10 text-foreground'
              : r.kind === 'del'
                ? 'bg-destructive/8 text-muted-foreground line-through decoration-destructive/40'
                : 'text-muted-foreground'
          }
        >
          <span className="select-none">{r.kind === 'add' ? '+ ' : r.kind === 'del' ? '- ' : '  '}</span>
          <span className="whitespace-pre-wrap">{r.text || ' '}</span>
        </div>
      ))}
    </div>
  );
}
