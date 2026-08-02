---
type: "decision"
summary: "Adopt WorkOS for enterprise auth: SAML SSO now, SCIM after"
tags: ["enterprise-auth"]
standing: "active"
date: "2026-05-20"
deciders: ["Tom Devlin", "me"]
sources: ["[[meetings/2026-05-18-nordkap-qbr]]"]
supersedes: "[[decisions/2026-02-10-use-firebase-auth]]"
theme: "[[themes/enterprise-onboarding]]"
---

Enterprise auth moves to WorkOS. SAML SSO against customer IdPs now, SCIM on the same platform
in Q3. Tom compared it against building on Firebase's SAML beta. WorkOS won on two things:
SCIM is the same integration rather than a second project, and we don't end up owning IdP edge
cases ourselves.

Forced by [[customers/nordkap-payments]]'s security review. Supersedes
[[decisions/2026-02-10-use-firebase-auth]]. Firebase was fully retired on 2026-07-07.
