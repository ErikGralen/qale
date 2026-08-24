# Notes on Product-Manager-Skills

Read through https://github.com/deanpeters/Product-Manager-Skills on 2026-08-21. It is a skill library for chat agents (Claude Code, Claude Desktop, ChatGPT, Codex) by Dean Peters. 77 skills at `skills/<name>/SKILL.md`, about 30k lines, version v0.84. Most skills also ship a `template.md` and worked examples.

**Licence warning, read this first.** CC BY-NC-SA 4.0: non-commercial and share-alike. We cannot copy their text into Qale, which is commercial. Frameworks are not copyrightable, their prose is. Read for ideas, write our own words.

These are notes for us. Each section says what they did and what I would do about it in Qale.

---

## 1. What it is

A library of prompts, not a system. There is no vault, no state, no memory. Each skill carries the whole framework because nothing else in the system knows anything. Their files average 386 lines and reach 935. Ours average about 60.

That difference explains everything else. Their content is portable, their machinery is not. Our skills say what to read from the vault. Theirs must teach the framework from scratch on every run.

---

## 2. Protocol skills (the best idea in the repo)

They have two skills that other skills declare they follow.

`workshop-facilitation` governs sessions where the user holds the context: one question per turn, entry modes (guided / context dump / best guess), progress labels like `Context Q2/6`, interruption handling, and a fast path when the user wants a single answer.

`autonomous-investigation` governs sessions that run without the user. It has seven clauses:

1. **Question budget.** A hard cap of three clarifying questions. When the budget is spent, proceed with labelled assumptions. This is what makes a skill schedulable.
2. **Search-plan gate.** Show a three-bullet plan before doing the work. Reviewing a plan costs ten seconds. Reviewing a wrong report costs ten minutes.
3. **Evidence labels.** Every claim carries exactly one of Fact, Inference, or Assumption. Things you could not find go in a separate gaps list, not a fourth label.
4. **Do-not-invent list.** Each skill names the specific things the model fabricates in its domain.
5. **Just Enough Mode.** Default output is short, sized to the decision. Verbose only on request.
6. **Stable output schema**, marked "do not reorder", so run N and run N+1 diff.
7. **Final Step block:** exactly four numbered next options.

Plus two rules outside the clauses: an empty result is a valid result, and confidence stacking (1 channel is a watch item, 2 is a working hypothesis, 3 or more is actionable, and conflicting channels are the most interesting case because someone is bluffing).

We solved the unattended half in code (`offered`, parked questions, sessions ending quietly). We wrote nothing the agent itself reads. Four clauses are worth taking:

- **Per-claim labels.** Same problem as `docs/evidence-layering.md`. Our synthesis writes insights with quotes but does not mark where the quote stops and our reading starts. The three-level label is cheaper than the layering design and could ship first.
- **The plan gate**, for arrival and synthesis. Forty files about to be filed is the case where a three-line plan beats a receipt afterwards.
- **Stable schema for `weekly-update`.** Ours rewrites free-form each Friday, so "what changed since last week" costs a model call. Pin the sections and it becomes mechanical.
- **Conflict as the interesting case.** `discovery-guide` says one loud account is not a pattern. It does not say what to do when two accounts disagree, and disagreement is the more valuable signal.

---

## 3. Frontmatter compared

Theirs: `name`, `description`, `intent`, `type`, `theme`, `best_for`, `scenarios`, `estimated_time`. All 77 carry all eight.

Ours: `type`, `starts`, `title`, `summary`, `can`, `audience`.

Two are worth adding:

- **`scenarios`:** two or three verbatim user sentences that should trigger the skill. Their `check-skill-triggers.py` lints these, with negative cases that must not match (example: "What's the weather in Boston"). For us it does two jobs. It sharpens `model-picks-it-up` routing, and it gives fixtures to test that routing. We have no test today that says a session about a slipping todo picks `commitment-check`.
- **`estimated_time`:** our sessions run for minutes and say nothing about it. Theirs tell you up front.

The rest we already have in better form. Their `description` does the routing, our `## When` does it in the body with more room. Their `best_for` is picker copy, ours is `summary`.

---

## 4. Skills we do not have

Ours act on the workspace: file this, tidy that, chase this promise, find the pattern. Theirs act on the craft.

Clearest holes, ranked by how much input the vault already holds:

- **A PRD or spec skill.** We produce insights, decisions and themes and have nothing that turns them into a document a team can build from. This is the biggest one.
- **Problem statement for a theme.** A theme folder is a problem. No skill writes the problem statement from the insights filed under it.
- **User story, and story splitting.** We mirror Jira tickets and cannot write a good one.
- **Opportunity solution tree.** Outcomes to opportunities to solutions to tests. Our theme, insight and decision graph is nearly that shape, so this is closer to a view than a skill.
- **Discovery interview prep.** We have a question bank, and we prep the people and the account. Nothing preps the goal: which segment, what we want to learn, what would falsify it.
- **Incoming request.** Decodes a Slack ping or a mandate into the literal ask against the job behind it, and reads the sender's power. `commitment-check` is the outbound twin. The inbound twin is missing, and POs live in that inbox.
- **Stakeholder mapping and engagement.** We have person notes and people chips and no skill that reads them.

Second tier, fits but needs sources we do not have: the scheduled delta monitors (`competitive-intel-watch`, `pricing-packaging-tracker`, `pestel-delta-monitor`). These are the shape our scheduler was built for, and we ship only `weekly-update` on it. They need web search, which we do not have.

Skip: the career suite (director and VP/CPO readiness), the interview-prep skills, the six-skill EOL suite, and the strategy canvases (PESTEL, Porter's Five Forces, Ansoff, SWOT). Those suit a chat assistant a PM opens once a quarter. They do not suit a workbench used in the ninety seconds after a call. PRODUCT.md picks a user who lives between meetings.

---

## 5. How they write

Their anatomy: Purpose, Input, Key Concepts, Application, Examples, Common Pitfalls, References. Ours: When, Read, Produce, Then.

Three habits worth taking:

- **The Input contract.** "Works best with / also useful / arriving empty-handed works too." Plus one rule we should write down: anything supplied inline with the invocation counts as answers already given, so use it and do not re-ask. Our sessions re-ask.
- **Named failure modes in Common Pitfalls.** Examples: "Report theater", "Schema drift", "Announcement inflation". Each names the failure, the consequence, and the fix. Our skills say what to do and rarely say what going wrong looks like. It fits the "reason next to each rule" line already in `newSkillFile`.
- **Two example universes.** Every skill ships worked examples from a SaaS domain and an industrial domain, so nobody reads the technique as SaaS-only. We have one universe (Tavla) and the same instinct.

One habit to reject: pedagogic-first. Their governing rule is that every skill must leave the human PM knowing more, and they closed a community pull request for stripping explanation to tighten copy. That is right for a teaching library and wrong for us. Our CLAUDE.md says cut the word that carries nothing, and our skill files are instructions the agent executes. The one place their idea lands is the approval card: the PO reading a card could learn why the agent proposed it. That is a UI decision, not a skill-file decision.

---

## 6. Categories

Their 13 themes are content buckets (market-intelligence 18, pm-artifacts 8, finance-metrics 7, discovery-research 7, eol-transition 6, and so on). Not useful to us at 11 skills.

Their `type` is the interesting part: Component (makes one artifact, 28 skills), Interactive (asks, then recommends, 29), Workflow (orchestrates other skills, 20). That is the shape of a skill. Our `starts:` is how it fires. The two are orthogonal. Our roster already has four unnamed shapes: skills that run on material, house rules always in force (`_language`, `voice-*`), reference the agent loads when relevant (`discovery-guide`), and agents. If the roster grows past about twenty, the Skills page needs grouping, and it should group by shape rather than by topic.

---

## 7. Tooling

`check-skill-triggers.py` is a lint we do not have. It checks that the description states a trigger, fits the length limit, will not be truncated, and that negative cases stay unmatched. We already flag broken skills on the Skills page (`broken-demo`), so the hook exists. A trigger audit catches the real failure, which is a skill that never fires.

Other scripts: `check-skill-metadata.py` (strict conformance), `find-a-skill.sh` (ranked discovery), `test-a-skill.sh --smoke`, `generate-catalog.py` (writes `catalog/skills-by-type.md` and `skills-index.yaml`).

Their `commands/` directory holds named routes, such as `/discover`, which chains five skills in order. Lighter than our `spawn`. Probably not now.

---

## 8. What to do next

Five items, in order:

1. **Write an unattended-run contract as an `always` skill.** Take the question budget, the do-not-invent list, the stable schema, and the empty-result rule.
2. **Add Fact, Inference and Assumption labels to `synthesis`.** Check it against `docs/evidence-layering.md` before building the bigger design.
3. **Add `scenarios:` to skill frontmatter**, and a routing test built on them.
4. **Add the plan gate to `arrival` and `synthesis`.**
5. **Pick two of the missing skills.** The spec or PRD skill and the incoming-request skill both sit on material we already hold, and neither needs a new connector.

Nothing here is built. The next step is to pick from the list above.
