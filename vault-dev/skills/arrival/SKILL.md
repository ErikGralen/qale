---
type: skill
title: Handle new sources
summary: Files what you just dropped in, and reads what is worth reading.
scenarios:
  - putting sources that just arrived where they belong ("file this transcript")
  - going through a drop of new files and pulling out what they commit us to ("I dropped three recordings in, work through them")
  - reading one meeting from its own page ("read the Café Nord meeting and write it up")
can: [file-source, keep-working-files, draft-outbound, draft-calendar, track-external]
---

## When

Someone handed sources over and they are sitting in the session folder, unfiled: files, pasted
text, screenshots, one thing or forty. Work out what each one is, put it where it belongs, and
read the ones that still have something live in them. Nothing is pre-filed on purpose, so look
first.

Also used on a source that is already filed, when you ask for a meeting to be read from its
own page. Then skip the filing and go straight to the reading.

## What you asked for wins

Whatever you typed when you handed the sources over beats every rule below.
"Just file these, no reviews" files them without reading. "Review them anyway" reads month-old
sources without argument. A drop aimed at a folder or a meeting is the same kind of
instruction: it settles the question, so do not ask it again.

## Read

Start with `files_list` and `input.md`, which lists what arrived. Then skim each piece: enough
to know what it is, who is in it, when it happened, and whether anything in it is still live.

Then only the memory it touches. Open the `index.md` of each folder first: customers, people,
meetings, research, decisions, and `tickets/` for any ticket it names. Then read the memory pages
the source actually names, five at the outside. A one-line description in a map is enough to place
a page; open the page only when what you write depends on the words in it.

For a link, work from the URL and whatever came pasted with it; do not guess what the page says.
For a screenshot, work from what is visible and say so in the summary.

## File

Use `file_source`, once per THING rather than once per file. The trail already shows where each
one went, so your reply never walks through the filing.

- **A recording of a meeting you were in** goes in as `as: "meeting"`: the transcript is kept in
  `sources/`, and no meeting page is made. If the calendar already holds that meeting, pass
  `attach_to` with its path. If nothing holds it, propose the page once the source is read.
- **Everything else** goes to `sources/` (`as: "source"`), with a `summary`: what it says, in
  your own words, a few lines. It sits at the top of the source page and the original goes
  underneath, so the source is the one address for both. One call per source, so each keeps its
  own summary.
- A recording that arrived in two files is ONE meeting. Name both files in one call, in order.
- Got the filing wrong? `refile_source` moves it.

Only the source files itself. Every page this session writes lands as you write it, the meeting
page included. Write the meeting page first, as soon as you have read the source and the meetings
map, and before you check the claims. Write it on its own and read the result: the todos and the
decisions cite the page it reports, and a citation only resolves once that page exists.

**Matching a meeting.** Match on what the transcript itself says: its own date, its title, who
speaks in it. The clock is a hint and never the decider. If two meetings could plausibly be it,
or none can, ask with the candidates and "a new meeting" as options.

**Not your meeting.** If you never speak in it and were not invited, it is somebody else's
meeting: file it as a source with `origin` set to whose it was, and never draft anything in their
voice over it. If that is not clear, ask.

**Their own writing.** A note, a draft or an export the PM wrote themselves is still a source: it
lands under `sources/`, never in `notes/`. Set `origin` to their own name. Every citation of it
then says "your note from March" instead of implying somebody else wrote it.

**Already here?** Before filing, check whether this source is already in the workspace, by
name, date and content. If it is, say so and stop, and offer to add it anyway.

## Read what is worth reading

A fresh source about live work earns a full read. A backlog earns filing plus a skim. A source
carrying `processing: processed` had its commitments proposed once, so do not propose them
again, and when a meeting already holds transcripts read only the ones that are new.

Up to five pieces: read them in this session. More than five, or names that say the source is
old, treat it as a backlog:
- Write `brief.md` first: what the workspace currently believes, the research pages in play, what
  a good reading looks like. Every child reads it.
- `spawn` one skim per piece on a quick model. Each child returns the title, the date, what kind
  of thing it is, and whose voice is in it.
- File from the results, start full reads only where something looks live, and say plainly what
  was skipped and why.

## Check what it claims

Before you propose the todos and the decisions from a source, write out what it claims and call
`check_claims` once: who committed to what, dates, owners, numbers, decisions. One claim per entry, in the words the
source used, each scoped to the pages it is about (the meeting, the customer, the research page) or to
a tag.

Each one comes back as already known (do nothing), new (propose it below as you would anyway), in
conflict with a note we hold, implying something that is not there, or no answer. No answer means
nothing was settled, so treat it as if you had never asked.

A conflict is a question every time, asked before you write either side: what the material says,
the note as a link, one question, and the two answers as options. Write what they chose and set
`asked`. A gap you can fill from the source is not a question at all; fill it. A gap only the PM
can fill can earn one. Ask about their world, never about our filing. The answer says how many of
them to ask.

## Produce

The smallest set of proposals the source actually forces. Filing is not a proposal; everything
written ABOUT the source is. One finding, one proposal, however many documents it spans.
Once you know what the source forces, propose it all together rather than one at a time. The
meeting page is the exception: it goes first, on its own.

Before you decide what a meeting forces, read the list in house rules under 'What you want from
Qale'. With the line about who is waiting on, check the customer and people pages for anyone
whose last update touches what the meeting changed, and propose those updates and a todo naming
who to tell. With it off, file the meeting, the decisions and the todos, and propose none of that.
With the line about writing the actions into Jira and Confluence on, propose the outbound cards.
With it off, stop at the todos.

**A meeting you were in:**
- **The meeting page itself** (propose_meeting), when nothing already holds this meeting: one
  write carrying the whole page, with the write-up in it, and the transcript named. Where the
  calendar already holds the page, the write-up goes onto it instead (propose_update). Either
  way it is one write: never a blank page followed by an edit to it.
- **Who was in it**: set `participants` from whoever speaks in the transcript plus anyone it
  says was in the room: a `[[people/…]]` ref where the person has a page, their plain name
  where they do not. A plain name lands as a chip you turn into a page in one click, so do not
  propose a person page per name. The proposal is refused without participants. If the source
  genuinely names nobody, only "Speaker 1" and the like, set `participants_unknown` and say so.
  On a page the calendar already holds, leave `participants` alone: it comes from the invite,
  and the next sync overwrites anything else.
- **Decisions** made in the meeting, with the decider and the reason (propose_decision). Set
  `supersedes` when it reverses an earlier decision. No clear decider or date: ask before
  drafting. A line someone said out loud is not a decision record yet.
- **Commitments**: every "I'll do X" becomes a todo (propose_todo) citing the meeting with the
  verbatim quote. Your own commitments get no `owner`; anyone else's sets `owner` to that
  person. Set `due` only if a date was named or clearly implied. Check existing todos first so
  no duplicate gets filed.
- **The hub updates the meeting implies**: actions, open questions, things explicitly not being
  done, and `last_told` entries on the people pages.
- **External consequences**, only where the meeting forces one: a comment on a linked ticket the
  meeting settles or dates (draft_ticket_comment), a ticket for agreed work nothing covers
  (draft_ticket), a follow-up that was actually booked with a real time (draft_calendar_event).
  "We should meet again" is not a booking. Most meetings force none of these; skip them rather
  than manufacture them. Every outbound draft ends with a source line
  ("Source: <meeting>, <date>"), sets linkBack to the meeting page, and follows the voice
  guides. Read `skills/jira/SKILL.md` before drafting a ticket or a comment, when the workspace
  has one: it says how this team writes them.

**A meeting you were not in**, such as a colleague's sales call:
- Commitments anyone made, as todos with `owner` set and the verbatim quote.
- Customer signals worth keeping, onto the customer hub (propose_update).
- Who was told what, onto the `last_told` ledger, attributing the speaker.
- Never a decision, and never outbound. A meeting you were not in cannot create product truth,
  and nothing said in it licenses writing in their voice. If someone promised something on the
  product's behalf, make that its own proposal marked "promised externally, confirm or correct".

**A link, screenshot, or pasted thread**: its summary went on the source as you filed it, so the
source is finished and nothing more is written about it. Never propose a note that only says what
one source says, and never propose an edit to a source: the body is immutable. Then:
- Add links to it from the hubs it concerns (propose_update), where it genuinely adds signal. A
  signal about a problem extends the research page for that problem, if one exists; otherwise
  tag the insight and leave it. One signal makes no page.
- File any commitment or date hiding in it as a todo.
- If it names a person or customer with no page yet, ask before creating one.
- If what it is for is not clear, ask one concrete question instead of guessing.

Tag every proposed note with 1-2 contexts (`tags`) drawn from tags already in use; name any
brand-new tag in the proposal's rationale.

This is extraction, not analysis: record what is literally there. A pattern found by holding two
documents up against each other is the synthesis skill's work.

## Then

The sources are filed and stay filed. The meeting page, the decisions, the todos and the hub edits
land as you write them, and the chat lists them above your message. Anything sent to Jira,
Confluence or the calendar waits for the PM, and executes upstream on approval, then files its
link back. Each source flips new → processed when a write citing it lands.

Then say what the source meant, in two or three sentences: the finding first, the writing itself in
one clause, and the one thing that needs the PM, if there is one. Name any assumption you had to
make. What you filed and what you wrote is already on the screen above and below your message, so
never list it.
