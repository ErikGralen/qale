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

## What did not change

The narration fold still decides by what follows a text part, so a text that was the answer a
moment ago still folds into the trail when a later text arrives. That jump is inherent to the
fold and was left alone.

## Code

- `apps/desktop/src/renderer/src/app/SessionView.tsx` — `SessionFoot` replaces `ReceiptBlock`;
  `flush()` emits `LandedRows` with its own trail; `blockIdx` and the parked-answer rule are gone.
- `apps/desktop/src/renderer/src/lib/receipt-block.ts` — `blockRows` deleted with the mixed
  block it described.
