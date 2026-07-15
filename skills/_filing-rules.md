---
type: skill
skill_kind: filing
summary: Filing rules — where each typed object lives and how it links
---

# Filing rules

The librarian follows these when proposing paths and links (PLAN-V2 §3.1):

- **meetings/** — one file per meeting: `YYYY-MM-DD-<slug>.md`. Immutable transcript under
  `## Transcript`; the derived summary above it. Links to the decisions and insights it produced.
- **decisions/** — the append-only spine: `YYYY-MM-DD-<slug>.md`. Never edit a decision's body;
  supersede it (new file + `supersedes`, old file flipped to `status: superseded`).
- **insights/** — cited claims: `<slug>.md`, `evidence[]` required, a `confidence` level, a
  freshness clock. Link to the customer and problem they concern.
- **customers/** — one hub per account: commitments, signals, the what-they-were-told ledger.
- **problems/** — durable problem hubs; carry a `stance`; accrue evidence even when `wont-do`.
- **releases/** — what shipped, notes per audience.
- **people/** — stakeholders: what they care about, `last_told`.
- **sessions/** — replayable session receipts, written by the harness. Never hand-edited.

Every derived note lists its `sources`/`evidence` as wikilinks. Prefer linking to an existing hub
over creating a new file. Ticket keys and URLs are cited, never invented.
