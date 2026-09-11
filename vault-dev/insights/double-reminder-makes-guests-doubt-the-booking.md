---
type: insight
summary: Guests who get the reminder text twice ring the restaurant to ask if the booking is wrong
tags:
  - reminders
evidence:
  - "[[meetings/2026-07-06-support-sync]]"
  - "[[customers/sjogatan]]"
  - "[[customers/pizzeria-napoli]]"
confidence: high
---

A second reminder text does not read as a reminder. It reads as a second booking, or as a sign
that something has gone wrong with the first one. Guests ring the restaurant to ask, and some
cancel to be safe. The restaurant takes those calls during service.

Two accounts have said the same thing in the same words. Sjögatan reported it through support
on 2026-06-24 and Pizzeria Napoli on 2026-06-26 ([[customers/sjogatan]],
[[customers/pizzeria-napoli]]). Jonas had four tickets by the support sync on 2026-07-06, all
from guests who booked through Google ([[meetings/2026-07-06-support-sync]],
[[tickets/jira/BOK-412]]).

This is the reason the one-reminder rule exists ([[decisions/2026-04-02-one-reminder-day-before]]).
The bug broke the rule for one booking source, and the guests reacted the way the March test
said they would.

High confidence: two accounts, four tickets, one cause. What is not known is how many guests
cancelled rather than rang.
