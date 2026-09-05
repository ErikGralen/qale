# The closing beat

When work ends, the app goes mute. Two places fizzle:

1. The PO judges the last card in a chat. `SessionReview` returns null and the
   cards vanish without a trace (SessionReview.tsx:27).
2. The PO clears the Inbox. The empty state shows a checkmark and a paragraph
   that explains what the Inbox is, even to a PO who has used it for weeks
   (InboxView.tsx:374).

The fix is one pattern in both places. A closing beat has three parts, in
order:

1. **The receipt.** What the PO just did: "Approved 2".
2. **The consequences.** What that set in motion, with links: "Updated
   [Pricing theme] · Left your workspace: comment on PAY-142".
3. **One door onward.** It points to the nearest place with work, and it skips
   empty rooms. Chat points to Sessions only if another session still has
   cards. Sessions points to Home.

Sessions says "you're done". Chat hands off to it.

Home used to close its own waiting list with a "Where things stand" strip.
That list is gone: the sidebar already shows what is waiting, so Home no
longer keeps a second copy to close.

Separate the moment from the state. "You just cleared it" is a moment and gets
the receipt. "It is empty" is a state and stays near silent. The current
empty-queue message conflates them.

Never: suggested tasks, celebration animation, streaks, counts of past
productivity. Every line is a fact the workspace already holds.

## 1. Chat: the resolved-cards receipt

Where: `SessionReview` (components/inbox/SessionReview.tsx). Today it renders
pending cards or nothing. New: when the session has resolved proposals, it
renders a receipt block in their place, so judging the last card leaves a
trace instead of a blank.

The receipt must survive a reopen. The PO comes back to a session next week
and still sees what it changed. So it derives from stored resolved proposals,
not from hook state:

- The renderer only loads pending proposals today
  (`invoke['proposals:list']('pending')`, app-state.tsx:1334). Add a way to
  read a session's resolved proposals from main (extend `proposals:list` or
  add a scoped query). Accepted and rejected both count.
- Per accepted card, the line needs: a verb from the proposal kind (Created /
  Updated / Decided / Sent), the target note's title as a link
  (`targetPath` + `openDoc`), and for outbound the `outboundReceipt` sentence.

Layout, in the spot the cards vacated:

> **Approved 2, discarded 1**
> Updated [Pricing theme] · Created [Meeting note 12 Aug]
> Left your workspace: comment on PAY-142

Then the door, one line, only when there is somewhere to go:

- Other sessions' cards still pending: "3 more waiting in Sessions" → opens
  Sessions. Count with `waitingOnYou`/`countOf` over the attention list, minus
  this session's own cards. Never a fresh arithmetic.
- Nothing pending anywhere: no door. The receipt is the ending.

A session that shipped no proposals gets no receipt block. Do not fake a
landing.

## 2. Inbox: the burst receipt and the quiet state

Where: InboxView.tsx:374-389.

The moment (this sitting judged at least one card, `receipt.accepted +
receipt.rejected > 0`):

> **You cleared it.**
> 3 accepted · 1 dismissed.
> Updated [Pricing theme] · Created [Meeting note 12 Aug]
> Left your workspace: comment on PAY-142
>
> [See where things stand → Home]

- The consequence lines reuse the same rendering as the chat receipt. Record
  what each accepted card touched in `useApprovals` (id, verb, target title,
  path) next to the existing `sent` array, so the Inbox does not need the
  resolved-proposals query. Cap the list at the last 5, oldest dropped.
- Promote `SentReceipts` into this block; it stops being a separate banner
  above an unrelated checkmark.
- One door: Home. Use the app's Home navigation.

The state (Inbox is empty, nothing judged this sitting):

> **Nothing needs you.**

One line. The explainer paragraph ("Proposals, finished sessions, and the
librarian's tidy-ups land here...") shows only while the PO has never judged a
card. Persist a per-vault flag in localStorage the first time an accept or
reject lands (same pattern as `REVIEW_ASK_KEY` in approvals.tsx:292). After
that the explainer never returns.

Keep the checkmark art or drop it; do not add anything new to the quiet state.

## Order of work

The Inbox first (it is where the other door points), then the chat receipt.

## Verification

Unit tests beside the existing attention/approvals tests: the Inbox
moment-vs-state branch, the chat receipt's verb mapping and door count. Run
the full desktop test suite. All copy follows CLAUDE.md: STE + Zinsser, no
em dashes.
