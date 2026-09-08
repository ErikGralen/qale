# Fewer approvals: decide, ask, or wait

Date: 2026-09-08. Status: FA-1..8 BUILT 2026-09-08, all suites green, not live-verified, not committed. Notes at the bottom.

**One constraint above the rest.** The agent can never send anything to Jira, Confluence, a
calendar or mail on its own. A send waits for the PM every time, and no flag (`asked`, derived or
declared), no skill text and no sphere changes that. Today the only path to a send is
`acceptOutbound`, reached from `acceptProposal` after the PM approves, and the policy grades
`outbound` as waiting before it reads anything else (`policy.ts:184`). FA-1 adds a second guard in
`fileProposal` that refuses the silent branch for `outbound` whatever the ruling says, and a test
that runs `writePolicy` over every combination of facts and asserts a send never lands.

Trigger: Erik wants the agent to stop asking for approval and to ask a clarifying question
instead when something is unclear or in conflict ("You said X. That conflicts with Y. Is X the
new answer?"). Edits to meetings, documents and todos may land.

Seven subagents looked at this from different angles: where the cards come from, how a conflict
question would work, whether the undo path can carry it, how other tools do it, what the prompts
say today, todos and meeting pages, and what goes wrong. This doc is the synthesis.

## Where the cards come from today

One after-meeting session on the Nordkap demo transcript produces about seven cards and four or
five silent writes. The recorded H2 steering batch produced nine cards
(`docs/review-rework.md:3`). By kind:

| Kind | Per session | Today | Why it asks |
|---|---|---|---|
| Own todos | 3 | asks | `isTodo`, `policy.ts:193` |
| Waiting-on todos | 2 | asks | same |
| Meeting page | 1 | asks | `meetings/` is the PM's sphere |
| Document edit (`notes/`) | 0-1 | asks | `notes/` is the PM's sphere |
| Send to Jira, Confluence, calendar | 0-2 | asks | no way back |
| Decision, hub edit, insight, people | 3-5 | lands | Qale's memory |

Todos are the bulk: five of seven on Nordkap, three of nine on H2. The meeting page is one card
per transcript, every transcript. Take todos and the meeting page out and an after-meeting session
goes from seven cards to zero, plus any sends.

Three of those cards ask the PM to confirm their own words. The transcript has them saying "I'll
put it in writing this week" and the card asks whether they will. The `notes/` edit is worse: the
PM said "that goes straight into the rollout notes" out loud, and the policy still asks, because
`asked` is only set from the chat and no skill sets it from a transcript.

## The rule

Every write gets one of three answers. The words already exist in the product: a write **lands**,
a write **waits** (a card), and the agent **asks** (a question).

**Lands.** Anything the source says and nothing in the workspace disputes. That now includes:

- A new meeting page from a transcript, summary included. Every line of it cites a source the PM
  handed over, and `## Notes` stays theirs.
- A todo, own or waiting-on. The ledger is a list Qale keeps for the PM. Nothing leaves the
  machine and nobody else sees it.
- An append to a document or a meeting page, and a new document.
- Everything that lands today.

**Asks.** A fact the agent is about to write disagrees with what the workspace holds, or with what
the PM said. The question names both sides, offers the two answers as options, and the write that
follows carries `asked` and lands. The question comes before the write, never after.

**Waits.** Three things, and only these:

- A send to Jira, Confluence, a calendar or mail. No way back.
- A delete. Git can put it back now (`restore.ts:86-89`), but backlinks break the moment it lands
  and the chat line for a deletion is too quiet to carry it.
- A rewrite of prose the PM typed: a patch into a `notes/` body, or into `## Notes` on a meeting
  page. Undo makes a wrong rewording recoverable, not noticeable. A subtle change to their own
  words is the one edit the ninety-second glance misses, and a card is the right shape for a diff.

The two-sphere line stays for the sidebar. For the policy it stops deciding by folder and decides
by what the write does to text the PM wrote.

### Todos, in detail

A todo lands with `inference: true` carried into the file when the agent worked it out from a
transcript. The Todos row and the Home row show a small mark ("Qale heard this") until the PM
edits, dates or checks it. Dropping an untouched inferred todo deletes the file rather than
leaving a `dropped` row: the ledger must not remember a promise the PM says was never made.

An undated todo lands undated. `someday` is the honest lane and it bothers nobody. A todo the agent
cannot attribute does not land and does not wait either: the agent asks who owns it, in one
question for the whole batch.

Closing or re-dating a todo is the contested case. One subagent argued a wrong "done" means
someone waiting never gets the thing, and a card costs one click. The others argued a close from
the PM's own words in a transcript is the same as a close from the chat. Recommendation: it lands
when the transcript has the PM saying it, and it is a question when the agent inferred it ("Åsa
said the dates went out. Mark 'Send Nordkap the dates' done?"). See decision 1.

### Meeting pages, in detail

A new page from a transcript lands. The summary goes into `## Summary`, which is append-shaped by
the layout `defaults.ts` fixes (Prep, Notes, Summary). Participants are matched chips, fixed in a
click. Decisions inside the summary are separate `propose_decision` calls that already land. The
source flips to processed on land, as it does on approval today.

A later edit to a page the PM has written in follows the rule above: an append lands, a patch over
their text waits.

## The question

The shape, every time: what was said, what the workspace holds as a link, one question, and the
answers as options. Each option names the write it leads to.

> The steering group said SCIM ships in Q2. [[decisions/2026-04-15-defer-scim-to-q3|The April
> decision]] says Q3. Is Q2 the new plan?
> Yes, Q2 replaces it · No, Q3 stands · Not decided yet

> Johanna said she would confirm the SCIM date. [[todos/2026-07-09-tom-confirm-a-scim-date|Tom's
> to-do]] is still open. Did it move to Johanna?
> Yes, Johanna owns it now · Both are on it · Tom still owns it

> Three things I heard as commitments. "Send Nordkap the SSO dates": is that you, or Åsa?
> Mine · Åsa · Not a commitment

Most of the machinery exists. `ask_user` parks the question inside the turn and survives a quit
(`ask.ts`). `check_claims` already returns a `conflict` verdict with the quote and the path
(`claims.ts:479-497`), scoped and rationed to two questions (`claims.ts:451-463`). The
`supersedes` parameter on `propose_decision` marks the old decision. The preamble already says an
answer to `ask_user` is the PM asking (`prompts.ts:117-119`), and `fileProposal` passes `asked` to
the policy (`proposals.ts:99-104`). Nothing new in `policy.ts` or `proposals.ts` is needed for the
answer to flow.

What is missing is instruction, not machinery:

- The preamble names "two notes that contradict each other" as an ask case (`prompts.ts:121`) and
  says nothing about a new fact contradicting a note, which is the common case.
- `check_claims` only runs from the arrival and dump skills. The ask and after-meeting paths never
  check a claim, so a conflict there is noticed only if the agent happens to read the right note.
- The `ask_user` description says "blocked on a decision that is genuinely theirs". It should say:
  two readings, two candidates, or a conflict between what they said and what a note says.

Bounds, all of them already in the prompts and kept: never ask permission to proceed, never ask
which of two wordings to keep, filing and naming are the agent's, two asks per unattended run and
none on a scheduled one. One new bound: read, ask, write, in that order. A question after the
write is a card again.

## The receipt

If most writes land, the chat has to show them where the PM is looking. Today the collapsed row
says "Updated Nordkap check-in" as plain text (`SessionView.tsx:478-515`), Activity says the same
sentence, and neither has a diff or a put-back. A wrong edit is invisible until they open the
page.

The proposal: one block above the agent's closing sentences, same verb column `Receipt.tsx`
already draws for approvals, but for what landed. A question row, if there is one, sits at the
top, because it is the only thing that needs their hands.

```
Changed   Nordkap check-in 4 Sep       summary, 3 next steps
New       Send Nordkap the SSO dates   to-do, due Fri        Put back
New       Åsa: scope the pilot         waiting on Åsa        Put back
Changed   Rollout runbook              one line under Entra  Put back
Waiting   Comment on PAY-142           Approve · Discard
```

One line per row is the change, not the verb: "due moved 12 to 24 Sep", "one line under Entra".
`intent.ts` already computes this for cards. The diff sits behind the chevron, as RR-3 folded the
rationale. A landed edit and a waiting edit are the same row with different controls.

Put back lives on the row, and there is one "Put this turn back" for the session. Activity stays
the long-term ledger with the same mechanism. The six-second `UndoStrip` is wrong here: a strip
that lapses while the PM reads the wrap is worse than nothing.

## What has to hold before this is safe

The audit of the undo path found four holes. The first two are must-haves before meeting, todo
or document writes land.

1. **Undo is a whole-file snapshot.** `revertNoteChange` writes the file as it was before the
   commit (`restore.ts:108-116`). Every autosave is its own commit, so notes the PM typed after the
   agent's write are lost with the undo. Fix: revert the write's own diff against the current
   file, fall back to the snapshot only when the patch does not apply, and say so on the row.
2. **The dirty editor drops the write.** If the page is open and dirty, `NoteEditor.tsx:223-229`
   ignores the external change and the next autosave commits the stale body over it. Nothing
   tells anyone. Today the card keeps the two writers apart, because nobody approves while
   typing. Fix: re-place the editor's pending change on top of the new body. Minimum: a toast that
   says which side won.
3. **The chat cannot point at its rows.** The tool result carries "Applied:" and no activity id
   (`tools.ts:1103`), so the receipt block cannot offer put-back. Fix: return the id.
4. **Side effects have no rows.** An accept flips cited sources and meetings to `processed` in
   their own commits with no Activity row (`proposals.ts:657-687`). Putting the page back leaves
   them flipped. Fix: the page's row reverts them too.

Three guards, all context-free facts the code can check, which is where Erik's rule allows a
gate:

- **`asked` is derived, not declared.** Today `ASKED_PARAM` (`tools.ts:968`) is a boolean the
  model sets and `policy.ts:204` turns it into silent. Nothing checks it. Once todos and meeting
  pages can land on it, it is the only thing between the model and a promise in the PM's name.
  The runtime sets it: true when an `ask_user` answer or a PM turn in this session precedes the
  write, and the parameter becomes a hint the runtime confirms.
- **An assumed write waits.** Unattended rules say to write "Assumed:" into the rationale after
  the question budget is spent (`prompts.ts:417-419`). The rationale dies with the card, and a
  transcript filed against the wrong meeting is the worst outcome `docs/live-notes.md` names. A
  write whose rationale starts "Assumed:" waits, whatever the sphere.
- **Duplicates against disk.** `duplicatePending` reads pending cards only (`proposals.ts:278`)
  and `alreadyOnDisk` compares the slug (`tools.ts:1826`). Once todos land, two spawn lanes over
  two transcripts of one meeting write "Send Nordkap the pricing" and "Pricing to Nordkap". Check
  title similarity against open todos on disk, and ask when it is near but not equal.

## What changes for the PM

Nordkap, today: seven cards, one Approve all, a chat line that says the rest went up for review.

Nordkap, after: one question at the top ("'Send Nordkap the SSO dates': you, or Åsa?"), a block of
six rows that landed with Put back on each, the agent's two sentences on what the meeting meant,
and nothing to approve. H2 steering: two sends wait, seven rows landed.

## Tickets

Each ticket has a Decision field. Build only after it is filled.

**FA-1 Policy: decide by what the write does to the PM's text.** `policy.ts`: a todo lands (rule 3
goes, `asked` on a todo only clears the mark), a new meeting page lands, an append lands anywhere,
a patch into a `notes/` body or a meeting `## Notes` section waits. Needs `patchTouchesUserText`
as a fact on `WriteFacts`, computed by `fileProposal` from the placement. `USERS_SPHERE_TYPES`
stays for the sidebar. `describeWritePolicy`, Settings copy, Hello screen, PRODUCT.md, tests.
`fileProposal` refuses the silent branch for `outbound` whatever the ruling, and a test asserts
`writePolicy` never grades a send silent for any combination of facts.
Decision: build (Erik, 2026-09-08). A send waits, always.

**FA-2 Undo as a reverse patch.** `restore.ts`: apply the write's own diff in reverse against the
current file; snapshot fallback when it does not apply, said on the row. Side-effect flips get
rows or ride along. Tests with a PM edit between write and undo.
Decision: build (Erik, 2026-09-08).

**FA-3 The dirty-editor race.** `NoteEditor.tsx`: an external body change while dirty re-places
the pending edit on top instead of dropping the write. Toast when it cannot.
Decision: build (Erik, 2026-09-08).

**FA-4 The receipt block.** Tool results return the activity id. `SessionView` draws the landed
rows above the closing line with the same row component as RR-3, change line from `intent.ts`,
diff behind the chevron, Put back per row, "Put this turn back" per session. The preamble sentence
"every note you wrote is listed above your message" and this block become one component.
Decision: build (Erik, 2026-09-08).

**FA-5 `asked` is derived.** Runtime sets `asked` from the session's ask answers and PM turns; the
parameter is a hint. A write with "Assumed:" in its rationale waits. Derivation never touches
`outbound`: a send waits whatever `asked` says.
Decision: build (Erik, 2026-09-08).

**FA-6 The question, in the prompts.** SHARED_PREAMBLE gets the decide/ask/wait bullet with the
conflict shape and one example. `ask_user` description rewritten. Tool descriptions that say
"nothing lands until the PM approves" (`propose_meeting` `tools.ts:1248`, `propose_skill`
`tools.ts:2490`, `propose_instruction` `tools.ts:1908-1940`) corrected. Arrival, process-note and
librarian "## Then" sections say what lands and what waits, in `defaults.ts` and `vault-dev/`
together. The arrival skill's `check_claims` paragraph says a conflict is a question every time,
asked before either write. The after-meeting path and the ask skill get a `check_claims` call.
Every prompt and skill keeps saying that a send waits for the PM.
Decision: build (Erik, 2026-09-08).

**FA-7 Inferred todos wear a mark.** `inference` travels into the todo frontmatter. Todos and Home
rows show "Qale heard this" until touched. Dropping an untouched inferred todo deletes the file.
Decision: build (Erik, 2026-09-08).

**FA-8 Duplicates against disk.** `duplicatePending` also checks open todos on disk by title
similarity; a near match becomes a question.
Decision: build (Erik, 2026-09-08).

Order: FA-2 and FA-3 first, because FA-1 is unsafe without them. Then FA-5, FA-1, FA-6 together.
FA-4 makes it visible. FA-7 and FA-8 finish todos.

## Decisions

Erik took the recommendations on 2026-09-08.

1. **Closing or re-dating a todo.** Lands when the transcript has the PM saying it, a question when
   inferred. The alternative (always a card) was rejected.
2. **A rewrite of the PM's own prose stays a card.** The alternative is a question ("Rewrite the
   second paragraph of the runbook?"), which is a card with worse controls.
3. **Delete keeps asking** though git can undelete now, for the backlinks.
4. **Waiting-on todos land.** A claim about someone else's promise, but nobody else sees it.
5. **A send never lands.** Stated above the tickets. Not a decision to revisit.

## Rejected

- **A per-session trust switch** ("this session may write anywhere"). Claude Code's auto-accept.
  Fails the ninety-second test: the PM has to remember which mode is on, and one mode covers a
  send and a typo fix alike.
- **A diff in the chat for every landed edit.** A PM reading "Rebecca Holm · owns the rollout"
  already knows if that is wrong. The diff sits one chevron away.
- **The six-second undo strip for a session's writes.** A session is not one click.
- **A curiosity pass that hunts for conflicts.** The conflict is noticed at write time, by the
  agent that is about to write, from what it read. No new agent.

## Notes

Each ticket's builder appended what they did, what they checked and what they left. Built 2026-09-08 by eight Opus subagents in three waves (FA-2/3/7, then FA-1/5/6, then FA-4/8). Full run afterwards from the repo root: domain 298, sessions 53, markdown 6, connectors 62, application 306, agent 367, vault 56 (12 skipped, the known better-sqlite3 ABI ones), desktop 477: 1625 pass, 0 fail. `pnpm check-types` 11 of 11. Nothing committed, nothing live-verified in the app.

One fix outside the tickets: the librarian agent said a repair to a document lands, and FA-1 makes a patch into a `notes/` body wait. Both copies (defaults.ts and vault-dev) now say a repair inside a document the PM wrote waits, and the arrival skill says "one write" where it said "one proposal".

### FA-1

The policy now decides by what a write does, not by which folder it lands in. Four writes wait: a
send, a delete, anything Qale assumed, and a patch over prose the PM typed. Everything else lands,
including a meeting page from a transcript and every todo.

**What I built**

`packages/domain/src/proposals/policy.ts`

- Two new `WriteFacts` fields: `rewritesUserText` (a patch into a `notes/` body, or into the
  `## Notes` section of a meeting page) and `assumed` (the rationale says "Assumed:").
- `rulingThatWaits`, first match wins: outbound, delete, `assumed`, then `rewritesUserText` unless
  `asked`. `rulingThatLands` takes the rest: rule files, `asked`, todos, new pages, appends,
  updates, decisions, and the ungraded-kind fallback that still asks.
- Rule 3 (`isTodo` asks) is gone. `asked` no longer changes a todo's answer either way. I did not
  touch the FA-7 inference mark.
- `SEND_WAITS_REASON` is now an exported constant, because two pieces of code say that sentence:
  the rule, and the guard in `fileProposal`. Re-exported from `packages/domain/src/proposals/index.ts`.
- `isUsersSphere`, `USERS_SPHERE_DIRS`, `USERS_SPHERE_TYPES` stay exported, with a comment saying
  the policy no longer reads them. Nothing in the app imports them today; the sidebar draws the
  same line in its own `surfaceForType`.
- `describeWritePolicy()` rewritten to two blocks: `place: 'lands'` ("What lands", 9 rows plus the
  two machinery rows) and `place: 'waits'` ("What waits for you", 4 rows). Every row still asks
  `writePolicy` with real facts, and each row's facts match the words beside it.

`packages/application/src/use-cases/proposals.ts`

- `fileProposal` computes both new facts itself. No tool call site needs a new argument.
- `rewritesUserText(ctx, input)`: only an update with at least one patch block counts. A `notes/`
  path is true whatever section it hits. A `meetings/` path reads the note and asks whether any
  patch anchor falls inside `## Notes`, with whitespace flattened on both sides so the anchor drift
  `applyPatch` tolerates is read the same way. A frontmatter-only change, an append, a retitle and
  an unreadable page all answer false.
- `usersSectionOfMeeting(body)`: the lines under `## Notes` up to the next heading at the same
  level or higher. Exported next to it, so it can be tested and reused.
- `isAssumed(rationale)`: any line that starts "Assumed:" (case-insensitive). The unattended rules
  ask for a line in the rationale, not for an opening, so I match any line.
- The guard: `if (ruling.disposition !== 'silent' || input.kind === 'outbound')` returns a waiting
  card, and on the guarded path the reason is `SEND_WAITS_REASON`, never the wrong ruling's
  "this landed" line.

**Copy**

- `apps/desktop/src/renderer/src/components/WritePolicySetting.tsx`: new description sentence, and
  the per-answer heading is drawn only when a block holds both answers (each block holds one now,
  so "Lands, listed in Activity" under "What lands" would say one thing twice).
- `apps/desktop/src/renderer/src/onboarding/screens/Hello.tsx`: the paragraph now says most writes
  land and names the four that wait.
- `apps/desktop/PRODUCT.md`: Product Purpose, "A session holds what needs a decision", "A write
  waits for the PO when it changes their words or cannot be taken back" (renamed from "when it is
  theirs to make"), and "Nothing lands unseen". "A send and a delete wait everywhere" is kept.
- Comment pointers moved from `docs/review-rework.md RR-1` to `docs/fewer-approvals.md FA-1` in the
  files I own, plus `write-policy-copy.ts` where the doc comment said "sphere".

**Tests**

- `packages/domain/test/write-policy.test.ts` rewritten to the new rulings, including a
  property-style test over 5 kinds x 7 note types x 6 paths x `asked` x `appendOnly` x
  `rewritesUserText` x `assumed` (3360 combinations). It asserts outbound and delete are never
  silent, and that every ruling ends in a sentence.
- `packages/application/test/file-proposal.test.ts`: todo lands; write-up appended to a meeting page
  lands; a patch into a meeting's `## Notes` waits; a patch into `## Summary` lands; a patch into a
  document waits and an append to it lands; a rewrite the PM asked for lands; an "Assumed:"
  rationale waits; a send waits and writes nothing.
- `packages/application/test/outbound-guard.test.ts` (new): stubs `@qale/domain`'s `writePolicy`
  with one that says every write lands, and asserts a send still comes back waiting, never applies,
  and carries the send sentence. This needs module mocking, so I added
  `--experimental-test-module-mocks --disable-warning=ExperimentalWarning` to the `test` script in
  `packages/application/package.json`, the same flags `@qale/desktop` already uses.
- `apps/desktop/test/write-policy-copy.test.ts`: places are now `lands`/`waits`, and each block has
  one group.

**Agent tests I updated, and why**

Ten agent tests failed only because the policy changed as specified. All ten were expectations that
a write waits.

- `packages/agent/test/tools.test.ts`: three meeting-page assertions, three todo assertions and the
  append test now expect "Applied: ...". The append test also grew the case it was missing: a patch
  over the PM's lines under `## Notes` waits.
- `packages/agent/test/withdraw.test.ts`: the withdraw tests ran on todos, which land now, so there
  was nothing pending to withdraw. They run on a patch over a `notes/` document instead, which is a
  write that still waits. The fake context gained a `readNote`.

**Checked, with output**

- `pnpm --filter @qale/domain test`: 287 tests, 287 pass, 0 fail.
- `pnpm --filter @qale/application test`: 292 tests, 292 pass, 0 fail.
- `pnpm --filter @qale/agent test`: 360 tests, 360 pass, 0 fail.
- `pnpm --filter @qale/desktop test`: 465 tests, 465 pass, 0 fail.
- `pnpm check-types`: 11 tasks successful, 0 cached (a forced re-run, so nothing was replayed).
- `pnpm lint`: 0 errors, 34 pre-existing react-refresh warnings.
- `npx prettier --check` on every file I touched: clean.

**What I left**

- Not committed, as asked. The app was not launched, so none of this is live-verified.
- `tools.ts` needed no change: `propose_update`'s description already says an append lands and a
  patch over the PM's prose waits, so another agent aligned it before me.
- `assumed` makes any write wait, in every folder, and `asked` does not clear it. Only
  `rewritesUserText` has the `asked` exception. That is what the spec's ordering asks for.
- `isUsersSphere` and the two sphere constants now have no reader outside the policy file and its
  tests. They are kept exported per the ticket.
- `describeWritePolicy` no longer has a block with two answers, so `DISPOSITION_WORDS` is not drawn
  on screen today. It still drives the grouping and the desktop test, and it comes back the moment a
  block holds both answers.


### FA-2

The undo now takes out the change's own lines instead of writing the whole file
back, and it puts the read marks back with the page.

**Undo as a reverse patch** (`packages/application/src/use-cases/restore.ts`).
`revertNoteChange` reads three things per path: the file at `hash^`, the file at
`hash`, and the file as it reads now. If the current file is what the change
left, the old file goes back as before. If somebody wrote after the change, the
change's own diff is turned around and placed with `applyPatch`, the same
placement an update card gets. Search text is what the change wrote, replacement
is what stood there, three lines of context each side, runs closer than that
merged into one block so a later block never anchors on text an earlier one
rewrote. `applyPatch` refuses an anchor that is gone or appears twice, and then
the whole file goes back and `method` says `snapshot`. The line comparison is a
small longest-common-subsequence pass over the lines that differ after the shared
head and tail are matched, capped at 1000 changed lines. No new diff engine
beyond that: `applyPatch` and `fuzzyReplace` are reused as they are.

`RevertResult` and `RevertResultDTO` gained `method: 'patch' | 'snapshot'`.
`revertActivity` in `app-state.tsx` now answers with the result, and
`ActivityView` toasts on a snapshot: "Put back as a whole page. Anything you
wrote after this went with it." A clean patch says nothing new; the row already
turns to "Put back". The four old outcomes are unchanged.

**Side effects ride along.** I made the page's undo revert the flips rather than
give them rows of their own. It is the simpler of the two: the flip commit
carries no id anybody holds, so a row would have to be written at accept time in
`proposals.ts`, and the PM would then have two rows for one act. `putReadMarksBack`
reads the reverted page as it stood at `hash` for its `evidence`, `sources` and
`transcript` refs, plus the card's evidence when the Activity row names a card
(`proposalId` added to `RevertChangeInput` and to the `activity:revert` handler).
For each source or meeting it only moves `processing`, and only when the file
said `new` or `stale` at the moment the change landed, so a source the PM marked
read themselves is left alone. The flips go into the undo's own commit. It is
best-effort with a log line, like the flip on the way in.

**Checked, with output.**

- `pnpm --filter @qale/application test`: 274 pass, 0 fail. Includes the new
  `test/reverse-patch.test.ts` (8 cases: one change out, two changes far apart,
  an added line, a removed line, no anchor, an ambiguous anchor, no difference,
  a properties-block change).
- `pnpm --filter @qale/vault test`: 56 pass, 0 fail, 12 skipped. The skips are
  the known better-sqlite3 ABI ones and predate this. `test/restore-version.test.ts`
  is 16/16, five of them new: a PM edit elsewhere in the file survives, a
  frontmatter-only change comes out without touching a paragraph written since,
  the snapshot fallback reports `snapshot` and writes the old file, a cited
  transcript goes back to `new` in the undo's own commit, and a source the PM had
  already marked read is untouched.
- `pnpm --filter @qale/desktop test`: 461 pass, 0 fail.
- `pnpm check-types` from the root: 11 tasks, 11 successful.
- `pnpm lint`: 0 errors, 34 warnings, all the pre-existing react-refresh ones.

One thing worth saying plainly: the first desktop run failed with one assertion
at 459 tests, then passed twice at 461. Another agent was editing desktop tests
while I ran it. Nothing I changed is in that file set beyond `ActivityView.tsx`
and `app-state.tsx`, and both later runs were clean.

**Left.**

- The revert tests live in `packages/vault/test/restore-version.test.ts`, not
  `packages/application/test`, because they need a real repo and that is where
  the four existing cases already were. The text arithmetic has its own unit test
  in `packages/application/test`.
- `activity:revert` still pushes `vault:changed` for the page only. A source that
  went back to unread reaches the lists through the file watcher, half a second
  later.
- A narrow wrong case: if a page cites a source that was still `new` when the
  page was written, and something else marked it read later, this undo flips it
  back. The mark is one click to redo and there is no record that says which
  accept set it.
- FA-3 (the dirty editor) is untouched, as agreed. Until it lands, a page open
  and dirty can still commit a stale body over the undo.
- Not live-verified in the app, not committed.


### FA-3

The dirty editor no longer drops an external write. When the file changes under an
editor with unsaved keystrokes, the PM's pending edit is re-placed on top of the new
body. Only when the two touch the same lines does the PM's text stand alone, and then
a toast says so.

**What I built**

New file `apps/desktop/src/renderer/src/lib/merge-body.ts`:

- `resolveExternalChange({ base, mine, theirs })` returns one of three outcomes:
  `replace` (nothing unsaved, or the unsaved text already equals one side),
  `merged` (both edits fit), `kept` (they clash, the PM wins).
- `mergeBody(base, mine, theirs)` is the merge. It reads each side as a list of
  changes against the base (a run of base lines replaced by new lines), built from a
  line-level longest common subsequence. Changes in different places all land. Two
  changes over the same base lines, or two blocks added at the same point, return
  null. Trailing newlines are not treated as an edit. Texts over 250k line-pairs
  refuse rather than run.
- `EXTERNAL_CHANGE_KEPT` is the toast copy: "Qale changed this page while you were
  typing. Your text is kept. Its change is in Version history." "Version history" is
  what the note's own menu calls it (`NoteView.tsx:631`). It fires only on a clash;
  a merge that worked says nothing.
- `sameBody` moved here from `NoteEditor.tsx` so there is one copy.

`NoteEditor.tsx`:

- New `baseMd` ref holds the body the editor loaded, in the editor's own markdown.
  Set in `onCreate`, on every flush (what we wrote is the next base), rolled back
  with `lastSaved` when a save fails, and set to the incoming body after a merge.
- `serializeBody()` runs the incoming body through the editor's own parse and
  serialize before merging. Without it the agent's dialect (hard wraps, bullet
  characters, blank-line counts) reads as an edit on every line and every merge
  refuses.
- `replaceDoc()` replaces only the top-level blocks that differ, matching blocks at
  the head and the tail untouched, then maps the selection through the transaction
  (`TextSelection.between`). A caret outside the changed part keeps its exact place;
  a caret inside lands at the end of the changed part. `preventUpdate` and
  `addToHistory` are set, so the dirty flag and the save timer stay the caller's.
  It falls back to `setContent` if the narrow replace is refused.
- The external-change effect no longer returns early on `dirty`. It hands the three
  texts to `resolveExternalChange` and applies the answer; `merged` keeps the note
  dirty and re-arms the 1.5s autosave, so the merged text lands.

**Tests**: `apps/desktop/test/merge-body.test.ts`, 13 cases.

The editor itself needs a DOM and a ProseMirror view and the harness has neither, so
the merge is tested in isolation, as the file's header says. `NoteEditor` is left to
the type checker. The three cases asked for are there: external change while clean
(replace, as today), external change while dirty with the PM's edit in another
paragraph (both survive, summary still above notes), and both edits on the same line
(PM wins, `kept`, and the toast copy is asserted). Plus: two appends at the same point
refuse, neighbouring-line changes merge, an edit on the last line plus a block added
under it merge, a deletion survives, the same change on both sides is written once,
trailing newlines, and the size guard.

**What I ran**

- `pnpm --filter @qale/desktop test` → `tests 461, pass 461, fail 0` (448 before,
  13 new).
- `pnpm check-types` → `Tasks: 11 successful, 11 total`.
- `pnpm lint` in `apps/desktop` → 0 errors, 34 warnings, all pre-existing
  `react-refresh/only-export-components`; none on the two files I touched.
- `pnpm exec prettier --write` on all three files.

**What I left**

- Not live-verified. I did not run the Electron app, so the caret behaviour and the
  toast are checked by reading and by types, not by using them.
- The toast is text only. `toast.tsx` takes a message and nothing else, and adding an
  action button means changing that shared component, which is outside the files I
  own. The message names Version history; the PM opens it from the note's ⋯ menu.
- A first merge after a clash re-offers the agent's change on the next external write,
  because `baseMd` deliberately stays put on a clash. The PM's autosave still wins.
  That is the honest base for their pending edit, but it means one lost write can be
  re-attempted rather than staying lost.
- Nothing committed.


### FA-4

The receipt block is built. A landed write now draws a row in the chat, above
the agent's closing sentences, with the page as a link, the change in one line,
Put back, and the diff behind a chevron.

## What I built

**The receipt format carries fields, not just prose** (`packages/domain/src/proposals/activity.ts`).
`appliedReceipt` is unchanged, so the "Applied: …" prose the model reads still
reads word for word as it did. Beside it there is now `AppliedRow`
(activityId, proposalId, path, title, verb, change) and `appliedRowLine`, which
packs it as one trailing HTML comment:

```
<!-- qale:landed (for the app, not for you) {"verb":"Changed","activityId":"a_1",…} -->
```

The comment says in its own words that it is not for the model, so nothing new
had to go into the prompts to make it ignorable. `readAppliedReceipt` now returns
`{ verb, detail?, row? }`. A result written before FA-4 has no `row` and still
parses, which is how an old session draws rows with no put-back.

**The change line** (`packages/domain/src/proposals/card-copy.ts`): `changeLine`
and `appliedVerb`, beside the rest of the card vocabulary. `intent.ts` turned out
to be the grouping code, not the change line, so there was nothing to move: the
card copy already lived in the domain and this joined it. It says the sections a
new page filled ("Summary, 3 Next steps"), a to-do's owner and due ("to-do, due
11 Sep", "waiting on Åsa"), a field that moved ("due moved 12 to 24 Sep"), and
what a patch did ("one line under Entra"). Verbs are New / Changed / Done (a
to-do closed) / Removed.

One deviation from the doc's sketch: a section keeps the heading's own capitals,
so it reads "Summary, 3 Next steps" rather than "summary, 3 next steps". Down-
casing would have turned "one line under Entra" into "one line under entra", and
the heading is the file's own word for that part.

**Composed at accept time** (`packages/application/src/use-cases/proposals.ts`).
`fileProposal` reads the note once before it accepts an update, so a field that
moved can be said as a move, then builds the row from the payload and returns it
on `FiledWrite.landed`.

**The tool results** (`packages/agent/src/tools.ts`): the `applied(` helper takes
the filed write and appends `landedLine(filed)`. The six `applied(` call sites and
the three bespoke receipts (the two want-list ones and `propose_instruction`) all
carry it.

**The block** (`SessionView.tsx` + `components/review/LandedRows.tsx` +
`lib/receipt-block.ts`). One block per turn, keyed `receipt`, inserted just above
the turn's closing prose (or at the end of the turn when there is none yet). It
holds, in this order: the `ask_user` question, the landed rows, then the waiting
cards. The question and the waiting cards belong to the session rather than to
one turn, so only the last assistant turn hosts them; a session with no assistant
turn yet draws them under the transcript as before. `QuestionCard` and
`SessionReview` moved out of the foot of the transcript into the block.

A landed row reuses `TargetTitle` and `ChangePreview` from `CardItem.tsx` (both
exported for this), so a landed row and a waiting row are the same shape. The old
quiet "wrote" list under the collapsed activity row is deleted.

**Put back**: the row calls `revertActivity(activityId)`, the same call
ActivityView makes, and the id is the only thing it passes. Main already reads
the proposal id off the row, so no IPC change was needed. The row then reads
"Put back" as a state, and FA-2's snapshot fallback fires the same toast.
"Put this turn back" appears at the block's foot when two or more rows have an
Activity row; it reverts newest first and stops at the first failure, saying how
many went back and which one refused.

**The diff**: built from the card's own payload rather than `previewProposal`,
because that re-places the change against the file, which a landed write is
already part of. A new page shows its body; an update shows its patch searches
against its replaces plus the append. A frontmatter-only update has no diff, and
the row says "Only the properties changed" (the change line above it already
names the field). The cards are read lazily on the first chevron, so a ten-turn
session costs no reads for detail nobody opened.

**prompts.ts**: the one sentence changed, because the rendering no longer
matches. It now says the writes that wait "sit in the same block" rather than
"render below it".

## What I checked, with real output

All four suites and the type-check, from the repo root:

- `pnpm --filter @qale/domain test`: 298 tests, 298 pass, 0 fail
- `pnpm --filter @qale/application test`: 306 tests, 306 pass, 0 fail
- `pnpm --filter @qale/agent test`: 367 tests, 367 pass, 0 fail
- `pnpm --filter @qale/desktop test`: 477 tests, 477 pass, 0 fail
- `pnpm check-types`: 11 tasks, 11 successful
- `npx eslint src` in apps/desktop: 0 errors, 34 warnings (all pre-existing
  react-refresh warnings)

New tests: `packages/domain/test/change-line.test.ts` (11 tests over the change
line and the verb) and `apps/desktop/test/receipt-block.test.ts` (12 tests: the
parser round-trips the fields, an old plain "Applied:" string still draws a row
with no put-back, a waiting write and a failed step are not rows, the block puts
the question first and groups landed then waiting, Put back asks with the id, and
Put this turn back goes newest first and stops on the first failure).

The model-facing text is tested with `^Applied: …` regexes on the first line, so
the trailing line broke nothing there. One exact-string assertion in
`packages/agent/test/instructions.test.ts` did break, and I split it: the prose
half is still compared word for word, and the fields are checked separately.

## What I left

- **Not run in the app.** Nothing here is live-verified. The block's placement
  above the closing prose, the chevron diff, and the toasts were checked by
  reading and by the pure tests only.
- **`applyAndRecord` (the MCP `log_decision` path) leaves no row.** It writes
  through a different function and returns no tool result the chat reads, so
  there was nothing to carry.
- **SpawnCard and CodebaseCard stayed at the foot of the transcript.** The ticket
  named the question row only, and moving two more parked cards would have been
  churn for no stated gain.
- **An old session's rows have no controls.** No activity id, no proposal id, so
  no put-back and no chevron. The row still names what was written.


### FA-5

`asked` is now the runtime's answer, not the model's. The parameter stays a hint; a card
carries the flag only when the runtime can name a person in the session.

**What I built**

- `packages/agent/src/asked.ts` (new). `AskedFacts { pmTurn, askAnswered }`, `AskedReader`,
  and `askedHolds(facts, declared)`: the flag holds only when the PM wrote a turn in this
  session or answered an `ask_user` card. With no facts at all the declared flag stands,
  which is the case for tests and for any caller with no run behind it; the runtime is the
  only place a model runs and it always passes facts. Two result clauses live there too.
- `packages/agent/src/tools.ts`. `createProposeTools` takes a fifth argument, `askedFacts?:
  AskedReader`, read on every call rather than snapshotted. Inside it: `asked(declared)`,
  `askedCleared(declared)`, `waitsNote()` and `citeNote()`. Every `asked:` site now goes
  through `asked()`: propose_note (2), propose_decision (2), propose_update (2),
  propose_delete (2), propose_todo (2), propose_instruction's list path. `chatIsTheSource`
  became a function so it reads the runtime's answer at call time; its three spread sites
  and the `basis` branch call it. `propose_instruction`'s `learned.from` uses the derived
  flag too, so a run with nobody in it cannot record "what you said in the chat".
- `packages/agent/src/runtime.ts`. `SessionState.askedFacts` is a mutable box built in
  `createSession` (`pmTurn: !scheduled && !unattended`), handed to `createProposeTools` as
  `() => askedFacts`. `run` sets `pmTurn` on every attended turn, so the PM writing into an
  arrival session on turn three changes the answer from turn three on. `askThePm` sets
  `askAnswered` when the card comes back with answers; a dismissal and a refused card set
  nothing.
- The override clause. When the runtime clears a declared flag and the card waits, the tool
  result ends with "Nobody asked for this in this run, so the asked flag was cleared. This
  waits for the PM." It is appended only on the `filed.disposition !== 'silent'` branch, so
  a write that lands says nothing new. A refusal over missing sources gets its own sentence
  instead, because the model set `asked` to stand in for sources[] and needs to be told to
  cite what it read.
- `packages/agent/test/asked.test.ts` (new, 7 tests): attended session keeps the flag and
  the write lands; a run with nobody in it loses it, waits, and says so; an answered
  question is as good as a message; a card that never claimed the flag reads as it always
  did; the flag cannot stand in for sources when nobody asked; `askedHolds` unit cases; a
  draft never carries the flag even when the caller passes one.

**What I checked with real output**

- `pnpm --filter @qale/agent test`: tests 360, pass 360, fail 0.
- `pnpm check-types` (run with `--force` as well, no cache): 11 successful, 11 total.
- Midway through, 10 agent tests were failing in `tools.test.ts` and `withdraw.test.ts`
  with `ctx.vault.writeNote is not a function` from `acceptNote`. Those were FA-1's policy
  change landing (a todo and an append now apply on the spot) against old fakes, not mine:
  `askedHolds` can only ever weaken a flag, and those tests pass no facts. The FA-1 agent
  fixed them while I worked, and the suite is green.

**What I left**

- `outbound` untouched, as the ticket says. The draft tools build their card with
  `createProposal` and set no `asked` field at all, so there was nothing to derive; the
  test holds that line rather than adding a guard.
- I did not export `askedHolds` from `packages/agent/src/index.ts`. The tests import from
  `../src/asked.js`, and index.ts is being edited by the other FA agents.
- The "Assumed:" half of FA-5 is FA-1's, inside `fileProposal`. It is already there
  (`isAssumed` in `packages/application/src/use-cases/proposals.ts`).
- Nothing committed. No tool description strings touched (FA-6 owns them).
- Not live-verified: the derivation is tested through the tool layer with fakes, never
  against a running session.


### FA-6

The prompts now say "decide, ask, or wait" instead of "two spheres". All text edits, no machinery.

**packages/agent/src/prompts.ts**

- The "Two spheres" bullet is gone. In its place: most writes land as you write them (meeting page,
  todo, decision, append, hub edit); a write waits in four cases only (it leaves the workspace, it
  deletes a page, it rewrites prose the PM typed, it rests on an assumption); "Anything sent waits
  every time, whatever else is true". Then the conflict rule with the fixed shape (what was said,
  the note as a link, one question, the two answers as options) and the Åsa/migration-owner worked
  example, then "set 'asked'". Then the cost line: a write that lands costs one press to undo, a
  question costs five seconds, a card costs a reading and a decision, so pick the cheapest one that
  cannot be wrong.
- The deliverable bullet says "the few writes that wait render below it as cards".
- The `asked`/`inference` bullet says an inferred write lands with a mark, and the reply names the
  inference in one clause.
- The "Make the routine calls yourself" bullet gains "a new fact that contradicts a note" as the
  first case and "Read, ask, write, in that order: a question after the write is a card again".
- UNATTENDED_RULES keeps "Assumed:" and adds "A write whose rationale starts 'Assumed:' waits for
  the PM, wherever it would otherwise land."

**packages/agent/src/ask.ts**

`ask_user` opens on "when what you read does not settle what to write: two readings, two candidates,
or a conflict between what they said and what a note says", with the launch-date example and the
two options. It closes on "Asking is cheaper than a wrong write and cheaper than a card". The option
rules are untouched. Two pre-existing em dashes in the middle of that description are now a colon
and a full stop.

**packages/agent/src/tools.ts** (descriptions only, via Edit; I did not touch any `asked:` line or
ASKED_PARAM)

- `propose_meeting`: the page lands as you write it, so write it whole; sources flip to processed
  once the page lands.
- `propose_todo`: the todo lands in the ledger; set `inference` when you worked it out from a
  transcript; ask who owns it when the source does not say, in one question for the batch.
- `propose_update`: an `append` lands wherever it goes; a `patch` over prose the PM typed waits.
- `propose_instruction`: the `asked` hint no longer says "the line comes as a card". It says the
  line lands either way and the reply says why in one clause.
- `propose_skill`: nothing to do. Its description already said the skill lands as you write it. The
  "nothing can run it until the PM approves it" string at the old line 2490 is the result of the
  `else` branch that only runs when the write waited, so I left it.
- A new shared `sendWaitsNote` ("This waits for the PM. Nothing is sent until they approve it.")
  opens all six outbound draft descriptions: `draft_ticket`, `draft_ticket_comment`,
  `draft_page_update`, `draft_calendar_event`, `draft_calendar_reschedule`, `draft_calendar_rsvp`.
  `draft_text` is deliberately not in that set: it sends nothing and already says so.

**packages/agent/src/claims.ts**

`check_claims` says a `conflict` verdict is a question to ask before either write, in the same
shape. Its `promptGuidelines` line and QUESTION_RATION say the same, and QUESTION_RATION gains one
bullet: a conflict over a date, an owner, a number or a decision is always worth a question, asked
before the write, then write what they chose and set `asked`.

**packages/sessions/src/defaults.ts and the vault-dev copies** (kept word for word identical; the
sync test in packages/sessions/test/defaults-sync.test.ts checks this and passes)

- Arrival: pages land as you write them, meeting page first so the todos and decisions can cite it.
  The check_claims paragraph says a conflict is a question every time, asked before you write either
  side, and that a gap you can fill from the source is not a question. "## Then" says the meeting
  page, the decisions, the todos and the hub edits land and the chat lists them; anything sent to
  Jira, Confluence or the calendar waits; say what the source meant in two or three sentences and
  name any assumption.
- Process-note: "Each piece its own write". Same check_claims paragraph. "## Then" says the todos,
  hub edits, insights and decisions land, a rewrite of the PM's own lines waits, and a send waits.
- Librarian: repairs land with the reason on the Activity row; a repair to a document, to-do or
  meeting lands too and the chat names it; a delete and the mirrored-page redline still wait, and
  "you never send anything yourself". "If a repair would change what a claim means, stop and ask"
  is untouched.
- The ask skill and the commitment-check skill both gained a check_claims call before writing a
  date, owner, number or standing decision, mirroring arrival. Commitment-check got it as its own
  "## Check what it claims" section, with the spec's decision 1 in it: a close the PM said out loud
  is written, a close the agent worked out is a question. Its "## Then" no longer says todos join
  the ledger on approval.

**Tests**

New file packages/agent/test/send-waits.test.ts, four tests:
- every tool `createDraftTools` returns carries the send-waits sentence, and the tool list has to
  equal DRAFT_TOOL_NAMES + CALENDAR_TOOL_NAMES so a seventh draft tool cannot slip past unchecked;
- SHARED_PREAMBLE says a send waits and no longer says "Two spheres";
- SHARED_PREAMBLE carries the conflict question, the worked example, "read, ask, write" and the cost
  line;
- UNATTENDED_RULES says an "Assumed:" write waits.

No existing test asserted any phrase I changed. I grepped for "Two spheres", "waits for them",
"still waiting renders", "nothing lands in meetings", "nothing can run it", "comes as a card",
"A conflict or a gap", "Each piece its own proposal" and "Approved proposals update" across
packages/*/test and apps/desktop/test and found nothing to update.

**What I checked, with real output**

```
pnpm --filter @qale/agent test      ->  tests 360, pass 360, fail 0
pnpm --filter @qale/sessions test   ->  tests 53,  pass 53,  fail 0
pnpm check-types                    ->  Tasks: 11 successful, 11 total
```

Mid-run I saw up to 23 failing agent files and then 11 failing tests, all of them from the other
FA agents working in the same tree: `@qale/domain` had not yet exported `SEND_WAITS_REASON` that
`proposals.ts` imports, and tools.test.ts / withdraw.test.ts still expected "Proposed meeting" and
"Proposed todo" where FA-1 now lands them. None of those assertions named a string I edited, and the
final run above is green.

**What I left**

- Nothing in the arrival "## Produce" section: it still calls the meeting page "one proposal
  carrying the whole page". The ticket named the file, check_claims and "## Then" paragraphs and I
  kept to those, because every word there is also in vault-dev and the sync test binds the two.
- The librarian text now says a repair to a document lands. In FA-1's policy a link fix inside a
  `notes/` body is a patch into the PM's prose, which waits. If FA-1 computes
  `patchTouchesUserText` from the patch rather than from the folder, the two agree; if it computes
  it from the folder, that one sentence overpromises. Worth one look when FA-1 lands.
- I did not commit, did not run the app, and did not touch policy.ts, proposals.ts, restore.ts,
  NoteEditor.tsx, the renderer or runtime.ts.


### FA-7

Inferred todos wear a mark, the PM's first touch takes it off, and dropping an
untouched one deletes the file. Built, all five parts. Every suite green and
`pnpm check-types` clean.

**1. The mark reaches the file.** `zTodo` takes `inference` as an optional
boolean (`packages/domain/src/notes/frontmatter.ts`). `propose_todo` copies the
param into the note payload's frontmatter, only when true
(`packages/agent/src/tools.ts`, one added spread in the payload). Without the
schema field the accept path would have stripped it: `zFrontmatter` drops
unknown keys, so the field is in the file only because it is in the schema, and
a domain test says so from that side. The generated `frontmatterReference` picks
it up on its own and prints `inference (true | false)` in the todo line, which a
test pins. `NoteRefDTO.inference` carries it to the renderer, mapped in
`apps/desktop/src/main/dto.ts` as true-or-absent (never `false`).
`properties-schema.ts` puts it in `HIDDEN_KEYS` with `OFF_ROW_OWNERS.inference =
'agent'`: Qale's field, no row, no cursor.

**2. Clearing it.** One domain helper, `withoutInferenceMark`, called from four
PM-facing use cases: `setTodoDue`, `setTodoStatus`, `saveFrontmatter` (owner and
any other field) and `saveAuthoredNote` (the body). The agent is told apart
structurally, not by a flag: an accept writes through `ctx.vault.writeNote` in
`proposals.ts` and never through these use cases, so a proposal the agent
applies leaves the mark alone. There is a test for that case in
`accept-update-frontmatter.test.ts`.

`saveAuthoredNote` needed one narrow branch. It writes with `writeBody` on
purpose, which never touches the frontmatter block, so a marked todo now goes
through `writeNote` instead. The guard is safe: a todo whose frontmatter failed
its schema reads back as a plain `note`, so the coerced-fallback hazard the
`writeBody` comment warns about cannot reach the branch.

**3. On screen.** `apps/desktop/src/renderer/src/lib/todo-row.ts` composes both
strings, and `TodosView` and `TodoDetail` read them: the mark is
`text-xs text-muted-foreground` beside the title, the same voice as the due
date. No badge, no colour, per PRODUCT.md ("what the PO said and what the agent
inferred stay visibly different" and the ink-on-steel rule). It is also in the
row button's `aria-label`, and it is hidden on a closed row.

The drop button's tooltip now tells the truth about what the press does:
"Qale only heard this, so the todo is removed" against "Keeps the record,
closes the todo". The panel's Drop button uses the same string (it fires the
same action, so a tooltip that promised the record was kept would have lied).

`attention.ts` gained `AttentionItem.mark`, set to the same words on a due todo
Qale heard. Worth knowing: **Home no longer draws attention rows.** The "Waiting
on you" list was deleted from `Home.tsx` in commit da950b2; today the attention
list only feeds counts (the sidebar badge, ⌘K). So the mark is on the derivation
and tested there, and it will appear the moment a surface draws those rows
again. Nothing on Home renders it now.

**4. Dropping one deletes it.** `setTodoStatus` returns `Note | null`, null when
the file is gone; `todos:setStatus` returns `NoteDTO | null` and pushes a
`vault:changed` for the path that left. `dropInferredTodo` deletes through
`deleteNote` and writes an Activity row: action `deleted`, undo `restore`,
reason "you said it was not a commitment", line composed by
`droppedInferredTodoLine` in the domain. With a source it reads "Removed Send
Nordkap the SSO dates. Qale had heard it in Nordkap check-in and you said it was
not a commitment."; with none the "in …" clause is dropped rather than left
dangling. The source is named by its real title, resolved through the index, not
as a raw `[[wikilink]]`, because Activity prints `line` as plain text.

One case I added that the ticket did not name: **a todo another note links to is
closed the old way instead of deleted.** Deleting it would break that link,
which is the same reason a delete card checks backlinks. It is one guard, three
lines, and it has a test.

`revertNoteChange` handles the row untouched. I checked the git behaviour it
depends on against a real repo rather than assuming it: after `git rm` +
commit, `git log --follow -- <path>` lists the delete commit first, and
`git show <hash>^:<path>` still prints the file, which is exactly what
`headCommit` + the revert loop read.

**5. Tests.** Domain: the schema keeps the field, `isInferredTodo`,
`withoutInferenceMark` (copies, leaves the original alone, no copy when there is
nothing to clear), the row sentence both ways, and the reference line.
Application: a new `inferred-todos.test.ts` (10 tests) covering all four
clearing doors, the delete with no `dropped` commit, the row's words and revert
shape, a todo with no mark dropping the old way, and the backlink guard; plus
the agent-write test in `accept-update-frontmatter.test.ts`. Agent: the mark
rides into the payload frontmatter, and a stated todo carries none. Desktop:
`todo-row.test.ts` for the mark and the drop copy, the attention mark in
`attention.test.ts`, and the hidden/agent-owned field in
`properties-schema.test.ts`.

**Counts, from the four commands:**

- `@qale/domain`: tests 285, pass 285, fail 0
- `@qale/application`: tests 285, pass 285, fail 0
- `@qale/agent`: tests 343, pass 343, fail 0
- `@qale/desktop`: tests 465, pass 465, fail 0
- `pnpm check-types`: 11 successful, 11 total
- `pnpm --filter @qale/desktop lint`: 0 errors (34 pre-existing react-refresh
  warnings, none from these files)

**What I did not do.** Not committed. The app was not run, so nothing here is
live-verified: the mark's placement on a crowded row, the tooltip, and the row
vanishing after a drop are all tested but unseen. `renameNote` does not clear
the mark: it is shared with the agent's retitle path in `proposals.ts`, which I
was told not to touch, and a todo is retitled from the file editor rather than
from its own panel. No demo todo in `vault-dev/` carries the mark yet, so the
demo will not show it until one does. `docs/fewer-approvals.md` is unchanged.


### FA-8

Duplicate todos are now checked against the ledger on disk, not only against the pending
cards. A title that says what an open todo already says is refused; one that only reads
alike comes back as a question for the PM.

**What I built**

1. `packages/application/src/use-cases/proposals.ts`, right after `duplicatePending`:
   - `todoTitleTokens(title)`: `contentTokens` from `@qale/domain` (lowercase, fold
     diacritics, drop punctuation and stopwords), plus a light stemmer and a few folded
     Swedish stopwords the shared list misses because it spells them with their marks
     ("på" folds to "pa", which the list does not hold). The stemmer strips a fixed list of
     Swedish and English endings ("ningar", "arna", "ande", "ing", "es", "ar", "en", "s",
     "a" and so on), longest first, and refuses any strip that leaves fewer than four
     letters. No new dependency. There is no FTS tokenizer in the repo to reuse: the only
     language code is `packages/domain/src/language/index.ts`, which is a stopword-counting
     language detector, and `contentTokens` in `packages/domain/src/proposals/duplicate.ts`,
     which is what I built on.
   - `todoTitleSimilarity(a, b)`: Dice on the stemmed token sets. I chose Dice over Jaccard
     because the pair the ticket names is lopsided. "Send Nordkap the pricing" against
     "Pricing to Nordkap" is 0.8 on Dice and 0.67 on Jaccard, and no Jaccard threshold both
     catches that pair and keeps "Send Nordkap the Q3 roadmap" apart from the Q4 one. On
     Dice those two are 0.8 and 0.75, which is the split the two bands need.
   - Bands: `same` at 0.8 or above, or identical token sets; `near` at 0.5 or above. Below
     two shared words nothing matches unless the token sets are identical, so "Call Åsa"
     and "Call Jonas" stay two calls.
   - The strong signal: when both todos cite a note in common AND agree on the owner (both
     empty counts as agreeing, meaning the PM owes it), the near floor drops from 0.5 to
     0.34. It lowers the floor, it never lifts a near match to `same`. Two commitments made
     by one person in one meeting are the ordinary case, so treating a shared source as
     proof would delete the second one. Asking more is the safe direction.
   - `matchOpenTodo(todos, candidate, options)` is pure and takes the ledger it reads.
     `openTodos(ctx)` reads `ctx.index.listByType('todo')` and keeps
     `(lifecycle ?? 'open') === 'open'`, the same filter `handlers.ts` and `TodosView` use.
     `duplicateOpenTodo(ctx, candidate, options)` joins the two and is what the tools call.
     It returns the matched path, its title, the band and the score.

2. `propose_todo` in `packages/agent/src/tools.ts`, straight after the existing
   `alreadyOnDisk` and `alreadyProposed` checks:
   - `same` writes nothing: "Not proposed. This to-do already exists:
     [[todos/…|title]]. Update it instead of adding one."
   - `near` writes nothing: "Not proposed. A to-do that may be the same exists:
     [[todos/…|title]]. Ask the PM with ask_user whether this is the same one before you
     add it, then call propose_todo again with `asked`. If they say the two are different,
     pass not_the_same_as "todos/…md" on that call." The tool never calls `ask_user`
     itself; the instruction to the model is the whole mechanism.
   - New optional parameter `not_the_same_as`. With `asked` behind it (checked through the
     runtime's `asked()`, so FA-5's derivation still governs), the named path can no longer
     be a `near` match. It can still be a `same` match: that band is a fact about the two
     titles, and the way past it is `propose_update`. Without `asked` the parameter does
     nothing.
   - The tool description now says open todos are checked as well.

3. Concurrency. Two parts, and I kept both small.
   - The on-disk half reads the index on every call, so a lane sees whatever landed and was
     reindexed before it looked.
   - The in-process half: a `WeakMap<UseCaseContext, entries[]>` in `tools.ts`. A lane
     announces its todo (path, title, owner, sources) right before it calls `propose`, and
     `duplicateOpenTodo` gets that list through the `also` option. Entries older than 60
     seconds are dropped on every read, so nothing grows and a write that never landed
     stops blocking on its own. I keyed it on the context object rather than the module
     because one ledger is what the list is about: every spawn lane of one run shares the
     open workspace's `UseCaseContext` (`VaultService.ctx` is one object per open vault,
     handed to `createSession` and on to `createProposeTools`), and two workspaces must not
     block each other. A test covers both directions.

4. The MCP server does not create todos. `apps/desktop/src/main/services/mcp-service.ts`
   has no todo path (grep for "todo" there returns nothing), and the only other writer is
   `captureTodo`, which is the PM typing a todo into the Todos view by hand. Nothing to
   wire, so I wired nothing. The check sits in the application layer, so the next writer
   gets it for free.

**What I checked, with real output**

- `pnpm --filter @qale/application test`: tests 306, pass 306, fail 0. Includes the 13 new
  tests in `packages/application/test/duplicate-open-todo.test.ts` (same, near, different,
  one-shared-word, identical-after-normalising, stopwords, Swedish endings, English
  endings, the shared-source signal, `notTheSameAs`, strongest match wins, open-todos-only
  with a done and a dropped todo, no-commitment-counts-as-open, and the `also` list).
- `pnpm --filter @qale/agent test`: tests 367, pass 367, fail 0. Includes the 7 new tests in
  `packages/agent/test/todo-duplicates.test.ts` (same refuses with the link and files
  nothing, near returns the ask instruction and files nothing, `not_the_same_as` with
  `asked` lets it through, `not_the_same_as` without `asked` does not, a done todo does not
  block, two calls in a row where the second sees the first before any index does, and the
  per-workspace guard).
- `pnpm check-types`: FAILS, and not on my code. Three errors, all in `appliedRow` in
  `packages/application/src/use-cases/proposals.ts` lines 116 to 123, which is the FA-4
  agent's receipt helper being written while I ran: `rec.kind` is a `string` and
  `ChangeLineInput.kind` is a union. Nothing in the FA-8 region errors. I ran
  `tsc --noEmit` on `@qale/application` and `@qale/agent` separately while my edits were
  the newest thing in the tree and both were clean.

**What I left**

- `same` has no override. A model that hits it must call `propose_update` or leave it. I
  chose that on purpose: "these two titles say one thing" is a context-free fact, which is
  where Erik's rule allows a gate, and `not_the_same_as` clears only the `near` band, which
  is the one that needs the PM's context. If this turns out to be too tight in use, the fix
  is to let `not_the_same_as` clear `same` as well when `asked` holds.
- Thresholds are the ticket's suggested ones (0.8 and 0.5) plus the 0.34 floor for the
  shared-source case. They are tuned against the pairs in `docs/fewer-approvals.md` and the
  ones in `packages/domain/src/proposals/duplicate.ts`, not against a corpus.
- The stemmer is deliberately crude and can over-strip ("rollout" is safe, "together"
  becomes "togeth"). It is symmetric, so it costs nothing as long as both sides go through
  it, and it never leaves a stem under four letters.
- I did not touch `docs/fewer-approvals.md`. FA-8 there still reads as a ticket.
- Nothing is committed. Nothing was run in the Electron app.


