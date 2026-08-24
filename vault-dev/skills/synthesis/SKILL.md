---
type: skill
title: Find the pattern
summary: Reads a stack of interviews and says what they add up to.
scenarios:
  - weighing a stack of material already in the workspace against one question ("what do these nine interviews add up to")
  - counting how many accounts say the same thing ("who else has asked for scheduled exports")
  - reading a body of tagged material for whatever is in it ("read everything tagged onboarding and tell me what is there")
can: [draft-outbound, keep-working-files]
---

## When

You point at a body of material and ask what it adds up to. The question can be pointed
("who wants scheduled exports?") or open ("read these and tell me what's there"). The material is
usually transcripts and sources, sometimes existing insights, sometimes one document read several
ways. Nothing in the memory yet says which accounts said the same thing. Finding that is the work.

## Read

Scope first: decide which documents are in and say the list back before reading anything. Use
vault_list and search_vault over the tag, customer, or theme the request named. Read the claims
insights/ already makes before the material: they are what you will extend rather than duplicate.
Then read what you will weigh the material against: the existing themes and their current
`stance`, the decisions that touched them, and the ticket mirrors where a theme links tracked
work.

Write `brief.md` before reading the material: what we currently believe, the themes in play and
their stances, the live decisions a source might contradict, and what a good answer looks like
for this question. Every child reads it; without it, a reader handed one transcript in isolation
cannot tell a new fact from a contradiction.

Then spawn the reading. One `spawn` entry with `over` set to the document list gives every
document its own full pass; that is what makes "six of nine accounts" a fact instead of an
impression. When the question has more than one angle, add entries: three prompts over the same
document, run in parallel, cannot color each other the way one reader asked for three things
would. Each child writes `per-item/{target}.md`, carrying the original path and verbatim quotes
forward. Keep those quotes exact: an exact quote is how anyone finds the line again in a
90-minute transcript.

Read the results back with files_list and files_read. If the first pass leaves clusters too big
to hold, spawn a second wave over the per-item files; children can read everything the first wave
wrote.

## Produce

The clustering, each cluster its own approval card.

Two different things get called evidence, and cards break when they are confused. A card's
`sources` argument cites material already on disk: the original transcripts and sources, never
your session files (those get deleted) and never a note this run has only proposed. A note's
`evidence` frontmatter is written into the note itself and may point at anything, including the
insights a theme rests on.

The cards:
- **Insights** (propose_note, type insight): one claim, stated in your own voice, with every
  account that backs it gathered inside it. An insight is the smallest thing we believe, and the
  one place a transcript quote belongs. The bar is a claim someone could act on or a future theme
  could rest on, never a summary line. List the backing accounts under `evidence`, quote each of
  them in the body, one short quote per account, and set `confidence` (high, med or low) from how
  many accounts back it and how directly they say it. Check insights/ first: a second account
  making the same claim extends the existing insight rather than filing a near-copy. Extending is
  a propose_update that restates the whole `evidence` list with the new account added, plus that
  account's quote in the body; an update replaces a field, so a list you shorten is a list you
  lose.
- **A new theme** (propose_note, type theme) where several sources converge on something the
  memory does not hold: state the problem worth solving (not the feature someone asked for), open
  with an honest `stance` (`exploring` unless the evidence is overwhelming), and make the body an
  argument over insights. A theme never quotes a transcript directly; if a quote is worth using,
  it is worth keeping as an insight first. `evidence` lists the insights the theme rests on, and
  the card's `sources` cite the transcripts underneath them.
- **Evidence added to an existing theme** (propose_update): extend `evidence` and say in the
  rationale what the addition changes about how strong the theme now is.
- **A stance change** (propose_update setting `stance`) only where the evidence genuinely moved,
  and `wont-do` only where the memory shows a deliberate decline (cite the decision). Never
  `committed` from here: committing is a decision with a decider, so propose the decision card
  and let the decider own it.
- **Disagreement**: a live insight the material contradicts is never quietly rewritten: propose
  the corrected insight and point it at the old one with a `supersedes` link, so the old one
  carries a pointer to what replaced it.
- **The gaps**: one card holding what this run could not answer. Which clusters rest on one
  account, which documents in scope said nothing about the question, and anything you went
  looking for and did not find, with where you looked. A gap belongs here and never inside a
  claim: a missing fact written as a hedged sentence is the one thing the three labels cannot
  catch.

Promote before you delete. Every per-item finding a cluster ends up leaning on becomes an insight
card, new or extended, and the cluster's card names those insights in its `evidence`. Do that
while the session files are still there; the quotes live nowhere else.

Themes written before insights existed carry their quotes inline. Leave them until a run touches
one, then decompose the quotes it leans on into insights as part of that run's normal proposals.

Only when a theme is already `committed` does tracked work follow: draft_ticket for what no
ticket covers, citing the theme and the decision that committed to it. Any other stance produces
no ticket; `watching` and `wont-do` exist precisely to stay real and unbuilt. Never invent a
theme to give an existing ticket a parent; themes come from evidence.

Counting rules:
- Every claim names its sources and how many distinct accounts back it. A pattern from one
  account is a signal, not a pattern; say which second account would confirm it.
- An insight's strength is how many accounts its `evidence` lists, so a theme citing it reads the
  count off the insight rather than recounting the transcripts.
- Every document in scope gets a pass, and the ones that said nothing are named as silent. If
  some failed to read, report "six of nine"; do not write "the interviews show" over a partial
  read.
- Fewer than two documents in scope: say so and propose nothing. There is no pattern in one
  document.

## Then

Approved cards file the themes and insights and move the stances that moved; the sources stay
exactly as they were. Session files are working material, not memory: anything worth keeping from
them was worth proposing as a note, and any quote worth keeping belongs in an insight.
