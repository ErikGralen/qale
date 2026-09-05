# Demo scenarios (v2): new dataset, built from the research

This replaces the Tavla-based demo. Tavla is a customer-discovery story for a startup PM: insights with confidence
scores, churn signals, on-prem asks. The 42-interview research in `transcripts2/combined/` describes a different job:
a PO at a mid-size Nordic product company who spends most of the week in meetings with people who want something,
and then hand-copies the results into Jira, Confluence and four chat threads. The demo data should be that job.

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

## 2. The demo company: Brevik

Modelled on the mid-size cluster the research says has the strongest pain a v1 buyer can act on (PLAYipp, Albacross,
Tactel, Pricer): 150 to 400 people, several dev teams, Jira + Confluence + Slack, sales/CS/support/leadership as
stakeholders, and a real churn-shaped incident.

**Brevik** is a Swedish B2B SaaS for property-management operations: work orders, inspections, tenant communication.
Around 280 people, five dev teams on a quarterly planning cadence. The PO ("me") owns two teams: Work Orders and
Tenant Communication.

Tools, all real and connected: Jira projects `WO` (Work Orders), `TEN` (Tenant app), `PLT` (Platform); Confluence
space `PROD` with a "Roadmap H2" page and a "Product weekly update" page; Slack channels `#support`, `#sales`,
`#product`. Meetings are recorded in Teams; the transcript is what gets dropped.

People (the `people/` folder, each with `email` so calendar attendees resolve):

| Person | Role | Why they exist in the demo |
|---|---|---|
| Åsa Lindgren | CPO | Runs the steering meeting, decides priorities, wants three-sentence updates. |
| Rebecca Holm | Tech lead, Work Orders | Refuses dates before estimation. Owns `WO` epics. |
| Marcus Ek | Head of Sales | Promised a customer a date at a QBR. Asks "när kan vi leverera?" in four channels. |
| Malin Sjöberg | CS lead | Her team meets customers weekly and hears asks that never reach product. |
| Ulrika Nyström | CS manager for Solbacken | The person who should be told when the feature ships, and never was, last time. |
| Jonas Berg | Support lead | Runs `#support`; writes macros; wants to know what to tell customers. |
| Henrik Dahl | Legal and GDPR | Reviews anything touching tenant personal data, usually too late. |

Customers (the `customers/` folder):

| Customer | Relationship | Role in the story |
|---|---|---|
| Norrsken Fastigheter | Active, largest account, 14,000 units | Sales promised them bulk scheduling "before the autumn inspection round" at the Q2 QBR. |
| Solbacken Bostäder | Active, municipal housing | Asked support for bulk scheduling in March. Nobody linked it to the epic. This is the Albacross setup. |
| Tornby Living | Active | Was told "Q4" for tenant self-service booking. That answer is about to be wrong. |
| Gärdet Förvaltning | Churned | Churned last year after asking for something that had already shipped. The cautionary tale on the customer page. |

Themes (`themes/`): **Bulk work-order scheduling** (committed), **Tenant self-service booking** (committed, about to
be deferred), **Inspection photo AI** (exploring), **Offline mode for field staff** (won't-do, declined twice).

The storyline spine, in anchor-relative dates (`ANCHOR = 2026-07-17`, so `refresh-demo` slides them):

- Q2 QBR with Norrsken (anchor minus 40 days): Marcus promises bulk scheduling before the autumn inspection round.
  `people/marcus-ek.md` and `customers/norrsken.md` carry that as `last_told`.
- Standing decision (anchor minus 60 days): "H2 order: tenant self-service booking first, bulk scheduling second."
  `decisions/h2-order-self-service-first.md`, `standing: active`. The Confluence "Roadmap H2" page mirrors it.
- Solbacken support thread (anchor minus 120 days): exists only as a Slack thread. Not in the vault yet. Flow 3
  brings it in.
- Jira today: `WO-231` "Bulk work-order scheduling (epic)" In Progress with three child stories (two Done, one In
  Progress, assignee Rebecca). `TEN-118` "Tenant self-service booking (epic)" In Progress. No target dates in Jira.
  The only date anywhere is the one sales promised.
- Steering meeting (anchor minus 1 day): Åsa flips the order. Bulk scheduling first. Self-service booking to Q1.
  Explicit not-doing: no offline mode, again. That transcript is Flow 1.
- Overdue todo seeded: "Tell Tornby Living the new booking timeline" (due anchor minus 3 days). Flow 6.
- Upcoming calendar: "Norrsken QBR prep" (anchor plus 2 days), "1:1 Rebecca" (anchor plus 1 day), "Steering"
  recurring, "Solbacken CS sync" (anchor plus 4 days).

## 3. The flows

Each flow is one door, one batch of cards, one approval. All of them run on the current product: the `arrival`
session on drop or long paste, Ask with citations, the Jira/Confluence mirror in `tickets/` and `wikipages/`,
`draft_ticket` / `draft_ticket_comment` / `draft_page_update` outbound cards, voices, `weekly-update`,
`commitment-check`, meeting prep from calendar.

### Flow 1 — "Mötet gav actions" (P1, P3)

**Drop the steering-meeting transcript → get suggested actions → approve.**

Input: `demo-samples/steering-q4-priorities.vtt`, a Teams transcript, 25 minutes, Åsa, Rebecca, Marcus, me. Content:
Åsa moves bulk scheduling ahead of self-service booking because Norrsken and two more accounts need it for the
autumn round. Self-service booking slides to Q1. Offline mode is raised by Marcus and declined again. Rebecca will
re-estimate the remaining `WO-231` story by Friday. Henrik must review the tenant-notification batching for GDPR.
I owe Tornby an updated timeline. Nobody writes any of it down.

Expected cards:

1. Meeting page with participants and a summary.
2. Decision "Bulk scheduling before self-service booking" that **supersedes** the standing H2-order decision, with
   deciders, rationale and the explicit not-doing (offline mode). On approve the old decision flips to `superseded`
   and the librarian repoints its citations. This is the P3 beat: the truth changed in a leadership room and the
   record changed with it.
3. Todos with owners and due dates: Rebecca re-estimates by Friday; Henrik GDPR review; me, tell Tornby.
4. Outbound, one card each, never batched: a Jira comment on `TEN-118` ("Deferred to Q1 per steering, see decision"),
   a new `WO` story "Tenant notification batching for bulk scheduling", and a Confluence patch to the "Roadmap H2"
   page swapping the two lines. Each card shows the exact text and the transcript line it came from.

Presenter beat: open the decision card, show the diff and the citation, edit one due date, **Approve all**, then
approve the three outbound cards one by one and open Jira to show the comment landed with the source link.

### Flow 2 — "När kan vi leverera?" (P2)

**Sales pings → Ask → copy a cited answer.** Run right after Flow 1.

Marcus writes in `#sales` for the fourth time: "När kan vi leverera bulk scheduling till Norrsken? De frågar igen."

Ask: *"When can we deliver bulk scheduling to Norrsken, and what have they already been told?"*

Expected answer: `WO-231` state from the mirror (In Progress, two of three stories done, last remote update), the
steering decision approved two minutes ago, Rebecca's pending re-estimate todo, and what Marcus promised at the QBR
with the date. It should say plainly that there is no target date in Jira and that the only date in circulation is
the one sales gave. Cite-or-decline, no invented ETA.

Follow up: *"Draft a reply to Marcus in the sales voice."* Copy from the `draft_text` panel.

Presenter beat: the same question comes in four chats; this answer is the same every time because it reads from an
approved log, not from the PO's memory. Do not claim it posts to Slack. It doesn't.

### Flow 3 — "The support thread" (P4, and the setup for P7)

**Paste a Slack thread → get an insight and a Jira link → approve.**

Input: `demo-samples/support-thread-solbacken.md`, a `#support` thread from March. A Solbacken property manager
tells Jonas they schedule roughly 300 spring inspections by hand and asks whether Brevik will ever do it in bulk.
Jonas replies "I'll ask product". The thread ends there. Paste it into Home's bar; it clears the long-paste threshold
and files as a source.

Expected cards: an insight on the bulk-scheduling theme with the thread as evidence and Solbacken as the customer;
an update to the Solbacken customer page; a Jira comment on `WO-231` ("Solbacken asked for this via support in
March, source linked"); a todo for Ulrika, "tell Solbacken when WO-231 ships".

Presenter beat: support did not fill anything in. The ask is now attached to the epic that will ship it. This is
the link that did not exist at Albacross.

### Flow 4 — "Vem måste veta?" (P7, the payoff)

**Ticket goes Done → Ask who needs to know → approve the messages.**

Move `WO-231` to Done in Jira (live, or pre-staged so the mirror already shows it). Ask: *"WO-231 just went to
Done. Who needs to know, and what were they told?"*

Expected answer, each line with its source: Solbacken asked via support in March and was never told (Flow 3);
Norrsken was promised it at the QBR by Marcus; Tornby was told "Q4" for self-service booking and that is now Q1
(Flow 1); Jonas needs a support macro. Then: *"Draft the messages, CS voice for the customers, one line for
Jonas."* Cards: per-recipient drafts to copy, an update to `last_told` on each person, todos for Ulrika and Marcus.

Presenter beat: this is the churn that does not happen. The recipients were not recalled from memory; each one is
there because of an approved note with a date.

### Flow 5 — "Friday update" (P9)

**Run the weekly update → approve per audience.**

Pick the `/` skill **Write the weekly update**. Drafts arrive in three voices: exec (three sentences for Åsa: what
shipped, what moved, what we are not doing), CS (what to tell customers, with the Solbacken and Norrsken lines),
sales (dates that changed). Everything in them was approved in Flows 1 to 4. Approve, copy out.

Presenter beat: the release note is a rewrite of the approved log, not a Friday-afternoon writing task. The scheduled
Friday run is off by default; trigger it by hand and say so.

### Flow 6 — "I promised a date" (P8, spare)

The overdue todo "Tell Tornby Living the new booking timeline" → **Help me handle this** → `commitment-check`
proposes: a CS-voice note to Tornby with the Q1 timeline citing the steering decision, and moves the item onto the
upcoming "Solbacken CS sync" or a Tornby call. Approve. If Google Calendar is connected, the meeting-prep agent
also writes a `## Prep` section on "Norrsken QBR prep" within the hour before it: since last time, ticket movement,
what Marcus promised, the open re-estimate.

## 4. Suggested 12-minute arc

| Min | Flow | Beat |
|---|---|---|
| 0-1 | Setup | Finder: the vault is markdown. Jira and Confluence in another tab, real. |
| 1-5 | Flow 1 | Drop the steering transcript. Cards. Supersede. Approve all, outbound one by one, show Jira. |
| 5-6 | Flow 2 | Marcus's fourth ping. Cited answer, sales-voice reply. |
| 6-8 | Flow 3 | Paste the March support thread. Insight, Jira comment, todo for Ulrika. |
| 8-10 | Flow 4 | WO-231 Done. Who needs to know. Messages. |
| 10-12 | Flow 5 | Friday update in three voices. |

Paste the support thread (Flow 3) before starting Flow 1 if you want its cards ready when you get there; a drop is a
full agentic session and takes minutes.

## 5. What has to be rewritten

Vault (`vault-dev/`), all new content, dates relative to `2026-07-17`:

- `people/` 7 notes with `email`, `role`, `cares_about`, `last_told`.
- `customers/` 4 notes, Gärdet with the churn story in prose.
- `themes/` 4 notes with `stance` and `evidence`.
- `decisions/` the standing H2-order decision (`standing: active`), the offline-mode won't-do, and 2 to 3 older ones
  so the decision spine looks lived-in.
- `insights/` 3 to 4 seeded (Norrsken's autumn-round need, Tornby's Q4 expectation, one on inspection photos).
  None about Solbacken; Flow 3 creates that one.
- `todos/` 4 to 5, one overdue (Tornby), one waiting-on (Henrik).
- `meetings/` the Q2 Norrsken QBR (with Marcus's promise in the notes), last steering, two 1:1s.
- `tickets/jira/` mirror files for `WO-231` and its three stories, `TEN-118` and two stories, three `PLT` fillers.
  `wikipages/confluence/roadmap-h2.md` and `product-weekly-update.md`.
- `skills/` keep `arrival`, `commitment-check`, `process-note`, `weekly-update`, `spec`, `iterate`, `tell-qale`,
  house rules, the Jira and Confluence style guides, `broken-demo`. Drop `synthesis` from the demo path (it's the
  Tavla insight-stack story). Update house rules to name the `WO`/`TEN`/`PLT` projects and the `PROD` space.
- `voices/` exec, CS, and a new **sales** voice (short, date-first, no engineering caveats the customer can't act on).
- `agents/` keep librarian and meeting-prep as they are.

Connector seeds:

- `scripts/reset-atlassian.ts` `CAST`: projects `WO`, `TEN`, `PLT`; the epics and stories above with states,
  assignees, one Blocks link, seeded comments; Confluence pages "Roadmap H2" and "Product weekly update" with bodies
  read from `vault-dev/wikipages/confluence/`. Demo-created items (the new `WO` story from Flow 1, the two comments)
  must be absent from `CAST` so reset removes them.
- `scripts/seed-google-calendar.ts` `CAST_MEETINGS`: Steering (weekly, past and future), Norrsken QBR prep,
  1:1 Rebecca, Solbacken CS sync, Tornby call. Attendee emails match `people/*.email`.

`demo-samples/`:

- `steering-q4-priorities.vtt` (Flow 1). Teams-style, four speakers, must contain the supersede, the not-doing,
  three owned actions, one GDPR mention, and Marcus repeating the Norrsken promise.
- `support-thread-solbacken.md` (Flow 3). Slack export style, three messages, ends unresolved.
- `chat-prompts.md` with the Flow 2 and Flow 4 prompts and the follow-ups.
- `README.md` rewritten to map files to flows; remove the "Inbox" and "After-Meeting skill" references.

## 6. Decisions to make before writing the data

1. **Language.** The research is Swedish, the demo audience likely is. The vault search stemmer is English-only
   (`docs/mvp-strategy.md`), so a Swedish vault breaks Ask. Recommendation: English vault and transcripts, Swedish
   names and channel names, Swedish stakeholder quotes inside transcripts where it adds realism.
2. **WO-231 Done in Flow 4.** Live flip in Jira depends on the 5-minute sync tick. Recommendation: pre-stage the
   mirror as Done in a second vault snapshot, or accept a "sync now" click if one exists.
3. **Slack.** Nothing posts to Slack. Flows 2, 4 and 5 end in copy-out. Say so, or build a `#product` read-only
   import later as the "customer signals" door.
4. **Brevik as a name and property management as a domain.** Chosen because every Nordic PO understands
   tenants, inspections and work orders without explanation. Easy to swap; nothing in the flows depends on it.

## 7. Sharp edges that survive the rewrite

- API key required. A drop without it files the source and stops.
- Drops accept `.txt .md .vtt .srt` and a few more. PDF, DOCX and audio are refused.
- New pages and append-only updates apply silently by policy with an activity row. Cards are for derived changes,
  todos, deletes and outbound. Say "derived changes arrive as cards".
- Outbound cards are excluded from Approve all. Approve all is a serial loop; a partial failure leaves a mixed queue.
- No weekly commitment-check job exists. `commitment-check` is per todo.
- No demo mode, replay server or reset button. `docs/demo-mode.md` is undecided.
- The repo root holds live connector tokens in `.atlassian-demo.json` and `.google-demo.json`. Do not screen-share it.
