---
type: skill
starts: [always]
title: Filing rules
summary: Where each kind of note lives, and what it links to.
---

# Filing rules

Where each kind of note lives. The librarian follows these when proposing paths and links.

- **sources/**: raw dumped material (article links, screenshots, pasted threads, synced pages,
  meeting transcripts, and transcripts of meetings the PM was not in), named
  `YYYY-MM-DD-<slug>.md`. The body is never edited, only re-synced from upstream. Carries
  `processing` (new / processed / stale), `new` until an approved card cites it. An external
  meeting's transcript sets `origin` (whose meeting it was); it is a signal, never a meeting.
- **meetings/**: one file per meeting the PM was in, named `YYYY-MM-DD-<slug>.md`. The single
  anchor for the whole lifecycle: `## Prep` before, `## Notes` during, `## Summary` once
  processed, linking the decisions and insights it produced. The immutable transcript lives in
  sources/ and is linked via the `transcript` frontmatter ref. Recurring meetings share a
  `series` slug. Carries `processing`, `new` until the arrival cards land. A meeting whose `date`
  is in the future is upcoming; that is derived, never a lifecycle value.
- **decisions/**: the append-only decision spine, `YYYY-MM-DD-<slug>.md`. Never edit a decision's
  body. To change one, supersede it: a new file with `supersedes`, and the old file flipped to
  `standing: superseded`.
- **insights/**: cited claims, `<slug>.md`. `evidence[]` is required, plus a `confidence` level.
  Link each to the customer and theme it concerns.
- **customers/**: one hub per account: commitments, signals, and the ledger of what they were
  told. Carries `relationship` (prospect / active / churned).
- **themes/**: the durable things worth solving: a problem, a pain, an opportunity, an idea.
  Carries `stance` (exploring / watching / committed / wont-do). Themes accrue evidence even when
  `wont-do`; the declined ones are exactly the ones whose reasoning is expensive to rebuild. A
  theme never requires a ticket, and a ticket never requires a theme.
- **people/**: stakeholders: what they care about, and `last_told`.
- **todos/**: the commitment ledger, one file per commitment, `YYYY-MM-DD-<slug>.md`. Carries
  `commitment` (open / done / dropped), optional `due`, and `owner` only when someone other than
  the PM owes it (a waiting-on item). `sources[]` cites where the commitment was made. Closed
  todos stay.
- **notes/**: quick authored captures (stray thoughts, ⌘N notes). Dumped external material goes
  to sources/ instead. Intake proposes how each connects into the memory.
- **attachments/**: dropped images and screenshots, each referenced by a capture note in
  sources/.
- **sessions/**: replayable session receipts, written by the harness. Never hand-edited.

Every derived note lists its `sources` or `evidence` as wikilinks. Prefer linking to an existing
hub over creating a new file; near-duplicate pages split the memory. Ticket keys and URLs are
cited, never invented.
