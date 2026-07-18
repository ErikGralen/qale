import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@pm/ui';
import { AlertTriangle, ArrowRight, Check, Inbox, Layers, Send } from 'lucide-react';
import type { AgentPingDTO, OutboundPayloadDTO, ProposalDTO, ProposalStatsDTO } from '@pm/ipc';
import { useApp, type SessionOverview } from '../state/app-state';
import { invoke } from '../lib/ipc';
import { sessionLabel, timeAgo } from '../lib/session-meta';
import { CardItem, HousekeepingItem } from '../components/inbox/CardItem';
import { PingItem, SuggestionPing } from '../components/inbox/PingRows';
import { ResultItem } from '../components/inbox/ResultItem';
import { outboundTarget } from '../components/inbox/shared';

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
