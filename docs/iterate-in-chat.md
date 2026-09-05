# Iterate in the chat

Settled and built 2026-09-05. Replaces the round-file shape from
docs/brainstorm-skill.md and docs/iterate-tickets.md (both deleted, in git
history). Erik's comments on the first draft are folded in below as the
decisions.

## What it is

Iterate is a conversation shape that lives in the chat, built on the one
question tool, `ask_user`. No round files, no slot fences, no second tool.
The session puts a round of ideas on a card, the PM reacts to each one where
they read it, and the next round is written from what came back.

## What `ask_user` gained

Three things, and everything else on the card stayed as it was: the stepper,
the trail, Skip, the parking, the replay after a quit.

- **A body.** A question may carry `body`: markdown paragraphs under the
  question line, rendered on the step. For a round, that is the case for one
  idea and its cost. Under 4,000 characters, or the call is refused. The body
  is drawn and stored, never replayed: the model wrote it, and repeating it in
  the tool result would be the round-file re-read this shape exists to avoid.
- **Written questions.** A question with no `options` draws the question and
  a box, nothing else. One option is refused (neither a choice nor a written
  question). `multiSelect` on a written question is refused.
- **Options and words together.** Every question with options still ends in
  "Something else", and it now adds to the pick on every kind of question
  rather than replacing it on a pick-one. So "Keep it, but call them plans"
  is one answer: the tick and the text. The row reads "Add a comment" once
  something is picked. The box is a textarea that grows with the text. ↵ is a
  new line in it, ⌘↵ moves on.

The cap on questions moved from a hard four to a ceiling of twenty. The
target lives in prose: the tool description says "usually one to four", and
the Iterate skill says two to six ideas plus a closing question. Past twenty
the card is a form whatever the skill says.

Multi-select was already there (`multiSelect: true`, checkboxes, ticks and
text combine) and so were pre-ticked batches (`checked: true` rows, up to
ten, clearing every box means "none of these"). Nothing changed on either.

## The round

1. The session says the framing in the chat, answered as far as it can: what
   are we deciding, out of scope, what done looks like. Three lines at most,
   never a framing form on its own.
2. One `ask_user` call. One question per idea: header is the idea's short
   name, question is the idea in a line, body is the case and the cost,
   options are "Keep it" and "Cut it" with a third for a natural variant.
   Then one written question, header "Anything else", for what is missing,
   what to merge, what the round got wrong.
3. The answers arrive as the tool result. The next round is the next call,
   with a line or two above it on what changed. Same later-round rules as
   before: compress what is settled, drop what was cut, go a level down only
   once the level above is settled, end with the artifact through the
   ordinary proposal paths.

A round that outgrows a card (a whole roadmap, a spec draft) goes to the
session folder with `files_write`, named in the chat, and the card asks
about it a section at a time. The file is never read back.

## Decisions

- **Options plus free text, not one or the other.** Erik: "A) answer a, B)
  answer b, C) Other (write text)." Built as the additive "Something else"
  row on every question, plus written-only questions.
- **Keep the stepper, with room for paragraphs, and a final "Anything
  else?".** Erik: "stepper, and each step might need space for more text
  than we currently have. Like in this file, you write several paragraphs
  for each. We should also have a final 'Any other input?'" Built as
  `body` on the step and the closing written question in the skill.
- **Keep and cut per idea, with a written way out.** Erik: "A) Yes keep it
  B) No discard it C) Other (write)." Built as the skill's per-idea options.
- **Soft cap.** Erik: "Let's make it a soft cap, where we try to keep around
  4 ... maybe the tool itself shouldn't have the cap but the skills have the
  cap/suggestion." Built as the ceiling of twenty in the tool and the
  guidance in prose, per skill.
- **The md file when needed.** Erik: "sure." Built as the outgrown-round
  paragraph in the skill.

## What went

`request_comments` and its parser (`comments.ts`, `slots.ts`, the
`@qale/agent/slots` export), the `comments` fields on the ask types, store
and DTOs, `CommentsCard`, the comment form and preview in the session file
reader, the pending-comments hooks and the pencil on the rail's tree row,
`comment-writeback.ts` and `recordComments`, the third argument of
`sessions:resolveAsk`, the `round.sent` telemetry event, and four test
files. The `comments_json` column stays in existing databases, unread.

## Verified

- 1,308 tests pass across the workspace, types and lint clean, the desktop
  bundle builds.
- Screenshots of a seeded three-question round in the real app (scratch
  userData, demo workspace, built renderer): step one draws the chip, the
  question line, the body paragraphs, "Keep it" / "Cut it" and "Something
  else"; picking "Keep it" turns the row into "Add a comment" and the typed
  comment joins the pick in the trail ("Keep it, Call them plans, not
  tiers."); step three is the written question with a box that grows with two
  paragraphs, the "⌘↵ answer" hint, and a live Answer button.

Not verified live: a real Iterate session end to end with a model, the
answers reaching the tool result, and the answered-after-quit replay of a
card with bodies.
