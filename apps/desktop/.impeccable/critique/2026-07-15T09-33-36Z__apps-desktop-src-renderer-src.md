---
target: desktop app shell + home (improve design/UX)
total_score: 21
p0_count: 2
p1_count: 4
timestamp: 2026-07-15T09-33-36Z
slug: apps-desktop-src-renderer-src
---
Method: dual-agent (A: ad73ecfe30d89ee86 · B: a05deeaebfd3fa64e)

# Design Critique — Produktminnet desktop shell (`apps/desktop/src/renderer/src`)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | "Loading…" text instead of skeletons; no receipt at the moment of approve/capture; no pre-first-token indicator in ChatView |
| 2 | Match System / Real World | 3 | Strong PO vocabulary, but "golden answer", "stale claims", "Lands in notes/" never explained in-surface |
| 3 | User Control and Freedom | 2 | No undo after Approve/Discard; no edit-before-approve; session tabs silently dropped on restart |
| 4 | Consistency and Standards | 2 | "vault" vs "workspace" split; duplicate "After-Meeting" tab titles; h-9 vs h-11 headers; serif in chrome violates own Serif Boundary Rule |
| 5 | Error Prevention | 3 | Stale-write guard, spot-audit, earned auto-apply are excellent; undermined by global ⌘↵ collision |
| 6 | Recognition Rather Than Recall | 2 | ⌘K is search-only — no commands, no recents; Weekly Update session nearly undiscoverable |
| 7 | Flexibility and Efficiency | 2 | No keyboard path through the Inbox; no ⌘W / tab cycling; power path stops at navigation |
| 8 | Aesthetic and Minimalist Design | 3 | Distinctive and restrained; marred by logo overlapping wordmark, grey warning color, raw tool-output dumps |
| 9 | Error Recovery | 1 | InboxView accept/reject lack try/finally — one IPC error disables the whole Inbox; chat error is a bare red string |
| 10 | Help and Documentation | 1 | No first-run guidance; empty views teach nothing; help lives in title attributes |
| **Total** | | **21/40** | **Acceptable — significant improvements needed** |

## Anti-Patterns Verdict

**LLM assessment: not AI slop** — the system has a real point of view (one warm hue family, one terracotta voice, Fraunces as a content moment, copy with register). Two "leaning" pockets: uppercase tracked eyebrows used as scaffolding on four surfaces (Sidebar group headers/VIEWS, NoteView "LINKED FROM", RightPanel field labels) — the exact pattern DESIGN.md bans outside document content — and a landing whose single affordance is a generic "type here" box that serves the wrong job.

**Deterministic scan: 1 finding** — `side-tab` (border-l-2) at `packages/ui/src/styles/globals.css:178`. High-confidence false positive: it's the standard markdown blockquote convention inside rendered note bodies, not a card accent. The detector did not catch the eyebrow scaffolding (it lives in TSX class strings); the LLM review did.

**Browser overlays:** skipped — Electron target; no dev server running; browser injection not applicable in this run.

## Overall Impression

The trust mechanics (stale-target guard, spot-audit, earned auto-apply) are genuinely differentiated product design, and the visual identity has discipline. But the app currently front-loads its power scaffold and hides its first job: the landing is a capture box while "drop a transcript" — the ninety-second post-meeting job — has no affordance at all, the Inbox has no keyboard path, and the highest-stakes moment (approving an outbound write) is pixel-identical to the lowest. Biggest opportunity: make the home surface serve the core loop and make approval feel like the instrument the product claims to be.

## What's Working

1. **Trust mechanics as product design** — stale-write guard, spot-audit every 5 accepts (halting Accept-all mid-batch), auto-apply gated on an earned track record with receipts inline.
2. **A visual identity with discipline** — one hue family enforced in tokens, one semantic accent, flat-with-hairlines executed; the serif landing question is a memorable brand beat.
3. **Unified tab model + scoped ask** — docs, sessions, inbox, views share one tab vocabulary; FolderView's docked "Ask about {dir}…" composer is a quietly great power feature.

## Priority Issues

1. **[P0] The landing doesn't serve the #1 job.** "Drop a meeting" is copy, not an affordance — no file-drop target exists on Landing.tsx; drops only work inside IngestView's textarea. Fix: shell-wide dragover overlay routing into the dropMeeting flow + a visible primary path beside capture. → /impeccable shape + polish
2. **[P0] Global ⌘↵ double-fires.** App.tsx:62 opens Ask on every ⌘Enter with no target check; ⌘↵ is also capture-submit in Landing and QuickCapture. Capturing a note also opens an Ask tab. Fix: guard the window handler against editable targets. → /impeccable harden
3. **[P1] Inbox error leaves the app dead.** onAccept/onReject/acceptAll set busy=true with no try/finally; one IPC rejection permanently disables the queue. Fix: try/finally + inline retryable error row. → /impeccable harden
4. **[P1] "Approve, edit, or discard" is missing its middle verb.** acceptProposal(id, edited?) supports edits; the card renders only Approve/Discard. Outbound drafts ship verbatim or die. Fix: Edit affordance wired to the existing param; visually distinguish outbound cards; post-approve receipt. → /impeccable polish
5. **[P1] No keyboard path through the Inbox; tab strip keyboard-invisible.** No j/k/a/e/d, no ⌘W, TabStrip tabs are divs with no tabIndex/aria-selected/tablist, close button opacity-0 until hover. → /impeccable polish + audit
6. **[P1] Freshness — the product's proof of value — is painted in near-invisible grey.** chart-4 (oklch 0.68 0.02 68, ~2.4:1) colors stale badges, inference flags, spot-audit banner, and a 1.5px color-only sidebar dot. Fails WCAG AA and the "cite or decline" principle. Fix: mint a real warning token in the hue family; pair icons with text. → /impeccable colorize + audit
7. **[P2] The diff is wrong and unstyled.** renderDiff compares lines by index (one insertion marks everything below as changed); output is a monochrome pre. Fix: LCS diff with colored row washes. → /impeccable polish

## Persona Red Flags

**Alex (power user):** ⌘K is FTS-only (no commands/recents); no Inbox hotkeys; no ⌘W/⌘1–9; ⌘↵ collision hits him first; 800-char raw tool dumps slow scanning.

**Jordan (first-timer, empty vault):** vault/workspace terminology whiplash across four files; four smart views all returning "Nothing matches this view." on day one; "Skills (10)" opens a bare folder; HealthBar returns null exactly when it should teach; no sample content or guided first meeting.

**Sam (keyboard/screen-reader):** TabStrip unreachable by keyboard; textareas outline-none with no focus ring; stale state color-only with title-attr; icon-only buttons rely on title for accessible name; text-[10px] metadata below readable floor.

## Minor Observations

- Logo mark overlaps the wordmark in the sidebar header (first pixels a user sees).
- Serif Boundary self-violations: "Inbox zero" empty state and Settings h2s are Fraunces in chrome.
- Floating-Only self-violation: resting approval cards carry shadow-sm.
- Header heights drift h-9/h-11 across views.
- User chat bubble is a solid terracotta slab — the largest accent area, spent on a non-semantic element.
- MCP bearer token rendered in cleartext in Settings.
- IngestView drop zone gives no dragover highlight.
- Golden-answer's "No citations — will be flagged as inference" caveat buried in a title tooltip.
- Session tabs silently discarded on restart — at odds with "nothing silent".

## Questions to Consider

1. Why does an app whose home is "the Inbox, not a dashboard" launch to a capture box while a pending card waits? Should pendingCount > 0 make the Inbox the landing?
2. Where does week 6 actually look different from week 1? What surface makes the memory *felt*?
3. Should writing to Jira cost more than one identical click — target preview, named audience, a deliberately heavier gesture — so speed on internal cards stays cheap because external ones visibly aren't?
