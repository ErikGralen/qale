# Iterate: implementation tickets

The design is docs/brainstorm-skill.md. Build in this order; IT-1..3 are the
spine, the rest hang off it.

## IT-1: slot parsing

A shared helper that finds ` ```slot <id> ` fences in markdown and returns
`{id, prompt, range}` per slot. Rejects duplicate ids. Lives where both the
agent package (validation) and the renderer (drawing) can reach it.

## IT-2: the `request_comments` tool

In `packages/agent`, beside `ask.ts` and shaped like it: pure planning +
validation, then park on `AskParking`.

- Takes `path`. Validates: the file exists in this session's folder, is
  markdown, has at least one slot. Errors return as tool text, never a
  thrown turn.
- Parks with a new request kind carrying `path` and the slot list. Same
  fail-closed rule as `ask_user` on scheduled runs, same offered/owed
  stamp, same derived id so a double Send settles once.
- Resolves with `{answers: {slotId: text}, general?: text}` or a dismissal.
  The tool result renders answers compactly and repeats the "act on this
  now" coda. The replay prompt covers the answered-after-quit path.

## IT-3: the renderer side

- The "waiting for you" card in the session view: "Waiting for you to fill
  out round-1.md", opens the doc. Same surfaces as the question card.
- `SessionFileReader`: while a comment request is pending on this file,
  slot fences render as textareas, a general comment box sits at the
  bottom, and a Send button submits the lot over IPC. Otherwise the file
  renders as today.
- The read-only strip on a pending file says "waiting for your comments"
  instead of "read-only".

## IT-4: write-back at Send

Host-side, at resolve time: replace each fence with `**You:** <text>` (or
"(no comment)"), append the general comment under a heading, write with
`writeSessionFile`. The model is not shown the rewrite.

## IT-5: the skill file

`skills/iterate/SKILL.md`, in defaults.ts AND vault-dev (they move
together). Title "Iterate on something", the scenarios from the design doc,
and the loop rules: framing plus rough ideas in round one, honest costs, new
file per round (`round-N.md`), never `files_read` your own rounds, never
`ask_user`, end with artifacts.

## IT-6: telemetry and registration

Add `iterate` to KNOWN_SKILLS (the sweep bug: forgetting this counts it as
custom). An event for a sent round, with the session's view context stamp
like every other event.

## IT-7: demo

A vault-dev epic worth breaking down, so the demo runs: pick the epic,
round one with slots, Send, story cards against Jira. Check the refresh-demo
wikilink pass still skips slot fences (it strips fenced blocks already).

## IT-8: tests

- planning/validation table tests beside `ask.ts`'s (bad path, no slots,
  duplicate ids, scheduled refusal)
- park → Send → tool result round-trip, and the quit → replay path
- write-back formatting
- slot parser edge cases (nested fences, unclosed fence)
