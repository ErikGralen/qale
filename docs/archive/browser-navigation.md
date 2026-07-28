# Browser-style navigation (2026-07-24)

## What changed

Navigation now works like a browser, replacing the VS Code-style preview-tab
model (single italic reusable tab, double-click to keep).

- **A tab is a history, not a view.** Each tab carries a stack of visited
  views (`doc`, `folder`, `context`, `session`, `inbox`, …) plus a cursor.
  The tab strip shows each tab's *current* view.
- **Plain click navigates the active tab in place** — sidebar rows, wikilinks,
  backlinks, list rows, tag chips, ticket cards, session rows. Re-clicking the
  current destination is a no-op (history never grows on re-clicks).
- **⌘click / middle-click opens a background tab; ⌘⇧click a foreground tab.**
  One helper (`navFromEvent` in `lib/nav.ts`) maps modifiers to intent; every
  navigable click funnels through it.
- **Back/forward per tab**: toolbar buttons in the tab strip (left, next to the
  sidebar toggle), ⌘← / ⌘→ and ⌘[ / ⌘] outside editables, and mouse
  back/forward buttons (button 3/4).
- **⌘T** opens a fresh chat tab (the app's "new-tab page");
  **⇧⌘T** restores the last closed tab with its history intact (12 deep,
  also in the tab context menu).

## Why the preview model went away

Preview tabs and in-place history are two competing answers to the same
problem (browsing shouldn't pile up tabs). Keeping both would mean a sidebar
click sometimes retargets a *different* tab (the preview slot) while a
wikilink click navigates the current one. With per-tab history, browsing
piles up *history*, not tabs — and Back recovers anything a navigation
replaced. All the "commits the tab" glue (keepTab on edit/pin/rename/draft)
was deleted with it.

## Implementation map

- `state/app-state.tsx` — the engine. `TabState { id, history: View[], index }`
  internally; consumers still see a flat `Tab = View & { id }` per tab, so
  views read `activeTab.kind / .path` unchanged. `navigate(body, opts)` is the
  single entry: push-in-place (truncating forward entries, 50-entry cap) or
  new tab. `goBack/goForward/canGoBack/canGoForward` act on the active tab.
  `mapViews` / `dropViews` update or purge entries across all histories
  (rename, delete, vault switch — a tab whose history empties closes).
- Session binding is by **history-entry key**, not tab id
  (`bindTabSession(view.key, sessionId)`), and `ChatView` in `Center` is keyed
  by `activeTab.key` so back/forward between two conversations in one tab
  remounts the transcript. `initialPrompt` is cleared on bind and stripped on
  persist/restore so a seed prompt never re-fires.
- Persistence: `pm.tabs.v3` (histories included); `pm.tabs.v2` migrates on
  first load (each old tab becomes a one-entry history).
- `lib/nav.ts` — `NavOpts { newTab, foreground }` + `navFromEvent(e)`.
- `Markdown` / `NoteEditor` / `ExternalRefChip` pass the click's `NavOpts`
  through their `onOpenNote` / `onOpen` callbacks; since those props are
  usually `openDoc` itself, the modifier support flows automatically.

## Deliberate behaviors

- ⌘click opens **background** tabs (browser default); ⇧ adds focus.
- `openSession(fresh: true)` (new chat, pings, capture follow-ups) still gets
  its own foreground tab — deliberately spawned work surfaces aren't
  navigations.
- Two tabs may show the same view now (no focus-existing-tab dedupe) — same
  as a browser, and harmless since views are queries.
- Back/forward keys are ignored inside editables (⌘← is line-start there).
