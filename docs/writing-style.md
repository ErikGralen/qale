# Writing style: STE plus Zinsser

**Status: in force.** The rules live in four places and they have to move
together. This file holds the reasoning; the four places hold the rules.

| Where | What it binds |
| --- | --- |
| `CLAUDE.md` | Claude Code working in this repo: replies, comments, commits, docs |
| `packages/agent/src/prompts.ts` (`SHARED_PREAMBLE`) | Every agent session in the product |
| `packages/agent/src/prompts.ts` (`CHILD_PREAMBLE`) | Fan-out subagents and the files they write |
| `packages/sessions/src/defaults.ts` (header comment) | The shipped skill and agent bodies |
| `apps/desktop/PRODUCT.md` (Brand Commitments) | Product copy a PO can read |

## The rule

Write in Simplified Technical English (ASD-STE100) and follow Zinsser's four
principles: simplicity, brevity, clarity, humanity.

ASD-STE100 is a controlled language written for aerospace maintenance manuals. It
is a real spec with two halves: a set of about 60 writing rules, and a dictionary
of roughly 900 approved words, each with one approved meaning and one part of
speech.

We take the writing rules. We do not take the dictionary.

## Why this, and not "be concise"

"Be concise" has been in the prompt for a year and it does not work. It asks for
an outcome and gives no way to get there. Every model reads it as "same content,
fewer commas".

STE is different because it names the moves. Pick one term per thing. Keep the
sentence under 25 words. Put the condition first. Name who acts. A model can
follow those and check itself against them, and a human reviewing the output can
point at the rule that was broken.

Zinsser sits on top because STE alone produces correct, lifeless text. STE was
built so a mechanic in a second language cannot misread a step. It has no opinion
about whether the paragraph was worth writing. "Simplicity, brevity, clarity,
humanity" is the part that decides what goes in, and humanity is the one that
keeps the product from reading like a manual.

## What we dropped, and why

**The approved dictionary.** About 900 words, each locked to one meaning. It is
the strongest part of the spec and the wrong tool here. It exists so that
"follow" never means "obey" for a reader whose English is their third language.
Our reader is a Swedish product manager reading their own notes. Locking the
vocabulary would cost natural prose and buy nothing, and nothing in the build
could check it anyway.

**The ban on `-ing` forms.** Same reason. It removes a normal English
construction to protect a translation pipeline we do not have.

**Strict rule counts.** The 20-word and 25-word limits are targets, not asserted
invariants. We pin the things that are checkable and that actually broke: no em
dashes, copy length on generated card lines (`packages/domain/test/`).

## The one tension to watch

STE was written for procedures. The product's voice is "a sharp colleague in a
chat window". Those pull against each other, and STE wins too often if you let
it: you get an agent that sounds like a washing machine manual talking about a
customer interview.

So the ordering in the prompt is deliberate. Humanity is named as a rule, in the
same list, not as a footnote. If a sentence obeys every STE rule and reads like a
robot, it fails the rule that matters most.

## If you change this

Change all five places in the same commit, or the product and the repo start
disagreeing about their own house style. The shipped skill bodies in
`defaults.ts` have a second copy in `vault-dev/skills/<name>/SKILL.md`; if a copy
change touches those strings, it is a shipped change and needs a fingerprint in
`shipped-versions.ts`.
