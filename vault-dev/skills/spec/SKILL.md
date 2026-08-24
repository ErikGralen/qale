---
type: skill
title: Write a spec
summary: Turns a theme's insights and decisions into a document a team can build from.
scenarios:
  - turning a theme the workspace already backs into something a team can build ("write a spec for the pricing theme")
  - writing up what we are committing to, from insights and decisions already filed ("draft the PRD for scheduled exports")
  - checking whether the evidence carries a spec yet ("is there enough here to spec onboarding")
---

## When

You point at a theme and want the document a team builds from. The material is already here.

Every line traces to something filed. A line the workspace cannot back does not go in; it gets
named as missing instead.

Reading raw material and working out what it adds up to is the synthesis skill's job. This one
starts where that one stopped: it reads the conclusions, never the transcripts under them.

## Read

- **The theme**: its `stance`, its body, and the insights listed under `evidence`.
- **Each of those insights**: the claim, and how many accounts its own `evidence` lists. That
  count is the strength of anything you build on it.
- **The decisions** that touched the theme.
- **The ticket mirrors** the theme links: what is built, in flight, or blocked.
- **The customer hubs** the insights name, for who has this problem and what they were told.
- **The three understanding notes**, for the constraints anything built here has to live inside.
- **Any spec this workspace already holds for this theme.** Extend that one rather than file a
  second.

## Say the scope back first

Before writing anything, say which theme this is, which insights and decisions are in, and what
is being left out. That is the cheapest moment to be corrected. Where the choice is not yours to
make (which of two themes, whether a neighbouring theme is in scope), ask. Where it is, decide,
and say what was decided.

## When the evidence does not carry a spec

A spec claims we know enough to build. Say plainly that we do not, and propose nothing, when:
- the theme holds fewer than two insights, or every insight rests on a single account;
- nothing commits to it: no live decision, and a `stance` of `exploring` or `watching`;
- the problem is written as the feature somebody asked for, with no account behind it.

Then name what would change that: which decision has to be made, which second account would
confirm the claim. A run that ends there has done its job.

## Produce

One card, the spec (propose_note, type `note`, path `notes/spec-<theme-slug>.md`), with `sources`
citing the theme, the insights and the decisions it rests on. Take `tags` from the theme.

One addition to the writing rules: no requirement without a trace. Every requirement names the
insight, decision or ticket mirror behind it. One that cites nothing is not a requirement, it is
your idea, and it belongs under Assumptions with what would settle it.

A second card where the theme does not link the spec yet: a propose_update adding the link.

Tickets are not this skill's work. Breaking a spec into tracked work comes after the spec is read
and accepted.

## Then

The approved spec sits in `notes/` and cites its way back down: a reader follows a requirement to
the insight, and the insight to the account that said it. A later run over the same theme extends
this one instead of filing a rival.

## The shape of the spec

```
[propose_note, type note, notes/spec-<theme-slug>.md]
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
