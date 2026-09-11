---
type: research
summary: "No-show fees: a card at booking, charged if the guest does not turn up; committed for Q4"
tags:
  - no-show-fees
sources:
  - "[[insights/brasserie-lund-december-no-shows]]"
  - "[[meetings/2026-06-02-brasserie-lund-review]]"
title: No-show fees
---

# No-show fees

Stance: committed.

A restaurant with fees on takes a card when the guest books. If the guest does not turn up, the
restaurant charges a fee. Today the restaurant's only tool is a phone call the afternoon before,
and in December that is one table a night per restaurant lost anyway
([[insights/brasserie-lund-december-no-shows]]).

Committed and first in the H2 order ([[decisions/2026-05-14-h2-order-no-show-fees-first]]),
because December no-shows are the top complaint from chains. Roadmap says Q4. Epic is
[[tickets/jira/BOK-300]]. The spike is done ([[tickets/jira/BOK-301]]): [[tickets/jira/PAY-190]]
stores the card and gives us a token to charge later. There are no stories yet, and Rebecca
wants them before sprint planning on 2026-07-22 ([[meetings/2026-07-13-1-1-rebecca]],
[[todos/bok-300-stories-before-sprint-planning]]).

The team's working notes on what a fee may and may not do are in [[notes/fee-rules]]: one fee
per restaurant in the first release, charged the morning after, receipt by text, no fee on
bookings staff take by phone.

[[customers/brasserie-lund]] was told Q4, before the Christmas season, on 2026-06-02. Their
Christmas bookings open on 1 November.

## Open questions

- One fee per restaurant, or a different fee for lunch and dinner? Raised at the Brasserie Lund review on 2026-06-02, not decided.
- Does the fee notice go on the Google listing as well as on the booking page? Not checked with the Guest team.
