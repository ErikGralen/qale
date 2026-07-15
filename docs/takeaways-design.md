# Takeaways from `/design` — the Product Brain thinking, distilled

_Intermediate vision doc, 2026-07-14. Four independent "Cursor for PMs" design drafts (1–4.md). They agree on far more than they differ; the agreements below are treated as settled for the product concept, with each doc's unique contribution noted._

---

## Where all four designs converge (settled)

1. **Cursor won because the repo already existed. PMs have no repo — so build the repo first.** Product truth is smeared across Jira/Slack/Confluence/heads; the substrate must be *derived* (assembles itself from connectors + transcripts), never a data-entry chore.
2. **Verification is the expensive half of PM work.** Generic AI converts writing work into auditing work at a bad exchange rate. Therefore: **provenance at sentence granularity** — every generated claim is cited to a source span or visibly marked as inference — enforced in the write path/tool contract, not by prompt.
3. **The PM is a professional reviewer, not a prompter.** The interface primitive is review (tracked changes / approval cards), never the prompt. "A blank chat box is a CLI in a dress."
4. **Suggestions are the universal write primitive.** Agents never mutate anything directly; every change arrives as a diff + a one-line *because* + receipts. Home is an **Inbox of judgment calls**, not a dashboard.
5. **Autonomy scales with reversibility.** Read/index/flag freely; suggest by default for all writes; auto-apply per workflow only after earned track record (internal only); **outbound to humans is draft-and-approve forever.**
6. **Decisions are first-class, versioned objects** — the spine of the memory. Nothing is deleted, only superseded; "why is it like this?" becomes a lookup, not archaeology.
7. **Artifacts are projections of state, not primary documents.** Live sections carry freshness/health; when reality moves, the artifact grows a *suggestion*, never a silent edit. Audience views (exec/eng/sales/customer) render from the same truth.
8. **The brain is literally a git-backed repo of typed markdown/YAML** — diffs, history, blame, branches, portability for free; the GUI is a rendering layer. (This is what makes the OpenKnowledge substrate the right body.)
9. **Cold start via bootstrap:** connect 2–3 sources read-only → a "First Brief"/draft brain within a session → the PM's first act is *correcting*, which is onboarding, calibration, and the wow moment in one. People are dramatically better editors than authors.
10. **Wedge = the loop that builds the brain as a byproduct** — decision log + status/updates/ask-with-receipts — single-player, weekly cadence, visibly compounding. Matches the /combined W2→W1 conclusion exactly.
11. **Non-goals:** not a Jira/Notion replacement, no autonomous outbound ever, not a generic AI workspace. "If a feature neither reads from nor writes to the core objects, it doesn't ship."

## 1.md — "A Cursor for PMs" (the surfaces)

- Cleanest decomposition of why Cursor worked (inherited substrate, diffs, native verification, lives where work happens) and the PM translation: **the cited claim + tracked change is the PM's diff**.
- Object model: Signal, Insight, Problem, Bet, Decision, Artifact. Five surfaces: Signals Inbox, Artifact Studio, Audience Lenses, Rituals + Review Queue, Ask the Brain.
- **Review fatigue is a first-class product risk:** propose at insight level, digest cadence, confidence-tiered auto-apply, auto-expiring proposals; watch queue depth and time-to-clear like engagement metrics. North-star metric: **verification cost** (minutes of PM attention per accepted unit of work).

## 2.md — "A Product Brain OS" (the objects and the guarantee)

- Sharpest object model: **Source → Claim (fact/insight/commitment, with evidence spans, confidence, freshness policy) → Decision → Artifact (live sections + health) → Playbook → Suggestion.**
- **Playbook grammar:** *When / Read / Produce / Then* — plain-English sentence, structured chips, run history, accept-rate, trust setting. New capability = new playbook = content, not a feature release.
- The provenance rule as architecture: `propose()` *rejects* uncited assertions unless flagged as inference — "the agent cannot state what it cannot cite."
- Artifact health = share of live claims still fresh: "the closest thing product work will ever have to a failing test."
- Wedge scoring lands on **Ask-with-receipts + Weekly Update** — a forcing function that makes the system model state, deltas, and rationale. Stakeholders consume views free where they live; **seats are for brain owners** (matches the seats-wedge pricing from /combined).

## 3.md — "The Product Brain: PM Work OS" (the interaction model)

- **Three verbs total: Ask, Review, Approve.** Zero command syntax; reverse prompting (the system interviews the PM with tappable options).
- Richest entity set, including **Open Question** ("what we don't know and how we'll find out" — the most PM-native object no tool has) and Stakeholder (what they care about, what they were last told).
- **Plays**: pre-built workflows configured by short form, with a **dry-run preview on last week's real data** before enabling — "nothing builds trust faster than a counterfactual with receipts." Plain-language activity traces per run.
- **Scenario Branches:** branch the brain ("what if we cut SSO from Q3?"), agent propagates consequences, merge or discard — the differentiator git makes nearly free.
- Riskiest assumption, named: PMs must actually review rather than rubber-stamp or ignore — test with a concierge Monday loop before building.

## 4.md — the critique pass (the sharpest formulations)

- **"Product truth has no HEAD."** Every doc is a snapshot rotting from the moment of the next customer call; status theater and meeting amnesia are downstream symptoms of statelessness.
- **The decision is the atomic unit of PM work** — Jira has tickets, Notion has docs, Productboard has features; *nobody has decisions*. Signals→Insights→Artifacts hides the hop where the work actually happens.
- The Desk as **anticipatory brief** (Cursor's Tab-completion translated to a day): decisions awaiting your call, a stale PRD with the redline ready, Friday's update drafted.
- **Playbooks are taught, not written:** the system watches how the PM edits its third draft, offers to distill the pattern, shows it back as editable plain English. The **Product Charter** (strategy, personas, terminology, "we never compete on price") is the AGENTS.md analog pinned into every run.
- Wedge order: meetings+Slack → decision log with receipts → auto-drafted status updates → living PRDs → broadcasts/stakeholder ledger. Signals are crowded (Enterpret/Cycle); **decisions are low-volume, high unit value, completely unowned.**
- Open governance question flagged: who owns the brain when five PMs share a product area.

---

## What the design docs under-specify (and the concept must add)

- They all say "the PM never sees files/repo" — but our ICP includes **AI-forward PMs who *want* the files** (Kevin ships context via MCP; Filip runs Claude Enterprise), and OpenKnowledge proves visible files are a trust feature, not a leak. The concept resolves this: files visible and first-class, review surfaces primary.
- None designs the **navigation-at-scale** problem (1,000+ meetings/notes) — /sources supplies the answer (authored indexes, hubs, smart views, agent-as-librarian).
- None commits to the **session/tab** interaction shape Erik wants — pm-superpowers' interactive skills + Scout's thread-sessions + OpenKnowledge's tabs supply it.
