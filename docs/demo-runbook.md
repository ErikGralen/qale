# Demo runbook: record the walkthrough, ship the Windows installer

> **A first full take was recorded on 2026-09-08.** 36 files in `demo/recordings/`, all five flows, every
> conversation ending cleanly. It is usable but it is not the keeper: the fake Jira no longer closes `SCH-231`,
> so flow 4's premise contradicts the tracker and the run needed three answers to get past it (below).
> `docs/demo-scenarios.md` recuts the five so each stands alone and none of those questions is asked.
>
> **The three answers this take needs**, in order, or the presenter gets different messages:
>
> | Flow | Question | Pick |
> |---|---|---|
> | 4 | Jira still has SCH-231 and SCH-240 In Progress. What does "done" mean here? | **2**, complete and the flag is on for customers |
> | 4 | Has Henrik's review of the swap notifications landed? | **2**, cleared with no change needed |
> | 5 | Can I tell CS and sales that shift swaps are live for customers since 8 September? | **1**, yes, live 8 September |
>
> Do not open `SCH-231` in the Jira tab during flows 4 and 5. It reads In Progress, and the drafts say shipped.
> Flow 1 only opens `SCH-118`, which is fine.

The demo build answers every prompt from recordings. This file is the script for a recording session: what you
do, what I do after, and how to tell when something went wrong.

## How recording works, in four sentences

In record mode the app forwards every model call to Anthropic with your real key and writes the conversation to
`demo/recordings/<slug>-<hash>.json`, one file per conversation, all turns in order. At replay, the app matches on
what you typed plus what the tools returned from the vault, so the vault must be in the same state at replay as it
was at record time. That is why you record on a fresh Reset, in the fixed order, without off-script typing. If you
type a prompt differently at demo time, the audience gets the fallback line.

## Part 1: what you do

### Before you start

- Branch `demo`, then `pnpm install`.
- Have a real Anthropic key ready. Record mode reads it from Settings, not from the environment.
- Close any running Qale window. The dev app uses its own data folder ("Qale Dev"), separate from the packaged one.
- Do not run `pnpm refresh-demo`. The app builds its own workspace on first launch.

### Start record mode

```sh
QALE_DEMO=1 QALE_DEMO_RECORD=1 pnpm desktop
```

The terminal must print `demo: replay server (record) on http://127.0.0.1:...`. If it says `(replay)`, the record
flag did not reach the app. Stop and tell me.

On first launch the app builds the workspace, slides every date to today, and copies four files to
`~/Desktop/Qale demo files`. Then:

1. Open Settings → Provider and enter your real Anthropic key.
2. Quit the app and start it again with the same command. The key is read when the replay server starts.
3. Open Settings → Demo and press **Reset demo**. This gives you a clean vault, clean fake Jira and clean calendar.
4. Check Settings → Provider still shows your real key. If it shows "demo", enter it again and restart.

Now you are at the start line. From here on, one continuous run.

**Fresh round after a failed or superseded take.** Your key survives Reset, so: pull the branch, make sure
`demo/recordings/` holds only `_fallback.json`, start record mode, Settings → Demo → **Reset demo**, go.
Reset also rewrites the Desktop folder, so the sample files are always the current ones, dated to today.

### The script

Nothing is typed. Every step is a drop, a paste, a click, or a menu pick, so the recording matches at replay no
matter who presents. Approve cards as they are, without editing. Wait for each session to finish before the next
step. A transcript session takes minutes; that is normal.

**Flow 1. Drop the steering transcript.**

Drag `steering-h2-priorities.vtt` from the Desktop folder `Qale demo files` onto the app window. Not the copy in
the repo: only the Desktop copy is dated to today. Wait for the arrival session to finish. You should see, roughly:

- a meeting page for the steering on the day before today
- a decision "shift swaps before payroll export" that supersedes the H2-order decision, with offline mode declined
- todos with owners: Rebecca re-estimates SCH-240, Henrik reviews swap notifications, you tell Fjord Sports the new
  payroll-export timeline
- three outbound cards: a comment on SCH-118, a new SCH story for swap notifications, a patch to Roadmap H2

If the model asks a question (a card with options) before it files anything, answer it and write down the exact
option you picked; the presenter must pick the same one. Seen so far:

- "Henrik todo", whether "I'll ping Henrik today" is the same commitment as the seeded GDPR review: **Same
  commitment**. One Henrik item is cleaner than two.

A question about the meeting date means the sample dating is broken again. Stop and tell me.

Press **Approve all**. Then approve the three outbound cards one at a time. Open the SCH-118 ticket page and check
the comment is there; if it is not, the connection is not on the fake. Stop and tell me.

If the cards are wrong in a way you would not show an audience, stop here and tell me. We fix the transcript or the
skill, Reset, and start again. A recording of a bad session is worthless.

**Flow 2. Marcus's fourth ping.**

Open Todos. "Reply to Marcus about the swap ETA" is due today; its body holds his three pings. Click **Help me
handle this**. Expect a reply he can send, in the sales voice: the epic closed this morning and ships on the
Tuesday release train, the decision you just approved, and what he promised at the QBR. Approve what it proposes
(the reply is copy-only; the logging of what Marcus was told is a card).

**Flow 3. Paste the support thread.**

Open `support-thread-brunos.md` from the Desktop folder, copy the whole body, paste it into Home's bar. Wait.
Expect an insight on shift swaps with Bruno's as the customer, an update to the Bruno's page, a comment on
SCH-231, and a todo to tell Bruno's. Check the insight card carries the tag `shift-swaps`. Approve all, then the
outbound comment.

**Flow 4. Who needs to know.**

In Home, Ask exactly this, one sentence:

    SCH-231 is done. Who needs to know, and what do I tell them?

Expect each person with what they were told and when, from the record: Café Nord (promised at the QBR by Marcus),
Bruno's (asked in March, never answered, from Flow 3), Fjord Sports (told Q4 for payroll export, now Q1), and
Jonas for a support macro. Messages in the CS voice for the customers. Approve the cards that log what each was
told. If it asks a question first, pick the first option and write down the exact label; the presenter picks the
same one.

**Flow 5. Weekly update.**

Type `/` in Home, pick **Write the weekly update**. Wait. Expect drafts for Åsa (exec), customers (CS) and sales,
each with what changed this week: the decision, the messages just sent, SCH-231's state. Approve the three drafts.

**Stop.** Do not run the librarian or meeting prep with Run now, do not use Ask, do not open Settings → Demo →
Reset. Quit the app. Tell me it is done.

### If something breaks mid-run

Stop, tell me what you saw, and do not continue. The recordings are prefix-matched, so a half-run is not reusable
once the vault state has diverged. The recovery is always Reset and start from Flow 1. Budget one hour per full
run.

## Part 2: what I do after

1. Read every new file in `demo/recordings/`. Check each conversation has the turns the flow needs, and that the
   files pair up with the five flows.
2. Fix responses if needed. I may edit the `response` side of a turn (wording, a wrong date), never the `request`
   side, because that is what matching reads.
3. Replay it cold. `QALE_DEMO=1 pnpm desktop` with `QALE_DEMO_TODAY` pinned to a different date, Reset, run the whole
   script again, and confirm every prompt gets its recording and not the fallback.
4. Run `pnpm test`, `pnpm check-types`, `pnpm lint`.
5. Commit the recordings with the Rota dataset and the demo-mode work on the `demo` branch.
6. Trigger **Build installers** in GitHub Actions with the `demo` box ticked. The artifact `qale-demo-windows` is
   the installer. It has to come from the CI runner; a Mac cannot build it.
7. Write the two-paragraph note for your co-founder (below) and hand you the download link.

## Part 3: what your co-founder gets

- An installer named "Qale Demo". Windows shows "Windows protected your PC" because it is unsigned. The path is
  **More info → Run anyway**. It installs per user, no admin prompt.
- On first launch the app builds the demo workspace, and puts the four demo files in `Desktop\Qale demo files`.
- The five flows in order, from the README in the Desktop folder. Nothing is typed.
- Settings → Demo has Reset, for starting over between demos. Nothing in there is part of the walkthrough.
- Anything typed into Ask gets the line "I'm the demo build, so I only know the walkthrough."
- No API key, no Jira, no Confluence, no Google account. Everything is faked inside the app.

## Known limits

- Recordings go stale when a skill or prompt template changes. After any merge touching `vault-dev/skills/` or the
  session prompts, re-record.
- Flow 6 (commitment check, meeting prep) is not in the recording plan. The calendar is faked and meetings show
  up, but meeting prep only runs via Run now and is not recorded.
- Approving a card that has gone stale triggers "Fix this", which calls the model. It should not happen on a fresh
  Reset. If it does at demo time, the fix reply is the fallback line.
