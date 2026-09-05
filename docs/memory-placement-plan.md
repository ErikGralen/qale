# Memory placement: implementation plan

Date: 2026-09-05. Status: MP-1..6 BUILT and screenshot-verified 2026-09-05, not committed. Decisions come from `docs/memory-placement.md`.

## What was decided

1. Memory moves to the footer, next to Activity. Nothing pins under it.
2. Tickets and wiki pages leave Memory. One rail row per provider ("Jira", "Confluence").
   Tickets and wiki pages can pin under their provider row.
3. No memory page pins, ever. Only tickets and wiki pages pin.
4. The Memory row carries a count of unprocessed sources.
5. The `+` on Memory goes.
6. The word stays "Memory".

## Assumptions I made where the decision left room

- **The `+` goes on the rail and on the Memory page.** Option A said hand-creation was a
  fallback. The one door left is the `+` on a shelf's own folder page (FolderView), where
  you are already looking at that shelf. Say so if you want the page `+` kept too.
- **One provider is one kind today.** Jira mirrors tickets, Confluence mirrors wiki pages.
  A provider row opens that kind's folder scoped to the provider. If a provider ever
  mirrors both kinds, the folder page gets a Tickets/Pages toggle. Not built now.
- **A provider row shows when there is a connection for it, or when the workspace still
  holds mirrors under its folder.** The second clause keeps old mirrors reachable after a
  disconnect.
- **Flat mirrors** (`tickets/PAY-142.md`, written before PD-10) do not belong to a
  provider and will not appear under a row until the sync engine's one-time move puts
  them under one. That is the existing migration, not new work.

---

## MP-1: Pin rules

Only tickets and wiki pages pin. Nothing auto-pins.

- `lib/note-status.ts`: add `source`, `decision`, `insight`, `theme`, `customer`, `person`
  to `UNPINNABLE`. `isPinnable` now says yes only to `note`, `ticket`, `wikipage`.
- Delete `qualifiesForRail`. The auto-pin of unprocessed sources was the only system pin.
  Its job moves to the count in MP-2.
- `state/app-state.tsx`: delete the auto-pin effect that reads `qualifiesForRail`, and the
  "new pin" machinery that only existed for system pins: `autoPinNew`, `autoPinNewPaths`,
  `markPinSeen`, `AUTO_PIN_NEW_KEY` and its localStorage read/write. `pinForWork` stays
  and keeps its `isPinnable` guard, so creating a document still pins it and creating
  anything else does nothing.
- `toggleFavorite`: refuse an unpinnable type (no-op), so no path can put a theme in the
  set.
- `app/NoteView.tsx` and `components/SelectionBar.tsx`: hide the Pin button and the
  pin-all action when `isPinnable(type)` is false. `SkillAgentPage` already deals with an
  unpinnable type; check it hides the button rather than showing a dead one.
- Existing favorites of memory types stay in `settings.json` but stop rendering. Harmless,
  same as the old meeting pins.

## MP-2: Memory moves to the footer

- `app/Sidebar.tsx`: remove the Memory `PlaceRow` from the scrolling list. Add a
  `MemoryRow` in the footer `div`, above `ActivityRow`, same visual weight as Activity.
  Badge: the number of unprocessed sources, in the Inbox count style. Zero shows nothing.
  Tooltip: "Memory: what Qale knows, and where it got it."
- Delete `NewNoteMenu`, `MEMORY_NEW_TYPES` and the `memoryPins` import. Delete the
  `PinRows` `showType` prop if MP-4 does not need it (mirrors under a provider row are one
  type each, so the glyph says nothing).
- `lib/pins.ts`: delete `memoryPins`.
- `app/MemoryView.tsx`: delete the per-shelf `+` (`startable`, `useNewNote`, `Plus`).
  `FirstRun` still explains how things get onto the shelves; check its copy does not
  point at a `+` that is gone.
- `lib/nav.ts`: `RAIL_ORDER` drops `memory`. `RailPlace` keeps `memory` as a value, since
  `surfaceForType`, the crumb and `TabStrip` still need to name it. Rewrite the comment:
  six places on the rail, provider rows when connected, Memory in the footer.
- The unprocessed count: one selector, `unprocessedSourceCount(tree)`, in
  `lib/note-status.ts`, used by the footer row and by the Memory page's source shelf so
  the two numbers cannot disagree.
- `⌘K`: the "Open Memory" entry stays. Drop "tickets" from its keywords.

## MP-3: Mirrors leave the Memory page

- `lib/nav.ts`: `surfaceForType('ticket' | 'wikipage')` returns a new `RailPlace` value
  `'synced'`. It is not in `RAIL_ORDER`; it is the home the crumb and the tab strip resolve
  to a provider row.
- `app/MemoryView.tsx`: delete `SYNCED_SHELVES` and the mirror entries in `TYPE_DESC`.
  The header count sums only `MEMORY_SHELVES`. The page copy stops mentioning tickets
  and wiki pages.
- `lib/pins.ts` and `pins.test.ts`: mirrors no longer count as memory anywhere.
- Crumb on a mirror page (SB-4): reads "\<Provider\> › Tickets" or "\<Provider\> › Pages",
  and opens the provider's folder view from MP-4. The provider comes from the path via
  `parseMirrorRef`; the label from the connection list, falling back to the folder name
  with a capital.
- `app/ContextView.tsx` keeps its ticket and wiki page sections. A #tag page lists
  everything about a topic, mirrors included. Only their home changed.

## MP-4: One rail row per provider

**Data.** The renderer does not hold the connection list today; `ConnectionsSettings`
fetches it on its own. Lift it:

- `state/app-state.tsx`: load `connections:list` on start and again on the
  `connections:changed` push. Expose `connections: ConnectionDTO[]`. `ConnectionsSettings`
  reads from the store instead of fetching.
- `lib/providers.ts` (new): `providerRows(connections, tree)` returns one row per
  provider, ordered by label. A row is `{ providerId, label, kind, dir }` where `dir` is
  `mirrorDir(kind, providerId)`, for example `tickets/jira`. A provider appears if a
  connection with that `providerId` exists, or the tree holds a note whose path starts
  with a mirror dir for it. Label is `providerLabel` from the connection, else the folder
  name capitalised.

**Rail.** `app/Sidebar.tsx`: after Documents, one `PlaceRow` per provider row. Icon is the
type icon for the kind (ticket or wikipage). Tooltip: "Jira: what Qale copied from your
tracker. It never edits these. Pinned tickets show underneath." Active when the open tab
is that provider's folder or a mirror page under its dir. No `+`. Under it, `PinRows`
with `mirrorPins(tree, favorites, dir)` from `lib/pins.ts`: pinned notes whose path
starts with `dir`, most recent first.

**Folder page by provider.** `app/FolderView.tsx` takes `dir` as `tickets` today and
finds the group by exact match. Make it accept `tickets/jira`:

- Split `dir` into top-level folder and optional provider. Group lookup by the top-level
  folder, then filter notes by the path prefix.
- `altLayoutFor` matches on the top-level folder, so `tickets/jira` still defaults to the
  board.
- The header label reads the provider label, with the kind as meta ("Jira · 42 tickets").
- `VIEW_KEY` uses the full dir so the board/list choice is per provider.
- `openFolder('tickets')` with no provider keeps working for the old links and for
  ContextView's "See all" button.

**Doors.** `⌘K` gets one "Open Jira: tickets Qale copied from your tracker" entry per
provider row. The Connections tab in Settings gets a "Browse" link per connection that
opens the same folder view.

**Tab strip.** `TabStrip` maps a tab to its rail row for the active state. A folder tab
under `tickets/<provider>` and a mirror page map to that provider's row.

## MP-5: Copy and docs

- `apps/desktop/PRODUCT.md`: the "seven places" sentence becomes six places on the rail,
  one row per connected system, and Memory in the footer beside Activity.
- `docs/sidebar-ia.md`: add a status line pointing here. SB-1's "Memory holds what Qale
  knows" still holds; "pinned memory pages render under Memory" does not.
- `docs/autopinning.md`: the unprocessed-source auto-pin is gone; the count on the Memory
  row replaces it. Say so at the top.
- `lib/nav.ts` and `lib/pins.ts` header comments: rewrite for the new map.
- Tooltips and `title` strings that say "Pinned memory pages show underneath": delete.
- Onboarding: `grep -rn "Memory" apps/desktop/src` for any opening screen or First steps
  copy that tells the user to look for Memory in the rail. Point it at the footer.

## MP-6: Tests and verification

- `apps/desktop/test/pins.test.ts`: delete `memoryPins` cases. Add `mirrorPins`: filters
  by dir prefix, ignores flat mirrors, ignores folder index files, orders by recency.
- `apps/desktop/test/rail-pins.test.ts`: `isPinnable` rejects every memory type and
  accepts `note`, `ticket`, `wikipage`. `toggleFavorite` on a theme is a no-op. No
  auto-pin runs for an unprocessed source.
- New `providers.test.ts`: a row per connection; a row for orphan mirrors with no
  connection; no row for a provider with neither; label fallback; ordering.
- `surfaceForType` returns `synced` for mirrors and `memory` for the six shelves.
- `unprocessedSourceCount` matches the Memory page's own shelf count.
- Screenshot verify on scratch userData with the Tavla workspace: Memory in the footer
  with its count, a Jira row with the board behind it, a Confluence row, a pinned ticket
  under Jira, no pins under Memory, no `+` on Memory anywhere. Tear the app down after.

## Order

MP-1, MP-2 and MP-3 can go in one pass; they only remove things. MP-4 is the one that
adds. MP-5 and MP-6 close it. Nothing here touches the agent, the vault layout, or IPC
beyond reading `connections:list` from the store.
