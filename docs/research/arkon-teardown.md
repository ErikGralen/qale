# Notes on Arkon

Read through https://github.com/nduckmink/arkon on 2026-08-21. Python, FastAPI, about
10 MB of source, 1,230 stars, 20 open issues. The licence field says "Other"
(NOASSERTION), so treat the licence as unresolved: ideas only, never code. Created
2026-04-30, last push 2026-06-03, so it has been quiet for about eleven weeks.

It is a self-hosted enterprise knowledge hub plus MCP server. Seven Docker containers:
FastAPI API, Postgres with pgvector, Redis with arq workers, MinIO, and a Next.js
portal. The pitch: employees paste documents into chatbots by hand, so the company
loses consistency and control. Arkon compiles internal documents into a wiki and
serves it over MCP, scoped by department and role.

Why it is worth reading: it is the multi-user, server-side mirror of our loop. They
compile source documents into an interlinked markdown wiki with wikilinks, drafts,
review and version history, then serve it to Claude over MCP. Same subject as Qale,
opposite constraints: they are a hosted team server with RBAC, we are a single-user
local desktop app. So take the compilation machinery, ignore the org machinery.

These are notes for us. Each section says what they did, why, and what we do about it.

---

## The short version

**The best idea is the compilation plan as the approval unit.** Before any page is
written, the pipeline emits a list of proposed pages and a human approves the list.
Approving a plan is cheaper to read than approving N drafts, and rejecting it costs
no model time. Section 2.

**The best guard is the merge shrink check.** A model asked to merge two page bodies
quietly drops content. They detect it with a length ratio, nothing smarter. Section 4.

**The most useful negative finding: their headline provenance claim is documentation,
not behaviour.** The pipeline computes a byte offset for every claim, then the writer
prompt forbids the footnotes that would carry it. The verification step their docs
describe does not exist in the code. Section 5.

---

## 1. The MRP pipeline

Stages: MAP, REDUCE, plan review, REFINE, VERIFY, COMMIT. Files
`app/ai/mrp/{mapper,reducer,merger,writer,verifier,pipeline}.py`. Strategy by source
size: `single_pass` under 30K chars, `standard` to 200K, `hierarchical` above.

MAP chunks at section headings, about 20K chars with 1K overlap, up to 6 chunks in
parallel. Each chunk returns JSON of entities, concepts, claims, relations and topics.
Every claim carries an absolute byte offset into the source. Chunk results are saved
immediately to `source_chunk_extracts`. Resumability is one field,
`source.pipeline_phase`: a crash resumes at the phase, and MAP skips chunks already
extracted. That is the cheapest resume design I have seen, and it works because every
stage persists its output before the next stage starts.

REDUCE dedups entities: exact match on normalised names, then embedding cosine
similarity. Above 0.90 auto-merge, 0.75 to 0.90 asks the model. The disambiguation
prompt asks for "a JSON array of exactly [N] booleans (true = same, false =
different)" for the pairs. Cheap and batched. Then reconciliation against the existing
wiki: `KB_UPDATE_THRESHOLD = 0.85` updates a page, below `KB_MAYBE_THRESHOLD = 0.60`
creates one, and the band between is confirmed by the model. One model call then
produces the compilation plan.

## 2. The compilation plan is the approval unit

The plan is a list of proposed pages. Each entry has `action` (CREATE or UPDATE),
`slug`, `title`, `page_type`, `entity_names`, `related_kb_pages` and `priority`. It is
written to `source_compilation_plans` with status `pending_review` before any page is
written. A human approves, reorders, renames, removes entries, or rejects with a
reason. `MRP_AUTO_APPROVE_PLAN=true` skips the gate.

This is the finding with the most value for us. They approve the plan, we approve the
output. One dropped transcript can produce many cards in our arrival and synthesis
sessions, and the PO meets them one at a time. Our spawn fan-out in `packages/agent`
already builds a work list, which is a plan. We just never show it before it runs. A
"here is what this material will become, edit the list" card before the fan-out would
cut both review load and wasted model spend.

## 3. Evidence is pre-assembled, so the writer never scans the source

REFINE runs up to 4 page writers in parallel. Each writer gets a packet built by
`assemble_evidence()`: claims matched to the page's entity names by whole word,
case-insensitive. Each item has `statement`, `subject`, `confidence`, `source_excerpt`
(max 2000 chars), plus `absolute_offset` and `evidence_length`. The packet is a
numbered checklist, "[CONFIDENCE] subject" then the statement.

Simple pages (8 or fewer evidence items, existing content under 3K chars) take one
model call. Complex pages get a mini agent loop with a hard cap,
`WRITER_AGENT_MAX_STEPS = 10`, and three tools only: `read_kb_page`,
`read_source_excerpt` (max 10,000 chars), `finish`.

Two things to take: retrieval as a separate mechanical stage before the writing call,
and a hard step cap with a tool set of three. Both match how we already think about
spending the model, and the split keeps the expensive call small.

## 4. Merge, not overwrite, with a shrink guard

`merger.py`. When an UPDATE hits a page that already has content from another source,
a model call merges the two bodies. The prompt says "KEEP all facts, numbers,
procedures, names from both versions", "REMOVE exact duplicates", the merged page
"should be AT LEAST as long as the longer of the two inputs", and "Do NOT add any
facts not present in either version".

Then a sanity check: `BODY_SHRINK_THRESHOLD = 0.7`. If the merged body is under 70%
of the longer input, the merge is rejected and the new content is used instead.
`MERGE_TIMEOUT = 120` seconds. Source IDs are always unioned, never dropped.

The shrink guard is the portable part. A model asked to merge quietly drops content,
and length is a cheap, dumb, effective detector. We have the same exposure wherever a
card rewrites a whole note body. A shrink check on our propose paths would catch the
failure before the PO has to read a diff for it.

## 5. VERIFY is advisory, and smaller than the docs claim

`verifier.py` defines exactly four functions: `check_coverage()`, `check_conflicts()`,
`assess_page_status()`, `run_verify_phase()`, and one constant
`CONFLICT_SIM_THRESHOLD = 0.80`. Coverage: an entity mentioned 3 or more times across
extracts with no page covering it is logged as a warning. Conflicts: embed the title,
summary and first 3000 chars, take the top 3 similar pages, keep those above 0.80,
then ask the model "Do the following two texts contain contradictory factual
statements?" with a 30 second timeout. On a hit, it prepends an Obsidian callout to
the page body. The flag lives in the file, the same failure-as-repairable-state
pattern we took from OpenWiki. Nothing in VERIFY blocks the pipeline.

Now the negative finding, and it is the most useful one in this repo. `docs/WIKI.md`
describes a citation verification step that grades each `[^N]` footnote as SUPPORTED,
PARTIAL, NOT_SUPPORTED or CONTRADICTED, and marks unsupported text `[unverified]`.
That code is not in `verifier.py`. Worse, the writer prompt in `writer.py` says "Do
NOT include Citations or Footnotes sections. Do NOT use [^N] footnote markers." So
the pipeline computes a byte offset for every claim, then throws the link away at the
moment it writes the page. Their headline provenance claim is documentation, not
behaviour.

The lesson for us: provenance survives only if the writing step is required to emit
it and something checks. "Cite or decline" is exactly that promise, so our own
writing paths deserve the same audit we just gave theirs.

## 6. Page status is computed, not written

`assess_page_status()` grades a page seed / developing / mature / evergreen from
content length and wikilink count. Cheap, mechanical, no model call. For us that is a
computed maturity signal beside freshness and trust, and a way to make "the memory
has visibly accrued" measurable rather than a feeling. Small.

## 7. The MCP surface

`app/mcp/tools.py`, about 80KB, roughly 20 tools in tiers by permission: read
(`search_wiki`, `read_wiki_page`, `list_wiki_pages`, `read_wiki_index`,
`list_sources`, `get_source`, `get_source_outline`, `get_source_pages`,
`find_contacts`, `list_knowledge_types`, `get_knowledge_type_docs`), contribute
(`propose_wiki_edit`, `propose_wiki_create`), direct edit, review
(`list_pending_drafts`, `review_draft`, `approve_draft`, `reject_draft`), and a
revision cycle (`request_changes_on_draft`, `resubmit_draft`, `withdraw_draft`).

Two things to take:

- **The source drill-down pair.** `get_source_outline` returns the heading tree, then
  `get_source_pages(source_id, pages="12-14")` returns just that range. The model
  reads a table of contents, then asks for a range. That is our M3 ticket with a
  concrete shape: an outline tool plus a ranged read beats one truncation rule.
- **`request_changes_on_draft` and `resubmit_draft`.** Our Inbox has approve, edit
  and discard. It has no "not this, try again with this note" that keeps the card
  alive and records the round. Cheap to add, and it captures a correction we
  currently throw away.

One more line: out-of-scope reads return a hint with only the scope label and a
count, never titles. A good pattern for any place we must say "there is more here"
without leaking it.

## 8. What I would not take

- **RBAC, departments, workspaces, roles.** Qale is single user and local first, and
  PRODUCT.md says a hosted version is a rewrite, not a feature. Their access
  machinery is most of their surface area and it buys us nothing.
- **pgvector and semantic-only search.** They rank by embedding similarity, and their
  docs do not describe lexical search at all. Our position (mvp-strategy.md) stands:
  embeddings wait until FTS measurably fails on a real vault. Their thresholds are
  worth remembering if that day comes.
- **Skills as a distribution channel.** Their skills are versioned, department-scoped
  packages pushed to employees. Ours are files the PO reads and edits. Their model
  solves an org problem we do not have.
- **Seven containers.** Said once.

---

## Tickets

Same format as the other ticket docs: write your call under **Decision**.

1. **Plan approval before fan-out.** Show the work list as an editable card before a
   multi-card session runs (section 2). Medium: the list exists in `packages/agent`,
   the card and the gate are new.

   **Decision:** not right now

2. **Merge shrink guard.** If a proposed body is under 70% of the note it replaces,
   flag or reject the card (section 4). Small: one ratio check on the propose path.

   **Decision:** not right now

3. **Outline plus ranged read for M3.** Give `vault_read` a range and add an outline
   tool, so truncation becomes navigation (section 7). Small, and it settles M3's
   shape.

   **Decision:** yes

4. **Request changes on a card.** Add "try again with this note" beside approve,
   edit and discard, keeping the card and the round (section 7). Small to medium:
   the card needs a revision state.

   **Decision:** not rn

5. **Provenance audit of our writing paths.** Check that every path which writes a
   claim also emits its source link, and that something fails when it does not
   (section 5). Small to run, and it is the check Arkon skipped.

   **Decision:** not right now

6. **Computed page maturity.** Grade notes seed to evergreen from length and link
   count, shown beside freshness (section 6). Small, display only.

   **Decision:** not rn
