---
type: "meeting"
summary: "Nordkap Q2 QBR — SSO is pass/fail for the renewal, SCIM in September accepted, audit log committed for June, EU-only clause is new"
tags: ["enterprise-auth"]
date: "2026-05-18"
time: "14:00"
duration_minutes: 60
participants: ["me", "Sara Lindqvist", "Tom Devlin"]
customer: "[[customers/nordkap-payments]]"
---

## Summary
Renewal (2026-11-01) goes through their security review starting mid-August. SAML SSO is
pass/fail for that review — Sara wanted a written date, we committed to end of July. SCIM in
September accepted on the condition SSO doesn't slip; her team hand-created 60 accounts in March.
Tom committed the audit log for June in the room. New from their legal: EU-only storage *and*
processing. Heads-up that procurement wants to review the per-seat model before renewal.

Decisions that came out of this: [[decisions/2026-05-20-adopt-workos]],
[[decisions/2026-05-19-commit-audit-log-june]]. See also [[insights/nordkap-needs-scim]].

## Transcript
Sara: Before we get into usage numbers — the renewal. It goes to our security team in August,
and everyone's stricter this year after the Finaro breach. Without SAML they will not sign off.
It's a checkbox, and right now you fail it.

me: It's the top of our platform list. We're finalising the vendor decision this week —
realistically live before your review starts.

Sara: I need a date, not "realistically". I have to put something in the review pack.

me: End of July. I'll confirm it in writing this week.

Sara: Good. Second thing — provisioning. We onboarded sixty people in March and my team created
every single account by hand. Twice, actually, because the first CSV import mangled the Nordic
characters.

Tom: That's SCIM, and the honest answer is it comes after SSO. Same vendor platform, so once SSO
is in, SCIM is the next integration — September.

Sara: September works if SSO doesn't slip. If SSO moves, everything after it moves, and then
we're doing this dance during my renewal.

me: Understood. Anything else on the review checklist we should know about now rather than in
August?

Sara: Audit trail. Compliance asked in Q1 who can see what and who changed what. Today I
can't answer that.

Tom: That one's genuinely close — we can ship an audit log in June.

Sara: I'll hold you to it. And one more, this came from legal last week: all data stays in the
EU. Storage and processing both. It's going into the contract at renewal.

me: It does today as far as I know, but I don't want to wing that answer — let me confirm the
details, backups included, and come back to you.

Sara: Fine. Last thing, and don't shoot the messenger: procurement wants to "review the
commercial model" before renewal. Four hundred seats at per-seat makes a number they like to
squeeze. Nothing you need to do now, just — don't be surprised.
