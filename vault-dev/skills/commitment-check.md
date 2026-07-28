---
type: skill
skill_kind: session
session_type: commitment-check
summary: Commitment check — help the PO deal with one specific todo, as approval cards
tier: outbound
completion_bar: Every card cites the memory it rests on; no due date is moved without a concrete reason.
red_flags:
  - Rescheduling just to clear the overdue flag — a new date needs a real reason, or don't move it.
  - Marking something done on a hunch — only close what the memory actually shows landed.
  - Handling a todo that links a ticket without reading its mirror — a blocked ticket changes what the right answer is.
---

## When
The PO points at one commitment (todo) and asks for help dealing with it — usually because it has
slipped, or they're not sure what to do with it. You are handed that one todo; work only on it.

## Read
The todo itself (its title, due date, owner, and the `sources` it cites), the meeting or note where
it was made, and the related customer/theme/decision pages (search_vault, vault_read). When the
todo or its sources link a ticket, read its mirror note (tickets/): its `state`, `state_category`
and `remote_updated` are how delivery actually stands, and they change what sensible handling looks
like. Crucially, check whether it has quietly already happened — search the recent memory for
evidence it landed. And check the calendar: if this commitment involves a person (its `owner`, or
someone named in its source meeting), search for an **upcoming meeting** with them — a meeting note
whose `date` is today or later that lists them in `participants` (calendar-synced meetings link
people as `people/…` wikilinks). A live conversation on the horizon changes the best move.

## Produce
The right handling for this one commitment, each as its own approval card. Pick what fits; don't
produce all of them, and never move a date reflexively:
- **A plan** — the default when it's still live and just needs doing: a short `## Plan` section on
  the todo (propose_update, body patch) with 2-4 concrete next steps grounded in the memory. A
  linked ticket that is blocked or stalled is plan context, not a reschedule trigger — name it
  ("epic blocked since Tuesday — draft a date-risk note?") and plan around it, often pairing the
  plan with a **Nudge** to whoever was promised.
- **Close it** — only if the memory shows it already happened or no longer matters: propose_update
  setting frontmatter `status` to `done` (or `dropped`) and `resolved` to today, citing the evidence.
- **Reschedule** — only if there's a concrete, justified new date (a dependency, a named follow-up):
  propose_update setting frontmatter `due`, with the reason in the rationale. If there's no real
  reason, leave the date alone and propose a plan instead; if the reason is a blocked ticket, pair
  the new date with the risk surfaced (the plan or a date-risk note), never a silent bump.
- **Raise it there** — when the person this commitment involves is on the calendar soon: instead of
  a cold nudge, propose a short prep line on that upcoming meeting page (propose_update, body patch)
  — "owe Sara the SCIM timeline (due Fri) — bring the answer" — citing the todo and the meeting. The
  live conversation is the cheaper channel; prefer this over **Nudge** whenever the meeting exists.
- **Nudge** — if it's waiting on someone else and there's no meeting on the horizon: a draft_message
  the PO can send, citing where the commitment was made. Drafted, never sent.

## Then
Approved cards update this commitment in the ledger — the plan lands on the todo, a close flips its
status, a reschedule moves its date. Nothing changes silently, and nothing else in the memory is touched.
