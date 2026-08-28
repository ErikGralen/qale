import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@qale/ui';
import { ArrowRight, Check, Inbox } from 'lucide-react';
import type { ProposalDTO } from '@qale/ipc';
import { MAINTENANCE_AGENTS } from '@qale/sessions';
import { useApp, type SessionOverview } from '../state/app-state';
import { ofKind, type AttentionItem } from '../lib/attention';
import { navFromEvent } from '../lib/nav';
import { timeAgo } from '../lib/session-meta';
import { PageHeader } from '../components/PageHeader';
import { QuestionItem } from '../components/inbox/QuestionItem';
import { ResultItem } from '../components/inbox/ResultItem';
import { ReviewAsks, SentReceipts, SpotAudit, useApprovals } from '../components/inbox/approvals';
import { ApproveAll, CardRows } from '../components/inbox/CardRows';
import { bareRef, orderCards, titleForRef } from '../components/inbox/cardMeta';

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
  const cause = cards[0]!.evidence
    .map((e) => bareRef(e.ref))
    .find((r) => r.startsWith('decisions/'));
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
    attention,
    waitingCount,
    proposals,
    sessions,
    refreshProposals,
    openDoc,
    openChat,
    markSessionSeen,
  } = useApp();
  // Every accept, discard and batch on this page runs the one approve path,
  // the same one the session's own review block runs.
  const approvals = useApprovals();
  const { busy, receipt, accept, reject, rejectAll } = approvals;
  const [focusIdx, setFocusIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Keyboard mode works immediately — j/k must not wait for a click.
  useEffect(() => {
    listRef.current?.focus();
  }, []);

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
    // housekeeping → outbound); the flattened queue below walks the same order,
    // so ↑↓ follows the page.
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
    for (const g of groups)
      if (fromMaintenance(g.cards)) run(g.sessionId, g.newest).cards = g.cards;
    // A pass that only asked something has no cards and so no group above.
    for (const q of quietQuestions)
      if (q.target.open === 'session') run(q.target.sessionId, q.when ?? 0).questions.push(q);
    return [...byRun.values()].sort((a, b) => b.newest - a.newest);
  }, [groups, quietQuestions, sessions]);

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

  /**
   * Where each row sits in the flattened queue, by its own id — the cursor's
   * only map. The rows themselves are rendered by CardRows, which knows cards
   * by id, so nothing here has to count positions and stay in step with the
   * render order.
   */
  const focusIndex = useMemo(() => {
    const m = new Map<string, number>();
    items.forEach((it, i) =>
      m.set(
        it.kind === 'card'
          ? it.proposal.id
          : it.kind === 'result'
            ? `result:${it.session.id}`
            : it.item.id,
        i,
      ),
    );
    return m;
  }, [items]);

  const focusRow = useCallback(
    (id: string) => {
      const idx = focusIndex.get(id);
      if (idx !== undefined) setFocusIdx(idx);
    },
    [focusIndex],
  );

  /** The card under the cursor, or null when the cursor is on a question or a
   *  finished session. */
  const focusedCardId = (() => {
    const cur = items[focusIdx];
    return cur?.kind === 'card' ? cur.proposal.id : null;
  })();

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

  /** The focused outbound card's send button — the queue's ↵ moves to it
   *  instead of pressing it for you. */
  const focusSend = (id: string): void => {
    const button = listRef.current?.querySelector<HTMLButtonElement>(
      `[data-send="${CSS.escape(id)}"]`,
    );
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
      else accept(current.proposal);
    } else if ((e.key === 'Backspace' || e.key === 'x') && current && !busy) {
      e.preventDefault();
      // A question is answered, never dismissed — the key is a deliberate no-op
      // on an ask row rather than a way to lose the turn that is waiting.
      if (current.kind === 'card') reject(current.proposal);
      else if (current.kind === 'result') markSessionSeen(current.session.id);
    } else if (e.key === 'o' && current) {
      e.preventDefault();
      openItemSession(current);
    }
  };

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
      </PageHeader>

      {/* `data-queue` marks the region the roving cursor lives in: rows take real
          focus while it holds focus, and never steal it from outside. */}
      <div
        ref={listRef}
        data-queue
        className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-8 py-5 outline-none"
        tabIndex={0}
      >
        {queue.length > 0 && <SpotAudit approvals={approvals} />}

        <SentReceipts sent={approvals.sent} />

        <ReviewAsks approvals={approvals} />

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
                  {questions.map((item) => (
                    <QuestionItem
                      key={item.id}
                      item={item}
                      focused={focusIndex.get(item.id) === focusIdx}
                      onFocus={() => focusRow(item.id)}
                      onOpen={() => openItemSession({ kind: 'question', item })}
                    />
                  ))}
                </ul>
              </section>
            )}

            {sessionGroups.map((g) => {
              const cause = groupCause(g.cards);
              // The note the group is about — its meeting page (or source note).
              // A cause group is about its decision, and says so in the header.
              const anchor = cause ? null : groupAnchor(g.cards);
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
                        {cause ? (
                          title
                        ) : (
                          <>
                            From <span className="text-foreground">{title}</span>
                          </>
                        )}
                      </h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {summary && <>{summary} · </>}
                        <span className="tabular-nums">{timeAgo(g.newest)}</span>
                      </p>
                    </div>
                    <span className="flex shrink-0 items-center gap-1">
                      {/* One batch button on the page, and it belongs to this
                          group. A cause group used to say "Update all"; the verb
                          is the same act, so it is the same word. */}
                      <ApproveAll cards={g.cards} approvals={approvals} />
                      {cause ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-muted-foreground"
                          onClick={() => rejectAll(g.cards)}
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
                                openChat(
                                  { id: g.session!.id, title: g.session!.title },
                                  navFromEvent(e),
                                )
                              }
                            >
                              Open session <ArrowRight className="size-3" />
                            </button>
                          )}
                        </>
                      )}
                    </span>
                  </div>
                  <CardRows
                    cards={g.cards}
                    approvals={approvals}
                    focusedId={focusedCardId}
                    onFocus={focusRow}
                    onOpen={openDoc}
                  />
                </section>
              );
            })}

            {results.length > 0 && (
              <section aria-label="While you were away">
                <h3 className="mb-1.5 px-0.5 text-sm font-semibold">While you were away</h3>
                <ul className="flex flex-col gap-2">
                  {results.map((s) => (
                    <ResultItem
                      key={s.id}
                      session={s}
                      focused={focusIndex.get(`result:${s.id}`) === focusIdx}
                      onFocus={() => focusRow(`result:${s.id}`)}
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
                </div>
                {/* One block per pass, each with the door into the session that
                    read the notes — the tidy-ups are somebody's reasoning now,
                    not a list a sweep printed, so the reasoning stays reachable. */}
                <div className="flex flex-col gap-3">
                  {librarianRuns.map((run) => (
                    <div key={run.sessionId}>
                      <div className="mb-1 flex items-baseline gap-2 px-0.5">
                        <span className="text-xs text-muted-foreground">
                          Ran {timeAgo(run.newest)}
                        </span>
                        <span className="ml-auto flex shrink-0 items-center gap-1">
                          {/* The batch sits on the run it applies to, and says
                              the same word as every other batch on the page. */}
                          <ApproveAll cards={run.cards} approvals={approvals} />
                          {run.session && (
                            <button
                              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                              onClick={(e) =>
                                openChat(
                                  { id: run.session!.id, title: run.session!.title },
                                  navFromEvent(e),
                                )
                              }
                            >
                              Open session <ArrowRight className="size-3" />
                            </button>
                          )}
                        </span>
                      </div>
                      <CardRows
                        cards={run.cards}
                        approvals={approvals}
                        focusedId={focusedCardId}
                        onFocus={focusRow}
                        onOpen={openDoc}
                        variant="compact-updates"
                        gap="row"
                      />
                      {run.questions.length > 0 && (
                        <ul className="mt-1.5 flex flex-col gap-1.5">
                          {run.questions.map((item) => (
                            <QuestionItem
                              key={item.id}
                              item={item}
                              focused={focusIndex.get(item.id) === focusIdx}
                              onFocus={() => focusRow(item.id)}
                              onOpen={() => openItemSession({ kind: 'question', item })}
                            />
                          ))}
                        </ul>
                      )}
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
