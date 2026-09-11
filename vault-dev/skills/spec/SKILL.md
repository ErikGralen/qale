---
type: skill
title: Write a spec
summary: Turns a research page's insights and decisions into a document a team can build from.
scenarios:
  - turning a research page or a tag the workspace already backs into something a team can build ("write a spec for the waitlist")
  - writing up what we are committing to, from insights and decisions already filed ("draft the PRD for no-show fees")
  - checking whether the evidence carries a spec yet ("is there enough here to spec group bookings")
---

## When

You point at a research page, or a `#tag`, and want the document a team builds from. The material
is already here.

Every line traces to something filed. A line the workspace cannot back does not go in; it gets
named as missing instead.

Reading raw material and working out what it adds up to is the synthesis skill's job. This one
starts where that one stopped: it reads the conclusions, never the transcripts under them.

## Read

- **The research page**: where it stands, its body, and the insights listed under `sources`. For
  a `#tag`, its Context page: the research pages first, then the insights.
- **Each of those insights**: the claim, and how many accounts its own `evidence` lists. That
  count is the strength of anything you build on it.
- **The decisions** that touched the page or the tag.
- **The ticket mirrors** the page links: what is built, in flight, or blocked.
- **The customer hubs** the insights name, for who has this problem and what they were told.
- **The three about pages** in `about/` (product, technical, organization), for the
  constraints anything built here has to live inside.
- **Any spec this workspace already holds for this page or tag.** Extend that one rather than
  file a second.

## Say the scope back first

Before writing anything, say which page or tag this is, which insights and decisions are in, and
what is being left out. That is the cheapest moment to be corrected. Where the choice is not
yours to make (which of two pages, whether a neighbouring problem is in scope), ask. Where it is, decide,
and say what was decided.

## When the evidence does not carry a spec

A spec claims we know enough to build. Say plainly that we do not, and propose nothing, when:
- the page or tag holds fewer than two insights, or every insight rests on a single account;
- nothing commits to it: no live decision, and the page itself says it is still exploring or
  watching;
- the problem is written as the feature somebody asked for, with no account behind it.

Then name what would change that: which decision has to be made, which second account would
confirm the claim. A run that ends there has done its job.

## Produce

One proposal, the spec (propose_note, type `note`, path `notes/spec-<slug>.md`), with `sources`
citing the research page, the insights and the decisions it rests on. Take `tags` from the page,
or the tag itself. A spec is the PM's document, so it goes in their folder and it waits as a card:
a new page in Documents always does. Say in the rationale what the spec covers, because that card
is where they decide.

One addition to the writing rules: no requirement without a trace. Every requirement names the
insight, decision or ticket mirror behind it. One that cites nothing is not a requirement, it is
your idea, and it belongs under Assumptions with what would settle it.

A second proposal where the research page does not link the spec yet: a propose_update adding
the link. A tag has no page to link from.

Tickets are not this skill's work. Breaking a spec into tracked work comes after the spec is read
and accepted.

## Then

The spec waits as a card. Once the PM approves it, it sits with their own documents and cites its
way back down: a reader follows a requirement to the insight, and the insight to the account that
said it. A later run over the same page or tag extends this one instead of filing a rival.

## The shape of the spec

```
[propose_note, type note, notes/spec-<slug>.md]
# <what is being built, in the words a person would use>

## Problem
**Fact** <the problem, in your own voice> ([[insights/...]], <n> accounts)

## Who has it
<the segment, or the named accounts and how many> ([[customers/...]])

## What is already decided
- <what was decided, by whom, when> ([[decisions/...]])

## Scope
In: <what this covers>
Out: <what it deliberately does not, and why>

## Requirements
1. <one thing the product has to do> ([[insights/...]] | [[decisions/...]] | [[tickets/KEY]])

## How we know it worked
<the change you would be able to observe, and where it would show>

## What exists already
- <KEY title>: <state, from the mirror> ([[tickets/KEY]])

## Assumptions
- **Assumption** <what the spec rests on that nothing backs>. <What would settle it.>

## Open questions
- <what nobody has answered, and who can answer it>

## Evidence
- [[insights/...]]: <n> accounts
- [[decisions/...]]: <what it settled>
```
