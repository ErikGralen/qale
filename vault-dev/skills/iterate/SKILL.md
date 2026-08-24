---
type: skill
title: Iterate on something
summary: Qale drafts something, you mark it up, and it takes another pass.
scenarios:
  - breaking a big piece of work into smaller ones ("break this epic into user stories")
  - roughing out a plan in rounds ("help me rough out a roadmap")
  - landing on a name for something ("we need to name this feature")
  - deciding how to split the work ahead ("think through how to split this quarter")
can: [draft-outbound, keep-working-files]
---

## When

Draft, react, redraft. You want to work something out on paper in rounds rather than in one
answer: an epic broken into stories, a roadmap roughed out, a decision weighed, a name landed on.
The shape is a working document, not a conversation: write a round into a file, ask for comments
on it, write the next round from what comes back.

Where the workspace already holds the conclusions and the job is the document, that is the spec
skill. This one is for the thinking that has not happened yet.

## Round one

Write `round-1.md` into the session folder with `files_write`. Open it with at most three framing
questions:

- What are we deciding?
- What is out of scope?
- What does done look like?

Then put a first rough cut of ideas under them, in the same file, before any of the three is
answered. Never send the framing questions on their own: "what does done look like" is hard to
answer cold and easy to answer beside three drafts.

## The ideas

Two to six per round. One is not a round, and more than six is a list nobody reads to the end.

Each idea argues for itself in a few sentences, and states its cost in the same breath: what it
gives up, who has to do the work, what it makes harder later. An idea with no cost written down
cannot be weighed against the one next to it.

Each idea ends with a slot, so there is somewhere to answer it.

## Slots

A slot is a fenced block whose info string is `slot` and an id. Whatever the block holds is the
prompt on the page:

```slot idea-3
Keep? Cut? Smaller?
```

- Ids are short and about the thing: `idea-3`, `scope`, `the-name`. No two the same in one file.
- The app draws each slot as a comment box, so every answer comes back under its own id.
- The app also puts a general comment box at the bottom of every round, so never write a slot for
  general reactions: a second one splits the same answer in two.

## Ask for comments

Once the round file is written, call `request_comments` with its path, and wait. The card on the
screen opens the file, and the answers come back as the result of that call.

Two rules hold for the whole session:

- Never call `ask_user`. The round file is where the questions go, and a question card beside it
  splits one conversation into two.
- Never read a round file back with `files_read`. You wrote it, and the answers arrive with the
  tool result. Re-reading a round costs the whole file and adds nothing.

## Later rounds

A new file every round: `round-2.md`, `round-3.md`. Never rewrite an earlier one: the rounds are
the record of how the thinking moved.

- Compress what is settled into a line, and stop asking about it.
- Drop what was cut. A dead idea does not come back for a second vote.
- Go down a level only once the level above is settled: the epic before the stories, the stories
  before the acceptance criteria. Detail written under an idea that then gets cut is work thrown
  away.

## End with the thing itself

The last round is the artifact, not another set of ideas. A brainstorm that ends in a brainstorm
failed.

Propose the output through the ordinary paths: approval cards (propose_note, propose_update) for
a document, a spec, a set of stories, and outbound cards (draft_ticket), one per issue, for work
that belongs upstream. Say which round the output came from, so the reasoning behind it is one
click away.

A dismissed comment card is an instruction, the same as a skipped question: pick the reasonable
reading, say in the next round which reading that was, and carry on.

## Then

The rounds stay in the session folder with the comments written into them, so the thinking is
readable later. Nothing lands in the memory except the cards you approve.
