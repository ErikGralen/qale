---
type: "meeting"
summary: "Fenno Energi intro — on-prem policy stated up front; unpacked to data control + audit; countered with EU region, ISO 27001, DPA"
tags: ["compliance"]
date: "2026-06-16"
time: "11:00"
duration_minutes: 45
participants: ["me", "David Strand", "Antti Korhonen"]
customer: "[[customers/fenno-energi]]"
---

## Summary
Intro call David set up. Real interest in ops dashboards for grid maintenance (~150 seats
potential), but Antti opened with their policy: operational systems run in their own data
centre. We said plainly there's no self-hosted version and asked what the policy protects
against — answer: data control and auditability. Countered with EU-only region, the audit log,
ISO 27001 and the DPA. Antti will take that to their security board without overselling it.

Fed [[insights/on-prem-asks-are-security-asks]] and [[decisions/2026-06-18-no-on-prem]].

## Transcript
Antti: I should say up front, so we don't waste an hour: our policy is that operational systems
run on our own iron. Is there a version of this we can host ourselves?

me: Short answer, no — and I don't want to pretend there's one coming. Can I ask what the
policy is actually protecting against? Because sometimes we can meet the concern even if we
can't meet the letter.

Antti: Mostly data leaving our control. Grid data is critical infrastructure, there are rules.
And auditability — if something happens, we need to show who accessed what, when.

me: On the first: everything lives in one EU region, eu-central-1, storage and backups included.
Nothing crosses out. On the second — we shipped an audit log this month, exportable, covers
logins, views, changes, admin actions.

Antti: Certifications?

me: ISO 27001, and there's a standard DPA. I can send the certificate, the subprocessor list
and the DPA today.

Antti: Send them. I can take it to the security board, but I want to be honest — the policy
exists for a reason and I won't oversell your case. If they say own-iron-only, that's the end
of it.

David: Understood. What's the board's usual turnaround?

Antti: A month if it's on the agenda. Longer in summer. It's summer.
