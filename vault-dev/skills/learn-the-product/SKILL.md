---
type: skill
starts: [you-run-it, model-picks-it-up]
title: Learn about the product
summary: Asks about your product, then writes down what you said.
---

## When

The PM wants the workspace to know what the product actually is: the first time, from First steps
on Home, or later when an area of the understanding is still empty. It needs no connections and
works in an empty workspace, which is the point. On day one there is nothing to read.

This is a conversation, not a questionnaire. Ask, listen, and write down what you heard.

## Open with one big ask

Say something close to this, in your own words, and then stop and let them talk:

"Want me to learn about your product? Tell me as much as you can. Useful things: what it is, who
pays for it, what the big parts are called, and what is being worked on right now. Talk, paste
anything in, or drop material in."

One open invitation beats a form. People say more, in their own order, and what comes out first is
usually what matters most.

## Read first

Before asking anything, see what is already known: the three understanding notes, the customer and
theme hubs, and any `_about-us` file the workspace still holds. That last one is an older skill
some people filled in by hand, and where it has real words in it, it is the best source there is.
Never ask for something the workspace already knows. Read it back and ask whether it is still
true.

Material they paste or drop in arrives through the ordinary filing path, and anything you draft
from it cites it.

## Options at every fork

Use `ask_user` whenever a new area opens up, with three options: tell me in your own words / I
will drop something in / skip for now. Skip is a real answer. It parks the question, so the gap
comes back quietly later instead of being lost, and nothing is asked twice in one session.

Follow up only where an area is thin, one or two concrete questions about what is actually
missing. When they have said enough about something, say so and move on.

## The technical area has a shortcut

When the technical shape comes up, ask: "Do you have the code on your own machine?"

If they do, hand over the prompt below IN FULL, in the message that ENDS your turn, so it is the
last thing on the screen instead of a line they scroll past on the way to your cards. Around it,
say what to do with it, in this order, in your own words:

1. Open a terminal in the folder their product's code is in, and start Claude Code (`claude`).
2. Paste the prompt. It writes a new file called `product-overview.md` into that same folder.
3. Drag that file onto this window. It gets filed, and the technical note is written from it.

Never name `product-overview.md` before you have said where it comes from. It is a file that does
not exist yet, so a workspace asking them to go and find it reads as broken.

The block itself is wrapped short on purpose, so it reads as a block in a chat column rather than
as a wall. Hand it over exactly as it is written here:

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

No code on the machine, no Claude Code, or they would rather just talk? That is fine, and it is the
same conversation: the five boxes and the arrows between them can be described out loud like
anything else.

**Never hold a note hostage to that file.** Propose the technical note in this session from what
they said plus what the workspace already holds, thin as it is, and say in one line what the
overview would add. They may run it in a minute, tomorrow, or never, and a session that ends owing
them a note has left them with homework and nothing to show for it. When the file does arrive it
lands as ordinary material, and the note gets tightened then.

## Close by drafting

When the picture is good enough, say so ("I think I have a good picture now") and propose the
understanding notes as ordinary approval cards. The product-understanding skill says what belongs
in each note, how short to keep it, and how each claim is marked. Follow it.

- What the PM told you lands verified. They are the source.
- What you took from material lands unverified, citing the material.
- An area they skipped is left out, or left with one line saying what is missing and why. Never
  fill a gap with something plausible: "you did not mention who pays for this, so I left it blank"
  earns more trust than filler.

End by saying plainly what is still empty, so they know what the workspace does not know.

## Then

The approved notes are the picture every session starts from. Keeping them true is ordinary upkeep
under the product-understanding skill, so this does not need running again unless a whole area is
still empty.
