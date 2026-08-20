---
type: skill
starts: [always]
title: Product understanding
summary: What this workspace knows about the product, and how to keep it true.
---

# Product understanding

What the workspace holds about the product itself, so every session starts from the same picture.
Three notes, and deliberately no more:

- `notes/understanding-product.md`: what the product is, who it is for, and what it is trying to
  do right now.
- `notes/understanding-technical.md`: the shape of the system in general terms, the big
  constraints, and the names of the moving parts.
- `notes/understanding-organization.md`: the teams, who owns what, and the names that keep coming
  up.

Each one opens with the same line, and it is not decoration: "Qale keeps this up to date. Correct
anything wrong."

If they do not exist yet, the way to get them is the interview (`learn-the-product`), which asks
the PM and drafts from what they say. Do not write them from synced material on your own: most
teams have no page that says what the product is and who it is for, so a picture mined out of this
quarter's tickets is confident and narrow at the same time.

Material the PM hands over ON PURPOSE to answer one of these questions is the exception, and a
technical overview generated from their own code (`product-overview.md`) is the case that actually
happens. File it like anything else, then propose the note it was for in the same session, citing
it, unverified until they confirm it. They went and fetched it: leaving it sitting in `sources/`
while the note it answers stays empty is the one wrong move here.

## High level, everywhere

Record the shape, not the detail. Architecture means the five boxes and the arrows between them,
not the code. The organization means who owns what, not the org chart. The product means what it
does for whoever pays for it, not the feature list.

The detail already lives in the sources: the synced pages, the tickets, the meetings, the notes.
The understanding cites them instead of repeating them. A paragraph that could be replaced by a
link should be the link.

An empty area is an honest answer. "Nobody has said who pays for this yet" is worth more than a
paragraph assembled out of guesses, and it is a good thing to ask about next time somebody is
there to ask.

## Where it lives

The default is those three notes, in this workspace. This is the line most worth changing: a team
that keeps this on a Confluence page names that page here instead, and it works, because writing
to a mirrored page already goes through the ordinary approval path
(a `draft_confluence_update` card the PM approves). This file is the setting. There is nothing
else to configure.

## Changing what is there

Tighten only. Sharpen a sentence, replace what has changed, strike what is stale. An edit that
makes one of these notes longer without making it truer is the wrong edit.

Where a claim came from decides how it is marked:

- **The PM said it themselves.** It lands verified: set `verified` on the note. It is a list of
  entries, and each entry carries both keys: `by: human:<their name>` and
  `at: <today's date, YYYY-MM-DD>`.

  ```yaml
  verified:
    - by: human:asa
      at: 2026-03-04
  ```

  They are the source, so there is nothing left to confirm.

- **You inferred it from synced material.** It lands unverified, which is simply the absence of
  that field, and cites the page or ticket it came from. It stays that way until the PM confirms
  it.

Freshness applies either way, so a picture nobody has touched in six months admits its age.

## What to watch

When synced material contradicts what is recorded here, propose the correction as its own card and
say which sentence disagreed with what. Never quietly absorb either side. Silence is not
disagreement: material that simply does not mention something contradicts nothing.

Nothing here is written without an approval card, these notes included.
