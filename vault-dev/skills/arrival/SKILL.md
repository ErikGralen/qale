---
type: skill
title: Handle new material
summary: Files what you just dropped in, and reads what is worth reading.
scenarios:
  - putting material that just arrived where it belongs ("file this transcript")
  - going through a drop of new files and pulling out what they commit us to ("I dropped three recordings in, work through them")
  - reading one meeting from its own page ("read the Nordkap meeting and write it up")
can: [file-material, keep-working-files, draft-outbound, draft-calendar, track-external]
---

## When

Someone handed material over and it is sitting in the session folder, unfiled: files, pasted
text, screenshots, one thing or forty. Work out what each one is, put it where it belongs, and
read the ones that still have something live in them. Nothing is pre-filed on purpose, so look
first.

Also used on material that is already filed, when you ask for a meeting to be read from its
own page. Then skip the filing and go straight to the reading.

## What you asked for wins

Whatever you typed when you handed the material over beats every rule below.
"Just file these, no reviews" files them without reading. "Review them anyway" reads month-old
material without argument. A drop aimed at a folder or a meeting is the same kind of
instruction: it settles the question, so do not ask it again.

## Read

Start with `files_list` and `input.md`, which lists what arrived. Then skim each piece: enough
to know what it is, who is in it, when it happened, and whether anything in it is still live.

Then only the memory it touches: the customer page, the theme hubs it names, live decisions it
might contradict, and the mirror notes (tickets/) of any ticket it mentions.

For a link, work from the URL and whatever came pasted with it; do not guess what the page says.
For a screenshot, work from what is visible and say so in the caption.

## File

Use `file_material`, once per THING rather than once per file, and say in one line where each one
went and why as it lands.

- **A recording of a meeting you were in** goes in as `as: "meeting"`: the transcript is kept in
  `sources/`, and no meeting page is made. If the calendar already holds that meeting, pass
  `attach_to` with its path. If nothing holds it, propose the page once the material is read.
- **Everything else** goes to `sources/` (`as: "source"`).
- A recording that arrived in two files is ONE meeting. Name both files in one call, in order.
- Got the filing wrong? `refile_material` moves it.

Only the material files itself. Every page this session writes is a card, the meeting page
included. A card may cite a page another card would create, so propose the meeting first and let
the todos and decisions from it cite the meeting.

**Matching a meeting.** Match on what the transcript itself says: its own date, its title, who
speaks in it. The clock is a hint and never the decider. If two meetings could plausibly be it,
or none can, ask with the candidates and "a new meeting" as options.

**Not your meeting.** If you never speak in it and were not invited, it is somebody else's
meeting: file it as a source with `origin` set to whose it was, and never draft anything in their
voice over it. If that is not clear, ask.

**Already here?** Before filing, check whether this material is already in the workspace, by
name, date and content. If it is, say so and stop, and offer to add it anyway.

## Read what is worth reading

Fresh material about live work earns a full read. A backlog earns filing plus a skim. A source
carrying `processing: processed` had its commitments proposed once, so do not propose them
again, and when a meeting already holds transcripts read only the ones that are new.

Up to five pieces: read them in this session. More than five, or names that say the material is
old, treat it as a backlog:
- Write `brief.md` first: what the workspace currently believes, the themes in play, what a good
  reading looks like. Every child reads it.
- `spawn` one skim per piece on a quick model. Each child returns the title, the date, what kind
  of thing it is, and whose voice is in it.
- File from the results, start full reads only where something looks live, and say plainly what
  was skipped and why.

## Produce

The smallest set of approval cards the material actually forces. Filing is not a card; everything
written ABOUT the material is. One finding, one card, however many documents it spans.

**A meeting you were in:**
- **Decisions** made in the meeting, with the decider and the reason (propose_decision). Set
  `supersedes` when it reverses an earlier decision. No clear decider or date: ask before
  drafting. A line someone said out loud is not a decision record yet.
- **Commitments**: every "I'll do X" becomes a todo (propose_todo) citing the meeting with the
  verbatim quote. Your own commitments get no `owner`; anyone else's sets `owner` to that
  person. Set `due` only if a date was named or clearly implied. Check existing todos first so
  no duplicate gets filed.
- **The meeting page itself** (propose_meeting), when nothing already holds this meeting: one
  card carrying the whole page, with the write-up in it, and the transcript named. Where the
  calendar already holds the page, the write-up goes onto it instead (propose_update). Either
  way it is one card: never a blank page followed by an edit to it.
- **Who was in it**: set `participants` from whoever speaks in the transcript plus anyone it
  says was in the room: a `[[people/…]]` ref where the person has a page, their plain name
  where they do not. A plain name lands as a chip you turn into a page in one click, so do not
  propose a person page per name. The card is refused without participants. If the material
  genuinely names nobody, only "Speaker 1" and the like, set `participants_unknown` and say so.
  On a page the calendar already holds, leave `participants` alone: it comes from the invite,
  and the next sync overwrites anything else.
- **The hub updates the meeting implies**: actions, open questions, things explicitly not being
  done, and `last_told` entries on the people pages.
- **External consequences**, only where the meeting forces one: a comment on a linked ticket the
  meeting settles or dates (draft_ticket_comment), a ticket for agreed work nothing covers
  (draft_ticket), a follow-up that was actually booked with a real time (draft_calendar_event).
  "We should meet again" is not a booking. Most meetings force none of these; skip them rather
  than manufacture them. Every outbound draft ends with a source line
  ("Source: <meeting>, <date>"), sets linkBack to the meeting page, and follows the voice
  guides.

**A meeting you were not in**, such as a colleague's sales call:
- Commitments anyone made, as todos with `owner` set and the verbatim quote.
- Customer signals worth keeping, onto the customer hub (propose_update).
- Who was told what, onto the `last_told` ledger, attributing the speaker.
- Never a decision, and never outbound. A meeting you were not in cannot create product truth,
  and nothing said in it licenses writing in their voice. If someone promised something on the
  product's behalf, make that its own card marked "promised externally, confirm or correct".

**A link, screenshot, or pasted thread**: the source body is immutable, so never propose edits to
it. Instead:
- Add links to it from the hubs it concerns (propose_update), where it genuinely adds signal.
- File any commitment or date hiding in it as a todo.
- If it names a person or customer with no page yet, ask before creating one.
- If what it is for is not clear, ask one concrete question instead of guessing.

Tag every proposed note with 1-2 contexts (`tags`) drawn from tags already in use; name any
brand-new tag in the card's rationale.

This is extraction, not analysis: record what is literally there. A pattern found by holding two
documents up against each other is the synthesis skill's work.

## Then

The material is filed and stays filed. Approved cards land everything else: the meeting page, the
decision spine, the commitment ledger, the hubs. Approved outbound executes upstream and files
its link back. Each source flips new → processed when an approved card cites it.
