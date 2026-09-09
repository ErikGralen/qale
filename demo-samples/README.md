# Qale demo files

Five scenarios. Each one stands alone, so run them in any order and show as many as you have
time for, each once. Press **Reset demo** in Settings → Demo once before the demo, then leave
Settings closed: Qale picks the scenario from what you do.

| File                         | What you do with it                    | Scenario |
| ---------------------------- | -------------------------------------- | -------- |
| `steering-h2-priorities.vtt` | Drag it onto the Qale window           | Meeting  |
| `marcus-offline-mode.md`     | Copy the text, paste it into the skill | Request  |

Use the copies in this folder. They are dated so that the steering meeting was yesterday.

## The story

Rota makes staff-scheduling software for restaurant and retail chains. You are the PO for the
Scheduling and Staff App teams. Two things are in flight: shift swaps (staff trade shifts in the
app, a manager approves) and payroll export. Sales promised Café Nord swaps before the September
staff turnover. Fjord Sports was told payroll export lands in Q4.

## The meeting produced actions

**Do:** drag `steering-h2-priorities.vtt` onto the window.

**Say:**

    yesterday's steering, nobody wrote anything down

**If it asks a question:** pick **Same commitment**.

**Expect:** the file is saved, filed against the 16 July steering slot, and read. One question
card about the open Henrik todo. Then the reply lists what landed: the meeting write-up, a
decision "Shift swaps before payroll export" that supersedes the May order, todos for Rebecca,
and the Café Nord ledger line. Two or three cards wait: a comment on SCH-118, a new story under
SCH-231, a patch to the Roadmap H2 page. Approve them one at a time.

**Open at the end:** the SCH-118 mirror, to show the comment with its source line, and Roadmap H2
at version 18.

## Who needs to know

**Do:** type this in Home.

**Type:**

    SCH-121 shipped three weeks ago and nobody outside the team was told. Who needs to know, and what do I tell them?

**If it asks a question:** pick **Yes, live since 24 June**.

**Expect:** each person with the evidence. Fjord Sports asked for approved hours per store on
26 May and were last told Q4 for Visma. Ulrika asked to hear before the customer. Malin wants the
account list before the release note. Jonas has support tickets and no macro. It says from
SCH-125 and PLT-77 that the Visma date is still Q4, that Fortnox is blocked on the token store,
and that Jira holds no date. Two panels: a CS-voice note to Oskar, a plain internal note for the
three colleagues. Copy the Oskar tab. Then type the second sentence:

    From now on, when something a customer asked for ships, tell Ulrika before the customer.

**Open at the end:** the house rules, to show the new line under "Your rules".

## A request came in

**Do:** type `/` in Home, pick **Handle a commitment**, paste the body of
`marcus-offline-mode.md`, send.

**Paste:** the whole of `marcus-offline-mode.md`.

**If it asks a question:** pick **No, the decision stands**.

**Expect:** one question about Marcus's claim that Åsa reopened offline mode on 9 July, because
the February decision and the 9 July steering page both say otherwise. Then a note lands in
Documents with the ask verbatim, the job behind it, the collision with the February decision and
the posture "no". A panel in the sales voice gives "One line to forward" and "What you can tell
them". Copy one. No cards, nothing sent.

**Open at the end:** the new note, `notes/2026-07-17-marcus-offline-mode`.

## Break it into stories

**Do:** type `/` in Home, pick **Iterate on something**, then type the sentence.

**Type:**

    Break the Visma connector into stories under SCH-118. Rebecca's team, after Fortnox, Fjord Sports first.

**Options to pick:** round one has four ideas. Press **Keep it** on the first three and **Cut it**
on the Fjord Sports pilot. Skip "Anything else". Round two has three stories: keep all three.

**Expect:** the framing in three lines, then a card of ideas with the case and the cost for each.
The second round turns the ones you kept into three stories with three acceptance checkboxes
each. The round ends with a ticket card per story under SCH-118, label `payroll-export`, Fjord
Sports named in the first line. Approve one.

**Open at the end:** the new ticket's mirror page, to show the label, the parent and the three
checkboxes.

## The Friday update

**Do:** type `/` in Home, pick **Write the weekly update**, send with no text.

**Type:** nothing.

**If it asks a question:** pick **For exec**.

**Expect:** three panels, each with three style tabs: exec, CS and sales. All three carry the
same news. Shift reminders shipped on 15 July, the May order still stands, SCH-240 is being
re-estimated and Fortnox is blocked. A card waits with a new 2026-07-17 section for the Product
weekly update page. Copy the exec **One paragraph** tab, then answer the style question.
Approve the card.

**Open at the end:** the exec voice, to show the first line changed and two styles gone, and the
Product weekly update mirror at version 39.

## If something looks off

- A card asks what date the meeting was: you dragged a file from somewhere else. Use this folder.
- Approving a Jira or Confluence card fails: Settings → Demo → Reset demo, then start over.
- The reply reads as if it never read the workspace, or says it is outside what the demo can
  show: Settings → Demo → Reset demo, then run the scenario again. A scenario runs once per
  Reset.
