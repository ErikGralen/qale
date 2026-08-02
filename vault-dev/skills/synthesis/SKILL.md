---
type: skill
starts: [you-run-it, model-picks-it-up]
title: Find the pattern
summary: Reads a stack of interviews and says what they add up to.
can: [draft-outbound, keep-working-files]
---

## When
The PM points at a body of material and asks what it adds up to. The question can be pointed
("who wants scheduled exports?") or open ("read these and tell me what's there"). The material is
usually transcripts and sources, sometimes existing insights, sometimes one document read several
ways. This is the step between "we talked to nine people" and "here is what we believe": nothing
in the memory yet says which of those nine said the same thing. Finding that is the work.

## Read
Scope first: decide which documents are in and say the list back to the PM before reading
anything. Use vault_list and search_vault over the tag, customer, or theme they named; sources/
and meetings/ hold raw material, insights/ holds claims already made. Then read what you will
weigh the material against: the existing themes and their current `stance`, the decisions that
touched them (follow superseded chains to the live head), and the ticket mirrors where a theme
links tracked work.

Write `brief.md` before reading the material: what we currently believe, the themes in play and
their stances, the live decisions a source might contradict, and what a good answer looks like
for this question. Every child reads it. Without the brief, a reader handed one transcript in
isolation cannot tell a new fact from a contradiction, and contradictions are the most valuable
thing this session finds.

Then spawn the reading. One `spawn` entry with `over` set to the document list gives every
document its own full pass; that is what makes "six of nine accounts" a fact instead of an
impression. When the question has more than one angle, add entries: three prompts over the same
document, run in parallel, cannot color each other the way one reader asked for three things
would. Each child writes `per-item/{target}.md`, carrying the original path and verbatim quotes
forward.

Read the results back with files_list and files_read. If the first pass leaves clusters too big
to hold, spawn a second wave over the per-item files; children can read everything the first wave
wrote.

## Produce
The clustering, each cluster its own approval card. Cite the original sources, never your session
files; those get deleted.
- **A new theme** (propose_note, type theme) where several sources converge on something the
  memory does not hold: state the problem worth solving (not the feature someone asked for), list
  `evidence`, and open with an honest `stance`: `exploring` unless the evidence is overwhelming.
- **Insights** (propose_note, type insight) where a single account said something worth keeping
  on its own, quoting them.
- **Evidence added to an existing theme** (propose_update): extend `evidence` and say in the
  rationale what the addition changes about how strong the theme now is.
- **A stance change** (propose_update setting `stance`) only where the evidence genuinely moved:
  `exploring` to `watching` when it is real but not now, `watching` to `exploring` when it woke
  up, anything to `wont-do` when the memory shows a deliberate decline (cite the decision). Never
  `committed` from here: committing is a decision with a decider, so propose the decision card
  and let the PM own it.
- **Disagreement**: where sources in one cluster conflict, or one contradicts a live decision,
  make that its own card instead of averaging it away. The disagreement is a finding.
- **What is thin, and what was silent**: which clusters rest on one account, and which documents
  in scope said nothing about the question. Both are findings. "One customer said this loudly,
  six never mentioned it" is worth more than a manufactured pattern.

Only when a theme is already `committed` does tracked work follow: draft_jira_issue for what no
ticket covers, citing the theme and the decision that committed to it. Any other stance produces
no ticket; `watching` and `wont-do` exist precisely to stay real and unbuilt. Never invent a
theme to give an existing ticket a parent; themes come from evidence.

Counting rules:
- Every claim names its sources and how many distinct accounts back it. A pattern from one
  account is a signal, not a pattern; say which second account would confirm it.
- Every document in scope gets a pass, and the ones that said nothing are named as silent. If
  some failed to read, report "six of nine"; do not write "the interviews show" over a partial
  read.
- Fewer than two documents in scope: say so and propose nothing. There is no pattern in one
  document.
- Nothing new since the last synthesis over this scope: say so instead of restating it.

## Then
Approved cards file the themes and insights and move the stances that moved; the sources stay
exactly as they were. Session files are working material, not memory: anything worth keeping from
them was worth proposing as a note. What stayed thin stays visible as thin.
