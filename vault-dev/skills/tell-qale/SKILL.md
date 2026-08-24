---
type: skill
title: Tell Qale about something
summary: You talk about a topic, Qale asks until it has it, then writes it down.
scenarios:
  - telling the workspace something it has no way to know ("let me tell you about our pricing")
  - filling a gap you noticed in what it knows ("you do not seem to know how onboarding works")
  - getting how the team works written down ("let me explain how the team is set up")
---

## When

You want the workspace to know something it does not know yet, and you are the source. A topic
comes in with the request: the product, pricing, how the team is set up, why last quarter went
the way it did. First steps on Home hands in "the product" on day one.

It needs no connections and works in an empty workspace. This is a conversation, not a
questionnaire: ask, listen, and write it down.

## Read first

Before asking anything, see what the workspace already holds on the topic. Search for it, read
the notes it turns up, and read `notes/understanding.md` and the area notes it points at
whenever the topic touches the product, the system or the organization. Never ask for something
the memory already knows: read it back and ask whether it is still true.

## Open with one big ask

Name the topic, ask for everything at once, then stop and listen. For a narrow topic that is one
line: "Tell me how pricing works. Whatever you have." For a wide one it is the same move with a
few prompts in it, like the product example below. One open invitation beats a form.

## Options at every fork

Use `ask_user` whenever a new area opens up, with three options: tell me in your own words / I
will drop something in / skip for now. Skip is a real answer. It parks the question, so the gap
comes back quietly later, and nothing is asked twice in one session.

Follow up only where an area is thin, one or two concrete questions about what is actually
missing. Once an area is covered, say so and move on.

## Where what you hear lands

Every topic ends in the memory, as approval cards.

- **The product, the system, or the organization** go in the area notes:
  `notes/understanding-product.md`, `notes/understanding-technical.md`,
  `notes/understanding-organization.md`. `notes/understanding.md` is the map over them. It says
  what belongs in each, how short to keep them, and how a claim is marked. Follow it.
- **Anything else** goes in the note that already owns the subject: the customer, the theme, the
  person. Write a new note only when nothing owns it yet, and say in the card what it will hold.

How a claim is marked is the same wherever it lands:

- A claim that came out of the conversation lands verified. It came from the person who knows.
- A claim that came out of material lands unverified, and cites the material.
- An area that was skipped is left out, or left with one line saying what is missing and why.
  Never fill a gap with something plausible: "you did not mention who pays for this, so I left it
  blank" earns more trust than filler.

## Example topic: the product

The widest topic there is, and the one First steps opens with. Open with something close to this,
then stop and listen:

"Want me to learn about your product? Tell me as much as you can. Useful things: what it is, who
pays for it, what the big parts are called, and what is being worked on right now. Talk, paste
anything in, or drop material in."

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
would add. When the file does arrive it lands as ordinary material, and the note gets tightened
then.

## Close by drafting

When the picture is good enough, say so and propose the notes as ordinary approval cards, marked
the way the section above says. End by saying plainly what is still empty.

## Then

The approved notes are what every session starts from. Keeping them true is ordinary upkeep, so
this does not need running again on the same topic unless a whole area is still empty.
