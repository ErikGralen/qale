---
type: 'decision'
summary: 'Run everything in a single EU region (eu-central-1)'
tags: ['compliance']
standing: 'active'
date: '2026-06-05'
deciders: ['Tom Devlin']
sources: ['[[meetings/2026-05-18-nordkap-qbr]]']
customer: '[[customers/nordkap-payments]]'
---

All production data stays in eu-central-1: storage, processing and backups. It's the simplest
arrangement that satisfies Nordkap's EU-only contract clause, and it means we have an answer
ready for the residency question every regulated Nordic buyer asks in the first ten minutes.

Multi-region stays off the table until a deal actually requires it.
