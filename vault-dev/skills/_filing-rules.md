---
type: skill
skill_kind: filing
summary: Filing rules — where each typed object lives and how it links
---

# Filing rules

The librarian follows these when proposing paths and links (PLAN-V2 §3.1):

- **sources/** — raw dumped material (article links, screenshots, pasted threads, meeting
  transcripts, and transcripts of meetings the PM was NOT in): `YYYY-MM-DD-<slug>.md`. The body is
  never edited. An external meeting's transcript sets `origin` (whose meeting it was); it is a
  signal, never a meeting.
- **meetings/** — one file per meeting the PM was IN: `YYYY-MM-DD-<slug>.md`. The single anchor for
  the whole lifecycle: `## Prep` (before), `## Notes` (during), `## Summary` (processed — links the
  decisions and insights it produced). The immutable transcript lives in sources/ and is linked via
  the `transcript` frontmatter ref (older meetings carry it inline under `## Transcript`). Recurring
  meetings share a `series` slug. A meeting whose `date` is in the future is upcoming — derived from
  the date, never a status value.
- **decisions/** — the append-only spine: `YYYY-MM-DD-<slug>.md`. Never edit a decision's body;
  supersede it (new file + `supersedes`, old file flipped to `status: superseded`).
- **insights/** — cited claims: `<slug>.md`, `evidence[]` required, a `confidence` level.
  Link to the customer and problem they concern.
- **customers/** — one hub per account: commitments, signals, the what-they-were-told ledger.
- **problems/** — durable problem hubs; carry a `stance`; accrue evidence even when `wont-do`.
- **releases/** — what shipped, notes per audience.
- **people/** — stakeholders: what they care about, `last_told`.
- **todos/** — the commitment ledger: one file per commitment, `YYYY-MM-DD-<slug>.md`. Carries
  `status` (open/done/dropped), optional `due`, and `owner` only when someone other than the PM
  owes it (a waiting-on item). `sources[]` cite where the commitment was made. Closed todos stay.
- **sessions/** — replayable session receipts, written by the harness. Never hand-edited.

Every derived note lists its `sources`/`evidence` as wikilinks. Prefer linking to an existing hub
over creating a new file. Ticket keys and URLs are cited, never invented.

## Contexts (tags)

`tags` carry the cross-cutting axis the PM navigates by: projects, products, areas (e.g.
`pricing`, `enterprise-auth`, `exports`). The vocabulary is curated, not a folksonomy:

- Tag every proposed note with 1–2 contexts **drawn from tags already in use** (check similar
  notes via search_vault before inventing).
- Kebab-case, singular concept, no type words (`pricing`, never `pricing-decisions`).
- A brand-new context is allowed only when nothing existing fits, and the card's rationale must
  call it out explicitly ("new context: #scheduled-exports") so the PM consciously grows the
  vocabulary when approving.
