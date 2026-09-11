# Demo runbook: Reset once, S1 and S2 first, then any of the rest

Six scenarios. S1 (the drop) and S2 (refine the epic) always run first, in that order. S3 to S6
are optional, independent of each other, in any order, each at most once. Reset once before the
demo, none between. Nothing is selected and Settings stays closed during the demo: the script
engine picks the scenario from what you do.

## Before you demo

1. Build the demo app (`pnpm --filter @qale/desktop run dmg:demo`, or `pnpm dev:demo` for a
   dev run).
2. Open Settings, Demo, and press **Reset demo** once. That puts the workspace, the fake Jira
   and Confluence, and the fake calendar back to the seed, dated to today, and copies
   `demo-samples/` to `~/Desktop/Qale demo files/`.
3. Close Settings. The six rows under Reset say what to do for each scenario; they are a
   reminder, not buttons. The first two rows say they run first, in order.

The rail comes back with six pins after a Reset: Christmas season playbook and Fee rules under
Documents, BOK-300 and BOK-412 under Jira, Roadmap H2 and Changelog under Confluence
(`DEFAULT_PINS` in `apps/desktop/src/main/demo/demo-service.ts`). Unpin one during a demo and it
stays off until the next Reset. Meetings never pin, because Calendar is their home, so the
Thursday steering for S6 is opened from Calendar.

How a session finds its script: a drop is the arrival kickoff (S1), a bare "Write the weekly
update" pick is the weekly-update kickoff (S5), "Get the brief" on a meeting is the meeting-prep
kickoff (S6). A typed message is classified by the skill in force when it was sent, plus a word
or two from the line the card tells you to type (`trigger.any` in each script):

- S2: typed under Iterate on something, with `BOK-300` or "no-show".
- S3: typed with nothing picked, with `BOK-412`, "who should know" or "who needs to know".
- S4: typed with nothing picked, with "group bookings" or "Nordic Steak".

S3 and S4 are both plain questions, so the words are what tell them apart, and the README's
sentence for one never contains the other's words. Beyond that nothing typed has to match
anything: turns are served by position, not by comparing words, so a typo or a paraphrase
changes nothing.

## The six scenarios

The pain each one shows is in the customer's words in `demo-samples/README.md`. Here is what is
on screen, turn by turn. "Lands" means the write happened with no card. "Waits" means a card to
approve.

**S1, the meeting produced actions (always first).** Drag `brasserie-lund-review.vtt` from the
Qale demo files folder into Home. It lands in the composer; type "yesterday's Brasserie Lund
review, nobody wrote anything down" and send.

1. One line: the transcript goes on yesterday's calendar page, which holds the review at 10:00
   with Lena and Marcus. Then a quiet claim check.
2. One question card, two questions. The date: you told Lena end of October, the record says
   "Q4, before the Christmas season" from 2026-06-02. Pick **Yes, end of October**. Reminders:
   Lena said guests at two restaurants got the text twice, which is BOK-412, fixed this morning.
   Pick **Yes, same bug**.
3. Lands: an insight (no-show fees has a hard date, 1 November), the meeting write-up, the
   Brasserie Lund page (commitment, watch list, ledger line for 2026-07-16), Lena's page with
   `last_told`, three todos (send Lena the plan by 2026-07-24; Marcus sends the renewal paperwork
   by 2026-07-22; tell Lena the fix went out, due today).
4. "Three things leave the workspace, so they wait for you." Waits: a comment on BOK-300
   (target end of October, told Brasserie Lund), a comment on BOK-412 (Brasserie Lund saw it at
   Malmö and Lund), a Roadmap H2 patch (Q4 becomes end of October). Approve one at a time.
5. Closing text: what Lena was told, where it now is, the three todos, the three cards.

Open BOK-300 under Jira and show the comment.

**S2, refine the epic (always second).** Type `/`, pick **Iterate on something**, type "No-show
fees moved up to end of October. Help me refine BOK-300 so Rebecca's team can start at sprint
planning on Wednesday." Send.

1. Framing in three lines (deciding, out of scope, done looks like), then one card with four
   chips: **Per sitting**, **Online only**, **A/B test**, **Anything else**. Pick **Cut it**,
   **Keep it**, **Keep it**, skip.
2. "Fee per sitting is cut, so one fee per restaurant." A second card: Story 1 (card on file at
   booking), Story 2 (charge the fee after a no-show), Story 3 (fee notice wording test), Anything
   else. Keep all three, skip.
3. Waits: three ticket cards under BOK-300, label `no-show-fees`, Brasserie Lund in the first
   line, three checks each. The epic is named in the body ("Part of BOK-300"). Lands: the seed
   todo "Get the BOK-300 stories written before sprint planning" flips to done.
4. Closing text: three cards wait, the todo is closed, no date on any card.

Approve one ticket card and open its mirror to show the label and the three checks.

**S3, who should know.** In Home, type "The fix for BOK-412 went out this morning. Who should
know?" Send.

1. Two quiet turns: the reads and a claim check.
2. The reply: three accounts and one colleague. Ulrika (Sjögatan and Brasserie Lund), Petra
   (Pizzeria Napoli), Jonas (four open tickets, a macro that still says we are looking into it).
   Kaffekopp is named as the account that left over this shape. Two `draft_text` panels: **For
   Ulrika and Petra to forward** (Short, With what to do) and **For Jonas** (To close the four
   tickets, Macro replacement). Lands: ledger lines on Sjögatan and Pizzeria Napoli, `last_told`
   on Ulrika, Petra and Jonas.
3. Closing text: each page now says what its person was told; copy and send yourself.
4. Same session, type "From now on, when a fix ships, tell the CSMs before the changelog." One
   `propose_instruction`, then "Added to your rules" with a link to House rules.

Open House rules and show the line.

**S4, sales needs it to sign.** Paste `marcus-group-bookings.md` from the Qale demo files folder
into Home and send. Pick no skill.

1. "Marcus wants a yes on two things by this week. I am checking both against the record."
   Qale pulls in Handle a commitment itself (`use_skill`), reads the 2026-06-18 decision, the
   2026-07-09 steering page, GST-77, BOK-520, Nordic Steak and Marcus, and runs one claim check.
   This turn pauses a few seconds on purpose.
2. Question card, Q1 2027: the Google button has been live since 2026-05-12, group bookings
   waits on the deposits work Payments has planned for Q4. Pick **No, Q1 stands**.
3. Lands: an insight (group bookings asked a third time through sales), a ledger line on Nordic
   Steak, `last_told` on Marcus. One `draft_text` panel, **Reply to Marcus**, sales voice, tabs
   **One message to forward** and **What you can tell them**.
4. Closing text: "One yes and one no." Nothing was sent and nothing waits.

Open Memory, Insights, and show the new note.

**S5, the Friday update.** Type `/`, pick **Write the weekly update**, send with no text.

1. A quiet turn: the reads and the internal voice.
2. "Two things shipped this week, one date changed, two things to watch." One `draft_text`
   panel for `#product-updates`, tabs **Full** and **Short**. Waits: one card, this week's
   section on the public Changelog (table areas, one reminder for Google bookings; no ticket
   keys, no customer names, no target dates).
3. Closing text: copy and post yourself; one card waits.

Copy the Full tab. Approve the card. Open the Changelog mirror and scroll to the end: the new
section appends at the end of the page, not on top, and the synced mirror shows it one heading
level smaller than the older entries.

**S6, the brief for Thursday.** Open **Calendar**, click **Steering** on Thursday, press **Get
the brief**.

1. The reads, then one `propose_update` that appends a `## Prep` section to the steering page:
   since last time (the October date, which Åsa has not heard; the BOK-300 stories are drafted),
   delivery (BOK-412 fixed, GST-140 shipped, PAY-210 still no date), loose ends (Henrik owes a
   PAY-210 date), landmines (Marcus will push group bookings again; sales has not been told the
   Google button is live). It lands with no card: an append on a calendar page rewrites nothing
   of yours.
2. Closing text: Åsa hears the October date from you, not from Marcus.

The first bullet of the brief is true because S1 and S2 always ran. Everything else is seed, so
the brief reads right whether or not S3, S4 or S5 ran.

## Authoring or changing a script

A script is a file, `demo/scenarios/s1.json` to `s6.json`, not a recording. Change one by
editing it directly, or start over from a fresh recording:

1. Reset, then run the scenario once in record mode: `QALE_DEMO=1 QALE_DEMO_RECORD=1 pnpm
desktop`, with a real Anthropic key in Settings.
2. `pnpm demo:draft --scenario s1 --from demo/recordings/<file>.json` turns the recording into
   a script, dropping reads and thinking, and flags anything it could not make stable on its
   own (a proposal id, a Jira page id).
3. Edit the file. Sharpen the text, fix a `search` block, remove what the draft flagged. Give a
   typed conversation the skill it is typed under (`trigger.skill`, `ask` for none) and a word
   or two the `do` line makes the presenter type (`trigger.any`). The lint checks that the `do`
   line carries one of those words, which is why S4's `do` line names Marcus and Nordic Steak.
4. `pnpm demo:lint`. Fix until it prints `OK` at all three offsets and the four sequence orders
   are green. The sequence pass runs S1, then S2, then a subset of S3 to S6 with no reset
   between: all four forwards, all four backwards, S4 then S3, and S6 alone.
5. Run it cold on a day nobody drafted against: `QALE_DEMO=1 QALE_DEMO_TODAY=2026-10-01 pnpm
desktop`, Reset, watch the cards. Commit.

Full detail on each step is in `docs/demo-mode.md`, DM-10.

## After a merge from `main`

If the merge touched `packages/agent/src/tools.ts` or
`packages/application/src/use-cases/proposals.ts`, a tool's name, its arguments, or when it
applies versus waits for approval may have changed under the six scripts. Run `pnpm demo:lint`,
then one cold run of whichever scenario touches the changed tool. A skill's wording changing
needs neither: the scripts say what is on screen, not what the skill says. A skill's folder
name changing does: `trigger.skill` names it.

## Known limits

- The demo workspace has no `.git`, so Activity's put-back does nothing during a demo.
- A card that has gone stale (its underlying page changed since the proposal was made) triggers
  "Fix this", which calls the model. It should not happen on a fresh Reset; if it does at demo
  time, the reply is the off-script line.
- Each scenario runs once per Reset. A second run of the same scenario gets the off-script
  line, because its conversation is already bound; Reset and go again.
- S3 to S6 assume S1 and S2 in their text ("the date you gave Lena yesterday"). Run one of them
  before S1 and the tool calls still succeed, but the words are wrong for the room.
- The Changelog card in S5 appends its section at the end of the page, below the older entries,
  and the mirror shows it one heading level smaller. Scroll to the end to show it.
- `pnpm build-demo-fixture` must be re-run by hand after a change to the Jira/Confluence cast or
  the mirrors it reads from. Nothing runs it for you.
