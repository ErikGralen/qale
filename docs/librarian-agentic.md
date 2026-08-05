# The librarian, done by the agent

Direction doc, 2026-08-05. Companion to `docs/arrival-agentic.md`: the same move, applied to
the librarian. Nothing here is built yet. Decisions the design needs are collected at the
bottom; the ones already made are marked.

## Why

The librarian has a well-written agent file that says "read the flagged notes first, then what
they touch". Almost nothing that runs under its name actually does that. The 5-minute sweep is
a pile of deterministic stand-ins for reading:

- **Edit distance stands in for "what did the author mean?"** A broken link gets repointed by
  levenshtein tiers and containment (`tom` matches `tom-devlin` because one string contains
  the other). Exactly one hit in the strongest tier and a card is filed without either note
  ever being read. A wrong but plausible guess produces a wrong but plausible card.
- **A counter stands in for "what is this note?"** An unlinked note that names 2 or more
  existing pages is declared a capture; fewer, a stray. `CAPTURE_NAME_FLOOR = 2` decides
  between two completely different treatments. The name matching itself is a stack of
  vocabulary heuristics: 4-character floors, first-word keys for people and customers,
  a rule that themes never count.
- **A JSON straitjacket stands in for the drift judgment.** The one place the sweep does
  consult a model (does this page contradict this decision?), it does so through a hand-built
  prompt, a hand-rolled JSON parse, and a confidence gate. That mini-agent cannot open the
  supersedes chain to check a detail, cannot look at a third note, and cannot ask. Anything it
  is unsure about becomes a ping whose seeded session starts the reading over from zero.
- **Skill copy lives in TypeScript.** The seed prompts on every ping group, the drift rules
  ("a page that merely omits the decision does not contradict it"), and the supersede-reaction
  prompt in `handlers.ts` are all instructions to a model, hardcoded where only a developer
  can change them. The agent file the PM can actually edit governs almost none of the
  librarian's real behaviour.

Meanwhile the platform grew everything the agent file needs to be the real implementation:
scheduled sessions that end quietly when nothing was produced, `ask_user` with option cards
that survive a quit, `spawn` for backlog scale, and the session surfaces to watch or correct
any of it. Like arrival, this is mostly demolition plus skill copy.

## The shape

**Detection stays mechanical.** Whether a wikilink resolves, whether a note has any links,
which mirrored pages sit in a decision's orbit: these are graph facts, the librarian's
equivalent of arrival's "this is a zip". The index scan and the drift pair selector survive
as-is. So does the clockwork around them: the tick, sync-before-sweep, the reentrancy guard,
the enabled gate, and the check ledger that stops the same finding being handled twice.

**Judgment moves into a session.** When the scan turns up findings the ledger has not seen,
the tick fires one librarian session carrying the worklist. The agent reads before deciding:
the sentence around a broken link, the orphan's actual text, the page and the decision and its
chain. It proposes repairs through the tools every other session uses (`propose_update`,
`draft_confluence_update`), each card with a plain-words reason grounded in what it read.
When it cannot tell, it asks with option cards. A run that finds nothing worth doing ends
quietly, like any scheduled run.

**Questions replace pings.** Today a judgment call becomes a ping with precomputed one-tap
answers, and opening it seeds a fresh session that re-reads everything. In the new shape the
question comes from the session that already did the reading: "this link could mean Kranelund
or Kranelund Logistics AB, which?" as a parked `ask_user` card with the candidates as options.
The whole ping pipeline (payload types, groups and floors, seed prompts, the tap-to-apply
machinery) dissolves.

**Quiet stays quiet.** Pings deliberately never counted toward the Inbox badge; maintenance
can always wait. That property must survive the move: the librarian's parked questions render
in the quiet maintenance section, not among the questions that mean "an agent you started is
blocked on you". See decision 2.

## Cadence and spend

The 5-minute tick cannot fire a session every 5 minutes, and should not: today's sweep
happily proposes a repair for a link the PM is mid-way through typing. Three mechanical rules,
all about time and money rather than meaning, keep the agentic version calm:

- **A settle window.** A finding only enters the worklist once it has survived at least one
  full tick (roughly: seen on two consecutive scans). Half-typed links and notes still being
  written never reach the agent.
- **A minimum session interval.** The tick fires the librarian at most once per interval
  (say 30 minutes; a constant next to `MAINTENANCE_TICK_MS`), however busy the workspace.
  The supersede event bypasses the interval, because the PM just accepted the decision and
  expects the repoints now.
- **The ledger, generalized.** One row per finding: a broken link keyed by source and target,
  an orphan keyed by path and mtime, a drift pair keyed by its revision, marked when the
  session handled it, asked about it, or the PM declined the card. Unchanged findings never
  re-enter a worklist; the week-long quiet window after a decline stays.

The card caps survive as skill copy plus one hard gate: the skill says to raise only the most
valuable handful per run, and the tick does not fire a session at all while the librarian's
pending cards are at the cap. The per-tick judgment counter and the fix budget arithmetic go;
batching does their job.

## What each finding becomes

**Broken links.** The worklist names the link and where it sits. The agent reads the
surrounding text, searches the vault, and either proposes the repoint with its reason, asks
with candidates as options, or says the target genuinely does not exist and offers creating
the page or dropping the link. The levenshtein machinery survives only as a hint: the
worklist line may carry "similar existing pages: …" computed by the old tiers, as retrieval,
never as the decision (decision 3).

**Unlinked notes.** The agent reads the note and decides what it is in the open: a capture
worth processing, a page worth wiring into the hub it belongs under, or noise worth deleting
(proposed, never done; the PM deletes). "Names pages without linking them" becomes a sentence
in the skill describing what a capture looks like, not a threshold. For a capture, the agent
offers to run the process pass right there in the session (decision 5), instead of the
current say-so-and-stop handoff.

**Wikipage drift.** Pair selection and the revision ledger stay deterministic. The judgment
stops being a one-shot completion: the session reads the page, the decision, and its chain,
and when the page contradicts the decision as it stands, drafts the page update itself with
`draft_confluence_update`, redline anchored in the page's real text. Diffuse contradiction
becomes a parked question instead of a ping. The prompt builder, the JSON verdict parser, the
confidence gate, and the `completions` port (the drift sweep is its only user) all go.

**A replaced decision.** The trigger stays hardcoded (accepting a decision card that carries
`supersedes`), as `agents.ts` already declares. The fired session's kickoff shrinks to the
event ("[[old]] was replaced by [[new]]"); the judgment about what a repoint is, that the
spine is append-only, and that a note contradicting the new decision gets flagged rather than
rewritten, lives in the agent file, where most of it is already written.

## What the skill says (draft)

Product copy to be written properly, but the judgment it must cover, much of it lifted from
copy that exists today in TypeScript:

- **Read before repairing.** Never repoint a link without reading the sentence it sits in.
  Say the reason in plain words on every card.
- **What a broken link can mean.** A rename, a typo, a page that never existed, a page that
  should exist. Each has a different right move; two plausible targets is a question, not a
  guess.
- **What an unlinked note can be.** A raw capture (names people and themes it never links),
  a stray the workspace owns, or noise. Read it before deciding. Deletion is always proposed,
  never performed.
- **Drift.** A page that explicitly states something the current decision rules out
  contradicts it. A page that merely omits the decision, or covers a different topic, does
  not. A page still matching an old, superseded decision contradicts the current one.
- **The spine is append-only.** Never edit a superseded decision's body; repoint what cites it.
- **Batch judgment.** A handful of findings, read them yourself. A first pass over a big
  vault, spawn skims and work from the results (same 5-and-above shape as arrival).
- **Restraint.** Raise the few most valuable repairs, leave the rest for the next pass, and
  end quietly when the memory is already tidy.

## What this needs from the platform

1. **The tick fires a session with a worklist.** `runLibrarianSweep` shrinks to: scan, diff
   against the ledger, apply the settle window and interval, and either do nothing or call
   `fireSession('librarian', kickoff-with-worklist, { scheduled })`. The existing quiet-end
   machinery handles the rest.
2. **A quiet surface for parked maintenance questions.** Librarian questions must not count
   toward the badge. Either scheduled-session questions render in the quiet section, or the
   attention rules key on the agent. Small renderer change either way.
3. **Inbox grouping by agent, not by the magic id.** Sweep cards currently carry
   `sessionId: 'librarian'` and the Inbox special-cases that string into the Housekeeping
   group. Cards now come from real sessions, so the group keys on the owning agent.
4. **Ledger generalization.** `sweep_checks` grows the link and orphan keys alongside the
   drift keys, plus the settle timestamps. Storage exists; only the keys are new.
5. **Demolition.** In `pings.ts`: link-fix proposal, orphan classification, mention hosts,
   name keys, the groups and their seed prompts, `resolvePingItem` and the tap-apply path.
   In `wikipage-drift.ts`: everything below the pair selector. In `link-repair.ts`: the
   mention machinery; the tiers stay only if decision 3 keeps them as hints. The ping store,
   DTOs, and `PingRows` UI. The `completions` port and its wiring. The supersede prompt in
   `handlers.ts`. Old pending pings retire on upgrade, the pattern `RETIRED_KEY` already
   implements.

## Decisions (all decided 2026-08-05)

1. **Cadence constants.** Settle window one tick, session interval 30 minutes. Both are
   plain constants next to `MAINTENANCE_TICK_MS`, cheap to tune later.
2. **Where librarian questions surface.** Parked questions from scheduled librarian runs
   render in the quiet maintenance section and never count toward the badge, preserving the
   ping contract: maintenance can always wait.
3. **The fuzzy-match tiers survive as hints.** One line of "similar existing pages" per
   broken link in the worklist. Retrieval a text search cannot do (typos); it decides
   nothing. The rest of `link-repair.ts` still goes.
4. **Answering an option card unblocks a card, it does not apply the fix.** Two gestures
   (answer, then approve) is the honest v1; "the answer is the approval" has no machinery
   and would quietly widen what an answer can write. Revisit if it grates.
5. **The librarian may run the process pass itself.** For a capture, "process it now?" as
   an option card, then the pass in-session via the skill loader. Processing still only
   produces approval cards, so nothing new can be written silently.
6. **The scheduled session runs on Sonnet.** Quick and cheap fits a background tidy pass;
   spawn skims also go quick. Interactive sessions keep the app default.
7. **Pair selection stays deterministic.** Which pages orbit which decisions is graph
   traversal; sending an agent to rediscover it every run buys nothing and costs plenty.
8. **Sequencing: arrival first.** `docs/arrival-agentic.md` is being implemented now and
   lands before this starts, so this design inherits proven quiet sessions and worklists.
