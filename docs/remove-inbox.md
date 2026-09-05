# Remove the Inbox: tickets

Decided 2026-09-05. Every row the Inbox shows comes from a session, and the sidebar already
flags each of those sessions ("question", "N proposals", "ready"). The Inbox is a second review
surface for the same cards, kept in sync with the session's own review block by hand. The
attention module names "two inboxes" as a failure signal. We have two.

The facts below come from one code pass on 2026-09-05 over the uncommitted working tree.

Write your call under **Decision** ("build", "skip", "discuss…"). **Notes** is for anything the
build needs to know. Nothing gets built until its Decision field is filled in.

Order: section A first (it decides what the session review has to carry). B and C are
independent. D is the deletion itself and goes last.

---

## A. What the session review takes over

### RI-1. The review ask and the sent banner move into the session

**What:** After a fully discarded pile, the Inbox asks "Nothing kept from <meeting>. Mark it
reviewed?" (`ReviewAsks`). After an outbound send it shows "Left your workspace" (`SentReceipts`).
Both are rendered only in `InboxView.tsx`. `useApprovals` already produces both; `SessionReview`
ignores them.

**Change:** Render both inside `SessionReview`, above the cards, in the same spot they hold in
the Inbox today. The "not yet" dismissal ledger stays per workspace.

**Decision:** build

**Notes:** Built 2026-09-05. `SessionReview` renders `SentReceipts` then `ReviewAsks` above the
card rows, in that order. `ReviewAsks` also renders in the empty branch: the ask arrives at the
moment the last card is discarded, so a block that only drew it beside pending cards would never
show it. That branch now returns a block when there is a receipt OR a pending ask, and its
aria-label follows. `SentReceipts` stays on the pending branch only, because the receipt below
already names what left. The "not yet" ledger is untouched, still per workspace in localStorage.

---

### RI-2. Keyboard triage in the session review

**What:** The Inbox walks the queue with ↑↓ / j k, approves with ↵ / a, discards with ⌫ / x,
opens with o. `SessionReview` passes `focusedId` to `CardRows` but has no key handler, so the
focus ring exists and nothing moves it.

**Change:** Port the handler to `SessionReview` over that session's rows only. Keep the rule
that ↵ on an outbound card moves focus to Send and never presses it. Drop `o` (the session is
already open).

**Decision:** build

**Notes:** Built 2026-09-05. The block is now a `data-queue` region with `tabIndex={0}` and an
`onKeyDown`. Rows are `cardIntents(cards)`, one stop per grouped intent, same shape as the
Inbox's `rowsOf`. ↑↓/j/k walk, ↵/a approve (a group takes all, an outbound card only moves focus
to its `[data-send]` button), ⌫/x discard, `o` is gone. The cursor starts at -1 rather than 0 and
the block never focuses itself on mount, so arriving in a session leaves the caret in the
composer; the first arrow key enters at the top row. A focused button, link or textarea still
owns its own keys.

---

### RI-3. Cause groups in the session review

**What:** When every card in a session is an update citing the same decision, the Inbox heads
the group "Because you decided X, N notes still point at the old plan" with Approve all /
Discard all. `SessionReview` draws the same cards as a flat list. This is what a librarian
sweep after a decision change produces.

**Change:** Move `groupCause` and `causeSentence` out of `InboxView.tsx` into `cardMeta.tsx` and
let `SessionReview` draw the cause line above `CardRows` when it applies. The "From <meeting>"
header and its Open meeting button are not carried: the session page already names its
meeting.

**Decision:** build

**Notes:** Built 2026-09-05. `groupCause` and `causeSentence` are now exported from
`cardMeta.tsx`. They were copied, not moved: `InboxView.tsx` still holds its own pair until RI-11
deletes the file. When `groupCause` returns a decision, `SessionReview` heads the rows with the
cause sentence, the line "Approve to update them all, or discard if the premise is wrong.", and
the Approve all / Discard all pair. No "From <meeting>" header and no Open meeting button. One
copy fix on the way over: the singular case said "1 note still point", it now says "points".
Tests for both helpers live in `test/inbox-intents.test.ts`.

---

## B. Cards that had no session behind them

### RI-4. MCP write tools write, they do not propose

**What:** The MCP server's `log_decision` and `draft_writeback` call `createProposal` with the
fixed session id `mcp`. No session row exists for it, so without the Inbox those cards are
invisible.

**Change:** The client on the other end (Claude Code, Claude Desktop) has its own approval
step, so Qale does not ask twice. `log_decision` writes the decision file directly through the
same path a silent write takes (`fileProposal` → `acceptProposal` → `recordActivity`) and lands
as a row in Activity, first person, with the revert handle. The tool result tells the client
where the file is. `draft_writeback` is deleted: an outbound send from a foreign client with no
card and no staleness check is not something Activity can put back. `ask_product` stays. The
tool descriptions and result strings drop "the PM approves" and "filed to the Inbox".

**Decision:** build

**Notes:** Erik: "we assume the user is using something like Claude where they can handle the
approvals there. Then things would land in Activity." The Activity row's `sessionId` is `mcp`
and its `skill` is `mcp`; the Activity view falls back to plain text when it finds no session
for a row, check that it does.

Built 2026-09-05. Added `applyAndRecord(ctx, input, reason)` to
`packages/application/src/use-cases/proposals.ts`: create → `acceptProposal` → `recordActivity`,
no `writePolicy` call, so a failed accept rejects the record on the spot instead of leaving it
pending. `log_decision` calls it with the reason "the MCP client approved it" and returns the
landed path, or the error text if the write failed. `draft_writeback` and the now-unused
`zOutboundPayload`/`OUTBOUND_PROVIDERS` imports are gone from `mcp-service.ts`; the file header
and both tool descriptions were rewritten to drop "the Inbox" and "the PM approves". The
`onChanged` constructor param stays: it is still `notifyProposalsFor` from handlers.ts, shared
with the scheduler, so that call site did not need to change. Checked `ActivityView.tsx`:
`sessions.find((s) => s.id === row.sessionId)` already falls back to the literal `'Session'`
when nothing matches, so an `mcp` row renders fine; its "the session" button opens a session tab
with nothing stored behind it (same as any freshly-minted tab), which is a real but pre-existing
gap, not something this ticket introduces. Added `packages/application/test/apply-and-record.test.ts`
(2 cases: a clean write, and a write that cannot land). `pnpm --filter @qale/application test`
(225 pass), `pnpm --filter @qale/desktop test` (393 pass), and `check-types` on application,
agent and desktop are all clean.

---

### RI-5. A session with pending cards cannot leave the rail

**What:** The rail filter requires `lifecycle === 'active'`. The Sessions page marks an unpinned
row as not needing you. Unpin a session while it holds pending cards and the cards are reachable
only through the Unpinned tab, by accident.

**Change:** The unpin button on the rail and on the Sessions page is disabled while
`pendingCards > 0`, with a title that says why ("Decide on its N proposals first"). A card that
lands in an unpinned session re-pins it (same "system only ever adds" rule the sidebar pins
follow).

**Decision:** build

**Notes:** Built 2026-09-05. Sidebar `SessionRows` and `SessionsView`'s `SessionRow` both disable
their unpin button (`disabled`, `aria-label` and `title` all say "Decide on its N proposals
first") while `pendingCards > 0`. `RowAction` in `SessionsView.tsx` gained a `disabled` prop for
this. The re-pin runs in `packages/agent/src/tools.ts`: `createProposeTools` takes a new
`onProposed` callback and every `fileProposal` call goes through a `propose` wrapper that fires
it once a card is filed. `packages/agent/src/runtime.ts` passes a callback that flips the
session's lifecycle from `unpinned` back to `active` when one lands, with a comment naming the
rule: the rail only ever adds, never silently removes. Covered by a new test in
`packages/agent/test/tools.test.ts` ("a filed card notifies the caller..."); 299 → 302 agent
tests and 393 → 399 desktop tests still green.

---

### RI-6. Dev seed cards get a session

**What:** `QALE_SEED_PROPOSAL` seeds cards under the fake ids `seed` and `seed-sweep`. Dev only.

**Change:** Seed a stored session row for each id (title "Demo meeting" / "Demo sweep") so the
seed exercises the same path a real run does. Delete the `'seed'` special case in
`groupTitle`.

**Decision:** build

**Notes:** Built 2026-09-05. Stored sessions are pi JSONL transcripts under
`userDataDir/sessions`, written through `@earendil-works/pi-coding-agent`'s `SessionManager` —
not a table in `packages/vault` or `packages/application`, so `dev-seed.ts` cannot write one on
its own. Added `AgentRuntime.seedStoredSession(id, title, text)` in
`packages/agent/src/runtime.ts`: `SessionManager.create` + one user message + `appendSessionInfo`
for the title, which is exactly the pattern `packages/agent/test/history.test.ts` already uses
to seed a fixture session. `seedDemoProposal` in `dev-seed.ts` now takes a `seedSession` callback
and calls it twice, before it creates any cards, with the titles "Demo meeting" and "Demo
sweep". The one call site in `handlers.ts` (`onReady`, next to `QALE_SEED_PROPOSAL`) passes
`(id, title, text) => agent.seedStoredSession(id, title, text)`; `agent` was already in scope
there. Did not touch `groupTitle`'s `'seed'` case in `InboxView.tsx`: that file is out of my
scope and goes with RI-11. Total added code is under 30 lines across the three files. `pnpm
--filter @qale/agent test` (302 pass) and `check-types` on agent and desktop are clean; not
live-verified (did not launch the app with `QALE_SEED_PROPOSAL` set).

---

## C. Every door that pointed at the Inbox

### RI-7. Attention card rows open their session

**What:** `buildAttention` gives every card the target `{ open: 'inbox' }`. It is the only
target with no place behind it once the view goes.

**Change:** Cards target `{ open: 'session', sessionId, title }`, read off the proposal's
session row like a question does. Delete the `inbox` target variant. Consumers: QuickSwitcher,
QuestionItem, MeetingDetail, the sidebar badge.

**Decision:** build

**Notes:** Built 2026-09-05. A pending card now targets
`{ open: 'session', sessionId: p.sessionId, title }`, with the title read off the session row and
`'Session'` as the fallback for a card whose session has no row (an MCP client's, for one). The
`{ open: 'inbox' }` variant is gone from `AttentionTarget`. Nothing else had to change: the only
code that switched on `target.open` was `InboxView.tsx`, which RI-11 deletes. `attention.test.ts`
gained one case covering both the normal target and the fallback; `closing-beat.test.ts`'s
`waitingElsewhere` fixture was retargeted the same way.

---

### RI-8. The rail count moves to the Sessions row

**What:** The Inbox rail row carries `waitingCount` (parked questions + pending cards + unread
results, minus quiet). The Sessions row carries nothing. Home's title still says "what's
waiting on you".

**Change:** The Sessions rail row takes the badge and the ink icon when `waitingCount > 0`. Its
title becomes "Sessions: what's waiting on you, running, and finished". `RAIL_ORDER` drops
`inbox`. The dock badge is unchanged (one bit, already computed in main).

**Decision:** build

**Notes:** Built 2026-09-05. The Inbox `PlaceRow` is gone from
`Sidebar.tsx`, and the Sessions row took its `waitingCount` badge, its `text-brand` icon class and
the Inactive-Never-Accent comment that went with them. Its title is now "Sessions: what's waiting
on you, running, and finished". `RAIL_ORDER` is five entries and `rail-order.test.ts` says five.
Three counts in comments were stale after the cut and are fixed: "Both badges" (now named as
Sessions and Todos), "the four places that never move" (three), and `PLACE_ROW`'s "Six places"
(five). The dock badge is untouched.

---

### RI-9. Retarget the eight doors

**What:** Places that open the Inbox by name:

- `__review` notification deep link (`app-state.tsx`): the notification already knows the
  session id.
- `SessionReview`: "N more waiting in Inbox".
- `AgentLifeSigns`: "N proposals in the Inbox".
- `SessionsView`: "Review in Inbox →".
- `FirstSteps`: "Decide on a proposal", CTA "Inbox".
- `QuickSwitcher`: "Open Inbox: N need you".
- `TabStrip` / `App.tsx` / `nav.ts`: the `inbox` view kind.
- `telemetry.ts` `VIEW_KINDS`: `'inbox'`.

**Change:** `__review` opens `__session:<id>`. The session review door becomes "N more waiting
in Sessions" and opens the Sessions page. The agent row and the Sessions page row open the
newest session with pending cards for that agent / that row. First steps' CTA opens the newest
session with a pending card, else the Sessions page. The ⌘K entry is deleted; the Sessions
entry gets the count. The `inbox` view kind is deleted from nav, tab strip, app-state and
telemetry (a stored tab of kind `inbox` on launch is dropped, not crashed on).

**Decision:** build

**Notes:** Built 2026-09-05. One correction to the ticket: `__review`
is not a notification deep link. The finished-session notification in `handlers.ts` already pushes
`session:focus` with the session id, so it opens the session and always did. `__review` is only a
`QALE_OPEN` screenshot door, and `__session:<id>` already covers it, so the branch was deleted
rather than rewired. `openInbox`, the `{ kind: 'inbox' }` view kind, its `App.tsx` case and its
`TabStrip` icon case are gone; a persisted `inbox` tab is dropped by `RETIRED_KINDS`, which already
drops `meeting-drop` and `smartview` and closes a tab whose history empties. `AgentDTO` carries no
session id, and rather than widen it `AgentLifeSigns` finds the newest pending card for that agent
in the renderer's own `proposals` (the same match main counts `pendingCards` with) and opens its
session; with no card it opens the Sessions page. Its label is now "N proposals". `SessionsView`'s
row button says "Review →" and calls the row's own `onOpen`; `onOpenCards` is gone. First steps'
proposal row is CTA "Open", icon `ClipboardCheck` (not `MessageSquare`, which the "Ask your memory"
row already wears), opening the newest session with a pending card, else Sessions. ⌘K's Inbox entry
became a Sessions entry carrying the count. `'inbox'` is out of `VIEW_KINDS` and the telemetry
tests now use `'chats'`. The MCP copy in Settings names `ask_product` and `log_decision` only, and
says the decision is written straight away and shows in Activity.

---

### RI-10. Copy sweep

**What:** Strings a person reads that name the Inbox:

- `PRODUCT.md` line 26 ("The Inbox holds what needs a decision…") and line 47 (six places on
  the rail).
- `packages/sessions/src/defaults.ts:997`, a skill prompt: "the proposal that waits in the
  Inbox".
- `SettingsView.tsx:609` (scheduler dry-run copy), `SkillsView.tsx:646`.
- MCP tool descriptions and results (folded into RI-4).
- `README.md`, and the living docs: `closing-beat.md`, `onboarding.md`, `capture-nudge.md`,
  `librarian-agentic.md`, `standing-instructions.md`, `first-look-debrief.md`, `draft-text.md`,
  `conventions.md`, `memory-placement.md`. History docs and research teardowns stay as written.

**Change:** PRODUCT.md line 26 becomes "A session holds what needs a decision, and only that",
rest of the paragraph unchanged. Line 47 lists five places. Every other string says "in the
session" or "in Sessions". Code comments that say "the Inbox" as a place get the same sweep;
comments that say it as history ("the Inbox used to…") stay.

**Decision:** build

**Notes:** Swept 2026-09-05. PRODUCT.md line 26 dropped the last sentence too ("Maintenance
items and the agent's open questions sit quietly at the bottom"): it named an InboxView-only
sort order that has no equivalent on a single session's page, so it is cut rather than
reworded. Line 47 now lists five places; line 83's "Reachable inbox-zero" is now "A reachable
zero". `defaults.ts`, `SettingsView.tsx` and `SkillsView.tsx` done as specified. `README.md`'s
opening line and its Inbox feature bullet (renamed "Session review") now describe review as
per-session; its dated changelog line about the old `InboxView.tsx` refactor stays, as history.
Living docs: touched `closing-beat.md` (nav-door sentences only; the InboxView-specific
mechanics in "## 2" and their file:line citations stay, since `InboxView.tsx` itself is
untouched until RI-11), `onboarding.md`, `capture-nudge.md` (left its dated 2026-08-05 note
alone), `librarian-agentic.md`, `standing-instructions.md`, `first-look-debrief.md`,
`draft-text.md`, `memory-placement.md` (also updated its own "seven/six places" counts for
consistency with PRODUCT.md). `conventions.md` needed no change: its one Inbox mention is a
dated verification note ("Not run live, so the card as drawn in the Inbox is unverified") and
stays as written. `vault-dev/` has no capitalized "Inbox" mentions; its lowercase "inbox" hits
are all the fictional email inbox Insikt competes on, not our app, so nothing changed there.

---

## D. The deletion

### RI-11. Delete InboxView

**What:** `InboxView.tsx` (717 lines) plus `groupAnchor`, `groupTitle`, `groupSummary`,
`clearedInbox` in `cardMeta.tsx`, `hasJudgedACard` in `approvals.tsx`, the `Cleared` receipt,
and `MAINTENANCE_AGENTS`' only renderer use.

**Change:** Delete after A, B and C land. Keep `CardRows`, `ApproveAll`, `useApprovals`,
`QuestionItem`, `ResultItem`, `Receipt`, `cardMeta` (minus the four helpers). Rename the folder
`components/inbox/` to `components/review/`. Tests: `inbox-intents.test.ts` moves to
`review-intents.test.ts`; `closing-beat.test.ts` loses the cleared-Inbox cases and keeps the
session receipt cases; `attention.test.ts` and `rail-order.test.ts` lose the `inbox` rows.

**Decision:** build

**Notes:** Built 2026-09-05. Deleted `InboxView.tsx` (with
`groupAnchor`, `groupTitle`, `groupSummary` and the `'seed'` case inside it), `clearedInbox` and
`ClearedState` from `cardMeta.tsx`, and the whole judged ledger in `approvals.tsx`: dropping
`hasJudgedACard` left `markJudged` and `JUDGED_KEY` write-only, so all three went and the two
`vaultPath` deps they needed came off `acceptOne` and `rejectOne`. Two more files turned out to be
dead: `QuestionItem.tsx` and `ResultItem.tsx` had no importer but `InboxView`, so they are deleted
too, against the ticket's "keep" list. `orderCards`, `receiptSummary`, `titleForRef`, `bareRef`,
`cardIntents` and `ReceiptLines` all still have live callers and stayed. `components/inbox/` is
`components/review/` and `inbox-intents.test.ts` is `review-intents.test.ts`, both by `git mv`;
`closing-beat.test.ts` lost its two cleared-Inbox cases and kept the receipt ones. Swept about 40
code comments across `apps/desktop/src` and `packages/` that named the Inbox as a live place. What
is left of the word: lucide's `Inbox` glyph in `DocumentRow.tsx` and `FolderPickerMenu.tsx`, the
`'inbox'` entry in `RETIRED_KINDS`, the arrival vision's "two inboxes" quote in `attention.ts`, and
two `docs/remove-inbox.md` citations.

---

## What we accept losing

- One page that judges cards from several sessions in one sitting. A PO with four sessions
  needing them opens four rows. Most sittings are one meeting's session.
- The "Tidying up" framing that put the librarian last under "Nothing needs you, just the
  tidy-ups below". On the rail a librarian session reads like any other row with proposals.
  Its cards already counted as "need you" in the Inbox header, so the number does not change.
- The "You cleared it" receipt. The session review has its own.
