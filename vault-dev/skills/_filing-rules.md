---
type: skill
skill_kind: filing
summary: Filing rules — where each typed object lives and how it links
---

# Filing rules

The librarian follows these when proposing paths and links (PLAN-V2 §3.1):

- **sources/** — raw dumped material (article links, screenshots, pasted threads, synced pages,
  meeting transcripts, and transcripts of meetings the PO was NOT in): `YYYY-MM-DD-<slug>.md`.
  The body is never edited, only re-synced from upstream. Carries a lifecycle `status` (enum:
  new/processed/active/stale) — `new` until an approved card cites it. An external meeting's
  transcript sets `origin` (whose meeting it was); it is a signal, never a meeting.
- **meetings/** — one file per meeting the PO was IN: `YYYY-MM-DD-<slug>.md`. The single anchor
  for the whole lifecycle: `## Prep` (before), `## Notes` (during), `## Summary` (processed —
  links the decisions and insights it produced). The immutable transcript lives in sources/ and is
  linked via the `transcript` frontmatter ref. Recurring meetings share a `series` slug.
  Carries the lifecycle `status`: `new` until After-Meeting's cards land. A meeting whose
  `date` is in the future is upcoming — derived, never a status value.
- **decisions/** — the append-only spine: `YYYY-MM-DD-<slug>.md`. Never edit a decision's body;
  supersede it (new file + `supersedes`, old file flipped to `status: superseded`).
- **insights/** — cited claims: `<slug>.md`, `evidence[]` required, a `confidence` level.
  Link to the customer and theme they concern.
- **customers/** — one hub per account: commitments, signals, the what-they-were-told ledger.
- **themes/** — the durable things worth solving: a problem, a pain, an opportunity, an idea.
  Carry a `stance` (exploring / watching / committed / wont-do) and accrue evidence even when
  `wont-do` — the declined ones are exactly the ones whose reasoning is expensive to rebuild.
  A theme is never required to have a ticket, and a ticket is never required to have a theme.
- **people/** — stakeholders: what they care about, `last_told`.
- **todos/** — the commitment ledger: one file per commitment, `YYYY-MM-DD-<slug>.md`. Carries
  `status` (open/done/dropped), optional `due`, and `owner` only when someone other than the PO
  owes it (a waiting-on item). `sources[]` cite where the commitment was made. Closed todos stay.
- **notes/** — quick authored captures (stray thoughts, ⌘N notes); dumped external material goes
  to sources/ instead. Intake proposes how each connects into the memory.
- **attachments/** — dropped images/screenshots, each referenced by a capture note in sources/.
- **sessions/** — replayable session receipts, written by the harness. Never hand-edited.

Every derived note lists its `sources`/`evidence` as wikilinks. Prefer linking to an existing hub
over creating a new file. Ticket keys and URLs are cited, never invented.
