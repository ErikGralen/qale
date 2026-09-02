# The first look

What happens after somebody connects Jira or Confluence. Written 2026-08-30, built the same day.

**The problem.** Connecting ends at consent. The PM picks their projects in the follow picker
(docs/product-understanding.md FL-2), presses the button, and the sync fills an index nobody can
see. Nothing visible ever comes of it. Meanwhile the other half of the same product,
`tell-qale`, asks them to describe their product into an empty page on day one, with a whole
synced site sitting right there unread.

**The idea.** The connection becomes the opening move of "learn the product". The read ends in a
knock, the knock opens into a debrief, and the debrief leads with what the sources say instead
of with a blank question. The workspace already knows the epic names; it should say them.

**How to use this doc.** Same convention as onboarding and product-understanding: one ticket per
thing, the call under **Decision**, what actually landed under **Notes**.

---

## FD-1. The confirm promises the next beat

**Today:** the follow picker's confirm says "Start reading these", with "Nothing is read until
you press this" beside it. Both are true and neither says anything happens afterwards.

**Proposal:** on a first follow, the line under the button promises the report back. On a
reopened picker it does not, because nothing more is coming: changing what a live connection
reads is maintenance, and a promise nobody keeps is worse than no promise.

**Decision:** Implement as proposed (Erik, 2026-08-30)

**Notes:** Built in `apps/desktop/src/renderer/src/components/FollowPicker.tsx`. One derived
value, `firstFollow` (nothing on this connection is followed yet), which is the same condition
the trigger arms on. The line reads "It reads these, then comes back and tells you what it
found". The "pick at least one" case is untouched, and a reopened picker keeps the old line.

**Amended 2026-08-31.** The confirm now also ends in something. Erik pressed it in Settings and was
left with a row of toggles and no word about what had started. A first follow that started a read
gets a receipt, `followReceipt` in
`apps/desktop/src/renderer/src/lib/follow-receipt.ts`: "Reading these now. When it has something to
say, it knocks on Home." Without a model key there is no debrief, so the line stops at the read
("They stay current as notes in your workspace") rather than promising a knock nobody will make. A
reopened picker gets no receipt, on the same rule as the promise.

The picker reports the outcome (`onDone({ firstFollow, started })`) and the frame draws the
receipt, because the confirm is what collapses the picker. Settings puts it where the picker was,
with one quiet door beside it, "Back to Home", which is where the knock lands. The opening screen
shows the line alone: the flow owns the way forward there, and that is its footer. The receipt
lasts the visit and nothing more.

---

## FD-2. The trigger: one knock at the end of the first read

**Today:** `setFollow` fires a tick and nothing watches it finish. `containerOffers` (FL-3) is
the only thing that reads sync state for something to say, and it is about containers nobody
follows.

**Proposal:** when a connection's first sync finishes, queue one unattended session on the
interview skill. Once per connection, for any frame: the onboarding connect, a Settings connect,
and a long-time user adding a second provider years later. The run reads the index, parks one
`ask_user` question and stops.

**Decision:** Implement as proposed (Erik, 2026-08-30)

**Notes:** Built. Three pieces.

- `apps/desktop/src/main/services/sync-service.ts`: a `first-look:<connectionId>` key in
  `sync_meta`, holding `ready` or `done`. Inside `run()`, before the pull loop, a connection arms
  if the key is absent AND every followed container has `lastSync === null`. That test is what
  keeps this off every workspace that already syncs, and off a second project followed months
  later: both have a `last_sync`. It is stamped `ready` after the loop and only on a clean pass,
  so a site that was half down is retried rather than half reported. Two methods drain it:
  `firstLookReads()` (names, kinds and item counts, read back off the store so the numbers are
  current at the moment the session speaks) and `markFirstLookDone(connectionId)`.
- `firstLookInstruction(read)` in the same file builds the kickoff. Facts only: which site, which
  containers, how many items in each. What to do with them is the skill's own section, named
  rather than repeated, because two copies of the behaviour would drift.
- `apps/desktop/src/main/handlers.ts`: `runFirstLookDebriefs` runs inside the existing
  maintenance pass, right after the frontmatter tidy and BEFORE the librarian block, so a
  workspace with the librarian switched off still gets its debrief. It stamps `done` before it
  fires, which is the same discipline the meeting sweep uses: the window between firing and the
  question landing is exactly where a second tick would ask the same thing.

Fired with `unattended: true` and `trigger: 'arrival'`, never `scheduled`. A scheduled run
refuses to park a question at all, and the parked question is this run's entire output. No model
is pinned: the session becomes an ordinary conversation the moment they answer, and pinning it to
the background model would leave the whole interview there.

Two deviations from the brief, both deliberate:

- **The knock is owed, not offered.** `isOffered` is true only for maintenance agents, and
  widening it to the interview would send every one of its proposals into the librarian's quiet
  section. The knock is also the thing FD-1 just promised, so a badge is the promise being kept.
- **No debrief without a key**, and no debrief for a workspace that has already told it about the
  product (the First steps `understanding` stamp, or the older `about-us` one). The flag is
  stamped `done` either way, so a connection is never queued twice.

**Amended 2026-08-31, after a live run that ended in silence.** Erik connected Jira from First
steps, picked projects, watched the sync run, and nothing ever happened.
The knock now chases the sync: `connections:setFollow` calls `firstLookKick.follow(true)`,
a four-second debounce in `apps/desktop/src/main/services/first-look-kick.ts`, so the picker's one
call per container collapses into one `runMaintenance()`. `setFollow` starts its own tick before
it returns and `tick()` joins a run in flight rather than skipping it, so the pass waits for that
sync to finish, and finishing is what arms the flag. A pass already past its first-look step is
joined too, and that is the one case the wait cannot cover, so the kick asks `stillOwed` and runs
one more pass. Nothing else changed: the debrief still only ever fires from `runMaintenance`.

The `told` guard became a branch in the skill. Skipping the session for a workspace that had done
First steps made the picker's promise ("it reads these, then comes back and tells you what it
found") a lie for most people, because most people do First steps first. So the knock always
happens, and the fact rides in as one line of the kickoff: `firstLookInstruction(reads, told)`
adds "The workspace already holds the product picture, so skip the interview." The `## First look`
section answers it. Beat two reports what it read, cites it the same way and offers the seed card;
it does not re-run the interview and does not ask the areas again. The no-key guard is untouched,
and still returns without stamping.

---

## FD-3. The knock and the debrief

**Today:** `tell-qale` opens with one big ask and works area by area from what the PM says. The
sources check the picture; they never propose it (docs/product-understanding.md, Part 2).

**Proposal:** a "First look" section in the same skill, covering both beats. Beat one reads the
index and parks one question with real names and real numbers. Beat two, when they say yes, leads
with what the agent thinks: named epics with motion, their own open tickets, what looks stalled,
who keeps showing up, every claim citing a ticket or a page. Then the ordinary areas, but
hypothesis first, phrased as a question. With no connection nothing changes at all.

**Decision:** Implement as proposed (Erik, 2026-08-30)

**Notes:** Built as copy in `TELL_QALE_SKILL` (`packages/sessions/src/defaults.ts`), mirrored
into `vault-dev/skills/tell-qale/SKILL.md`. Both copies were generated from the one constant, so
they cannot have drifted; `packages/sessions/test/defaults-sync.test.ts` is what keeps them
honest from here.

The heading is exactly `## First look`, because `firstLookInstruction` points at it by name.
Renaming it hands an unattended run a pointer to nothing, and the sessions test asserts on it.

The U-2 rule bends here, and the bend is written where the marking happens rather than as a
footnote: a claim read in a source, put to the PM, and confirmed by them lands **verified and
still cites the source**. Their yes is what verifies it; the citation is what makes it
checkable a year later. Silence is still not a yes.

Two lines are there because leaving them out breaks something specific. "Write nothing, propose
nothing" ends beat one, or an unattended run starts drafting into a workspace nobody is watching.
"Never read the debrief back into a note" keeps the durable picture in the area notes, where it
can be tightened, rather than in a wall of prose nobody edits.

The skill gained `can: [track-external]` for FD-4. Provider read tools need no capability, so
nothing else changed.

---

## FD-4. The seed card

**Today:** nothing offers to set the workspace up. A theme is proposed one card at a time
(`propose_note`), and a tracked ticket goes through `track_external`, which takes no approval card
because it writes nothing upstream.

**Proposal:** at the close of the debrief, one batch with one confirm: their open tickets with
recent motion become tracked ticket notes, and epics they confirmed become theme proposals.
Checked by default, one reason per row, nothing lands without the confirm. Track, never mirror. No
wiki pages, ever.

**Decision:** Implement as proposed (Erik, 2026-08-30)

**Notes:** Built with no new tool and no new card. `ask_user` already draws rows with checkboxes,
a one-line reason per row and one confirm; what it could not do was arrive ticked, and it was
capped at four options. Both were small:

- `packages/agent/src/ask.ts`: `AskOption.checked`, honoured on `multiSelect` questions only, and
  `ASK_MAX_OPTIONS_TICKED = 10` for a question that uses it. A ticked radio is refused outright
  (it is an answer the PM never gave), and a ticked row with no description is refused too (the
  follow picker's rule: a tick with no reason beside it is a guess wearing a checkmark). The ticks
  join `askRequestId`'s shape, so the same rows offered ticked and offered clear are two cards.
- `formatAnswers`: an empty answer to a ticked question reads back as "none of them", not as
  "skipped". Those two mean opposite things to the model, and getting it wrong here would have
  the agent seed a workspace the PM just cleared.
- `packages/ipc/src/dtos.ts`: `AskOptionDTO.checked`. No new channel; the card already rides
  `session:ask` and settles through `sessions:resolveAsk`.
- `apps/desktop/src/renderer/src/components/inbox/QuestionCard.tsx`: the boxes start ticked, the
  hint reads "untick anything you do not want", Skip becomes "None of these", and clearing every
  box keeps the confirm live instead of forcing the answer out through a skip. A second card
  arriving in the same session now resets the stepper, which it did not before.

What the skill then does with the answer is the existing path: `track_external` per ticked ticket
(no card, it is a read decision), `propose_note` per ticked theme.

The deviation: a theme still lands as its own proposal card. Nothing writes to the vault without
one, a brand-new note is a write, and the seed card is what keeps that number at three instead of
ten. Tracked tickets, which are the bulk of the batch, produce no Inbox cards at all.

---

## FD-5. Two doors, one session

**Today:** the First steps row "Tell it about your product" always opens a fresh `tell-qale`
session. With FD-2 there can be one already open, holding a question and a whole read index.

**Proposal:** the row opens the waiting session instead of starting a second one. The other
direction already works: the first accepted understanding proposal ticks the row, whichever
session produced it.

**Decision:** Implement as proposed (Erik, 2026-08-30)

**Notes:** Built. `AskRequestInfo` and `AskRequestDTO` now carry `skill`, stamped by
`AskParking.park` from the run's own facts, exactly as `offered` is. `AskRequestDraft` omits it
for the same reason: who asked is a fact about the run, not about the question.

`apps/desktop/src/renderer/src/onboarding/FirstSteps.tsx` reads the `askRequests` map it already
has in app state, finds one whose `skill` is `tell-qale`, and opens that conversation through
`openChat`. Its hint changes to "It read your projects and has a question waiting" and its button
to "Open". No new IPC: `sessions:pendingAsks` already hydrates that map on boot.

---

## Not doing

- **No wiki-page notes.** A page is cited, never mirrored. The seed card offers tickets and
  themes and nothing else.
- **No persistent debrief note.** The prose is a conversation. What lasts is the three
  understanding notes, which can be tightened; a transcript cannot.
- **No people and no todo seeds.** Both come out of meetings, where somebody said something.
  Deriving them from a ticket assignee list is a guess with a name on it.
- **No epic drift offers.** "This epic has moved a lot since you last looked" is a real feature
  and it belongs with FL-3's drift check, not in the first five minutes.
- **No new tool and no new card component.** See FD-4: `ask_user` carried it.

---

## What is not verified

The trigger, the arming rule, the instruction and the kick's own decisions are fixture-tested
(`apps/desktop/test/first-look.test.ts`, thirteen cases, five of them about not asking twice). What
those cases cannot reach is the wiring: `firstLookKick` is built inside `registerHandlers`, so
"the kick is what `connections:setFollow` calls" is read and typechecked, never run. The
`ask_user` changes are tested in `packages/agent/test/ask.test.ts` and `ask-parking.test.ts`. The
skill body is tested for the contract the code depends on
(`packages/sessions/test/sessions.test.ts`).

Nothing below has been run:

- **The conversation itself.** It needs a live Atlassian site, a live model key and a person to
  talk to. No part of a debrief can be fixture-tested honestly.
- **The card on screen.** `QuestionCard` has no render test in this repo, so the ticked rows, the
  "None of these" button and the cleared-boxes path are read but not seen. No Electron app was
  launched (a keychain prompt on this machine).
