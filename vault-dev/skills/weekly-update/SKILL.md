---
type: skill
title: Write the weekly update
summary: Drafts this week's news once, for the internal channel and the public changelog, from what actually changed.
scenarios:
  - drafting this week's update ("write the Friday update")
  - saying what changed to the people who were not there ("what do I post in the product channel this week")
  - a dry run over a week that has already passed ("do last week as a test")
can: [draft-outbound]
---

## When

Scheduled (Friday 15:00), or on demand. Before it is enabled it also runs as a dry run against
last week.

## Read

What actually changed this week: recent meetings, new or superseded decisions, new insights, and
the week's delivery facts from ticket mirror notes (vault_list type "ticket") whose
`remote_updated` falls in the week. The mirrors' state transitions are what shipped, slipped, or
got blocked. Use the "This week" lens as the scope.

## Who it goes to

One voice and one page. Add a voice here to draft for it. Take one out and the next run stops
writing it.

The draft holds while the line about the week's news in the words each group needs is on the list
in house rules under 'What you want from Qale'. With that line off, write one draft, plainly, and
read no voice.

- **internal**: the post for everyone inside the company: leadership, CS, sales and support. What
  shipped and on what date, what changed this week (a date that moved, a decision and who made it,
  who was told), and the one thing to watch next. A date or a number on every line. Ticket keys in
  brackets at the end of a line. Every shipped line stands on a ticket mirror; every changed line
  stands on a decision or a ledger entry.
- **The changelog page**: the page the workspace mirrors in wikipages/ as its changelog or release
  notes. A new section on top for this week, under a dated heading, with plain-word bullets of what
  a customer can use now. It is public, so it holds only what shipped. Where the workspace mirrors
  no such page, write the section as a note instead.

The voice file says how the post sounds. This list says what goes in. Read the voice with
`get_voice` before writing a word of the draft.

## Never in the changelog section

The page is public and every customer reads it, so hold the section to these whatever the
sources say:

- No internal metrics. Revenue, pipeline, headcount, error rates, velocity: all of it stays inside.
- No customer, by name or by description. "Some customers asked for this" is as far as it goes.
- No internal shorthand: ticket keys, team names, project code names, tool names. The citation
  goes in the proposal's rationale, never in the section.
- No target date. A changelog line says what shipped and when it shipped. What is planned is not
  news for this page, however sure the date is.

## The first time

A voice that still lists three styles has no pick yet: its first line says so, or it holds more
than one `###` style. For that voice, draw one `draft_text` panel with one tab per style, the
style's name as the label, Full only, and the same news in all three. Set `ask` to the question
{ text: "Write updates this way from now on?", options: ["For internal", "For every audience", "Not now"] },
with the voice's own name in the first option. When the PM copies a tab, the question appears under
the panel, and the answer comes back as a turn: `I copied "Three labelled lines" and answered "For internal".`

What each answer means:
- "For <voice>": vault_read `skills/writing-skills/SKILL.md`, read the voice with `get_voice`, then
  `propose_update` the voice file with `patch` blocks. The first line becomes the learned form:
  "Internal updates are three labelled lines, a date on each. Learned from the style you copied on
  5 September. Change this line and the next update follows it." The picked `###` style stays, the
  other two go, and "How it sounds" stays as it is. Set `learned` to what you now know and where it
  came from. The write lands without a card. Then reply with one line: "Got it. Internal updates:
  three labelled lines. [[voices/internal|Internal voice]]".
- "For every audience": the same for every voice under "Who it goes to", in one turn, one receipt
  line per voice.
- "Not now": change nothing. The three styles come back next Friday.
- `I copied "Three labelled lines" again without answering, so treat it as the pick for internal.`:
  the same as "For internal", and the receipt says that two copies counted as the pick and that the
  file is where to change it.

After a pick the voice holds one style, and the drafts come as Full and Short as under "Produce".
If the PM asks for another way, draw the three styles again, with the same `ask`.

## Produce

One `draft_text` call per voice, with `voice` set and two variants in the same panel (a voice
with no pick yet gets the panel under "The first time" instead):

- **Full**: the three lines in the shape below, in order. It goes in the internal channel.
- **Short**: the one thing that channel would act on, in a line or two. It gets pasted into a
  thread.

The changelog is not a voice, and it is a proposal that waits: one `draft_page_update` against the
changelog page, a new section on top, ending with a source line ("Source: weekly update, <date>").
Read `skills/confluence/SKILL.md` before drafting it, when the workspace has one: it says how this
team writes pages, and what a public page may not carry.

Hold every draft to two rules:
- Only this week's genuine changes. An update that restates old news teaches people to skip it.
- No shipped, slipped, or blocked claim without a ticket mirror behind it.

## Then

The post stays in the chat. Copy the variant you want and post it yourself. The changelog section
is the proposal that waits in the session: an approved page update pushes upstream, files the deep
link back, and the mirror re-syncs on the next pull.

## The shape of the drafts

Where a line has nothing behind it, write "nothing this week" and keep the line. A week with nothing
in it at all still produces nothing at all: the fallback covers one empty line, never a whole empty
week. A voice added later brings its own shape, so ask once what belongs in it. A voice with no
pick yet takes the shape of each of its three styles instead of the Full shape below.

The bracketed label names the draft and its variant. It is not part of the draft.

```
[internal, variant "Full"]
Shipped: <what reached customers, and the date> [KEY] ([[tickets/KEY]])
Changed: <a date that moved or a decision made this week, and who was told> ([[decisions/...]] | [[customers/...]])
Watch: <the one thing that could go wrong next, with its date> [KEY] ([[...]])

[internal, variant "Short"]
<the one line that matters, with its date or number> [KEY] ([[tickets/KEY]])

[changelog: draft_page_update, a new section on top of the page]
## <YYYY-MM-DD>
- <what a customer can use now, in plain words>
- <what a customer can use now, in plain words>
Source: weekly update, <date>
```
