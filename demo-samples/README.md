# Qale demo

Before the demo: Settings, Demo, **Reset demo**, once. Close Settings. Reset puts these files in
`~/Desktop/Qale demo files/`.

Bord makes table-booking software for restaurants: a guest books on the restaurant's website or
through Google, and a text reminder goes out the day before. You are the product owner for the
Bookings and Guest teams, and no-show fees is the big thing in flight.

## Always first, in this order

### 1. The meeting produced actions

**"The meeting ended and nobody wrote anything down."**

1. Drag `brasserie-lund-review.vtt` from the Qale demo files folder into Home. It lands in the
   composer.
2. Type this and send:

   ```
   yesterday's Brasserie Lund review, nobody wrote anything down
   ```

3. Qale files the transcript on yesterday's calendar page, then asks two questions on one card.
   Pick **Yes, end of October** on The date, and **Yes, same bug** on Reminders.
4. These land on their own: the meeting write-up, an insight (no-show fees has a hard date, 1
   November), the Brasserie Lund page, Lena's page, and three todos (you send Lena the plan by
   next Friday, Marcus sends the renewal paperwork by Wednesday, you tell Lena the fix is out).
5. Three cards wait. Approve them one at a time: the comment on BOK-300 (target end of October),
   the comment on BOK-412 (Brasserie Lund saw the double reminder too), the Roadmap H2 patch (Q4
   becomes end of October).
6. Show: BOK-300 under Jira with the comment. Roadmap H2 with the new date.

### 2. Refine the epic

**"The date moved up and the epic still has no stories. Sprint planning is Wednesday."**

1. Type `/`, pick **Iterate on something**, type this and send:

   ```
   No-show fees moved up to end of October. Help me refine BOK-300 so Rebecca's team can start at sprint planning on Wednesday.
   ```

2. Round one, four chips: **Per sitting**, **Online only**, **A/B test**, **Anything else**. Pick
   **Cut it** on Per sitting, **Keep it** on Online only, **Keep it** on A/B test, skip Anything
   else.
3. Round two, three stories (card on file at booking, charge the fee after a no-show, fee notice
   wording test). **Keep it** on all three, skip Anything else.
4. Three ticket cards wait under BOK-300. Approve one. The todo from the 1:1 with Rebecca closes
   on its own.
5. Show: the new ticket under Jira, with the `no-show-fees` label, Brasserie Lund in the first
   line, and three checks.

## Then any of these, in any order, each once

### 3. Who should know

**"The fix shipped this morning and the people who have been waiting for it were never told."**

1. Type this in Home and send:

   ```
   The fix for BOK-412 went out this morning. Who should know?
   ```

2. The reply names three people: Ulrika (Sjögatan and Brasserie Lund), Petra (Pizzeria Napoli),
   Jonas (four open support tickets and a macro that still says "we are looking into it"). It
   names Kaffekopp as the account that left over exactly this.
3. Two panels to copy: **For Ulrika and Petra to forward** (tabs Short, With what to do) and
   **For Jonas** (tabs To close the four tickets, Macro replacement). Copy the Short tab. Nothing
   sends; the ledger lines on Sjögatan, Pizzeria Napoli, Ulrika, Petra and Jonas land on their
   own.
4. Same session, type this and send:

   ```
   From now on, when a fix ships, tell the CSMs before the changelog.
   ```

5. Show: the reply says "Added to your rules". Open House rules and show the new line.

### 4. Sales needs it to sign

**"Sales pings me for a yes because I am the only one who knows what is live and what was
decided."**

1. Paste this into Home and send. Pick no skill; Qale pulls in Handle a commitment itself. The
   text is `marcus-group-bookings.md` in the Qale demo files folder.

   ```
   Marcus Ek, #sales, 08:52. URGENT. Nordic Steak, 25 restaurants, are ready to sign this week. Their ops lead needs two things in the contract: group bookings with a set menu, and the Google "Book a table" button on every restaurant. Can I tell them both are coming this autumn? I NEED BOTH TO SIGN THEM.
   ```

2. The first turn says Qale is checking both things against the record. It takes a few seconds.
3. Question card, Q1 2027: the Google button has been live since May, group bookings waits on
   deposits. Pick **No, Q1 stands**.
4. One panel, **Reply to Marcus**, in the sales voice: tabs **One message to forward** and **What
   you can tell them**. Copy the first tab. An insight and the ledger lines on Nordic Steak and
   Marcus land on their own. No card waits.
5. Show: the closing line, "One yes and one no. The yes shipped on 2026-05-12 and sales was not
   told." Memory, Insights, the new note on the third ask.

### 5. The Friday update

**"The Friday update is a writing job nobody has time for."**

1. Type `/`, pick **Write the weekly update**, send with no text.
2. One panel for `#product-updates`, tabs **Full** and **Short**: shipped (table areas, the
   reminder fix), changed (no-show fees now end of October), watch (group bookings still waits on
   Payments). Copy the Full tab.
3. One card waits: this week's section on the public Changelog, table areas and one reminder for
   Google bookings, with no ticket keys, no customer names and no target dates. Approve it.
4. Show: open the Changelog mirror and scroll to the end. The new section is there, one heading
   level smaller than the older entries.

### 6. The brief for Thursday

**"I walk into steering not knowing what each person in the room has and has not heard."**

1. Open **Calendar**, click **Steering** on Thursday, press **Get the brief**.
2. The Prep section lands on the page, no card. It says: since last time (Åsa has not heard the October date, the
   BOK-300 stories are drafted), delivery (BOK-412 fixed, table areas shipped, PAY-210 still has
   no date), loose ends (Henrik owes a date), landmines (Marcus will push group bookings again,
   and sales has not been told the Google button is live).
3. Show: the Prep section on the meeting page, and the closing line: Åsa hears the October date
   from you, not from Marcus.

## If something looks off

- A card fails or the reply says it is outside the demo: Settings, Demo, Reset demo, then start
  again from scenario 1.
- Each of the six scenarios runs once per Reset. A second run of the same scenario gets the
  off-script line.
- Scenarios 1 and 2 must run first and in that order; 3 to 6 assume they did.
