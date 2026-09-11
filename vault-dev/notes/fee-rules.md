---
type: note
title: Fee rules
summary: 'The team''s working notes on what a no-show fee may and may not do in the first release'
tags:
  - no-show-fees
sources:
  - '[[meetings/2026-06-02-brasserie-lund-review]]'
  - '[[research/no-show-fees]]'
---

# Fee rules

What a no-show fee may and may not do in the first release. Working notes, not decided. This
is what the [[tickets/jira/BOK-300]] stories are written against.

1. **One fee per restaurant.** The restaurant sets one amount per guest. Not per table, not per
   sitting. Lena asked for a different fee for lunch and dinner on 2026-06-02; parked
   ([[meetings/2026-06-02-brasserie-lund-review]]).
2. **A card at booking.** When fees are on, the booking page asks for a card before it
   confirms. The card is stored through [[tickets/jira/PAY-190]]. The confirmation says a fee
   applies and how much.
3. **Charged the morning after.** The restaurant marks the booking as a no-show from the
   booking list. The charge runs the next morning, not on the spot, so a manager can undo a
   mistake the same evening.
4. **Receipt by text.** The guest gets a text with the amount and the restaurant's name.
5. **No fee on bookings staff take by phone.** The guest never saw the notice, so there is
   nothing to charge. Online and Google bookings only.

Open, not decided:

- Whether a restaurant can set a different fee for lunch and dinner
  ([[research/no-show-fees]]).
- What happens when the card fails the morning after. Retry once, then tell the restaurant?
- Whether the wording of the fee notice changes how many guests finish the booking. A test on
  a few restaurants first, before every restaurant gets it.
