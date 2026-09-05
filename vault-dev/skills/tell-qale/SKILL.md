---
type: skill
title: Tell Qale about something
summary: You talk about a topic, Qale asks until it has it, then writes it down.
scenarios:
  - telling the workspace something it has no way to know ("let me tell you about our pricing")
  - filling a gap you noticed in what it knows ("you do not seem to know how onboarding works")
  - getting how the team works written down ("let me explain how the team is set up")
can: [track-external]
---

## When

You want the workspace to know something it does not know yet, and you are the source. A topic
comes in with the request: the product, pricing, how the team is set up, why last quarter went
the way it did. First steps on Home hands in "the product" on day one.

It needs no connections and works in an empty workspace. This is a conversation, not a
questionnaire: ask, listen, and write it down.

The one other way it starts is a first look: a connection has just read a site for the first
time, and the section below says what to do with that. Everything else here applies either way.

## Read first

Before asking anything, see what the workspace already holds on the topic. Search for it, read
the notes it turns up, and read `understanding/what-goes-here.md` and the area notes it points at
whenever the topic touches the product, the system or the organization. Never ask for something
the memory already knows: read it back and ask whether it is still true.

## Open with one big ask

Name the topic, ask for everything at once, then stop and listen. For a narrow topic that is one
line: "Tell me how pricing works. Whatever you have." For a wide one it is the same move with a
few prompts in it, like the product example below. One open invitation beats a form.

## First look

A connection has just read for the first time, and you are handed what came in. It can be two
connections at once. Nobody is at the screen. This goes in two beats, and the first one is short.

**Beat one: read, then knock.** Look at everything that arrived, using each connection's own
search tools, and search the workspace as well:

- **Tickets and pages:** the epics with work moving in them, the tickets that are theirs, what has
  not moved in months, the names that keep coming up.
- **The calendar and the meetings already filed:** who they meet and how often, which meetings
  repeat, and what the transcripts in `sources/` are about.

Then make one `ask_user` call. Name the whole haul in one line, with the real names and the real
numbers, and end your turn:

"I read NORD and KRAN, 214 tickets and 40 pages, and a month of your calendar. Want to walk
through what I found?"

Two options: yes, walk me through it / not now. Write nothing, propose nothing, say nothing else.
The question waits, so a run nobody answers costs nothing.

**Beat two: the debrief.** They said yes and the same session carries on. Lead with what you
think, not with a question: the epics with motion, their own open tickets, what looks stalled, who
they meet most, which topics keep coming back. Every claim cites the ticket, the page or the
meeting it came from. A sentence with no citation does not belong in this part.

Where two sources agree, say so. That is the line no single source can give you, so it is worth
the most: "Checkout Rewrite is in 9 tickets and came up in 4 of your meetings this month." Where
they disagree, say that too, and ask which one is current.

Then work the areas below, hypothesis first. The sources propose and you put it as a question.
"Checkout Rewrite looks like the main thing right now. Is it?" beats "what are you working on?",
because they can correct it in four words. Where the sources are thin, fall back to the open ask
above. Never read the debrief back into a note: the picture that lasts is the area notes.

Never ask how they use Jira or Confluence one rule at a time. How this team writes a ticket and a
page is written up when the connection is made, from the same read, and it lands as a proposal
they can correct. Asking about it again here is the workspace forgetting.

**When the kickoff says the picture is already there.** They have told the workspace about the
product before, so the debrief is the whole session. Report what you read the same way, with the
same citations, then offer to set the workspace up. Do not run the interview and do not ask the
areas again: they are written down, and asking for them twice is the workspace forgetting.

## Options at every fork

Use `ask_user` whenever a new area opens up, with three options: tell me in your own words / I
will drop something in / skip for now. Skip is a real answer. It parks the question, so the gap
comes back quietly later, and nothing is asked twice in one session.

Follow up only where an area is thin, one or two concrete questions about what is actually
missing. Once an area is covered, say so and move on.

**Ask for their old notes, once per session.** Most people wrote some of this down long before
they met you. Early on, make one `ask_user` call: "Do you keep notes from before? Drop the folder
in and I will read them." Three options: I will drop a folder in / nothing worth reading / skip
for now. Say the word folder, because nobody tries dropping one unless told they can. What they
drop arrives as an ordinary source, and what you draft from it cites it as their own writing
("your note from March").

## Where what you hear lands

Every topic ends in the memory, as proposals.

- **The product, the system, or the organization** go in the area notes:
  `understanding/product.md`, `understanding/technical.md`,
  `understanding/organization.md`. `understanding/what-goes-here.md` is the map over them. It
  says what belongs in each, how short to keep them, and how a claim is marked. Follow it.
- **Anything else** goes in the note that already owns the subject: the customer, the theme, the
  person. Write a new note only when nothing owns it yet, and say in the proposal what it will hold.

How a claim is marked is the same wherever it lands:

- A claim that came out of the conversation lands verified. It came from the person who knows.
- A claim that came out of a source lands unverified, and cites the source.
- A claim you read in a source and then put to them, which they confirmed, lands verified and
  still cites the source. Their yes is what verifies it; the citation is what makes it
  checkable later. Silence is not a yes.
- An area that was skipped is left out, or left with one line saying what is missing and why.
  Never fill a gap with something plausible: "you did not mention who pays for this, so I left it
  blank" earns more trust than filler.

## Example topic: the product

The widest topic there is, and the one First steps opens with. Open with something close to this,
then stop and listen:

"Want me to learn about your product? Tell me as much as you can. Useful things: what it is, who
pays for it, what the big parts are called, and what is being worked on right now. Talk, paste
anything in, or drop a source in."

It covers three areas, one note each: what the product is and who pays for it, the shape of the
system, and who does what. Any of the three is a fine topic on its own.

### The technical area has a shortcut

The code is the one source that cannot be out of date about itself, so this area is read there
rather than remembered.

**When `ask_codebase` is available, ask the code directly.** Name the repo and say what the
question is for, then send the brief in the block below as the question. Open it with "Write a
high level technical overview of the product." instead of its first sentence: the tool reads
code and writes nothing, so there is no `product-overview.md` to ask for. Suggest a strong
model, with the reason in one line: this spans a whole repo and asks for judgement. The run
waits for your approval, and the answer lands as a report in the session folder. Draft the
technical note from that report, and cite it.

**Without the tool, the prompt goes to you.** Ask first: "Do you have the code on your own
machine?"

When the answer is yes, hand over the prompt below in full, in the message that ends the turn,
so it is the last thing on the screen. Around it, say what to do with it, in this order:

1. Open a terminal in the folder your product's code is in, and start Claude Code (`claude`).
2. Paste the prompt. It writes a new file called `product-overview.md` into that same folder.
3. Drag that file onto this window. It gets filed, and the technical note is written from it.

Never name `product-overview.md` before saying where it comes from: it does not exist yet, and a
workspace that asks you to go and find it reads as broken. The block is wrapped short on
purpose, so it reads as a block in a chat column. Hand it over exactly as it is written here:

```
Read this repository and write a high level technical
overview of the product as a markdown file called
product-overview.md.

Write it for a smart colleague who does not write code:
a new product manager, a designer, a support lead. Plain
language, and explain any term that is not obvious from
outside the team.

Cover, in prose:
- What the system is, and what it does for the people
  who use it.
- The major parts and how they fit together. Five to ten
  of them, and what each one is for.
- Where the data lives, and what moves between the parts.
- The constraints that shape decisions: the platform,
  what is slow or expensive, what nobody wants to touch,
  what would need a rewrite.
- The names the team uses for things, including internal
  names an outsider would not guess.

Keep it under two pages. Do not list files, functions,
endpoints or dependencies. This is not a README and not
a setup guide. Where something is genuinely unclear from
the code, say so instead of guessing.
```

No code on the machine, no Claude Code, or you would rather just talk? That is fine: the five
boxes and the arrows between them can be described out loud like anything else.

Never hold a note hostage to that file. Propose the technical note in this session from what was
said plus what the workspace already holds, thin as it is, and say in one line what the overview
would add. When the file does arrive it lands as an ordinary source, and the note gets tightened
then.

## Offer to set the workspace up

First look only, and only once you have the picture. Offer to seed the workspace from what they
actually work on: ONE `ask_user` call, every row ticked, one confirm. Never a stream of cards.

- **Their tickets**, at most 10, most recently moved first. A `multiSelect` question with every
  row `checked`, each carrying its reason ("yours, moved on Tuesday"). Call `track_external`
  for each row they leave ticked. A tracked ticket is where context gathers around the work. It
  is never a copy of the ticket.
- **Themes**, at most 3, from the epics they just confirmed matter. A second question in the same
  call, same shape. Propose the theme note with `propose_note` for each row they leave ticked.

Never mirror a wiki page. A page is cited, never copied. No people and no todos: those come out
of meetings, not out of a first read.

If they clear every box, or dismiss the card, set nothing up and say so in one line.

## Close by drafting

When the picture is good enough, say so and propose the notes as ordinary proposals, marked
the way the section above says. End by saying plainly what is still empty.

## Then

These notes are what every session starts from. Keeping them true is ordinary upkeep, so
this does not need running again on the same topic unless a whole area is still empty.
