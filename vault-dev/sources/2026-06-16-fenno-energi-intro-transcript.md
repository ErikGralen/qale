---
type: source
summary: Verbatim transcript of the Fenno Energi intro. On-prem policy unpacked to data control and audit, countered with EU region and certifications
processing: processed
source:
  system: transcript
captured: 2026-06-16
customer: '[[customers/fenno-energi]]'
meeting: '[[meetings/2026-06-16-fenno-energi-intro]]'
---

Antti: I should say this up front so we don't waste an hour. Our policy is that operational
systems run on our own iron. Is there a version of this we can host ourselves?

me: Short answer, no, and I don't want to pretend one is coming. Can I ask what the policy is
protecting against? Sometimes we can meet the concern even when we can't meet the letter of it.

Antti: Mostly data leaving our control. Grid data is critical infrastructure, there are rules
about it. And auditability. If something happens we have to show who accessed what, and when.

me: On the first one, everything lives in one EU region, eu-central-1, storage and backups
included. Nothing crosses out of it. On the second, we shipped an audit log this month. It's
exportable and it covers logins, views, changes, admin actions.

Antti: Certifications?

me: ISO 27001, and there's a standard DPA. I can send you the certificate, the subprocessor
list and the DPA today.

Antti: Send them. I'll take it to the security board. I want to be honest with you though, the
policy exists for a reason and I'm not going to oversell your case. If they say own iron only,
that's the end of it.

David: Understood. What's the board's usual turnaround?

Antti: A month if it gets on the agenda. Longer in summer. And it's summer.
