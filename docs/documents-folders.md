# Documents: a real file-and-folder page

Status: DF-1..7 built (round 1 2026-09-03, round 2 2026-09-05). All tests
green (365 desktop, 201 application). Live spot-checks: root level, folder
browse, drag-drop moves, the tree (expand in place, entering a folder), and
back/forward across folder levels. Context menus, the selection-bar Move to,
and the tree's arrow keys are not live-verified yet.
Delete this doc when the work ships.

Screenshot-run gotcha found while verifying: the QALE_OPEN deep link fires
only after the vault boots (seconds in), and the scratch profile keeps
qale.tabs.v3 in Local Storage across launches. A scripted click test must
clear Local Storage and use a long QALE_SCREENSHOT_DELAY, or the deep link
races the clicks and looks like a navigation bug.

## Why

The Documents page has the functions but not the model. Folders live only in a
left rail, the main list is a flat recursive dump, and a folder can only be made
by ticking documents first. Everyone arrives with the Finder/Notion/Drive model:
folders are rows you click into, you drag things onto them, "New folder" is a
button.

## Decisions

1. **Folders become persistent objects.** A folder exists when
   `notes/<folder>/index.md` exists or a document is in it. "New folder" writes
   the index stub. This reuses the OKF folder-hub concept (`isFolderIndex`), so
   every list already hides the file. The old rule ("a folder exists only while
   something is in it") is retired; `moveNote`'s comment must change with it.
2. **Browse by level, not by dump.** The page opens at the root of `notes/`.
   The list shows child folders first (icon, name, recursive doc count), then
   the documents at that level. Breadcrumb segments go back up. The flat
   all-documents view is gone; search covers cross-folder finding.
3. **The rail is pure navigation.** Folder tree only. The MoveRow morph and the
   tick-to-make-a-folder mechanic are deleted.
4. **Standard organize gestures.** Right-click menu on rows (open in new tab,
   move to, rename, delete), a Move to picker on the selection bar, and
   drag-and-drop onto folder rows, rail rows, and breadcrumb segments.
5. **Dependencies.** Drag-and-drop uses `@atlaskit/pragmatic-drag-and-drop`
   (headless, ~5 kB core, maintained; renderer-only so it goes in
   devDependencies). The context menu comes from the `radix-ui` package already
   in `@qale/ui` (new shadcn-style `context-menu.tsx`). The move picker is cmdk
   in a popover, the SkillPicker pattern. Nothing else is added.

## Tickets

### DF-1 Backend: folder create / delete / rename, create-in-folder

- `createDocumentFolder(ctx, { folder })` in
  `packages/application/src/use-cases/notes.ts`: slugify each segment
  (`documentFolderPath`), refuse if the folder already exists, write
  `notes/<folder>/index.md` (minimal orientation stub, match an existing folder
  hub's shape), reindex, commit.
- `deleteDocumentFolder(ctx, { folder })`: refuse while any document (or
  subfolder) is under it; remove the index file, drop it from the index, commit.
- `renameDocumentFolder(ctx, { folder, name })`: move every file under the
  folder (documents and the index) to the new path with `writeRaw`/`remove`,
  byte for byte like `moveNote`; reindex all; one commit. Basenames never
  change, so wikilinks survive.
- `CreateNoteInput` gains optional `folder` (type `note` only): the new file
  lands at `notes/<folder>/<date-slug>.md`.
- IPC: `folder:create`, `folder:delete`, `folder:rename` in `packages/ipc` +
  `apps/desktop/src/main/handlers.ts`, following the `note:move` pattern
  (same change broadcast so the tree refreshes).
- Tests beside the existing notes use-case tests.

### DF-2 UI kit: context menu + folder picker

- `packages/ui/src/components/ui/context-menu.tsx`: shadcn recipe on the
  `radix-ui` package, styled to match `dropdown-menu.tsx`; export it.
- `apps/desktop/src/renderer/src/components/FolderPickerMenu.tsx`: anchored
  cmdk menu (SkillPicker pattern) listing Documents (top level) + every folder,
  filter-as-you-type, and a "New folder <typed>" row when the text matches no
  folder. Props: `folders`, `exclude`, `onPick(folderKey)`. New files only.

### DF-3 Renderer: browse by level

- `lib/documents.ts`: derive folders from all document paths INCLUDING folder
  indexes (today the index files are filtered out before derivation, so an
  empty folder would be invisible). Add `childFolders(folders, key)`,
  `docsAt(notes, key)` (direct level only), and a recursive doc count.
- `DocumentsView.tsx`: current-level list (folder rows, then documents,
  newest first), breadcrumb of path segments, rail reduced to navigation.
  "New folder" beside "New document", always visible, inline naming, creates at
  the current level and navigates into it. "New document" creates in the
  current folder. Folder-only empty state stays "Nothing in this folder yet."
- Selection and the scoped composer keep working as they do.

### DF-4 Row actions

- `NoteList` rows: optional actions prop → context menu with Open in new tab,
  Move to (FolderPickerMenu), Rename (inline title edit → `note:rename`),
  Delete (confirm, `note:delete`). Only DocumentsView passes it.
- Folder rows: context menu with Rename folder (`folder:rename`) and Delete
  folder (`folder:delete`, disabled with a title explaining why while it holds
  documents).
- `SelectionBar`: optional `moveTo` prop; when present, a "Move to" button
  opens FolderPickerMenu and moves the ticked set (`note:move` per path,
  the existing failure toast).

### DF-5 Drag-and-drop

- Add `@atlaskit/pragmatic-drag-and-drop` to `apps/desktop` devDependencies.
- Document rows are draggable; dragging a ticked row drags the whole selection
  (drag preview shows the count).
- Drop targets: folder rows in the list, folder rows in the rail, breadcrumb
  segments. Highlight while hovered; drop moves via the same move helper as
  DF-4.

## Round 2: Finder-style navigation (DF-6, DF-7)

The two-pane layout read as a web app. Round 2 makes the page work like the
macOS Finder list view: no folder rail, one list where folders expand in place,
and the tab's back/forward arrows walk the folder levels.

Decisions:

1. **The rail goes.** One list carries everything. The breadcrumb is the only
   other navigation surface.
2. **A folder row has two targets.** The disclosure chevron on the left
   expands the folder in place: its children (subfolders first, then documents)
   render indented one level under it, recursively. Clicking the row itself
   enters the folder (the breadcrumb and history update). This is exactly the
   Finder split.
3. **Sort stays ours.** Folders first (alphabetical), then documents newest
   first, at every level. Finder mixes by name; our documents are dated and
   recency is what the PM scans for.
4. **The folder level lives in the view, not in component state.** The
   `documents` view body gains `folder?: string`. Entering a folder, clicking a
   breadcrumb segment, and the sidebar's Documents row all navigate, so every
   level is a history entry and the tab's back/forward arrows work. Re-clicking
   the level you are on must not grow history (`sameTarget`).
5. **Expansion is ephemeral.** The expanded set is component memory, not
   persisted (a packaged file:// build does not keep localStorage, and Finder
   memory is not worth a settings write).
6. **Everything from round 1 keeps working on the tree.** Selection, context
   menus, and drag-and-drop span every visible document; a nested document's
   "current folder" for Move to is its own parent. Drop targets are folder rows
   and breadcrumb segments (the rail targets are gone with the rail).
7. **Keyboard.** ArrowRight expands a focused folder row, ArrowLeft collapses
   it, Enter enters it. ArrowUp/Down keep moving focus as they do.

### DF-6 Navigation plumbing

- `state/app-state.tsx`: `{ kind: 'documents'; folder?: string }`, a
  `sameTarget` case (undefined and '' are both the root), `openDocuments`
  takes an optional folder (title: the folder's last segment, else
  "Documents").
- `App.tsx`: pass `folder` to DocumentsView; keep the stable `key="documents"`
  so expansion state survives level changes.
- `DocumentsView.tsx`: drop the local `folder` state; the prop is the level,
  `openDocuments` is how you leave it (folder rows, breadcrumbs, post-create
  navigation, post-delete step-up).

### DF-7 The tree list

- Delete the rail (`nav`, FolderRow) from DocumentsView.
- One list: recursive rows. Folder rows get a chevron button (rotates when
  open), the Folder icon, the name, and the recursive doc count on the right.
  Document rows are NoteList rows, indented by depth.
- NoteList must render rows at a depth (or DocumentsView interleaves NoteList
  segments per level — implementer's call, keep the shared NoteList generic).
- Selection ordering = visible order, so shift-ranges follow what the eye sees.
- Keyboard per decision 7, wired where the list already handles ArrowUp/Down.

## Not doing

- No sort menu, no facets, no second layout. The page keeps one shape.
- No counts anywhere except folder rows in the list, where the count is what
  says "container".
- No agent involvement: the composer stays a guest, the write policy already
  cards unasked writes under `notes/`.
