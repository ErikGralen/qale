---
target: skills + agents presentation (buttons, lists, editing)
total_score: 29
p0_count: 0
p1_count: 3
timestamp: 2026-07-31T12-49-13Z
slug: apps-desktop-skills-agents-surfaces
---
# Critique: how Produktminnet presents Skills & Agents

Method: dual-agent (A: design review + live screenshots · B: detector + independent screenshots)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Agent life-signs excellent; Instructions editor autosaves with zero feedback |
| 2 | Match System / Real World | 2 | Skill titles are plain outcomes; connective tissue is jargon ("drafts outbound", "the model", unnamed "it") |
| 3 | User Control and Freedom | 3 | Picker has Esc/×/swap; Version history (the edit safety net) buried in ⋯ |
| 4 | Consistency and Standards | 2 | Skills rows are whole-row buttons with chevrons; Agents rows only open via a title link |
| 5 | Error Prevention | 3 | Rename can't break the invocation address; nothing stops deleting a load-bearing `## Produce` heading |
| 6 | Recognition Rather Than Recall | 3 | Every icon carries a word; picker summaries are hover-tooltip-only |
| 7 | Flexibility and Efficiency | 3 | `/` opens picker, cmdk nav, ⌘-click; no keyboard path to Skills/Agents views |
| 8 | Aesthetic and Minimalist Design | 4 | Genuinely restrained; nothing decorates |
| 9 | Error Recovery | 3 | Parse errors pinned in plain words with the fix; "Add one in Settings." is dead text |
| 10 | Help and Documentation | 3 | Empty states/footers teach in context; "Ask the librarian" help path dead without API key |
| **Total** | | **29/40** | **Good — solid foundation, address weak areas** |

## Anti-Patterns Verdict

LLM: passes the product slop test convincingly — one component vocabulary, single terracotta voice, no invented affordances. Real failure mode is insider writing: screens assume the skills/agents mental model the target persona lacks.
Deterministic scan: detect.mjs clean — 0 findings across SkillsView, AgentsView, SkillAgentPage, SkillPicker, AgentSwitch, Composer.
Overlays: skipped (Electron, no browser); both agents used the PM_SCREENSHOT self-capture affordance instead.

## Overall Impression

Bones unusually good: outcome-verb titles, agents that state their clock and heartbeat, broken files never silent. But the two moments where a novice commits — picking a skill they can't yet identify (summaries hover-only) and editing instructions (silent autosave, hidden history, unmarked load-bearing headings) — are the two least reassuring moments in the flow.

## What's Working

1. Outcome-verb titles + picked-chip loop (placeholder rewrites to "What should "Chase a commitment" work on?").
2. Agent life-signs in plain words ("Every 5 minutes… · last ran just now") + honest blocked reasons.
3. Broken-never-silent end to end: header "1 to fix", pinned plain-language parse errors with the fix, flagged-and-sunk in picker.

## Priority Issues

- [P1] Agents rows don't open like Skills rows (AgentsView.tsx:27-84): whole-row door + chevron; delete the footer apology. → polish
- [P1] High-stakes edit has no safety rail in view: silent autosave, Version history in ⋯, When/Read/Produce/Then unmarked though the system prompt is built only from them. Fix: standing "Saved automatically · every change is in Version history" line + visible structure for the four headings. → shape + clarify
- [P1] Skills view never defines the noun: unnamed "it" in group blurbs, "drafts outbound" badge unparseable, no intro sentence (Agents has one). → clarify
- [P2] "Add one in Settings." is dead text on both agent blocked banners while the session banner has a live Open Settings button. → polish
- [P2] Picker summaries are title-attribute-only (excludes keyboard/SR/first-timers); broken skill selectable with icon-only warning. Fix: highlighted-item summary strip in menu footer. → polish

## Persona Red Flags

Jordan (first-timer): dead click on agent row body; "the model" shorthand; skill body drops her into draft_confluence_update/remote_updated prose unframed; "Ask the librarian" creation path dead without API key; sidebar tooltip describes the pre-rework trigger model.
Alex (power user): no shortcut/⌘K verb to Skills/Agents views; no key hint on Start session; agent toggle mouse-only in practice.
Sam (SR/keyboard): AgentSwitch aria-label "${label} on" reads as "Librarian on, switch, off" (AgentSwitch.tsx:21); picker summaries unreachable; switch off-state is light track on white card. Otherwise strong (focus rings, role=switch, labeled entries).

## Minor Observations

- Broken-skill condition wears destructive-red in list but amber in picker (Amber Flag Rule: pick one).
- Broken skills sort first in Skills list but last in picker.
- Sidebar count asymmetry: "Skills (10)" vs "Agents".
- Home starter chips are a second verb taxonomy alongside playbook titles.
- Pick-applies-once-then-clears never told to the user.
- Weekly-update body asserts "Scheduled (Friday 15:00)" as prose; real schedule lives in Settings; no disclaimer (librarian's body has one).
- Agents have no "Run now" on their own page.
- Picker popover overlaps/clips the amber API-key banner in the right panel.

## Questions to Consider

1. Should "Agents" be a user-facing noun at all? One page — You run these · Always applied · Runs by itself — would delete a door, the affordance inconsistency, and half the vocabulary tax.
2. If buildSystemPrompt only reads When/Read/Produce/Then, why is the editor freeform? Four labeled sections would make the scariest edit near-unbreakable.
3. Does Jordan need the word "skill" at all? Titles carry the meaning; the noun may be pure tax until she authors one.
