---
type: note
title: Product understanding
summary: The three notes that hold what we know about the product, and how they are kept true.
sources: []
---

# Product understanding

Qale keeps this up to date. Correct anything wrong.

What this workspace holds about the product itself, so every session starts from the same picture.
Three notes, and deliberately no more:

- `notes/understanding-product.md`: what the product is, who it is for, and what it is trying to
  do right now.
- `notes/understanding-technical.md`: the shape of the system in general terms, the big
  constraints, and the names of the moving parts.
- `notes/understanding-organization.md`: the teams, who owns what, and the names that keep coming
  up.

If they do not exist yet, the way to get them is the interview (`tell-qale`), which asks
the PM and drafts from what they say. Nobody writes them from synced material alone: a picture
mined out of this quarter's tickets is confident and narrow at the same time.

Material the PM hands over on purpose to answer one of these questions is the exception, such as
a technical overview generated from their own code (`product-overview.md`). It gets filed like
anything else, and the note it was for is proposed in the same session, citing it, unverified
until they confirm it.

## High level, everywhere

These notes record the shape, not the detail: the five boxes and the arrows between them, who
owns what, what the product does for whoever pays for it.

The detail already lives in the sources; the understanding cites them instead of repeating them.
A paragraph that could be replaced by a link should be the link.

An empty area is an honest answer. "Nobody has said who pays for this yet" is worth more than a
paragraph assembled out of guesses.

## Where it lives

The default is those three notes, in this workspace. A team that keeps this on a wiki page names
that page here instead, and it works: writing to a mirrored page already goes through the
ordinary approval path (a `draft_page_update` card the PM approves). This note is the setting.

## Changing what is there

Tighten only. Sharpen a sentence, replace what has changed, strike what is stale. An edit that
makes one of these notes longer without making it truer is the wrong edit.

Where a claim came from decides how it is marked:

- **The PM said it themselves.** It lands verified: `verified` is set on the note. It is a list of
  entries, and each entry carries both keys: `by: human:<their name>` and
  `at: <that day's date, YYYY-MM-DD>`.

  ```yaml
  verified:
    - by: human:asa
      at: 2026-03-04
  ```

- **Qale inferred it from synced material.** It lands unverified, which is simply the absence of
  that field, and cites the page or ticket it came from. It stays that way until the PM confirms
  it.

Freshness applies either way, so a picture nobody has touched in six months admits its age.

## What to watch

When synced material contradicts what is recorded here, the correction comes as its own card and
says which sentence disagreed with what. Silence is not disagreement: material that simply does
not mention something contradicts nothing.

Nothing here is written without an approval card, these notes included.
