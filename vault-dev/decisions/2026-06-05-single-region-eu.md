---
type: "decision"
summary: "Run everything in a single EU region (eu-central-1)"
tags: ["compliance"]
status: "active"
date: "2026-06-05"
deciders: ["Tom Devlin"]
sources: ["[[meetings/2026-05-18-nordkap-qbr]]"]
customer: "[[customers/nordkap-payments]]"
---

All production data — storage, processing, backups — stays in eu-central-1. The simplest
arrangement that satisfies Nordkap's EU-only contract clause and pre-answers the residency
question every regulated Nordic buyer asks first.

Multi-region stays off the table until a deal actually requires it, not before.
