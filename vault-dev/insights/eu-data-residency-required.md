---
type: 'insight'
summary: 'EU-only storage and processing is a contract term for Nordkap, and the first thing regulated buyers ask about'
tags: ['compliance']
evidence:
  [
    '[[meetings/2026-05-18-nordkap-qbr]]',
    '[[meetings/2026-07-10-internal-auth-review]]',
    '[[meetings/2026-07-02-bergman-falk-security-review]]',
  ]
confidence: 'med'
customer: '[[customers/nordkap-payments]]'
theme: '[[themes/enterprise-onboarding]]'
---

Nordkap's legal team is putting an EU-only clause into the renewal. Sara brought it to the QBR
straight from legal and was specific about the scope: "Storage and processing both." We're
fine on that. Everything runs in eu-central-1, backups included
([[decisions/2026-06-05-single-region-eu]]); Tom confirmed the backup part on 2026-07-10, "as
of last month the backups too", which was the piece nobody was sure about.

Elin got there early as well. Her third question at the review kickoff was "where is data
stored", ahead of the pen test and the deployment model. Assume it comes up in every
regulated-industry deal from here on.
