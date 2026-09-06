# One file list, everywhere

Status: proposal, 2026-09-06. Nothing built. Each ticket waits for its
**Decision** field. Delete this doc when the work ships.

Documents got a Finder-style list on 2026-09-05 (docs/documents-folders.md).
It reads better than anything else in the app. This doc says where else it
belongs, where it does not, and what to clean up on the way.

The facts here come from one read of the working tree on 2026-09-06.

## The Documents page is four things, not one

They come apart, and the split decides everything below.

1. **The row.** One line, 28px, a glyph, the title, one right-hand column.
   `app/DocumentRow.tsx`.
2. **The pick model.** The row IS the selection: click picks, ⌘click adds,
   ⇧click takes a range, double-click or ↵ opens. `lib/selection.ts` already
   holds this model and the checkbox model side by side.
3. **The sort rail.** Two columns, click one to sort by it, click again to turn
   it around, and the pick is remembered. `SortRail` inside `DocumentsView.tsx`.
4. **The folder machinery.** Expand in place, enter a level, breadcrumbs, New
   folder, rename, delete, Move to, drag and drop, Undo. `lib/documents.ts`,
   `lib/dnd.ts`, `FolderListRow`, `NewFolderRow`, `folder:*` IPC.

Parts 1 to 3 are about reading a list. Part 4 is about owning a structure.
Documents is the only screen where the structure is the user's. So parts 1 to 3
travel, and part 4 stays.

## Where each part fits

| Surface | Row + pick | Sort rail | Folders |
| --- | --- | --- | --- |
| Memory page (the shelves) | yes | the count column only | shelves expand in place, nothing more |
| A Memory shelf (`FolderView` list) | yes | yes, second column per type | no |
| Jira / Confluence mirrors | yes | yes: State, Updated | no |
| Context page (`#tag`) | yes | no, the sections are the order | no |
| Activity | no | no | no |

---

## A. Memory

`MemoryView.tsx` draws six rows. Each is two lines: the shelf name with a
count, and a sentence about what the shelf holds. A click leaves the page for
`FolderView`.

It is already a folder list. It just does not look or behave like one. A shelf
is a container with a count, which is exactly what a folder row is.

### FL-1. Memory is the same tree Documents is

**What:** Six two-line buttons in a centred `max-w-2xl` column, no expansion,
no keyboard, no selection.

**Change:** One `role="tree"` list at full pane width. Each shelf is a folder
row: chevron, type glyph, name, and the count under a right-hand column. The
chevron opens the shelf in place and lists its notes as file rows, one level
indented. Clicking the row still enters the shelf (`openFolder`), so the
existing navigation and the breadcrumbs do not change. Arrow keys, ↵ and
⌥ Right/Left work as they do on Documents, from the same `moveRowFocus` and
the same key handler.

Expansion rides the view body, the way Documents does it: add
`{ kind: 'memory'; expanded?: string[] }` and reuse `setDocumentsExpanded`
after CL-2 renames it.

**Open question, the shelf description.** A one-line Finder row has no room for
`TYPE_DESC`. Three ways out:

- a. Drop it. The shelf name and count carry the row, and the empty state
  inside the shelf already teaches the mechanism (`EMPTY_TEACH` in
  `FolderView.tsx`).
- b. Keep it as the row's `title` tooltip, the way `DocumentRow` keeps the
  summary.
- c. Show it only while the shelf is empty, so a new workspace still reads as
  a map and a full one reads as a list.

I would do c. It keeps the "week 6 looks different from week 1" promise in
PRODUCT.md without paying two lines a row forever.

**Decision:**

**Notes:**

### FL-2. A shelf browse page uses the file row

**What:** `FolderView` renders `NoteList`: two-line rows, a checkbox gutter, a
wrapping title, a metadata rail on the right, month sections above them.

**Change:** The list mode renders the shared file row (CL-1) with the row pick
model. The second column is the note's reference date (`formatRefDate`), not
the file mtime: a decision's own date is what a person means by "when".
A lifecycle word (`superseded`, `cancelled`) stays inline before the date.

No folder machinery: no New folder, no Move to, no drag, no breadcrumb levels.
Qale files these notes and the folders are flat on disk (`decisions/`,
`insights/`, `themes/`, `customers/`, `people/`, `sources/` all have no
subfolders). A folder affordance here would promise ownership the app does not
honour.

The context menu keeps only what applies: Open in new tab, Rename, Delete.

**Overlap to settle:** the sort rail and the group-by toggle both order the
list. See CL-4.

**Decision:**

**Notes:**

---

## B. Jira and Confluence

This is the strongest case for the sort rail, and the easiest one to build.
A mirror folder is flat (`tickets/jira`, `wikipages/confluence`), read-only,
and every row carries two facts a person sorts by: state and when it last
changed. That is a Jira backlog, and a Jira backlog is a table.

### FL-3. The mirror list is a file list

**What:** The board is the default (`altLayoutFor`), and the list behind the
toggle is the same generic `NoteList` every shelf gets.

**Change:** The list mode draws file rows with three columns: the title, the
state, and Updated. Updated reads `remoteUpdated ?? mtime`, the same value
`TicketBoard` prints. State reuses the board's tones, so a row and a card
colour the same fact the same way. Sorting by State orders by
`stateCategory` in flight order (open, in progress, blocked, done), not
alphabetically.

The board stays the default and stays as it is. This only stops the list from
being the poor relation.

**Decision:**

**Notes:**

### FL-4. A mirror row's context menu

**What:** No row menu at all today.

**Change:** Open in new tab, Open in Jira (or Confluence), Copy link. Nothing
that writes: Qale never authors a mirror, so Rename, Move to and Delete must
not appear. The provider label comes from `providerLabelOf`, the same one the
page header uses.

**Decision:**

**Notes:**

---

## C. Context pages

### FL-5. `#tag` pages use the same row

**What:** `ContextView` renders `NoteList` sections in spine order, capped at
eight rows, with a "See all" link.

**Change:** The row swaps for the shared file row. The sections and the cap
stay: the order here is an argument (what we decided, then what we are working
on, then what we learned), and a sort rail would flatten it. So no sort rail,
no columns beyond the date, and the checkbox pick model stays, because on this
page a click means "read this".

This is the smallest ticket and the least necessary. It is here so the app does
not end up with a third row style.

**Decision:**

**Notes:**

---

## D. Activity: not this

`ActivityView` rows are not files. They are events with a sentence, a time, a
link back and a per-row undo. There is no path on some of them, nothing to
select, nothing to sort by, nothing to open into. A Finder list would be a
costume over a different thing.

What it can borrow, if anything: the row height and the type scale, so the
receipt reads as dense as the rest of the app. That is a 20-line change and it
is not part of this plan.

**Decision:**

**Notes:**

---

## Cleanup

Worth doing whether or not any FL ticket ships. CL-1 and CL-2 are what make the
FL tickets small.

### CL-1. One row component

Two rows exist with two selection models, two keyboard maps and two layouts:
`NoteRow` inside `app/NoteList.tsx` (two lines, checkbox gutter, wrapping
title, supersedes chain) and `app/DocumentRow.tsx` (one line, row-is-selection,
context menu, drag source).

**Change:** `components/FileRow.tsx`, one row with:

- `pick: 'checkbox' | 'row'` — which selection model the row obeys.
- `columns` — what goes in the right-hand rail.
- `actions?` — the context menu, absent on a page that does not organise.
- `depth` — the indent, 0 where the page is standing.
- `drag?` — the drag source, Documents only.

`NoteList` stays as the thin wrapper that maps rows and owns the `ul`.
`DocumentRow` becomes a call site, not a component.

**One thing to decide inside this ticket:** the supersedes chain. Only
decisions carry one, and a one-line row has no room. Either it survives as a
second line on the rows that have one, or it moves to the note page. Keeping
it means the row is not strictly one line, which is a real cost on Documents.

**Decision:**

**Notes:**

### CL-2. `lib/documents.ts` becomes `lib/files.ts`

Every function in it hardcodes `notes/` through `DOCUMENTS_DIR`:
`isDocument`, `documentFolder`, `docCount`. The tree walk (`visibleRows`,
`childFolders`, `docsAt`, `sortFolders`, `folderMtimes`, `toggleExpanded`) is
already generic and already tested (`test/documents.test.ts`).

**Change:** Take the directory as an argument. Keep the names the tests use, so
the diff is imports and one parameter. Rename `setDocumentsExpanded` to
`setExpanded` in `app-state.tsx` if FL-1 lands, since Memory will call it too.

**Decision:**

**Notes:**

### CL-3. Split `DocumentsView.tsx` (841 lines)

Out of it, unchanged:

- `SortRail` → `components/SortRail.tsx`. FL-2 and FL-3 both need it.
- `FolderListRow` and `NewFolderRow` → `app/FolderListRow.tsx`. FL-1 needs the
  first one.
- `moveDocs`, `deleteDoc` and their undo offers → `lib/move-documents.ts`.

What is left is the page: the level, the rows, the header, the composer.

**Decision:**

**Notes:**

### CL-4. `FolderView.tsx` is four pages in one (474 lines)

It holds the instant filter, the lifecycle facets, month grouping, two alt
layouts, the aimed drop target, the New button and the composer. The filter and
the facets are good and should stay. Two things collide once FL-2 lands:

- **Sort rail versus group-by.** Both order the list, and a page with a
  "date / flat" toggle AND a clickable Modified column is teaching two
  vocabularies for one job. My read: the sort rail wins, the toggle goes.
  Month grouping only earns its keep on meetings, and meetings open on the week
  view anyway.
- **The centred `max-w-2xl` column versus the full-width list.** Documents runs
  the full pane. A file list with a column rail has to, or the columns float.

**Decision:**

**Notes:**

### CL-5. One scheme for a remembered list setting

`qale.documents.sort` is one global key. `qale.folder-view.<dir>` is per
directory. If a shelf and a mirror each remember their own sort, make it
`qale.list.<surface>.sort` and write the parse and store once
(`parseDocumentSort` is already the right shape).

Note the packaged `file://` build keeps no localStorage
(docs/progressive-reveal, memory). Every read has to survive returning the
default, which `parseDocumentSort` already does.

**Decision:**

**Notes:**

### CL-6. `type FolderView` shadows `function FolderView`

Same file, line 33 and line 144. Rename the type to `FolderLayout`.

**Decision:**

**Notes:**

### CL-7. One section heading

`ContextView.tsx:87` and `FolderView.tsx:445` carry the same markup and the
same `pl-8` comment about the checkbox gutter. One `<ListSection>` component.
CL-1 changes that gutter, and with two copies one of them will be missed.

**Decision:**

**Notes:**

---

## Not doing

- Folders inside a Memory shelf. Qale files those notes; the user does not own
  the structure, so the app must not offer to let them.
- Drag and drop anywhere but Documents. Dropping a decision on a customer means
  nothing.
- More than two sortable columns. Tickets get a third read-only column, and
  that is the ceiling.
- A density setting. One list, one size.

## Order

CL-1, CL-2 and CL-3 first. After them every FL ticket is a small config on a
shared row. Before them each one is a copy of 300 lines.

Then FL-3 and FL-4 (mirrors, the clearest win and no navigation change), then
FL-1 and FL-2 (Memory), then FL-5 if the third row style still bothers anyone.

## Branch note

Written on branch `demo`, which has a large uncommitted working tree. Of the
files this plan touches, only `app/Sidebar.tsx` is currently modified there,
and no ticket needs to change it. The rest is clear.
