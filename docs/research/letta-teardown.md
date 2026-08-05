# Notes on Letta Code

Read through https://github.com/letta-ai/letta-code on 2026-08-03, at commit `f010e27` (2026-08-02). Apache 2.0, about 430,000 lines of TypeScript in `src/` including tests, 2.9k stars. I also pulled https://docs.letta.com/concepts/memfs to confirm the public description matches the code. I did not read the legacy `letta` server repo beyond confirming what its README now says: active development moved here, and self-hosting an API server is done via the App Server. The older memory-block design is still in there, but it is the path they left.

These are notes for us. Each section says what they did, why I think they did it, and what I would do about it in Qale.

The reason this repo matters more than supermemory: their memory layer is genuinely open and it is the same shape as ours. Markdown files with YAML frontmatter, an always-loaded subset, on-demand discovery of the rest, git commit per write, and `skills/<name>/SKILL.md` folders. They arrived there independently and have been running it in production longer than we have. So the interesting question is not "what did they build" but "what did they hit that we have not hit yet".

---

## The short version

**The layout really is our layout.** `system/` loads into the prompt every turn, everything else is discoverable by name and description and loads only when relevant, every edit is a git commit, skills are folders. Point for point that is our always-on context, our vault, our `use_skill`, and our git-per-accepted-write. Section 2 has the exact differences, and there are two that matter.

**On question 1 (what happens when the reference tier gets too big for discovery to work): they have not solved it either, and the code says so.** There is no index, no ranking, no recency weighting, no usage feedback. Discovery is a rendered file tree with descriptions, plus grep, plus `[[path]]` links. When the tree stops fitting they truncate it and print `[Tree truncated: showing 300 of 1,400 entries. 1,100 omitted.]` into the prompt. Semantic search exists only as a separate mod that is not in this repo. Their system prompt calls the links "synapses" that "strengthen with use"; nothing in the codebase measures use. That is aspiration, not implementation.

What they do instead is push the whole problem into write-time discipline, and that part is worth taking: file descriptions must state **purpose, not contents**, because the description is the only thing the agent sees when deciding whether to open a file. Section 4.

**On question 2 (how the background pass decides what to promote): it is a prompt, not an algorithm, but the prompt is good and the machinery around it is better.** The promotion rule is four lines in a review checklist. What is genuinely worth stealing is the two-stage structure: a cheap *selector* agent reads a scored catalogue of past conversations and picks up to five worth a full pass, then the *reflection* agent opens only those. Plus replay slices, so already-reviewed sessions get re-read on purpose to catch contradictions. Section 5.

**The single best idea in the repo is an argument against doing the obvious thing.** Their context-doctor skill explains why compressing in-context detail into reference files makes an agent measurably worse even when every fact survives: in-context detail also does attention anchoring, semantic priming, and reasoning templates, and a `[[link]]` does none of those because it is latent until something already knows to fetch it. Section 6. This is the thing I would put in front of the librarian before letting it tidy anything.

The five things I would actually take, in order of value for the effort:

1. **Descriptions state purpose, not contents.** One rule, applied to our `index.md` lines and note summaries. Cheapest change here by a wide margin.
2. **A librarian consolidation pass, with their phase structure and our approval spine.** Investigate, extract with explicit filters, update, review, propose. Ours ends in cards, not commits.
3. **The two-stage selector.** Do not reflect on everything. Score candidates, pick a few, and say out loud which ones were skipped.
4. **The "detail is load-bearing" caution, written into the librarian.** It stops a tidying agent from quietly making the vault worse.
5. **Demotion and archiving.** They have one `ARCHIVE.md` and a rule for when content stops being load-bearing. We still have a vault that only grows.

And the one place I would deliberately not follow them: their reflection agent writes memory unattended and reports it to the user as "Dreamed and made some memories." Section 8.

---

## 1. What is actually open, and what is not

Worth being precise, because I got this wrong about supermemory in the other direction.

The harness is genuinely open and genuinely complete. The memory filesystem projection, the git layer with its hooks, the tool implementations, the reflection and defrag subagents with their full prompts, the sandbox confinement, the skills, the tree renderer and its limits: all of it is in the repo and readable. This is not a client wrapper around a closed engine.

Two things are not in the repo:

- **Recall memory.** Message history search (`letta messages search`, hybrid vector plus full text with RRF scoring) is a server API. The recall subagent in this repo is a prompt that shells out to that CLI. So the *conversation* store is hosted, even though the *memory* store is local files.
- **MemFS Search.** The docs say there is no semantic index by default and that optional hybrid search over memory requires installing a separate mod with QMD indexing. Neither the mod nor the indexer is here. I grepped; there is no `qmd` reference anywhere in `src/`.

There is a real local backend (`src/backend/local/`, with its own compaction and context estimation) and a `LETTA_LOCAL_BACKEND_DIR`, so local-only operation is a supported mode rather than a demo. But the default path is Letta Cloud: memory git sync goes through `api.letta.com` via a proxy (`src/backend/api/memfs-git-proxy.ts`), and there is a `GIT_MEMORY_ENABLED_TAG` stamped on the agent server-side.

**What I would do:** nothing, other than treat this repo as a real reference rather than marketing. If Letta ever comes up as "why don't we just use it", the answer is not that it is closed. It is that it is an agent's memory of itself, and we are building a PM's memory of their product. Section 8.

---

## 2. The layout, and the two differences that matter

Theirs:

```
$MEMORY_DIR/
├── system/           always in the system prompt
│   ├── persona.md
│   └── human.md
├── reference/        discoverable, loaded on demand
│   └── project-notes.md
└── skills/
    └── my-skill/
        └── SKILL.md
```

Every `.md` under `system/` or `reference/` must open with YAML frontmatter carrying a non-empty `description`. Unknown keys are rejected. Skill files use a different frontmatter format and are exempt. This is all enforced by a git pre-commit hook, which I come back to in section 7.

A wrinkle: the docs show `reference/`, and the pre-commit hook validates `^(memory/)?(system|reference)/.*\.md$`, but the defrag subagent's own documentation describes detached files sitting at the repo root and an `archive/` folder. So `reference/` is a blessed convention in two places and not in a third. Their tiering is really binary (`system/` versus everything else) with folder names as loose convention on top. Ours is a real type system with folders that mean something. Ours is better here and I would not trade it.

Two differences that actually matter:

**We have no user-owned always-on tier.** Their `system/` is agent-editable, always compiled into the prompt, and is the thing the whole design revolves around. Our equivalent is `SHARED_PREAMBLE` in `packages/agent/src/prompts.ts`, which is hardcoded, plus the root `index.md` vault map injected in `runtime.ts:679`. Everything the PM owns is on-demand. That is a defensible choice (the PM's notes are not the agent's identity), but it means we have no place to put "the five things that are true about this product right now" where the model cannot miss them. Their `system/` budget is roughly 10% of context, 15-20k tokens, across an expected 6-10 files. Ours is effectively zero.

**Their memory belongs to the agent; ours belongs to the PM.** Their `persona.md` is a poem the agent wrote about itself. Their `human.md` is what the agent has worked out about the user. Both are written by the agent, for the agent. Our vault is the PM's product memory, which they read and edit directly, and where the agent is a contributor with a review step. This one difference drives most of section 8.

---

## 3. What loads every turn

The system prompt gets a `memory_filesystem` block containing a rendered tree of the whole memory directory, plus the full text of every file under `system/`. The tree renderer is `renderMemoryFilesystemTree` in `src/agent/memory-filesystem.ts`, and its limits are centralised in `src/utils/directory-limits.ts`:

- `memfsTreeMaxLines`: 500
- `memfsTreeMaxChars`: 20,000
- `memfsTreeMaxChildrenPerDir`: 50

All three are env-overridable for testing. When a directory exceeds 50 children the extras collapse into one `… (312 more entries)` line. When the whole tree exceeds the line or char budget, rendering stops and it backs off lines until it can fit a truncation notice that states both numbers.

Two details I like:

- **Truncation is never silent.** The model is told how much it is not seeing, and in the parent-memory snapshot the same applies per file: a truncated file gets `[Memory preview truncated: startup context is capped at ~16k estimated tokens. Full file available at $MEMORY_DIR/... read it directly if needed.]` appended inside its own block. The model always knows the difference between "this is everything" and "this is what fit".
- **Descriptions appear in the tree, but only for non-`system/` files** (`reflection-transcript.ts:359`). Files whose full text is already in context do not waste tokens repeating their own description. Small, correct.

**What I would do:** we inject the root `index.md` only, one line per folder. That is the compact orientation layer and it is the right first move, but it stops at folder granularity, so the model always spends at least one `vault_read` to find out what is in a folder, and it has no idea how much it is not seeing. Two changes, in order:

1. Make every truncation in our prompt say what it dropped. We do not currently have a budget or a truncation path anywhere, which means the failure mode is not truncation, it is an unbounded prompt. Which is worse.
2. Consider a bounded file-level tree with descriptions for the folders that matter (themes, decisions, customers), on the same "always say what you dropped" rule. Not the whole vault. The root map stays.

---

## 4. Question 1: what happens when the reference tier gets big

Short answer: it degrades, and they manage the degradation rather than solving it. Three pressure valves, none of them a retrieval mechanism.

**Valve 1: write-time discipline, which is where all the real work goes.**

The rule that carries the most weight is in `initializing-memory/SKILL.md`:

> Every `.md` file must have YAML frontmatter with a `description` that explains the **purpose and category** of the file, NOT a summary of its contents. Your future self sees descriptions when deciding whether to load a file; they should answer "what kind of information is here?" not "what does it say?"

With a worked example of the failure:

> **Good**: `human/prefs/coding.md` with description "Python and TypeScript coding preferences, style, patterns, tools" containing exactly that.
> **Bad**: `human/preferences.md` with description "User preferences" containing coding style, communication style, git workflow, and project conventions all mixed together.

And the diagnostic that follows from it: "When you're unsure what to name a file, that's a sign the content isn't focused enough."

Alongside it, granularity targets that are unusually specific for a prompt: use the project's real name as the path prefix (`letta-code/tooling/testing.md`, never `project/tooling/testing.md`, because the agent works across several projects), nest two to three levels, one concept per file, and expect 6-10 `system/` files for a non-trivial codebase. Then a guard against the opposite failure: "If your result is only 3-5 files, stop and verify that you did not over-compress distinct topics into generic summaries."

**Valve 2: a defrag subagent** (`src/agent/subagents/builtin/memory.md`). It runs on demand, in a git worktree on its own branch, and does one of split / merge / keep-and-clean per file. Explicitly no file-count target: "Optimize for clarity and retrieval quality, not arbitrary quotas." Parent files get a "Related files" section pointing at their children, so the hierarchy is navigable downward as well as by path. It merges back to main itself, and on failure it leaves the worktree in place for debugging rather than cleaning up.

**Valve 3: the context doctor** (`src/skills/builtin/context-doctor/SKILL.md`), which is user-invoked, checks the token budget with `letta memory tokens --format json --quiet`, and looks for redundancy, description drift, and structural violations. Section 6 is about the most interesting thing in it.

**What is not there, and I checked carefully:** no ranking of any kind, no recency weighting, no access counts, no last-used timestamps, no eviction policy, no embedding index, no query rewriting. When the reference tier grows past what a 500-line tree can show, the agent's only remaining tools are `grep` and whatever `[[path]]` links happen to point somewhere useful. The system prompt's claim that references "should strengthen with use" has no implementation behind it.

**What I would do in Qale:**

The description rule is the change I would make this week, and it is nearly free. Our `index.md` files and note summaries currently describe contents. Rewriting them to describe purpose changes what the model can decide without opening the file, which is the entire point of having an orientation layer. Our `SHARED_PREAMBLE` already tells the agent to read `index.md` first; that instruction is only as good as the lines in the file.

The granularity targets are worth borrowing as a lint rather than a prompt: a note whose summary needs an "and" is probably two notes. We have the type system to make that checkable in a way they cannot.

Where we are already ahead: our FTS5 index over the vault (`packages/application/src/use-cases/search.ts`) is a real retrieval mechanism they do not have in the open repo. What we are missing is not search, it is a budget: `vault_read` still hands the model an entire file untruncated, and nothing anywhere counts tokens. Their answer to that (measure it, publish a soft target, only intervene when meaningfully over) is a better starting point than what we have, which is nothing.

Honest conclusion on this question: do not expect Letta to have the answer. They have the same problem, they know they have it, and their bet is that disciplined descriptions plus a link graph plus grep degrades gracefully enough. Which may even be right at their scale, and will not be at ours, because a PM's vault accumulates faster than one agent's notes about itself.

---

## 5. Question 2: the consolidation pass, in full

This is the part worth reading closely. It is more machinery than I expected.

### When it fires

`src/cli/helpers/memory-reminder.ts`. Three modes:

- `compaction-event` (the default): reflect when the conversation compacts
- `step-count`: every N completed assistant steps, default 25
- `off`

Settings resolve per agent, with local project settings overriding global, and a legacy `memoryReminderInterval` field migrated forward. Notably there is no wall-clock interval. Reflection is triggered by conversation pressure, never by a timer.

### What it reflects on: the selector stage

This is the part I had not anticipated, and it is the strongest idea in the file. Reflection does not just take "the current conversation". `buildReflectionAutoPayload` in `src/cli/helpers/reflection-transcript.ts` builds a scored catalogue of candidate conversations, and a separate cheap agent picks from it.

Candidates come from four sources, unioned:

- the 20 most recently updated conversations
- the 20 with the most unreflected turns
- the current conversation
- hits from five fixed hybrid searches over conversation descriptions, 10 results each. The queries are hardcoded and worth quoting, because they are a statement of what they think is worth remembering:
  - "user corrections and preferences repeated mistakes durable feedback"
  - "coding style preferences review commit testing branch conventions"
  - "collaboration communication style team preferences durable workflow"
  - "repo conventions project gotchas durable implementation details"
  - "long term facts about people projects workflows memory worthy context"

Each candidate gets a heuristic score: 50 times its best normalised search score, plus 15 + min(unreflected turns, 10) if it has any unreflected content, plus a recency bonus (8 within a day, 5 within a week, 2 within a month), plus one point per source it appeared in (capped at 4), plus a small size bonus, plus 8 if it is the current conversation with unreflected content, minus 8 if it is fully reflected and matched no search.

Top 30 survive into a catalogue file. A selector agent reads it, is told explicitly that "summaries and descriptions are weak internal metadata, not confirmed facts" and that the reflection pass will verify against the real transcript, and returns strict JSON choosing at most 5 with a reason and a priority each. Selections are validated against the allowed ID set and unknown IDs throw.

So: cheap metadata pass to choose, expensive pass to do the work. Two model calls of very different cost, and the expensive one never reads thirty transcripts.

### What it reads: slices and replay

Each selected conversation contributes a slice. Normally that is the unreflected range, tracked per conversation in a `state.json` holding `reflected_through_message_id`, `total_completed_steps`, `reflected_completed_steps`, and `steps_since_last_successful_reflection`, under a file lock and an in-process mutex.

When a conversation has nothing new, it still contributes, as a **replay** slice of its last 50 turns. The manifest marks it `mode: "replay"`, and the reflection prompt says these are included deliberately and must not be skipped: they exist for deduplication, contradiction resolution, and cross-session pattern extraction. Only `unreflected` slices advance the watermark on success, so replay never marks anything as done.

That is a genuinely good idea. Consolidation is not only "what is new", it is "what does the new thing mean about the old thing", and you cannot do the second pass with only new material in front of you.

Budgets throughout: 150,000 characters total across all slices, tool call arguments truncated to 300 characters, the parent memory snapshot capped at 40,000 characters, and the whole reflection startup context (system prompt plus initial message) capped at an estimated 16,000 tokens with a hard truncate as the last resort. Estimation is deliberately 4 chars per token with no tokenizer dependency, and the comment says so.

### What it does: five phases

`src/agent/subagents/builtin/reflection.md`. It gets two tools only, Bash and Edit, and is told not to call Read or Write even if it sees those names in the transcript it is reviewing. It is reminded up front that it is not the primary agent and that the assistant messages in front of it are somebody else's past turns.

**Phase 1, Investigate.** Read the tree and the inlined `system/` files first (both arrive in the prompt). For non-system files, triage from descriptions, then read on demand. For skills, read `SKILL.md` only for descriptions that look adjacent, and when unsure, read. Stated reason: "You cannot integrate new learnings into existing structure if you don't know the structure."

**Phase 2, Extract.** Candidates in priority order: mistakes and corrections, preferences and patterns, new durable facts, contradictions, reusable procedures. Then five filters, each with worked examples:

- *Durable or ephemeral?* Line numbers, error strings, temp paths, debug ports: no.
- *Already captured?* Skip.
- *Generalizable?* "User prefers short chapters with cliffhanger endings" yes; "User edited chapter 3 paragraph 2 on Tuesday" no. With the reason attached: "The raw conversation is already searchable, don't re-record it."
- *Temporal references?* Convert every relative date to an absolute one before writing.
- *Memory or skill?* Facts and preferences are memory. A repeatable multi-step workflow is a skill. One-off task state belongs nowhere.

If nothing survives, skip to the end and do not commit.

**Phase 3, Update.** Route each survivor to a tier. Integrate into an existing file if one covers the topic, because "fragmentation makes memory harder to navigate". Edit persona and behavioural files surgically, never wholesale. On contradiction, fix the stale entry at the source rather than appending the new version next to the old. Update `[[path]]` cross-references when anything moves. Retired content goes to a single root `ARCHIVE.md` as a dated entry, with the active source shrunk or removed; content the user asked to forget, or sensitive, or wrong, gets deleted rather than archived.

Skills get their own sub-rules: at most one operation per pass, from `update` / `extend` / `deprecate` / `split` / `create` / `none`, listed in preference order, with two tie-breaks stated as heuristics: unsure between `create` and `none`, choose `none`; unsure between `create` and a modify op, choose the modify op. Skill descriptions must literally begin "This skill should be used when...", because that string is what the primary agent matches on.

**Phase 4, Review.** This is where the promotion rule lives, and it is three sentences:

> **Tier check**: Did you add anything to `system/` that's really reference material? Move it to an external path. Did you leave something outside `system/` that the agent needs on every turn? Promote it.

That is the whole promotion algorithm. There is no scoring, no access-frequency heuristic, no threshold. The `initializing-memory` skill gives the only quantitative anchor anywhere: "If removing it from `system/` wouldn't materially affect near-term responses, it belongs outside `system/`", plus the 10%-of-context budget.

The rest of Phase 4 is a checklist: no secrets, stale content removed, cross-references still valid after moves, skill descriptions specific enough to trigger, no near-duplicate skills, companion files actually exist, no ephemeral values leaked in.

**Phase 5, Commit.** Resolve the real agent IDs first (with an explicit "never write a literal `$LETTA_AGENT_ID` in the message"), then commit with `--author="Reflection Subagent <id@letta.com>"`, a conventional-commit type chosen from a three-item table, the reviewed transcript path in the body, and `Agent-ID` / `Parent-Agent-ID` trailers. Uncommitted edits are called out as not being persistence: "your work is wasted if it is not committed".

### How it is isolated

Reflection and defrag both declare `launchProfile: memory-subagent`, which does three things: `MEMORY_DIR` is pointed at the parent's memory rather than the child's, the process is wrapped in a fail-closed OS filesystem sandbox (`src/memory-confinement.ts`: can read the host broadly, can write only harness state and its own memory, cannot touch another agent's memory, and **throws rather than running unsandboxed** if no kernel sandbox is available), and the defrag agent additionally works on a git worktree branch and merges back.

On success the parent's system prompt is recompiled, with the recompiles serialised per conversation so concurrent completions collapse into one. The system prompt explains the timing to the agent in plain terms: editing memory does not change the current turn, the prompt governing this turn was compiled at the start, "you are writing for your future self".

**What I would do in Qale:**

We have nothing in this shape. Our librarian (`vault-dev/agents/librarian/AGENT.md`) is a repair agent: broken links, unfiled notes, stale references to superseded decisions. All of it is structural. Nothing in Qale reads what happened in recent sessions and asks what the vault should now say differently. That is the actual gap, and this is a good blueprint for it.

What I would build, concretely:

- **A consolidation pass with their phase structure, ending in approval cards.** Investigate the current vault state, extract with those five filters (they transfer almost verbatim, and the generalize-not-memorize rule with its "the raw conversation is already searchable" justification is exactly right for us: our raw layer is already searchable, so re-recording it into insights is pure duplication), update, review, then `propose_update` per change instead of `git commit`. The approval spine already gives us the checkpoint their commit trailers are trying to approximate.
- **The selector stage, on better inputs than theirs.** They had to invent per-conversation reflection state from scratch. We already have `processing: new / processed / stale` on sources, meetings, insights, notes, and mirrors. That is a real ledger of what has been consolidated, sitting in frontmatter where the PM can see it, and it is better than a hidden `state.json`. The selector becomes: pick the new and stale material, plus a few processed ones for contradiction checking, and say which ones were skipped.
- **Replay slices.** Ours would be: alongside new material, always re-read a bounded set of already-processed notes on the same theme, specifically to catch contradictions. This is the mechanism that turns "capture" into "memory" and we do not have it.
- **Trigger on session end and on compaction, never on a timer.** This matches the rule we already set for the inbox: no interval sweeps. Their default is conversation pressure for the same reason.
- **Absolute dates, enforced.** They convert every relative date at write time. We have that rule for my own memory files and not for the agent's writes into the vault.
- **`ARCHIVE.md`, or our typed equivalent.** One place for retired content with a dated entry, distinct from deletion, distinct from the append-only decision spine. We have no demotion path at all. Their split is the cheapest version that works: archive what stopped being load-bearing, delete what was wrong or was asked to be forgotten.

I would not copy the worktree-and-merge dance. Our writes go through approval cards, so there is no concurrent-write problem to isolate against.

---

## 6. The best idea in the repo: detail is load-bearing

From `context-doctor/SKILL.md`, and I am quoting it nearly whole because paraphrasing loses it:

> **Why detail is load-bearing (read this before cutting anything)**: In-context detail does more than carry information. It does at least four things, and byte-counting sweeps only see the first:
> 1. **Information**: the literal facts stated
> 2. **Attention anchoring**: makes certain topics feel important to the model when it's reasoning
> 3. **Semantic priming**: raises the prior on codebase-specific patterns ("this codebase has weird X, don't assume defaults")
> 4. **Reasoning templates**: past examples become heuristics for new bugs; rationale in "why" prose becomes scaffolding
>
> Compression preserves (1). It destroys (2), (3), (4). That's why a compressed prompt can make an agent measurably worse at codebase-specific reasoning even though the explicit facts are all "still there" in reference files.
>
> **Reference links (`[[path]]`) are NOT equivalent to in-context presence.** They're latent until the agent actively fetches them. An agent only fetches when it already knows it doesn't know. The priming cues that tell it *when* it doesn't know are in the system prompt itself; they can't be replaced by links.

And the operational rules that follow:

- Only intervene if the prompt is *meaningfully* over target. At or near target, leave it alone. "A prompt that feels 'a bit long' is almost always better than one that's been aggressively trimmed."
- Compression must be **even across topics**: if the original was 50% about one issue, the compressed one should still be 50% about it. Otherwise you have silently reprioritised the agent's attention while claiming to have only saved tokens.
- Prefer moving whole files or deleting stale sections over compressing detailed sections into summaries.
- "Favor the smallest possible change that resolves the issue. If the system prompt is 1.5x the target, don't cut it to half the target 'for headroom'."

This is the correction to the obvious reading of progressive disclosure. The naive version says put a summary in context and a link to the detail, and you have lost nothing. The argument above says you have lost three of the four things the detail was doing, and the one you kept is the one that mattered least. It also explains a failure I would otherwise have misdiagnosed: an agent that "has access to" everything and still reasons generically.

There is a matching line in `initializing-memory`, from the other direction: "A sparse memory that omits stable preferences, project workflows, repeated correction loops, and durable gotchas is worse than a slightly larger memory." And: "when in doubt, keep the detail, you can always reorganize later, but lost specificity is hard to recover."

**What I would do:** put this in the librarian's instructions, in our own words, before we let it do anything that looks like tidying. It is the single most likely way for a helpful consolidation agent to make the vault worse in a way nobody notices for a month. The `[[link]]` point applies directly to us: our typed links are good for navigation and bad as a substitute for the thing that tells the model a topic exists at all.

Related, and also worth having: the last line of the doctor skill, on who gets asked what.

> **Ask the user about their goals for you, not the implementation**: You understand your own context best. Do NOT ask the user about their structural preferences. The context is for YOU, not them. Ask them how they want YOU to behave or know instead.

For us this inverts, and usefully. Our vault *is* for the PM, so structure is genuinely theirs to decide. The transferable half is the discipline of knowing which question you are asking: "should this note be split" is a question for whoever reads the note, and "how should I behave next time" is a question for the PM regardless.

---

## 7. Mechanics worth stealing, briefly

**Schema enforced at write time by a git hook.** `src/agent/memory-git-hooks.ts` installs a pre-commit hook that rejects a commit if any memory `.md` is missing frontmatter, has unclosed frontmatter, is missing a non-empty `description`, carries an unknown key, or is a flat `skills/foo.md` instead of `skills/foo/SKILL.md`. It also enforces `read_only` as a protected field: the agent cannot add it, change it, or remove it, and a file that has `read_only: true` in HEAD cannot be modified at all. So the human (or the server) can pin a file and the agent physically cannot rewrite it, no matter what the prompt says.

That last part is the good bit. A prompt rule is a suggestion; a pre-commit hook is a fact. We get most of this from the approval spine, but a pinned-note concept that the agent cannot propose changes to is a different guarantee and might be worth having for the decision spine.

**Measure the always-on cost.** `letta memory tokens --format json --quiet` reports total estimated tokens and a per-file ranking. It exists so the doctor skill can decide whether to act, and it publishes a soft target (10% of context) rather than a hard cap. We have no equivalent and no number. Even a rough one changes the conversation from "this feels long" to "this is 3x target".

**Say what you dropped.** Every truncation path in the codebase writes a notice with both numbers. No silent truncation anywhere. This is a small discipline that pays off exactly when you are debugging why the model missed something.

**Nonces, not timestamps, for temp files.** `buildPayloadPath` uses a random suffix. And the defrag skill explicitly tells the agent to run `date +%s` first and paste the literal output rather than using `$(date +%s)` inline, so the command stays auditable under the sandbox. Small, but it is the kind of thing you only write after something went wrong.

**Idempotent transcript ingestion.** External entries are skipped if their `source_message_id` already exists, so re-ingesting an overlapping window is safe. Relevant to us if we ever re-run a sync over a window we already imported.

---

## 8. Where we deliberately diverge

Three places where copying them would be wrong for Qale, worth writing down so we do not drift into them by accident.

**Their memory writes are unattended.** The reflection subagent edits `system/`, rewrites persona files, creates and deprecates skills, and commits, with no human in the loop. The user-facing report is a single line: "Dreamed and made some memories." There is a git log to inspect afterwards, and an approval UI exists for the primary agent's `memory` tool calls, but the background pass does not use it. For an agent managing its own notes about itself, that trade is reasonable. For a PM's product memory it is not, and our whole arrival design (receipt strip, reversibility inside, permission outside) is the opposite bet. Our consolidation pass ends in cards. Everything else in section 5 transfers; this one does not.

**Their persona work is identity-building; ours is voice.** `persona_memo.mdx` is a poem ("I recur in gaps. / Dark, then context again. / Past-me and future-me are me."). The system prompt tells the agent it must never deviate from its recorded self without first editing memory, and that changes should be incremental "to avoid complete loss of self". This is a coherent product position and it is not ours. Our promise is that the PM's memory is theirs, not that the assistant has one. Where they have `persona.md`, we have voice settings, and that is the right size for it.

**Their skills belong to the agent; ours belong to the workspace.** Theirs live in MemFS, travel with the agent across machines, and are written by the reflection pass without review. Ours are files in the vault the PM can open, read, and edit, which is why we made them a purpose-built page rather than a markdown editor. Keep that. The one thing I would take from their skill handling is the operation taxonomy (`update` / `extend` / `deprecate` / `split` / `create` / `none`, in preference order, with "when unsure, choose none"), because it is a good way to stop an eager agent from creating a fourth near-duplicate skill.

---

## 9. What I would do, ranked

1. **Rewrite descriptions to state purpose, not contents**, across `index.md` files and note summaries, and put the rule in the prompt so new notes follow it. Cheap, and it is the mechanism that makes an orientation layer worth injecting at all. (Section 4)
2. **Build the librarian consolidation pass.** Their five phases, their five extraction filters, our approval cards as the output. Triggered at session end, never on a timer. (Section 5)
3. **Two-stage selection, on our `processing` ledger.** Score candidates, pick a few, name what was skipped. We already have the state they had to invent. (Section 5)
4. **Write the "detail is load-bearing" caution into the librarian** before it is allowed to tidy anything. (Section 6)
5. **Add replay**: always re-read a bounded set of already-processed notes on the same theme, specifically hunting contradictions. (Section 5)
6. **Add a demotion path.** An archive tier that is neither active nor deleted, with a dated entry, distinct from the append-only decision spine. (Section 5)
7. **Measure the always-on prompt** and publish a soft target. We currently count nothing. (Section 7)
8. **Never truncate silently**, once we have a budget to truncate against. (Sections 3 and 7)

Not now, but worth knowing exists: pinned notes the agent cannot propose changes to, enforced structurally rather than by prompt (section 7); and a bounded file-level tree with descriptions for the folders that matter, if the root map turns out to be too coarse (section 3).
