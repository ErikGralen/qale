---
type: source
summary: Verbatim transcript of the internal auth review with Tom. SAML staging done, prod 07-28 behind a flag, Firebase retired, eu-central-1 including backups
processing: processed
source:
  system: transcript
captured: 2026-07-10
meeting: '[[meetings/2026-07-10-internal-auth-review]]'
---

Tom: Staging's done. SAML works against Okta and Entra. Session handling took longer than I
wanted, the logout flows are fiddly, but it's solid now.

me: Still good for the 28th?

Tom: Yes. Behind a flag. And I want Nordkap as the first tenant, because Sara's team actually
answer email and they're on Entra, which is what we've tested hardest. If their rollout is
clean we open it up in August.

me: I'm seeing Sara Tuesday, I'll give her the date then. Firebase?

Tom: Gone. Last dependency came out Tuesday.

me: And for Sara's legal people, the residency question. Storage and processing?

Tom: All eu-central-1. Compute, data, and as of last month the backups too, which was the
missing piece. You can put that in writing.

me: Same review pack, the audit log we shipped in June. Can a customer get the entries out?

Tom: Out of the UI, no. You can read it and filter it, and that's where it stops. No export,
no API. If their compliance people want it in their own system we've got nothing for them.

me: That is the first thing Sara's auditors will ask for in August, so it needs a ticket now.
I'll file the export gap today and point it at these notes.

Tom: Do. It's about a day of work, it has just never been the day.

me: SCIM. When does scoping start?

Tom: August, once the rollout settles. And don't let anyone promise a specific September date
yet. "September" is fine. A date isn't, not until I've scoped the directory-sync edge cases.
