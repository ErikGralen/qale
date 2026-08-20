---
type: 'decision'
summary: 'Use Firebase Auth for authentication'
tags: ['enterprise-auth']
standing: 'superseded'
date: '2026-02-10'
deciders: ['Tom Devlin']
sources: []
superseded_by: '[[decisions/2026-05-20-adopt-workos]]'
theme: '[[themes/enterprise-onboarding]]'
---

Chose Firebase Auth so we could ship email and Google login in a week instead of a month. We
knew what we were giving up: no SAML and no SCIM. That was fine while every customer was under
100 seats.

It stopped being fine at the Nordkap QBR. Replaced by [[decisions/2026-05-20-adopt-workos]].
