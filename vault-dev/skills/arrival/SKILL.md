---
type: skill
starts: [you-run-it, model-picks-it-up]
title: Handle new material
summary: Files what you just dropped in, and reads what is worth reading.
can: [file-material, keep-working-files, draft-outbound]
---

## When
Someone handed material over and it is sitting in your session folder, unfiled: files, pasted
text, screenshots, one thing or forty. Work out what each one is, put it where it belongs, and
read the ones that still have something live in them.

Nothing is filed yet, and that is deliberate. Filing used to be done by rules that guessed before
anything had read the material, and every one of those guesses was wrong sometimes. You can just
look.

Also used on material that is already filed, when the PM asks for a meeting to be read from its
own page. Then skip the filing and go straight to the reading.

## What the PM asked for wins
Whatever they typed when they handed the material over beats every rule below, in both directions.
"Just file these, no reviews" files them without reading. "Review them anyway" reads month-old
material without argument. If they aimed the drop at a folder or a meeting, that is the same kind
of instruction and it settles the question: do not ask it again.

## Read
Start with `files_list` and `arrival.md`, which lists what arrived. Then skim each piece: enough
to know what it is, who is in it, when it happened, and whether anything in it is still live. A
transcript's first few hundred lines say far more than its file name does.

Then only the memory it touches: the customer page, the theme hubs it names, live decisions it
might contradict (search_vault), and the mirror notes (tickets/) of any ticket it mentions.
Anything you say about delivery comes from mirror state, never from memory of it.

For a link, work from the URL and whatever the PM pasted with it; do not guess what the page says.
For a screenshot, work from what you can see and say so in the caption.

## File
Use `file_material`, once per THING rather than once per file, and say in one line where each one
went and why as you go. A filing nobody can see is a filing nobody can correct.

- **A transcript of a meeting the PM was in** goes to `meetings/` (`as: "meeting"`). If the
  calendar already holds that meeting, pass `attach_to` with its path instead of making a second
  page for one conversation.
- **Everything else** goes to `sources/` (`as: "source"`): a colleague's call, an article, a
  spec, a pasted thread, a screenshot.
- A recording that arrived in two files is ONE meeting. Name both files in one call, in order.
- Got it wrong, or the PM says you did? `refile_material` moves it. Correcting a filing is as
  much your job as making it.

**Matching a meeting.** Match on what the transcript itself says: its own date, its title, who
speaks in it. The clock is a hint and never the decider. If two meetings could plausibly be it, or
none can, ask (`ask_user`) with the candidates and "a new meeting" as options. A wrong match is
expensive to unpick and the question costs one click.

**Not the PM's meeting.** If the PM never speaks and was not invited, it is somebody else's
meeting: file it as a source with `origin` set to whose it was, and never draft anything in their
voice over it. If you cannot tell, ask.

**Already here?** Before filing, check whether this material is already in the workspace, by name,
date and content (`search_vault`, `vault_list`). If it is, say so and stop, and offer to add it
anyway. Two copies of one meeting is two sets of cards for one conversation.

## Read what is worth reading
Fresh material about live work earns a full read. A backlog earns filing plus a skim. Material
that has already been through this does not earn a second pass: a source carrying
`processing: processed` had its commitments proposed once, so do not propose them again, and when
a meeting already holds transcripts read only the ones that are new.

**Up to five pieces: read them yourself.** More than five, or names that say the material is old,
treat it as a backlog:
- Write `brief.md` first: what the workspace currently believes, the themes in play, what a good
  reading looks like. Every child reads it, and without it a reader handed one document in
  isolation cannot tell a new fact from a contradiction.
- `spawn` one skim per piece on a quick model. Each child returns the title, the date, what kind
  of thing it is, and whose voice is in it.
- File from the results, start full reads only where something looks live, and say plainly what
  you skipped and why.

## Produce
The smallest set of approval cards the material actually forces. Filing is not a card; everything
you write ABOUT the material is. One finding, one card, however many documents it spans.

**A meeting the PM was in:**
- **Decisions** made in the meeting, with the decider and the reason (propose_decision). Set
  `supersedes` when it reverses an earlier decision. If there is no clear decider or date, ask
  before drafting; a line someone said out loud is not a decision record yet.
- **Commitments**: every "I'll do X" becomes a todo (propose_todo) citing the meeting with the
  verbatim quote. The PM's own commitments get no `owner`; for anyone else's, set `owner` to that
  person. Set `due` only if a date was named or clearly implied. Check existing todos first
  (vault_list type "todo") so you do not file a duplicate.
- **A meeting summary** on the meeting page (propose_update), plus the hub updates it implies:
  actions, open questions, things explicitly not being done, and `last_told` entries on the people
  pages.
- **External consequences**, only where the meeting forces one: a comment on a linked ticket the
  meeting settles or dates (draft_jira_comment), a ticket for agreed work nothing covers
  (draft_jira_issue), a follow-up that was actually booked with a real time (draft_calendar_event).
  "We should meet again" is not a booking. Most meetings force none of these; skip them rather
  than manufacture them. Every outbound draft cites its evidence, ends with a source line
  ("Source: <meeting>, <date>"), sets linkBack to the meeting page, and follows the voice guides.
  Outbound is always draft-and-approve; nothing sends itself.

**A meeting the PM was not in**, such as a colleague's sales call:
- Commitments anyone made, as todos with `owner` set and the verbatim quote.
- Customer signals worth keeping, onto the customer hub (propose_update).
- Who was told what, onto the `last_told` ledger, attributing the speaker.
- Never a decision, and never outbound. A meeting the PM was not in cannot create product truth,
  and nothing said in it licenses writing in their voice. If someone promised something on the
  product's behalf ("we told them SCIM lands in Q3"), make that its own card marked "promised
  externally, confirm or correct". Do not file it silently.

**A link, screenshot, or pasted thread**: the source body is immutable, so never propose edits to
it. Instead:
- Add links to it from the hubs it concerns (propose_update), where it genuinely adds signal.
- File any commitment or date hiding in it as a todo.
- If it names a person or customer with no page yet, ask before creating one.
- If you cannot tell what it is for, ask one concrete question instead of guessing.

Tag every proposed note with 1-2 contexts (`tags`) drawn from tags already in use; name any
brand-new tag in the card's rationale.

For every card, in every branch:
- Every claim is grounded: it quotes the material or cites existing memory. Nothing uncited.
- Grounded is not the same as pasted. Say the thing in your own voice and cite what it rests on;
  the verbatim text stays in sources/ where anyone can open it. Quote inline only where the exact
  wording is the finding, which is why a commitment carries its quote: what someone promised, in
  the words they promised it, is the record. A card assembled out of quotes has not done the work.
- A claim that contradicts a live decision or insight becomes its own flag card, never a rewrite.
  Contradictions are the most valuable thing this session can find.
- If the material is empty, or nothing in it needs to happen and nothing contradicts the memory,
  say so and propose nothing. An empty result is correct when the material forces nothing.

This is extraction, not analysis. Record what is literally there. A pattern you find by holding two
documents up against each other is a guess; that comparison is the synthesis skill's work, and it
reads many documents against a question.

## Then
The material is filed and stays filed. Approved cards land everything else: the decision spine, the
commitment ledger, the hubs, the meeting page. Approved outbound executes upstream and files its
link back. Each source flips new → processed when an approved card cites it.

Nobody may be watching. If the job turned out to be pure filing, with nothing to review, nothing to
flag and nothing to ask, say the one line about where things went and call `end_quietly`. If you
did ask something, the question waits and they answer when they come back.
