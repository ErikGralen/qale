---
type: skill
title: Iterate on something
summary: Qale drafts something, you react to each piece, and it takes another pass.
scenarios:
  - breaking a big piece of work into smaller ones ("break this epic into user stories")
  - roughing out a plan in rounds ("help me rough out a roadmap")
  - landing on a name for something ("we need to name this feature")
  - deciding how to split the work ahead ("think through how to split this quarter")
can: [draft-outbound, keep-working-files]
---

## When

Draft, react, redraft. You want to work something out in rounds rather than in one answer: an
epic broken into stories, a roadmap roughed out, a decision weighed, a name landed on. The shape
is a conversation in rounds: you put a set of ideas in front of the PM, they react to each one,
and you write the next round from what comes back.

Where the workspace already holds the conclusions and the job is the document, that is the spec
skill. This one is for the thinking that has not happened yet.

## Round one

Start with the framing, in the chat, and answer it yourself as far as you can: what are we
deciding, what is out of scope, what does done look like. Three lines at most. Never ask the
framing questions on their own: "what does done look like" is hard to answer cold and easy to
answer beside three drafts. Your guess at the framing sits in the chat above the round, where it
can be corrected like any other idea.

Then ask for the round with ask_user. One call is one round.

## The ideas

Two to six per round. One is not a round, and more than six is a card nobody finishes.

Each idea is one question on the card:

- header: the idea's short name, a word or two.
- question: the idea in one line.
- body: the case for it in a few short paragraphs, and its cost in the same breath: what it gives
  up, who has to do the work, what it makes harder later. An idea with no cost written down cannot
  be weighed against the one next to it.
- options: "Keep it" and "Cut it". Add a third when the idea has a natural variant ("Keep, but
  smaller"). The card offers a written answer beside the options on its own, so never add an
  "Other" option.

Close the card with one written question, no options, header "Anything else": what is missing,
what to merge, what you got wrong. That is where the reaction to the whole round lands.

So a round is the ideas plus one: four to seven questions. Fewer is not worth a round, and more
is a form.

## Later rounds

Each round is a new call. Say in a line or two what changed since the last one, then ask.

- Compress what is settled into a line in the chat, and stop asking about it.
- Drop what was cut. A dead idea does not come back for a second vote.
- Go down a level only once the level above is settled: the epic before the stories, the stories
  before the acceptance criteria. Detail written under an idea that then gets cut is work thrown
  away.

A skipped question is an instruction, the same as a dismissed proposal: pick the reasonable
reading, say in the next round which reading that was, and carry on.

## When a round outgrows the card

A whole roadmap or a spec draft is more than a body holds. Write it to the session folder with
files_write, name the file in the chat, and ask about it with the card: one question per section,
each body saying which part it is about. Never read that file back with files_read. You wrote it,
and the answers arrive with the tool result.

## End with the thing itself

The last round is the artifact, not another set of ideas. A brainstorm that ends in a brainstorm
failed.

Propose the output through the ordinary paths: proposals (propose_note, propose_update) for a
document, a spec, a set of stories, and outbound proposals (draft_ticket), one per issue, for work
that belongs upstream. Say that the reasoning is in this session, so it is one click away.

## Then

The rounds stay in this session with the answers, so the thinking is readable later. New pages
land as they are written; a rewrite of something the memory already says waits for you.
