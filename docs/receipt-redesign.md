# The receipt: what Qale did on its own

Date: 2026-09-08. Status: RC-1..6 BUILT 2026-09-08, full suite green (1647 tests, 12 pre-existing skips), not live-verified, not committed. Notes at the bottom.

Trigger: since FA-1 (docs/fewer-approvals.md) todos, meeting pages and document appends land
without a card. The receipt block in the chat is now the only place the PM sees that Qale made
a commitment in their name. Erik wants it redesigned, with what Qale created on its own at the
top (todos above all) and the memory writes out of the way.

## What the block does today

FA-4 built one block per turn, above the turn's closing sentences
(`SessionView.tsx` `ReceiptBlock`, `components/review/LandedRows.tsx`, `lib/receipt-block.ts`).
In order: the parked question, one row per landed write, then the waiting cards and, once they
are judged, the approval receipt. Each landed row is the card row: a glyph, a lead-in word
(New, Changed, Done, Removed), the page's title as a link, a change line, Put back, and the
diff behind a chevron. "Put this turn back" sits at the foot.

Four things are wrong with it for the job it now has.

1. **Every write weighs the same.** The rows draw in the order the tools ran. On the Nordkap
   transcript that is about eleven rows: five todos, one meeting page, and three to five memory
   writes (decisions, a hub edit, an insight, people). The todo the PM never promised sits
   between a person page and a decision, in the same chrome, with the same lead-in "New".
2. **A todo row does not say the three things the PM checks.** The change line says "to-do,
   due 11 Sep" or "waiting on Åsa". It never says "you" for the PM's own, and it does not carry
   the "Qale heard this" mark that the Todos view and Home show for an inferred todo (FA-7).
   `AppliedRow` has no field for it. The one place a wrong todo is cheapest to catch is the
   one place that does not say it was heard.
3. **Two receipts, two vocabularies.** A landed write says New / Changed / Done / Removed in a
   row. An approved card says Created / Updated / Decided / Sent / Deleted in a two-column list
   (`Receipt.tsx` `ReceiptLines`), with no change line, no diff and no put-back. RR-3 made every
   card one row shape. The receipt did not follow.
4. **Memory writes get rows they do not need.** A decision, a hub edit or a person page is
   Qale's own record. It lands, Activity keeps it, and a wrong one is superseded or put back
   from Activity. In the chat it only has to be findable. Today each one is a full row with
   controls.

Nothing here is live-verified. FA-4 was checked by tests and by reading.

## Decisions

**Order and weight by sphere, not by time.** The block groups the turn's writes by what they
change for the PM, in this order: Todos, Meeting, Documents, Memory. The first three are the
PM's sphere and draw full rows. Memory draws as one line. Inside a group, the order the writes
landed. The group words are the sidebar's own words, so no new vocabulary.

**A todo row says who, when, and whether Qale heard it.** The lead-in is "New todo", "Todo
changed" or "Todo done". The change line is the owner first ("you" or the person's name), then
the due day, then the mark: "you · due Fri · Qale heard this". The mark is the same string the
Todos view uses (`INFERRED_TODO_MARK`), so the three surfaces cannot drift. An undated todo says
"no date", because an unnoticed "someday" is the way a promise gets lost.

**One vocabulary, one row.** An approved card is a landed write from the moment it is approved.
When the PM judges the last card, the rows that were waiting draw as landed rows, in the same
groups, with the same change line, diff and put-back. `ReceiptLines` and its five verbs go. The
closing beat keeps its mark, its tally ("Approved 2, discarded 1") and its door; only the list
under it changes shape. This needs the approve path to leave an Activity row (see RC-4), which
it does not today: `acceptProposal` from the UI records nothing, so an approved write cannot be
put back from the chat or from Activity.

**Memory is one line.** "Memory: [H2 order: swaps first] · [Nordkap] · [Åsa Lind] · 2 more",
muted, each title a link, with a chevron. Open, it draws the same rows as the other groups,
with Put back on each. When a turn wrote only to the memory, the block is that one line and
nothing else. "Put this turn back" still covers every row, open or folded.

**Per turn stays.** One block per turn, above that turn's sentences. A session with three turns
has three blocks, and each says what that turn did. A session-wide ledger is Activity.

**The reply does not change.** The preamble already says the writes are listed above the reply
and the reply must not repeat them. The example reply in SHARED_PREAMBLE still says "put the
rest up for review", which is rare since FA-1; RC-6 corrects the example, nothing more.

## The block, after

The Nordkap transcript, one turn:

```
Todos
  ☐  Send Nordkap the SSO dates        you · due Fri · Qale heard this          Put back  ⌄
  ☐  Scope the pilot                   Åsa Lind · no date · Qale heard this     Put back  ⌄
  ☑  Confirm the SCIM date             Tom Berg · done                          Put back  ⌄
Meeting
  ▤  Nordkap check-in 4 Sep            Summary, 3 Next steps                    Put back  ⌄
Documents
  ▤  Rollout runbook                   one line under Entra                     Put back  ⌄
Memory: SCIM ships in Q2 · Nordkap · Åsa Lind                                             ⌄
                                                                        Put this turn back
```

Then the agent's two sentences on what the meeting meant.

The H2 steering batch: one Memory line, two sends waiting under it in `SessionReview` as
today. After the PM approves both: the two sends draw as "Sent" rows under a "Sent" group, the
tally reads "Approved 2", and the door points at Sessions if another session has cards.

Rules the sketch keeps from RR-3 and FA-4: the change is always on screen, the diff sits behind
the chevron, a group heading is not a cursor stop, every row is, and a send keeps its full text
behind the chevron because it cannot be taken back.

## Tickets

**RC-1 Group and order the block.** `lib/receipt-block.ts`: `blockRows` groups landed rows into
Todos, Meeting, Documents, Memory by the target path (`todos/`, `meetings/`, `notes/`, the rest)
and orders the groups that way. `LandedRows.tsx` draws a muted group word over each group and
the Memory group as one folded line (titles as links, "N more" past four, chevron opens the
rows). A turn that wrote only to the memory draws the line alone. "Put this turn back" covers
folded rows. Tests: grouping by path, order, the fold's count, the memory-only case.
Decision: build (Erik, 2026-09-08).

**RC-2 The todo row.** `AppliedRow` gains `inferred?: boolean`, set in `appliedRowFor`
(`proposals.ts`) from the payload's `inference`. `changeLine` for a todo says owner first ("you"
when the todo has no owner or the owner is the PM), then "due <day>" or "no date", then the mark
from `INFERRED_TODO_MARK`. `appliedVerb` returns "New todo" / "Todo changed" / "Todo done" for a
todo target so the lead-in names the kind. The row's glyph is the checkbox the Todos view uses,
checked for "Todo done". Tests in `change-line.test.ts` for the four owner and date cases and
the mark.
Decision: build (Erik, 2026-09-08).

**RC-3 Approved cards become landed rows.** `SessionReview.tsx`: once every card is judged, the
accepted cards draw through `LandedRows` in the RC-1 groups, with a "Sent" group for outbound
(the outbound receipt sentence as the change line, the message behind the chevron, no put-back).
The tally and the door stay above and below. `receiptEntry`, `ReceiptEntry` and `ReceiptLines`
are deleted. `receiptOf` returns `AppliedRow`s, built the same way `appliedRowFor` builds them.
Tests: the verb and change line per kind, the door count unchanged.
Decision: build (Erik, 2026-09-08).

**RC-4 An approved write leaves an Activity row.** `acceptProposal` reached from the UI's
approve records an Activity row with the reason "you approved it", so the chat and Activity can
put it back with the one existing `activity:revert`. A send records no row (nothing to put
back). Tests: approve then revert; a send leaves no row.
Decision: build (Erik, 2026-09-08).

**RC-5 Old sessions.** A row from before FA-4 has no fields, so RC-1 cannot place it by path. It
draws in a last group with no word over it, as today, with no controls. No new work beyond a
test that the fallback still draws.
Decision: build (Erik, 2026-09-08).

**RC-6 The example reply.** SHARED_PREAMBLE's closing-sentence example says "I updated the
memory and put the rest up for review". Replace with one that fits the two spheres after FA-1:
"I filed three todos and the meeting page; the rest went into the memory." One string, and the
`instructions.test.ts` assertion that reads it.
Decision: build (Erik, 2026-09-08).

Order: RC-2, RC-1, RC-6 first (the ask: todos on top, said properly). RC-4 before RC-3, because
RC-3 draws a put-back it cannot honour without RC-4. RC-5 last.

## Rejected

- **Reassign, re-date or drop controls on the todo row.** Three more buttons on every row for
  the one row in five that is wrong. The title opens the todo, and the Todos view has the
  controls. Put back covers "there was never such a promise" for an inferred todo, because FA-7
  makes that a file delete.
- **A session-wide receipt in place of the per-turn block.** Activity is that ledger. A second
  one in the chat would say the same rows twice.
- **Hiding the memory line when the turn also wrote todos.** The line is one row of muted links.
  Dropping it makes a decision Qale recorded invisible in the chat, and a wrong decision is
  the thing the PM most wants to catch after a wrong todo.
- **Counts in the group words ("3 todos").** The rows are the count. A number over three rows
  says nothing the eye did not already get.
- **A row for a write that failed.** The trail shows a failed step, and a failed write changes
  nothing for the PM. Left open below rather than built.

## Open

- A failed write into the PM's sphere (a todo that would not file) leaves no trace outside the
  trail. Whether that deserves a quiet row is undecided.
- `applyAndRecord` (the MCP `log_decision` path) still returns no receipt the chat reads (FA-4
  note). It would draw in the Memory line if it did. Not part of this plan.

## Verification

Unit tests beside `receipt-block.test.ts` and `change-line.test.ts` for each ticket. Then the
Nordkap transcript through the real app on a scratch userData (the session UI screenshot
recipe), looked at: the group order, the todo lines, the folded memory line, and the approved
block after judging the H2 sends. `pnpm test` and `pnpm check-types` from the root. Copy per
CLAUDE.md: STE, Zinsser, no em dashes.

## Notes

(Each ticket's builder appends what they did, what they checked and what they left.)

### RC-6

Built 2026-09-08. Both spots in the same SHARED_PREAMBLE bullet in `packages/agent/src/prompts.ts`
now read "I filed three todos and the meeting page; the rest went into the memory." Nothing else in
the prompt moved. No test asserted on the old sentence, so none changed. The only other places that
still say "up for review" are `docs/fewer-approvals.md:206` and this doc, both describing the old
behaviour. Checked: `pnpm --filter @qale/agent test`, 367 tests, 367 pass, 0 fail.

### RC-2

Built 2026-09-08. `AppliedVerb` gained "New todo", "Todo changed" and "Todo done"; `appliedVerb`
returns them when the target sits in `todos/`, decided by the folder because an update's payload
carries only the keys it sets. A deleted todo still reads "Removed". `changeLine` for a todo says
the owner first ("you" when the frontmatter has none), then "due 11 Sep" or "no date", then
`INFERRED_TODO_MARK` when the row is inferred, joined with " · ". A close says "Tom Berg · done".
One deviation from the sketch: an update that drops a todo says "you · dropped", because calling a
dropped promise done is not true. A field move keeps its wording behind the owner ("you · due moved
12 to 24 Sep"), and the `owner` field phrase is skipped on a todo update so the name is not said
twice. `ChangeLineInput` and `AppliedRow` both gained `inferred?: boolean`; `appliedRowLine` packs
it only when true and `readAppliedRow` reads it back. `appliedRowFor` reads `rec.inference` off the
record. `LandedRow` draws the Todos view's checkbox for a todo row, filled for "Todo done"; nothing
else in that file moved.

Checked: domain 303 pass, application 313 pass, desktop 477 pass, agent 367 pass, 0 fail each;
`pnpm check-types` 11 of 11. New tests in `change-line.test.ts` (owner and date cases, the mark,
done and dropped, a verb per kind) and a round-trip for `inferred` in `activity-receipt.test.ts`.
Not run in the app.

### RC-4

Built 2026-09-08. `approveProposal(ctx, id, edited?)` in `packages/application/src/use-cases/proposals.ts`
sits beside `acceptProposal`: it reads the card, accepts it, and records the Activity row through
the existing `recordActivity`. `fileProposal` and `applyAndRecord` still call the bare
`acceptProposal`, so nothing records twice. A send records nothing. The reason is one exported
string, `APPROVED_REASON` ("You approved it.") in `policy.ts` beside `SEND_WAITS_REASON`. The line
is `activityLine`, unchanged, so an approved write reads like a silent one and only the reason
differs. `recordActivity` now says `restore` for a delete card as well as an update; that branch
had never run because deletes always waited. `AcceptResult`, the `proposals:accept` IPC result and
the renderer's `acceptProposal` gained an optional `activityId`, filled only by `approveProposal`.
The `proposals:accept` handler calls `approveProposal`.

Checked: `approve-proposal.test.ts` (7 tests: note, update, decision and delete each leave one row
with the reason, the commit and the right undo; a send leaves none; a failed apply leaves none; the
silent path still records exactly one) and `restore-version.test.ts` (an approved note put back is
gone, an approved update goes back byte for byte). application 313, desktop 477, vault 58 (12
skipped, pre-existing), domain 303, agent 367, 0 fail; `pnpm check-types --force` 11 of 11. Not run
in the app.

### RC-1 and RC-5

Built 2026-09-08. `lib/receipt-block.ts` gained the grouping as pure functions: `LandedGroup`,
`GROUP_WORD`, `groupForRow`, `groupLanded` and `memoryFold`. The folder decides the group
(`todos/` Todos, `meetings/` Meeting, `notes/` Documents, any other path Memory, no path the last
unnamed group). Groups come back in the order Todos, Meeting, Documents, Sent, Memory, last; an
empty group is left out; inside a group the rows keep landing order. `blockRows` is untouched, so
`SessionView.tsx` did not change. RC-3's hook: `groupForRow` returns 'sent' for a verb of "Sent",
which nothing produces yet.

`LandedRows.tsx` draws each named group as a muted word over its list (`aria-labelledby`, not a
focus stop). Memory is `MemoryLine`: "Memory: " then up to four titles as links (⌘click and
middle-click open a tab), then "N more", then a chevron ("Show the memory writes" / "Hide the
memory writes") that opens the same rows through the same `drawRow`, so Put back is on each. A
memory row with no title says "a page". "Put this turn back" counts every row, folded or not,
because it works off `revertableIds(rows)`. RC-5 needed no code: a row with no path already fell
to the last group; a test pins it.

Checked: five tests added to `receipt-block.test.ts`; desktop 482 pass, 0 fail; `pnpm check-types`
11 of 11; eslint 0 errors, 34 pre-existing warnings. Not run in the app.

### RC-3

Built 2026-09-08. `AppliedVerb` gained "Sent" and `appliedVerb` returns it for an outbound card;
`changeLine` still returns nothing for one, so the row's line comes from `outboundReceipt`.
`appliedRowForCard(card, knownTitle?)` in `cardMeta.tsx` builds the same shape `appliedRowFor`
builds in the application layer, off the same payload: verb, title (the update's own retitle first,
then `cardTargetTitle`), `changeLine`, path, proposalId, inferred. It cannot fill `before`, because
the note as it read before the write is gone by the time a card is judged, so an update's line says
what moved without what it moved from. A send gets verb "Sent", the thing it touched as the title,
the receipt sentence as the change line, no path and no way back. `receiptOf` returns
`{accepted, rejected, rows}`; `receiptPaths` names the files the caller looks up. `receiptEntry`,
`ReceiptEntry`, `ReceiptLines`, `Receipt.tsx` and the dead `touched` array in `useApprovals` are gone.

Put-back survives a reopen because the activity id comes from main: `ProposalDTO` gained an optional
`activityId`, the `proposals:resolved` handler fills it through a new `ActivityPort.forProposal`
(indexed query in `ActivityStore`, newest row wins), and a row already put back is left off. Six
fake ports in the application and vault tests gained the method.

`SessionReview`'s closing branch draws `LandedRows` under the tally and above the door, with real
titles from a new `useNoteNames` hook. `LandedRows` gained `label` (null where the block already
names the list) and `turnBack` (off here, because the rows are a sitting's approvals, not one
turn's writes). A Sent row wears the send card's ink arrow. `landedPreview` returns the message
body for an outbound card, so the full text sits behind the chevron.

Checked: desktop 485 pass 0 fail (7 new tests), domain 303, application 313, vault 58 pass with the
12 pre-existing skips; `pnpm check-types` 11 of 11; eslint 0 errors, 34 pre-existing warnings. Not
run in the app.

## Thinned to lines (2026-09-08, later the same day)

Erik saw the built block in the app and it was worse: the landed rows wore the same chrome as an
approval card, the same to-do drew twice (once in the turn, once under "Approved 2"), and the
tally and the "3 more waiting in Sessions" door added weight to something that is not a decision.
His rule: a landed write is a small line, "New todo: ABC", "Todo changed: XYZ · you · due moved
12 to 24 Sep", expandable, and nothing more.

What changed:

- **One line per write.** `LandedRows` draws each write as one muted line: the verb, the title as
  a link, the change line after a middle dot, and a small chevron. Open, it shows the diff and the
  Put back button. No group words, no memory fold, no checkbox or type glyph, no card surface.
  The order by sphere stays (`orderLanded`: todos, meeting, documents, sent, memory, then rows
  with no path). `GROUP_WORD`, `groupLanded`, `memoryFold`, `revertableIds`, `putTurnBack` and
  `turnBackMessage` are gone, and so is "Put this turn back": each line has its own way back.
- **No tally, no door.** Once every card is judged, `SessionReview` draws only the approved
  cards as the same lines, under the review ask if there is one. `receiptSummary` and
  `waitingElsewhere` are deleted. What waits in other sessions is Home's job.
- **A silent write is not an approval.** A write that landed on its own is an accepted card in
  the store, so `receiptOf` counted it and drew it a second time under "Approved N". The
  `proposals:resolved` handler now reads the write's Activity row and marks the card
  `silent: true` when the row's reason is not `APPROVED_REASON`; `receiptOf` and
  `receiptPaths` leave those out. A card approved before RC-4 has no row and still counts.

Checked: `pnpm check-types` 11 of 11, `pnpm test` green in every package (desktop 478), eslint 0
errors on the touched files. Not run in the app.

Two more cuts the same evening, after Erik saw the lines: the to-do line no longer ends in
"Qale heard this" (noise on a receipt; the Todos view keeps the mark), so `todoLine` takes no
`inferred` and `AppliedRow.inferred` / `ChangeLineInput.inferred` are gone. And the control is
"Undo", not "Put back", on the receipt line and in Activity, with "Undone" as the state and the
toasts and errors reworded to match. A session recorded before this keeps the old change line
in its transcript, because the line is packed into the tool result at write time.
