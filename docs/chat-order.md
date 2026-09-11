# Chat order: everything where it happened

Date: 2026-09-09. Status: BUILT, 1632 tests green (12 pre-existing skips in `@qale/vault`),
screenshot-verified on a stored librarian session, not committed.

Trigger: Erik, on the session view. "The order stuff appears in chat is a bit wonky, stuff
spawns above and below each other. The order should be better, and should follow the order they
appear in chronological order."

## What was wrong

Five things drew somewhere other than where they happened.

1. **The three parking cards drew in two places.** An `ask_user` question drew inside the last
   turn, spliced above its closing sentences. A `spawn` or `ask_codebase` approval drew under
   the whole transcript. Same class of card, same job (the run stops until you answer), two
   spots. The comment over the fan-out card even claimed it sat above the proposal cards. It
   sat below them.
2. **Proposal cards moved to whichever turn was newest.** `SessionReview` draws every pending
   card for the session, and it hung off the last assistant message. Cards made in turn 1 slid
   down under turn 3 as soon as the PM asked a follow-up.
3. **Things inserted above text already on screen.** The receipt block was spliced in just
   before the answer, and it carried the whole turn's writes. A card or a write that arrived
   after the paragraph streamed appeared above it.
4. **A streamed answer could vanish.** A text followed by `ask_user` / `spawn` / `ask_codebase`
   was reclassified as narration and folded into the collapsed trail. The PM watched a
   paragraph arrive and then disappear.
5. **The pile receipt landed at the bottom.** "Read 9 files" sums a drop from the top of the
   session; it drew under the newest turn, below the error row.

## Decisions

**A turn draws in part order, and only its own things.** The folded work trail, the draft
panels, the handovers, the answer, and the rows for what the turn wrote. A write flushes with
the work that made it rather than being gathered at the answer, so nothing lands above a
paragraph that is already there. Inside one flush the rows keep the sphere order from
`orderLanded` (docs/receipt-redesign.md RC-1): that reorders a handful of rows inside one block
and nothing on screen moves.

**Everything that belongs to the session draws in one block at the foot.** `SessionFoot` in
`SessionView.tsx`, in a fixed order: the question, the fan-out, the codebase read (only one is
ever up), then what a pile came to, then the waiting cards and the approval receipt. Erik chose
one gathered block over anchoring each card to its turn, so the batch keeps one heading, one
Approve all, and one keyboard cursor over the whole set.

**A sentence that leads into a card keeps its spot.** "Let me check with you first" stays the
answer and draws above the card, because the card is at the foot now and no longer needs the
space.

## The narration fold is gone (2026-09-11)

**Every text the assistant writes draws as prose, where it wrote it, and stays there.** The
folded trail holds the thinking and the tool steps. Nothing else goes in it.

Erik, on the fold: a paragraph the PM has read must not move. The old rule picked the last text
in a turn as the answer and called every earlier text narration. So the PM watched a paragraph
arrive, the turn carried on, a second text landed, and the paragraph they had just read jumped
into the collapsed trail. Any rule that decides by what follows a text has that jump in it, so
the fold was dropped rather than narrowed. A chatty "Let me read the check-in" now costs one
quiet line in the transcript. That is cheaper than a paragraph that moves.

The reading depends only on the parts so far, never on what comes after. A block on screen keeps
its kind and its place as the rest of the turn arrives, so the streamed transcript and the
replayed one draw the same thing. A text part with nothing in it yet draws nothing, because it
has not been read.

A sentence that leads into a card still keeps its spot, for the same reason it did before: the
card is at the foot.

## Code

- `apps/desktop/src/renderer/src/app/SessionView.tsx` — `SessionFoot` replaces `ReceiptBlock`;
  each trail block emits its own `LandedRows`; `blockIdx`, the parked-answer rule and `answerIdx`
  are gone.
- `apps/desktop/src/renderer/src/lib/turn-parts.ts` — `turnBlocks()` reads a turn's parts into
  the blocks the chat draws. Tested in `apps/desktop/test/turn-parts.test.ts`.
- `apps/desktop/src/renderer/src/lib/receipt-block.ts` — `blockRows` deleted with the mixed
  block it described.
