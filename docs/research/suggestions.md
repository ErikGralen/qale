# Suggestions from the three teardowns

Sources: `arkon-teardown.md`, `pm-skills-teardown.md` (deanpeters), `phuryn-pm-skills-teardown.md`.
All read on 2026-08-21. This file combines their action items into one list.

Licence rules:

- deanpeters is CC BY-NC-SA. Do not copy its text. Use ideas only.
- Arkon has no clear licence. Use ideas only. Do not copy code.
- phuryn is MIT. You can adapt its wording.

---

## Do now

### 1. Add `scenarios:` to skill frontmatter, with a conformance test

Named by both skill teardowns. This is the top item.

- Add a `scenarios` key: two or three verbatim user sentences per skill, plus negative cases.
- Use the phuryn formula: short "use when" clauses beside the verbatim sentences.
- Four edits move together:
  1. `packages/sessions/src/runnable.ts`: parse `scenarios` into `Runnable`. No error when absent.
  2. `packages/agent/src/runtime.ts`, `skillIndex()`: render scenarios after each summary.
  3. `packages/sessions/src/defaults.ts`: write scenarios for the six `model-picks-it-up` skills. Mirror into `vault-dev/skills/`. Append fingerprints in `shipped-versions.ts`.
  4. Add a test: every shipped `model-picks-it-up` skill must carry scenarios.
- Reason for the test: phuryn shows that an unchecked rule does not hold, even for a careful author.

### 2. Write an unattended-run contract as an `always` skill

From deanpeters `autonomous-investigation`. Take four clauses:

- Question budget: a hard cap, then proceed with labelled assumptions.
- Do-not-invent list: name what the model fabricates in each domain.
- Stable output schema, marked "do not reorder". Use a fenced output template (phuryn's form). Apply to `weekly-update` first.
- Empty-result rule: an empty result is a valid result.

### 3. Add Fact / Inference / Assumption labels to `synthesis`

- Label each claim with exactly one of the three. Put missing items in a gaps list.
- Check against `docs/evidence-layering.md` first. This can ship before the larger layering design.

### 4. Outline plus ranged read for M3 — decided: yes (Arkon ticket 3)

- Add an outline tool that returns the heading tree of a source.
- Give `vault_read` a page or line range.
- This replaces the truncation rule with navigation. It settles the shape of M3.

### 5. Build two new skills: spec/PRD and incoming-request

- Spec/PRD: named by both skill teardowns as the biggest hole. Build it from cited insights, live decisions, and a committed theme.
- Incoming-request: decode an inbound ask against the job behind it. It is the inbound twin of `commitment-check`.
- Dependency: the first of these is the "third writer". Promote the grounding form rule to a `_writing` always-on skill in the same change (`docs/evidence-layering.md`).
- Queue after these, in order: red-team, prioritize, release-notes. Then personas, roadmap, battlecard — each needs a product call first.

---

## Do later (parked, small)

- **Plan gate before fan-out.** Show the work list as an editable card before arrival or synthesis runs. Both Arkon (compilation plan) and deanpeters (search-plan gate) converge on this. Arkon ticket 1 decision: not right now.
- **Merge shrink guard.** Reject or flag a proposed body under 70% of the note it replaces. One ratio check. Arkon ticket 2 decision: not right now.
- **Request changes on a card.** Add "try again with this note" beside approve, edit, discard. Arkon ticket 4 decision: not right now.
- **Provenance audit.** Check that every writing path emits its source link, and that something fails when it does not. Arkon skipped this check and its provenance claim became documentation only. Ticket 5 decision: not right now.
- **Computed page maturity.** Grade notes seed to evergreen from length and link count. Display only. Arkon ticket 6 decision: not right now.
- **`estimated_time` in frontmatter.** Tell the user how long a session runs.
- **Input contract habit.** Write "supplied inline counts as answered — do not re-ask" into skill bodies.
- **Named failure modes.** Add a short pitfalls line per skill (name, consequence, fix).
- **Conflict rule for `discovery-guide`.** Say what to do when two accounts disagree. Disagreement is the stronger signal.

---

## Do not do

- RBAC, workspaces, multi-user machinery (Arkon). Qale is single-user and local.
- Embeddings / pgvector. Wait until FTS fails on a real vault (`mvp-strategy.md`).
- A command layer. It is a fifth door with nothing behind it (`runnable.ts`).
- Strategy canvases (SWOT, PESTLE, Porter, Ansoff, and the rest). Closed by PRODUCT.md: the user lives between meetings.
- Pedagogic-first skill bodies. Our skills are instructions the agent executes. If teaching lands anywhere, it lands on the approval card (UI decision).
- Career, resume, NDA, grammar, EOL, and AI-shipping skills. Filler in both libraries.

---

## Open questions

1. **Where does the routing eval run?** Scenarios give fixtures; receipts give the signal. Each case costs a live model call. A hand-run script with a key is probably enough.
2. **What feeds `prioritize` with numbers?** Account counts come from insight `evidence` lists. Reach and effort exist nowhere. Rank by evidence alone, or ask the PM at run time?
3. **Does a spec earn a note type?** `NOTE_TYPES` is a closed list of 14. A spec can ship today as type `note`. A new type is a domain change and a product call.
