# Demo runbook: Reset once, do the one thing, approve

Each of the five scenarios is independent. Reset once before the demo, then do the one thing a
scenario's card says and approve what comes up. Any subset, in any order, each at most once,
with no reset between them. Nothing is selected and Settings stays closed during the demo:
the script engine picks the scenario from what you do.

## Before you demo

1. Build the demo app (`pnpm --filter @qale/desktop run dmg:demo`, or `pnpm dev:demo` for a
   dev run).
2. Open Settings → Demo and press **Reset demo** once. That puts the workspace, the fake Jira
   and Confluence, and the fake calendar back to the seed, dated to today, and copies the demo
   files to `~/Desktop/Qale demo files/`.
3. Close Settings. The five cards under Reset say what to do for each scenario; they are a
   reminder, not buttons.

The rail comes back with six pins after a Reset: H2 capacity and Swap rules under Documents,
SCH-118 and SCH-231 under Jira, Roadmap H2 and Product weekly update under Confluence. Unpin one
during a demo and it stays off until the next Reset. Meetings never pin, because Calendar is
their home, so the week is on the **Calendar** row.

How a session finds its script: a drop is the arrival kickoff (S1), "Brief me" on a meeting is
the meeting-prep kickoff (S1), a bare "Write the weekly update" pick is that kickoff (S5). A
typed message is classified by the skill in force when it was sent: Iterate on something for
S4, nothing picked for S2 and S3, plus a word or two from the line the card tells you to type
(`SCH-121` or "who needs to know" for S2, `offline` for S3, `Visma` or `stories` for S4). S2
and S3 are both plain questions, so the word is what tells them apart. Beyond that nothing typed
has to match anything: turns are served by position, not by comparing words, so a typo or a
paraphrase changes nothing.

## The five scenarios

**S1, the meeting produced actions.** Drag `steering-h2-priorities.vtt` from the Qale demo
files folder into Home. It lands in the composer; type "yesterday's steering, nobody wrote
anything down" and send. A question card asks whether "I'll ping Henrik today" is the same
commitment as the seeded GDPR review: pick **Same commitment**. Approve the meeting write-up,
the decision that supersedes the May order, and the todos, then the three outbound cards one at
a time (a comment on SCH-118, a new SCH story, a Roadmap H2 patch). Open SCH-118 in the Jira tab
to show the comment landed.

**S1's brief, which stands on its own.** Open **Calendar**, click the Café Nord QBR prep four
days out, and press **Get the brief**. It reads only the seed, so it can be shown before S1's
drop, after it, or with no drop at all. One proposal writes a `## Prep` section on the meeting
page: what Café Nord was last told, what Lena left the last QBR believing, and why no month goes
out until Rebecca re-estimates SCH-240.

**S2, who needs to know.** In Home, type: "SCH-121 shipped three weeks ago and nobody outside
the team was told. Who needs to know, and what do I tell them?" Approve the ledger entries it
proposes for Fjord Sports and the three colleagues. In the same session, type: "From now on,
when something a customer asked for ships, tell Ulrika before the customer." Open the house
rules page and show the line it added.

**S3, a request came in.** In Home, paste the Slack message from the README's scenario 3 and
send. Pick no skill: Handle a commitment is not in the `/` picker, and the first turn shows Qale pulling it
in itself. A question card asks whether Åsa reopened offline mode: pick **No, the decision
stands**. Copy the reply from the sales-voice panel: **One line to forward** is the answer for
Marcus (the no, the reason, and the line for the prospect), and **What you can tell them** is the
prospect's part as three lines. The request is kept as an insight in Memory, with no card; open
Memory → Insights to show it. Nothing lands in Documents.

**S4, break it into stories.** In Home, type `/`, pick **Iterate on something**, type: "Break
the Visma connector into stories under SCH-118. Rebecca's team, after Fortnox, Fjord Sports
first." Round one: **Keep it** on the first three ideas, **Cut it** on the pilot, skip Anything
else. Round two: keep all three stories. Approve one ticket card and open its mirror to show the
label and the three acceptance checkboxes.

**S5, the Friday update.** In Home, type `/`, pick **Write the weekly update**, send with no
text. Copy the exec **One paragraph** tab, then answer **For exec** when it asks how to write
updates from now on. Open the exec voice file and show the line it rewrote. Approve the
Confluence card and open the Product weekly update mirror.

## Authoring or changing a script

A script is a file, `demo/scenarios/s1.json` to `s5.json`, not a recording. Change one by
editing it directly, or start over from a fresh recording:

1. Reset, then run the scenario once in record mode: `QALE_DEMO=1 QALE_DEMO_RECORD=1 pnpm
desktop`, with a real Anthropic key in Settings.
2. `pnpm demo:draft --scenario s1 --from demo/recordings/<file>.json` turns the recording into
   a script, dropping reads and thinking, and flags anything it could not make stable on its
   own (a proposal id, a Jira page id).
3. Edit the file. Sharpen the text, fix a `search` block, remove what the draft flagged. Give a
   typed conversation the skill it is typed under (`trigger.skill`, `ask` for none) and a word
   or two the `do` line makes the presenter type (`trigger.any`).
4. `pnpm demo:lint`. Fix until it prints `OK` at all three offsets and the four sequence orders
   are green: those run every scenario after every other with no reset between.
5. Run it cold on a day nobody drafted against: `QALE_DEMO=1 QALE_DEMO_TODAY=2026-10-01 pnpm
desktop`, Reset, watch the cards. Commit.

Full detail on each step is in `docs/demo-mode.md`, DM-10.

## After a merge from `main`

If the merge touched `packages/agent/src/tools.ts` or
`packages/application/src/use-cases/proposals.ts`, a tool's name, its arguments, or when it
applies versus waits for approval may have changed under the five scripts. Run `pnpm demo:lint`,
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
- `pnpm build-demo-fixture` must be re-run by hand after a change to the Jira/Confluence cast or
  the mirrors it reads from. Nothing runs it for you.
