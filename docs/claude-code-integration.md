# Claude Code integration, brainstorm

Status: decided. All comment slots are answered. The build plan is
docs/claude-code-tickets.md (CC-1..11).

## The frame

Qale is the PM. Claude Code is the tech lead who has read the whole
codebase. The PM does not read code. The PM asks the tech lead
questions and gets answers grounded in what the code actually does.

Today that tech lead is a human, and the PM's questions queue behind
sprint work. The integration gives every PM question about the product
a fast, honest first answer, and saves the human for the questions
that need judgement.

**Decided:** Qale never writes code and never asks Claude Code to
write code. Reports only. The report then feeds one of two exits:

- a PRD or Jira tickets for colleagues, through the outbound path we
  have, or
- a PRD or prompt written FOR Claude Code, which the user copies into
  their own Claude Code session by hand.

The second exit is worth underlining: Qale can produce the handoff
artifact without ever touching the repo's write path. The human stays
the courier, and the no-write rule stays intact.

## Jobs to be done

**Decided:** all of the below matter. V1 builds job 1; the others
are follow-ups in roughly this order.

**1. "How does X work today?"**
"Can we upgrade our onboarding" starts with "what is our onboarding,
exactly". Claude Code walks the code and returns a PM-language
report: the screens, the order, the copy, what is skippable, what is
tracked.

**2. Brainstorm an implementation with Iterate.** *(new, from Erik)*
Start from a high-level product idea, use the Iterate feature to
explore options, pull technical constraints from the codebase as the
conversation needs them, decide, and end with a technical PRD. This
is the deepest job: it is not one question and one report, it is a
back-and-forth where the codebase is a participant.

This job shapes the tool design. A single fire-and-forget
`ask_codebase(question)` is wrong for it: Iterate will want to ask a
follow-up that depends on the last answer. Claude Code supports this
directly, headless runs return a session id and `--resume <id>`
continues with full context. So the tool should support a
conversation, not just a query.

**3. Reality-check a spec or theme.**
Does the code match this doc? What did we say we built that we
didn't?

**4. Scope before you write the ticket.**
What does this change touch, what shares the code path, what part is
risky. Not days, surface area.

**5. Enrich outbound tickets.**
Claude Code annotates a drafted Jira ticket before it goes out:
affected area, likely edge cases. Zero new UI.

**6. Instrumentation and release questions.**
"Do we track onboarding drop-off?" "What shipped since the last
release that a customer can see?"

> Erik: for job 2, should the Iterate session hold ONE Claude Code
> conversation open across the whole brainstorm (cheap follow-ups,
> but context drifts as the brainstorm pivots), or start fresh per
> question (clean, but re-reads the repo each time)? My vote: one
> conversation per Iterate session, with the agent free to start a
> fresh one when it changes topic.
yes we shuold use CC sessions and be able to change if needed. This isn't just specific for this JBTD
## How it runs

**Decided:** shape B. `ask_codebase` is a tool in the session
engine's toolbox, next to `search` and `spawn`. No new roster entity.
The tool is not injected at all when no codebase is configured, same
pattern as the connector-gated outbound tools.

**Decided:** the codebase setting accepts any of: a single repo, a
folder that contains many repos, or several such paths. Qale lists
what it found (each subfolder with a `.git`), and the tool takes a
`repo` parameter so the calling agent picks the target. When the
agent does not know which repo holds the feature, it can ask the
cheapest model to look, or ask across repos, but that is the agent's
problem to solve with the tool, not new machinery.

## Approval and model choice

**Decided:** every run is approved by the user before it starts, on a
card where the suggested model can be changed.

I looked at pi for this. pi has no approval machinery to borrow: it
deliberately ships without a permission system and leaves that to the
harness. But we already built the right pattern ourselves, twice:

- `ask_user` parks a promise mid-turn and resolves it from a card.
- `spawn` does exactly what we need: the tool call raises an approval
  card that shows the work and a model list with a suggested default,
  the promise parks (and survives a quit, via the deferral machinery),
  and the PM's decision comes back as `{ approved, modelId }`.

So the `ask_codebase` card is the spawn card's shape with different
contents: the question being sent, the target repo, the suggested
model, and a picker to change it. The calling agent passes
`suggested_model` plus one line of why ("greps and a summary" vs
"architecture judgement"), mapped to what the `claude` CLI accepts
(sonnet, opus, fable). The card shows the why; the PM can override.

> Erik: approval granularity. In a job-2 Iterate session the agent
> might ask the codebase eight times, and eight cards is nagging.
> Options: (a) a card per run, always; (b) first card grants the
> session, later runs in the same session show a quiet receipt but no
> card; (c) the card has "allow for this session". My vote is (c):
> the first ask is always a card, and the PM chooses how much rope to
> give. Model changes mid-session would still raise a new card.
Go with A BUT if we are starting a new CC session ask again so they can switch models 
## What comes back

**Decided:** reports are session files, not workspace notes. They
land in a folder under the session, with provenance in the file
(repo, commit, date, model). They do not clutter the workspace. The
agent may suggest promoting one to a note when it genuinely belongs
in the workspace, but that is an offer, not a default.

This also dissolves the staleness problem from round 1: session files
already live and die with the session. Nothing rots on a shelf,
because nothing is shelved unless a person chose to shelve it.

## Keeping the repo fresh

**Decided:** no scheduled Claude Code runs. But the clone must not go
stale, so Qale updates the repos itself: `git fetch` + fast-forward
pull, on a toggle (per codebase path, default on), run regularly when
toggled on. This handles the folder-of-repos case too, each repo
under the path gets updated.

Rules for the updater: fast-forward only, never touch a dirty
working tree or a non-default branch, and say what it did somewhere
quiet. If a repo cannot fast-forward, leave it and mark the report
provenance accordingly, a wrong merge in the user's clone is far
worse than a stale answer.

> Erik: a simpler alternative to interval pulling: pull-before-run.
> The repo updates only when a question is about to hit it, which
> makes every answer fresh by construction and touches nothing
> nobody asked about. The toggle then means "may Qale pull at all".
> Interval pulling only wins if you want the clone warm for your own
> manual use. Which do you want?
>
Pull before run makes sense, perhaps with a sincelast pull check so we dont do it too often if we ask many questions in a row. Perhaps 15 minutes?

## Discoverability

**Decided:** present but not featured. The settings page exists for
those who look, nothing on Home advertises it, no onboarding screen
mentions it. It is for Erik and the technical PM until it earns more.

## What I would not do

- No code writing, no PRs, no branches (v1).
- No code review tool. Engineers have Claude Code already.
- No scheduled Claude Code runs (git pulls are the one background
  activity, see above).
- No indexing or embedding the repo ourselves.

## Smallest honest v1

1. Settings: add codebase paths (repo or folder of repos), check
   that `claude` exists on PATH, toggle for git updates. Not
   featured anywhere else.
2. `ask_codebase` tool: read-only flags, JSON out, `repo` +
   `suggested_model` params, `--resume` support for follow-ups.
   Injected only when a codebase is configured.
3. Approval card per run (spawn-card pattern): question, repo,
   suggested model with the why, model picker.
4. Reports land as session files with provenance.
5. One skill updated to use it, the one behind "how does X work
   today".

Job 2 (Iterate brainstorm → technical PRD) is the first follow-up,
and the tool's `--resume` support in v1 is what keeps that door open.

> Erik: three open questions above (Iterate conversation lifetime,
> approval granularity, pull-before-run vs interval). Answer those
> and I think this is ready to turn into tickets.
