---
type: "decision"
summary: "Adopt WorkOS for enterprise auth (SAML SSO now, SCIM after)"
tags: ["enterprise-auth"]
status: "active"
date: "2026-05-20"
deciders: ["Tom Devlin", "me"]
sources: ["[[meetings/2026-05-18-nordkap-qbr]]"]
supersedes: "[[decisions/2026-02-10-use-firebase-auth]]"
problem: "[[problems/enterprise-onboarding]]"
---

Move enterprise auth to WorkOS: SAML SSO against customer IdPs now, SCIM on the same platform in
Q3. Evaluated building on Firebase's SAML beta versus WorkOS; WorkOS won on SCIM being the same
integration and on not owning IdP edge cases ourselves.

Forced by [[customers/nordkap-payments]]'s security review. Supersedes
[[decisions/2026-02-10-use-firebase-auth]]; Firebase fully retired as of 2026-07-07.
