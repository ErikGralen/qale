---
type: skill
title: Tidy a rough note
summary: Turns a scratch dump into a clean page and updates what it touches.
scenarios:
  - cleaning up a rough note somebody typed by hand ("tidy up my notes from that call")
  - a note that was processed before and has new raw lines at the bottom ("I added more to that note, run it again")
  - turning a day of scratch lines into a page that links what it mentions ("clean up today's log")
---

## When

You dumped rough text into a note (half-sentences from a call, a day's running log) and hit
"Go through this document" on the document page. Re-runs are normal: yesterday's processed note with
today's raw additions at the bottom.

## Read

The note first. Then the memory it touches: search_vault for the people, customers, research pages, and
decisions it mentions. Existing wikilinks mean an earlier run already handled those parts; leave
them alone and work on what is new or still raw.

## Check what it claims

Before you propose anything, write out what the dump asserts and call `check_claims` once: who
committed to what, dates, owners, numbers, decisions. One claim per entry, in the words the dump
used, each scoped to the pages it is about or to a tag.

Each one comes back as already known (do nothing), new (file it below as you would anyway), in
conflict with a note we hold, implying something that is not there, or no answer. No answer means
nothing was settled, so treat it as if you had never asked.

A conflict or a gap can earn one short question about their world, never about our filing. The
answer says how many of them to ask.

## Produce

Each piece its own proposal:
- **The note itself**, as one propose_update: fix typos and half-sentences, group related lines
  under short headings, and turn plain-text mentions into wikilinks to pages that exist. This is
  a copy edit, not a rewrite: keep your wording and your meaning, and add nothing the dump does
  not say. If the note is untitled or its title no longer fits, set the proposal's `title` to a short
  descriptive one.
- **Updates to other notes**: the customer hub the dump adds signal to, an open question elsewhere
  it answers, a person's `last_told` when it says who was told what. A signal about a problem
  extends the research page for that problem, if one exists; otherwise tag the insight and
  leave it. One signal makes no page.
- **New notes the dump implies**: commitments become todos (propose_todo, with `owner` when
  someone else owes it), claims worth keeping become insights (propose_note type insight), and a
  real decision with a named decider becomes a decision proposal (propose_decision). A line with no
  decider is not a decision yet; ask first. Every new note cites this one.

If a fragment is ambiguous, keep it verbatim and ask one concrete question. Guessing what you
meant puts words in your notes.

## Then

Approved proposals clean the note and propagate it: hubs updated, loops closed, new todos, insights,
and decisions filed. The note stays your scratch pad. More gets dumped, the button gets hit
again, and only the new material is touched.
