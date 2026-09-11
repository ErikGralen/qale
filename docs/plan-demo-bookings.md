# A simpler demo: Bord, six scenarios

**Implemented 2026-09-10.** `docs/demo-runbook.md` says how to run it and `demo-samples/README.md`
is the presenter's card. The six scenarios shipped as `demo/scenarios/s1.json` to `s6.json`;
`pnpm demo:lint` is green at three offsets and four sequence orders. What shipped differently
from this plan:

- S2's first-round chips are **Per sitting**, **Online only**, **A/B test**, **Anything else**,
  not the longer names in section 4. The picks are the same: Cut it, Keep it, Keep it, skip.
- S4's `do` line names Marcus and Nordic Steak ("paste the message from
  `marcus-group-bookings.md` ... (Marcus, about Nordic Steak)"). The lint checks that a typed
  conversation's `do` line carries one of its `trigger.any` words, and a bare "paste the
  message" carried none.
- `draft_ticket` has no parent field, so the three S2 stories name the epic in the body ("Part
  of BOK-300 (no-show fees), first release") instead of being filed under it.
- The S5 Changelog section appends at the end of the page after approval, not on top, and the
  synced mirror shows it one heading level smaller than the older entries. The runbook says
  "open the Changelog mirror and scroll to the end".
- The S6 steering is Thursday 2026-07-23, and the calendar series starts there. The 2026-07-09
  steering is a vault page only, not an earlier occurrence in the calendar.

Plan, 2026-09-10. Replaces the Rota dataset and the five scenarios in
`docs/plan-demo-scenarios.md`. The machinery (`docs/demo-mode.md`: the replay server, the script
engine, the fakes, Reset, the lint) does not change. What changes is the company, the features,
the order the scenarios run in, and what the agent asks.

Write your call under **Decision**. Nothing gets built until the open decisions in section 7 are
filled in.

## 1. Why

Three things went wrong in front of audiences.

- **"Shift swaps" reads as a verb.** People hear "shift swaps ships first" as the agent moving
  something called swaps. Staff scheduling needs explaining, and every feature name in it (shift
  swaps, payroll export, offline mode) is one more thing to decode before the demo can start.
- **"Same commitment?" is a weak first question.** The first thing the agent asks in S1 is whether
  a todo is a duplicate. It shows the claim check, but nobody in the room cares. The first
  question should surface something the presenter did not see.
- **Five independent scenarios make a flat story.** Each one had to stand on the seed alone, so
  none could build on the one before. Erik's change of mind: the transcript drop is always first,
  a second scenario always follows it, and the rest are optional.

## 2. The rules that change

1. **A fixed opening, then any of the rest.** S1 (the drop) and S2 (refine the epic) always run,
   in that order. S3 to S6 are optional, independent of each other, in any order, each once. One
   Reset before the demo, none between.
2. **Text may assume S1 and S2 happened. Tool calls may not.** A script in S3 to S6 may say "the
   date you gave Lena yesterday" because S1 always ran. But every tool call in S2 to S6 touches only
   a seed file or appends, so each scenario still passes `pnpm demo:lint` alone at three offsets.
   The lint's sequence pass changes from four orders of five to: S1, S2, then four orders of
   subsets of S3 to S6, on one workspace.
3. **A feature name is a noun phrase that cannot be read as a verb or an instruction.** Test each
   one at the start of a sentence. "No-show fees ships first" reads one way. "Shift swaps ships
   first" reads two. "Book", "reserve", "table" and "seat" are all verbs; none of them opens a
   feature name.
4. **Every question the agent asks surfaces something.** A question is a date the presenter said
   that the record did not have, a complaint that matches an open ticket, a sales claim the record
   contradicts. A question about filing (duplicate or not, which folder) is not worth a card.

## 3. The company: Bord

**Bord** makes table-booking software for restaurants. A guest books a table on the restaurant's
website or through Google, the restaurant runs the evening from the booking list, and a text
reminder goes out the day before. Vocabulary: bookings, guests, tables, no-shows, reminders,
restaurants, chains. Nothing needs explaining.

About 250 people, Nordic, four dev teams. The PO ("me") owns two: **Bookings** (Jira `BOK`, the
restaurant side) and **Guest** (Jira `GST`, the booking page and the texts). **Payments** (Jira
`PAY`) is another team. Confluence space `PROD` holds "Roadmap H2" and "Changelog" (the public
one). Slack has `#product-updates` (internal stakeholders), `#sales`, `#support`. Slack stays
copy-out only.

### Features

| Feature | State in the seed | Role |
|---|---|---|
| **SMS reminders** | Live since 2025. One text, the day before at 17:00. | The bug in S1 and S3 is in this. |
| **Google bookings** | Live since 2026-05-12 (`GST-77`). A "Book a table" button on the restaurant's Google listing. | Sales does not know it shipped (S4). |
| **Table areas** | Shipped 2026-07-14 (`GST-140`). Guests pick window, terrace or bar when they book. | This week's ship for the update (S5). |
| **No-show fees** | Epic `BOK-300`, In Progress, no stories yet. A card on file at booking, charged if the guest does not turn up. Roadmap says Q4. | The date in S1, the epic in S2. |
| **Waitlist** | Epic `BOK-260`, In Progress, Q4 after no-show fees. | Texture. |
| **Group bookings** | Epic `BOK-520`, To Do, Q1 2027. Parties over eight with a set menu and a deposit. Waits on Payments' deposits work (`PAY-210`, planned Q4). | The sales escalation in S4. |
| **Gift cards** | Declined 2026-03-10, twice. | The won't-do on the roadmap page. |

### People

| Person | Role | Why they exist |
|---|---|---|
| Åsa Lindgren | CPO | Runs steering. Decided group bookings waits for deposits. |
| Rebecca Holm | Tech lead, Bookings | Wants `BOK-300` stories before sprint planning on 2026-07-22. |
| Henrik Dahl | Tech lead, Payments | Owns `PAY-210`, the thing group bookings waits on. |
| Marcus Ek | Head of Sales | Sends the urgent Slack message. Has pushed group bookings twice before. |
| Ulrika Nyström | Customer success, Brasserie Lund and Sjögatan | Her accounts hit the reminder bug. |
| Petra Alm | Customer success, Pizzeria Napoli and smaller accounts | Her account hit the reminder bug. |
| Jonas Berg | Support lead | Four open tickets on the double reminder, one macro saying "we are looking into it". |
| Lena Strand | Head of operations, Brasserie Lund | In the S1 meeting. Was told "Q4" in June. |
| Oskar Lind | Operations lead, Nordic Steak (prospect) | Wants group bookings in the contract. Named in S4 through Marcus. |

Malin Sjöberg (CS lead) is cut; two CSMs and a support lead carry the "who should know" beat.

### Customers

| Customer | Relationship | Role |
|---|---|---|
| Brasserie Lund | Active, 40 restaurants, largest account | Christmas bookings open 1 November; no-shows peak in December. Told "Q4" for no-show fees on 2026-06-02. |
| Sjögatan | Active, 6 restaurants in Gothenburg | Reported the double reminder through support in June. |
| Pizzeria Napoli | Active, 12 restaurants | Same. |
| Nordic Steak | Prospect, 25 restaurants | Close to signing. Wants group bookings and the Google button. |
| Kaffekopp | Churned | Churned after asking for something that had already shipped. The cautionary page. |

### The spine, in anchor dates (`ANCHOR = 2026-07-17`, a Friday)

- 2026-03-10: gift cards declined (decision).
- 2026-04-02: reminders are one SMS, the day before at 17:00 local (decision, texture for the bug).
- 2026-05-12: `GST-77` Google bookings shipped. Nobody told sales in writing.
- 2026-05-14: H2 order decided: no-show fees in Q4, waitlist after (decision, Åsa).
- 2026-06-02: Brasserie Lund review. Lena told "no-show fees in Q4, before Christmas". Ledger line.
- 2026-06-18: group bookings after deposits, Q1 2027 (decision, Åsa). `PAY-210` planned Q4.
- 2026-06-30: `PAY-190` store a card for a later charge, Done. `BOK-300` can start.
- 2026-07-03: `BOK-301` spike on card storage, Done. `BOK-300` has no stories.
- 2026-07-06: support sync. Jonas: four tickets, guests get the reminder twice. All four booked through Google.
- 2026-07-08: `BOK-412` "Reminder SMS sent twice for Google bookings" opened. Sjögatan and Pizzeria Napoli named.
- 2026-07-09: steering. Marcus asked to move group bookings up for Nordic Steak. Åsa: no, it waits on `PAY-210`, Q4. No decisions.
- 2026-07-13: 1:1 Rebecca. She wants the `BOK-300` stories before sprint planning on 2026-07-22.
- 2026-07-14: `GST-140` table areas shipped.
- 2026-07-16 (yesterday): Brasserie Lund quarterly review. **This is the transcript.** Nobody wrote anything down.
- 2026-07-17 (today), 09:10: `BOK-412` fix released. The mirror says Done, `remote_updated` today.
- Upcoming: 1:1 Rebecca 2026-07-20, Sjögatan check-in 2026-07-21, sprint planning 2026-07-22, **steering 2026-07-23** (S6; steering is a fortnightly Thursday series, so the 9 July one is the previous occurrence).

## 4. The six scenarios

Turns are counted as things the presenter does. "Lands" means the write happened and is listed
above the reply. "Waits" means a card. Dates are anchor dates; Reset slides them.

### S1. The meeting produced actions (always first)

**Value:** the meeting ends, and the agent catches the date you gave and the complaint you
missed, then updates Jira, Confluence and the record with your approval on every send.

**Do:** drag `brasserie-lund-review.vtt` from the demo files folder into Home. Type: "yesterday's
Brasserie Lund review, nobody wrote anything down". Send.

**The transcript** (new file, Teams style, about 15 minutes of talk, Lena Strand, Marcus Ek, PO):

- Lena: Christmas bookings open on 1 November, and December no-shows cost them a table a night
  per restaurant last year. She needs no-show fees live before the Christmas bookings open.
- PO: "we're aiming for end of October, so you have it before the first of November." Marcus:
  "I'll put that in the renewal." Nobody says Q4 any more.
- Lena, in passing: at two of their restaurants, Malmö and Lund, guests have been getting the
  reminder text twice. "Not a big thing, but people ask if something's wrong."
- Actions: PO sends Lena the October plan in writing by next Friday. Marcus sends the renewal
  paperwork by Wednesday. Lena will send the names of the two restaurants.

**One question card, two questions:**

1. **The date.** "You told Lena no-show fees land by the end of October. The last thing on record
   is 'Q4, before Christmas', from 2026-06-02 ([[customers/brasserie-lund]]). Is end of October
   the date now?" Options: **Yes, end of October** / **No, I was thinking out loud**.
2. **The reminders.** "Lena said guests at two restaurants got the reminder text twice. That is
   what `BOK-412` describes, reminders sent twice for Google bookings, and the fix went out this
   morning ([[tickets/jira/BOK-412]]). Is Brasserie Lund the same bug?" Options: **Yes, same bug**
   / **Not sure, keep it separate**.

Pick the first option on both. The next turn is written for those answers.

**Lands:** the meeting write-up; an insight "Brasserie Lund's Christmas bookings open 1 November,
so no-show fees has a hard date" on the customer page; the ledger line on Brasserie Lund (told end
of October, 2026-07-16) and `last_told` on Lena; todos: send Lena the plan in writing (me, due
2026-07-24), renewal paperwork (Marcus, due 2026-07-22), tell Lena the fix went out (me, due
today).

**Waits, three cards:** a comment on `BOK-300` ("Target: end of October, told Brasserie Lund on
2026-07-16; Christmas bookings open 1 November"), a comment on `BOK-412` ("Brasserie Lund saw
this at two restaurants; the fix went out this morning, Lena is being told"), a patch to Roadmap
H2 ("No-show fees: Q4" becomes "No-show fees: end of October"). Approve one at a time. Open
`BOK-300` under Jira and show the comment.

**Features:** F1 drop and file, F5 two questions that each surface something, F4 owned todos, F6
three outbound cards, the ledger. The supersede beat (F3) is cut: nothing in a customer meeting
is a decision Åsa made.

**Trigger:** `skill: arrival`.

### S2. Refine the epic (always second)

**Value:** the date moved up, so the epic needs stories now. The agent asks clear questions in
rounds, and the stories arrive as Jira cards in the team's shape.

**Do:** type `/`, pick **Iterate on something**, type: "No-show fees moved up to end of October.
Help me refine BOK-300 so Rebecca's team can start at sprint planning on Wednesday." Send.

**Round one.** Framing in three lines (deciding: what is in the first release of no-show fees;
out: a date, and anything Payments owns; done: three stories with three checks each). Then one
card:

- **Fee per sitting.** "In the notes from 2026-06-02, one idea was to let a restaurant set a
  different fee for lunch and dinner ([[meetings/2026-06-02-brasserie-lund-review]]). Is it in
  scope for October?" Keep it / Cut it. Pick **Cut it**.
- **Online bookings only.** "Charge the fee on online and Google bookings only. Bookings a
  member of staff takes by phone get no fee in the first release." Keep it / Cut it. Pick
  **Keep it**.
- **A/B test.** "Should we run an A/B test on the wording of the fee notice on the booking page,
  on a few restaurants, before every restaurant gets it?" Keep it / Cut it. Pick **Keep it**.
- **Anything else.** Skip.

**Round two.** "Fee per sitting cut, so one fee per restaurant. Three stories, three checks each.
Keep or cut."

- **Story 1.** Card on file at booking. (The guest enters a card on the booking page when the
  restaurant has fees on; the card is stored through `PAY-190`; the booking confirmation says a
  fee applies and how much.)
- **Story 2.** Charge the fee after a no-show. (The restaurant marks the booking as a no-show
  from the booking list; the charge goes through the next morning, not on the spot; the guest
  gets a receipt by text.)
- **Story 3.** Fee notice wording test. (Two wordings of the notice; a restaurant gets one or
  the other; the report shows completed bookings per wording.)
- **Anything else.** Skip.

Keep all three.

**Waits:** three ticket cards under `BOK-300`, label `no-show-fees`, "Brasserie Lund" in the
first line, three checkboxes each. Approve one. Open its mirror. **Lands:** the seed todo "Get
the BOK-300 stories written before sprint planning" flipped to done.

**Features:** F16 iterate, F6 ticket cards, F7 house style. The reads are all seed
(`research/no-show-fees`, the 2026-06-02 meeting, the 2026-07-13 1:1, `skills/jira`).

**Trigger:** `typed`, `skill: iterate`, `any: ["BOK-300", "no-show"]`.

### S3. Who should know (optional)

**Value:** a fix shipped this morning. The agent lists who has been waiting, from the record,
and drafts what each one gets.

**Do:** in Home, type: "The fix for BOK-412 went out this morning. Who should know?" Send.

**The reply, from the seed:** "Three accounts and one colleague.

- Ulrika Nyström, CS for Sjögatan and Brasserie Lund. Sjögatan reported it through support on
  2026-06-24 ([[customers/sjogatan]]). Brasserie Lund raised it in yesterday's review, and Lena is
  being told today.
- Petra Alm, CS for Pizzeria Napoli. They reported it on 2026-06-26 ([[customers/pizzeria-napoli]]).
- Jonas Berg, support. Four open tickets, and a macro that still says we are looking into it
  ([[people/jonas-berg]])."

Kaffekopp is cited as the lesson: they churned after asking for something that had already
shipped.

**Lands:** two `draft_text` panels to copy. One in the cs voice for Ulrika and Petra to forward
to their restaurants ("Since this morning, guests who book through Google get one reminder, the
day before at 17:00. Sorry for the noise."). One plain line for Jonas to close the four tickets
with. Ledger lines land on Sjögatan and Pizzeria Napoli and `last_told` on Ulrika, Petra and
Jonas.

The Brasserie Lund line in the text is true because S1 always ran. No tool call in S3 touches
what S1 wrote.

**Optional second turn:** type "From now on, when a fix ships, tell the CSMs before the
changelog." The reply says "Added to rules" and links the house rules. Keep it if the standing
instruction beat is wanted (F17); it costs nothing.

**Features:** F10 who needs to know, F8 live Jira read, F13 cs voice, F17 optional.

**Trigger:** `typed`, `skill: ask`, `any: ["BOK-412", "who should know", "who needs to know"]`.

### S4. Sales needs it to sign (optional)

**Value:** an urgent sales ask with two features in it. The agent checks both against the
record, asks you the one question that matters, and drafts the reply sales can forward.

**Do:** paste the message from the demo files (under 800 characters, under 10 lines) into Home
and send, no skill picked:

> Marcus Ek, #sales, 08:52. URGENT. Nordic Steak, 25 restaurants, are ready to sign this week.
> Their ops lead needs two things in the contract: group bookings with a set menu, and the Google
> "Book a table" button on every restaurant. Can I tell them both are coming this autumn? I NEED
> BOTH TO SIGN THEM.

**Turn one:** the script pulls in Handle a commitment with `use_skill`, reads the 2026-06-18
decision, the 2026-07-09 steering page and `GST-77`, and runs one `check_claims`. Then the
question card:

"Two things in Marcus's message. Google bookings has been live since 2026-05-12
([[tickets/jira/GST-77]]); that one is a yes. Group bookings is on Roadmap H2 for Q1 2027, two
quarters out, and steering on 2026-07-09 noted it waits on the deposits work Payments has
planned for Q4 ([[decisions/2026-06-18-group-bookings-after-deposits]],
[[meetings/2026-07-09-steering]]). Do you want to move group bookings up?" Options: **No, Q1
stands** / **Yes, I'll raise it at steering**. Pick **No**.

**Turn two:** a `draft_text` panel in the sales voice, two tabs. **One message to forward**: the
Google button is live today and how to switch it on; group bookings is Q1 2027 because it needs
the deposit piece Payments delivers in Q4; what Nordic Steak can put in the contract now (a
named date is not one of them). **What you can tell them**: three lines. An insight lands
("Group bookings asked for a third time through sales, for a contract line") and a ledger line on
Nordic Steak's prospect page and `last_told` on Marcus.

**Closing text:** "One yes and one no. The yes shipped in May and nobody told sales. The no was
decided on 2026-06-18 and nothing since has changed it. Nothing was sent."

**Features:** F12 inbound decode, F5 a question the record forced, F13 sales voice, the
contradiction with a live decision.

**Trigger:** `typed`, `skill: ask`, `any: ["group bookings", "Nordic Steak"]`. S3 and S4 are both
plain questions; the words tell them apart.

### S5. The Friday update (optional)

**Value:** the week's news written once, for the internal channel and the public changelog, from
what actually changed.

**Do:** type `/`, pick **Write the weekly update**, send with no text.

**Lands:** one `draft_text` panel, voice `internal`, for `#product-updates`, two tabs (Full and
Short). Full: shipped (table areas 2026-07-14, the reminder fix 2026-07-17), changed (no-show
fees now aimed at end of October, told Brasserie Lund 2026-07-16), watch (`BOK-300` stories go
to sprint planning 2026-07-22; group bookings still waits on `PAY-210`). Copy one.

**Waits:** one card, a new section on top of the **Changelog** page: table areas, and "guests who
book through Google now get one reminder". No dates that are targets, no ticket keys, no
customer names: it is public. Approve it. Open the Changelog mirror and show the section.

Three voices and the voice-learning beat (F14) are cut. `voices/` becomes `cs`, `sales`,
`internal`, each with one style, so the skill never draws the three-style panel. The
weekly-update skill's "Who it goes to" list becomes one entry (`internal`) plus the page.

**Features:** F15 weekly update, F6 a Confluence card, F13 one voice.

**Trigger:** `skill: weekly-update`.

### S6. The brief for Thursday (optional)

**Value:** before a meeting, one page says what changed since these people last heard from you,
and what they will bring up.

**Do:** open **Calendar**, click **Steering** on Thursday 2026-07-23, press **Get the brief**.
The Prep section lands on the page with no card (an append rewrites nothing of yours).

**The Prep section** (one `propose_update`, append, on the calendar mirror page):

- Since last time: no-show fees now has a date, end of October, told to Brasserie Lund on
  2026-07-16, and the stories are drafted for sprint planning on 2026-07-22. Åsa has not heard the
  October date.
- Delivery: `BOK-412` fixed 2026-07-17. `GST-140` shipped 2026-07-14. `PAY-210` still In Progress,
  Henrik has given no date.
- Loose ends: Henrik owes a `PAY-210` date (waiting-on todo from 2026-07-09).
- Landmines: Marcus will ask again to move group bookings up for Nordic Steak, as he did on
  2026-07-09; the answer is the 2026-06-18 decision. Google bookings has been live since May and
  sales has not been told in writing.

The first bullet is true because S1 and S2 always ran. Everything else is seed. Nothing in the
brief depends on S3 or S4, so it reads right whether or not they ran.

**Features:** F19 meeting prep.

**Trigger:** `skill: meeting-prep`.

### Coverage

| Feature | S1 | S2 | S3 | S4 | S5 | S6 |
|---|---|---|---|---|---|---|
| Transcript in (F1) | x | | | | | |
| Owned todos (F4) | x | | | | | |
| A question that surfaces something (F5) | date, bug | | | reprioritise | | |
| Jira/Confluence cards (F6, F7) | x | x | | | x | |
| Live Jira read (F8) | | | x | x | | |
| Who needs to know (F10) | | | x | | | |
| Inbound request (F12) | | | | x | | |
| Voices (F13) | | | cs | sales | internal | |
| Weekly update (F15) | | | | | x | |
| Iterate (F16) | | x | | | | |
| Standing instruction (F17) | | | optional | | | |
| Meeting prep (F19) | | | | | | x |

Cut on purpose: supersede (F3), voice learning (F14), the three-voice update. All three were
built to show breadth; each one cost a sentence of explanation in the room.

## 5. Independence check

S1 and S2 run first, so the check is: every scenario's tool calls succeed on the seed alone, and
S3 to S6 succeed in any order after S1 and S2 with no reset.

| Scenario | Seed files read | Files written | Tickets and pages read | Tickets and pages written |
|---|---|---|---|---|
| S1 | calendar page for 2026-07-16, `customers/brasserie-lund`, `people/lena-strand`, `people/marcus-ek`, `tickets/jira/BOK-412`, `tickets/jira/BOK-300`, `skills/jira`, `wikipages/confluence/roadmap-h2` | the meeting page (append), `customers/brasserie-lund` (patch and ledger), `people/lena-strand` (append), a new insight, three todos | `BOK-300`, `BOK-412`, Roadmap H2 | comments on `BOK-300` and `BOK-412`, Roadmap H2 patch |
| S2 | `research/no-show-fees`, `meetings/2026-06-02-brasserie-lund-review`, `meetings/2026-07-13-1-1-rebecca`, `tickets/jira/BOK-300`, `tickets/jira/PAY-190`, `skills/jira` | `todos/bok-300-stories-before-planning` (done) | `BOK-300`, `PAY-190` | three new stories under `BOK-300` |
| S3 | `tickets/jira/BOK-412`, `customers/sjogatan`, `customers/pizzeria-napoli`, `people/ulrika-nystrom`, `people/petra-alm`, `people/jonas-berg`, `customers/kaffekopp`, `voices/cs` | ledger lines on two customers (append), `last_told` on three people (append), optionally house rules | `BOK-412` | none |
| S4 | `decisions/2026-06-18-group-bookings-after-deposits`, `meetings/2026-07-09-steering`, `tickets/jira/GST-77`, `tickets/jira/BOK-520`, `tickets/jira/PAY-210`, `customers/nordic-steak`, `people/marcus-ek`, `voices/sales` | a new insight, `customers/nordic-steak` (append), `people/marcus-ek` (append) | `GST-77`, `BOK-520` | none |
| S5 | ticket mirrors, decisions, `wikipages/confluence/changelog`, `voices/internal`, `skills/confluence` | none | all mirrors, Changelog | Changelog, new section |
| S6 | `people/asa-lindgren`, `people/rebecca-holm`, `people/marcus-ek`, `meetings/2026-07-09-steering`, `todos/henrik-pay-210-date`, `tickets/jira/BOK-412`, `tickets/jira/PAY-210`, `customers/nordic-steak` | the steering calendar page (append) | `BOK-412`, `PAY-210`, `GST-77` | none |

Where two scenarios touch the same thing:

- `customers/brasserie-lund`: S1 patches it (a `search` on seed text) and appends. S3 only names
  it in text. No S3 tool touches it.
- `BOK-412`: S1 comments, S3 reads the mirror. A comment does not change the mirror's state, so
  S3's reply is the same with or without S1's card approved.
- `people/marcus-ek`: S1 writes a todo owned by him, S4 appends `last_told`, S6 reads. Appends
  only.
- Roadmap H2: S1 patches, S4 may read. S4's text quotes the decision, not the page, so the
  page's version does not matter.
- Every S6 write is an append on a calendar mirror the sync creates. S3 and S4 never touch it.

No scenario needs a file another scenario creates. S3 to S6 assume S1 and S2 in their text only.

## 6. What has to be written

Everything under `vault-dev/` except `skills/`, `agents/` and `sessions/` is new content. Dates
relative to 2026-07-17.

### vault-dev/

- `people/` 9 notes (section 3), each with `email`, `role`, `cares_about`, `last_told`.
- `customers/` 5 hubs. Brasserie Lund's ledger ends at 2026-06-02 with "Q4, before Christmas", so
  S1's question has something to contradict. Nordic Steak is `relationship: prospect`. Kaffekopp's
  churn story in prose.
- `research/` 4 pages: no-show-fees (committed; the 2026-06-02 "fee per sitting" idea sits in its
  open questions, so S2's first question has a source), waitlist, group-bookings, gift-cards
  (won't-do).
- `decisions/` the four in the spine, all `standing: active`, plus `index.md`.
- `insights/` 3: Brasserie Lund's December no-shows, Nordic Steak wants group bookings for the
  contract, guests ask if something is wrong when a text comes twice. None about the October date
  or the third sales ask; S1 and S4 create those.
- `meetings/` 2026-06-02 Brasserie Lund review (Lena told Q4; fee-per-sitting idea in the notes),
  2026-07-06 support sync, 2026-07-09 steering (group bookings waits on `PAY-210`; "No
  decisions"), 2026-07-13 1:1 Rebecca.
- `todos/` 4: get the `BOK-300` stories written before sprint planning (mine, due 2026-07-21; S2
  closes it), ask Henrik for a `PAY-210` date (waiting-on, from 2026-07-09), reply to Marcus about
  group bookings (texture), send Åsa the Q4 numbers (texture).
- `notes/` 2 documents for the rail: `christmas-season-playbook.md` and `fee-rules.md` (what a
  no-show fee may and may not do, the team's working notes).
- `tickets/jira/` mirrors: `BOK-300` (epic, no stories), `BOK-301` (spike, Done), `BOK-412` (bug,
  Done 2026-07-17, two comments), `BOK-260` and two children, `BOK-520` (To Do, Q1 2027),
  `GST-77` (Done 2026-05-12), `GST-140` (Done 2026-07-14), `GST-160` (filler), `PAY-190` (Done
  2026-06-30), `PAY-210` (In Progress, planned Q4). `BOK-520` has a Blocks link from `PAY-210`.
- `wikipages/confluence/` `roadmap-h2.md` (no-show fees Q4, waitlist Q4, group bookings Q1 2027
  after deposits, not doing gift cards) and `changelog.md` (public: three past entries, plain
  words, no keys).
- `voices/` `cs`, `sales`, `internal`, each with one style and a "How it sounds" section.
- `skills/house-rules/SKILL.md`: project keys `BOK`, `GST`, `PAY`, space `PROD`; "What you want
  from Qale" rewritten to the six beats. `skills/jira/SKILL.md`: labels `no-show-fees`,
  `waitlist`, `group-bookings`, `reminders`, the customer-in-first-line rule, the three-checkbox
  rule. `skills/weekly-update/SKILL.md`: "Who it goes to" is `internal` (for `#product-updates`)
  and the Changelog page; the CS rules move to the changelog section (public, no keys, no customer
  names, no target dates).
- `agents/meeting-prep/AGENT.md`: unchanged.

### scripts/

- `scripts/lib/atlassian-cast.ts`: the tickets above, the two pages, bodies read from
  `vault-dev/wikipages/confluence/`. Then `pnpm build-demo-fixture`.
- `scripts/lib/google-cast.ts`: past = vault, upcoming = calendar: Brasserie Lund review
  2026-07-16 10:00 (Lena, Marcus, PO), 1:1 Rebecca 2026-07-20, Sjögatan check-in 2026-07-21,
  Sprint planning 2026-07-22, Steering 2026-07-23 (fortnightly Thursdays, Åsa, Rebecca, Marcus,
  Henrik, PO). Then
  `pnpm build-demo-google-fixture`.

### demo-samples/

- `brasserie-lund-review.vtt`: new. Teams style, three speakers, about 15 minutes. Must contain
  Lena's 1 November line, the PO's "end of October", Marcus's "I'll put that in the renewal", the
  double-reminder mention with Malmö and Lund named, and the three actions.
- `marcus-group-bookings.md`: new, the message in S4.
- `README.md`: six cards. S1 and S2 first and in that order, then "any of these".

### demo/scenarios/

- `s1.json` to `s6.json`, drafted with `pnpm demo:draft` from one record-mode run each, then
  edited. S2 keeps `todos/...` done as its last landed write. S3's optional rule turn is a fifth
  and sixth turn the presenter may not reach; that is fine, a script that ends early ends on the
  closing text.
- `offScript` on all six: "That is outside what this demo can show. The six things it can do are
  listed in Settings, under Demo."

### apps/desktop

- `demo-service.ts` `DEFAULT_PINS`: `notes/christmas-season-playbook.md`, `notes/fee-rules.md`,
  `tickets/jira/BOK-300.md`, `tickets/jira/BOK-412.md`, `wikipages/confluence/roadmap-h2.md`,
  `wikipages/confluence/changelog.md`.
- `lint-scenarios.ts` sequence pass: S1, S2, then four orders of subsets of S3 to S6 (all four
  forwards, all four backwards, S4 and S3 only, S6 alone). Each scenario still runs alone at three
  offsets.
- `DemoSettings.tsx`: the rows read from the scenario files, so only the copy that says "five"
  changes. The first two rows get a line saying they run first, in order.

### docs/

- `docs/demo-runbook.md`: rewritten around the fixed opening.
- `docs/demo-brief.md`: the dataset paragraph and the "where things stand" section.
- `docs/demo-flows.md`, `docs/demo-scenarios.md`, `docs/plan-demo-scenarios.md`: one line at the
  top pointing here.

## 7. Open decisions

Each one changes what gets written, so fill it in before the vault is rewritten.

**D1. The company name.** "Bord" is the Swedish word for table, short, and not an English word.
Alternatives considered and rejected: anything with "book", "table", "seat" or "reserve" in it,
because every one of those is a verb.

**Decision:** as recommended (Erik, 2026-09-10).

**D2. S1's meeting is a customer review, not steering.** The two questions (a date you said, a
complaint you missed) come naturally from a customer in the room. The cost is that S1 no longer
shows a decision that supersedes an older one. The supersede beat could come back as a seventh
optional scenario later ("Åsa changed the order at steering").

**Decision:** as recommended (Erik, 2026-09-10).

**D3. Two questions on one card, or two cards.** One `ask_user` call with two questions is one
card and one click each. Two cards is two moments in the room but one more turn and one more
place for the presenter to pick the wrong option.

**Decision:** as recommended (Erik, 2026-09-10).

**D4. S3's optional standing-instruction turn.** Keep it or cut it.

**Decision:** as recommended (Erik, 2026-09-10).

**D5. The weekly update goes to one Slack channel and one public page.** Three voices, the exec
tabs and the voice-learning beat are all cut. If a customer asks "can it write for different
audiences", the answer is the `voices/` folder, opened live.

**Decision:** as recommended (Erik, 2026-09-10).

**D6. S6 briefs the steering, not a customer meeting.** Steering is where S1's date and S4's
push both land, so the brief has something to say whether or not S3 and S4 ran. A customer
meeting brief would be about one account only.

**Decision:** as recommended (Erik, 2026-09-10).

## 8. Risks

- **The October date is not a contradiction, only a firmer date.** Q4 contains October, so
  `check_claims` may return KNOWN, not CONFLICT, and a drafting run may not ask. The script asks
  anyway; the `ask_user` call is written in by hand if the draft lacks it.
- **S1's second question depends on the fix being out this morning.** The seed has `BOK-412`
  Done with `remote_updated` today. If the mirror's date slides wrong at an offset, the question
  text is off by a day. The lint's three offsets catch it.
- **S3 and S4 are both plain questions.** `trigger.any` tells them apart. The README puts the
  exact sentence and the exact paste in front of the presenter, and neither sentence contains the
  other's words.
- **S4 asks a second question about Nordic Steak's page.** The prospect page exists in the seed,
  so there is nothing to create and nothing to ask.
- **The transcript has to be written from nothing.** About 200 cues. It is the one file whose
  quality the whole demo rests on: if Lena's double-reminder line is not there, S1's second
  question has no source.
- **S2's first idea has to have a source.** The 2026-06-02 meeting notes carry the "fee per
  sitting" line, and `research/no-show-fees` lists it as an open question, so the card can cite it.
- **Sales-message paste under the source threshold.** The S4 message is about 330 characters and
  4 lines. Stays a message, not a source.

## Files to touch first

- `demo-samples/brasserie-lund-review.vtt` and `marcus-group-bookings.md`: the two inputs.
- `vault-dev/customers/brasserie-lund.md`, `tickets/jira/BOK-412.md`, `tickets/jira/BOK-300.md`,
  `meetings/2026-06-02-brasserie-lund-review.md`: the four files S1 reads and contradicts.
- `scripts/lib/atlassian-cast.ts` and `google-cast.ts`, then both fixtures.
- `apps/desktop/src/main/demo/demo-service.ts` `DEFAULT_PINS`.
- `apps/desktop/scripts/lint-scenarios.ts`, the sequence pass.
