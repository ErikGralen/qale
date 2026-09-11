---
type: decision
summary: One SMS reminder per booking, the day before at 17:00 local; no second text
tags:
  - reminders
standing: active
date: 2026-04-02
deciders:
  - Åsa Lindgren
  - me
sources:
  - "[[wikipages/confluence/changelog]]"
---

Every booking gets one reminder text, the day before at 17:00 local time. Not one on booking and
one the day before, not one the morning of. One.

We tried two texts on a handful of restaurants in March. Guests read the second one as spam, or
as a sign that something had gone wrong with the booking, and cancellations went up on the
restaurants with two texts. A reminder is supposed to bring the guest in, not give them a reason
to ring and check.

17:00 the day before is when a guest is most likely to be planning the next evening and least
likely to be at work. A restaurant cannot change the time in the first version; if that comes
back as a real ask from a chain, it is a setting, not a second text.

This is the rule the double-reminder bug breaks ([[tickets/jira/BOK-412]]): a booking that
comes through Google was getting the text from two records.
