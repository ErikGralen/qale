---
type: skill
skill_kind: session
session_type: synthesis
summary: Synthesis — read the insights across interviews, cluster them into themes, take a stance
tier: outbound
checkpoints: [gather, cluster, draft]
gate_output: true
bindings:
  - mode: dynamic
completion_bar: Every cluster names the insights it rests on and how many distinct accounts back it; every stance change gives its reason.
stopping_conditions:
  - Fewer than two insights in scope — say so and propose nothing; there is no pattern in one claim.
  - Nothing new since the last synthesis over this scope — say so rather than restating the existing themes.
red_flags:
  - A theme built on one account's insights — that is a signal, not a pattern. Say which second account would confirm it.
  - Flipping a stance to `committed` — that is a decision with a decider, not a synthesis output. Propose the decision card and let the PM own it.
  - Inventing a theme so an existing ticket has a parent. Tickets stand on their own; themes come from evidence, never from tidying.
  - Dropping a contradicting insight to make a cluster clean — the disagreement IS the finding; name it.
---

## When
The PM points at a scope — a context tag, a customer, an existing theme — and asks what the
interviews add up to. This is the step between "we talked to nine people" and "here is what we
believe": individual insights already exist, and nothing has yet said which of them are the same
thing said nine ways.

## Read
Every insight in scope (vault_list type "insight", then search_vault on the tag/customer), the
themes that already exist there and their current `stance`, the decisions that touched them
(follow superseded chains to the live head), and — where a theme links tracked work — the ticket
mirrors (tickets/), so a stance is taken against what delivery actually shows.

## Produce
The clustering, each cluster its own approval card. Say plainly how many distinct accounts back
each one — a pattern from three customers and a pattern from one are different findings:
- **A new theme** (propose_note, type theme) where several insights converge on something the
  memory doesn't hold yet: the durable statement of the thing worth solving, `evidence` listing
  every insight it rests on, and an honest opening `stance` — `exploring` unless the evidence is
  already overwhelming. Write the theme as the problem, not the feature someone asked for.
- **Evidence added to an existing theme** (propose_update) where the new insights belong under a
  theme that already exists: extend `evidence`, and say in the rationale what the addition changes
  about how strong it now is.
- **A stance re-reading** (propose_update setting `stance`) only where the evidence genuinely
  moved: `exploring` → `watching` when it's real but not now, `watching` → `exploring` when it
  woke up, anything → `wont-do` when the memory shows a deliberate decline (cite the decision).
  Never move to `committed` here — that is a decision, and it gets a decision card with a decider.
- **The dissent** — where insights in the same cluster disagree, or one contradicts a live decision,
  make that its own card rather than averaging it away.
- **What is still thin** — say which clusters rest on one account and what evidence would settle
  them. An honest "one customer said this loudly" is worth more than a manufactured pattern.

Only where a theme is ALREADY `committed` does tracked work follow: draft_jira_issue for what no
ticket covers yet, citing the theme and the decision that committed to it. A theme with any other
stance produces no ticket — the whole point of `watching` and `wont-do` is that they are real and
deliberately unbuilt.

## Then
Approved cards file the themes and re-stance the ones that moved; the insights stay exactly as they
were (clustering never rewrites the claims it clusters). Approved ticket drafts execute upstream and
file their key back. What stayed thin stays visible as thin.
