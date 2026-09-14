# Learning how the PM works

Product design, 2026-09-06, rewritten 2026-09-07. The pain points come from `docs/demo-flows.md`
on the `demo` branch.

## Built 2026-09-07

All 17 tickets are built, by subagents, in the order decision 9 asked for. 1495 tests pass, the
type check and lint are clean. Nothing is committed and nothing is live-verified: no model run,
no Atlassian, no screenshot. The decisions below were taken as the doc proposed them, so Erik
can reverse any of them:

1. Style files and voices are saved without a card (`isStyleFile` in policy.ts, listed in
   Settings under "Lands, listed in Activity").
2. All six list lines ship on, with the wording above. Ids: `write-into-tools`,
   `delivery-from-record`, `who-is-waiting`, `priority-changed`, `one-news-many-words`,
   `promises` (`WANT_LIST_LINES` in defaults.ts).
3. Exec's three styles are the doc's. CS has its own three: "Three dated lines", "A short
   note", "Use now, coming next".
4. Two copies of the same style from two different panels with no answer count as the pick.
   The panel remembers the first copy in localStorage, per workspace and voice.
5. The Skills page shows only the "last learned" line per row.
6. The shelf is `about/`, shown as "About", type `about`, first in Memory. It may grow.

Where things landed that the tickets did not spell out:

- `learned` is a sixth Activity action (activity.ts). `remembered` stays for a rule the PM
  said in chat. `learnedRow()` builds a row for a caller that knows the source.
- `propose_instruction` takes `list: "add" | "remove"`. A remove is always a card.
- `propose_update` takes `learned: { what, from }`, honoured only on a style file.
- `draft_text` takes `ask: { text, options }` (up to three). The draft tools carry no
  question (ticket 6 was removed on 2026-09-08, see below).
- The edited payload is stored beside the original (`edited_payload_json`). The card list
  the model reads says what the PM changed.
- Telemetry: `want_list.changed` (line id or `custom`, added or removed, asked) fires from the
  card path and from a silent chat write through a new `agent.onProposalApplied` hook;
  `style.picked` (voice, style, answer words) fires from the panel.
- The first-look kickoff passes the PM's identity so the JQL reads their own tickets.

Not done: the "When you comment" section of the Jira file stays a placeholder, because the
fetch tool returns no comments. `docs/conventions.md` still uses the old file titles in its
history text.

## What Qale needs to learn

Qale should be useful in the first week. For that it needs to learn four things about the PM:

1. **How they write Jira tickets.** Which issue type for what, which labels and what each
   means, how a title reads, how the description is laid out. Qale learns this by reading
   their recent tickets and writes it down in a file.
2. **How they write Confluence pages.** Same method, same kind of file.
3. **How they write updates.** Qale writes the first update in three styles. The PM copies
   one. Qale keeps that style.
4. **What they want from Qale.** A short list that is on from the start. Every agent reads
   it. It grows when Qale sees the PM ask for the same thing again and again.

Everything else Qale learns from transcripts and tickets as they arrive, as it does today.
When the PM corrects something, the correction becomes a rule.

## The main rule: never ask the PM for an example

Asking "paste an update you have sent" feels like a failure. Qale is supposed to know how the
PM works, and instead it asks the PM to do the work. So:

- If there is material to read, Qale reads it. Thirty tickets say more than any question.
- If there is nothing to read, Qale does the work three ways and the PM picks one. The first
  weekly update comes in three styles. The one the PM copies is the one Qale keeps.
- The PM can always go first. Every file Qale writes preferences into is open and editable
  from day one. If the PM pastes an example in chat, Qale uses it. Qale just never asks for it.
- Qale asks a question only as a last resort, and always through `ask_user` before it writes.
  One sentence with two or three options, and only something the material could not answer.
  Never a form. Never on a schedule. A proposal card never carries a question of its own.

After the PM has picked a style, Qale shows one style. If the PM corrects it in chat, the
correction goes into the file. If the PM asks for "another way", the three styles come back.

## Three kinds of file

Qale keeps what it learns in three kinds of file. It is important to keep them apart:

- **A skill says how to do a piece of work.** For example, how to write a ticket.
- **An about page says what is true about the PM and the company.** For example, what the
  product is, or which team owns what. This is a fact, not a way of working, so it is not a
  skill. About pages live in Memory.
- **A voice says how a draft should sound** for one audience. It is a small skill.

## What ships

| File | Kind | How it ships | How it learns |
|---|---|---|---|
| arrival, process-note, synthesis, commitment-check, spec, iterate | skill | finished | rules added from corrections |
| librarian, meeting-prep | agent | finished | rules added from corrections |
| weekly-update | skill | finished | through the voices it writes in |
| house-rules | skill, read in every session | finished, with the "What you want from Qale" list on | chat requests, repeated questions, removals |
| tell-qale | skill | finished | does not learn. It writes the about pages. |
| writing-skills | skill | finished | only the PM edits it |
| exec, cs | voice | three styles, no pick yet | the first pick, then corrections |
| jira, confluence | skill | not shipped. The first read creates it. | thirty tickets, one question, edits before approving |
| about/product, technical, organization | about page | not shipped. The interview creates them. | the interview, corrections about facts |

Two rules for what ships:

- A file with nothing useful in it does not ship. A Jira file with no tickets read would be
  empty, so the first read creates it instead.
- A file that can offer choices ships with the choices in it. The exec voice ships with three
  styles and a first line that says "no pick yet".

### The about pages get their own shelf in Memory

Today the `research/` shelf holds two different things: the three pages about the company
(product, technical, organization) and the pages Qale wrote itself (the case for a theme, a
competitor scan). These should be separate. The company pages move to a new shelf, `about/`,
shown as "About" in Memory. The shelf can grow later with a teams page, a customers overview,
or a page about how the product is built.

Skills read about pages. They never copy facts into themselves. When the PM corrects a fact
("the pilot starts in October"), Qale updates an about page or a note, not a skill.

This reverses part of the change from 2026-09-06 that moved the company pages into `research/`.

### One skill about writing skills

Today the rules for writing a skill live inside two tool descriptions, where the PM cannot
read or change them. These rules say what goes where: a fact goes to a note, a way of working
goes to the skill that owns it, a matter of taste goes to a voice, and a one-off goes nowhere.

These rules move into one shipped skill, `skills/writing-skills/SKILL.md`, shown as "How Qale
writes skills". It also holds:

- the section layout of a skill (When, Read, Produce, Then)
- the first line of a file: "no pick yet" or "learned from X on date", and how to update it
- one line per thing learned, with its source and date
- when to delete styles that were not picked
- the size cap
- the rule that a one-off correction never becomes a rule

Qale reads this skill before every write to a skill or a voice: after a correction, after the
first read, after a style pick, and inside propose_skill and propose_instruction. The PM can
edit it. For example, they can add "always ask before you write a rule".

Claude Code does the same thing: it ships a skill about how to write skills.

## The pain points, in order

From the research and the demo. The "What you want from Qale" list is built from these.

1. Meetings end and nothing gets written into Jira or Confluence.
2. "When can we deliver this?" asked in four chats, answered from memory.
3. A customer asked for something, it shipped, and nobody told them.
4. A priority changed in a leadership room and the team never heard.
5. The same news rewritten for exec, CS and sales.
6. A promise made in a meeting, forgotten until it is late.

Under all of them: nothing is sent or saved without a yes, and sources are always visible.

## What the PM experiences

### The first ten minutes

On the connections screen the PM connects Jira and ticks SCH, APP and PLT. The card says
"Reading these now. When it has something to say, it knocks on Home."

Home opens with First steps. Nothing is asked. In the background Qale reads the PM's own
thirty most recent tickets in the three projects, and their recent pages in PROD.

A few minutes later a row appears at the top of Home: "Qale read SCH, APP and PLT." The PM
opens it. Qale says what it found, with a ticket cited on each line, and that it wrote a file:

> I read your last thirty tickets in SCH, APP and PLT and wrote down how you write them.
> Stories start with one sentence about what a manager or a staff member cannot do today,
> then acceptance criteria as a checklist. Bugs get steps and the app version. Everything in
> SCH carries a label for the area it touches. This is a guess from your tickets, not a rule
> you gave me. Change any line and I draft the new way from the next ticket on.

The file is `skills/jira/SKILL.md`, called "How you write tickets" on screen. It is saved
without an approval card, with a link and an Activity row. It is Qale's own notes about the
PM's style, not a change to anything the PM wrote.

Then Qale asks its one question about Jira:

> Nine of your SCH stories carry the label `needs-legal` and the rest do not. I can see when
> you add it, but not why. What does it tell you?

Three options and a free text box: "Legal has to look at it before it ships" / "It touches
staff personal data" / "Stop using it". The answer becomes one line in the file. The question
waits if the PM closes the app.

This is the only place where Qale says "here is what I will do from now on". It can say it
here because every sentence is backed by a ticket it read. The "Here's what I plan to do"
card on Home says the same thing before Qale has read anything, so that card goes (ticket 11).

### The first draft

The PM drops the steering transcript. Cards arrive: the meeting page, the decision that
replaces the H2 order, three todos, then the outbound cards.

The Jira card is "File a story in SCH: Swap request notifications". The fields follow the
PM's own stories: one sentence about what a manager cannot do today, acceptance criteria as a
checklist, the label `scheduling`, parent SCH-231, assignee empty because their stories stay
unassigned until estimation. One line says why:

> Labelled `scheduling` because your SCH stories carry it. Parent SCH-231 because Åsa named
> the swaps epic.

One thing Qale could not work out is asked on the same card, above the button:

> Henrik has to review this for GDPR. Your other SCH stories mark that with `needs-legal`.
> Add it? Yes / No

If the PM approves without answering, the label stays off.

The PM edits the summary before approving, to "Notify staff when a swap is requested". The
edited text is what goes to Jira. Under the card, one line:

> You started the summary with a verb. Write summaries that way from now on? Yes, remember /
> Just this one

Yes adds one line to the file. The next draft is already written that way.

### The first update: three styles

Friday, the weekly update runs. There is nothing to read for this one. The PM's earlier
updates went out by mail and chat, where Qale cannot see them. So Qale does not ask for one.
It writes the exec update three ways, in one panel with three tabs:

- **Three lines.** Decided, shipped, watch. One line each, with a number on every line.
- **One paragraph.** The result in the first sentence, then the reason. No labels.
- **What changed, what's next.** Two short lists.

The same news in all three. The PM reads, picks a tab and clicks Copy. Under the panel, one
question appears:

> Write updates this way from now on? For exec / For every audience / Not now

"For exec" writes the style into the exec voice. "For every audience" writes it into every
voice. "Not now" changes nothing, and the three styles come back next Friday. If the PM
copies the same style twice without answering, Qale treats that as the pick, says so in one
line, and links the file so the PM can change it.

From then on the update has one style, with Full and Short as its two tabs, as the skill
works today.

The three styles are in the voice files, under a first line that says no style is picked
yet. A PM who already knows what they want can open the exec voice on the Skills page, delete
two styles and keep one, or write their own. The first update then comes in that style only.

**A correction that sticks.** The PM reads the exec draft and types "drop the part about how
we got there". A new panel appears, and under it: "Leave that out of exec updates from now
on? Yes, remember / Just this one". Yes adds one line to the exec voice. This is how
corrections already work today. A correction about taste goes into the voice file. A
correction about how the work is done goes into the skill.

### The "What you want from Qale" list

The list is on from the start. It is six lines, one per pain point, in a section of house
rules. House rules is the one file every session reads, so the list needs no file of its own:

> What you want from Qale. Qale reads this before every job and adds to it as it learns what
> you ask for. Edit it any time. Keep it to about ten lines.
>
> - When a meeting ends, write the actions into Jira and Confluence for me.
> - Answer "when can we deliver this?" from the record, not from my memory.
> - Tell me who is waiting for something before it ships, and what they were told.
> - When a priority changes in a room I was in, change the record so the team reads it.
> - Write the week's news once and give it to me in the words each group needs.
> - Keep track of what I promised and tell me before the date, not after.

No screen asks the PM to tick anything. The PM sees the list on the cards that come from it.
When a card exists because of a line, the card's "why" names the line: "Because you want to
know who is waiting before it ships." If the PM does not want that, they say so: "stop
proposing customer updates". A card removes the line. The next transcript is filed without
it.

The list grows in two ways:

- In chat. "I keep getting asked what changed in the API, I want that written down somewhere"
  becomes a card that adds a line.
- From repeated questions. When the PM asks "who needs to know about this" for the third time
  and no line covers it, the session proposes a line and cites the three questions.

Removing a line is always a card, or the PM editing the file.

Every add and remove sends a telemetry event. This is how Qale, the company, learns what PMs
want. The event carries the id of the shipped line, or "custom" for a line the PM wrote. It
never carries the PM's own words.

What each agent does with the list:

- **Arrival** (filing a transcript). With "who is waiting for something" on, it checks
  customer and people pages for anyone whose last update touches what the meeting changed,
  and proposes the updates and a todo naming who to tell. With it off, it files the meeting,
  the decisions and the todos, and proposes none of that.
- **Librarian.** Tidies in the list's order. With the who-is-waiting line on, it fixes links
  between tickets and customer pages before it fixes a broken link in an old research page.
- **Weekly update.** With the audiences line on, one draft per voice. Off, one draft.
- **Ask.** With the "when can we deliver" line on, every delivery answer ends with the date
  that was given, who gave it, and a plain line when Jira holds no date.
- **Summary pass.** A note that relates to a line on the list gets a tag for it.

### Where the PM sees what Qale has learned

There is no "what Qale knows about you" page. The files are the record. Claude Code works the
same way: the instructions file and the memory folder are what Claude reads, and they are
also what the person reads and edits.

The PM sees what Qale learned in two places:

**In the moment.** One line, with a link to the file, right after the file is written:

> Got it. Exec updates: one paragraph, result first. [Exec voice]

This line never appears before the write. The same line is saved as an Activity row of kind
"learned", next to the "labelled" rows the summary pass writes today.

**In the file.** Every file Qale learns into starts with a line that says what it knows and
where it came from. The exec voice ships with:

> I do not know how you want exec updates to read yet. Until you pick, the first update comes
> in these three styles: ...

After the pick it reads:

> Exec updates are one paragraph, result first. Learned from the style you copied on
> 5 September. Change this line and the next update follows it.

The Jira file starts the same way: "Read from your last thirty tickets in SCH, APP and PLT on
2 September. A guess from your tickets, not a rule you gave me."

A small preference ("sign off with Kind regards") is one bullet in a voice, or in house rules
if it holds for every voice. A big one (the ticket template) is a whole file. Same mechanism,
different size.

On the Skills page, each row shows the last thing learned and when. That is all.

There is no session that says "here is what I will do going forward". That would be the pitch
card again. The first-read debrief already does that job, with evidence.

### Week one

**Tuesday.** A ticket needs a comment about the deferral. The draft cites the decision and
ends with what Qale needs back from Rebecca. "Your comments on SCH end with what you need
back, so this one does."

**Wednesday.** The Roadmap H2 page needs two priorities swapped. The card shows two changed
lines, not a rewritten page. "Your PROD pages add under the headings that are there, so this
only touches two lines."

**Friday.** The three-style update, as above. The PM copies "One paragraph" and answers "For
exec". Next Friday's exec draft is one paragraph.

### What the PM never sees

No request to paste anything. No score, no counter, no statistics in Memory. No question that
comes because a week has passed. No form, no profile page, no second place to keep up to
date. No question that Jira could have answered.

### What could feel wrong, and what Qale says

- **Only four tickets to read.** The file's first line says: "Only four recent tickets were
  written here, so this is thin. I kept it short and I will ask when a draft needs more."
- **A label the PM does not want.** They answer "Stop using it", or say no on a draft. Qale
  writes one line, "Do not add `needs-legal` to drafts", and never asks again.
- **The PM does not write the tickets, Rebecca does.** The file says whose tickets it read:
  "Almost none of these were written by you, so this is how your team writes them." The
  question becomes: "Draft the way Rebecca writes, or the way you would?"
- **None of the three styles is right.** The PM says what they want in chat. A new panel
  comes with that as the brief. The correction goes into the voice like any other.
- **A line on the list they never wanted.** One sentence removes it. The removal is a card,
  so they see what changed.

## Tickets

Checked against the code on `main`. Sizes are guesses.

1. **Fetch the Jira fields the model cannot see.** Sync asks Jira for seven fields today.
   Labels, issue type, priority, components and reporter never reach the mirror, and the read
   tools print only key, status, assignee and description. Add the five fields to the client,
   the connector, the ticket frontmatter, the mirror and both read tools. One day.
2. **Let a drafted ticket carry labels, priority and components.** The draft tool and the
   create call send project, type, summary and description only. Add the three optional
   fields end to end and show them on the card. Without this the file can describe a label
   and the draft still cannot set it. One day.
3. **Read the PM's own last thirty tickets and write a real template.** The first read today
   reads about ten tickets per project by anyone, and the shipped file is headings with
   placeholder lines. Change the read to "assignee or reporter is me, newest first", thirty
   tickets, ten opened in full. Change the file to a ticket template: fields to fill, labels
   and what each means, one worked example copied from a real ticket. The file starts with
   what it was read from, when, and that it is a guess. Same for Confluence from the PM's
   own pages. One day, mostly copy. Depends on 1.
4. **One question per system, only what the tickets could not answer.** The read-up says
   "never ask about conventions" today. Change it to: at most one question per system, only
   about something seen and not explained, with the count in the question, and the answer
   goes into the file. Copy only. Half a day. Depends on 3.
5. **Files Qale learns into are saved without a card, with a link.** A rule file Qale writes
   comes as a card today. Add one policy row: a style file written from a first read, and a
   voice file changed by a pick, are saved directly and listed in Settings and Activity. The
   debrief opens with the link. Half a day. Depends on 3.
6. **Draft the safe way and put the question on the card.** REMOVED 2026-09-08. It was built
   on 2026-09-07 and the first live use showed why it is wrong: the model used the card
   question to ask about a factual conflict ("this entry says payroll export first, which Åsa
   reversed, correct it too?") instead of about a label. That put a second question channel
   on the approve button, with a "leave it" that reads as a shrug. Erik's rule: a draft
   carries no question. If what the model read disagrees with a decision, the decision wins.
   If two sources disagree and no decision settles it, the model calls `ask_user` before it
   drafts. The payload field, the tool parameter and the card block are gone.
7. **Keep the edit the PM makes before approving, and show it to the model.** The card sends
   the edited text upstream, but only the original is stored and telemetry keeps a boolean.
   Store the edited payload beside the original. Each turn, the card list shows one line per
   changed card with before and after. Add to the preamble: a change that would repeat is a
   rule for the Jira or Confluence file, a typo is nothing. One to two days.
8. **"What you want from Qale" as a section of house rules, on from the start.** Add the
   section with the six lines to the shipped house rules. Teach `propose_instruction` to add
   and remove a line there. The arrival skill, the librarian and the summary pass each get
   one paragraph on how to read it. Half a day, copy.
9. **Cards name the line they come from.** The "why" on a card that exists because of a line
   on the list names that line. Add to the preamble that "stop doing X" about a line means
   remove that line from the list. Copy only. Half a day. Depends on 8.
10. **Three styles the first time, and the pick updates the voice.** Three parts.
    - The two voice files ship with a first line that says no style is picked yet, then
      three named styles. The weekly update skill gets a "the first time" section: while a
      voice still lists three styles, draw one panel with one tab per style, Full only. Copy.
    - `draft_text` gets an optional `ask`: one sentence and up to three options. The panel
      shows it under the footer after Copy or Use this is clicked. Clicking an option sends
      a user turn that names the copied tab and the answer, the same way Use this sends one
      today. Copy alone still sends nothing, so an ordinary panel is unchanged.
    - On the answer, the skill rewrites the voice: the first line now says what was picked,
      when and from what. The picked style stays and the other two are deleted. "For every
      audience" does this for every voice. The file is saved under ticket 5's policy row. The
      reply is the one-line receipt with the link. Two days. Depends on 5.
11. **Delete the pitch card.** The "Here's what I plan to do" card on Home competes with First
    steps for one slot, and dismissing it retires First steps. The debrief from ticket 5 does
    the same job from real tickets. Half a day. Depends on 5.
12. **The "learned" Activity row and the one-line receipt.** Every write into a style file, a
    voice, the Jira or Confluence file or the list writes an Activity row of kind "learned",
    with the line and what it came from. The preamble says the reply after such a write is
    one sentence with the file linked, and never before the write. Half a day.
13. **The Skills page shows what was learned last.** Each row on the Skills page gets one
    line: the last thing learned and when, from the "learned" rows. Half a day. Depends on 12.
14. **Grow the list from repeated questions.** The base chat preamble gets one paragraph: when
    the PM's question is the third of its kind and no line on the list covers it, propose the
    line and cite the three questions. The count comes from the session index, not from a
    counter. Half a day. Depends on 8.
15. **Telemetry for what PMs want.** Two events: a list line added or removed (shipped line id
    or "custom", never the text), and a style picked (voice, style name, and the answer).
    Half a day. Depends on 8 and 10.
16. **The `about/` shelf.** Move the three company pages the interview writes from
    `research/` to `about/`, with an index, a Memory shelf called "About", and `type: about`.
    Update tell-qale, the house-rules research entry and every skill that reads the three
    pages. Migrate on open with one commit and an Activity row, the way the research fold did.
    One day.
17. **The writing-skills skill.** Ship `skills/writing-skills/SKILL.md` with the what-goes-
    where rules, the section layout, the first-line convention and how to update it, one line
    per thing learned with source and date, and the size cap. Move that text out of the
    propose_skill and propose_instruction descriptions, which then point at the file. Tell the
    correction router, the first read and the pick to read it before writing. One day, mostly
    copy.

About thirteen days. Nine of seventeen are mostly copy.

## Not in this

- Counting anything on a schedule. Status timing, label frequencies, dwell times.
- A question agent, thresholds, or a file that grows without limit.
- An opening screen for the list. It is on from the start.
- A "what Qale knows about you" page, in Settings or anywhere. The files are the record.
- A separate file for the list. It is a section of house rules.
- Sprint, story points, custom fields.
- Learning from Confluence comments or Slack.
- The seed card and the weekly drift check stay as they are.

## What needs a decision

1. Files Qale learns into are saved without a card (ticket 5), or stay a card as today.
2. All six list lines on from the start, or the top three, with the rest proposed when the
   PM asks for them.
3. The wording of the six lines, above.
4. The three styles per voice, above, and whether CS gets its own three or the same three.
5. Two copies of the same style with no answer count as the pick, or the three styles keep
   coming until the PM answers.
6. The "last learned" line on the Skills page (ticket 13) is enough, or the Skills page also
   needs a short summary at the top across all the files.
7. The shelf name: `about/`, shown as "About", or another plain word.
8. Whether the three company pages stay "three and no more" after they move, or the shelf may
   grow (teams, customers overview, how the product is built).
9. Order: 17 first (the writing-skills skill, so every later write reads it), then 1 to 5 (the
   Jira file), then 8, 9, 14 (the list), then 16, 10, 12, 13, then 6, 7, 11, 15.
