import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@qale/ui';
import type { ProposalDTO } from '@qale/ipc';
import { useApp } from '../../state/app-state';
import { invoke } from '../../lib/ipc';
import {
  batchCount,
  batchSource,
  causeSentence,
  groupCause,
  cardGroups,
  orderCards,
  receiptOf,
  receiptPaths,
} from './cardMeta';
import { useNoteName, useNoteNames } from './titles';
import { ReviewAsks, SentReceipts, useApprovals } from './approvals';
import { ApproveAll, CardRows } from './CardRows';
import { LandedRows } from './LandedRows';

/** The cards in the order they draw in: every card is one row, and a group of
 *  two changes to one page is two stops under one name. The cursor walks what
 *  the reader sees, so grouping never hides a card from it. */
function rowsOf(cards: ProposalDTO[]): ProposalDTO[] {
  return cardGroups(cards).flatMap((g) => g.cards);
}

/**
 * The batch's one source, as an openable chip with the page's real name. Nine
 * cards from one transcript said "from Steering H2 Priorities" nine times, in a
 * prettified filename that was not even the page's title.
 */
function SourceChip({ ref: source, onOpen }: { ref: string; onOpen: (path: string) => void }) {
  const known = useNoteName(source);
  if (!known) return null;
  return (
    <>
      {' from '}
      <button
        className="rounded-md text-brand underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={() => onOpen(known.path)}
        title={`Open ${known.title}`}
      >
        {known.title}
      </button>
    </>
  );
}

/**
 * The in-session review: the cards a session just proposed, judged right where
 * they were produced. The PO just had the meeting, so they can rip through the
 * changes without a context hop.
 *
 * This is the one place a card is judged. It carries the whole sitting: the
 * rows, the batch button, the keyboard pass over them, the question a fully
 * discarded pile leaves behind, and the banner for what left the workspace.
 *
 * Once every card is judged, the block does not vanish. What was approved stays
 * as the same small lines a silent write leaves, built from the stored cards
 * rather than from this sitting's state, so it is still there next week
 * (docs/closing-beat.md, thinned in docs/receipt-redesign.md).
 */
export function SessionReview({ sessionId }: { sessionId: string }) {
  const { proposals, openDoc } = useApp();
  const approvals = useApprovals();
  // Where the roving cursor sits, by position. -1 is "nowhere yet": the block
  // sits under a composer the PO is probably typing in, so it paints no ring
  // and takes no focus until they walk into it.
  const [focusIdx, setFocusIdx] = useState(-1);
  const [resolved, setResolved] = useState<ProposalDTO[]>([]);
  const listRef = useRef<HTMLElement>(null);

  const cards = useMemo(
    () => orderCards(proposals.filter((p) => p.status === 'pending' && p.sessionId === sessionId)),
    [proposals, sessionId],
  );

  const rows = useMemo(() => rowsOf(cards), [cards]);

  // A judged row leaves the list under the cursor. Clamp rather than let the
  // cursor point past the end, so the next key still acts on a real row.
  useEffect(() => {
    setFocusIdx((i) => (i < 0 ? i : Math.min(i, rows.length - 1)));
  }, [rows.length]);

  /** Where each row sits, by its card's id: the cursor's only map. */
  const focusIndex = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((row, i) => m.set(row.id, i));
    return m;
  }, [rows]);

  const focusRow = useCallback(
    (id: string) => {
      const idx = focusIndex.get(id);
      if (idx !== undefined) setFocusIdx(idx);
    },
    [focusIndex],
  );

  const current = focusIdx >= 0 ? (rows[focusIdx] ?? null) : null;
  const focusedId = current?.id ?? null;

  /** The focused outbound card's send button. ↵ moves to it instead of pressing
   *  it for you. */
  const focusSend = (id: string): void => {
    listRef.current?.querySelector<HTMLButtonElement>(`[data-send="${CSS.escape(id)}"]`)?.focus();
  };

  // Full keyboard path over this session's rows: walk them, approve, discard,
  // no mouse. There is no "open" key: the session is already open.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable) return;
    // A control the PO deliberately landed on owns its own keys: ↵ must reach
    // the button, not be swallowed by the shortcut for the same row. Arrows
    // still steer, and moving the cursor takes focus back off the control.
    const onControl = t.closest('button, a, [role="button"]') !== null;
    const move = (to: number) => {
      if (rows.length === 0) return;
      setFocusIdx(Math.max(0, Math.min(to, rows.length - 1)));
    };
    if (e.key === 'ArrowDown' || (e.key === 'j' && !onControl)) {
      e.preventDefault();
      move(focusIdx + 1);
    } else if (e.key === 'ArrowUp' || (e.key === 'k' && !onControl)) {
      e.preventDefault();
      move(focusIdx <= 0 ? 0 : focusIdx - 1);
    } else if (onControl) {
      return;
    } else if ((e.key === 'Enter' || e.key === 'a') && current && !approvals.busy) {
      e.preventDefault();
      // A send leaves the workspace, so the one-tap approve never fires one:
      // the same rule the batch path keeps. ↵ carries you to the send control,
      // and pressing it there is the decision. Everything internal stays one
      // tap.
      if (current.kind === 'outbound') focusSend(current.id);
      else approvals.accept(current);
    } else if ((e.key === 'Backspace' || e.key === 'x') && current && !approvals.busy) {
      e.preventDefault();
      approvals.reject(current);
    }
  };

  // Re-read whenever the pending queue moves: the card that just left it is the
  // one the receipt now has to name.
  useEffect(() => {
    let live = true;
    void invoke['proposals:resolved'](sessionId)
      .then((stored) => live && setResolved(stored))
      .catch(() => live && setResolved([]));
    return () => {
      live = false;
    };
  }, [sessionId, proposals]);

  // The pages the receipt names, by the name the workspace holds for them: a
  // path de-slugged is not what the page calls itself (RR-3).
  const names = useNoteNames(useMemo(() => receiptPaths(resolved), [resolved]));
  const receipt = useMemo(
    () => receiptOf(resolved, (path) => names.get(path)?.title ?? null),
    [resolved, names],
  );

  if (cards.length === 0) {
    // A session that never proposed anything, or whose cards were all
    // discarded, gets no receipt: nothing changed, and a block would invent
    // something. The review ask is the exception: a pile discarded down to zero
    // leaves that question behind, and this is the spot its cards just vacated.
    if (receipt.rows.length === 0 && approvals.reviewAsks.length === 0) return null;
    return (
      <section aria-label="What you approved" className="mt-1">
        <ReviewAsks approvals={approvals} />
        {/* An approved card is a landed write, so it draws as one: the same
            line, the same way back (RC-3). No tally over it and no door to
            other sessions: the lines are the count, and what waits elsewhere
            is Home's job. */}
        <LandedRows rows={receipt.rows} sessionId={sessionId} onOpen={openDoc} label={null} />
      </section>
    );
  }

  // A sweep after a decision change: every card is an update citing the one
  // decision. The head says the cause, so the PO judges the premise once
  // instead of reading the same edit N times.
  const cause = groupCause(cards);
  // One count for one list. A send is its own decision and never rides along in
  // the batch, so the heading says how many of each are waiting rather than
  // leaving "9 changes" to explain a button that says 7.
  const sends = cards.filter((c) => c.kind === 'outbound').length;
  const heading = cause
    ? causeSentence(cause, cards.length)
    : batchCount(cards.length - sends, sends);
  // The one source the whole batch came from, said once in the heading. When
  // they came from several, or when there is no heading because one card needs
  // no announcement, each row names its own behind its chevron.
  const source = cause || cards.length < 2 ? null : batchSource(cards);

  return (
    /* A heading over the cards, not a container around them. Each card already
       carries its own surface, so wrapping the set in a second one boxed a box
       and pushed the change three frames deep before a word of it showed.

       `data-queue` marks the region the roving cursor lives in: rows take real
       focus while it holds focus, and never steal it from outside. It is
       tabbable but never focused on mount, so arriving here does not pull the
       caret out of the composer. */
    <section
      ref={listRef}
      data-queue
      tabIndex={0}
      aria-label={heading}
      className="mt-1 outline-none"
      onKeyDown={onKeyDown}
    >
      {/* A send that just left needs its own banner while cards remain. Once
          the last one is judged the receipt above says it, in the same words,
          with everything else the sitting did. */}
      <SentReceipts sent={approvals.sent} />
      <ReviewAsks approvals={approvals} />

      {cause ? (
        /* Title flexes and wraps, actions shrink-0 and stay reachable. */
        <div className="mb-2 flex items-start gap-3 px-0.5">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm leading-snug font-semibold text-balance break-words text-foreground">
              {heading}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Approve to update them all, or discard if the premise is wrong.
            </p>
          </div>
          <span className="flex shrink-0 items-center gap-1">
            <ApproveAll cards={cards} approvals={approvals} />
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => approvals.rejectAll(cards)}
              disabled={approvals.busy}
            >
              Discard all
            </Button>
          </span>
        </div>
      ) : (
        // One card needs no announcement: the card says what it is. The count
        // and the batch button earn a header row only on a pile.
        cards.length > 1 && (
          <div className="mb-1.5 flex items-center gap-3 px-0.5">
            <h3 className="min-w-0 flex-1 text-sm font-semibold text-foreground">
              {heading}
              {source && <SourceChip ref={source} onOpen={openDoc} />}
            </h3>
            <ApproveAll cards={cards} approvals={approvals} className="shrink-0" />
          </div>
        )
      )}
      <CardRows
        cards={cards}
        approvals={approvals}
        focusedId={focusedId}
        onFocus={focusRow}
        onOpen={openDoc}
        showSource={!source}
      />
    </section>
  );
}
