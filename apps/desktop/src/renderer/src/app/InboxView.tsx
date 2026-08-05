import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@qale/ui';
import { AlertTriangle, ArrowRight, ArrowUpRight, Check, Inbox, Layers } from 'lucide-react';
import type { MeetingReviewAskDTO, OutboundPayloadDTO, ProposalDTO } from '@qale/ipc';
import { MAINTENANCE_AGENTS } from '@qale/sessions';
import { useApp, type SessionOverview } from '../state/app-state';
import { ofKind, type AttentionItem } from '../lib/attention';
import { navFromEvent } from '../lib/nav';
import { timeAgo } from '../lib/session-meta';
import { useToast } from '../components/toast';
import { PageHeader } from '../components/PageHeader';
import { QuestionItem } from '../components/inbox/QuestionItem';
import { CardItem, HousekeepingItem } from '../components/inbox/CardItem';
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

/**
 * Work a background tidy pass left behind. Keyed by the agent that produced it,
 * never by the session id: the librarian runs as an ordinary session now, so
 * there is no fixed id to special-case, and a second maintenance agent would
 * land in the same place without a line of new code.
 *
 * Any card in the group is enough, and the first one is not a safe proxy: a
 * card is stamped with the LAST skill the run invoked, not with the agent whose
 * run it was. The librarian pulls in the process-note skill mid-pass for a raw
 * capture, so whichever of the two happened to sort first would otherwise
 * decide where the whole run renders, and a pass would move sections depending
 * on what it found.
 */
const fromMaintenance = (cards: readonly ProposalDTO[]): boolean =>
  cards.some((c) => MAINTENANCE_AGENTS.has(c.skill ?? ''));

interface SentReceipt {
  id: string;
  target: string;
}

/** One session's pending cards, headed by the session that produced them. */
interface CardGroup {
  sessionId: string;
  /** The stored session behind the cards — absent for seed cards. */
  session: SessionOverview | null;
  cards: ProposalDTO[];
  newest: number;
}

/**
 * One librarian pass and everything it left behind: the repairs it drafted, and
 * the calls it could not make on its own. Both belong to the same run, so they
 * read together and share one door into the session that did the reading.
 */
interface LibrarianRun {
  sessionId: string;
  session: SessionOverview | null;
  cards: ProposalDTO[];
  questions: AttentionItem[];
  newest: number;
}

/** The flattened attention queue — what ↑↓ walks, in visual order. */
type QueueItem =
  | { kind: 'question'; item: AttentionItem }
  | { kind: 'card'; proposal: ProposalDTO; session: SessionOverview | null }
  | { kind: 'result'; session: SessionOverview };

/**
 * The Inbox (PLAN-V2 §3.3) — home, not a dashboard: the single queue of
 * everything awaiting the PO. A turn parked on a question leads; approval cards
 * arrive grouped by the session that proposed them; sessions that finished
 * while the PO was away follow, and the librarian's tidying comes last.
 * Judged in seconds — by mouse or entirely by keyboard — with a reachable zero.
 * Running sessions never appear here: they need nothing yet, and the sidebar
 * rail carries them.
 *
 * Everything the header counts is a named filter over the one attention list
 * (lib/attention.ts): `waitingCount` is what needs the PO, and the librarian's
 * questions are quiet, so they sit outside it. The Inbox owns no arithmetic.
 */
export function InboxView() {
  const {
    vault,
    attention,
    waitingCount,
    proposals,
    sessions,
    acceptProposal,
    rejectProposal,
    markMeetingReviewed,
    refreshProposals,
    openDoc,
    openChat,
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

  const sessionGroups = useMemo(() => groups.filter((g) => !fromMaintenance(g.cards)), [groups]);

  // Turns parked on a question, and sessions that finished with nothing to
  // approve — both read straight off the one attention list, so the header's
  // count and the rows below it can never drift apart. A quiet question is one
  // the librarian asked: it belongs beside its own pass, not among the turns
  // the PO started and is now blocking.
  const allQuestions = useMemo(() => ofKind(attention, 'question'), [attention]);
  const questions = useMemo(() => allQuestions.filter((q) => !q.quiet), [allQuestions]);
  const quietQuestions = useMemo(() => allQuestions.filter((q) => q.quiet), [allQuestions]);
  const results = useMemo(() => {
    const unread = new Set(ofKind(attention, 'result').map((i) => i.id));
    return sessions.filter((s) => unread.has(`result:${s.id}`));
  }, [attention, sessions]);

  // The librarian is one presence however often it runs: every pass gathers
  // into the one section below, newest first, carrying both what it drafted
  // and what it wants a call on.
  const librarianRuns = useMemo<LibrarianRun[]>(() => {
    const byRun = new Map<string, LibrarianRun>();
    const run = (sessionId: string, when: number): LibrarianRun => {
      let r = byRun.get(sessionId);
      if (!r) {
        r = {
          sessionId,
          session: sessions.find((s) => s.id === sessionId) ?? null,
          cards: [],
          questions: [],
          newest: 0,
        };
        byRun.set(sessionId, r);
      }
      r.newest = Math.max(r.newest, when);
      return r;
    };
    for (const g of groups) if (fromMaintenance(g.cards)) run(g.sessionId, g.newest).cards = g.cards;
    // A pass that only asked something has no cards and so no group above.
    for (const q of quietQuestions)
      if (q.target.open === 'session') run(q.target.sessionId, q.when ?? 0).questions.push(q);
    return [...byRun.values()].sort((a, b) => b.newest - a.newest);
  }, [groups, quietQuestions, sessions]);

  /** Every librarian repair a batch could actually apply — a drafted page
   *  update leaves the workspace, so it stays its own decision. */
  const librarianFixable = useMemo(
    () => librarianRuns.flatMap((r) => r.cards).filter((c) => c.kind !== 'outbound'),
    [librarianRuns],
  );

  // Stakes descending: parked questions, the PO's own sessions' output,
  // finished sessions, then the librarian — its repairs are still approvals
  // ("need you"), but its questions can always wait and never count.
  const items = useMemo<QueueItem[]>(
    () => [
      ...questions.map((item): QueueItem => ({ kind: 'question', item })),
      ...sessionGroups.flatMap((g) =>
        g.cards.map((proposal): QueueItem => ({ kind: 'card', proposal, session: g.session })),
      ),
      ...results.map((session): QueueItem => ({ kind: 'result', session })),
      ...librarianRuns.flatMap((r): QueueItem[] => [
        ...r.cards.map((proposal): QueueItem => ({ kind: 'card', proposal, session: r.session })),
        ...r.questions.map((item): QueueItem => ({ kind: 'question', item })),
      ]),
    ],
    [questions, sessionGroups, librarianRuns, results],
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
              `This changed upstream since the card was drafted. Take one more look, then approve anyway to ${outboundAct(p.payload as OutboundPayloadDTO).verb}.`,
          );
        } else if (r.stale) {
          // The keyboard path can accept without ever seeing the preview's
          // stale banner — a stale refusal must speak, never no-op.
          setError(p.id, "This card no longer fits the note's current text. Open it to review, or re-run the session to regenerate it.");
        } else {
          setError(p.id, r.error ?? 'Could not apply this card: the workspace rejected the write.');
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
            setError(p.id, err instanceof Error ? err.message : 'Failed. Retry from the card.');
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
        if (failed > 0) toast(`${failed} of ${attempted} cards failed to apply. See the cards for details.`);
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
            setError(p.id, err instanceof Error ? err.message : 'Failed. Retry from the card.');
          }
        }
        setStreak(0);
        if (failed > 0) toast(`${failed} of ${cards.length} cards failed to discard. See the cards for details.`);
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
      } else if (item.kind === 'card' && item.session) {
        const s = item.session;
        openChat({ id: s.id, title: s.title });
      } else if (item.kind === 'result') {
        openResult(item.session);
      }
    },
    [openChat, openResult],
  );

  const internalCount = queue.filter((p) => p.kind !== 'outbound').length;

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
      else if (current.kind === 'result') markSessionSeen(current.session.id);
    } else if (e.key === 'o' && current) {
      e.preventDefault();
      openItemSession(current);
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
  cursor += results.length;
  const runStarts = librarianRuns.map((r) => {
    const start = cursor;
    cursor += r.cards.length + r.questions.length;
    return start;
  });
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
          // Two different things, said as two different things: what the PO
          // owes an answer to, and what the librarian would like a call on
          // whenever they get round to it.
          waitingCount > 0 || quietQuestions.length > 0 ? (
            <>
              {waitingCount > 0 && `${waitingCount} need${waitingCount === 1 ? 's' : ''} you`}
              {waitingCount > 0 && quietQuestions.length > 0 && ' · '}
              {quietQuestions.length > 0 &&
                `${quietQuestions.length} question${quietQuestions.length === 1 ? '' : 's'} from the librarian`}
            </>
          ) : undefined
        }
      >
        {items.length > 0 && (
          <span className="hidden max-w-[40ch] truncate text-xs text-muted-foreground xl:block">
            {focusedOutbound
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
              You've approved {streak} in a row. Take a closer look at this one before continuing.
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
              Nothing needs you. Approval cards, finished sessions, and the librarian's tidy-ups
              land here, judged in seconds, nothing written silently.
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
                ? 'Approve to update them all, or discard if the premise is wrong.'
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
                                Housekeeping · {hk.length}: ledgers & links, glance and go
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

            {librarianRuns.length > 0 && (
              <section aria-label="Librarian">
                {waitingCount === 0 && (
                  <p className="mb-3 flex items-center gap-2 px-0.5 text-sm text-muted-foreground">
                    <Check className="size-4 text-success" aria-hidden />
                    Nothing needs you, just the librarian's tidy-ups below, whenever suits.
                  </p>
                )}
                <div className="mb-1.5 flex items-baseline gap-2 px-0.5">
                  <h3 className="shrink-0 text-sm font-semibold">Librarian</h3>
                  <span className="min-w-0 truncate text-xs text-muted-foreground">
                    keeps the memory connected: a tap approves, nothing happens silently
                  </span>
                  {librarianFixable.length > 1 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto shrink-0"
                      onClick={() => void acceptCards(librarianFixable)}
                      disabled={busy}
                    >
                      <Check className="size-3.5" /> Fix all {librarianFixable.length}
                    </Button>
                  )}
                </div>
                {/* One block per pass, each with the door into the session that
                    read the notes — the tidy-ups are somebody's reasoning now,
                    not a list a sweep printed, so the reasoning stays reachable. */}
                <div className="flex flex-col gap-3">
                  {librarianRuns.map((run, ri) => (
                    <div key={run.sessionId}>
                      <div className="mb-1 flex items-baseline gap-2 px-0.5">
                        <span className="text-xs text-muted-foreground">Ran {timeAgo(run.newest)}</span>
                        {run.session && (
                          <button
                            className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                            onClick={(e) => openChat({ id: run.session!.id, title: run.session!.title }, navFromEvent(e))}
                          >
                            Open session <ArrowRight className="size-3" />
                          </button>
                        )}
                      </div>
                      <ul className="flex flex-col gap-1.5">
                        {run.cards.map((p, ci) => {
                          const idx = runStarts[ri]! + ci;
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
                          // A repointed link is glance-and-go; anything richer
                          // (a drafted page update, say) gets the full card.
                          return p.kind === 'update' ? (
                            <HousekeepingItem key={p.id} {...shared} />
                          ) : (
                            <CardItem key={p.id} {...shared} />
                          );
                        })}
                        {run.questions.map((item, qi) => {
                          const idx = runStarts[ri]! + run.cards.length + qi;
                          return (
                            <QuestionItem
                              key={item.id}
                              item={item}
                              focused={idx === focusIdx}
                              onFocus={() => setFocusIdx(idx)}
                              onOpen={() => openItemSession({ kind: 'question', item })}
                            />
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
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
const REVIEW_ASK_KEY = 'qale.reviewAskDismissed.v1';

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
