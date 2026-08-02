---
type: source
summary: Verbatim transcript of the Bergman & Falk security review kickoff. Six-week process, SSO required, evidence list
processing: processed
source:
  system: transcript
captured: 2026-07-02
customer: "[[customers/bergman-falk]]"
meeting: "[[meetings/2026-07-02-bergman-falk-security-review]]"
---

Elin: Process first, so nobody's guessing. You'll get our questionnaire this week. We collect
evidence, then it goes to the review board. Six weeks if nothing surprising turns up.
Surprises add weeks.

David: Is there anything that's an automatic no, so we know now rather than in six weeks?

Elin: No SSO would be. Partner and staff logins go through our identity provider and there's no
exception for a firm-wide rollout. Where are you on that?

me: SAML SSO ships July 28th. Our first enterprise tenant goes live that day, so you'd be early
but not first. I can confirm in writing once it's live.

Elin: Do that. It fits the window, only just. Next, where is data stored and who are your
subprocessors?

me: Single EU region, eu-central-1, backups included. The subprocessor list is short and I'll
send it with the questionnaire. The two that matter are the cloud provider and the auth vendor.

Elin: When was your last penetration test?

me: March, external firm. I'll include the summary. We can share the full report under NDA if
the board wants it.

Elin: The summary is usually enough. One more thing, deployment model. Some of our partners
will ask why this isn't running on our infrastructure. I need your answer on file even if the
answer is no plus a compensating control.

me: That is roughly the answer, and I'll write it up properly. No self-hosting, and the
compensating controls are the EU region, the audit log and ISO 27001.
