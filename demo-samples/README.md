# Demo samples

Material to feed into a running demo. These files live outside the vault on purpose: they are
things you drop or paste in during a demo, not notes that get seeded and indexed ahead of time.
They are dated on the same anchor timeline as `vault-dev/` (2026-07-17), so `pnpm refresh-demo`
keeps them in step with the vault instead of going stale.

The cast they mention (Rota, Café Nord, Bruno's Burgers, Fjord Sports, Åsa, Rebecca, Marcus, Jonas,
Petra) already lives in the demo vault, so the agent's proposals land on real hubs: the actual
Café Nord customer page, the real `SCH-231` and `SCH-118` epics, existing todos, rather than
creating things that float free.

## Setup

```sh
pnpm refresh-demo        # rebuild .vault-dev dated to today (see /update-demo)
pnpm desktop             # then open the .vault-dev workspace
```

## The pack

| File                          | The door                                   | Runs as               |
| ------------------------------ | ------------------------------------------- | ---------------------- |
| `steering-h2-priorities.vtt`   | Drop it on the window                       | Flow 1 (a meeting you were in) |
| `support-thread-brunos.md`     | Paste it into Home's bar                    | Flow 3 (a pasted source) |
| `chat-prompts.md`              | n/a — type these into Ask or a chat         | Flow 2 and Flow 4 prompts |

Dropping or pasting starts (or adds to) the `arrival` session: the one place new material lands,
reads itself, and works out where it belongs. Nothing is pre-filed; that reading is the point.

### Flow 1: the meeting produced actions

Drop `steering-h2-priorities.vtt` on the window. It is a Teams-style transcript of last Thursday's
steering meeting, roughly 25 minutes, Åsa, Rebecca, Marcus and me. `arrival` recognizes it as a
meeting I was in and reads it start to finish. What comes back as proposals:

- **A meeting page**, with participants and a summary.
- **A decision.** Åsa flips the H2 order: shift swaps ship before payroll export, which moves to
  Q1, because Café Nord and two more chains need swaps before the September staff turnover.
  It supersedes the standing "payroll export first" decision, with the reasoning and the explicit
  not-doing (offline mode, declined again, out loud, on the record).
- **Three todos with dates**: Rebecca re-estimates the last swap-approval story by next Friday
  (2026-07-24); I ping Henrik for a GDPR review of swap notifications (they show colleagues' names
  and phone numbers); I owe Fjord Sports an updated timeline now that payroll export has moved.
- **Three outbound cards, one at a time**: a Jira comment on `SCH-118` saying the epic slipped to
  Q1 and why, a new `SCH` story for "notify the affected colleague when a swap is approved" (raised
  in the meeting, not yet in the epic), and a Confluence patch to the Roadmap H2 page swapping the
  two priority lines.

Nobody in the meeting wrote any of this down. That is the point of dropping it in.

### Flow 3: the support thread

Paste `support-thread-brunos.md` into Home's bar. It is a `#support` Slack export from March: a
Bruno's Burgers manager tells Jonas that two or three staff a week want to trade shifts, she
redoes the schedule by hand every time, and asks whether Rota will ever let staff swap shifts
themselves. Jonas says he'll ask product. The thread ends there, unresolved, for four months.
The paste clears the long-paste threshold and files as a source.

What comes back: an insight on the shift-swaps theme, with the thread as evidence and Bruno's as
the customer; an update to the Bruno's customer page; a Jira comment on `SCH-231` noting Bruno's
asked for this via support in March, with the thread linked; and a todo for Ulrika to tell Bruno's
once `SCH-231` ships.

### Flow 2 and Flow 4: chat prompts

`chat-prompts.md` is not something you ingest. It holds the Ask prompts (and their follow-ups)
for two flows that run entirely in a chat, after Flow 1 and Flow 3 have landed:

- **Flow 2** answers "when can we deliver shift swaps to Café Nord, and what have they already
  been told", citing the ticket mirror, the fresh steering decision, and Marcus's promise from the
  QBR, then drafts a reply in the sales voice.
- **Flow 4** runs once `SCH-231` is switched to its Done snapshot: "who needs to know, and what
  were they told", pulling together Bruno's (never told), Café Nord (promised at the QBR), and
  Fjord Sports (told Q4, now Q1), then drafts the messages, CS voice for the customers, one line
  for Jonas.

Type each prompt into Ask and copy the drafted replies out by hand once you're happy with them.
