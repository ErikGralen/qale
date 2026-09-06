# Demo runbook: record the walkthrough, ship the Windows installer

The demo build answers every prompt from recordings. Today `demo/recordings/` holds only the fallback line, so the
next step is one clean recorded walkthrough of Flows 1 to 5 from `docs/demo-flows.md`. This file is the script for
that session: what you do, what I do after, and how to tell when something went wrong.

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

### The script

Type the prompts exactly as written. Copy them from `chat-prompts.md` on the Desktop rather than retyping. Approve
cards as they are, without editing, so the recording matches what the vault will contain at replay. Wait for each
session to finish before the next step. A transcript session takes minutes; that is normal.

**Flow 1. Drop the steering transcript.**

Drag `steering-h2-priorities.vtt` from the Desktop folder onto the app window. Wait for the arrival session to
finish. You should see, roughly:

- a meeting page for the steering on the day before today
- a decision "shift swaps before payroll export" that supersedes the H2-order decision, with offline mode declined
- todos for Rebecca (re-estimate SCH-240), Henrik (GDPR review), and you (tell Fjord Sports)
- three outbound cards: a comment on SCH-118, a new SCH story for swap notifications, a patch to Roadmap H2

Press **Approve all**. Then approve the three outbound cards one at a time.

If the cards are wrong in a way you would not show an audience, stop here and tell me. We fix the transcript or the
skill, Reset, and start again. A recording of a bad session is worthless.

**Flow 2. Ask when we can deliver.**

In Home, Ask: `When can we deliver shift swaps to Café Nord, and what have they already been told?`

Then: `Draft a reply to Marcus in the sales voice.`

The answer should cite SCH-231's state, the decision you just approved, Rebecca's re-estimate todo, and Marcus's
QBR promise. It should say there is no target date in Jira.

**Flow 3. Paste the support thread.**

Open `support-thread-brunos.md` from the Desktop folder, copy the whole body, paste it into Home's bar. Wait for the
session. Expect an insight on shift swaps with Bruno's as the customer, an update to the Bruno's page, a comment on
SCH-231, and a todo for Ulrika. Approve all, then the outbound comment.

**Flow 4. Who needs to know.**

Settings → Demo → apply **SCH-231 → Done**. Wait for the sync that follows (the ticket page for SCH-231 should read
Done). Then Ask: `SCH-231 just went to Done. Who needs to know, and what were they told?`

Then: `Draft the messages, CS voice for the customers, one line for Jonas.`

Approve the cards it produces.

**Flow 5. Weekly update.**

Type `/` in Home, pick **Write the weekly update**. Wait. Approve the three drafts.

**Stop.** Do not run the librarian or meeting prep with Run now, do not ask anything extra, do not open Settings →
Demo → Reset. Quit the app. Tell me it is done.

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
- The five flows in order, with the prompts in `chat-prompts.md`. Prompts must be pasted as written.
- Settings → Demo has the SCH-231 → Done step for Flow 4, and Reset to start over.
- Anything typed off-script gets the line "I'm the demo build, so I only know the walkthrough."
- No API key, no Jira, no Confluence, no Google account. Everything is faked inside the app.

## Known limits

- Recordings go stale when a skill or prompt template changes. After any merge touching `vault-dev/skills/` or the
  session prompts, re-record.
- Flow 6 (commitment check, meeting prep) is not in the recording plan. The calendar is faked and meetings show
  up, but meeting prep only runs via Run now and is not recorded.
- Approving a card that has gone stale triggers "Fix this", which calls the model. It should not happen on a fresh
  Reset. If it does at demo time, the fix reply is the fallback line.
