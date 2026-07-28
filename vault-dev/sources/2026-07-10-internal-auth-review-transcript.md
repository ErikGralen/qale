---
type: source
summary: Verbatim transcript of the internal auth review with Tom — SAML staging done, prod 07-28 behind flag, Firebase retired, eu-central-1 incl. backups
status: processed
source:
  system: transcript
captured: 2026-07-10
meeting: "[[meetings/2026-07-10-internal-auth-review]]"
---

Tom: Staging's done. SAML works against Okta and Entra — session handling took longer than I
wanted, the logout flows are fiddly, but it's solid now.

me: Still good for the 28th?

Tom: Yes. Behind a flag, and I want Nordkap as the first tenant — Sara's team is responsive and
they run Entra, which we've tested hardest. If their rollout is clean we open it up in August.

me: I'm seeing Sara Tuesday, I'll give her the date. Firebase?

Tom: Gone. Removed the last dependency on Tuesday. Feels good, honestly.

me: And for Sara's legal people — the residency question. Storage and processing?

Tom: Everything is eu-central-1. Compute, data, and as of last month backups too, that was the
missing piece. You can put it in writing.

me: SCIM — when does scoping start?

Tom: August, once the rollout settles. Don't let anyone promise a specific September date yet —
"September" is fine, a date isn't, not until I've scoped the directory-sync edge cases.
