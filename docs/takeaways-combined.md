# Takeaways from `/combined` — what the evidence lets us build

_Intermediate vision doc, 2026-07-14. One section per document. The short version: 42 interviews converge on one product — a meeting→system agent (W2) that feeds a source-cited answer layer (W1) — with a hard set of design constraints that survive every re-analysis._

---

## ACTIONABLE-PAIN-POINTS-AND-MVP.md (the consolidated master)

- **The converged MVP:** W2→W1 as one flow — transcripts in → PO-approved Jira/Confluence updates + decision log → source-cited answers where questions are already asked. Pitch the concrete workflow, never a "brain" or portal.
- **Pain ranking:** P1 meeting→system gap (most volunteered, 37/40), P2 repetitive status questions (broad but 75% prompted; push-status failed twice in the wild), P3 manual admin/duplication, P4 untrustworthy AI (a design requirement, not a product), P5 recipient-tailored comms (feature, not company).
- **Hard "do NOT"s:** no new manual destination, no silent writes, don't replace judgment, respect safe spaces, cut capture/search-platform/prioritization/personal-todos/on-prem from v1.
- **Biggest evidence gap:** willingness to pay (1 explicit statement in 42 interviews). Paid pilots are part of the MVP, not a later phase.

## MVP-DECISION.md

- Resolves the only disagreement in the corpus: **W2 first** (least prompt-contaminated pain; W1's answers need W2's verified data to be trustworthy).
- Non-negotiables: draft-first, citations + "I don't know", safe-space mode, never a manually-fed KB, demo the concrete flow.

## MVP-ACTIONABILITY-FRESH-TAKE-2026-07-06.md

- **Adoption physics beats pain scores:** W2 is single-player (one PO adopts alone today); W1 is multi-player (needs stakeholders to change behavior — the corpus documents two failures of exactly that). Every product decision should favor single-player value.
- **The answer layer sells political armor**, not time savings: sourced, dated, machine-attributed answers depersonalize status conflict.
- **The moat is exhaust:** every approved card silently appends to a decision log no incumbent can reconstruct retroactively.
- **Kill criteria exist:** approval rate <40% or time-to-approve >24h by week 4 = extraction isn't trusted; approval fatigue is the death mode.
- **The 60-second debrief** (voice/typed post-meeting dump) covers the no-recording-culture majority of decision moments.

## PRODUCT-IDEA-PORTFOLIO-2026-07-07.md (ten doors, one engine)

- Every viable idea is a slice of one machine: **two primitives + one asset** — the approval card, cite-or-decline, and the decision-log exhaust.
- Ideas that shape the product concept directly: #1 Möte→system-agenten (plan of record), #2 **Produktminnet som MCP** (sell the memory to the customer's own Claude/Copilot — flips the DIY threat into a channel), #3 skill-pack funnel, #4 **Svarsutkastaren** (answer-*drafting* for the PO first; flip to stakeholder-facing only after observed correctness), #10 priced concierge (test payment this week).
- Every idea is single-player by design. Non-negotiables carried through all ten: approval cards, cite-or-decline, safe spaces, no new manual destinations, per-PO pricing with unlimited free readers.

## SYNTHESIS.md (42-interview evidence-weighted synthesis)

- Theme table with explicit disconfirmers; segments: small-co solo POs (radical simplicity), **mid-size 50–1,000 (AI-forward, our ICP)**, regulated enterprise (deferred — Copilot-only walls).
- The market is bimodal on AI: Filip ("nothing is time-consuming anymore") vs Henrik (no AI, hand-written notes). Design for both ends: MCP-native for the former, file-drop/debrief for the latter.
- Evidence-quality warning that governs everything: the corpus validates **pain far better than purchase**; closing enthusiasm is reciprocity-biased.

## meta-analysis.md (45 themes, 351 pain points, volunteered/prompted tagging)

- 48% of all pain points were interviewer-prompted — the volunteered themes are the trustworthy signal: **meetings load (11/14), meeting-notes→actions (8/11), estimation (100%), seats/self-serve visibility (100%), signal capture (100%), legacy debt (100%)**.
- Theme 22 (seats/licensing excludes stakeholders from product truth) is small but 100% volunteered and structural — Atlassian/Microsoft can't serve unlicensed readers without cannibalizing seat revenue. That's the pricing wedge.
- 36/41 interviewees run self-built personal workaround systems — revealed behavior that formal tools fail them, and a warning that structured tools don't stick.

## product-ideas-mvp.md

- First-generation idea list; its recommendation (meeting→actions→Jira first) survived every later re-analysis. Useful detail: Cristian's volunteered "golden answers" concept, Oscar's "folk ska inte behöva fråga mig."

## kevins-verktyg-vs-productboard.md

- **Productboard is a request machine; the winning logic starts in understanding** (what customers try to solve + vision + market → decisions → pushed out so the whole company pulls the same way).
- Positioning: differ on the **data model** (problems, language, decisions — not features) and the **direction** (knowledge out to where people already work, not into another SaaS login).
- "AI reads the feedback for you" is now table stakes (Spark). "Agent feeds meetings into a system" is not enough differentiation alone — the verified memory + where it's consumed is.
- The biggest competitor for the AI-forward customer is not Productboard — **it's that they build it themselves.** (Hence: be their memory via MCP rather than fight their Claude.)
