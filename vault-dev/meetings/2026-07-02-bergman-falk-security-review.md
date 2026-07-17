---
type: "meeting"
summary: "Bergman & Falk security review kickoff — six-week process, SSO is an automatic requirement, we owe questionnaire + evidence"
tags: ["compliance"]
date: "2026-07-02"
time: "13:30"
duration_minutes: 60
participants: ["me", "David Strand", "Elin Vestergaard"]
customer: "[[customers/bergman-falk]]"
---

## Summary
Kickoff of their vendor security review, which gates the whole ~250-seat deal. Process:
questionnaire → evidence collection → review board; six weeks if nothing surprising. No SSO is
an automatic no for firm-wide rollout — our 2026-07-28 date lands inside their window. Her
first questions: data residency, subprocessors, last pen test. We owed the questionnaire, ISO
27001 cert, subprocessor list and pen-test summary — sent 2026-07-06.

Fed [[insights/security-reviews-run-six-weeks]] and [[insights/enterprise-buyers-gate-on-sso]].

## Transcript
Elin: Process first, so expectations are right. You'll receive our questionnaire this week. We
collect evidence, then it goes to the review board. Six weeks, if nothing surprising turns up.
Surprises add weeks.

David: Is there anything that's an automatic no, so we know now?

Elin: No SSO would be. Partner and staff logins go through our identity provider, no exceptions
for a firm-wide rollout. Where are you on that?

me: SAML SSO ships July 28th. First enterprise tenant goes live that day; you'd be early but
not first. I can confirm in writing when it's live.

Elin: Do that. It fits the window — barely. Next: where is data stored, and who are your
subprocessors?

me: Single EU region, eu-central-1, including backups. Subprocessor list is short and I'll send
it with the questionnaire — the notable ones are the cloud provider and the auth vendor.

Elin: Last penetration test?

me: March, external firm. I'll include the summary; the full report we share under NDA if the
board wants it.

Elin: The summary usually suffices. One more — deployment model. Some of our partners will ask
why this isn't on our infrastructure. I need your answer on file, even if it's just "no, and
here's the compensating control".

me: That's essentially our answer, and I'll write it up properly: no self-hosting, compensated
by the EU region, the audit log, and ISO 27001.
