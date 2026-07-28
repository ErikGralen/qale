---
type: source
summary: Verbatim transcript of the Fenno Energi intro — on-prem policy unpacked to data control + audit, countered with EU region and certifications
status: processed
source:
  system: transcript
captured: 2026-06-16
customer: "[[customers/fenno-energi]]"
meeting: "[[meetings/2026-06-16-fenno-energi-intro]]"
---

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
