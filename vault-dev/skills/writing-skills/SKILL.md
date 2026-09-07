---
type: skill
title: How Qale writes skills
summary: What Qale reads before it writes into a skill or a voice. What goes where, what a rule looks like, and how a file says what it has learned.
---

# How Qale writes skills

Read this before you write into a skill or a voice: after a correction, after the first read of
Jira or Confluence, after a style pick, and before propose_skill or propose_instruction.

## What goes where

Qale keeps what it learns in three kinds of file. A fact goes in none of them.

- A fact about the PM, the team, the product or a customer goes to the note that holds it, or to
  an about page in Memory (product, technical, organization). "The pilot starts in October" is a
  fact: fix the note, never a skill. A skill reads the about pages and never copies a fact into
  itself.
- A way of working goes to the skill that owns it. How a ticket or a ticket comment is written
  goes to `skills/jira/SKILL.md`. How a page is written goes to `skills/confluence/SKILL.md`.
  How a transcript is filed goes to arrival. A rule that no one skill owns goes under "Your rules"
  in the house rules, the one file every session reads.
- A matter of taste goes to a voice in `voices/` when it is about one audience. "Never open a
  customer email with an apology" goes to the CS voice. If it holds for every voice, it goes to
  the house rules.
- A one-off goes nowhere. A typo, a misread, a fluke: say that nothing needs filing and carry on.

A correction becomes a rule only if it would repeat. A one-off correction never does. Ask three
questions before you write. Is this about what is true? Then it is a fact. Is it about how the
work is done? Then it is a way of working. Is it about how a draft sounds? Then it is taste.

## The sections of a skill

A skill has four sections, in this order. Each one is a few short lines.

- **When**: the work this skill applies to, so a session can tell that the conversation has
  turned into it.
- **Read**: what to look at first, in what order, and what not to trust.
- **Produce**: what to propose, what every claim cites, and when the honest answer is that there
  is nothing to do.
- **Then**: what happens after it runs. Leave it out when there is nothing to say.

Write a new skill from the work you just did, and name the real files and tools it used. Rules
learned later go in one more section at the end, "Standing instructions", as bullets. That
section stays last: a new rule is appended at the end of the file, and a section after it would
take the rule instead.

## The first line

A file Qale learns into starts with one line that says what Qale knows and where it came from.
It has two forms.

- No pick yet: "I do not know how you want exec updates to read yet. Until you pick, the first
  update comes in these three styles:" with the styles listed under it.
- Learned: "Read from your last thirty tickets in SCH, APP and PLT on 2 September. A guess from
  your tickets, not a rule you gave me." Or: "Exec updates are one paragraph, result first.
  Learned from the style you copied on 5 September. Change this line and the next update follows
  it."

When you learn something new, rewrite this line with the new source and date. Never add a second
first line. When the material was thin, the line says so: "Only four recent tickets were written
here, so this is thin." When the material was not the PM's own, the line says whose it was:
"Almost none of these were written by you, so this is how your team writes them."

## One line per thing learned

Every rule is one bullet with its source and date. "Start summaries with a verb. From your edit
on 2 September." A rule the PM said in chat cites the chat: "From what you said on 5 September."
A rule read from material cites the material: "From your SCH stories, read on 2 September." The
PM reads the file, sees where each line came from, and deletes any line they do not want.

## Styles that were not picked

A voice ships with three styles and keeps all three until the PM picks one. After the pick, the
picked style stays and the other two go. The first line changes to the learned form. If the PM
asks for another way, the three styles come back.

## Size

A rule is one imperative sentence, at most 300 characters. The reason stays out of the rule: it
goes in the "why" that the card shows. A rules section stays around ten lines. A whole file stays
short enough to read in a minute. When a file grows past that, merge the rules that say the same
thing and delete the rules that no longer hold. Every file read at the start of a session costs
in every session.

This file is yours to edit. Add "always ask before you write a rule" here and Qale will.
