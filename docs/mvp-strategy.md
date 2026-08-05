# MVP strategy

Written 2026-08-03. This distills the three research teardowns (`docs/research/qm-teardown.md`,
`letta-teardown.md`, `supermemory-teardown.md`) into what to build before beta. The QM teardown is
already ticketed and mostly decided in `docs/qm-tickets.md`, so this doc covers what the two newer
teardowns add, plus the strategic frame that only appears when you read all three together.

Same format as the other ticket docs: one ticket per thing, write your call under **Decision**.

---

## What the research says about our position

**Nobody sells what we are building.** Supermemory's engine is closed, its local binary phones home,
is English-only in practice, and holds the whole corpus in RAM; its benchmark claims do not survive
reading. Letta is genuinely open and arrived at our exact layout independently, but it is an agent's
memory of itself, written unattended, and even they have not solved discovery at scale: their bet is
write-time discipline plus grep. The rest of the field spent 2025-2026 moving boundaries, not
licences. The question that discriminates is: which capability stops working when the network is
off. For us the answer has to stay "none".

**Where we are ahead:** the store is files and the audit log is git, nothing writes without
approval, we have real timestamps instead of ingest order, and we have structure (types, lifecycles,
typed links) that everyone else flattened.

**Where we are honestly behind, in two sentences.** We do almost nothing with that structure at
retrieval time: trust tiers are a chip, typed links are never traversed, freshness is prose, and no
tool has a limit. And we have no consolidation: nothing reads what happened in recent sessions and
asks what the vault should now say differently, which is the difference between a filing cabinet
and a memory.

## The thesis

The MVP job is not new machinery. It is two things:

1. **Make the structure we already have do work at retrieval time.** Small wiring jobs, mostly a
   day or less each (M1 to M4).
2. **Ship the one missing organ: a consolidation pass** that turns capture into memory, built on
   Letta's blueprint with our approval spine (M5).

Everything else waits, with a named trigger for what would revive it.

The promise a beta PM should be able to verify in their first week:

1. Your notes are files on your machine, and nothing changes without your yes. (Already true.)
2. Ask a question and get the current answer: confirmed above unverified, fresh above stale, in
   your language. (M1, M2, M3.)
3. After you work, the agent proposes what your memory should now say differently, card by card.
   (M5.)

---

# Tickets

## M1. Make trust affect ranking

**Today:** `packages/domain/src/notes/trust.ts` computes `unverified | machine | human`; the only
consumer is a chip in `PropertiesBlock.tsx`. Nothing writes `verified` automatically. The Inbox
sorts by nothing in particular, and `evidence_json` already sits on every proposal row.

**Do:** three wires. The approval path writes a `verified` entry when a human accepts a proposal.
`searchNotes` multiplies its BM25 score by the trust tier. The Inbox orders cards by evidence
count, so a card citing four meetings sits above one citing a stray line.

Roughly a day, and it turns a vocabulary we already built into a real signal on three surfaces.

**Decision:**

**Notes:**

## M2. Search that works in Swedish

**Today:** the FTS tokenizer is `porter unicode61`. Porter is an English stemmer, so Swedish word
forms do not match: "beslut" will not find "beslutet". A live bug for the core market, found while
comparing engines, independent of everything else.

**Do:** replace the stemming with something honest for a mixed Swedish and English vault. The
candidates are `unicode61` with no stemming plus prefix indexes, or a trigram tokenizer. Measure
both against vault-dev content before choosing; this needs a reindex either way.

**Decision:**

**Notes:**

## M3. Caps on what a tool can return

**Today:** `vault_read` returns the entire file and `vault_list` returns every matching row. Fine
at demo size, a context bomb at real vault size. QM ticket 4 (a full per-session budget) was
skipped by choice; this is the smaller version, two guards rather than a budget.

**Do:** cap `vault_list` rows, give `vault_read` an optional range, and make every truncation say
what it dropped and how to get the rest. Both newer teardowns land on the same rule: never
truncate silently, an unbounded prompt is worse than a truncated one.

**Decision:**

**Notes:**

## M4. Descriptions state purpose, not contents

**Today:** our `index.md` lines and note summaries describe contents. The description is the only
thing the model sees when deciding whether to open a file, so a contents summary answers the wrong
question.

**Do:** rewrite the `index.md` lines to answer "what kind of information is here", put the rule in
the prompts so new notes follow it, and borrow Letta's granularity check: a summary that needs an
"and" is probably two notes. Nearly free, and it is what makes the orientation layer worth
injecting at all.

**Decision:**

**Notes:**

## M5. The consolidation pass (the beta feature)

**Today:** the librarian is a repair agent: broken links, unfiled notes, stale references. All
structural. Nothing reads recent sessions and proposes what the vault should now say differently.

**Do:** Letta's blueprint on our spine.

- **Trigger at session end, never on a timer.** Matches the no-interval-sweeps rule we already set.
- **A selector stage on our `processing` ledger.** Pick the new and stale material, plus a bounded
  set of already-processed notes on the same theme for contradiction checking, and say out loud
  which candidates were skipped. Cheap pass chooses, expensive pass works.
- **Extract with their five filters,** near verbatim: durable not ephemeral, not already captured,
  generalizable ("the raw layer is already searchable, do not re-record it"), relative dates
  converted to absolute, memory versus skill.
- **The QM provenance rule:** never derive a preference from the assistant's own output. This
  matters most here, because a consolidation agent by construction reads its own previous work.
- **The "detail is load-bearing" caution written into its instructions** before it may tidy
  anything: in-context detail also does anchoring, priming, and reasoning templates, and a link is
  not a substitute. On contradiction, fix the stale entry at the source, never append the new
  version next to the old.
- **Output is `propose_*` cards, never direct writes.** Their unattended "Dreamed and made some
  memories" is the one part we deliberately do not copy.

Not in v1, revive after M5 has run on real vaults: replay slices as a formal mechanism, and an
archive tier for demotion.

**Decision:**

**Notes:**

## M6. The person page's "right now" half

**Today:** the person card shows stable facts plus last and next meeting, computed at read time,
which is the right instinct. The dynamic half is missing: what this person is currently in the
middle of.

**Do:** assemble at read time from data we already have: open todos where they are the
counterparty, meetings this week, recent decisions they took part in. Nothing stored. Of
everything on this list, this is the one a beta user notices first.

**Decision:**

**Notes:**

## M7. Things end with a reason

**Today:** nothing expires. Todos have a natural end and nothing prunes them; capture attention
rows sit forever once stale.

**Do:** the discipline, not the API: never delete, record why it stopped counting. A `wont-do`
style lifecycle plus a reason line for todos and capture rows, excluded from default views but
still in the file history. Git already gives us the audit log.

**Decision:**

**Notes:**

## M8. A `sync_runs` table

**Today:** sync state is typed (good) but there is no run history: no per-run counts, no trigger
type, no health signal for "when did this last work".

**Do:** one table: `status, triggerType (event | cron | manual), itemsProcessed, itemsFailed,
error, startedAt, completedAt`. Small, and it gives the connections page an honest health line.

**Decision:**

**Notes:**

---

## Deferred, deliberately

Each with the trigger that would revive it.

- **Prompt token budget and measurement.** Stays skipped (QM ticket 4) until a real vault exists
  to measure against; M3's caps are the interim insurance. Revive when a beta vault makes the
  always-on prompt feel heavy.
- **Replay slices and an archive tier.** Second pass on the librarian, after M5 runs on real data.
- **Embeddings** (`sqlite-vec` or a small local multilingual model). Only if FTS with a fixed
  tokenizer measurably fails on a real vault, measured on our own content. Never supermemory's
  binary; see their teardown, section 10.
- **Anthropic's memory tool contract over the vault.** Post-beta. Would make our memory surface
  standard rather than bespoke, and the six commands map onto operations we already have.
- **A facts layer.** Our unit of retrieval is the note. Revisit only if M1 to M4 do not hold up on
  real vaults.
- **Multiplayer and scopes.** Take nothing beyond the tighten-only layering already ticketed. QM's
  own codebase is the cost estimate: the audience machinery is the part that costs a codebase.

## The gates that are not research

Beta still blocks on the beta-launch decisions, not on this doc: signing (deferred by your call),
who pays for the model, and telemetry (TEL-1 to TEL-8, planned). Nothing here moves those, and
nothing here should wait for them either.

**Sequence:** M1 to M4 first, all small, a few days together. M5 is the one real build. M6 to M8
land alongside or behind it.
