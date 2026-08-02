import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@pm/ui';
import { AlertTriangle, ArrowRight, ArrowUpRight, Check, Inbox, Layers } from 'lucide-react';
import type { AgentPingDTO, MeetingReviewAskDTO, OutboundPayloadDTO, ProposalDTO } from '@pm/ipc';
import { useApp, type SessionOverview } from '../state/app-state';
import { countOf, ofKind, type AttentionItem } from '../lib/attention';
import { navFromEvent } from '../lib/nav';
import { timeAgo } from '../lib/session-meta';
import { useToast } from '../components/toast';
import { PageHeader } from '../components/PageHeader';
import { QuestionItem } from '../components/inbox/QuestionItem';
import { CardItem, HousekeepingItem } from '../components/inbox/CardItem';
import { PingItem, SuggestionPing } from '../components/inbox/PingRows';
import { ResultItem } from '../components/inbox/ResultItem';
import { outboundAct, outboundReceipt } from '../components/inbox/shared';
import { bareRef, cardRank, HOUSEKEEPING_RANK, orderCards, titleForRef } from '../components/inbox/cardMeta';

/**
 * The document a group of cards is ABOUT — the meeting or source they target,
 * else the one they cite. Read out of the cards themselves: what a group is
 * about is a property of the work, not of whichever skill happened to do it.
 */
function groupAnchor(cards: ProposalDTO[]): string | null {
  const target = cards.map((c) => c.targetPath).find((t) => t?.startsWith('meetings/'));
  if (target) return target;
  return (
    cards
      .flatMap((c) => c.evidence)
      .map((e) => bareRef(e.ref))
      .find((r) => r.startsWith('meetings/') || r.startsWith('sources/')) ?? null
  );
}

/**
 * The one decision behind a group whose cards are all consequences of it — a
 * decision changed, and several notes still point at the old plan. True only
 * when every card is an update citing the SAME decision, which is what a sweep
 * produces and what an ordinary pile of cards never does.
 */
function groupCause(cards: ProposalDTO[]): string | null {
  if (cards.length === 0 || !cards.every((c) => c.kind === 'update')) return null;
  const cause = cards[0]!.evidence.map((e) => bareRef(e.ref)).find((r) => r.startsWith('decisions/'));
  if (!cause) return null;
  return cards.every((c) => c.evidence.some((e) => bareRef(e.ref) === cause)) ? cause : null;
}

/** The librarian's prepared fixes — mechanical repairs, rendered glance-and-go. */
function isLibrarianGroup(g: CardGroup): boolean {
  return g.sessionId === 'librarian';
}

interface SentReceipt {
  id: string;
  target: string;
}

/** One session's pending cards, headed by the session that produced them. */
interface CardGroup {
  sessionId: string;
  /** The stored session behind the cards — absent for librarian/seed cards. */
  session: SessionOverview | null;
  cards: ProposalDTO[];
  newest: number;
}

/** The flattened attention queue — what ↑↓ walks, in visual order. */
type QueueItem =
  | { kind: 'question'; item: AttentionItem }
  | { kind: 'card'; proposal: ProposalDTO; group: CardGroup }
  | { kind: 'ping'; ping: AgentPingDTO }
  | { kind: 'result'; session: SessionOverview };

/**
 * The Inbox (PLAN-V2 §3.3) — home, not a dashboard: the single queue of
 * everything awaiting the PO. A turn parked on a question leads; approval cards
 * arrive grouped by the session that proposed them; agent pings ("noticed X —
 * fix it together?") and sessions that finished while the PO was away follow.
 * Judged in seconds — by mouse or entirely by keyboard — with a reachable zero.
 * Running sessions never appear here: they need nothing yet, and the sidebar
 * rail carries them.
 *
 * Everything the header counts is a named filter over the one attention list
 * (lib/attention.ts): `waitingCount` is what needs the PO, `countOf(…, 'ping')`
 * is what the librarian is merely offering. The Inbox owns no arithmetic.
 */
export function InboxView() {
  const {
    vault,
    attention,
    waitingCount,
    proposals,
    sessions,
    pings,
    acceptProposal,
    rejectProposal,
    markMeetingReviewed,
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
  // Outbound cards whose send was refused because the target moved — they get
  // the explicit "Approve anyway" affordance instead of a blind Retry.
  const [staleSends, setStaleSends] = useState<Record<string, boolean>>({});
  // Meetings whose session emptied with nothing kept: one open question each,
  // asked where the cards just were.
  const [reviewAsks, setReviewAsks] = useState<MeetingReviewAskDTO[]>([]);
  const [streak, setStreak] = useState(0);
  const [audit, setAudit] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);
  /** Failures from the keyboard one-tap path — surfaced above the Librarian
   * section, since the row-level error display belongs to the mouse path. */
  const [pingError, setPingError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  // Keyboard mode works immediately — j/k must not wait for a click.
  useEffect(() => {
    listRef.current?.focus();
  }, []);

  const SPOT_AUDIT_EVERY = 5;

  useEffect(() => {
    void refreshProposals();
  }, [refreshProposals]);

  const queue = useMemo(() => proposals.filter((p) => p.status === 'pending'), [proposals]);

  const groups = useMemo<CardGroup[]>(() => {
    const bySession = new Map<string, CardGroup>();
    for (const p of queue) {
      let g = bySession.get(p.sessionId);
      if (!g) {
        g = {
          sessionId: p.sessionId,
          session: sessions.find((s) => s.id === p.sessionId) ?? null,
          cards: [],
          newest: 0,
        };
        bySession.set(p.sessionId, g);
      }
      g.cards.push(p);
      g.newest = Math.max(g.newest, p.created);
    }
    // Every group reads in narrative order (summary → decisions → insights →
    // housekeeping → outbound); render order MUST match this — focus indices
    // walk g.cards positionally.
    for (const g of bySession.values()) g.cards = orderCards(g.cards);
    return [...bySession.values()].sort((a, b) => b.newest - a.newest);
  }, [queue, sessions]);

  // The librarian is one presence, not two: its prepared fixes leave the
  // session pile and join its suggestions in the Librarian section below.
  const sessionGroups = useMemo(() => groups.filter((g) => !isLibrarianGroup(g)), [groups]);
  const librarianGroup = useMemo(() => groups.find(isLibrarianGroup) ?? null, [groups]);

  // Turns parked on a question, and sessions that finished with nothing to
  // approve — both read straight off the one attention list, so the header's
  // count and the rows below it can never drift apart.
  const questions = useMemo(() => ofKind(attention, 'question'), [attention]);
  const results = useMemo(() => {
    const unread = new Set(ofKind(attention, 'result').map((i) => i.id));
    return sessions.filter((s) => unread.has(`result:${s.id}`));
  }, [attention, sessions]);

  // Stakes descending: parked questions, the PO's own sessions' output,
  // finished sessions, then the librarian — its fixes are still approvals
  // ("need you"), but the suggestion pings can always wait and never count.
  const items = useMemo<QueueItem[]>(
    () => [
      ...questions.map((item): QueueItem => ({ kind: 'question', item })),
      ...sessionGroups.flatMap((g) => g.cards.map((proposal): QueueItem => ({ kind: 'card', proposal, group: g }))),
      ...results.map((session): QueueItem => ({ kind: 'result', session })),
      ...(librarianGroup?.cards.map((proposal): QueueItem => ({ kind: 'card', proposal, group: librarianGroup })) ??
        []),
      ...pings.map((ping): QueueItem => ({ kind: 'ping', ping })),
    ],
    [questions, sessionGroups, librarianGroup, pings, results],
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

  const vaultPath = vault?.path ?? '';

  // The resolve that empties a session hands back a question when nothing was
  // kept. Asked once per meeting: a "not yet" is remembered for the workspace,
  // so re-resolving another of its sessions never re-opens the same question.
  const noteReviewAsk = useCallback(
    (ask: MeetingReviewAskDTO | undefined) => {
      if (!ask || dismissedReviewAsks(vaultPath).includes(ask.path)) return;
      setReviewAsks((asks) => (asks.some((a) => a.path === ask.path) ? asks : [...asks, ask]));
    },
    [vaultPath],
  );

  const answerReviewAsk = useCallback(
    async (ask: MeetingReviewAskDTO) => {
      setReviewAsks((asks) => asks.filter((a) => a.path !== ask.path));
      const r = await markMeetingReviewed(ask.path).catch(() => ({ ok: false }));
      if (!r.ok) toast(`Could not mark ${ask.title} reviewed. Open it and set the status there.`);
    },
    [markMeetingReviewed, toast],
  );

  const dismissReviewAsk = useCallback(
    (ask: MeetingReviewAskDTO) => {
      setReviewAsks((asks) => asks.filter((a) => a.path !== ask.path));
      persistDismissedReviewAsk(vaultPath, ask.path);
    },
    [vaultPath],
  );

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
        noteReviewAsk(r.review);
        if (r.ok) {
          setReceipt((x) => ({ ...x, accepted: x.accepted + 1 }));
          bumpStreak();
          setStaleSends((s) => {
            const next = { ...s };
            delete next[p.id];
            return next;
          });
          if (p.kind === 'outbound') {
            const ob = p.payload as OutboundPayloadDTO;
            setSent((s) => [...s, { id: p.id, target: outboundReceipt(ob) }]);
          }
        } else if (r.stale && p.kind === 'outbound') {
          // The target moved after this was drafted; main refused the send and
          // the card stays pending. The card's error row grows an explicit
          // "Approve anyway" that re-accepts with a refreshed snapshot.
          setStaleSends((s) => ({ ...s, [p.id]: true }));
          setError(
            p.id,
            r.error ??
              `This changed upstream since the card was drafted — take one more look, then approve anyway to ${outboundAct(p.payload as OutboundPayloadDTO).verb}.`,
          );
        } else if (r.stale) {
          // The keyboard path can accept without ever seeing the preview's
          // stale banner — a stale refusal must speak, never no-op.
          setError(p.id, "This card no longer fits the note's current text. Open it to review, or re-run the session to regenerate it.");
        } else {
          setError(p.id, r.error ?? 'Could not apply this card — the workspace rejected the write.');
        }
      } catch (err) {
        setError(p.id, err instanceof Error ? err.message : 'Something went wrong applying this card.');
      } finally {
        setBusy(false);
      }
    },
    [acceptProposal, noteReviewAsk],
  );

  const onReject = useCallback(
    async (p: ProposalDTO) => {
      setBusy(true);
      setError(p.id, null);
      try {
        noteReviewAsk((await rejectProposal(p.id)).review);
        setReceipt((x) => ({ ...x, rejected: x.rejected + 1 }));
        setStreak(0);
      } catch (err) {
        setError(p.id, err instanceof Error ? err.message : 'Something went wrong discarding this card.');
      } finally {
        setBusy(false);
      }
    },
    [rejectProposal, noteReviewAsk],
  );

  const acceptCards = useCallback(
    async (cards: ProposalDTO[]) => {
      setBusy(true);
      try {
        let local = streak;
        let attempted = 0;
        let failed = 0;
        for (const p of cards) {
          // Anti-rubber-stamping: pause the batch for a spot-audit every N accepts.
          if (local > 0 && local % SPOT_AUDIT_EVERY === 0) {
            setAudit(true);
            break;
          }
          // Outbound never rides along in a batch — each send is its own decision.
          if (p.kind === 'outbound') continue;
          attempted++;
          const r = await acceptProposal(p.id).catch((err: unknown) => {
            setError(p.id, err instanceof Error ? err.message : 'Failed — retry from the card.');
            return { ok: false as const };
          });
          noteReviewAsk('review' in r ? r.review : undefined);
          if (r.ok) {
            local++;
            setReceipt((x) => ({ ...x, accepted: x.accepted + 1 }));
          } else {
            failed++;
          }
        }
        setStreak(local);
        if (failed > 0) toast(`${failed} of ${attempted} cards failed to apply — see the cards for details.`);
      } finally {
        setBusy(false);
      }
    },
    [acceptProposal, noteReviewAsk, streak, toast],
  );

  // Discard a whole cause block at once — the PO judged the premise wrong, so
  // none of the consequent edits should land.
  const rejectCards = useCallback(
    async (cards: ProposalDTO[]) => {
      setBusy(true);
      try {
        let failed = 0;
        for (const p of cards) {
          try {
            noteReviewAsk((await rejectProposal(p.id)).review);
            setReceipt((x) => ({ ...x, rejected: x.rejected + 1 }));
          } catch (err) {
            failed++;
            setError(p.id, err instanceof Error ? err.message : 'Failed — retry from the card.');
          }
        }
        setStreak(0);
        if (failed > 0) toast(`${failed} of ${cards.length} cards failed to discard — see the cards for details.`);
      } finally {
        setBusy(false);
      }
    },
    [rejectProposal, noteReviewAsk, toast],
  );

  const openResult = useCallback(
    (s: SessionOverview) => {
      markSessionSeen(s.id);
      openChat({ id: s.id, title: s.title });
    },
    [markSessionSeen, openChat],
  );

  const openItemSession = useCallback(
    (item: QueueItem) => {
      if (item.kind === 'question') {
        const t = item.item.target;
        if (t.open === 'session') openChat({ id: t.sessionId, title: t.title });
      } else if (item.kind === 'card' && item.group.session) {
        const s = item.group.session;
        openChat({ id: s.id, title: s.title });
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

  /** The focused outbound card's send button — the queue's ↵ moves to it
   *  instead of pressing it for you. */
  const focusSend = (id: string): void => {
    const button = listRef.current?.querySelector<HTMLButtonElement>(`[data-send="${CSS.escape(id)}"]`);
    button?.focus();
  };

  // Full keyboard path: navigate, approve/open, dismiss without the mouse.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable) return;
    // A control the PO deliberately landed on owns its own keys — ↵ must reach
    // the button, not be swallowed by the queue's shortcut for the same row.
    // Arrows still steer, and moving the cursor takes focus back off the control.
    const onControl = t.closest('button, a, [role="button"]') !== null;
    const current = items[focusIdx];
    if (e.key === 'ArrowDown' || (e.key === 'j' && !onControl)) {
      e.preventDefault();
      setFocusIdx((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp' || (e.key === 'k' && !onControl)) {
      e.preventDefault();
      setFocusIdx((i) => Math.max(i - 1, 0));
    } else if (onControl) {
      return;
    } else if ((e.key === 'Enter' || e.key === 'a') && current && !busy) {
      e.preventDefault();
      // A send leaves the workspace, so the one-tap approve never fires one —
      // the same rule the batch path keeps. ↵ carries you to the send button;
      // pressing it there is the decision. Everything internal stays one tap.
      if (current.kind !== 'card') openItemSession(current);
      else if (current.proposal.kind === 'outbound') focusSend(current.proposal.id);
      else void onAccept(current.proposal);
    } else if ((e.key === 'Backspace' || e.key === 'x') && current && !busy) {
      e.preventDefault();
      // A question is answered, never dismissed — the key is a deliberate no-op
      // on an ask row rather than a way to lose the turn that is waiting.
      if (current.kind === 'card') void onReject(current.proposal);
      else if (current.kind === 'ping') void dismissPing(current.ping.id);
      else if (current.kind === 'result') markSessionSeen(current.session.id);
    } else if (e.key === 'o' && current) {
      e.preventDefault();
      openItemSession(current);
    } else if (current?.kind === 'ping' && /^[1-9s]$/.test(e.key) && !busy) {
      if (keySuggestion(current.ping, e.key)) e.preventDefault();
    }
  };

  // Where each visual block starts in the flattened queue (for focus mapping).
  let cursor = questions.length;
  const groupStarts = sessionGroups.map((g) => {
    const start = cursor;
    cursor += g.cards.length;
    return start;
  });
  const resultStart = cursor;
  const librarianStart = resultStart + results.length;
  const pingStart = librarianStart + (librarianGroup?.cards.length ?? 0);
  const suggestionCount = countOf(attention, 'ping');
  const focusedSuggestion = (() => {
    const cur = items[focusIdx];
    return cur?.kind === 'ping' && cur.ping.payload ? cur.ping : null;
  })();
  // The hint states what ↵ does on the row you are actually on — on a send it
  // moves you to the button rather than pressing it, and must say so.
  const focusedOutbound = (() => {
    const cur = items[focusIdx];
    return cur?.kind === 'card' && cur.proposal.kind === 'outbound';
  })();

  return (
    <div className="flex h-full flex-col" onKeyDown={onKeyDown}>
      <PageHeader
        icon={Inbox}
        label="Inbox"
        meta={
          waitingCount > 0 || suggestionCount > 0 ? (
            <>
              {waitingCount > 0 && `${waitingCount} need${waitingCount === 1 ? 's' : ''} you`}
              {waitingCount > 0 && suggestionCount > 0 && ' · '}
              {suggestionCount > 0 && `${suggestionCount} suggestion${suggestionCount === 1 ? '' : 's'}`}
            </>
          ) : undefined
        }
      >
        {items.length > 0 && (
          <span className="hidden max-w-[40ch] truncate text-xs text-muted-foreground xl:block">
            {focusedSuggestion
              ? '↑↓ navigate · 1–9 apply · s skip · ↵ ask · ⌫ dismiss'
              : focusedOutbound
                ? '↑↓ navigate · ↵ go to Send · ⌫ discard'
                : '↑↓ navigate · ↵ approve/open · ⌫ dismiss · o open session'}
          </span>
        )}
        {internalCount > 1 && (
          <Button size="sm" variant="ghost" className="shrink-0" onClick={() => void acceptCards(queue)} disabled={busy}>
            <Layers className="size-3.5" /> Accept all internal ({internalCount})
          </Button>
        )}
      </PageHeader>

      {/* `data-queue` marks the region the roving cursor lives in: rows take real
          focus while it holds focus, and never steal it from outside. */}
      <div
        ref={listRef}
        data-queue
        className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-8 py-5 outline-none"
        tabIndex={0}
      >
        {audit && queue.length > 0 && (
          <div className="mb-3 flex items-center gap-3 rounded-lg border border-warning/40 bg-warning/8 px-3 py-2 text-sm">
            <AlertTriangle className="size-4 shrink-0 text-warning" />
            <span className="flex-1 text-foreground">
              You've approved {streak} in a row — take a closer look at this one before continuing.
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAudit(false);
                setStreak(0);
              }}
            >
              Got it
            </Button>
          </div>
        )}

        {sent.length > 0 && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-success/30 bg-success/8 px-3 py-2 text-sm">
            <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-success" />
            <div className="min-w-0 flex-1">
              {/* The banner promised "leaves your workspace"; the receipt says
                  it left, in the same words and in past tense. */}
              <span className="font-medium text-foreground">Left your workspace</span>
              <ul className="mt-0.5 text-muted-foreground">
                {sent.slice(-3).map((s) => (
                  <li key={s.id} className="truncate">{s.target}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* The one question a discarded pile leaves behind, in the spot its
            cards just vacated: nothing was kept, so nothing says the meeting
            was read. "Not yet" leaves it in needs review and never asks again. */}
        {reviewAsks.map((ask) => (
          <div
            key={ask.path}
            className="mb-3 flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm"
          >
            <span className="min-w-0 flex-1 text-muted-foreground">
              Nothing kept from <span className="text-foreground">{ask.title}</span>. Mark it reviewed?
            </span>
            <Button size="sm" variant="ghost" className="shrink-0" onClick={() => void answerReviewAsk(ask)}>
              <Check className="size-3.5" /> Mark reviewed
            </Button>
            <button
              className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              onClick={() => dismissReviewAsk(ask)}
            >
              Not yet
            </button>
          </div>
        ))}

        {items.length === 0 ? (
          <div className="mt-16 flex flex-col items-center gap-3 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-brand/10">
              <Check className="size-6 text-brand" />
            </div>
            <h2 className="text-lg font-semibold">Inbox zero</h2>
            {(receipt.accepted > 0 || receipt.rejected > 0) && (
              <p className="text-sm text-muted-foreground">
                {receipt.accepted} accepted · {receipt.rejected} dismissed so far.
              </p>
            )}
            <p className="max-w-sm text-sm text-muted-foreground">
              Nothing needs you. Approval cards, finished sessions, and the librarian's prepared
              fixes land here — judged in seconds, nothing written silently.
            </p>
          </div>
        ) : (
          /* Sections breathe at 24px while the cards inside one section sit at
             12px — the old 20px left both gaps reading as the same beat. */
          <div className="flex flex-col gap-6">
            {questions.length > 0 && (
              <section aria-label="Questions">
                <h3 className="mb-1.5 px-0.5 text-sm font-semibold">Questions</h3>
                <ul className="flex flex-col gap-2">
                  {questions.map((item, i) => (
                    <QuestionItem
                      key={item.id}
                      item={item}
                      focused={i === focusIdx}
                      onFocus={() => setFocusIdx(i)}
                      onOpen={() => openItemSession({ kind: 'question', item })}
                    />
                  ))}
                </ul>
              </section>
            )}

            {sessionGroups.map((g, gi) => {
              const cause = groupCause(g.cards);
              // The note the group is about — its meeting page (or source note).
              // A cause group is about its decision, and says so in the header.
              const anchor = cause ? null : groupAnchor(g.cards);
              // Housekeeping folds away as the boring tail of a bigger story. When
              // it IS the whole group there is no story to spare the PO, and every
              // card stays legible.
              const hkOnly = g.cards.every((c) => cardRank(c) === HOUSEKEEPING_RANK);
              const hkStart = hkOnly ? -1 : g.cards.findIndex((c) => cardRank(c) === HOUSEKEEPING_RANK);
              const hkEnd =
                hkStart === -1 ? -1 : g.cards.findIndex((c, i) => i >= hkStart && cardRank(c) > HOUSEKEEPING_RANK);
              const hk = hkStart === -1 ? [] : g.cards.slice(hkStart, hkEnd === -1 ? undefined : hkEnd);
              const renderCard = (p: ProposalDTO, ci: number, compact: boolean) => {
                const idx = groupStarts[gi]! + ci;
                const shared = {
                  proposal: p,
                  busy,
                  focused: idx === focusIdx,
                  error: errors[p.id] ?? null,
                  staleSend: staleSends[p.id] ?? false,
                  onFocus: () => setFocusIdx(idx),
                  onAccept: (edited?: unknown) => onAccept(p, edited),
                  onReject: () => onReject(p),
                  onOpen: openDoc,
                };
                return compact ? <HousekeepingItem key={p.id} {...shared} /> : <CardItem key={p.id} {...shared} />;
              };
              const internalN = g.cards.filter((c) => c.kind !== 'outbound').length;
              // The header speaks the meeting, or the cause — never the prompt or a path.
              const title = cause ? causeSentence(cause, g.cards.length) : groupTitle(g, anchor);
              const summary = cause
                ? 'Approve to update them all — or discard, if the premise is wrong.'
                : groupSummary(g.cards);
              return (
                <section key={g.sessionId} aria-label={title}>
                  {/* Title flexes and wraps; actions shrink-0 and stay reachable —
                      a long meeting name never pushes "Approve all" off-screen. */}
                  <div className="mb-2 flex items-start gap-3 px-0.5">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm leading-snug font-semibold text-balance break-words text-foreground">
                        {cause ? title : <>From <span className="text-foreground">{title}</span></>}
                      </h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {summary && <>{summary} · </>}
                        <span className="tabular-nums">{timeAgo(g.newest)}</span>
                      </p>
                    </div>
                    <span className="flex shrink-0 items-center gap-1">
                      {internalN > 1 && (
                        // The batch never sends, so it counts only what it will
                        // actually apply — a group with a pending send says "3",
                        // not "all", and the send stays its own decision below.
                        <Button size="sm" variant="ghost" onClick={() => void acceptCards(g.cards)} disabled={busy}>
                          <Check className="size-3.5" /> {cause ? 'Update' : 'Approve'} all {internalN}
                        </Button>
                      )}
                      {cause ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-muted-foreground"
                          onClick={() => void rejectCards(g.cards)}
                          disabled={busy}
                        >
                          Discard all
                        </Button>
                      ) : (
                        <>
                          {anchor && (
                            <button
                              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                              onClick={(e) => openDoc(anchor, navFromEvent(e))}
                            >
                              {anchor.startsWith('meetings/') ? 'Open meeting' : 'Open source'}
                            </button>
                          )}
                          {g.session && (
                            <button
                              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                              onClick={(e) =>
                                openChat({ id: g.session!.id, title: g.session!.title }, navFromEvent(e))
                              }
                            >
                              Open session <ArrowRight className="size-3" />
                            </button>
                          )}
                        </>
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
                {waitingCount === 0 && (
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
                  <div
                    role="alert"
                    className="mb-1.5 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/8 px-3 py-1.5 text-sm text-destructive"
                  >
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
    </div>
  );
}

/**
 * Meetings the PO answered "not yet" to. Per workspace, like the pin set, and
 * view-only: the answer is "don't ask me again", not a fact about the meeting,
 * so it stays out of the vault. The meeting itself stays in needs review.
 */
const REVIEW_ASK_KEY = 'pm.reviewAskDismissed.v1';

function dismissedReviewAsks(vaultPath: string): string[] {
  try {
    const raw = localStorage.getItem(`${REVIEW_ASK_KEY}:${vaultPath}`);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

function persistDismissedReviewAsk(vaultPath: string, path: string): void {
  try {
    const next = [...new Set([...dismissedReviewAsks(vaultPath), path])];
    localStorage.setItem(`${REVIEW_ASK_KEY}:${vaultPath}`, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
}

/** The group header in human terms: the document the cards are about — never the
 *  agent's prompt, never a path. */
function groupTitle(g: CardGroup, anchor: string | null): string {
  if (anchor) return titleForRef(anchor);
  if (g.sessionId === 'seed') return 'your demo meeting';
  return 'your session';
}

/** A glanceable tally of what a meeting produced, in the PO's nouns. */
function groupSummary(cards: ProposalDTO[]): string {
  let dec = 0;
  let ins = 0;
  let note = 0;
  let upd = 0;
  let out = 0;
  for (const c of cards) {
    if (c.kind === 'outbound') out++;
    else if (c.kind === 'decision') dec++;
    else if (c.kind === 'update') upd++;
    else {
      const type = (c.payload as { frontmatter?: { type?: string } }).frontmatter?.type;
      if (type === 'insight') ins++;
      else note++;
    }
  }
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  const parts: string[] = [];
  if (dec) parts.push(plural(dec, 'decision'));
  if (ins) parts.push(plural(ins, 'insight'));
  if (note) parts.push(plural(note, 'note'));
  if (upd) parts.push(plural(upd, 'update'));
  if (out) parts.push(`${out} to send`);
  return parts.join(' · ');
}

/** The cause behind a sweep: one decision changed and N notes still cite the old
 *  one. Stated as the PO thinks it — cause first, effect second. */
function causeSentence(cause: string, n: number): string {
  const notes = `${n} note${n === 1 ? '' : 's'}`;
  return `Because you decided “${titleForRef(cause)}”, ${notes} still point at the old plan`;
}
