---
type: skill
title: Handle a commitment
summary: Works out what to do about a promise that's slipping, or a request that just came in.
scenarios:
  - one todo that has gone past its date ("this one is overdue, what do I do about it")
  - something owed to a named person ("I still owe Sara the SCIM timeline")
  - deciding whether a commitment can be closed or has to move ("can I close this one out")
  - a request that just came in where it is not obvious what it wants ("what do I do with this message from sales?")
  - a request from somebody whose position changes the answer ("the CEO wants SSO by Q3, what now")
  - working out what to say back to one ("how should I answer this")
---

## When

One promise, and it runs in one of two directions. Work out which before anything else, because
everything below branches on it.

- **Outbound**: you point at one commitment (todo) and ask for help with it, usually because it
  slipped or you are unsure what to do. Work only on that one todo.
- **Inbound**: a request arrived, a pasted Slack ping, a forwarded email, a mandate from above,
  and you want to know what it actually wants and what to do about it.

An inbound ask is usually pasted into the conversation, so it is not a note anything can cite.
The sender's message is the source. Where it arrived as a file instead, filing it is the arrival
skill's job and this one reads what got filed.

## Read: a commitment of yours

The todo (title, due date, owner, the `sources` it cites), the meeting or note where the
commitment was made, and the related customer, theme, and decision pages. Three checks change
the answer, so make all three:
- **The linked ticket**, if any: its mirror note (tickets/), for `state`, `state_category` and
  `remote_updated`.
- **Whether it already happened**: search recent memory for evidence the thing quietly landed.
- **The calendar**: if the commitment involves a person (its `owner`, or someone named in its
  source meeting), look for a meeting note whose `date` is today or later that lists them in
  `participants`. A conversation already on the calendar changes the best move.

## Read: a request that came in

The message first, closely: what is literally asked for, by when, and what is only implied.

Then the memory it touches:
- **Who is asking** (people/): what they own, what they care about, what they were last told
  (`last_told`), and which customer or team they speak for. How far they can decide this on their
  own is what makes the same words a request or an instruction. An unknown sender is a fine
  answer: say they have no page rather than guess at their position.
- **What we already know**: the insights that bear on the ask and how many accounts back them, the
  live decisions that settle or contradict it, the theme it belongs under, and the ticket mirrors
  for anything already in flight.
- **What we already promised**: open todos, and the customer hub's ledger of what they were told.
  An ask we committed to in March is a different conversation from a new one.

## Produce: a commitment of yours

The right handling for this one commitment, each option as its own approval card. Pick what fits;
do not produce all of them.
- **A plan**, the default when it is live and just needs doing: a short `## Plan` section on the
  todo (propose_update, body patch) with 2-4 concrete next steps grounded in the memory. A
  blocked or stalled ticket is plan context, not a reschedule trigger: name it and plan around
  it, often pairing the plan with a nudge to whoever was promised.
- **Close it**, only when the memory shows it already happened or no longer matters:
  propose_update setting `commitment` to `done` (or `dropped`) and `resolved` to today, citing
  the evidence. Never close on a hunch.
- **Reschedule**, only with a concrete reason for the new date (a dependency, a named follow-up):
  propose_update setting `due`, with the reason in the rationale. Moving a date just to clear the
  overdue flag hides the slip without fixing anything; with no real reason, leave the date and
  propose a plan instead. If the reason is a blocked ticket, pair the new date with the risk made
  visible, never a silent bump.
- **Raise it in the meeting**, when the person involved is on the calendar soon: a short prep
  line on that meeting page (propose_update, body patch), citing the todo and the meeting. Prefer
  this over a cold nudge whenever the meeting exists.
- **Nudge**, when it waits on someone else and no meeting is coming: a draft_text you can copy and
  send yourself, citing where the commitment was made. It is not a card, and nothing sends it.

## Produce: a request that came in

One card, the decode (propose_note, type `note`, path `notes/YYYY-MM-DD-<sender>-<ask>.md`), with
`sources` citing every note it rests on. Where the pasted message is genuinely all there is, set
`asked`.

One addition to the writing rules: quote the ask itself. The message lives nowhere else, and what
somebody asked for, in their own words, is what they will hold you to later.

The job behind the ask is an inference, never what the sender stated. Label it **Inference** and
say what would confirm it. The solution somebody names is not the job: "can we add a CSV export
button" is a request, "finance rebuilds that report by hand every month" is the job, and only one
of the two has more than one answer.

Then what the ask actually forces, and only that:
- **A commitment you take on**: a todo (propose_todo) quoting the ask and citing this decode.
- **A reply** (draft_text), where the posture is to answer now: cite the decisions and tickets it
  rests on, and follow the voice for that audience. It is text to copy, and nothing sends it.
- **A signal worth keeping**: where the ask is evidence for a theme or a customer, extend that
  page (propose_update) and say what the addition changes.
- **A collision**: where the ask runs into a live decision or something already promised, that is
  its own card.

Saying no is a posture like any other and forces no card by itself. Recommend it plainly, with the
decision it rests on, and draft the reply only where it has to be said out loud.

## Then

Approved cards update this one commitment: the plan lands on the todo, a close flips
`commitment`, a reschedule moves `due`. Nothing else in the memory is touched.

An approved decode sits in `notes/` as the record of what was asked and what we said back, so the
same ask arriving next month from somebody else lands on something. Approved todos join the
commitment ledger.

A nudge and a reply are not cards. Both wait in the chat for you to copy and send yourself.

## The shape of the decode

```
[propose_note, type note, notes/YYYY-MM-DD-<sender>-<ask>.md]
# <what was asked, in one line>

## The ask
> <the sentence that asks it, verbatim>
<who sent it, when, and by when they want it>

## The job behind it
**Inference** <what they are trying to get done>. <What would confirm it.>

## Who is asking
<what they own, what they can decide on their own, what they were last told> ([[people/...]])

## What we know that bears on it
- **Fact** <the insight, decision or ticket, and what it says> ([[...]])

## Where it collides
<the live decision, the promise, or the ticket state it runs into, or "nothing found">

## Posture
<do it / do a smaller thing / not now / no / one answer needed first>: <why, in one sentence>
Next move: <what this run proposed, or nothing>

## What I could not check
<what nothing in the workspace answers>
```
