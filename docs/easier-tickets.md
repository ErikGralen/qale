# Easier Qale: tickets

Split out of the 2026-09-02 direction note, "Making Qale easier". The one sentence behind all of
it: Qale asks the user to run a library in exchange for a memory, and the user wanted an AI with
better context.

The facts quoted here come from that note's three code passes over commit `4f12a71`. Nothing in
this file was re-verified against the code today.

Write your call under **Decision** ("build", "skip", "discuss…"). **Notes** is for anything the
build needs to know. Nothing gets built until its Decision field is filled in.

Order: section A is a prerequisite for section B. C, D and E are independent of each other.

---

## A. Before anything can be silent

### E-1. Git starts with the workspace

**What:** Git is opt-in today. One button inside a note's History panel turns it on, and nothing
calls it when a workspace is created. So a normal workspace has no history at all.

**Change:** Init the repo at workspace creation and commit on every write. Every "we can apply
this silently, it is reversible" argument in section B is false until this lands.

**Decision:**
Yes, and also prompt the user to install git if it isnt. or is there a way to package git in the install? 
**Notes:**

---

### E-2. Undo for an applied write

**What:** There is no undo for an applied proposal and no undelete in the app.

**Change:** One revert path, reachable from Activity (E-9), that puts a note back the way it was.
Needs E-1.

**Decision:**
yes
**Notes:**

---

## B. Fewer judgements

### E-3. A write policy, not a switch on kind

**What:** There is no policy layer. Accepting a proposal is a flat switch on kind, called only
from a human click. A proposal already carries the kind, the proposing skill, the target path,
the note type, and whether the user asked for it or the agent inferred it. The rules below are
expressible without changing the data.

**Change:** One place that grades a write by the damage it can do and returns silent, grouped, or
always-ask.

| Situation | What happens |
|---|---|
| The user asked for it in chat | Applied, no card |
| Material arrived: a new note, or an append | Applied, no card |
| Material arrived: a patch over existing text, or a decision | One grouped card per intent |
| A todo is created, or its status changes | Always asks |
| Anything outbound: Jira, Confluence, a calendar invite | Always asks, one card per send |
| A delete | Always asks |
| The user stated a standing rule | Remembered, no card, shown in Activity |

Todos always ask because a promise is the user's word. Outbound and delete always ask because the
code has no compensating action for either.

**Decision:**
yes, 
**Notes:**

---

### E-4. Apply what the user asked for

**What:** A proposal already records that the PM asked for it. It still draws a card.

**Change:** Asked-for writes apply on the spot. The card was asking the user to confirm their own
instruction.

**Decision:**
yes, and also add a receipt in the chat like "created x" or "update y"
**Notes:**

---

### E-5. Apply arriving material

**What:** One transcript produces roughly 5 to 12 cards. Appends already re-place against the note
as it reads now and refuse duplicates, so the risky part is already handled.

**Change:** A new note and an append both apply silently. Activity carries the receipt.

**Decision:**
yes
**Notes:**

---

### E-6. One card per intent

**What:** Patches over existing text and decisions still need a human. Today they arrive as one
card each.

**Change:** Group them by what the user would say out loud. "Move ten tickets to Done, as agreed in
Tuesday's standup" is one row with ten lines under it, not ten cards. Expandable to handle items
one by one, or approve all.

The card also stops asking about filing. Type, tags, sources and path are stripped from the preview
today and cannot be edited there anyway, and the code already decides all four. Keeping the user
responsible for a schema they cannot see is where "I don't want to be responsible for
documentation" comes from.

**Decision:**
yes
**Notes:**

---

### E-7. Outbound: one card per send, full text, never batched

**What:** Nothing the agent sends to Jira, Confluence or a calendar can be taken back.

**Change:** Every send is its own card with the full text shown. E-6's grouping never applies here.

**Decision:**
Yes lets keep it like this, but in the future we might want to be able to group some stuff ehre as wel.. 
**Notes:**

---

### E-8. Standing rules land silently

**What:** A standing rule appends a bullet to the owning skill or to `_your-rules`.

**Change:** Remember it without a card. The Activity row is the only trace.

This is the cheapest thing in the list to get wrong and the hardest to notice later. See the open
question at the end.

**Decision:**
yes, but perhaps add some indication in the chat, like a simple "Added to rules" that isn't very visually loud
**Notes:**

---

### E-9. Activity, the receipt

**What:** Nothing today shows what the agent did on its own, because until section B it never did
anything on its own.

**Change:** A list of what the agent did without asking. First person, past tense, every row
revertible. Not a place the user goes often, and not hidden either. It is the proof that the
silence was earned.

**Decision:**
yes, but stuff should be visible in the chat too (it already is i believe)
**Notes:**

---

### E-10. Cap what can reach the queue

**What:** Nothing caps how many cards a session may emit. The librarian tops the queue back up to
8 pending cards every 30 minutes while the app is open, and meeting-prep adds one per synced
meeting. An ordinary week is an estimated 30 to 70 cards.

**Change:** A cap per session and a stop on the librarian top-up. Sections B and C should cut the
count on their own, so this is the backstop that keeps it cut.

**Decision:**
No, this would mean something might be missed or skipped that shuoldn't be. I think with our changes there shuoldnt be so many approvals. 
**Notes:**

---

## C. Three surfaces

Everything the user sees belongs to one of three places: Calendar and Todos, Documents, and
Context. Calendar and Todos sit as siblings of the memory, not inside it.

The line that matters is not the note type. It is whether a human will ever open the thing twice.
Everything in the "never twice" set can be written for the agent and kept out of sight.

### E-11. Sidebar around the three surfaces

**What:** Roughly 35 to 40 distinct nouns reach the user: 12 tab kinds, 14 note types, 5 lifecycle
vocabularies, 5 proposal kinds, plus skills, agents and sessions as three similar-looking things.

**Change:** Redesign the sidebar around the three surfaces. This ticket is the shape; E-12 to E-18
are the contents.

**Decision:**
yea it should be similar to today. Home, Inbox, Calendar Todos, Sessions, then Documents(or Notes), then Context. Context is least important. please really think about this. 
**Notes:**

---

### E-12. Calendar gets its own screen

**What:** What is coming and what happened. Markdown underneath, but it should not feel like a
folder of notes.

**Change:** A shaped calendar screen, sibling to the memory.

**Decision:**
Yes, we already have something to work from, but the way we display the individual meeting should be improved
**Notes:**

---

### E-13. Todos gets its own screen

**What:** What you owe and what you are waiting on. Same argument as E-12.

**Change:** A shaped todo screen, sibling to the memory.

**Decision:**
Yes, but we alreayd have one that is good. Perhaps what can be improved is the way we show the individual todo. 
**Notes:**

---

### E-14. Documents: the user's folders

**What:** Scratch notes, PRDs, specs, briefs. What the user writes in.

**Change:** Owned by the user, agent-assisted, never auto-written. Folders here, made by the user,
because folders are the one organising idea nobody needs taught. This is the only place where the
user's own structure means anything.

**Decision:**
Yes, keep it clean and simple
**Notes:**

---

### E-15. Tags become the agent's

**What:** Tags are curated in three places in the UI while the agent already fills them.

**Change:** Take tags out of the user's hands. They keep working underneath.

**Decision:**
Yes, let's keep them mostly hidden but not entirely. I think they should be able to see them in the frontmatter details if the expand. 
**Notes:**

---

### E-16. Context: one entry point

**What:** Sources, decisions, insights, themes, customers, tickets and wiki mirrors sit on eight
shelves. They are what the agent reads to be useful, not what the user browses.

**Change:** One entry point. The honest label is "what I know and where I got it". "Context" is a
placeholder, not the name. See the open question at the end.

**Decision:**
Yea, but going into context we should still have them seperated. 
**Notes:**

---

### E-17. A person keeps a page, not a directory

**What:** A person page makes meeting prep good and holds what we last told them. A People
directory adds a shelf and earns nothing.

**Change:** Keep the page, reached from a meeting, a mention or search. Cut the directory. Pages
exist only for people who keep coming up.

**Decision:**
They can be in the context
**Notes:**

---

### E-18. A source keeps one address

**What:** An article the user drops turns into a source and a separate digest note.

**Change:** The summary sits at the top of the source, the original underneath. Nothing extra to
open, sync or maintain.

**Decision:**
yes
**Notes:**

---

## D. Noticing, instead of reviewing

The machinery for asking a question is done: it survives a quit, dedupes by content hash, replays
the answer into the session, and ranks above everything else. What is missing is anything that
notices something worth asking about. Nothing compares two notes, nothing joins a todo to a
ticket, and `processing: stale` is a value no code ever writes.

### E-19. Write out the claims when material lands

**What:** One cheap step every time material arrives. Not hard-coded checks.

**Change:** The run writes out the claims the material carries: who committed to what, dates,
owners, numbers, decisions.

**Decision:**
yes
**Notes:**

---

### E-20. Look each claim up, and act on the answer

**What:** Each claim is looked up against what is already stored and comes back as one of four
things.

**Change:**

- Already known: nothing happens.
- New: filed silently.
- In conflict with what we hold: becomes a question.
- Implies something that is missing: becomes a question.

"A promise with nobody doing the work" falls out of the fourth case without anyone writing that
check. A question is short, about their world, and settled in one tap: "You said the date is 12 May
in one meeting and 19 May in another. Which is right?" Never about our filing.

This is where the "they get it" feeling comes from. The product answers back about the content of
the meeting, not about its own bookkeeping.

**Decision:**
yes, keep it smart and use would preferabbly use haiku here. If we want to verify a claim, it shouldn't look at ALL claims, perhaps just those that are linked to a specific page or has a speicif tag. 
**Notes:**

---

### E-21. Ration the questions

**What:** Noticing ten things must not mean asking ten questions.

**Change:** A rule for how many questions the skill may raise, and how it picks.

**Decision:**
Yes but shouldnt be hard limit if the questions are legitemetly needed and valuable
**Notes:**

---

### E-22. Match claims on a cheap model

**What:** Matching claims is lookup, not judgement.

**Change:** Trial Haiku before Sonnet. It has to fail quiet: no match, no question. A confident
wrong question costs more than a missed one.

**Decision:**
yes
**Notes:**

---

### E-23. Test the swap before building it

**What:** The assumption under all of section D is that trial users accept a handful of good
questions a week where they reject thirty cards. It is an assumption, not a fact.

**Change:** Put both in front of two trial users and see.

**Decision:**
not sure what you mean. 
**Notes:**

---

## E. The agent sets itself up

The architecture is already here. Skills are markdown files whose body is the agent's instructions,
the user can read and edit them, standing rules append to them, and a conventions file per system
is created on demand. What is missing is the moment, and the agent proposing its own setup instead
of waiting to be told.

### E-24. The agent says what it plans to do

**What:** Onboarding is a checklist. It teaches the user our words and asks for work before it has
given anything.

**Change:** Once the agent has seen enough, from the connect sweep or the first few meetings, it
says what it plans to do in the user's terms: you have four or five meetings most weeks with the
same three teams, so I have set myself up to prepare you for each one and chase what people promise
you, I keep notes behind the scenes to do it, and I will ask the occasional question when something
does not add up. Then it shows what it wrote for itself, which the user can read and change.

This is the only version of onboarding here that teaches nothing, asks for nothing, and works on
day one before any meeting has happened. Every sentence in that pitch is also a promise the product
then has to keep.

**Decision:**
yes
**Notes:**

---

### E-25. Read the team's conventions on connect

**What:** Same shape, for Jira and Confluence.

**Change:** On connecting, the agent reads recent tickets and pages in the projects the user
follows and writes up how this team writes a ticket: the template, the recurring labels, the tone,
what a good title looks like. It shows that once and asks whether it looks right. Cheap and fast,
on Sonnet, because it is reading and not reasoning.

**Decision:**
yes
**Notes:**

---

## F. What gets cut

Cut on screen first, and only later in the file format. The vault can keep precise words for the
agent while the screen stops teaching them.

### E-26. Drop the vocabularies that carry no logic

**What:** Of the five lifecycle vocabularies, two are structural (standing, commitment),
`processing` is two thirds real, and `relationship` and `stance` have no logic behind them at all.
`insight` is a note with required evidence and nothing branches on it.

**Change:** Take `relationship` and `stance` off the screen. Trim `processing` to the third that
does something.

**Decision:**
yes, we can keep some mostly hidden but still vaulable for the AI 
**Notes:**

---

### E-27. Stop teaching our private language

**What:** Empty states carry lines like "the spine starts here" and "the durable things worth
solving, accreting evidence". We shipped a careful private language and teach it nowhere. This is
the Obsidian trap: a person wanted a notes app and got a research project about note-taking
systems.

**Change:** Rewrite every label and empty state in the user's words.

Generated note bodies run about 65 to 140 words and the shared prompt bans assistant-speak by name,
so "AI slop" is not about length. It is that the notes are uniform, arrive unasked, and are about
things the user already knows. Thirty short notes in one voice read as slop even when one of them
would pass alone. Section B is most of the fix; this ticket is the rest.

**Decision:**
YES SO MUCH YES
**Notes:**

---

### E-28. Retire the tab kinds the surfaces do not need

**What:** 12 tab kinds. Retiring one is already a cheap, solved operation in the code.

**Change:** Cut the kinds that section C leaves with nowhere to appear.

**Decision:**
Not really sure what you mean. 
**Notes:**

---

## Still open

Answer under each. These are not tickets yet.

**1. What is "Context" called, and is one entry point enough?**
Someone may want to browse decisions deliberately.

> Let's call it "Memory" and it's a single entry point, but then the user is presented with the different types. 

**2. Is a silent standing rule acceptable with only an Activity row behind it?**
Cheapest to get wrong, hardest to notice later. Blocks E-8.

> Like i said above, if it's created during a session we can add a small "Added to rules" that the user can review if they want

**3. Is claim matching reliable enough on a cheap model?**
It has to fail quiet. Blocks E-22.

> Let's trial it. 

**4. How is the question skill rationed?**
Blocks E-21.

> Not sure what you mean. Write the first version of it and i Can iterate on it. 

---

## Two things the direction does not change

The product stays opinionated. A flexible folder-and-file setup the user shapes themselves is the
opposite of what this user wants. Customisation comes later, if at all.

The target user is not the PM who already built their own Claude Code brain. It is the one with no
time, energy or interest for that, who still wants the benefit. Their tolerance for a first hour
that returns nothing is near zero, and their tolerance for a system they must keep true is zero.
