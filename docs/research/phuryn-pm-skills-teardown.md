# Notes on pm-skills (phuryn)

Read through https://github.com/phuryn/pm-skills on 2026-08-21. A plugin marketplace of PM skills for Claude Code and Cowork by Paweł Huryn (productcompass.pm): 68 skills, 42 commands, 9 plugins, v2.1.0, MIT. Counts verified against the clone.

A sibling teardown, `docs/research/pm-skills-teardown.md`, covers a different repo with the same job: deanpeters/Product-Manager-Skills. Where the two repos teach the same lesson, this file points there instead of repeating it. One difference matters up front: deanpeters is CC BY-NC-SA and we cannot reuse a sentence of it. This one is MIT, so wording we like is ours to adapt.

These are notes for us. Each section says what they did and what I would do about it in Qale.

---

## 1. What it is, and why it is shaped that way

A content business, not a system. 56 of the 68 skills end with a Further Reading section linking productcompass.pm articles and paid video courses. The repo is a lead magnet for a newsletter, which explains both the headline number and the filler (NDA drafting, resume review, grammar check). Distribution is the polished part: a Claude Code / Cowork marketplace that Codex CLI installs natively, plus copy-the-folder instructions for Gemini CLI, OpenCode, Cursor, and Kiro.

Same verdict as the sibling repo: these are stateless generators. Input is the conversation plus uploads, output is a document into a blank workspace, and every run starts cold. Ours read the vault and produce approval cards. Their skill bodies do not port. Their coverage map and two authoring habits do.

## 2. The trigger formula, and how it meets our `scenarios:` plan

This is their best discipline. Skill frontmatter is `name` plus `description`, nothing else, and every one of the 68 descriptions is "what it does" followed by literal trigger phrases: "Use when stress-testing a plan, pressure-testing a strategy, challenging assumptions, or preparing a doc for executive review." All 68, no exceptions.

Our routing signal is thinner. `skillIndex()` in `packages/agent/src/runtime.ts` lists each loadable skill to the model as its name plus its one-line `summary`, and the model calls `use_skill` when a session becomes that work. "Reads a stack of interviews and says what they add up to" is good picker copy and a weak trigger. A skill that never fires fails silently: the session just works freehand.

The sibling teardown already picked the fix and the name: a `scenarios:` frontmatter key holding two or three verbatim user sentences, with negative cases, and a lint in the style of their `check-skill-triggers.py`. I adopt that naming; no second field. What phuryn adds on top is the phrasing formula (short "use when" clauses beside the verbatim sentences, so the model matches on the task shape and not only on exact wording) and the proof that the discipline holds at 68 skills when every file carries it. Section 8 has the concrete change list, because `scenarios:` is useless until `skillIndex()` renders it into the prompt.

## 3. Fenced output templates

Every phuryn skill ends with a fenced block showing the literal shape of its output. Sixty-eight skills therefore produce predictable artifacts, and two runs of one skill match. Our produce-type skills describe their output in prose, so two Fridays of `weekly-update` need a model call to diff.

This is the same lesson as the sibling's "stable schema, marked do not reorder" clause, arrived at independently, which is a reason to trust it. It slots into next-step item 1 (the unattended-run contract): the fenced block is the cheapest form the stable schema can take, and `weekly-update` is the first body that should get one.

## 4. What they preach and do not practice

Two gaps between their CLAUDE.md and their files, both instructive:

- Their rules say skills need no placeholders. 54 of 68 skill bodies use `$ARGUMENTS` anyway.
- Their CLAUDE.md preaches progressive disclosure. Zero of 68 skills has a reference file or a script; all are single files, 266 to 1614 words.

Their validator checks frontmatter presence and name matching, not these rules, and an unchecked rule did not hold even for a careful author. That is the argument for making our `scenarios:` conformance a test and not a convention. For the record, we already do the thing they only describe: `vault-dev/skills/discovery-guide/` is a real two-file skill, `read-when-relevant`, with a question bank the agent loads by name.

## 5. Commands

Their 42 commands are the sibling repo's `commands/` idea at larger scale: user-triggered workflows that chain skills and own the checkpoints ("Here are 10 ideas. Pick 3-5, or I can carry all forward"). The sibling verdict was "probably not now" and phuryn does not change it. Our doors are the composer picker, `use_skill`, the scheduler, and the capture pipeline, and `runnable.ts` is explicit that a trigger with no dispatch site behind it is a promise the file cannot keep. A command layer would be a fifth door with nothing behind it.

The part worth keeping is copy, not machinery: where a skill genuinely forks, write the checkpoint into the body the way their `/discover` does, as a named moment where the PM narrows the list. `arrival` already does this in one direction ("what the PM asked for wins"); a new spec skill will need the other direction.

## 6. Coverage, ranked by what the vault already holds

Their nine plugins split by PM discipline: discovery (13), strategy (12), execution (16), market research (7), data analytics (3), go-to-market (6), marketing growth (5), toolkit (4), AI shipping (2). Not a taxonomy for us; our axis is what a skill does to the workspace. As a checklist it says the same thing the sibling teardown said: we cover capture-and-remember, both libraries cover decide-and-ship.

Tier 1, where the memory makes our version categorically better:

| Gap                        | Why ours wins                                                                                                                                                                                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spec / PRD                 | Named by both teardowns independently; the argument is in the sibling's section 4 and not repeated here. Built from cited insights, live decisions, and a committed theme, not a filled template.                                                                                                                               |
| Red-team                   | Their best single skill (`strategy-red-team`): steelman each claim, attack that, rank failure modes by impact, likelihood, and cost to test, and say plainly what holds up and what could not be assessed. Pointed at our graph it finds decisions that later insights contradict, which the vault can prove and a chat cannot. |
| Prioritize                 | Their `prioritization-frameworks` is a reference page about RICE, ICE, and Opportunity Score. Ours reads the account count straight off an insight's `evidence` list (the countable fact `docs/evidence-layering.md` built) and ranks real themes.                                                                              |
| Release notes              | Their generator asks for exported tickets. We hold ticket mirrors, the decisions behind them, and the voice skills, and `weekly-update` already enforces "no shipped claim without a mirror behind it".                                                                                                                         |
| Living personas / segments | They generate three personas once, cold. Ours would accrue evidence per segment with the extend-first mechanic insights already use.                                                                                                                                                                                            |
| Outcome roadmap            | Their skill converts feature lists into outcome statements. Our themes are already problems with a stance; `committed` maps to a roadmap line directly.                                                                                                                                                                         |
| Competitor battlecard      | Theirs is a template. Ours would sit on tagged sources and dated signals, and `propose_instruction` makes "tag competitor material" a one-approval standing rule.                                                                                                                                                               |

Tier 2, fine but no memory advantage: OKRs, sprint planning, retro, journey map, market sizing, North Star metric, interview scripts. Tier 3, skip: the toolkit plugin (NDA, privacy policy, resume, grammar), SQL generation, dummy data, product naming, and all of pm-ai-shipping.

The eight strategy canvases (SWOT, PESTLE, Porter, Ansoff, Lean Canvas, Business Model Canvas, Startup Canvas, value proposition) get the same rejection the sibling gave its four, for the sibling's reason: PRODUCT.md picks a user who lives between meetings, and a quarterly canvas suits a chat assistant, not this workbench. That question is closed.

## 7. Governance

They run real CI: a validator, a unittest suite asserting README counts match disk, version sync across ten manifests, and CHANGELOG-driven auto-release. We already have the piece that matters at our scale: the fingerprint test in `packages/sessions/src/shipped-versions.ts` that fails when `defaults.ts` changes without a new entry. The rest becomes relevant only if we ever ship skills as a public pack with its own versioning. Not now.

## 8. What to do

The sibling's five-item list stands as the roadmap; this teardown edits it rather than competing with it.

**Item 3 (add `scenarios:` and a routing test): extended with the concrete build.** The signal must reach the prompt, so this is four edits that move together:

1. `packages/sessions/src/runnable.ts`: parse `scenarios` into `Runnable` (string list, no error when absent).
2. `packages/agent/src/runtime.ts`, `skillIndex()`: render each playbook's scenarios after its summary, phrased on phuryn's formula (use-when clauses plus the verbatim sentences).
3. `packages/sessions/src/defaults.ts`: write scenarios for the six `model-picks-it-up` skills (arrival, synthesis, commitment-check, weekly-update, learn-the-product, process-note), each with negative cases in mind ("file this transcript" belongs to arrival, not synthesis). Mirror byte-identical into `vault-dev/skills/<name>/SKILL.md`, append fingerprints in `shipped-versions.ts`, and let `pnpm --filter @qale/sessions test` print the lines. Existing workspaces get the change through the shipped-skill upgrade path.
4. A conformance test in `packages/sessions/test/`: every shipped skill that declares `model-picks-it-up` carries scenarios. This is the lint section 4 argues for.

The routing test has its fixture (the scenario sentences) and its signal: a session receipt records every skill that was in force (`skills:` in the receipt frontmatter, `packages/sessions/src/receipt.ts`). What it does not have is a free way to run, since the pick is a live model call. That is the open question below.

**Item 1 (unattended-run contract): extended by one habit.** Take the fenced output template as the form of the stable-schema clause, `weekly-update` first.

**Items 2 and 4 (evidence labels, plan gate): untouched.** Nothing in phuryn improves on either.

**Item 5 (pick two missing skills): the first pick is now confirmed twice.** Both teardowns name spec/PRD as the biggest hole; the second pick, incoming-request, stands on the sibling's argument. Behind those two, this teardown supplies the queue, in order: red-team, prioritize, release-notes (all three read existing note types and produce existing card types), then personas, roadmap, and battlecard, which each need a product call on where the artifact lives before they are buildable. One dependency to note: `docs/evidence-layering.md` says the grounding form rule gets promoted to a `_writing` always-on skill "when a third writer needs it". The first skill from this queue is that third writer, so the promotion lands in the same change.

## 9. Open questions

Three survive. The rest closed against the source: the routing field and mechanism (`runtime.ts` `skillIndex()`, `use_skill`), whether loads are observable (receipt `skills:` frontmatter), whether a command object exists (it does not, and the old `on:`/`tier` keys are retired in `runnable.ts`), and the canvases (PRODUCT.md, section 6).

1. **Where the routing eval runs.** Scenarios give fixtures and receipts give the signal, but each case costs a live model call. A script with a key, run by hand when the pack changes, is probably enough; nothing in CI can do it honestly. Not settled.
2. **What feeds prioritize with numbers.** Account counts come free from insight `evidence` lists. Reach and effort exist nowhere in the vault; ticket mirrors hold state, not size. Rank by evidence alone, or ask the PM at run time? Checked `packages/domain/src/notes/` and the mirrors; nothing else is there.
3. **Whether a spec earns a note type.** `NOTE_TYPES` in `packages/domain/src/notes/frontmatter.ts` is a closed list of 14 and `propose_note` rejects anything outside it. A spec, a roadmap, or a competitor hub can ship today as type `note` (or leave as a `draft_confluence_update`); giving any of them a type of its own is a domain change and a product call, not a skill-copy change.
