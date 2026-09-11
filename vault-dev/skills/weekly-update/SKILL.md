---
type: skill
title: Write the weekly update
summary: Drafts this week's news once, for the internal channel and the public changelog, from what actually changed.
scenarios:
  - drafting this week's update ("write the Friday update")
  - saying what changed to the people who were not there ("what do I post in #product-updates this week")
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

The draft holds while the line about the week's news for the internal channel and the public
changelog is on the list in house rules under 'What you want from Qale'. With that line off, write
one draft, plainly, and read no voice.

- **internal**: the `#product-updates` post, for leadership, CS, sales and support. What shipped
  and on what date, what changed this week (a date that moved, a decision and who made it, who was
  told), and the one thing to watch next. A date or a number on every line. Ticket keys in
  brackets at the end of a line. Every shipped line stands on a ticket mirror; every changed line
  stands on a decision or a ledger entry.
- **The Changelog page** (`wikipages/confluence/changelog.md`): a new section on top for this
  week, under a dated heading, with plain-word bullets of what a restaurant can use now. It is
  public, so it holds only what shipped.

The voice file says how the post sounds. This list says what goes in. Read the voice with
`get_voice` before writing a word of the draft.

## Never in the changelog section

The page is public and every restaurant reads it, so hold the section to these whatever the
sources say:

- No internal metrics. Revenue, pipeline, headcount, error rates, velocity: all of it stays inside.
- No customer, by name or by description. "Some restaurants asked for this" is as far as it goes.
- No internal shorthand: ticket keys, team names, project code names, tool names. The citation
  goes in the proposal's rationale, never in the section.
- No target date. A changelog line says what shipped and when it shipped. What is planned is not
  news for this page, however sure the date is.

## Produce

One `draft_text` call for `internal`, with `voice` set and two variants in the same panel:

- **Full**: the three lines in the shape below, in order. It goes in `#product-updates`.
- **Short**: the one thing that channel would act on, in a line or two. It gets pasted into a
  thread.

The Changelog is not a voice, and it is a proposal that waits: one `draft_page_update` against
the Changelog page, a new section on top, ending with a source line ("Source: weekly update,
<date>"). Read `skills/confluence/SKILL.md` before drafting it: it says how this team writes pages,
and what a public page may not carry.

Hold every draft to two rules:
- Only this week's genuine changes. An update that restates old news teaches people to skip it.
- No shipped, slipped, or blocked claim without a ticket mirror behind it.

## Then

The post stays in the chat. Copy the variant you want and post it yourself. The Changelog section
is the proposal that waits in the session: an approved page update pushes upstream, files the deep
link back, and the mirror re-syncs on the next pull.

## The shape of the drafts

Where a line has nothing behind it, write "nothing this week" and keep the line. A week with nothing
in it at all still produces nothing at all: the fallback covers one empty line, never a whole empty
week. A voice added later brings its own shape, so ask once what belongs in it.

The bracketed label names the draft and its variant. It is not part of the draft.

```
[internal, variant "Full"]
Shipped: <what reached restaurants, and the date> [KEY] ([[tickets/KEY]])
Changed: <a date that moved or a decision made this week, and who was told> ([[decisions/...]] | [[customers/...]])
Watch: <the one thing that could go wrong next, with its date> [KEY] ([[...]])

[internal, variant "Short"]
<the one line that matters, with its date or number> [KEY] ([[tickets/KEY]])

[changelog: draft_page_update, a new section on top of the page]
## <YYYY-MM-DD>
- <what a restaurant can use now, in plain words>
- <what a restaurant can use now, in plain words>
Source: weekly update, <date>
```
