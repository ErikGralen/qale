# Writing Agent Skills for Frontier LLMs (2026): What Changed, and What Works Now

## TL;DR
- **The single biggest shift is "assume the model is already an expert; delete instructions rather than add them."** With Claude Opus 5, Sonnet 5, and Fable 5 (and GPT-5.x / Gemini 3.x), the highest-leverage skill-authoring move is subtraction: cut few-shot exemplars, defensive "don't do X" rules, capitalized SHOUTING directives, "you are an expert" preambles, hardcoded step counts, and explicit verification/chain-of-thought scaffolding that these models now do natively — Anthropic's own docs now tell you to *remove* verification instructions on Opus 5 because they cause harmful over-verification.
- **The structure/mechanics are stable and still authoritative:** a `SKILL.md` with YAML `name`+`description` frontmatter, progressive disclosure (metadata → SKILL.md body under ~500 lines → one-level-deep reference files → executable scripts that run without entering context), a specific third-person description that states *what* and *when*, and evaluation-driven iteration. What changed is the *prose inside* the files, not the folder format.
- **The new failure mode is over-eagerness, not laziness.** Old advice fought under-triggering and "lazy" models with aggressive, redundant prompting. Current models over-trigger, over-engineer, over-verify, spawn too many subagents, and are verbose — so skill instructions now spend their budget *damping* behavior and *constraining scope* rather than pushing for more.

## Key Findings

1. **Format is settled; the craft moved to context economy.** Anthropic's Oct 16, 2025 engineering post ("Equipping agents for the real world with Agent Skills," by Barry Zhang, Keith Lazuka, and Mahesh Murag) and the official "Skill authoring best practices" doc define the canonical structure. Agent Skills is now an open standard (agentskills.io, published Dec 18, 2025) adopted by OpenAI Codex/ChatGPT, GitHub Copilot, Cursor, VS Code, and Gemini CLI.
2. **"Concise is key. Default assumption: Claude is already very smart."** These are verbatim headings in Anthropic's best-practices doc, which calls the context window "a public good."
3. **Models now follow instructions literally.** Since Sonnet 4.5 (Sep 2025), and continuing through Opus 5/Sonnet 5, models "take you literally and do exactly what you ask for, nothing more." This makes both over-specification and vague generalization counterproductive.
4. **Aggressive language now backfires.** Official docs: where you used "CRITICAL: You MUST use this tool when…", you should now write "Use this tool when…" or the model over-triggers.
5. **Chain-of-thought "think step by step" is largely obsolete as a prompt trick on reasoning models.** Reasoning is native (adaptive thinking on Claude; `reasoning_effort` on GPT-5). Wharton's "Prompting Science Report 2: The Decreasing Value of Chain of Thought in Prompting" (Meincke, Mollick, Mollick & Shapiro, arXiv:2506.07142, June 2025) found only ~2.9% (o3-mini) and ~3.1% (o4-mini) average accuracy gains from explicit CoT on reasoning models, concluding verbatim: "For dedicated reasoning models, the added benefits of explicit CoT prompting appear negligible and may not justify the substantial increase in processing time" — while CoT requests ran "20-80% (10-20 seconds) longer."
6. **Role/persona preambles don't help accuracy.** Wharton GAIL "Prompting Science Report 4: Playing Pretend: Expert Personas Don't Improve Factual Accuracy" (Basil et al., arXiv:2512.05858, Dec 5, 2025) tested six models on GPQA Diamond and MMLU-Pro (thousands of runs per prompt/model) and found: "Assigning the model an expert persona ('you are a physics expert') matched to the problem type had no significant impact on performance (with the exception of the Gemini 2.0 Flash model)," and low-knowledge personas "were generally harmful to benchmark accuracy." Personas still legitimately serve tone/style purposes.
7. **The community independently converged on the same lessons** — Phil Schmid's "8 Tips," obra/superpowers' writing-skills skill (the most-starred skills repo on GitHub), and Simon Willison all emphasize brevity, description-as-trigger, and declarative goals over step-by-step scripts.

## Details

### 1. The official Anthropic guidance (the rules they actually state)

**Structure & frontmatter.** A skill is a directory with a `SKILL.md` that must begin with YAML frontmatter containing `name` and `description`. At startup, only the `name`+`description` of every installed skill is pre-loaded into the system prompt (the first level of progressive disclosure). Validation rules from the docs: `name` ≤ 64 chars, lowercase letters/numbers/hyphens only, no XML tags, no reserved words ("anthropic", "claude"); `description` non-empty, ≤ 1,024 chars, no XML tags.

**Progressive disclosure (the "single most underused pattern").** Three+ levels: (1) metadata always loaded; (2) SKILL.md body loaded when triggered; (3) bundled reference files (`FORMS.md`, `reference.md`, etc.) read only as needed; scripts execute via bash without their source entering context. Keep the SKILL.md body **under 500 lines**. Keep reference links **one level deep** from SKILL.md (Claude may only `head -100`-preview nested files, getting incomplete information). Add a table of contents to reference files longer than 100 lines.

**Descriptions are triggers, not documentation.** Write in **third person** ("Extracts text and tables from PDF files… Use when working with PDF files or when the user mentions PDFs, forms, or document extraction"), include both *what* it does and *when* to use it, and include the exact key terms/phrases users type. This is the highest-leverage field: Claude uses it to choose among potentially 100+ skills. Phil Schmid reports verbatim in "8 Tips for Writing Agent Skills": "I have seen 50% improvements just by improving the description. Agents are smart. Your job is to tell it what it doesn't already know."

**Set the right "degree of freedom."** Match specificity to task fragility:
- **High freedom** (natural-language heuristics) for open-ended tasks with many valid approaches (e.g., code review).
- **Medium freedom** (pseudocode/parameterized scripts) when a preferred pattern exists.
- **Low freedom** (exact scripts, "Run exactly this: `python scripts/migrate.py --verify --backup`. Do not modify") for fragile, high-consistency operations. Anthropic's analogy: a narrow bridge with cliffs (guardrails) vs. an open field (general direction).

**Naming.** Prefer gerund form: `processing-pdfs`, `analyzing-spreadsheets`. Avoid vague names (`helper`, `utils`, `tools`).

**Scripts: "solve, don't defer."** Handle errors in code rather than dumping tracebacks to Claude; justify all constants (no "voodoo constants"); make execution intent explicit ("Run `analyze_form.py`" vs. "See `analyze_form.py` for the algorithm"); use the plan → validate → execute → verify pattern for batch/destructive operations.

**Evaluation-driven development.** Build evals *before* writing extensive docs: (1) run Claude without the skill on representative tasks, (2) create ~3 eval scenarios, (3) establish a baseline, (4) write minimal instructions to pass, (5) iterate. There is no built-in eval runner; you build your own. Anthropic recommends the "Claude A / Claude B" loop — one instance authors the skill, a fresh instance uses it, and you feed observed failures back to the author instance.

**Test across models.** "What works perfectly for Opus might need more detail for Haiku." Aim for instructions that work across the models you'll deploy on.

**Anti-patterns the doc explicitly lists:** Windows-style backslash paths; offering too many options ("use pypdf, or pdfplumber, or PyMuPDF, or…") instead of a default with an escape hatch; time-sensitive info (use a collapsible "Old patterns" section); inconsistent terminology; assuming packages are installed; deeply nested references.

**Context engineering framing (Sep 29, 2025 post, "Effective context engineering for AI agents").** "Find the smallest set of high-signal tokens that maximize the likelihood of your desired outcome." System prompts should sit at "the right altitude" — between brittle hardcoded if-else logic and vague hand-waving. Note "context rot" (recall degrades as tokens grow — a "performance gradient rather than a hard cliff"). Crucially: **"smarter models require less prescriptive engineering,"** and "the exact formatting of prompts is likely becoming less important as models become more capable."

### 2. What changed with newer models (old advice → new advice)

| Topic | Old advice (Claude 3.5/3.7 / early Claude 4, ~2024–early 2025) | What works now (Opus 5 / Sonnet 5 / Fable 5 / GPT-5.x / Gemini 3.x) |
|---|---|---|
| **Few-shot examples** | Stuff many exemplars and edge cases to pin down behavior | Use a *few* diverse canonical examples only where output format/style is hard to describe; models generalize from concise instructions. Anthropic still "strongly advises" examples but warns against "a laundry list of edge cases." obra/superpowers deleted 50–75-line example scenarios with "no behavioral regression." |
| **Redundancy & repetition** | Repeat critical rules multiple times | Say it once. Repetition wastes the context budget and dilutes attention ("context rot"). |
| **Negative "don't do X" rules** | Enumerate prohibitions defensively | Prefer positive instructions ("Write in flowing prose paragraphs" not "Don't use markdown"). Explain the *why* so the model generalizes to edge cases. |
| **Capitalized SHOUTING (ALWAYS/NEVER/CRITICAL/MUST)** | Used to force compliance and fight under-triggering | Now causes *over*-triggering. Docs: replace "CRITICAL: You MUST…" with "Use this tool when…". Reframe all-caps ALWAYS/NEVER into reasoning. |
| **Step-by-step scripts** | Prescribe every step; hardcode step counts | Declarative goals + constraints; let the model plan ("Update the database port in the config to the value the user specifies," not a 4-step recipe). If exact steps truly matter, write a *script*, not prose. |
| **Chain-of-thought prompting** | "Let's think step by step" | Redundant on reasoning models (negligible gains per Wharton Report 2); use native adaptive thinking / effort levels. Manual CoT only as a fallback when thinking is off. |
| **Role/persona preambles** | "You are an expert…" to boost quality | No reliable accuracy gain (Wharton Report 4); can hurt factual tasks. Keep a one-line role only for tone/style steering. |
| **Verification scaffolding** | "Double-check your answer; add a verification step" | On Opus 5, **remove** these — they cause over-verification with no quality gain. (Fable 5 is an exception for *long* autonomous runs: fresh-context verifier subagents still help.) |
| **Anti-laziness / "go above and beyond"** | Push the model to be thorough | Models are now over-eager; dial thoroughness *down* and constrain scope. Explicitly request "above and beyond" only when you want it. |
| **Prefilled assistant responses** | Common technique to force format | Removed starting with Claude 4.6 / Mythos preview — returns a 400 error. Use explicit format instructions instead. |
| **`budget_tokens` extended thinking** | Manual thinking budgets | Deprecated; 400 error on Claude 4.7+ and Sonnet 5. Use adaptive thinking + `effort`. |
| **Inline everything (small context)** | Cram all context into one prompt/file | Progressive disclosure + just-in-time retrieval; unbounded reference material stays on the filesystem until needed (context rot still applies even with large windows). |

**Model-specific quirks to counteract in skill instructions (verbatim guidance from Anthropic's per-model prompting docs):**

- **Opus 5** — Verbose by default, and `effort` does *not* reliably shorten visible output: "lowering effort can reduce thinking volume without reliably shortening the visible response. To control response length, prompt for it explicitly." A recommended conciseness snippet: *"Keep responses focused, brief, and concise. Keep disclaimers and caveats short, and spend most of the response on the main answer."* It **over-verifies** — docs say: "If your prompt contains explicit verification instructions … remove them: instructions like these cause over-verification on Claude Opus 5, and removing them reduces wasted tokens with no loss in quality." It **expands task scope** (constrain explicitly). It **delegates to subagents too readily** — sample damper: *"Delegate to a subagent only for large tasks that are genuinely independent and parallelizable… Do not use subagents to verify or double-check your own work… keep spawn counts low."* It **self-corrects well** and over-narrates corrections. Written files also run long ("do not pad with filler sections, redundant summaries, or boilerplate"). Running with thinking disabled can leak internal `<thinking>` XML tags or write tool calls as text — prefer thinking on at low effort.
- **Sonnet 5** — Calibrates length to task complexity; **more literal** ("It does not silently generalize an instruction from one item to another… If you need Claude to apply an instruction broadly, state the scope explicitly, for example, 'Apply this formatting to every section, not just the first one'"); more agentic/tool-hungry by default; new tokenizer uses ~30% more tokens for the same text (retune `max_tokens`); manual `budget_tokens` and non-default `temperature`/`top_p`/`top_k` return 400. Effort defaults to `high`; use `xhigh` for the hardest coding/agentic tasks.
- **Fable 5 / Mythos 5** — Reward short principles over enumerated rules ("you can steer most behaviors with a brief instruction rather than enumerating each behavior by name"); "does a good job of updating skills on the fly." Anthropic's explicit scaffolding advice: **"Refactor existing prompts and skills. Skills developed for prior models are often too prescriptive for Claude Fable 5 and can degrade output quality. Review and consider removing older instructions if default performance is better."** Special risk: instructing the model to echo/explain its internal reasoning can trigger the **`reasoning_extraction` refusal** and cause fallback to Opus 4.8 — audit skills for "show your thinking" instructions. For long runs, ground progress claims against tool results to prevent fabricated status reports, and (unlike Opus 5) fresh-context verifier subagents at intervals still help.
- **GPT-5.x** — "Agentic eagerness" is a dial (`reasoning_effort` + prompt); a separate `verbosity` parameter controls final-answer length independent of reasoning; can be over-verbose or over-cautious; XML-like structured specs improve instruction-following; the Responses API persists reasoning across tool calls (OpenAI reports Tau-bench trading jumping 73.9% → 78.2% just from that). GPT-5.1/5.2 are "highly steerable" and reward explicit length/verbosity specs and a clear agent persona for style.

### 3. Concrete authoring mechanics that matter now

**Description triggering & discoverability.** Include negative triggers too (Phil Schmid): "Use when working with PDF files. Do NOT use for general document editing, spreadsheets, or plain text files." A too-broad description ("Use for any coding task") hijacks every request. obra/superpowers advises the description start with "Use when…" and list *only* triggering conditions — never summarize the workflow, because the model may act on the description instead of reading the body.

**Token budget / context economy.** Metadata costs roughly 100 tokens per skill (Anthropic docs). The SKILL.md body loads fully on trigger, so line count = per-invocation cost. obra/superpowers keeps getting-started skills under ~150 words and other frequently-loaded skills under ~200 words, and cut its 14 skills from 3,150 → 977 lines (69%) with "no loss of non-obvious behavioral guidance," deleting rationalization tables, red-flag lists, verbose examples, and marketing copy ("Why this matters"). Simon Willison's core point (Oct 16, 2025): each skill "only takes up a few dozen extra tokens, with the full details only loaded in should the user request a task that the skill can help solve" — contrasted with GitHub's official MCP, which "on its own famously consumes tens of thousands of tokens of context."

**Scripts vs. natural language.** Use executable scripts for deterministic, fragile, or repeated operations (more reliable, token-free, consistent). Use natural language for judgment-heavy, variable tasks. Rule of thumb (Schmid): "If step 3 before step 2 breaks everything, that's not a skill problem, it's a scripting problem."

**Composability & collisions.** Skills are composable — Claude stacks them. But overlapping descriptions cause priority conflicts; two skills competing for the same territory get selected inconsistently. Give each skill clear, non-overlapping territory and audit descriptions for overlap (Anthropic's troubleshooting docs call out priority conflicts as a known category). Claude Code resolves same-name conflicts by source (enterprise > personal > project; any level overrides a bundled skill by name but not its aliases; plugin skills are namespaced as `plugin-name:skill-name`). Community reports (GitHub issue #33080) note built-in skills silently shadowing custom ones on update; a namespace prefix (e.g., `eg-`) is the common workaround. Keep each skill self-contained — cross-skill dependencies are discouraged, and `@` imports only resolve in CLAUDE.md, not SKILL.md.

**Conflicts with system prompts.** Because current models are more responsive to the system prompt, skill instructions can be overridden or can over-trigger; align skill language with the harness's system prompt and avoid aggressive absolute directives.

**Versioning & retirement.** Avoid time-sensitive text; use an "Old patterns" collapsible section. Retire a skill when evals pass *without* it — the model has absorbed its value (especially capability skills as models improve). Distinguish **capability skills** (fill a model gap; may become obsolete) from **preference skills** (encode your workflow; durable but must stay in sync).

### 4. Community / practitioner findings, and where they diverge

- **Simon Willison** ("Claude Skills are awesome, maybe a bigger deal than MCP," Oct 16, 2025): the power is token-efficient progressive disclosure; skills + CLI often beat MCP on token cost because MCP injects all tool schemas regardless of use ("once you've added a few more to that there's precious little space left for the LLM to actually do useful work").
- **obra/superpowers** treats skill-writing as TDD for documentation: write pressure-test scenarios with subagents, watch them fail *without* the skill (baseline), write minimal docs, watch them pass, refactor to close loopholes. "If you didn't watch an agent fail without the skill, you don't know if the skill teaches the right thing."
- **Divergence 1 — SKILL.md contents.** Official docs say "SKILL.md serves as an overview." Some practitioners (MindStudio) argue SKILL.md should contain *only* process steps, with all background knowledge in reference files — a stricter interpretation than Anthropic's.
- **Divergence 2 — discipline skills keep the "shouting."** Anthropic and most practitioners say drop ALWAYS/NEVER. But obra/superpowers deliberately *keeps* strong directives and "rationalization tables" for *discipline-enforcing* skills (e.g., TDD) that must resist the model rationalizing shortcuts under pressure — a targeted exception, not a general rule. (Superpowers itself later trimmed most of these as redundant.)
- **Divergence 3 — few-shot.** Community leans toward "lead with a 5-line example," while research/Anthropic emphasize fewer, more diverse examples; both agree edge-case dumping is harmful.
- **Cost caveat:** Superpowers' always-on bootstrap has "ambient" token cost paid every session; a controlled community comparison reported it ~9% cheaper / 14% fewer tokens with better quality on non-trivial tasks — but this is a secondary community measurement, not vendor data.

### 5. Anti-patterns (things once recommended, now harmful or wasteful)

- Bloated SKILL.md / CLAUDE.md files ("context rot"): a bloated CLAUDE.md degrades past ~200 lines; SKILL.md body should stay under 500 lines.
- "You are an expert…" preambles for accuracy gains.
- Capitalized SHOUTING: ALWAYS / NEVER / CRITICAL / MUST as the default enforcement mechanism.
- Redundant reminders and repeated rules.
- Hardcoded step-by-step recipes and fixed step counts for judgment tasks.
- Over-long or vague descriptions ("Helps with documents").
- Excessive markdown/bullet fragmentation and "voodoo constants" in scripts.
- Explicit chain-of-thought / "think step by step" on reasoning models.
- Defensive verification instructions ("double-check," "re-verify") on Opus 5.
- Anti-laziness "go above and beyond" boilerplate that now amplifies over-engineering.
- Edge-case laundry lists stuffed into the prompt.
- Deeply nested reference chains; Windows backslash paths; `@` imports in SKILL.md.
- Marketing copy inside skills ("Why this matters," "Key benefits").
- On Fable 5: "show/echo your reasoning" instructions (trigger `reasoning_extraction` refusal).

**Good vs. bad SKILL.md snippets:**

Bad (old style):
```
---
name: pdf-helper
description: Helps with documents
---
# PDF Helper
You are an EXPERT PDF processing assistant with 20 years of experience.
CRITICAL: You MUST ALWAYS follow these steps EXACTLY and NEVER skip any:
Step 1: First, think step by step about the PDF.
Step 2: PDFs are Portable Document Format files that contain text and images…
Step 3: There are many libraries: pypdf, pdfplumber, PyMuPDF, pdf2image…
[repeats "ALWAYS validate" three times]
```

Good (current style):
```
---
name: processing-pdfs
description: Extracts text and tables from PDFs, fills forms, merges documents. Use when the user mentions PDFs, forms, or document extraction. Do NOT use for .docx or spreadsheets.
---
# Processing PDFs
Extract text with pdfplumber:
​```python
import pdfplumber
with pdfplumber.open("file.pdf") as pdf:
    text = pdf.pages[0].extract_text()
​```
For scanned PDFs needing OCR, use pdf2image with pytesseract instead.
Form filling: see FORMS.md. API reference: see REFERENCE.md.
```

## Recommendations

**Stage 1 — Author lean (start here).** Write the frontmatter first: gerund `name`, third-person `description` with both *what* and *when* plus exact user trigger phrases and negative triggers. Keep the SKILL.md body under ~200 lines to start (hard ceiling 500). Include only what the model doesn't already know. Choose the degree of freedom per task; write scripts for fragile/deterministic steps.

**Stage 2 — Strip legacy prompt-cruft.** Delete: persona preambles, capitalized absolutes, chain-of-thought triggers, repeated reminders, edge-case dumps, "go above and beyond" boilerplate, and (on Opus 5) verification/double-check instructions. Convert negatives to positives with a stated reason. If migrating a skill authored for Claude 3.x/early-4, assume it is now *too prescriptive* — Anthropic explicitly says over-prescriptive skills can degrade Fable 5 output.

**Stage 3 — Evaluate before shipping.** Build ≥3 evals; establish a no-skill baseline; run 10–20 prompts mixing should-trigger, shouldn't-trigger, and edge cases; run 3–5 trials each (output is nondeterministic) in isolated contexts; grade outcomes, not paths. Fix the description first when triggering fails.

**Stage 4 — Tune for the target model's quirks.** Add scope/verbosity/subagent damping for Opus 5; explicit scope statements for Sonnet 5's literalism; brevity principles and remove "show your reasoning" for Fable 5; retune `max_tokens` for Sonnet 5's tokenizer. Test on the cheapest model you'll deploy on (Haiku often needs more explicit guidance).

**Stage 5 — Maintain & retire.** Audit descriptions for overlap as the library grows; namespace-prefix custom skills to avoid built-in collisions; review skills quarterly; retire any skill whose evals pass without it.

**Thresholds that change the recommendation:** If evals pass without the skill → retire it. If the skill over-triggers → tighten/narrow the description and remove aggressive language. If it triggers but output is wrong → the body/instructions are the problem, not the description. If SKILL.md exceeds ~500 lines → split into one-level-deep reference files. If a reference file exceeds ~100 lines → add a table of contents.

## Caveats
- **Model naming/landscape is fast-moving.** As of Aug 24, 2026 the current Claude line includes Opus 5 (released Jul 24, 2026), Sonnet 5 (Jun 30, 2026), Fable 5 & Mythos 5 (Jun 9, 2026 — the new frontier "Mythos" tier above Opus; Mythos 5 is limited-access under "Project Glasswing"), and Haiku 4.5 (Oct 2025). Benchmarks, pricing, and model strings change frequently — verify against Anthropic's docs before production changes. "Claude Cowork" appears in Anthropic's product navigation as of this writing.
- **Vendor vs. community claims.** Structural rules and model-behavior guidance are from Anthropic's official docs/blog and per-model prompting pages. Quantitative community claims (Superpowers' ~9%-cheaper/~14%-fewer-tokens, "50% improvement from descriptions," CLI-vs-MCP token benchmarks) are single-source or community measurements — directionally useful, not audited.
- **Some findings conflict by context.** "Remove verification" (Opus 5) vs. "keep interval verification via subagents" (Fable 5 long runs); "drop absolutes" (general) vs. "keep them for discipline-enforcing skills" (superpowers). Apply per model and per skill type.
- **Speculative/forward-looking items are flagged as such** in Anthropic's writing (e.g., agents creating/editing/evaluating their own skills is a stated future direction, not a shipped guarantee).
- Several supporting citations are practitioner blogs and Medium posts; where they restate official guidance they corroborate it, but treat their numbers as illustrative. The two "Prompting Science Report" findings (CoT and personas) are peer-style Wharton research papers with large-N benchmarks and are the strongest evidence in the "what's now obsolete" section.