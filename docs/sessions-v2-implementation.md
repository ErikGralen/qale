# Sessions v2 — implementation notes

Companion to `sessions-v2.md` (the plan). Records what was built per phase, where the
implementation deviates from the plan and why, and the questions that came up while building
which are worth answering now that the code exists.

---

## Phase 0 — `dynamic` is real

**What changed**

- `isDynamicSkill(config)` (`packages/sessions/src/skill.ts`) — a skill is loadable on demand
  if it is a `guide` (reference is on-demand by definition, and the shipped guides declare no
  bindings) **or** it declares a `mode: dynamic` binding. This is the widening the plan asks
  for: before it, `describeBinding` rendered *"Available on demand"* into the Skills view for
  `synthesis` and `process-note`, and nothing could load them.
- `buildSkillBrief(config)` — the text a skill hands the model when it *arrives*, as opposed
  to being baked into the system prompt. A guide arrives as prose (`## Guide: …`); a session
  skill arrives as **rules now in force**, with its When/Read/Produce/Then, its guardrails and
  its checkpoint plan. Loading a session skill must not read as reference the model may weigh
  against what it was already told.
- `SessionHarness` now models "what is in force *now*" rather than a config frozen at session
  creation: `invoked[]`, `tier` (the highest any active skill grants), `checkpoints` /
  `gateOutput` (from the most recent arrival that declares a plan), `activeSkillName` (what
  cards are tagged with), `skillNames`.
- `advance_checkpoint` reads the plan live off the harness, and is registered for any session
  that can invoke skills — otherwise an arriving gate would lock proposing with no way past it.
- The session receipt records `skills: [chat, synthesis]` and a `Skills: chat → synthesis` line.

**Deviations / decisions**

- **An arrival raises the tier, never lowers it.** Invoking a read-only skill inside an
  outbound session does not strip the draft tools. Invariant 3 ("permissions attach to the
  material and the skill") is about a skill not being *able* to exceed what its material
  allows, not about arrivals being able to revoke. `external-transcript`'s "never propose a
  decision" survives as a red flag in prose, exactly as it does today.
- **A newly arrived checkpoint plan resets the counter.** A digest recorded against
  After-Meeting's plan must not unlock a gate Synthesis brought with it.
- **`use_skill` matches on the skill's invocation name first, filename second.** Guides used
  to be addressed by filename; both keep working.

**Known gap, closed in Phase 3:** raising the harness tier does not yet re-register the
propose/draft tools — the pi tool registry is fixed at session creation. Until Phase 3 an
arriving skill's *instructions* land but its *tools* do not.
