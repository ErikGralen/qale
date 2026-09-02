# Notes on claude-code-pm-starter

Read through https://github.com/adamfaik/claude-code-pm-starter on 2026-09-02, together with the
article it ships with ("How to organize Claude Code for product work", theaithinker.com). Author:
Adam Faik. MIT licence, so we can copy from it if we want to. We probably will not need to.

The repo is small on purpose: 326 lines of markdown across 15 files. Four context templates, one
example project, five skills, a `CLAUDE.md` map. No code, no scripts, no tests. The article carries
the reasoning and the repo carries the shape.

This is the closest thing yet to a competitor built out of nothing. It is what a motivated PM
assembles by hand when they do not buy anything. Read it that way.

These are notes for us. Each section says what they did and what I would do about it in Qale.

---

## 1. What it is

```
CLAUDE.md                    16 lines, the map
context/                     company, product, users, preferences
projects/<name>/             brief.md + tasks.md
operations/                  dated notes, README only
.claude/skills/              setup-workspace, file-feedback,
                             status-update, prd-review, interview-synthesis
```

Every context file is a heading skeleton with a bracketed placeholder under each heading. The
placeholders are written as instructions to whoever fills them in, human or model: "Don't paste
live numbers here; they go stale", "First names are enough", "One paragraph a new hire would
understand".

The five skills average 27 lines. Compare 386 for Dean Peters' library (see
`pm-skills-teardown.md`) and about 60 for ours. Theirs are short because the workspace holds the
knowledge, which is the same reason ours are short. This is the first outside repo whose skills are
written the way ours are.

---

## 2. The one real idea: sort by rate of change

Their organising question is not "what topic is this?" It is "how fast does this change?"

- `context/` changes in months. Positioning, segments, vocabulary, preferences.
- `projects/` changes in weeks, and splits again: `brief.md` is the slow half, `tasks.md` is the
  fast half.
- `operations/` is a snapshot. It was true on its date, the date is in the filename, and it is
  never edited afterwards.
- MCP connections are the fourth speed, the hourly one, and they hold no files at all.

That gives them a diagnostic I like: if you are pasting live data into a context file, an MCP
should own it. If you are re-fetching stable truth through an MCP every session, a file should own
it.

They contrast this with PARA on the right axis. PARA sorts by actionability, because a human loses
track of what to act on. This sorts by rate of change, because a model's failure mode is stale
context reused with confidence.

**Where we stand.** We file by kind: meetings, insights, themes, decisions, people, tickets,
todos, sources. Speed is in there, but it is implicit and it is spread across three mechanisms:
`processing` on sources and meetings, `remote_updated` on mirrors, `standing: superseded` on
decisions, plus the freshness work from OKF v0.2. We already hold the immutability rule they
state (`sources/` bodies are never edited, decisions are superseded rather than changed) and the
promotion path (a source is raw, an insight cites it, a theme accrues it).

So we are ahead on mechanism and behind on articulation. Nothing in the product says out loud
which shelf changes at what speed. The Memory page shows twelve shelves as peers. A PO cannot look
at it and know that `notes/understanding-product.md` should outlive `tickets/`. That is a copy and
grouping question, not an engine question.

One thing they have that we do not: a shelf for dated outputs the work produces. Our weekly update
lands as a proposal against a wikipage or a note. Their `operations/` is a plain drawer of
"documents this job produced, in date order", and it is the drawer a PM actually points at when
someone asks what happened in July. Worth a look, but not a ticket yet.

---

## 3. What we already have

Listing this so we do not re-derive it. Their practice, our equivalent:

| Their practice | Ours |
| --- | --- |
| `CLAUDE.md` map, kept under 200 lines, maintained by Claude | `index.md` per folder, maintained by the librarian |
| Templates with instructive placeholders | Seeded skills and the demo vault |
| Setup interview that fills the context files | `tell-qale` plus first look |
| Skills for recurring work | The roster |
| Preferences read before any draft | House rules plus `voices/` |
| Nothing uncited | House rules, Writing |
| Separate observation from interpretation (`interview-synthesis`) | Fact / Inference / Assumption in the house rules |
| Prune stale context every dozen sessions | Librarian drift check |

Their `interview-synthesis` is our `synthesis` with fewer moving parts. Their `status-update` is
our `weekly-update` with fewer moving parts. Their `prd-review` is close to our `spec` skill run in
reverse. No gap there.

---

## 4. The correction router

`file-feedback` is the best file in the repo. It takes something the PM just corrected and asks
four questions in order:

1. **A one-off slip?** Let it go. Tell the PM nothing needs filing.
2. **A missing or outdated fact?** File the fact, into the matching context file or the project
   brief. Quote the exact line you added.
3. **A wrong process?** Edit the skill, so the fix runs every time. If no skill owns that work yet
   and this is the second time it repeats, offer to make one.
4. **Taste?** Add an entry to the corrections log, in a fixed three-line shape: the rule, why, and
   how to apply it.

Ours is `propose_instruction`, and it covers branch 3 and branch 4 only. It routes a rule to the
owning skill, or to "Your rules" in the house rules when nothing owns it. Two things are missing.

**Branch 2 is not wired.** When the PM corrects us because the memory held the wrong fact, the
right move is `propose_update` against the note that was wrong, not a standing rule. Nothing tells
the model to make that distinction. A rule bullet is the wrong home for a fact, and it is the
cheapest thing for the model to reach for, so it will.

**Branch 1 is not stated.** We have no clause saying a slip is not worth filing. Their line: "not
everything deserves a file." Ours reads as: any correction can become a rule. That is how a house
rules file fills up with noise that every session then pays for.

**The why line is a real disagreement.** Their corrections log entry carries a rule, a why, and a
how-to-apply, and their argument is that a rule without a why gets applied blindly at the edges.
Our `propose_instruction` takes `why`, puts it on the proposal card, and writes only the bare
bullet into the file. `RULE_MAX` exists to keep the reasoning out, because the file is read at the
top of every session it applies to.

Both arguments are right, and the resolution is that they are about different rules. A rule with
no edge cases ("never use exclamation marks in outbound email") needs no why. A rule with edge
cases needs one, or the model guesses at the boundary and guesses wrong. Erik's standing position
is to fix what the model read rather than add a gate, and a why line is exactly that: more for the
model to read. I would allow an optional second line under a rule, capped hard, and only when the
rule names a class of thing rather than a single behaviour.

---

## 5. The closing move

Their highest-return habit is one sentence typed at the end of a task: "we're done, turn this into
a skill, and file the corrections I made."

We have the end-of-session beat already (the receipt, the consequences, the door). It reports what
happened. It never asks what the session should have taught the workspace.

We also have no way for a session to propose a skill. `newSkillFile` is the New skill button, and
`propose_instruction` will write a `jira` or `confluence` conventions file from a template when the
rule needs one. Neither is "you have now done this same shape of work three times, here is the
skill for it, approve or throw it away."

This needs no new proposal kind. A skill is a file, so it rides the existing `note` kind, the way
`propose_instruction` already writes a whole `jira` conventions file when the rule needs one. What
is missing is only the tool and the trigger. Their trigger is the PM saying so, and ours is the
same. The librarian noticing repetition on its own is the bigger version and can wait.

**Built 2026-09-02.** `propose_skill` takes a title, a summary, a drafted body, and optional
`scenarios` and `can`. It fires when the PM asks, never on its own. A name that already resolves to
a skill or an agent is refused and pointed at `propose_instruction` instead.

---

## 6. Nouns and verbs

Their test for where something belongs: **nouns go in files, verbs go in skills.** What Claude
needs to know is a noun. What Claude needs to do is a verb.

They name two failure modes. We have the first one clearly and the second one barely:

- **A skill that is really a fact bucket.** Ours: `house-rules` is almost all nouns, and
  `discovery-question-bank` sits in `notes/` doing the same job from the other side.
- **A procedure written as notes.** A "how we run reviews" paragraph nobody can execute, which
  then gets re-explained every time. The nearest case in the demo vault is
  `notes/rollout-runbook.md`, and that one is fine: it is a procedure the team runs, not one Qale
  runs. Worth watching for once POs start writing their own.

I do not think the test says to move anything, and I first read it as saying the Skills page mixes
four kinds of thing under one heading. That was wrong, and I checked. `skills-tabs.ts` already
splits the page by shape into five tabs: Skills, House rules, Moments, Voices, Agents. The shape
question was settled in the SK-12 rework. Nothing to do here.

The one kind that has no home is reference: knowledge the agent should read when a topic comes up,
but which is not work and not a rule. `notes/discovery-question-bank.md` is that, and it sits in
`notes/` with everything else. Not a problem today. It becomes one if POs start writing reference
files and expect the agent to find them.

---

## 7. Small things worth stealing

- **Paste a link instead of answering.** Their setup interview says: hand it your product's public
  site or a Confluence page, and it builds the context file from what is already written. Fifteen
  minutes replaces the blank page. `tell-qale` asks questions and takes a handed-over source as an
  exception. Making the link the *offered* path, not the exception, would shorten day one a lot.
- **"An honest placeholder beats invented content."** Their setup skill says skipping a section is
  fine and leaves the placeholder. Ours should say it too.
- **"An update without an ask is a diary entry."** From `status-update`. Our `weekly-update` does
  not require an ask.
- **"One voice is a data point."** From `interview-synthesis`. Our `synthesis` has it: "one
  account is a signal, not a pattern". Theirs is the better sentence.
- **Cap the findings.** Their `prd-review` caps at ten and says the top ten *are* the review. Our
  review-shaped skills do not cap.
- **Quote what you wrote and where.** Their `file-feedback` ends by quoting the exact line it
  added, so the PM can fix the wording on the spot. Our approval card shows the diff, which is
  better in the app and worse in chat.

---

## 8. What it tells us about the market

The article is the clearest statement of our own thesis written by someone who is not us:

> Past the basics, your results in Claude Code stop depending on how well you prompt and start
> depending on how well you file. A good prompt improves one session; a good file improves every
> session after it.

And: "Chat is a great place to think and a terrible place to accumulate."

Two readings, both useful.

**The category is arriving without us.** A PM who reads this gets 80% of the filing discipline for
free, in one sitting, with no vendor. What they do not get: sync (their tickets and pages live
behind an MCP call, so nothing accumulates from them), proposals with a diff and an approval,
anything scheduled, a librarian, and any of it without a terminal. That list is our product. It is
a good list. It is also not obvious from the outside, which is a marketing problem, not a product
one.

**They have two things we do not.** The workspace is a git repo, so a teammate clones it and
inherits the whole head start. And Claude Code reaches the codebase natively. We have `ask_codebase`
for the second one. We have nothing for the first, and "share your workspace with the PM who
replaces you" is a real want.

The honest summary: this repo is not a threat and its article is not a threat either. Both grow
the belief we are selling into.

---

## 9. What to do next

Five items, smallest first. State as of 2026-09-02.

1. **Teach the correction router.** DONE. `propose_instruction`'s description now names three
   branches and a fourth answer: a wrong fact goes to `propose_update`, a wrong habit to the owning
   skill, taste to the house rules or the voice file, and a one-off slip to nothing at all.
2. **Say skipping is fine** in `tell-qale`, and offer the link paste as the first path rather than
   the exception. NOT DOING NOW. Erik parked it.
3. **Add the small clauses:** an ask in every update, a cap on review findings. Open.
4. **`propose_skill`.** DONE. See section 5.
5. **Group the Skills page by shape.** ALREADY BUILT, in SK-12. I was wrong to list it. See
   section 6.

Not doing: their three-drawer layout, their `operations/` shelf, the why line as a general rule.
The first two are things we solved differently and better. The third needs the narrower version in
section 4 or it will bloat the file it lives in.
