# How Qale learns how the PM works

Written 2026-09-06. Five agents on different models got the same brief and listed the
options. This doc is the result in plain words. Nothing here is decided.

## The problem

Qale needs to know how the PM works. Which Jira projects, labels, issue types and statuses
they use, and when. Who they meet. Who their customers are. And a few things only they can
tell us. The full list is in `docs/cold-start-picture.md`.

Most of this can be counted from Jira and the calendar. Today we count nothing. We copy
tickets one at a time and never add anything up. So the first drafted ticket has no label, and
Qale asks the PM things Jira already knows.

## Four things in the code that make this cheap

1. When we sync tickets we already fetch pages of them. Adding fields to that request (labels,
   issue type, reporter, priority, components, sprint, fix version) costs no extra calls.
2. Jira can count for us. `countIssues` already exists. "How many bugs have label X" is one
   call and downloads nothing. A site with 3000 tickets costs the same as one with 300.
3. The summary pass already has the rule "run again only if the text changed". It saves a hash
   of what it read. We can use the same rule for everything below.
4. `index.md` is already a file that code writes on every tick and the AI never edits. We can
   write the counts the same way.

One more thing one agent noticed: every 5 minutes we re-read the tickets we mirror. If a
ticket's status changed since last time, that is one status change we saw, with a time. Save
it. After a few weeks we know how long tickets sit in each status and who moves them, and it
cost nothing.

## The plan

### 1. Count things. No AI.

- **When Jira is connected:** ask Jira for its lists. Projects, statuses per project, issue
  types, labels, required fields, boards, sprints, versions, components. A few seconds.
- **Also at connect:** run about thirty count queries. Label by issue type. Status by project.
  Reporter by type. Which fields are always empty. Seconds, any site size.
- **On every sync:** save label, type, reporter, priority and so on with each ticket, and add
  them up in the database.
- **On every tick:** if a ticket's status changed, save that change.
- **Later, if needed:** fetch old changelogs for the PM's own tickets, a few pages per tick,
  newest first. The file says how much is covered so far.
- **The calendar:** also fetch organiser, description, recurrence rule and attendee email
  domains. They are on the same request.

Rejected: letting the AI count by running queries. It is slow, costs money every time, and
models count badly.

### 2. Write the counts to a file the PM can open

One file per connected system, for example `tickets/jira/observed.md` (name open). Code
writes it on the tick, like `index.md`. It has three parts:

- **The numbers.** Written by code. Statuses, types, labels with last-used date, which label
  is on almost every bug, fields nobody fills, bot accounts, sprint length. One screen. The
  rest stays in the database.
- **What the numbers mean.** Written by AI. For example: "In Progress here means someone is
  working on it. Tickets stay in it 3 days on average." Each sentence says which numbers it
  comes from.
- **The PM's own rules.** Qale never edits this part. "Remember to..." in chat adds a line
  here, as it does today.

Rules for the AI part. A sentence is checked again only when the numbers it is based on
change. If the PM edited a sentence, Qale does not overwrite it. If its numbers change, Qale
asks once, showing the old and new numbers.

When drafting a ticket, about fifteen lines from this file go into the prompt: the live
labels and when they are used, the statuses, the required fields, how titles look, the sprint
length. Only when the session can write to Jira. The rest is read from the file or the
database when needed.

Facts about one customer, person or meeting series go on that page, not in this file. Email
domains on the customer page. Nickname and Jira account on the person page. How often a
meeting happens on the meeting series page.

### 3. Things only the PM can tell us

Put each one where it is used. What they are judged on and who they report to: on their own
person page. What Qale must never write or send, and which customers must never be named: in
house rules. Side deals: on that customer's page. Who has veto: on that person's page.

If we do not know one yet, the page shows one short line: "Not told yet." No counter, no
badge, nothing on Home.

### 4. When Qale asks

- **While drafting.** If Qale is unsure about one thing, it drafts the safe version and puts
  the question on the same card. "I left the label off. Should bugs get customer-reported?"
  The options are the values from the counts, plus "Something else". One click.
- **Right after connecting.** One conversation. Qale says what it found, with the numbers.
  "In NORD, 94% of bugs have customer-reported. So I will put it on bug drafts. Right?" The PM
  fixes anything wrong in a few words. Then Qale asks at most three things only they know:
  what they are judged on this quarter, which customers must never be named, what Qale must
  never write.
- **At the end of a session,** at most one line, only if that session hit something it did
  not know.
- **Never on a schedule.** No agent that asks questions on a clock. All five agents rejected
  that. If a kind of question is ignored twice, Qale stops asking it.

### 5. Remembering answers

- The answer is written to the page it belongs to. That is the memory.
- Qale keeps a record that it asked, with the date and the page it wrote to. So it never asks
  the same thing twice.
- When the PM edits a draft before approving it, Qale saves the before and after. The last few
  are shown to the AI when it drafts. If the same edit shows up twice, Qale suggests a rule and
  shows both edits. It never adds a rule on its own.
- "Remember to..." in chat still adds a rule line, as today.

### 6. Seeing and fixing what Qale believes

The file is the page. The Jira row in the sidebar opens it. The numbers part is read-only. The
rules part is editable. Every drafted ticket says in one line why it did what it did, with a
link to the sentence in the file. No new settings screen.

### 7. Cost

Counting is free. AI runs only when a number it used has changed, or the PM did something.
A quiet week costs nothing. Small models for labels, a mid model for the sentences, the big
model only when the PM starts a session.

## What the PM sees

The first drafted ticket has the right label and skips the dead ones. The card says why in
one sentence. They can open the file and change a line. They are never asked what Jira
already knows. They are asked three things once. It all works with Qale closed.

## What could go wrong

- **A label one person uses looks like a team rule.** Every sentence shows its count and who
  applies the label. A wrong sentence is fixed by editing the file, and the fix sticks.
- **The numbers file becomes a wall.** It stays one screen. The rest stays in the database.
- **A rule the PM wrote goes stale when the team changes.** Qale asks about it once, with old
  and new numbers, and does not rewrite it.
- **A project followed a month later starts cold.** Following a project triggers the same
  counting, which it already does today.

## Where the five agents disagreed

- **History.** One found the free way (save status changes as we see them). Three wanted to
  fetch old changelogs. Both, in that order.
- **How fine the "did it change" check is.** Two said per file. Two said per sentence. Per
  sentence, so one fix stays fixed and only the wrong sentence comes back.
- **One file per system or per project.** One said per project. Per system, split when big.
- **Questions on the draft card.** One agent proposed it. Adopted, because the PM gets the
  draft before the question.
- **Edits before approval.** Some would let the AI suggest rules from them. One would only show
  them to the AI. Both: show always, suggest a rule only with two examples.

## What needs a decision

1. Count in code, in the four ways above. No AI counting on a schedule.
2. One file per system with three parts, plus facts on customer and person pages.
3. A sentence is re-checked only when its numbers change. A sentence the PM edited is asked
   about, never overwritten.
4. Things only the PM knows go on their person page, house rules, or the customer page.
5. Questions ride on the draft card. One conversation after connecting, three questions max.
   No question agent.
6. Answers are written to pages. Edits before approval are saved and shown to the AI.
7. The file's name, and what the sidebar row calls it.
