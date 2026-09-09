# Five demo scenarios, any one, any order

The decisions this draft left open were made in `docs/plan-demo-scenarios.md` on 2026-09-09.
The scenarios themselves live in `demo/scenarios/s1.json` to `s5.json`, run by the script engine
in `docs/demo-mode.md` (DM-4). This file is now a pointer, kept for the history in it.

## The five, as built

| Id | Title | Do | Features shown |
|---|---|---|---|
| S1 | The meeting produced actions | Drag `steering-h2-priorities.vtt` from the Qale demo files folder onto the window. On the question card, pick Same commitment. | Drop and file a transcript, a decision that supersedes an older one, owned todos, one clarifying question, three outbound Jira/Confluence cards, an optional meeting-prep brief. |
| S2 | Who needs to know | In Home, type: "SCH-121 shipped three weeks ago and nobody outside the team was told. Who needs to know, and what do I tell them?" Then, same session: "From now on, when something a customer asked for ships, tell Ulrika before the customer." | Ask with citations and a live Jira read, the delivery answer pulled from the record, who-needs-to-know across customers and colleagues, two voices, a standing instruction added to house rules. |
| S3 | A request came in | In Home, type `/`, pick Handle a commitment, paste the whole of `marcus-offline-mode.md`, send. On the question card, pick No, the decision stands. | An inbound ask decoded into a note, a clarifying question raised by a contradiction with a live decision, a sales-voice reply. |
| S4 | Break it into stories | In Home, type `/`, pick Iterate on something, type the Visma-connector instruction. Round one: Keep it on the first three, Cut it on the pilot. Round two: keep all three. | Iterate in rounds on one card, Jira ticket cards in the team's house style (label, customer named, three acceptance checkboxes). |
| S5 | The Friday update | In Home, type `/`, pick Write the weekly update, send with no text. Copy the exec One paragraph tab, answer For exec, approve the Confluence card. | The weekly update in three voices, a Confluence card, voice learning from what was copied. |

Each scenario is independent: reads only the seed, writes only what its own script produces,
and runs after any of the others with no reset between. One Reset before the demo is the whole
setup; `pnpm demo:lint` runs the five in four orders on one workspace to prove it.

## DS items, as they landed

- **DS-1, a scenario registry.** Superseded. There is no single `demo/scenarios.json` list. Each
  scenario is its own file, `demo/scenarios/s1.json` to `s5.json`, loaded and validated by
  `scenario.ts`.
- **DS-2, recordings in one folder per scenario.** Superseded. Recordings never moved to
  scenario subfolders; the flat `demo/recordings/` folder feeds `pnpm demo:draft`, which turns a
  recording into a scenario script, and the recordings are deleted once the lint is green.
- **DS-3, a pinned scenario.** Built, then taken out of the app the same day. `ScriptEngine.pin()`
  stays for the lint, which runs one scenario alone with it; nothing in the app pins.
- **DS-4, match on typed messages only inside a pinned scenario.** Superseded. A session is
  classified (a kickoff by its skill name, a typed message by the skill in force when it was
  typed plus a word from the `do` line, or a child) and bound to the first free matching
  conversation across all five; the words typed are otherwise only fingerprinted so the same
  opening returns to the same binding.
- **DS-5, Start scenario: reset, then pin.** Superseded. The presenter presses Reset once
  before the demo and never selects a scenario; the engine picks it from what he does.
- **DS-6, Settings shows the five.** Done. `DemoSettings.tsx`: Reset, then a read-only row per
  scenario with its title and its `do` line as a reminder.
- **DS-7, record one scenario at a time.** Superseded. There is no `QALE_DEMO_SCENARIO`
  variable; record mode still writes to the flat `demo/recordings/` folder, and which scenario a
  recording becomes is decided afterwards, by the `--scenario` flag on `pnpm demo:draft`.
- **DS-8, the content recut.** Done. The changes `docs/plan-demo-scenarios.md` section 5 lists
  are applied: `APP-54` Done, the `SCH-121` comment, the Fjord Sports/Jonas/Marcus lines, the
  transcript trimmed, `marcus-offline-mode.md` added, the Bruno's thread removed, the `--done`
  overlay removed.
- **DS-9, the runbook.** Done. `docs/demo-runbook.md` is the five short sessions, plus the
  authoring workflow.

The reasoning behind the five scenarios, the feature inventory they were chosen from, and the
independence check are in `docs/plan-demo-scenarios.md`, not repeated here.
