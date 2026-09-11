---
type: 'person'
title: 'Henrik Dahl'
summary: 'Henrik Dahl: Tech lead on Payments, owns the deposits work that group bookings waits on'
tags: ['payments', 'group-bookings']
role: 'Tech lead, Payments'
email: 'henrik.dahl@bord.example'
cares_about: ['the refund path', 'dates he can keep', 'being asked before a date is promised']
last_told: '2026-07-09'
---

Tech lead on Payments. Two of his tickets matter to my teams. [[tickets/jira/PAY-190]] stores a
card for a later charge; it is done (2026-06-30) and no-show fees builds on it.
[[tickets/jira/PAY-210]] is deposits: charge at booking, refund on cancellation. It is planned
for Q4 and group bookings waits on it ([[decisions/2026-06-18-group-bookings-after-deposits]]).

He gives a date when he has one and not before. At steering on 2026-07-09 I asked for a date
on PAY-210 and he did not give one: design has started, and the refund path depends on the
acquirer ([[meetings/2026-07-09-steering]]). That is the open item I am waiting on
([[todos/ask-henrik-for-pay-210-date]]).

Until he names a quarter with a month in it, "Q1 2027" for group bookings is the only date
sales can use.

Last told 2026-07-09: group bookings is Q1 2027 behind PAY-210, and no-show fees charges
through PAY-190.
