---
type: 'decision'
summary: 'Fortnox is the first payroll connector; Visma follows in Q4'
tags: ['payroll-export']
standing: 'active'
date: '2026-05-20'
deciders: ['Rebecca Holm', 'me']
sources: []
theme: '[[themes/payroll-export]]'
---

Payroll export ships as a CSV of approved hours plus one real connector, and the first connector
is Fortnox. Roughly two thirds of our chains do their bookkeeping there, the API is documented,
and the payload maps onto what we already store.

Visma is second. It is the bigger system and the one [[customers/fjord-sports]] runs, but the
integration is heavier and it needs the token store on [[tickets/jira/PLT-77]] to be finished
before anyone can start. Rebecca did not want both connectors in the same quarter and I agree.

Practically this means Fortnox in Q3 alongside the CSV export
([[tickets/jira/SCH-121]], [[tickets/jira/SCH-125]]) and Visma in Q4. Fjord Sports have been told
Q4, which holds as long as PLT-77 lands. That dependency is the thing I keep an eye on.
