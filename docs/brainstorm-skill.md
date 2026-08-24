# Iterate: the settled shape

Settled 2026-08-22 after two rounds; the rounds are in git. Tickets in
docs/iterate-tickets.md. One **Erik:** line at the end for the go-ahead.

## What it is

A third conversation shape between chat and the question card: the session
writes a working document, you mark it up in rendered input slots, and it
takes another pass. Rounds until done. For breaking an epic into stories,
roughing out a roadmap, weighing a decision, or any "draft, react, redraft"
work. It diverges and converges, sometimes in one session.

The skill is **`iterate`**, titled "Iterate on something". Scenarios: "break
this epic into user stories", "help me rough out a roadmap", "we need to
name this feature", "think through how to split this quarter".

## The loop

1. The session writes `round-1.md` into its own session folder
   (`files_write`, which it already has). At most three framing questions
   (what are we deciding, what is out of scope, what does done look like),
   then a first rough cut of ideas anyway. Never a framing form alone:
   early ideas are what make framing questions answerable.
2. It calls **`request_comments(path)`**, a new tool that parks the turn on
   the existing `AskParking` machinery. The card reads "Waiting for you to
   fill out round-1.md" and opens the doc. `ask_user` is never used inside
   an iterate session.
3. The doc renders in the session-file reader as today, read-only, except
   each slot renders as a comment box. A general comment box always sits at
   the bottom, provided by the UI, so overall reactions ("this is all too
   detailed") have somewhere to land without the model having to remember
   to ask. The boxes are the tab only. In the right rail the same round
   opens read-only, because a paragraph cannot be written in a third of the
   window: a banner at the head of the pane says "Open in a tab to write",
   each slot becomes a row that shows the question and opens that tab, and
   the file's row in the tree carries a pencil while the session waits.
4. **Send** ends the round. Answers reach the parked tool as one typed
   payload. The session writes `round-2.md` and parks again, or closes by
   proposing the artifacts: story cards, outbound Jira issues, a note.
   Rounds are new files every time; history stays browsable in the rail.

A brainstorm that ends in a brainstorm failed. The skill says so.

## Slots

A slot is a fenced block the model writes where it wants your take:

    ```slot idea-3
    Keep? Cut? Smaller?
    ```

The fence degrades harmlessly in any other renderer, the id makes answers
addressable, and fenced content is already this codebase's "not real
content" zone (the wikilink checker skips it). The reader swaps the fence
for a textarea while a comment request is pending on that file.

## Tokens: answers travel once

Your token concern, resolved by direction of travel. The model never reads
a round file back: it wrote the file (in its transcript already), and the
answers arrive ONLY as the `request_comments` tool result, compact,
`idea-3: <your text>` plus `general: <your text>`. The skill forbids
`files_read` on its own round files.

The write-back still happens, but for the human record: at Send, the host
replaces each fence in the file with your answer (`**You:** ...`, or "(no
comment)") and appends the general comment, so a round rereads later with
its answers in place. `writeSessionFile` exists for exactly this. The model
is never shown that rewrite.

After a quit, the answer replays into the session as a message, same as an
answered `ask_user`: the transcript persists, so still no file re-read.

## Rules carried over from the question card

- Parks forever, no timeout; the exits are Send, skip, and stopping the run.
- Scheduled runs refuse it: nobody is at the screen.
- Sequential execution, so a question card and a comments card can never be
  up for one session at once.
- Skipping is an instruction: pick the reasonable reading, say which, go on.

## Out of scope for v1

Per-slot affordances beyond a textarea (yes/no chips, "cut this" buttons),
multi-round diffing, sharing a round with a colleague, and borrowing this
shape for tell-qale's "what I think I heard" close. All real, all later.

**Erik:** yes sounds good
