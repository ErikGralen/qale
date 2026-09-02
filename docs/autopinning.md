# What puts a note on the rail

> Built 2026-08-30. Replaces the state-based auto-pinner described in
> `docs/sidebar-pin-rework` (in git history). That doc's core rule survives
> untouched: only the PM ever takes a row off the rail.

## The rule, in one sentence

Make it, hand it over, or write in it, and it is pinned until you unpin it.

## The problem this fixed

The rail pinned on **state** and never on **action**. `qualifiesForRail` pinned a
meeting because today was its day, a ticket because it was not done, a theme
because it was open. Every other type returned false. So the two most deliberate
acts in the app, making a note and approving a card, left no mark on the sidebar.
You could press ⌘N in a meeting, write for ten minutes, and the Notes section
still read "Jot something down".

The rail also loses a row only to the PM's hand. Nothing ages out, nothing is
capped. With no exit, a rule that pinned today's meetings added about four rows a
day forever, and every non-done ticket you ever linked to stayed. The rail was
filling with a calendar instead of holding a working set. That is why the
authored types were excluded in the first place: adding them on top would have
made it worse.

So the fix was not to add more pins. It was to stop pinning on the clock and pin
on what the PM does.

## What pins now

| Act | Where |
| --- | --- |
| Make a note (⌘N, the "+" menu, the Memory shelf) | `captureNote`, `createNote` in `app-state.tsx` |
| Approve a card that writes a note | `acceptProposal`, from `AcceptResult.path` |
| Write in a note (body autosave, properties, restore a version) | `saveNote`, `saveFrontmatter`, `restoreVersion` |
| Hand a source over (drag-in, `file_source`) | the auto-pinner, via `qualifiesForRail` |

All four go through one function, `pinForWork(path, type?)`. It adds the path to
`favorites` and does nothing else: no mark, no removal, no reordering.

## What does not pin

- **Reading.** Opening a note is not working in it. Browsing would pin the whole
  workspace within a week.
- **Today's meetings, open tickets, open themes.** The clock no longer puts
  anything on the rail. Today's meetings live on Home, in "Waiting on you", which
  is the first thing you see. A meeting joins the rail when you write in it, or
  when you approve a card against it.
- **Bulk edits.** Tagging thirty notes from the selection bar pins none of them.
  One gesture is one intent, not thirty.
- **Types with a home of their own.** Todos, skills, agents and sessions. See
  `isPinnable` in `note-status.ts`. The rail would only repeat what those pages
  already say.
- **Outbound cards.** They write to Jira or Confluence and carry no vault path.

## The one exception, and it is the PM's too

`pinForWork` will not pin a note that is in `dismissed`, the set of paths the PM
has unpinned. Without that, X-ing a note you have open would undo itself on the
next keystroke. Only the pin control itself takes an unpin back: `toggleFavorite`
clears `dismissed` when it pins, exactly as before.

## What the code lost

- `meetingRailHorizon`, `LOOKAHEAD_HOUR` and `CLUSTER_MS` in `note-status.ts`,
  and their test file.
- The five-minute `clockTick` in `app-state.tsx`. It existed so a new day's
  meetings could pin themselves with no file change. Nothing pins on the clock
  now.
- The `themes` dependency on the auto-pin effect.

`qualifiesForRail` kept its name and now takes one argument. It answers one
question: is this an unread source the PM handed over?

## What the code gained

`AcceptResult.path` (and the same field on the `proposals:accept` IPC result):
the vault note an accept wrote, after any rename it also made. The renderer had
no way to know what a card created, and diffing the tree would have been a guess.

## Consequences worth knowing

- The Meetings section is empty on a fresh workspace until you write in a
  meeting. The "Drop a transcript" invitation still shows while the memory holds
  no meetings at all; after that the header alone is the browse affordance.
- Dropping a transcript for yesterday's meeting pins the **source**, not the
  meeting page. The source is the thing that arrived, and it is the row you
  click through from.
- Approving five librarian cards gives you five rows. That is the rule being
  uniform, and each is one X away.
