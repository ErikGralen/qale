---
type: 'note'
title: 'Swap rules'
summary: 'Product rules for shift swaps: same role, same location, manager approves, no overtime'
tags: ['shift-swaps']
sources: ['[[meetings/2026-07-13-1-1-rebecca]]']
---

# Swap rules

What a swap is allowed to be, written down because the same four questions came up in every
review. This is the reference [[tickets/jira/SCH-231]] is built against.

1. **Same role.** A barista swaps with a barista. Roles are already on the shift, so this is a
   filter, not a new concept. A manager can override on approval; the app never offers it.
2. **Same location.** Cross-location swaps are out of v1. Chains staff by site, and travel time
   is not something we model.
3. **The manager approves.** Always, no exceptions, no auto-approve threshold
   ([[decisions/2026-04-08-swap-approval-by-manager]]). This was argued and settled: the manager
   is accountable for coverage and for the labour cost of the week.
4. **No overtime beyond contract.** If accepting the swap would take either person past their
   contracted hours for the week, the swap isn't offered. This turned out to be the hard rule —
   it is why [[tickets/jira/SCH-240]] needs a re-estimate.
5. **Nothing changes until approval.** The schedule the staff see stays as published while a
   request is pending. No provisional state, no half-swapped week.

Open questions, not decided:

- Who gets notified, and what they see. The request currently shows the other person's name and
  phone number, which is now a GDPR question
  ([[insights/swap-notifications-show-personal-data]], [[todos/henrik-review-swap-notifications]]).
- What happens to a swap when the manager republishes the week underneath it.
- Whether a swap can be cancelled after approval, and by whom.
