---
type: skill
skill_kind: session
session_type: synthesis
summary: Synthesis — read a corpus, work out what it adds up to, and say what we now believe
tier: outbound
checkpoints: [scope, read, cluster, draft]
gate_output: true
session_files: true
bindings:
  - mode: dynamic
completion_bar: Every claim names the sources it rests on and how many distinct accounts back it; every source in scope got a pass, and the ones that said nothing are named as silent.
stopping_conditions:
  - Fewer than two sources in scope — say so and propose nothing; there is no pattern in one document.
  - Nothing new since the last synthesis over this scope — say so rather than restating what is already there.
red_flags:
  - A pattern from one account — that is a signal. Say which second account would confirm it.
  - Flipping a stance to `committed` — that is a decision with a decider, not a synthesis output. Propose the decision card and let the PM own it.
  - Inventing a theme so an existing ticket has a parent. Tickets stand on their own; themes come from evidence, never from tidying.
  - Dropping a contradicting source to make a cluster clean — the disagreement IS the finding; name it.
  - Reporting a count that quietly excludes what you could not read. "Six of nine" is a fact; "the interviews show" when three failed is not.
---

## When
The PM points at a body of material and asks what it adds up to. Sometimes the question is pointed
("who wants scheduled exports?"), sometimes it is open ("read these and tell me what's there"). The
material is usually transcripts and sources, sometimes existing insights, sometimes one document you
are asked to read three different ways. This is the step between "we talked to nine people" and
"here is what we believe".

Nothing in the memory has said which of those nine are the same thing said nine ways. That is the
work.

## Read
First **scope it**: which documents are in, and say the list back to the PM before spending anything.
vault_list and search_vault over the tag, customer or theme they named; sources/ and meetings/ for
raw material, insights/ for claims already made. Then the memory you are weighing it against — the
themes that exist there and their current `stance`, the decisions that touched them (follow
superseded chains to the live head), and the ticket mirrors where a theme links tracked work.

**Then write `brief.md` before you read the corpus.** What we currently believe, the themes in play
and their stances, the live decisions a source might contradict, and what a good answer looks like
for this question. Every child reads it. Without it, a reader handed one transcript in isolation
cannot tell a new fact from a contradiction, which is the most valuable thing this session finds.

**Then `spawn` the reading.** One entry with `over` set to the corpus gives every document its own
honest pass — that is what makes "six of nine accounts" a fact rather than an impression. Where the
question has more than one lens, add entries: three prompts over the same document read three ways,
in parallel, cannot colour each other the way one agent asked for three things would. Each child
writes `per-item/{target}.md` carrying the original path and the verbatim quotes forward.

Read the results back with files_list and files_read. If the first pass leaves clusters too big to
hold, spawn a second wave over the per-item files — children can read everything the first wave
wrote.

## Produce
The clustering, each cluster its own approval card, citing the ORIGINAL sources — never your session
files, which get deleted:
- **A new theme** (propose_note, type theme) where several sources converge on something the memory
  does not hold yet: the durable statement of the thing worth solving, `evidence` listing what it
  rests on, and an honest opening `stance` — `exploring` unless the evidence is already
  overwhelming. Write the theme as the problem, not the feature someone asked for.
- **Insights** (propose_note, type insight) where a single account said something worth keeping on
  its own, quoting them. These are earned here, weighed against everything else, rather than
  manufactured on arrival from one document with nothing to compare it to.
- **Evidence added to an existing theme** (propose_update): extend `evidence`, and say in the
  rationale what the addition changes about how strong it now is.
- **A stance re-reading** (propose_update setting `stance`) only where the evidence genuinely moved:
  `exploring` → `watching` when it is real but not now, `watching` → `exploring` when it woke up,
  anything → `wont-do` when the memory shows a deliberate decline (cite the decision). Never
  `committed` here — that is a decision, and it gets a decision card with a decider.
- **The dissent** — where sources in the same cluster disagree, or one contradicts a live decision,
  make that its own card rather than averaging it away.
- **What is thin, and what was silent** — which clusters rest on one account, and which documents in
  scope said nothing about the question. Both are findings. An honest "one customer said this
  loudly, six never mentioned it" is worth more than a manufactured pattern.

Only where a theme is ALREADY `committed` does tracked work follow: draft_jira_issue for what no
ticket covers yet, citing the theme and the decision that committed to it. Any other stance produces
no ticket — the whole point of `watching` and `wont-do` is that they are real and deliberately unbuilt.

## Then
Approved cards file the themes and insights and re-stance what moved; the sources stay exactly as
they were. Your session files stay as working material, not memory: if a per-item read was worth
keeping, it was worth proposing as a note. What stayed thin stays visible as thin.
