# Demo scenarios (v2): new dataset, built from the research

This replaces the Tavla-based demo. Tavla is a customer-discovery story for a startup PM: insights with confidence
scores, churn signals, on-prem asks. The 42-interview research in `transcripts2/combined/` describes a different job:
a PO at a mid-size Nordic product company who spends most of the week in meetings with people who want something,
and then hand-copies the results into Jira, Confluence and four chat threads. The demo data should be that job.

Settled: everything in English (Swedish names only). Nothing in the demo is a demo-only control; every step is a
drop, a paste, a click, a menu pick, or the one sentence in Flow 4. Slack is copy-out only.

## 1. The pains the demo must hit, in priority order

| # | Pain | Evidence weight | The scene the interviewees described |
|---|---|---|---|
| P1 | Meeting → system gap | Highest, most volunteered, 4.22/5 in the wedge workbook | Felix (Nordea): Copilot makes an action list in Teams, "jag kan inte skapa en Jira-ticket baserat på actions som har noterats i ett Teams-möte". Linda (H&M): meetings end with energy but no owner, no next step, and nobody says what we are NOT doing. |
| P2 | PO as human API | Second | Alexandra (Tactel): "Även om vi har status på Jira:n så tror de att om de taggar mig går det snabbare." "Jag får samma fråga i fyra olika chattar." Linda: "När kan det klaras den här?" seven times a minute. |
| P7 | Information never reaches the right person | Single most consequential incident in the corpus | Oskar (Albacross): a customer asked CS for a feature, it shipped, CS never found out, the customer churned. |
| P3 | Fragmented truth | Third | Angelica (PLAYipp): a priority changed in a leadership meeting and "den informationen hade inte kommit ner till oss". "Var lever sanningen någonstans?" |
| P9 | Audience-tailored updates and release notes | Mid | Kevin (Homepal): most release notes are "skit". Alexandra: "det händer typ alltid i sista sekunden". Andreas (Tradera): repainting the team's picture for stakeholders is "dubbelarbete". |
| P5 | AI you cannot trust | Design constraint, not a flow | Angelica: "man får oftast säga till flera gånger att nej men såhär är det inte". Paulo, Felix, Gustav, Linda, Otto: no silent writes, per-line approve, sources visible. |

Rejected anti-patterns the demo must visibly avoid: no new place to fill in ("ännu ett ställe"), no push dashboards
(they failed twice in the corpus), no prioritisation decided by the tool, no separate SaaS to log into.

The research's build order: meeting → action first (W2), the answer layer second (W1), and customer signals as a
second extraction target of the same engine. The flows below follow that order and depend on each other in that order.

## 2. The demo company: Rota

Modelled on the mid-size cluster the research says has the strongest pain a v1 buyer can act on (PLAYipp, Albacross,
Tactel, Pricer): 150 to 400 people, several dev teams, Jira + Confluence + Slack, sales/CS/support/leadership as
stakeholders, and a real churn-shaped incident.

**Rota** makes staff-scheduling software for restaurant and retail chains. A manager builds the week's shift
schedule, staff see their shifts in the app, hours flow to payroll. The vocabulary is shifts, schedules, staff,
managers, locations. Nothing needs explaining. Around 250 people, four dev teams on a quarterly planning cadence.
The PO ("me") owns two teams: Scheduling and Staff App.

Tools, all real and connected: Jira projects `SCH` (Scheduling), `APP` (Staff app), `PLT` (Platform); Confluence
space `PROD` with a "Roadmap H2" page and a "Product weekly update" page; Slack channels `#support`, `#sales`,
`#product`. Meetings are recorded in Teams; the transcript is what gets dropped.

People (the `people/` folder, each with `email` so calendar attendees resolve):

| Person | Role | Why they exist in the demo |
|---|---|---|
| Åsa Lindgren | CPO | Runs the steering meeting, decides priorities, wants three-sentence updates. |
| Rebecca Holm | Tech lead, Scheduling | Refuses dates before estimation. Owns `SCH` epics. |
| Marcus Ek | Head of Sales | Promised a customer a date at a QBR. Asks "when can we deliver?" in four channels. |
| Malin Sjöberg | CS lead | Her team meets customers weekly and hears asks that never reach product. |
| Ulrika Nyström | CS manager for Bruno's | The person who should be told when the feature ships, and never was, last time. |
| Jonas Berg | Support lead | Runs `#support`; writes macros; wants to know what to tell customers. |
| Henrik Dahl | Legal and GDPR | Reviews anything touching staff personal data, usually too late. |

Customers (the `customers/` folder):

| Customer | Relationship | Role in the story |
|---|---|---|
| Café Nord | Active, largest account, 120 locations | Sales promised them shift swaps "before September, when the student staff turn over" at the Q2 QBR. |
| Bruno's Burgers | Active, 35 locations | A manager asked support for shift swaps in March. Nobody linked it to the epic. This is the Albacross setup. |
| Fjord Sports | Active, retail, 60 stores | Was told "Q4" for payroll export. That answer is about to be wrong. |
| Kaffekopp | Churned | Churned last year after asking for something that had already shipped. The cautionary tale on the customer page. |

Themes (`themes/`): **Shift swaps** (staff trade shifts in the app, manager approves; committed), **Payroll
export** (hours to payroll systems; committed, about to be deferred), **Auto-schedule suggestions** (exploring),
**Offline mode** (won't-do, declined twice).

The storyline spine, in anchor-relative dates (`ANCHOR = 2026-07-17`, so `refresh-demo` slides them):

- Q2 QBR with Café Nord (anchor minus 40 days): Marcus promises shift swaps before September. `people/marcus-ek.md`
  and `customers/cafe-nord.md` carry that as `last_told`.
- Standing decision (anchor minus 60 days): "H2 order: payroll export first, shift swaps second."
  `decisions/h2-order-payroll-first.md`, `standing: active`. The Confluence "Roadmap H2" page mirrors it.
- Bruno's support thread (anchor minus 120 days): exists only as a Slack thread. Not in the vault yet. Flow 3
  brings it in.
- Jira today: `SCH-231` "Shift swaps (epic)" In Progress with three child stories (two Done, one In Progress,
  assignee Rebecca). `SCH-118` "Payroll export (epic)" In Progress. No target dates in Jira. The only date anywhere
  is the one sales promised.
- Steering meeting (anchor minus 1 day): Åsa flips the order. Shift swaps first. Payroll export to Q1. Explicit
  not-doing: no offline mode, again. That transcript is Flow 1.
- Overdue todo seeded: "Tell Fjord Sports the new payroll-export timeline" (due anchor minus 3 days). Flow 6.
- Upcoming calendar: "Café Nord QBR prep" (anchor plus 2 days), "1:1 Rebecca" (anchor plus 1 day), "Steering"
  recurring, "Bruno's CS sync" (anchor plus 4 days).

## 3. The flows

Each flow is one door, one batch of cards, one approval. All of them run on the current product: the `arrival`
session on drop or long paste, Ask with citations, the Jira/Confluence mirror in `tickets/` and `wikipages/`,
`draft_ticket` / `draft_ticket_comment` / `draft_page_update` outbound cards, voices, `weekly-update`,
`commitment-check`, meeting prep from calendar.

### Flow 1 — "The meeting produced actions" (P1, P3)

**Drop the steering-meeting transcript → get suggested actions → approve.**

Input: `demo-samples/steering-h2-priorities.vtt`, a Teams transcript, 25 minutes, Åsa, Rebecca, Marcus, me.
Content: Åsa moves shift swaps ahead of payroll export because Café Nord and two more chains need it before the
September staff turnover. Payroll export slides to Q1. Offline mode is raised by Marcus and declined again. Rebecca
will re-estimate the remaining `SCH-231` story by Friday. Henrik must review swap notifications for GDPR (they show
colleagues' names and phone numbers). I owe Fjord Sports an updated timeline. Nobody writes any of it down.

Expected cards:

1. Meeting page with participants and a summary.
2. Decision "Shift swaps before payroll export" that **supersedes** the standing H2-order decision, with deciders,
   rationale and the explicit not-doing (offline mode). On approve the old decision flips to `superseded` and the
   librarian repoints its citations. This is the P3 beat: the truth changed in a leadership room and the record
   changed with it.
3. Todos with owners and due dates: Rebecca re-estimates by Friday; Henrik GDPR review; me, tell Fjord Sports.
4. Outbound, one card each, never batched: a Jira comment on `SCH-118` ("Deferred to Q1 per steering, see
   decision"), a new `SCH` story "Swap request notifications", and a Confluence patch to the "Roadmap H2" page
   swapping the two lines. Each card shows the exact text and the transcript line it came from.

Presenter beat: open the decision card, show the diff and the citation, edit one due date, **Approve all**, then
approve the three outbound cards one by one and open Jira to show the comment landed with the source link.

### Flow 2 — "When can we deliver?" (P2)

**Todo → Help me handle this → copy the reply.** Run right after Flow 1.

Marcus has asked in `#sales` three times this week. The seeded todo "Reply to Marcus about the swap ETA" is due
today and holds the pings. Click **Help me handle this**. The commitment-check skill answers from the record:
`SCH-231`'s state from the mirror (two of three stories done, last remote update), the steering decision approved
two minutes ago, Rebecca's pending re-estimate, and what Marcus promised at the QBR with the date. It says plainly
that there is no target date anywhere but the one sales gave. The reply comes in the sales voice, copy-only, and a
card logs on Marcus's page what he was told.

Presenter beat: the same question comes in four chats; the answer is the same every time because it reads from an
approved log, not from the PO's memory. Nothing is typed.

### Flow 3 — "The support thread" (P4, and the setup for P7)

**Paste a Slack thread → get an insight and a Jira link → approve.**

Input: `demo-samples/support-thread-brunos.md`, a `#support` thread from March. A Bruno's restaurant manager tells
Jonas that every week two or three staff want to trade shifts, and she redoes the schedule by hand each time. She
asks whether Rota will ever let staff swap shifts themselves. Jonas replies "I'll ask product". The thread ends
there. Paste it into Home's bar; it clears the long-paste threshold and files as a source.

Expected cards: an insight on the shift-swaps theme with the thread as evidence and Bruno's as the customer; an
update to the Bruno's customer page; a Jira comment on `SCH-231` ("Bruno's asked for this via support in March,
source linked"); a todo for Ulrika, "tell Bruno's when SCH-231 ships".

Presenter beat: support did not fill anything in. The ask is now attached to the epic that will ship it. This is
the link that did not exist at Albacross.

### Flow 4 — "Who needs to know?" (P7, the payoff)

**The epic closed → one question → approve the messages.**

> Out of date since 2026-09-08. The fake Jira no longer closes `SCH-231` behind the presenter, because that was
> what made this flow depend on Flow 1. `docs/demo-scenarios.md` recuts this flow onto `SCH-121`, which the seed
> already ships Done.

In Home, one sentence, always the same: *"SCH-231 is done. Who needs to know, and what do I tell them?"* The
answer lists each person with what they were told and when: Café Nord, promised at the QBR by Marcus; Bruno's,
asked via support in March and never answered (Flow 3); Fjord Sports, told Q4 for payroll export and now Q1
(Flow 1); Jonas, who needs a support macro. Messages in the CS voice for the customers, cards that log what each
was told.

Presenter beat: this is the churn that does not happen. Nobody recalled these people from memory; each one is on
the list because of an approved note with a date.

### Flow 5 — "Friday update" (P9)

**Run the weekly update → approve per audience.**

Pick the `/` skill **Write the weekly update**. Drafts arrive in three voices: exec (three sentences for Åsa: what
shipped, what moved, what we are not doing), CS (what to tell customers, with the Bruno's and Café Nord lines),
sales (dates that changed). Everything in them was approved in Flows 1 to 4. Approve, copy out.

Presenter beat: the release note is a rewrite of the approved log, not a Friday-afternoon writing task. The scheduled
Friday run is off by default; trigger it by hand and say so.

### Flow 6 — "I promised a date" (P8, spare)

The overdue todo "Tell Fjord Sports the new payroll-export timeline" → **Help me handle this** → `commitment-check`
proposes: a CS-voice note to Fjord Sports with the Q1 timeline citing the steering decision, and moves the item
onto an upcoming call. Approve. If Google Calendar is connected, the meeting-prep agent also writes a `## Prep`
section on "Café Nord QBR prep" within the hour before it: since last time, ticket movement, what Marcus promised,
the open re-estimate.

## 4. Suggested 12-minute arc

| Min | Flow | Beat |
|---|---|---|
| 0-1 | Setup | Finder: the vault is markdown. Jira and Confluence in another tab, real. |
| 1-5 | Flow 1 | Drop the steering transcript. Cards. Supersede. Approve all, outbound one by one, show Jira. |
| 5-6 | Flow 2 | Marcus's todo, Help me handle this, sales-voice reply. |
| 6-8 | Flow 3 | Paste the March support thread. Insight, Jira comment, todo for Ulrika. |
| 8-10 | Flow 4 | One sentence: SCH-231 is done, who needs to know. Messages. |
| 10-12 | Flow 5 | Friday update in three voices. |

Paste the support thread (Flow 3) before starting Flow 1 if you want its cards ready when you get there; a drop is a
full agentic session and takes minutes.

## 5. What has to be rewritten

Vault (`vault-dev/`), all new content, dates relative to `2026-07-17`:

- `people/` 7 notes with `email`, `role`, `cares_about`, `last_told`.
- `customers/` 4 notes, Kaffekopp with the churn story in prose.
- `themes/` 4 notes with `stance` and `evidence`.
- `decisions/` the standing H2-order decision (`standing: active`), the offline-mode won't-do, and 2 to 3 older ones
  so the decision spine looks lived-in.
- `insights/` 3 to 4 seeded (Café Nord's September turnover, Fjord Sports' Q4 expectation, one on auto-schedule).
  None about Bruno's; Flow 3 creates that one.
- `todos/` 4 to 5, one overdue (Fjord Sports), one waiting-on (Henrik).
- `meetings/` the Q2 Café Nord QBR (with Marcus's promise in the notes), last steering, two 1:1s.
- `tickets/jira/` mirror files for `SCH-231` and its three stories, `SCH-118` and two stories, three `PLT` fillers.
  A second snapshot (or a `--done` flag in `refresh-demo`) with `SCH-231` and its last story Done for Flow 4.
  `wikipages/confluence/roadmap-h2.md` and `product-weekly-update.md`.
- `skills/` keep `arrival`, `commitment-check`, `process-note`, `weekly-update`, `spec`, `iterate`, `tell-qale`,
  house rules, the Jira and Confluence style guides. No `broken-demo` or any other fixture a real user would not
  have. Drop `synthesis` from the demo path (it's the Tavla insight-stack story). Update house rules to name the `SCH`/`APP`/`PLT` projects and the `PROD` space.
- `voices/` exec, CS, and a new **sales** voice (short, date-first, no engineering caveats the customer can't act on).
- `agents/` keep librarian and meeting-prep as they are.

Connector seeds:

- `scripts/lib/atlassian-cast.ts` `CAST` (consumed by `reset-atlassian.ts` and `build-demo-fixture.ts`): projects
  `SCH`, `APP`, `PLT`; the epics and stories above with states, assignees, one Blocks link, seeded comments;
  Confluence space `PROD` with "Roadmap H2" and "Product weekly update", bodies read from
  `vault-dev/wikipages/confluence/`. Demo-created items (the new `SCH` story from Flow 1, the two comments) are absent
  from `CAST` so reset removes them. `--done` flips the keys in `DONE_SNAPSHOT_KEYS` for Flow 4.
  **The Atlassian site must have the three projects created by hand** (default To Do / In Progress / Done workflow);
  the script creates issues and the space, never projects. `tavla-demo.atlassian.net` has none of them yet.
- `scripts/seed-google-calendar.ts` `CAST_MEETINGS`: past = vault, upcoming = calendar. Steering weekly from
  2026-07-16 (so the Flow 1 drop gets it as a nearby-meeting hint), 1:1 Rebecca 2026-07-20, Café Nord QBR prep,
  Bruno's CS sync, Fjord Sports call. Attendee emails match `people/*.email`. Events are tagged `rota`; reset also
  sweeps old `tavla`-tagged events.

`demo-samples/`:

- `steering-h2-priorities.vtt` (Flow 1). Teams-style, four speakers, must contain the supersede, the not-doing,
  three owned actions, one GDPR mention, and Marcus repeating the Café Nord promise.
- `support-thread-brunos.md` (Flow 3). Slack export style, three messages, ends unresolved.
- `README.md` rewritten to map files to flows; remove the "Inbox" and "After-Meeting skill" references.

## 6. Sharp edges that survive the rewrite

- API key required. A drop without it files the source and stops.
- Drops accept `.txt .md .vtt .srt` and a few more. PDF, DOCX and audio are refused.
- New pages and append-only updates apply silently by policy with an activity row. Cards are for derived changes,
  todos, deletes and outbound. Say "derived changes arrive as cards".
- Outbound cards are excluded from Approve all. Approve all is a serial loop; a partial failure leaves a mixed queue.
- No weekly commitment-check job exists. `commitment-check` is per todo.
- Demo mode exists on the `demo` branch (bundled vault, in-memory Jira/Confluence from `demo/atlassian-fixture.json`,
  replay server, in-app Reset in Settings → Demo). `demo/recordings/` holds only the fallback, so a demo build answers
  every prompt with the canned line until Flows 1 to 5 are recorded. Google Calendar is not faked; Flow 6 is cut in
  demo builds.
- Nothing posts to Slack. Flows 2, 4 and 5 end in copy-out.
- The repo root holds live connector tokens in `.atlassian-demo.json` and `.google-demo.json`. Do not screen-share it.
