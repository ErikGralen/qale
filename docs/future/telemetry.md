# Approval telemetry — what was there, why it went, what's left

**Status: partly cleaned up. 2026-07-28.**

## Where it came from

PLAN-V2 §4 framed the product around a single metric: *verification cost*. The idea was that if
the memory is any good, the human should spend less and less time checking what the agent
proposes, and that trend — not accuracy alone — is what tells you it's working. Kill criteria hung
off it.

So the proposal store grew a telemetry surface: how many cards were accepted vs rejected, how long
each sat before approval, and how heavily the human rewrote a card before approving it. `stats()`
computed all of it, and two screens rendered it.

## The problem

Nobody is running that experiment. The numbers went on screen anyway, and on screen they read as
trivia — a percentage and a duration with no baseline, no target, and nothing you can do about
either. "3 edited" in particular measured something real but told you nothing: a card you fixed a
typo in and a card you rewrote from scratch counted identically.

The edit metric also had a quiet cost. Every accept-with-edits ran a fake Levenshtein
(`editDistance`, an O(n) length-delta-plus-positional-mismatch proxy) whose result was written to
an `edit_distance` column and then only ever tested for `> 0`. Precision computed, stored, and
thrown away.

## What was removed

- `editDistance()` and the `edit_distance` column write path (`proposals.ts`, `proposal-store.ts`).
  The column still exists in already-created app DBs; nothing reads or writes it.
- `ProposalStats.edited` / `ProposalStatsDTO.edited`.
- The `· N edited` cell in the Inbox footer.
- The whole **Approval telemetry** section in Settings: the three stat tiles (approval rate, avg
  to approve, edited before approve), the per-kind accepted/total bars, and the `Stat` component
  they used.

Also removed earlier for the same reason — a mechanic built for a thesis nobody was testing:
**golden answers** ("Save as golden answer" / "no citations — will be flagged as inference").

## What's still there

The Inbox footer keeps a quieter line: `approval N% · ~Ns to approve · N accepted · N dismissed
all-time`. It survived because those four read as plain facts about the queue rather than as a
metric you're supposed to move. Worth deciding on separately — the case for cutting it is the same
case, just weaker.

`proposals:stats` and the `stats()` query still exist to feed that footer.

## What to clean up next

- Decide whether the Inbox footer line stays at all.
- If any of this comes back, it should come back as something you can act on — a lens over *which*
  cards get rejected or rewritten, not a scalar. Knowing that decision cards get rewritten twice as
  often as todo cards would change a skill file. Knowing "43%" changes nothing.
