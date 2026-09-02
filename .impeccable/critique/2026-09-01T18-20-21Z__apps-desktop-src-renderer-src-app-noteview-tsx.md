---
target: the note view (cluttered, hierarchy off)
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-09-01T18-20-21Z
slug: apps-desktop-src-renderer-src-app-noteview-tsx
---
Method: dual-agent (A: design-review agent · B: detector agent)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Sync freshness and trust are visible; frontmatter autosave gives no confirmation, and a schema-rejected edit silently snaps back |
| 2 | Match System / Real World | 2 | Qale's system voice leads: "Processing: New" outranks the tracker's own "Blocked"; "State (as in tracker)" exists only to disambiguate Qale's jargon, then truncates |
| 3 | User Control and Freedom | 3 | Escape reverts everywhere, inline delete confirm, version history; no surfaced undo for frontmatter edits |
| 4 | Consistency and Standards | 3 | One component vocabulary, but two status-like rows, three date formats on one page, off-palette trust pills |
| 5 | Error Prevention | 4 | Genuinely excellent: readonly widgets never offered where the write would be rejected, reserved-key rejection, system keys lose the hover-X |
| 6 | Recognition Rather Than Recall | 3 | Labels on everything; but "3 more" (of what?), and state_category's color meaning appears nowhere on this page |
| 7 | Flexibility and Efficiency | 2 | Enter/Escape in fields only; no keyboard path to "Open the original" or to copy the ticket key |
| 8 | Aesthetic and Minimalist Design | 1 | The complaint is correct: 8+ flat rows, 4 provenance repeats, the blocked-state fact stated 3 times, all before the body |
| 9 | Error Recovery | 3 | Add-property errors are plain and specific; schema-rejected edits resync with no message saying why |
| 10 | Help and Documentation | 2 | Tooltip copy is good full sentences; nothing else explains Trust or Processing semantics |
| **Total** | | **26/40** | **Acceptable: heuristic 8 is the anchor dragging it down** |

## Design Specificity Verdict

**LLM assessment**: The page is split-brained. The content policies are deeply authored for Qale: per-type lifecycle vocabulary (Processing/Standing/Commitment/Stance, never a generic "Status"), mutability that never lies, a plain-sentence readonly reason with a door to Jira, ref chips in the wikilink voice. But the form those policies render into is a Notion/Obsidian properties-table clone: icon + label column + value rows, "Add property", "N more" fold, collapse chevron. Swap the accent and any PKM tool could ship this block unchanged. "Written in Ink" survives only in the Fraunces h1 and the wikilink chips; the TrustRow breaks the palette outright with raw Tailwind emerald-500/sky-500 pills, which DESIGN.md's Same-Hue and One-Voice rules name exactly.

**Deterministic scan**: Near-clean. One advisory finding: an 11px label at NoteView.tsx:155, off the DESIGN.md type ramp (Label is 12px). PropertiesBlock.tsx scanned clean; exit code 2, no false positives. Two things the scan tells us by contrast: the clutter is an information-architecture problem, invisible to a token detector, and the detector missed the off-palette emerald/sky trust pills the design review caught, so token drift is slightly under-reported.

**Visual overlays**: skipped. The view renders only inside the Electron app; no browser injection path exists in this session.

## Overall Impression

The complaint is confirmed and measurable: 16 distinct parse items sit above the first body word, with 3 interactive affordances competing for attention. Worse than the count is the inversion: the one fact a PO opens a ticket for (Blocked, Tom Devlin, since Aug 31) renders in the most muted voice on the page, while Qale's internal "Processing: New" sits first and carries the page's only visible edit control. The eye lands on "New" and reads a blocked epic as untouched. The single biggest opportunity: mirrors get a compact fact strip (state chip, assignee, changed date, Open in Jira) and everything else goes behind one fold; every other note type gets a per-type shortlist of at most 4 always-visible facts.

## What's Working

1. **The honesty layer is best-in-class.** Readonly rows never pretend to be editable, hidden keys stay in the file, "Nothing links here yet" as a disabled row, the one-sentence readonly reason ending in "Open the original". Operator-grade trust design in PropertiesBlock.tsx and properties-schema.ts.
2. **Per-type lifecycle naming** is real domain authorship most tools never do.
3. **The machine-tail fold instinct** ("3 more", HIDDEN_KEYS with written rationale per key) shows the team already believes frontmatter is noise. The mechanism just draws the line at "keys the schema doesn't know" instead of "what a reader needs".

## Priority Issues

1. **[P1] Hierarchy inversion on mirrors: Qale's bookkeeping outranks the tracker's facts.** Processing is first in the ticket schema and is the only editable row, while State and Assignee are muted readonly text. The fact the PO came for is visually last. Fix: give mirrors a headline fact strip on the badge row in NoteView.tsx: a colored state chip (state_category is hidden on the belief a chip is already on screen; on this page none is), assignee as a PersonChip, "Open in Jira". Demote Processing below the fold. Suggested command: /impeccable distill.
2. **[P1] One undifferentiated table for all note types, open by default.** PropertiesBlock renders every type through the same flat list; the brief asked for "status, assignee, maybe the link". Fix: per-type facts (≤4 rows, always visible) and the rest behind the existing Properties disclosure, collapsed by default for mirror types. properties-schema.ts already has per-type arrays; it needs a per-type rank, not new machinery. Suggested command: /impeccable distill.
3. **[P1] Summary editing is click-only and property inputs have no accessible names.** SummaryEditor's display state is a p with onClick, no button role, no tabindex: keyboard and screen-reader users cannot edit the summary at all. Property labels are plain spans not associated with their inputs. Fix in SummaryEditor and PropertyRow. Suggested command: /impeccable harden.
4. **[P2] The same fact is stated up to four times.** Title in tab, header leaf, h1, and summary; "Blocked" three times; Jira provenance four times (badge, lock sentence, Url row, Changed upstream). Fix: merge badge + lock line + Url row into one provenance strip ("Jira mirror · Open in Jira · changed Aug 31") and stop lifting a summary that only restates frontmatter. Suggested command: /impeccable distill.
5. **[P2] TrustRow renders on every note, including mirrors, in off-palette colors.** "Mark as checked" on a page the PO cannot edit asks them to vouch for Jira's data, and the emerald/sky pills are the only non-token colors on the surface. Fix: suppress TrustRow for mirror types (sync is the verifier there), retint the pills to Ledger Green and ink tokens. Suggested command: /impeccable polish.

## Persona Red Flags

**Alex (impatient power user)**: No keyboard path to "Open the original" or to copy "PAY-1"; the only fast affordance is the Processing select, the one control he never wants on a ticket. He must visually skip 5 rows on every ticket to find State, and the collapse preference is global, so folding properties for tickets also folds them on meetings. The Url row makes him read a full URL string to confirm it goes where the header link already goes.

**Sam (screen reader / keyboard-only)**: Summary editing is unreachable (see issue 3). TextValue's input announces as "edit text, Empty" with no field name. Truncated labels ("State (as in track…") recover only via title, a hover-only affordance. Positive: aria-expanded on the links fold, aria-labels on remove/edit buttons, native select, focus-visible restores the hidden hover-X.

**The mid-task PO (90 seconds after a call)**: The three facts they need (Blocked, Tom Devlin, since Aug 31) appear 2 to 3 times each but never together in one glance. "Processing: New" invites busywork that is not their question and is arguably the librarian's job. Nothing marks what changed since they last opened this note, on a product whose pitch is a memory that accrues.

## Minor Observations

- "Jira mirror" badge and "Mirrored from Jira" lock sentence sit two inches apart saying the same thing, against the one-term house rule.
- Three date dialects on one page: Trust "2026-09-01", Modified "9/1/2026, 8:10:35 PM", comment dates. Pick one.
- Tag chips keep their remove-X visible while reading; noise on a page that is 90% read.
- The label column truncates its own disambiguators ("State (as in track…", "Changed upstre…"); widen or wrap in PropertyRow.
- "3 more" doesn't say more of what; "3 sync details" would.
- The 11px backlinks label at NoteView.tsx:155 is off the type ramp (detector advisory); Label is 12px.
- The two doors to Jira (Url row glyph, "Open the original" text link) don't share a shape.
- LINKS_OPEN_KEY and COLLAPSE_KEY are global preferences; per-type defaults would serve the shared component better.

## Questions to Consider

1. What if a mirror had no properties table above the fold at all: serif title, a fact strip (Blocked · Tom Devlin · changed Aug 31 · Open in Jira), the body, and one "Details" fold for everything else?
2. The summary sentence is already the best briefing on the page. What if it is the designed object, generated to never repeat what the fact strip shows, and frontmatter is only its evidence?
3. Does Qale's own bookkeeping (Processing, Trust) belong on the reading surface of someone else's document at all, or does it belong to the librarian and the list views, appearing here only when something is wrong (stale, unverified)?
