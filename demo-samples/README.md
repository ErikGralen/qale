# Qale demo files

Two files to bring in, and a walkthrough in five steps. Everything here is a drop, a paste, a
click or one sentence; nothing else needs typing.

| File                          | What you do with it            | Step |
| ----------------------------- | ------------------------------ | ---- |
| `steering-h2-priorities.vtt`  | Drag it onto the Qale window   | 1    |
| `support-thread-brunos.md`    | Copy the text, paste into Home | 3    |

Use the copies in this folder. They are dated so that the steering meeting was yesterday.

## The story

Rota makes staff-scheduling software for restaurant and retail chains. You are the PO for the
Scheduling and Staff App teams. Two things are in flight: shift swaps (staff trade shifts in the
app, a manager approves) and payroll export. Sales promised Café Nord swaps before the September
staff turnover. Fjord Sports was told payroll export lands in Q4. A Bruno's Burgers manager asked
support for swaps back in March, and nobody ever answered her.

## 1. The meeting produced actions

Drag `steering-h2-priorities.vtt` onto the window. Yesterday's steering call: Åsa moved shift
swaps ahead of payroll export, payroll export slides to Q1, offline mode was declined again.
Nobody wrote anything down.

Wait for the cards. Expect a meeting page, a decision that supersedes the old H2 order, todos
with owners (Rebecca re-estimates SCH-240, Henrik reviews swap notifications, you tell Fjord
Sports), and three outbound cards: a comment on SCH-118, a new story, a patch to the Roadmap H2
page. Press **Approve all**, then approve the outbound cards one at a time. Open the SCH-118
ticket to show the comment landed.

While you approve, Rebecca closes the shift-swaps epic in Jira. SCH-231 reads Done on the next
sync. Say so.

## 2. Marcus's fourth ping

Open Todos. "Reply to Marcus about the swap ETA" is due today; his three pings are in it. Click
**Help me handle this**. The reply comes in the sales voice from the record: the epic closed
this morning, the decision from step 1, what Marcus promised at the QBR. Copy it. Approve the
card that logs what he was told.

## 3. The support thread

Open `support-thread-brunos.md`, copy the whole text, paste it into Home's bar. A `#support`
thread from March: Petra at Bruno's asks whether staff will ever be able to swap shifts
themselves; Jonas says he will ask product; it ends there.

Expect an insight on shift swaps with Bruno's as the customer, an update to the Bruno's page, and
a todo to tell Bruno's. Check the insight card has the tag `shift-swaps`. Approve all. Do not
click "Help me handle this" on the new todo.

## 4. Who needs to know

In Home, ask exactly:

    SCH-231 is done. Who needs to know, and what do I tell them?

Expect each person with what they were told and when: Café Nord (promised at the QBR), Bruno's
(asked in March, never answered), Fjord Sports (told Q4, now Q1), and Jonas for a support macro.
Messages come in the CS voice for customers. Approve the cards that log what they were told. If
it asks a question first, pick the first option.

## 5. Friday update

Type `/` in Home and pick **Write the weekly update**. Drafts arrive for Åsa (exec voice),
customers (CS voice) and sales, built from what was approved in steps 1 to 4. Approve them.

## If something looks off

- A card asks what date the meeting was: you dragged a file from somewhere else. Use this folder.
- Approving a Jira or Confluence card fails: Settings → Demo → Reset demo, then start over.
- Ask answers "I'm the demo build": the sentence was not typed exactly as above.
