---
type: skill
title: Write the weekly update
summary: Drafts this week's update for each audience, from what actually changed.
scenarios:
  - drafting this week's update for each audience ("write the Friday update")
  - saying what changed to the people who were not there ("what do I tell the exec team about this week")
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

One draft per voice in this list, and what belongs in each. Add a voice here to draft for it. Take
one out and the next run stops writing it.

One draft per voice holds while the line about the week's news in the words each group needs is
on the list in house rules under 'What you want from Qale'. With that line off, write one draft,
plainly, and read no voice.

- **exec**: the decisions and who made them, what reached customers, and the one thing that could
  go wrong next. Put a number on it wherever a number exists: the date, the count, the money at
  risk. Leave the process out.
- **cs**: what customers can use today and since when, what is promised and on what date, and what
  they keep asking about that nothing commits to. Say the uncertain part out loud instead of
  over-promising. Every "live now" and "committed" line stands on a shipped ticket or a decision.
- **sales**: the dates that changed this week, and nothing else. What a deal can now point to, what
  slipped and to when, and what still has no date. No process, no reasoning: sales relays this
  verbatim to an account.

The voice file says how each one sounds. This list says what goes in. Read the voice with
`get_voice` before writing a word of that draft.

## Never in the CS draft

It gets forwarded word for word, so hold it to these whatever the sources say:

- No internal metrics. Revenue, pipeline, headcount, error rates, velocity: all of it stays inside.
- No other customer, by name or by description. "Other teams have asked for this too" is as far as
  it goes.
- No internal shorthand in the sentence itself: ticket keys, team names, project code names, tool
  names. The wikilink at the end of a line is the citation, and it comes off before the text is
  pasted to anyone.
- No date that nothing backs. No decision and no shipped ticket means no date.

## The first time

A voice that still lists three styles has no pick yet: its first line says so, or it holds more
than one `###` style. For that voice, draw one `draft_text` panel with one tab per style, the
style's name as the label, Full only, and the same news in all three. Set `ask` to the question
{ text: "Write updates this way from now on?", options: ["For exec", "For every audience", "Not now"] },
with the voice's own name in the first option. When the PM copies a tab, the question appears under
the panel, and the answer comes back as a turn: `I copied "One paragraph" and answered "For exec".`

What each answer means:
- "For <voice>": vault_read `skills/writing-skills/SKILL.md`, read the voice with `get_voice`, then
  `propose_update` the voice file with `patch` blocks. The first line becomes the learned form:
  "Exec updates are one paragraph, result first. Learned from the style you copied on 5 September.
  Change this line and the next update follows it." The picked `###` style stays, the other two go,
  and "How it sounds" stays as it is. Set `learned` to what you now know and where it came from.
  The write lands without a card. Then reply with one line: "Got it. Exec updates: one paragraph,
  result first. [[voices/exec|Exec voice]]".
- "For every audience": the same for every voice under "Who it goes to", in one turn, one receipt
  line per voice.
- "Not now": change nothing. The three styles come back next Friday.
- `I copied "One paragraph" again without answering, so treat it as the pick for exec.`: the same
  as "For exec", and the receipt says that two copies counted as the pick and that the file is
  where to change it.

After a pick the voice holds one style, and the drafts come as Full and Short as under "Produce".
If the PM asks for another way, draw the three styles again, with the same `ask`.

## Produce

One `draft_text` call per voice, with `voice` set and two variants in the same panel (a voice
with no pick yet gets the panel under "The first time" instead):

- **Full**: every heading in the shape below, in order. It goes in the mail.
- **Short**: the one thing that audience would act on, in a line or two. It gets pasted into a
  chat.

The team page is not a voice, and it is a proposal that lands: shipped, slipped, and why, grounded in
the week's ticket transitions and linking the decisions and mirrors. Where a status or update page
mirrored in wikipages/ is the update's home, propose a draft_page_update against that page,
ending with a source line ("Source: weekly update, <date>"). Otherwise write it as a note. Read
`skills/confluence/SKILL.md` before drafting the page update, when the workspace has one: it says
how this team writes pages.

Hold every draft to two rules:
- Only this week's genuine changes. An update that restates old news teaches people to skip it.
- No shipped, slipped, or blocked claim without a ticket mirror behind it.

## Then

The per-voice drafts stay in the chat. Copy the one you want and send it yourself. The team page is
the proposal that waits in the session: an approved wikipage update pushes upstream, files the deep link
back, and the mirror re-syncs on the next pull.

## The shape of the drafts

Where a line has nothing behind it, write "nothing this week" and keep the line. A week with nothing
in it at all still produces nothing at all: the fallback covers one empty line, never a whole empty
week. A voice added later brings its own shape, so ask once what belongs in it. A voice with no
pick yet takes the shape of each of its three styles instead of the Full shape below.

The bracketed label names the draft and its variant. It is not part of the draft.

```
[exec, variant "Full"]
Decided: <what was decided, and who decided it> ([[decisions/...]])
Shipped: <what reached customers> ([[tickets/KEY]])
Watch: <the one thing that could go wrong next> ([[...]])

[exec, variant "Short"]
<the one line that matters, with its number> ([[decisions/...]])

[cs, variant "Full"]
Live now: <what customers can use today, and since when> ([[tickets/KEY]])
Committed: <what is promised, and the date> ([[decisions/...]])
No date yet: <what they keep asking about that nothing commits to>

[cs, variant "Short"]
<the one change customers will notice, and when> ([[tickets/KEY]])

[sales, variant "Full"]
Now: <what an account can be told is live, and since when> ([[tickets/KEY]])
Changed: <a date that moved this week, old date to new> ([[decisions/...]])
No date: <what still has nothing to promise>

[sales, variant "Short"]
<the one date to relay this week> ([[decisions/...]])

[team: draft_page_update, or a note]
## Shipped
- <KEY title>: <state last Friday> to <state now> ([[tickets/KEY]])
## Slipped or blocked
- <KEY title>: <what moved it, from the mirror> ([[tickets/KEY]])
## Decided
- <the decision, and the decider> ([[decisions/...]])
## Open
- <what this week left unanswered> ([[...]])
```
