# What to build from the OpenWiki teardown

Written 2026-08-07, out of `docs/research/openwiki-teardown.md`. Same format as the other ticket
docs: one ticket per thing, write your call under **Decision**. Nothing here gets built until its
Decision field says so.

This does not replace `docs/mvp-strategy.md`. That doc is still the beta plan, and where the two
touch I say so in the ticket rather than restating it.

---

## What the teardown actually changes

Three teardowns in a row (Letta, supermemory, now OpenWiki) have all landed on the same retrieval
answer: an index plus descriptions plus a link graph, no vectors. OpenWiki is the strongest version
of that evidence because their search box is literally a stub in the source and 14k people use the
thing anyway. So M2 and M4 in the MVP doc are still the right bets and this doc adds no new
retrieval machinery.

What it adds is the two things nobody else in the field has:

**A way to tell whether retrieval works.** Everyone, us included, ships a knowledge base and hopes.
OpenWiki generates questions from the source and answers them from the wiki only, with the reader
physically unable to see the source. That is a test, and we do not have one. OW1.

**A way for a maintenance pass to leave repair work behind without a queue.** Broken things get
marked in the file, and the next run finds the mark. No ledger, no job table, survives a crash and
a clone. OW2.

Everything after those two is hygiene and polish, and most of it is a day or less.

---

# A. The one real build

## OW1. Can the vault answer the question

**Today:** we have no way to know whether the vault is actually retrievable. Synthesis produces
insights and themes, the librarian repairs structure, and nothing ever asks whether a PM's real
question can be answered from what we wrote. `docs/evidence-layering.md` is the closest thing and it
is about how claims are argued, not about whether they can be found.

**Do:** OpenWiki's two-subagent loop, with our approval spine.

- **Asker.** A session with read access to the raw layer only (`sources/`, ticket and wikipage
  mirrors, plus the calendar and the commitment ledger). It writes 6 to 10 questions a PM would
  actually ask, each with a stable ID, 3 to 5 concrete acceptance criteria, and the exact source
  notes that motivated it. Their rule holds for us: a question must require more than reading one
  transcript top to bottom.
- **Answerer.** A separate session with read access to the derived layer only (insights, themes,
  decisions, hubs, person and customer pages). It returns PASS, PARTIAL or FAIL per question and,
  for anything short of PASS, names the missing facts precisely enough to fix a specific note. It
  does not restate the answer.
- **Grading rule, copied as written:** a documented evidence limit satisfies a criterion. "We asked
  Nordkap twice and never got a number, see [[...]]" is a PASS, not a gap. This is our
  unverified/wont-do distinction and they graded it correctly.
- **Output is proposal cards** against the named notes. One repair wave, then surface whatever is
  still failing as an honest list. No unattended loop, because our repairs go through approval and
  cannot retry themselves.

**The part that needs a real decision:** the read split has to be enforced by tools, not by prompt.
An answerer holding `search_notes` over the whole vault can reach `sources/` and the PASS means
nothing. That is either a layer filter on the search and read tools for that session, or two
narrower tool sets. It is the only nontrivial engineering in this ticket.

Surfacing: "what your vault can't answer yet" is a real thing to show a PM, and it is the first
honest answer we would have to "is this working". Could live on Home, or be a run you trigger.

**Decision:** Yes, but last and smaller. Sequence after M1 to M4 land so the first run measures the
fixed retrieval, not the known-broken baseline. v1 is a run you trigger by hand and a report you
read, no Home surface. The read split is enforced at the tool layer, never by prompt. Not started.

**Notes:**

---

# B. Small wiring

## OW2. Broken things mark themselves

**Today:** repair state lives outside the artifact. The librarian ledger tracks findings, the
capture dismiss ledger tracks mutes, and `wikipage-drift` tracks drift. Each is a side table that a
vault operation we do not control (a manual edit, a git revert, someone syncing the folder to
another machine) can put out of step with the files.

**Do:** for the classes where the mark belongs to the note, put it in the note. A `[[typed::link]]`
whose target is gone, a claim whose evidence no longer resolves, an enrichment that failed against
a stale snapshot. One inline marker, human readable, carrying the reason. Strip every marker at the
start of each pass and restamp what is still broken, so a fixed thing leaves no residue.

The rule that makes it work: never fail the run over it. Mark, continue, let the next pass repair.

**The open question that has to be answered first:** our editor renders. OpenWiki's markers are HTML
comments, invisible when rendered and visible in source, which is fine for a repo and wrong for us.
Either the marker is a visible affordance in the editor (a small "this link is broken, fix it" row)
or it goes in frontmatter as a field the properties block can render. Frontmatter is probably right,
since we already have machinery for it and it survives the round trip.

**Decision:** Skip for now. The desync it guards against (manual edits, git reverts, folder syncing
between machines) barely exists at beta scale, and it would replace three working mechanisms with a
new convention. Revive when a desync actually bites someone.

**Notes:**

## OW3. A pass that changes nothing leaves no trace

**Today:** `markLibrarianRun` stamps the run regardless. We already end scheduled runs quietly on
the presentation side, so the user does not get a toast, but the run still writes.

**Do:** two halves.

- **Byte snapshot.** Hash the vault content before and after. Identical means the run did not
  happen: no ledger write, no run stamp, no attention row. A scheduled pass that finds nothing to do
  should be indistinguishable from not having run.
- **Lazy status, aggregated failure.** Announce background work on the first item that will actually
  be worked, never before. Report failures once at the end, in one line naming each item and its
  reason, already scrubbed. Not one row per failure and not a silent swallow.

Small, and it is the difference between a background agent that feels calm and one that feels busy.

**Decision:** Build. Built 2026-08-07.

**Notes:** Built 2026-08-07. The fingerprint is `vaultFingerprint` in
`packages/application/src/use-cases/librarian.ts`, read off the live index rather than the tree
(every write goes through `index.reindex`), with session receipts and generated `index.md` maps left
out so a run cannot count its own residue. `settleLibrarianPass` beside it is the whole decision:
nothing is stamped when the pass fires any more, and at the far end a run with no card, no parked
question and an unmoved fingerprint writes nothing at all. `handlers.ts` holds the pass open in
`librarianPasses` while it runs (the interval stamp used to be the reentrancy guard and is now
written too late to be one), passes `deferAnnounce` so "last ran" is stamped on the settle that
counted rather than on starting, and collects every failure into one `failureReport` line
(`apps/desktop/src/main/log.ts`), scrubbed. What is deliberately NOT undone: the `seen` ledger rows
the scan writes, which are what makes the settle window work, and the "ran, nothing to report" stamp
on the agent's own page, which is QM ticket 2's on purpose.

## OW4. Frontmatter is clean before the session sees it

**Today:** `index.md` files are already generated deterministically from the vault index
(`packages/domain/src/notes/index-files.ts`), which is the right split and matches theirs. What we
do not have is the pre-run half: a session can open a note whose frontmatter is malformed or thin
and spend a turn on it.

**Do:** normalize frontmatter deterministically before the session starts. Fill what can be derived
from the file and the index, and mark anything we had to invent with a field the prompt knows about,
so the model's instruction is "if you see this marker, replace it with a real summary grounded in
the body and remove the marker". The deterministic pass leaves a to-do the model picks up in the
same run instead of a mess it has to notice first.

Pairs with M4 in the MVP doc: M4 makes descriptions say the right thing, this makes sure there is
always a description to say it in.

**Decision:** Build, folded in with M4. Built 2026-08-07.

**Notes:** `normalizeFrontmatter` is a pure function in `packages/domain/src/notes/normalize.ts`,
wired into `runMaintenance` (before the librarian scan and the `index.md` maps) and into
`runtime.run()` on the notes a session is about to see. The marker is a dedicated field
(`needs_summary: true`, plus `broken_frontmatter` preserving unparseable YAML verbatim), not a
sentinel inside `summary`, because every consumer of `summary` prints it. Markers are mutable on
every type and retire themselves once a real summary lands. A healthy vault-dev pass rewrites 0 of
91 files.

## OW5. Language is state, and the keys stay stable

**Today:** M2 in the MVP doc fixes the Swedish tokenizer, which is the live bug. This is the other
half and it is not covered there.

**Do:** treat the workspace language as persisted state rather than a per-run inference, and split
the vocabulary in two:

- **Localized:** `summary`, titles, body prose. The PM's language.
- **Never localized:** `type`, `tags`, typed-link relation names, folder names, slugs. These are
  addresses and grouping keys. OpenWiki keeps `tags` in English on purpose so they "stay stable
  across pages as cross-cutting aggregation keys", and a tag vocabulary that fragments by language
  is a grouping feature that quietly stops grouping.

Also worth copying: a region-only change is not a language change, and any pass that reads the
language should detect the actual language of a note rather than trust the setting, because a note
written before a switch is still in the old one.

**Decision:** Build, alongside M2 (which stays its own ticket). Built 2026-08-07.

**Notes:** Built. `language` is a settings.json field holding a bare tag ("sv", never "sv-SE"),
derived once from the OS locale on first run and the PM's own after that; Settings has a Language
row. `@qale/domain/language` holds the two rules: `languageTag`/`sameLanguage` drop the region so
moving country is not a language change, and `detectLanguage` reads Swedish vs English off a note
body by stopword counts, saying null rather than guessing. Every session's system prompt now states
the language as a fact and says that types, tags, relation names, folders and slugs stay in English.
`vault_read` adds one line when the note it just read is in a different language from the setting,
so an edit follows the note rather than the setting. The seeded `_language` skill no longer names a
language; it keeps the part that was always prose (quotes, names, house words, who a message is
addressed to). Nothing enforces the key vocabulary on write beyond what already existed: slugs are
ascii-folded, relation tokens must be `[a-z0-9-]`, and `tags` is an unchecked string array.

## OW6. Deferrals are recorded, not dropped

**Today:** when a session decides not to cover something, that decision evaporates. The next run
rediscovers it or does not.

**Do:** the discipline, borrowed whole. Anything deliberately deferred gets a one-line entry with
the note that anchors it and the reason. Promote it as soon as the evidence is there, then delete
the entry. Their prompt line is the one to steal: do not let the backlog grow silently, every
identified area is either covered or has an entry.

Overlaps with M7 (things end with a reason) in the MVP doc. Same instinct, applied to coverage
instead of lifecycle. Worth deciding whether it is one mechanism or two.

**Decision:** One mechanism. A reason line, not a queue or a side table, so M7 reuses it by adding a
kind rather than building a second thing.

**Notes:** Built. `packages/application/src/use-cases/deferrals.ts` holds it: a row in the same check
ledger the sweep's own `seen`/`handled` rows live in, keyed `reason:<kind>:<notePath>` and valued
`<stamp>|<reason>`, so it survives a relaunch for free. `ReasonKind` is `deferred` today; M7's "todo
dropped", "capture row waved off", "theme moved to wont-do" are the same record with another kind,
and the storage, the sanitising, the decay and the clear-on-accept hook are already shared.
`record_deferral` (`packages/agent/src/deferrals.ts`) is registered on every session for the same
reason `end_quietly` is: it writes nothing, decides nothing and grants nothing. The lifecycle is
create → carried into the next librarian worklist → deleted, and deletion has three doors:
`acceptProposal` clears every reason line anchored to a card's `targetPath` (an approved card against
that note IS the coverage), a 30-day TTL expires the rest, and an entry whose note has been deleted
goes with it. Reading is what expires them; nothing sweeps the table on a timer. Deferrals ride
along on a pass that was happening anyway and never cause one, or the tick would fire on the same
reminder every half hour. The reasons are agent-written text read back into a later prompt (OW9), so
they are flattened to one line, stripped of markers and capped at 200 chars on the way in, and the
worklist block says out loud that they are an earlier pass's own notes rather than instructions or
findings. The backlog is capped at 24 open entries and the cap REFUSES rather than evicting the
oldest, because silent eviction is the thing the ticket is about. The librarian's file carries the
stolen line verbatim.

---

# C. Security hygiene

Each of these is half a day or less, and each closes a hole that would be embarrassing rather than
catastrophic. I would do all four before beta.

## OW7. Redaction gets a value-based pass

**Today:** `redactLogLine` in `apps/desktop/src/main/log.ts` is already one vocabulary shared by the
log and the telemetry sender, which is the part most projects get wrong. It is entirely shape-based:
paths, hosts, emails, note slugs, and anything 24-plus characters with a digit in it.

**Do:** add the pass OpenWiki does first. Take the credentials we actually hold (the Atlassian
token, the Google OAuth access and refresh tokens, the MCP token) and string-replace those exact
values out of the text before the shape rules run. Shape rules only catch formats we anticipated;
the value pass catches any credential in any shape, including the next connector's.

Cheap, and it is the difference between "we thought of that format" and "it cannot leak".

**Decision:** Build. Built 2026-08-07.

**Notes:** `registerSecretValue` in `apps/desktop/src/main/log.ts`; `redactLogLine` string-replaces
every registered value (longest first, plain split/join, min 6 chars) before the shape rules run.
Registered wherever a credential enters or is loaded: settings load (MCP token), the Anthropic key
setter and getter, Atlassian and Google setters and getters, and both Google OAuth token paths
(connect and every refresh). Rotation keeps the old value registered for the process lifetime. The
telemetry sender shares the same function, so it is covered for free.

## OW8. A refused write inside the vault boundary is loud

**Today:** `ctx.vault.contain` refuses paths outside the vault, which is correct. What I have not
checked is what happens when our own machinery hits that refusal.

**Do:** audit every internal writer that goes through the confined vault handle and make a refusal
fail loudly rather than return an error nobody reads. OpenWiki's issue #496 is the exact shape of
the bug: their summarizer's history offload was refused by the docs-only guard, non-fatally, and
what actually happened was that summarization silently degraded and coverage got worse on large
repos. The guard was right. Swallowing the refusal was the bug.

**Decision:** Build. Built 2026-08-07.

**Notes:** New typed `VaultBoundaryError` in `packages/application/src/ports.ts`, thrown by all
three write paths in `fs-vault.ts`. Four swallows found and fixed: `remove()` was a silent no-op on
refusal (the note vanished from the app while the file stayed on disk); `generateIndexFiles`
aborted mid-loop under a generic error (now attempts every map, commits what landed, then raises
naming the refusals); `sync-service` mirror writers logged and advanced the high-water mark past a
mirror that never landed (now escalate to the pull loop so the change is retried); `acceptUpdate`'s
retitle swallowed the refusal into "decisions cannot be retitled" (now logged). Reads still return
null/false/empty on refusal, on purpose: a refused read honestly is "nothing there".

## OW9. Nothing an agent writes unapproved reaches a later prompt

**Today:** the approval gate covers vault notes, and `wrapExternal` covers material coming in. What
is not audited is the middle: session files, the librarian ledger, parked questions, anything an
unattended run writes without approval.

**Do:** trace it. For each thing an agent can write without a human yes, ask whether it is ever read
back into a prompt in a later session. Where the answer is yes, either the write goes through
approval or the read wraps it the way external material is wrapped.

The threat is not this turn. It is an instruction that got injected once, landed in a summary or a
ledger line, and now loads into every future session. OpenWiki closes this by denying the agent
write access to the conversation-history mount even though the summarizer can still write there.

**Decision:** Build, as an audit with targeted fixes. Built 2026-08-07, last of the batch so it
covered everything the other tickets added.

**Notes:** Eighteen artifacts traced (write → read-back point → protection). Four holes fixed:
`files_read` now returns session files inside the standard envelope (covers dropped material,
child `write_result` files, the whole parent folder a child reads); the `spawn` rollup is wrapped
and framed as the children's report, not instructions; every interpolation in the librarian
worklist kickoff goes through a shared `oneLine` (flatten, defang `<<<`/`>>>`, cap); `ask_user`
questions and labels are flattened and capped on the way into storage, so the parked replay is
bounded. Left alone on purpose: `brief.md` into the child system prompt (the parent is the trusted
planner; that is delegation, not injection) and `mcp-service.ts` (hands snippets to a third-party
agent; a different trust boundary than this ticket draws, flagged for later). Skill and agent
files remain the highest-leverage write in the system and are correctly behind approval cards.

## OW10. Say what the boundary does not do

**Today:** we make privacy claims in product copy (`safe_space`, "nothing leaves your machine")
without stating their limits.

**Do:** copy their standard, which is the most honest paragraph in their README. For each boundary,
say what it guarantees and name the channel it does not close. Theirs, about ignored paths: they are
never read or reproduced, and this does not guarantee the topic is never mentioned, because the
agent can still infer it from tests, the README, or commit messages.

Also worth a look: their discovery tools silently filter excluded paths while a direct read errors
loudly, on purpose, because an error tells the model the path exists. Worth checking that our own
exclusions behave that way round.

**Decision:** Built 2026-08-07.

**Notes:** `safe_space` no longer exists anywhere in the code — the ticket's premise was stale, so
the copy work landed on the boundaries we do make: the model call, the connectors, telemetry, the
local git repo, the MCP server, the API key and the diagnostics block. The unstated channel in
nearly all of them was the same one: when the agent works, the notes it reads go to Anthropic.
That is now said on the cover screen, on the key screen, in Settings → Anthropic API key, under
both telemetry switches (`TELEMETRY_LIMIT` in `@qale/ipc`, rendered by `TelemetryDetails` outside
the fold so it appears in the setup screen and Settings from one string), and next to both
connections surfaces.

On exclusions: discovery is index-backed everywhere (`vault_list`, `vault_grep`, `search_vault`,
`index.md` generation, backlinks), and dot-prefixed paths never reach the index because
`FsVault.walk` skips them. `vault_read`, though, only checked containment, so a guessed
`.git/config` or `.obsidian/…` came straight back. It now refuses hidden paths out loud, in the
same words whether or not the file is there, so the refusal confirms the rule and never the file.
Session scratch is unaffected: it is reached through the rooted `files_*` tools, never `vault_*`.

---

# D. Product surface

## OW11. A standing brief for the workspace

**Today:** skills are ours and per-task. There is nothing a PM can write once that every session
reads for scope and priorities.

**Do:** one user-authored file the agent always reads and never rewrites. "We are B2B SaaS, our
customers are in `customers/`, never file under `decisions/` without a date, the board cares about
churn." OpenWiki calls this control metadata and keeps it out of index generation, out of
translation, and out of the link validator. That exclusion discipline is the part that makes it
work: generated content and control metadata are never the same file.

Small to build, and it is the answer to "how do I tell it how we work" that does not require
writing a skill.

**Decision:** Wait. Good and small, but it competes with M5 (consolidation) for the same
agent-facing attention, and M5 is the beta feature. A gap-filler if M5 slips.

**Notes:**

## OW12. An intent routing table

**Today:** the root and per-folder `index.md` maps orient by structure: here are the folders, here
is what is in them. Nothing routes by intent.

**Do:** a compact table from what a PM is trying to do to where the answer lives. Their columns are
intent, page, entrypoints, symbols, tests, minimal check; ours would be intent, notes, people,
open commitments. Generated deterministically from frontmatter and the edge index, the same way the
folder indexes already are, so it cannot go stale.

Their stated objective is worth writing into the librarian and the synthesis skill in these words:
**path compression**, shorten the route from an intent to the notes that answer it. It is
falsifiable, and OW1 is how you measure it.

Lower confidence than the rest of this doc. It is plausibly just a better `index.md` rather than a
new object, and OW1 would tell us whether it is needed at all. Worth sequencing after OW1 for that
reason.

**Decision:** Wait for OW1's results, per this ticket's own reasoning.

**Notes:**

---

## What I would not build

- **Their re-synthesis model.** Their update run rewrites whatever pages it decides are affected,
  unattended, straight to disk. Coherent when source is ground truth and the wiki is derived. Wrong
  for a vault holding the PM's own decisions. Every idea above arrives as a card.
- **Anything about providers.** Roughly a sixth of their codebase is credential and provider
  surface. Not our problem.
- **Their untrusted-content handling.** It is a prompt instruction. Our `wrapExternal` envelope with
  a random per-call id and defanged delimiters is materially stronger. Stay ahead, take nothing.
- **A "show me what telemetry would send" flag.** They built `--telemetry-file=<path>` and it is a
  good idea, and we already have the better version: `packages/ipc/src/telemetry.ts` is a closed
  schema that the consent screen renders and the sender is bound by. Nothing to add.
- **A graph visualizer.** Pretty, CDN-dependent, and their own search box inside it is a stub.

---

## Sequence

OW1 is the build. It is the only thing here that produces a capability we do not have, and it makes
every other retrieval decision measurable instead of argued.

The four security tickets (OW7 to OW10) are independent of everything and should go in before beta
regardless of what happens to the rest.

OW2 to OW6 are a few days together and none of them block each other. OW3 is the one a user notices.

OW11 and OW12 are last, and OW12 should wait for OW1 to say whether it is needed.

Against the MVP doc: nothing here displaces M1 to M5. OW5 pairs with M2, OW4 pairs with M4, OW6
overlaps M7, and OW1 is the thing that would tell us whether M1 to M4 actually worked.
