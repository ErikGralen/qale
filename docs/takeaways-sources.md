# Takeaways from `/sources` — patterns worth stealing (and what to reject)

_Intermediate vision doc, 2026-07-14. One section per source. These are the reference products/patterns the concept borrows its body from; `/combined` supplies the soul (the PO's actual job)._

---

## open-knowledge.md (inkeep/OpenKnowledge) — the UI blueprint

- **"The file system is the database."** One set of plain markdown files that a rich WYSIWYG editor, any agent (via MCP), and any text editor operate on simultaneously. Git-versioned, portable, greppable. This is the substrate we adopt.
- **UI patterns to keep:** left file-tree panel; tab system; folder pages with properties/templates/listing + docked "Ask" composer (the screenshot Erik likes); properties panel rendering frontmatter as form inputs (nobody hand-writes YAML); Cmd+K palette with semantic search; agent activity panel with per-edit diffs and **selective undo**; per-folder schema (`.ok/frontmatter.yml`) so "schema lives closest to the action"; Timeline/history per doc with attribution.
- **Ideas to keep:** "the index is authored, not extracted" (anti-RAG); "every read is a briefing, writing talks back"; skills as content (a SKILL.md authored in the same editor); provisional→canonical promotion with a STOP gate; two plain-language config knobs recorded in frontmatter.
- **Why it's not our product:** document-generic. No typed PM objects, no pipeline into Jira/Confluence, no approval loop, no opinion about the PO's week. It's a great knowledge editor; our users need the meeting to *end up in the systems*.

## google-ok.md + google-ok-spec.md (Open Knowledge Format)

- OKF v0.1: a directory of markdown files with YAML frontmatter; only `type` is required; `index.md` for progressive disclosure, `log.md` for history, `# Citations` convention; consumers must tolerate unknown types and broken links.
- **Takeaway: make our workspace OKF-conformant.** Costs nothing, buys interoperability (Google's Knowledge Catalog and future agents can consume it), reinforces the no-lock-in trust story, and gives us the frontmatter/index/log conventions for free instead of inventing them.
- "A format, not a platform" — the knowledge survives us. Strong enterprise-trust line.

## karpathy.md (LLM Wiki)

- The operating pattern for the whole memory layer: **the LLM incrementally builds and maintains a persistent wiki; the human curates sources and asks questions.** Ingest / Query / Lint as the three operations; index.md + log.md for navigation; answers worth keeping get **filed back into the wiki** so explorations compound.
- "Humans abandon wikis because maintenance grows faster than value. LLMs don't get bored." — the reason a 1,000+-note workspace stays navigable: the agent is the librarian.
- Raw sources are immutable; the wiki is derived. Same split as our transcripts (sources) vs truth deltas/decision log (derived).

## gpersonal.md + gcompany.md (Garry Tan's GBrain tutorials)

- Personal → company brain on the same architecture: git as system of record, sources with per-user OAuth scoping, per-person folders/crons/skills.
- **Botmaster onboarding** (the adoption lesson): pre-populate the new user's slice, walk them through 2–3 wow flows, only then hand over free access. Cold-start conversion is a service act, not a feature.
- **Gap analysis as a trust feature:** the brain says what it doesn't know ("no CS notes filed since the renewal meeting") instead of inventing. Same DNA as our cite-or-decline.
- Operational conventions worth copying: `_filing-rules.md` (first-match-wins decision tree for where pages go), `_output-rules.md` (**deterministic links built from API data, never LLM-composed** — LLMs hallucinate Slack/Jira URLs), excluded-people privacy gate, dismissed-items state so re-scans don't re-flood.
- Cost curve context: a useful personal agent stack is ~$100–150/month today and falling — the DIY threat is real and cheapening, which supports the "be their memory via MCP" strategy.

## pm-superpowers.md (Claude Code plugin for PMs)

- **The direct precedent for typed sessions:** PM workflows as installable skills that run as interactive, multi-step *sessions* — "one round of questions at a time," synthesize back, flag gaps, then advance.
- **Guardrails as first-class UX:** Stopping Conditions (hard STOPs), Red Flags the AI must push back on, Completion Requirements (numeric quality bars gating save). Our session types should carry all three.
- Workflow chaining (each skill's output feeds the next; every skill ends with "next steps") and a separate **verification skill** (PASS / PASS WITH WARNINGS / FAIL; "no completion claims without fresh verification evidence").
- Distribution lesson: plugin-marketplace beats prompt library; framework-grounded beats vibes.

## pm-brain-for-cursor.md (forkable PM repo for Cursor)

- **Discipline layer over generation:** braindump-before-structure gate ("templates organize good thinking, they don't create it"), checkpoint-gated drafting (outline approved before draft), evidence tags (`cited/thin/absent/stale`), `[PLACEHOLDER]` instead of invented numbers, "what I found / what's still missing" transparency ritual.
- **Feature hub** pattern: one folder per initiative with stable numbered basenames as the atomic unit of work.
- Isolated critique subagents ("a 2 is a 2; never default to 'looks great'") and file-based subagent hand-off. Frontmatter as metadata contract (`confidence`, `last_verified`, `source_notes`).

## scout.md (agno-agi/scout)

- **"Navigation over search":** query each source natively and follow links the way a coding agent navigates a repo — rejects ingest-everything-and-embed. Matches OpenKnowledge's authored index and our Jira/Confluence live-read posture.
- **Context Providers:** each source exposes exactly `query_`/`update_` tools, with a quirk-owning sub-agent behind them — keeps the main agent's tool surface small across messy sources (Jira, Slack, Teams).
- **Each chat thread = a persistent session** (Slack thread timestamp as session ID) — the same session model our tabs need.
- Voice wiki: per-surface style guides (slack-message.md, email.md) with banned phrases, changed by PR not by the agent — exactly how recipient-tailored outbound should stay politically safe.
- Cite-tools-only discipline; closed-loop follow-ups (pending/done/dropped) feeding a morning digest.

---

## The one-line synthesis across all sources

OpenKnowledge/OKF/Karpathy supply the **substrate** (agent-maintained markdown memory humans can inspect), GBrain supplies the **operations** (scoping, crons, filing rules, onboarding), pm-superpowers/pm-brain supply the **session discipline** (guarded, checkpointed, framework-grounded workflows), and Scout supplies the **integration posture** (navigate sources natively, one session per thread). None of them is PM-native, closes the loop into Jira/Confluence, or has an approval primitive — that's the gap our product occupies.
