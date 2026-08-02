---
type: skill
starts: [you-run-it, model-picks-it-up]
title: Chase a commitment
summary: Works out what to do about one promise that's slipping.
can: [draft-outbound]
---

## When
The PM points at one commitment (todo) and asks for help with it, usually because it slipped or
they are unsure what to do. Work only on that one todo.

## Read
The todo (title, due date, owner, the `sources` it cites), the meeting or note where the
commitment was made, and the related customer, theme, and decision pages (search_vault,
vault_read). Three checks change the answer, so make all three:
- **The linked ticket**, if any: read its mirror note (tickets/). Its `state`, `state_category`,
  and `remote_updated` are how delivery actually stands.
- **Whether it already happened**: search recent memory for evidence the thing quietly landed.
- **The calendar**: if the commitment involves a person (its `owner`, or someone named in its
  source meeting), look for an upcoming meeting with them: a meeting note whose `date` is today
  or later that lists them in `participants` (calendar-synced meetings link people as `people/…`
  wikilinks). A conversation already on the calendar changes the best move.

## Produce
The right handling for this one commitment, each option as its own approval card. Pick what fits;
do not produce all of them.
- **A plan**, the default when it is live and just needs doing: a short `## Plan` section on the
  todo (propose_update, body patch) with 2-4 concrete next steps grounded in the memory. A
  blocked or stalled ticket is plan context, not a reschedule trigger: name it ("epic blocked
  since Tuesday; draft a date-risk note?") and plan around it, often pairing the plan with a
  nudge to whoever was promised.
- **Close it**, only when the memory shows it already happened or no longer matters:
  propose_update setting `commitment` to `done` (or `dropped`) and `resolved` to today, citing
  the evidence. Never close on a hunch.
- **Reschedule**, only with a concrete reason for the new date (a dependency, a named follow-up):
  propose_update setting `due`, with the reason in the rationale. Moving a date just to clear the
  overdue flag hides the slip without fixing anything; with no real reason, leave the date and
  propose a plan instead. If the reason is a blocked ticket, pair the new date with the risk made
  visible (the plan or a date-risk note), never a silent bump.
- **Raise it in the meeting**, when the person involved is on the calendar soon: a short prep
  line on that meeting page (propose_update, body patch), like "owe Sara the SCIM timeline (due
  Fri); bring the answer", citing the todo and the meeting. Prefer this over a cold nudge
  whenever the meeting exists; the live conversation is the cheaper channel.
- **Nudge**, when it waits on someone else and no meeting is coming: a draft_message the PM can
  send, citing where the commitment was made. Drafted, never sent.

Every card cites the memory it rests on.

## Then
Approved cards update this one commitment: the plan lands on the todo, a close flips
`commitment`, a reschedule moves `due`. Nothing changes silently, and nothing else in the memory
is touched.
