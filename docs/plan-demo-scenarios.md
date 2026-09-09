# Five independent demo scenarios

**Implemented 2026-09-09.** `docs/demo-mode.md` is now the reference; read that first. The five
scenarios shipped as written here, as `demo/scenarios/s1.json` to `s5.json`.

Plan, 2026-09-09. Replaces the flow chain in `docs/demo-flows.md` section 3 and fills in the empty Decision fields of `docs/demo-scenarios.md`. The build items DS-1 to DS-9 in `docs/demo-scenarios.md` are all "build"; this plan is the content they run.

Read with `docs/plan-demo-replay.md`. That plan replaces text-matched recordings with per-scenario scripts, so three things below become easier than written: typed sentences no longer have to match a recording, written answers in an iterate box no longer have to be retyped, and a skill change on `main` no longer forces a re-record. The "record" steps below then mean "run once to draft the script, then edit the script".

The ask, in Erik's words: five scenarios, any order, each showing more of the product, each short, reset between them.

## 1. Feature inventory

Every user-visible capability today. "Shown" means the current five flows (`docs/demo-flows.md`) show it on purpose.

| # | Capability | Where it lives | Shown today |
|---|---|---|---|
| F1 | Drop a transcript. It is saved first, then filed, matched to the calendar slot, read, and turned into a meeting page, decisions, todos and hub updates. | `vault-dev/skills/arrival/SKILL.md`, `apps/desktop/src/renderer/src/app/AddSource.tsx` | Yes (flow 1) |
| F2 | Paste a thread. A long paste into Home (over 800 chars or 10 lines) is filed as a source with a summary, and its signals go on the hubs. | `apps/desktop/src/renderer/src/lib/capture-event.ts`, arrival skill | Yes (flow 3) |
| F3 | A decision that supersedes an older one. The old one flips to `superseded`, the librarian repoints what cited it. | arrival skill, `vault-dev/agents/librarian/AGENT.md` | Yes (flow 1) |
| F4 | Todos with owners and due dates from "I'll do X" lines, with the quote. | `propose_todo` in `packages/agent/src/tools.ts`, `TodosView.tsx` | Yes (flow 1) |
| F5 | Claim check and clarifying question. The run writes out what the material claims, checks each claim against the record, and asks one question with two options when they disagree. | `packages/agent/src/claims.ts`, `packages/agent/src/ask.ts`; arrival, commitment-check, process-note, Ask skills | By accident (flow 4 asked three questions because the premise was wrong) |
| F6 | Outbound cards: a Jira comment, a new ticket, a Confluence patch. Each waits, executes on approve, files the link back. | `DRAFT_TOOL_NAMES` in `tools.ts`, `apps/desktop/src/main/demo/fake-atlassian.ts` | Yes (flow 1, 5) |
| F7 | House style for tickets and pages, learned and editable. | `vault-dev/skills/jira/SKILL.md`, `vault-dev/skills/confluence/SKILL.md` | Implicitly |
| F8 | Ask the memory: a cited, dated answer, with live Jira and Confluence reads. | `ASK_SKILL` in `packages/sessions/src/defaults.ts`, `Home.tsx`, `jira_get_issue` | Yes (flow 4) |
| F9 | "When can we deliver?" answered from the ticket mirror and the told-ledger, never from memory. | Ask skill plus the house rules line | Yes (flow 2) |
| F10 | Who needs to know: the list of people and accounts with what they were told and when. | Ask skill, `customers/*` "What they've been told", `people/*` `last_told` | Yes (flow 4) |
| F11 | Help me handle this (a todo): plan, close, reschedule, raise it in the next meeting, or a nudge to copy. | `TodoDetail.tsx`, `vault-dev/skills/commitment-check/SKILL.md` (outbound half) | Yes (flow 2) |
| F12 | A request came in: decode the ask into a note in `notes/`, name the job behind it, find the collision with a live decision, draft the reply. | commitment-check skill (inbound half) | No |
| F13 | Draft text in a voice, as tabs with Copy. Exec, CS and sales voices. | `draft_text` and `get_voice` in `tools.ts`, `vault-dev/voices/*.md`, `docs/draft-text.md` | Yes (flow 2, 4, 5) |
| F14 | Voice learning. The first update shows three styles; copying one and answering "For exec" rewrites the voice file and the next update follows it. | weekly-update skill "The first time", `vault-dev/skills/writing-skills/SKILL.md` | No |
| F15 | The Friday update per audience, plus a card that updates the Confluence weekly page. | `vault-dev/skills/weekly-update/SKILL.md` | Yes (flow 5), the Confluence card was drafted but not shown |
| F16 | Iterate: rounds of ideas on one card (Keep it / Cut it / Anything else), ending in the artifact, for example one ticket card per story. | `vault-dev/skills/iterate/SKILL.md`, `docs/iterate-in-chat.md` | No |
| F17 | Standing instructions. "From now on..." lands as a rule in the house rules, or in the Jira or Confluence file, with an "Added to rules" line. | `propose_instruction` in `tools.ts`, house rules "Your rules" | No |
| F18 | Learning from a card edit. Edit a ticket card before approving and the next turn offers the change as a rule. | `SHARED_PREAMBLE` in `packages/agent/src/prompts.ts` | No |
| F19 | Meeting prep. An upcoming meeting page offers a brief; one proposal writes `## Prep` from last_told, ticket movement and landmines. | `vault-dev/agents/meeting-prep/AGENT.md`, `NoteView.tsx` around line 696 | No |
| F20 | Tidy a rough note. "Go through this document" on a scratch note: a copy-edit card, insights, todos, links. | `vault-dev/skills/process-note/SKILL.md`, `NoteView.tsx` line 499 | No |
| F21 | Write a spec from a theme's insights and decisions, every line traced. | `vault-dev/skills/spec/SKILL.md` | No |
| F22 | Find the pattern across a stack of sources (fan-out readers). | `vault-dev/skills/synthesis/SKILL.md`, `packages/agent/src/spawn.ts` | No, and it is minutes long |
| F23 | Tell Qale about something (interview into the about pages). | `vault-dev/skills/tell-qale/SKILL.md` | No |
| F24 | Calendar drafts: an event, a reschedule, an RSVP, behind a card. | `CALENDAR_TOOL_NAMES` in `tools.ts`, `fake-google-calendar.ts` | No |
| F25 | Librarian on demand: broken links, stray notes, a wiki page that drifted from a decision. | `agents/librarian`, Run now on `SkillAgentPage.tsx` | No |
| F26 | Activity: every landed write listed, one press puts it back. | `ActivityView.tsx` | Mentioned, not shown |
| F27 | Track a ticket or follow a space from the chat. | `track_external`, `follow_container` in `tools.ts` | No |
| F28 | Skills and voices are files the PO can read and edit in the app. | `SkillsView.tsx`, `vault-dev/skills/index.md` | No |

Not demoable offline: ask the codebase (`codebase.ts`), the MCP server, onboarding (the demo build skips it).

## 2. The five scenarios

One shared baseline (section 4). Each starts from the Start button. Turns are counted as things Erik does. "Lands" means the write happened and is listed above the reply, per the policy in `apps/desktop/PRODUCT.md`: only a send, a delete, a rewrite of his own prose, or an assumed fact waits as a card.

The dates below are anchor dates (`2026-07-17` is today in the seed). The reset slides them.

### S1. The meeting produced actions

**Value for a prospect:** the meeting ends and Jira, Confluence and the record are updated, with his approval on every send.

**Features:** F1 drop and file, F3 supersede, F4 owned todos, F5 one question, F6 three outbound cards, F19 the brief (optional last turn).

**Start state:** the baseline. Calendar holds "Steering" on 2026-07-16 10:00 with Åsa, Rebecca, Marcus. `decisions/2026-05-18-h2-order-payroll-first` is active. `todos/henrik-review-swap-notifications` is open, due 2026-07-24. Roadmap H2 says payroll first. `SCH-118` In Progress. Desktop folder holds the trimmed `steering-h2-priorities.vtt`.

**Script:**

1. Drag `steering-h2-priorities.vtt` from the Desktop folder onto the window. Say: "yesterday's steering, nobody wrote anything down." The session files it against the 16 July steering slot and reads it.
2. A question card: "You said you'd ping Henrik today. [[todos/henrik-review-swap-notifications]] is open, due 24 July. Same commitment?" Pick **Same commitment**. Say: "it checked the record before writing."
3. The reply lists what landed: the meeting write-up, the decision "Shift swaps before payroll export" superseding the May order, todos for Rebecca (re-estimate SCH-240 by 24 July) and Rebecca (file the swap-approved notification story), the Café Nord ledger line. Three cards wait: a comment on `SCH-118` ("moving to Q1, why"), a new story under `SCH-231` ("Notify the affected colleague when a swap is approved"), a patch to Roadmap H2 swapping the two lines. Open the decision from the list and show the supersede link. Approve the three cards one at a time.
4. Open Jira in the app (the SCH-118 mirror) and show the comment with the source line. Open Roadmap H2 and show version 18.
5. Optional. Open the "Café Nord QBR prep" meeting (21 July) and press the brief button. The `## Prep` proposal says: since last time, the order flipped yesterday; Marcus's "before September" is now the plan; SCH-240 re-estimate due 24 July; landmine: Lena wrote down September. Say: "the next meeting reads the new truth."

**End state:** new decision active, old one superseded, three new todos, comment on SCH-118, a new SCH story in the fake Jira, Roadmap H2 at version 18, optionally a Prep section on the QBR prep page.

**Change from today:** the transcript loses the Fjord Sports exchange (cues 105 to 110) and the offline-mode exchange (cues 111 to 126). Those two subjects are owned by S2 and S3. It no longer needs anything to close `SCH-231`.

### S2. Who needs to know

**Value for a prospect:** a feature shipped three weeks ago; the workspace lists everyone who asked or was promised, with dates, and drafts what to tell each one.

**Features:** F10 who needs to know, F9 the delivery answer from the record, F8 live Jira read, F13 two voices (CS for the customer, plain for colleagues), F17 a standing instruction.

**Start state:** the baseline. `SCH-121` Done 2026-06-24. `customers/fjord-sports` ledger last entry 2026-05-26 (told Q4 for Visma). `people/oskar-lind`, `ulrika-nystrom`, `malin-sjoberg`, `jonas-berg` with `last_told`. `customers/kaffekopp` with the churn story.

**Script:**

1. In Home, type: `SCH-121 shipped three weeks ago and nobody outside the team was told. Who needs to know, and what do I tell them?`
2. The reply names each one with the evidence: Fjord Sports, who asked for approved hours per store on 26 May and were last told Q4 for Visma; Ulrika, who asked to hear before the customer; Malin, who wants the account list before the release note; Jonas, who had support tickets asking whether hours can go to payroll. It says plainly, from `SCH-125` and `PLT-77`, that the Visma date is still Q4 as told, that Fortnox is blocked on the token store, and that Jira holds no date. It cites Kaffekopp as the lesson. Two panels: a CS-voice note to Oskar (two tabs), a plain internal note for Ulrika, Malin and Jonas with the support macro sentence. The ledger lines on Fjord Sports and the four people pages land and are listed. Copy the Oskar tab.
3. Type: `From now on, when something a customer asked for ships, tell Ulrika before the customer.` The reply says "Added to rules" with a link to the house rules. Open the house rules and show the line under "Your rules".

**End state:** ledger entries dated today on `customers/fjord-sports` and four people pages, one new rule in house rules. Nothing in Jira changed.

**Change from today:** flow 4 moves off `SCH-231` onto `SCH-121`. Decision and reason in section 5.

### S3. A request came in

**Value for a prospect:** a sales ask arrives with a claim that contradicts the record; the workspace asks once, then writes the reply sales can forward.

**Features:** F12 inbound decode, F5 clarifying question on a contradiction, F13 sales voice, collision with a live decision (house rules "a contradiction is its own proposal").

**Start state:** the baseline. `decisions/2026-02-12-decline-offline-mode` active, `research/offline-mode` stance won't-do, `meetings/2026-07-09-steering` says "No decisions". Desktop folder holds `marcus-offline-mode.md` (under 800 characters and 10 lines, so it is a message, not a source).

**Script:**

1. In Home, type `/`, pick **Handle a commitment**, paste the body of `marcus-offline-mode.md`, send. The message: Marcus, a seventy-location retail prospect, "as I understood it Åsa reopened offline mode for H2 at steering on 2026-07-09, so I'd like to tell him it's on the H2 list, can you confirm by Thursday."
2. A question card: "Marcus says Åsa reopened offline mode at steering on 9 July. [[decisions/2026-02-12-decline-offline-mode]] says we are not doing it, and [[meetings/2026-07-09-steering]] records no decisions. Did Åsa reopen it?" Options: **No, the decision stands** / **Yes, Åsa reopened it**. Pick the first.
3. The decode note lands in Documents (`notes/2026-07-17-marcus-offline-mode.md`): the ask verbatim, the job behind it (a proposal line the prospect can sign), the collision with the February decision, posture "no". A panel in the sales voice: "One line to forward" and "What you can tell them", with Rebecca's sync-layer reason and no engineering caveats. Copy one. Say: "the third time this ask comes, the answer costs nothing."

**End state:** one new note in `notes/`, possibly a `last_told` line on `people/marcus-ek`. No cards, nothing sent.

### S4. Break it into stories

**Value for a prospect:** a committed theme becomes Jira stories in two rounds, in the team's house style, one card per ticket.

**Features:** F16 iterate rounds, F6 ticket cards, F7 house style visibly applied (one label, the customer named in the first line, three acceptance checkboxes).

**Start state:** the baseline. `SCH-118` In Progress, `SCH-125` Fortnox in progress and blocked, `decisions/2026-05-20-fortnox-first-payroll-target` says Visma follows in Q4, no Visma stories exist. `skills/jira/SKILL.md` carries the three-checkbox rule.

**Script:**

1. Type `/`, pick **Iterate on something**, type: `Break the Visma connector into stories under SCH-118. Rebecca's team, after Fortnox, Fjord Sports first.`
2. The framing in three lines, then a card with four ideas, each with its case and its cost: OAuth through the PLT-77 token store; reuse the SCH-125 cost-centre mapping; one push per pay period with a rejection report; a pilot with Fjord Sports' 60 stores. Pick **Keep it** on three, **Cut it** on the pilot, skip "Anything else". Say: "I react, it redrafts."
3. Round two: the three stories with three acceptance checkboxes each. Keep all three. The session ends the round with three ticket cards under `SCH-118`, label `payroll-export`, "Fjord Sports" in the first line. Approve one.
4. Open the new ticket's mirror page and show the label, the parent and the three checkboxes. Say: "it wrote the ticket the way this team writes tickets."

**End state:** one or more new SCH stories in the fake Jira with mirrors under `tickets/jira/`, session files with the rounds. Nothing else changed.

**Scripting rule:** with the script engine from `plan-demo-replay.md`, the answer picked on a card only advances the turn index. The next turn must read well for every option, so keep the options to Keep it / Cut it and skip the written box.

### S5. The Friday update

**Value for a prospect:** the update writes itself from what changed this week, in the words each audience needs, and learns the style he picks.

**Features:** F15 weekly update with the Confluence card, F13 three voices, F14 voice learning.

**Start state:** the baseline with one change: `APP-54` (push notification opt-in) Done 2026-07-15, so the week holds a customer-facing ship. This week also holds the 1:1 with Rebecca (13 July), `SCH-240`'s re-estimate comment, and `PLT-77`'s progress. All three voices still list three styles.

**Script:**

1. Type `/`, pick **Write the weekly update**, send with no text.
2. Three panels, each with three style tabs and the same news: exec (decided: nothing this week, the May order stands; shipped: shift reminders 15 July; watch: SCH-240 re-estimate and the Fortnox block), CS (live now: shift reminders since 15 July; committed: nothing new; no date yet: swaps), sales (changed: nothing; no date: swaps). A card waits: a new `2026-07-17` section on the Product weekly update page. Copy the exec **One paragraph** tab. The panel asks "Write updates this way from now on?" Pick **For exec**.
3. The reply: "Got it. Exec updates: one paragraph, result first. [[voices/exec|Exec voice]]". Open the exec voice and show the first line changed and two styles gone. Say: "it learned from what I copied, and I can edit that file."
4. Approve the Confluence card. Open the Product weekly update mirror and show version 39 with the new section on top.

**End state:** `voices/exec.md` rewritten, Product weekly update at version 39 in the fake Confluence and re-synced in `wikipages/`.

**Draft on a Wednesday to Friday** (or pin `QALE_DEMO_TODAY`), so "this week" holds 13 to 17 July. At replay the weekday does not matter, because the drafts are scripted.

### Coverage

| Feature | S1 | S2 | S3 | S4 | S5 |
|---|---|---|---|---|---|
| Transcript in (F1) | x | | | | |
| Supersede (F3) | x | | | | |
| Clarifying question (F5) | duplicate | | contradiction | | |
| Jira/Confluence cards (F6, F7) | x | | | x | x |
| Ask with citations, live Jira (F8) | | x | | | |
| Delivery answer from the record (F9) | | x | | | |
| Who needs to know (F10) | | x | | | |
| Inbound request (F12) | | | x | | |
| Voices (F13) | | cs, plain | sales | | exec, cs, sales |
| Voice learning (F14) | | | | | x |
| Weekly update (F15) | | | | | x |
| Iterate (F16) | | | | x | |
| Standing instruction (F17) | | x | | | |
| Meeting prep (F19) | optional | | | | |

Not covered, on purpose: F2 paste a thread (it is filing with no card, no question and no voice; the Bruno's thread is cut), F20 tidy a note, F21 spec, F22 synthesis, F23 tell Qale, F24 calendar drafts, F25 librarian on demand. If S4 proves hard to draft, swap it for F20: open `notes/auto-schedule-interviews` and press "Go through this document" (a copy-edit card, an extended insight, two todos, one owned by Jonas). It is the most reliable unshown feature.

## 3. Independence check

Reads are from the seed unless marked. Writes are what the scripted run makes.

| Scenario | Files read | Files written | Tickets and pages read | Tickets and pages written |
|---|---|---|---|---|
| S1 | meetings index and `2026-07-16-steering` (calendar page), `decisions/2026-05-18-h2-order-payroll-first`, `customers/cafe-nord`, `people/rebecca-holm`, `people/henrik-dahl`, `todos/henrik-review-swap-notifications`, `insights/swap-notifications-show-personal-data`, `notes/h2-capacity`, `skills/jira`, `skills/confluence`; optional: `meetings/2026-07-21-cafe-nord-qbr-prep`, `people/lena-strand`, `people/marcus-ek` | `meetings/2026-07-16-steering`, new `decisions/2026-07-16-h2-order-swaps-first`, `decisions/2026-05-18` (standing flipped), two or three new todos, `customers/cafe-nord` (ledger), `people/asa-lindgren` (last_told); optional `## Prep` on the QBR prep page | `SCH-231`, `SCH-240`, `SCH-118`, Roadmap H2 | comment on `SCH-118`, new story under `SCH-231`, Roadmap H2 patch |
| S2 | `customers/fjord-sports`, `customers/kaffekopp`, `people/oskar-lind`, `ulrika-nystrom`, `malin-sjoberg`, `jonas-berg`, `meetings/2026-05-26-fjord-sports-payroll-call`, `insights/fjord-sports-expects-payroll-q4`, `research/payroll-export`, `decisions/2026-05-20-fortnox-first`, `voices/cs`, house rules | `customers/fjord-sports` (ledger), four people pages (last_told), house rules "Your rules" | `SCH-121`, `SCH-118`, `SCH-125`, `PLT-77` | none |
| S3 | `decisions/2026-02-12-decline-offline-mode`, `research/offline-mode`, `meetings/2026-07-09-steering`, `people/marcus-ek`, `voices/sales`, notes index | new `notes/2026-07-17-marcus-offline-mode`, maybe `people/marcus-ek` (last_told) | maybe Roadmap H2 | none |
| S4 | `research/payroll-export`, `decisions/2026-05-20-fortnox-first`, `customers/fjord-sports`, `people/rebecca-holm`, `skills/jira`, session files | session files only | `SCH-118`, `SCH-125`, `SCH-121`, `PLT-77` | new stories under `SCH-118` |
| S5 | meetings this week, decisions list, every ticket mirror, insights, `wikipages/confluence/product-weekly-update`, three voices, `skills/confluence` | `voices/exec` | all mirrors, Product weekly update | Product weekly update, new section |

Where two scenarios touch the same thing, and how it is resolved:

- `SCH-118`: S1 writes a comment, S2 and S4 read the mirror. Resolved by the reset. Not resolvable by content, because Åsa's instruction in the transcript is the comment on the payroll epic, and the Visma stories belong under that epic.
- `customers/fjord-sports`: S2 writes the ledger, S4 reads the page. Resolved by the reset. The transcript no longer mentions Fjord Sports, so S1 is out of this.
- `people/marcus-ek`: S1 may write last_told (optional turn 5 reads it), S3 reads and may write it. Resolved by the reset. Content fix applied: offline mode is cut from the transcript, so S1 never touches S3's subject.
- Roadmap H2: S1 patches it, S3 may read it. Resolved by the reset.
- S5 reads every mirror, so it reads what S1 and S4 create in Jira. Resolved by the reset. S5's drafts cite only the seed.
- `voices/exec`: only S5 writes it, and nothing else reads it except S5.
- House rules: only S2 writes it. Every session reads it, so any scenario run after S2 without a reset reads one extra line. The reset removes it.

No scenario needs a file another scenario creates. That is the property the last take lacked.

## 4. Reset requirements

One shared baseline is enough. Recommendation: one baseline, no per-scenario overlays. The reason is S2: once "who needs to know" runs on `SCH-121`, which the seed ships Done, nothing needs a second tracker state. S5's one change (`APP-54` Done) goes into the seed itself, because no other scenario cares about `APP-54`.

What "Start scenario N" must restore, for every N (this is `DemoService.reset()` plus the pin):

1. The workspace: delete it, copy `vault-dev/` back, slide dates to today. This undoes S1's decision and todos, S2's ledger lines and rule, S3's note, S4's mirrors, S5's voice rewrite.
2. The fake Atlassian store from `demo/atlassian-fixture.json`: undoes S1's comment and story, S4's stories, S1's and S5's page versions.
3. The fake Google store: nothing writes to it today, but reset it anyway.
4. App state: the per-vault DB (sessions, parked questions, proposals), the search index, pi session files, renderer Local Storage (tabs, pins). A parked question from an abandoned S3 must not survive into S1.
5. The replay server: clear its bindings and pin the scenario.
6. The Desktop folder `Qale demo files`, rewritten and dated (the trimmed transcript and the Marcus message).
7. The window on Home, with no skill picked in the bar.

One recommendation beyond today's reset: initialise git in the reset workspace with one commit. `apps/desktop/PRODUCT.md` rests "nothing lands unseen" on Activity's put-back, and the demo workspace has no `.git`, so put-back is the one claim the demo cannot show. It is a small change in `demo-service.ts` and it makes S2 and S3 (all-landed scenarios) demonstrably reversible.

## 5. What changes in the material

Decision on the brief's open question: **S2 moves off `SCH-231` onto `SCH-121`.** `SCH-121` is Done in the seed, so no question is asked, no overlay is needed, and no mechanism has to close a ticket behind the presenter. The story also gets stronger: the thing shipped three weeks ago and nobody told the account that asked for it, which is the Kaffekopp shape the research is built on. `SCH-231` stays In Progress in every scenario.

### vault-dev/

Edit:

- `tickets/jira/APP-54.md`: state Done, `remote_updated` 2026-07-15, comment from Amir Haddad: "Shipped in the 15 July staff-app release. Shift reminders are on by default once the first shift is visible." Update its line in `tickets/index.md`. Reason: S5 needs one customer-facing ship this week.
- `tickets/jira/SCH-121.md`: add a comment dated 2026-06-24 after the existing one: "Enabled for every chain in the 24 June release. Managers export from the period view." Reason: S2 must not have to ask whether the export reached customers.
- `meetings/2026-05-26-fjord-sports-payroll-call.md`, Notes: change the "Wanted" line to "approved hours only, per store, per pay period, as a file they can load into Visma until the connector exists." Reason: S2 links `SCH-121` to what Oskar asked for.
- `customers/fjord-sports.md`, Commitments: add "A file of approved hours per store would already remove the retyping; Oskar asked for that first on 2026-05-26." Leave the ledger as it is (last entry 2026-05-26), so the gap is visible.
- `people/jonas-berg.md`: add one paragraph: "Two tickets in June asked whether approved hours can go to payroll without retyping. He has no macro for it and has not been told the export exists." Reason: S2 lists Jonas with evidence.
- `people/marcus-ek.md`: add one sentence: "He has brought offline mode to me for prospects twice, and both times the answer was the February decision." Reason: S3 texture; not the contradiction itself.

Leave as they are: `SCH-231` and children, the three voices with three styles, the overdue Fjord Sports todo, the raw auto-schedule note, `todos/reply-marcus-swap-eta` (texture in the Todos list, not a scenario).

Remove: nothing in `vault-dev/`.

### scripts/

- `scripts/lib/atlassian-cast.ts`: `APP-54` status Done with the comment above; `SCH-121` second comment. Then `pnpm build-demo-fixture`.
- Remove `scripts/demo-overlays/done/` and the `--done` flag in `scripts/refresh-demo.ts`. Nothing needs `SCH-231` Done any more.

### demo/

- `atlassian-fixture.json`: rebuilt from the cast (the two ticket changes). Roadmap H2 and Product weekly update bodies unchanged.
- `google-fixture.json`: no change. "Steering" 16 July is S1's slot, "Café Nord QBR prep" 21 July is S1's optional brief, "Fjord Sports call" 24 July stays as texture. "Bruno's CS sync" stays; Bruno's is no longer in a scenario, and a calendar with only scenario meetings looks staged.
- `recordings/`: wipe everything but `_fallback.json`. The scripts in `demo/scenarios/s1.json` to `s5.json` replace them (see `plan-demo-replay.md`).

### demo-samples/

- `steering-h2-priorities.vtt`: edit. Cut cues 105 to 110 (Fjord Sports timeline) and 111 to 126 (offline mode). Renumber. Keep the H2 flip, the GDPR exchange with "I'll ping Henrik today", Rebecca's "next Friday", Marcus's "my slides already say September", the fourth story, the roadmap page and SCH-118 comment, and "is anyone writing any of this down".
- `marcus-offline-mode.md`: add. Under 800 characters and under 10 lines. Draft: "Marcus Ek, #sales, 08:41. Quick one before my 9:00. A retail prospect, seventy-odd locations, is close to signing and their ops director keeps asking about offline mode in the staff app. As I understood it, Åsa reopened offline mode for H2 at steering on 2026-07-09, so I'd like to tell him it's on the H2 list. Can you confirm by Thursday? He wants it in the proposal." No prospect name, so the run does not ask whether to create a customer page.
- `support-thread-brunos.md`: remove. No scenario uses it, and an unscripted drop answers with the off-script line.
- `README.md`: rewrite as five cards in no order. Each card: what to do, the sentence to type or paste, the option to pick on any question, what to expect, and what to open at the end.

### docs/

- `docs/demo-runbook.md`: five short drafting sessions, one per scenario, each ending with "quit". The librarian pass that follows S1's supersede calls the model; the replay plan gates it in the demo build, so it does not need a script.
- `docs/demo-flows.md` section 3 and 4: mark as replaced by this plan.

## 6. Risks

Where the model may not follow the script during the drafting run, and how the material is shaped to make the wanted behaviour likely. With scripts as the source of truth, a weak drafting run is fixed by editing the script rather than by a retake, so most of these cost minutes, not an hour.

- **S1 asks a different question, or none.** The Henrik question was seen once. If the run asks about the meeting match instead, the transcript header (a NOTE cue with the date and the four names) and the calendar slot on that date are what make "attach to the 16 July steering" the obvious answer; keep both. If no question comes, the scenario still works, or the `ask_user` call is written into the script by hand.
- **S1 outbound card count varies.** The last take drafted the comment and the page patch, then dropped a fourth todo. The script says "three cards"; the runbook should say "two or three, approve each". The new story card depends on Rebecca's "it's a fourth one nobody's written" and Åsa's "then write it"; both stay in the trimmed transcript.
- **S1 runs long.** An arrival session is the slowest thing in the demo. Trimming the transcript to about 18 minutes of talk shortens the reads in the drafting run. At replay the script skips the reads, so this only matters when drafting.
- **S2 asks whether the export is live.** The extra comment on `SCH-121` and the SCH-118 comment ("the CSV is out") answer it before it is asked. If it still asks, pick "Yes, live since 24 June" and cut the question from the script.
- **S2 misses a person.** Each of the four has the reason on their own page (Oskar: asked and was told a date; Ulrika: before the customer; Malin: the account list; Jonas: the tickets and no macro). The Kaffekopp page is the fifth thing it should cite, and the house rules line "tell me who is waiting" is what the rationale should name.
- **S3 does not ask.** `check_claims` fails quiet when it is unsure. The claim in the message is dated and names the meeting, and three notes contradict it in plain words (the February decision, the theme's "declined twice", the steering page's "No decisions"). If the run skips the question and drafts the "no" anyway, the demo loses one beat and stays correct. Retake once with the claim scoped tighter ("at steering on 2026-07-09" is what makes the meeting page a candidate), or write the question into the script.
- **S3 asks two questions.** A named prospect would earn "create a page for them?". The message names no prospect for that reason.
- **S4 ends after one round, or refuses.** The iterate skill may go straight to tickets. Either way the last round is the cards, which is the payoff. A refusal ("Visma cannot start before PLT-77") is unlikely because breaking work into stories does not need it to start; if it happens, add "PLT-77 is landing this month" to the instruction.
- **S4 option branches.** The turn after a Keep/Cut card is served by index whichever option is picked. Write it so it reads well if the presenter picks differently, or say in the README which options to pick.
- **S4 house style.** The label list in `skills/jira/SKILL.md` has `payroll-export`, the customer rule and the three-checkbox rule. If a card comes out without them, the run did not read the skill; fix the script's ticket arguments by hand.
- **S5 thin week.** Without `APP-54` the drafts are "nothing this week" three times. The edit above fixes that. Draft mid-week or pin the date, as the scenario says.
- **S5 asks whether swaps are live.** That question came from the previous take's chain (the S1 decision was in the vault). On the clean seed nothing says swaps shipped, so it should not ask.
- **Typed sentences.** The script engine never compares typed text, so a typo cannot miss. Still put the sentences in the README and the Desktop folder, so the presenter says the thing the reply answers.
- **Sub-calls.** Claim checks and file-source summaries are separate single-turn calls. The replay plan answers them by rule with per-scenario overrides in the script's `lookups`.
- **Put back.** Activity's "put it back" does nothing in the demo workspace because it has no git. Either add the git init to reset (section 4) or do not click it on stage.

## Files to touch first

- `demo-samples/steering-h2-priorities.vtt`: trim two passages; add `marcus-offline-mode.md` beside it; rewrite `README.md`.
- `scripts/lib/atlassian-cast.ts`: APP-54 Done, SCH-121 comment; then rebuild `demo/atlassian-fixture.json`.
- `vault-dev/tickets/jira/SCH-121.md`, plus the small edits to `customers/fjord-sports.md`, `people/jonas-berg.md`, `meetings/2026-05-26-fjord-sports-payroll-call.md`, `tickets/jira/APP-54.md`.
- `apps/desktop/src/main/demo/demo-service.ts`: Start = reset + pin; optional git init in the reset workspace.
- `docs/demo-runbook.md`: five drafting sessions replacing the chain.
