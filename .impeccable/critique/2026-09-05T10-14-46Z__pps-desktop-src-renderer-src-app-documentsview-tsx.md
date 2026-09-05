---
target: the Documents page (Finder-inspired critique)
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
timestamp: 2026-09-05T10-14-46Z
slug: pps-desktop-src-renderer-src-app-documentsview-tsx
---
# Critique: Documents page (DocumentsView.tsx)

Method: dual-agent. Detector: 0 findings on 6 files. Browser overlay skipped (Electron, no browser automation); evidence from user screenshot: list 671/1016 px (66%) centred, 37 px row pitch, 9 rows, no column headers, no sort control, no document icons, ~316 px empty above the composer.

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | Sort order and date meaning unstated; a successful move draws nothing; expanded folders forget on tab switch |
| 2 | Match system / real world | 2 | Half of Finder: chevron and count yes, no document icon, no columns, single click both enters and opens |
| 3 | User control and freedom | 2 | No undo for move or delete on this page; a full folder cannot be deleted |
| 4 | Consistency and standards | 2 | note vs document nouns; ⇧⌘N is capture not New folder; two labelled header buttons |
| 5 | Error prevention | 3 | Name clashes refused per file with counted toast; full-folder delete blocked with reason written out |
| 6 | Recognition rather than recall | 1 | Right-click, drag, hidden checkbox, shift range, ⌘A, arrows: no on-screen cue |
| 7 | Flexibility and efficiency | 2 | No sort/filter/type-select; ⌘N ignores the folder; no keyboard rename; no New folder shortcut |
| 8 | Aesthetic and minimalist design | 3 | Clean hairlines, but centred 66% list under 60% dead space |
| 9 | Error recovery | 3 | Toasts quote the reason; "could not be deleted" gives none |
| 10 | Help and documentation | 2 | Tooltips do all teaching; nothing teaches drag or the menu |
| Total | | 22/40 | Acceptable |

## Design specificity verdict

Category-interchangeable. The authored work (two-target folder rows, recursive counts, context menu, drag to rows and crumbs, shift range, arrow keys) all lives in code and none of it shows on screen. Centred max-w-2xl list is a reading-page geometry on a browsing page; Finder is left-anchored, full-width, headed, dense.

## Priority issues

- [P0] The page hides everything it can do (nine interactions, zero affordances). Fix: Finder list-view header rail (Name / Modified as sort controls), document glyph on every row, checkbox visible at rest or Finder selection model (click selects, double-click/Enter opens), teach drag in empty-folder state. Command: clarify.
- [P1] Reader's layout on a scanner's page (DocumentsView.tsx:553 max-w-2xl centred, 37 px rows, shadowed composer under dead space). Fix: left-anchor at header edge, Dense rows ~28 px pitch, header rail. Command: layout.
- [P1] Folder and document rows share one voice (DocumentsView.tsx:141-144, NoteList.tsx:227,258). "1" beside "Sep 5" reads as a day. Fix: glyph per document row, folder name Ink + count Stone, "Modified" header, stop mixing frontmatter date and mtime (lib/contexts.ts:69-75). Command: typeset.
- [P2] Untrue copy: ⌘N tooltip says "in this folder" but App.tsx:150-154 creates at top; ⇧⌘N is capture; note vs document (SelectionBar.tsx:59, NoteList.tsx:277); two labelled header buttons; "documents" chip vs "Documents" bar. Fix: route ⌘N through the tab's folder, ⌥⌘N New folder, noun prop, icon-only New folder. Command: audit.
- [P2] Move and delete finish in silence (DocumentsView.tsx:376-391). Fix: reuse the sidebar six-second Undo strip. Command: harden.

## Persona red flags

Alex: no sort/filter/type-select, ⌘A only after one tick, ⌘N ignores folder, missing the 20 px chevron navigates away.
Sam: plain ul, no role=tree/treeitem/aria-level so nesting is invisible; bare count "1"; summary only in title attr; selection bar has no live region.
PO between meetings: seven rows all "Sep 2", unknown order, no type-select, nothing mentions ⌘K; composer invites a model call for a filename question.

## Minor observations

- New folder popover vs Finder's inline "untitled folder" (InlineRename exists).
- Lowercase "specs" beside title-cased documents; placeholder says "Specs".
- Composer / and @ hint is sr-only here, shown in session composer.
- Expanded set is component state (DocumentsView.tsx:257-260); keep it in the tab view body.
- In-folder empty state offers no New folder and no drag hint.

## Questions

- Quick Look style preview in the right half of the pane instead of air?
- Sort and filter refused on purpose: protecting structure, or the PM's ninety seconds?
- Docked "Ask the memory" as the closer on a finding page, or one quiet line until invoked?
